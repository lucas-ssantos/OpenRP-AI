import fs from "fs";
import path from "path";
import { getGenerationConfig, getConversationModel, addMessage, updateMessage } from "../../services/database/queries.js";
import { getModelContextLength } from "../../services/ollama.models.js";
import { appConfig } from "../../config.js";
import { broadcast, closeGeneration } from "./generationManager.js";

const OLLAMA_URL = appConfig.ollama.chatEndpoint;

// Último recurso da cadeia de fallback — carregado uma vez no boot.
let MEDIUM_SPEC = {};
try {
    MEDIUM_SPEC = JSON.parse(fs.readFileSync(
        path.join(process.cwd(), "config_recomendadas", "medium_spec.json"), "utf8"
    ));
} catch { /* sem o preset, a cadeia para nos defaults do .env */ }

// Um valor só é aceito de uma fonte se passar no validador do campo — NULL vindo
// do banco (campo deixado em branco no /settings) ou lixo nunca chega ao Ollama.
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
const VALIDATORS = {
    model:              (v) => typeof v === "string" && v.trim().length > 0,
    temperature:        (v) => isNum(v) && v >= 0 && v <= 2,
    top_p:              (v) => isNum(v) && v > 0 && v <= 1,
    top_k:              (v) => isInt(v) && v >= 0,
    min_p:              (v) => isNum(v) && v >= 0 && v < 1,
    repeat_penalty:     (v) => isNum(v) && v > 0,
    repeat_last_n:      (v) => isInt(v) && v >= -1,
    max_tokens:         (v) => isInt(v) && (v === -1 || v > 0),
    min_tokens:         (v) => isInt(v) && v >= 0,
    // null = "contexto automático" (checkbox do /settings) — deliberado, não inválido.
    // Resolvido em streamOllama() para o context_length real do modelo (via
    // getModelContextLength), não simplesmente omitido do request ao Ollama.
    context_size:       (v) => v === null || (isInt(v) && v > 0),
    num_ctx_messages:   (v) => isInt(v) && v > 0,
    memory_interval:    (v) => isInt(v) && v > 0,
    // 0 = extração de persona facts desligada (deliberado, não inválido)
    persona_interval:   (v) => isInt(v) && v >= 0,
    seed:               (v) => isInt(v),
    stream:             (v) => typeof v === "boolean",
    stop:               (v) => Array.isArray(v),
    max_response_chars: (v) => isInt(v) && v >= 0,
    think:              (v) => typeof v === "boolean",
};

// Hierarquia por campo: global (banco) → defaults (.env) → medium_spec.json.
// Campo null/inválido numa fonte cai para a próxima — nunca vaza para o Ollama.
// Único override existente: modelo exclusivo da conversa (model-only).
export function resolveConfig(conversationId = null) {
    const sources = [getGenerationConfig(), appConfig.defaults, MEDIUM_SPEC];
    const config = {};
    for (const [key, isValid] of Object.entries(VALIDATORS)) {
        const src = sources.find((s) => s && isValid(s[key]));
        if (src) config[key] = src[key];
    }

    if (conversationId) {
        const convModel = getConversationModel(conversationId);
        if (VALIDATORS.model(convModel)) config.model = convModel;
    }
    return config;
}

function estimateTokens(text) {
    return Math.ceil(text.trim().split(/\s+/).length * 1.3);
}

// Com thinking ativo, os tokens de raciocínio saem do mesmo num_predict que a
// resposta — sem folga, o check (por mais mínimo que a instrução THINKING peça)
// rouba espaço da resposta real. O bônus só se aplica a orçamentos positivos:
// -1 (parada natural) já não tem teto a estourar.
const THINKING_TOKEN_BONUS = 400;
export function withThinkingBudget(tokens, config) {
    if (!tokens || tokens <= 0 || config.think !== true) return tokens;
    return tokens + THINKING_TOKEN_BONUS;
}

// When max_tokens <= 0 (i.e. -1), passes -1 through to Ollama (natural stop).
// Dynamic capping only applies when the user sets a positive max_tokens ceiling.
export function dynamicMaxTokens(userMessage, config) {
    if (!config.max_tokens || config.max_tokens <= 0) return -1;
    const FLOOR   = config.min_tokens ?? 60;
    const CEILING = config.max_tokens;
    const RATIO   = 1.4;
    const base = Math.max(FLOOR, Math.min(CEILING, Math.ceil(estimateTokens(userMessage) * RATIO)));
    return withThinkingBudget(base, config);
}

function lastSentenceBoundary(str) {
    return Math.max(
        str.lastIndexOf('.'),
        str.lastIndexOf('!'),
        str.lastIndexOf('?'),
        str.lastIndexOf('…'),
    );
}

export function trimToLastSentence(text, maxChars) {
    if (!maxChars || maxChars <= 0 || text.length <= maxChars) return text;

    const truncated = text.slice(0, maxChars);
    const boundary = lastSentenceBoundary(truncated);
    if (boundary <= 0) return truncated;

    let result = text.slice(0, boundary + 1).trim();

    // Se sobrou asterisco não fechado, recua até antes da ação incompleta
    const asteriskCount = (result.match(/\*/g) || []).length;
    if (asteriskCount % 2 !== 0) {
        const openAt = result.lastIndexOf('*');
        const before = result.slice(0, openAt);
        const prevBoundary = lastSentenceBoundary(before);
        result = prevBoundary > 0
            ? text.slice(0, prevBoundary + 1).trim()
            : before.trim();
    }

    return result;
}

export function startSSE(res) {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    res.flushHeaders();
}

export function handleSSEError(res, err, label) {
    console.error(`${label}:`, err);
    if (!res.headersSent) {
        res.status(500).json({ ok: false, message: err.message });
    } else {
        try {
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
        } catch { /* ignore */ }
    }
}

// Sem nenhum chunk do Ollama por este tempo, o stream é abortado (modelo travado).
const STREAM_STALL_TIMEOUT_MS = 120_000;

// Progresso é persistido no banco à medida que chega, e não só no final — é o
// que garante que a resposta sobrevive mesmo se ninguém estiver com o SSE
// aberto para recebê-la. Throttled para não bater no banco a cada token.
const PERSIST_THROTTLE_MS = 300;

// Gera a resposta do Ollama para `conversationId`, transmitindo cada delta para
// todo subscriber atualmente registrado em `gen` (ver generationManager.js) e
// persistindo o conteúdo progressivamente — a geração roda até o fim
// independentemente de haver alguém conectado ouvindo. onDone(filteredContent,
// rawContent, rawThinking, assistantMessageId) é chamado quando a geração
// termina (com sucesso ou interrompida por stall, desde que tenha gerado algo);
// deve persistir o conteúdo final (já trimado) e retornar campos extras para o
// evento `done`. opts.afterDone() roda depois do evento `done` ser transmitido
// — trabalho em background (ex.: extração de memória) que ainda pode emitir
// eventos SSE próprios sem atrasar a percepção de conclusão do cliente.
// opts.insertPosition replica a posição de uma mensagem substituída (regenerate).
export async function streamOllama(conversationId, gen, messages, config, onDone, opts = {}) {
    const { afterDone = null, insertPosition = null } = opts;
    const controller = new AbortController();
    let stallTimer   = null;

    const resetStallTimer = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => controller.abort(), STREAM_STALL_TIMEOUT_MS);
        stallTimer.unref?.();
    };
    const cleanup = () => {
        if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    };

    let fullContent = "";  // filtered (without <think> blocks) — transmitido e persistido
    let rawContent  = "";  // saída verbatim do modelo — só para log
    let rawThinking = "";  // raciocínio nativo (message.thinking) — só para log

    // gen.content acompanha fullContent em tempo real (não throttled) — é o que
    // GET /conversations/:id/generation manda como snapshot pra quem reconecta,
    // então não pode ficar atrás do que já foi transmitido aos subscribers.
    let lastPersistAt = 0;
    const persist = (force = false) => {
        if (!fullContent) return;
        const now = Date.now();
        if (!force && now - lastPersistAt < PERSIST_THROTTLE_MS) return;
        lastPersistAt = now;
        if (!gen.assistantMessageId) {
            gen.assistantMessageId = addMessage(conversationId, "assistant", fullContent, insertPosition);
        } else {
            updateMessage(gen.assistantMessageId, fullContent);
        }
    };

    const finish = async (errorMsg = null) => {
        cleanup();
        persist(true);
        let extra = {};
        // No caminho de sucesso, onDone sempre roda (mesmo com fullContent vazio —
        // é o que loga/trata uma resposta vazia do Ollama). No caminho de stall,
        // só roda se algo chegou a ser gerado, preservando esse parcial.
        if (!errorMsg || fullContent) {
            try { extra = (await onDone(fullContent, rawContent, rawThinking, gen.assistantMessageId)) ?? {}; }
            catch (e) { console.error("streamOllama onDone error:", e); }
        }
        broadcast(conversationId, { delta: "", done: true, ...extra, ...(errorMsg ? { error: errorMsg } : {}) });
        if (!errorMsg && afterDone) { try { await afterDone(); } catch { /* trabalho pós-done não pode derrubar o stream */ } }
        closeGeneration(conversationId);
    };

    try {
        resetStallTimer();
        // context_size NULL ("contexto automático") resolve para o context_length real
        // do modelo em vez de omitir num_ctx — sem isso o Ollama cai no default hardcoded
        // de 4096 tokens para qualquer modelo sem PARAMETER num_ctx no próprio Modelfile.
        const numCtx = config.context_size || await getModelContextLength(config.model) || undefined;
        const ollamaRes = await fetch(OLLAMA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
                model: config.model,
                messages,
                stream: true,
                think: config.think === true,
                options: {
                    temperature:   config.temperature,
                    top_p:         config.top_p,
                    top_k:         config.top_k,
                    min_p:         config.min_p,
                    repeat_penalty: config.repeat_penalty,
                    repeat_last_n: config.repeat_last_n,
                    num_ctx:       numCtx,
                    num_predict:   config.max_tokens,
                    seed:          (config.seed !== -1 && config.seed != null) ? config.seed : undefined,
                    stop:          config.stop?.length ? config.stop : undefined,
                },
            }),
        });

        if (!ollamaRes.ok) {
            cleanup();
            closeGeneration(conversationId, { delta: "", done: true, error: `Ollama: ${ollamaRes.status} — ${await ollamaRes.text()}` });
            return;
        }

        let inThink   = false;
        const reader  = ollamaRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer    = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            resetStallTimer();

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.trim()) continue;
                let parsed;
                try { parsed = JSON.parse(line); } catch { continue; }

                if (parsed.message?.thinking) rawThinking += parsed.message.thinking;

                if (parsed.message?.content) {
                    const raw  = parsed.message.content;
                    rawContent += raw;

                    let delta = raw;

                    if (inThink) {
                        const endIdx = delta.indexOf("</think>");
                        if (endIdx !== -1) { inThink = false; delta = delta.slice(endIdx + 8); }
                        else continue;
                    }

                    while (delta.includes("<think>")) {
                        const startIdx = delta.indexOf("<think>");
                        const before   = delta.slice(0, startIdx);
                        if (before) {
                            fullContent += before;
                            gen.content = fullContent;
                            broadcast(conversationId, { delta: before, done: false });
                        }
                        const endIdx = delta.indexOf("</think>", startIdx);
                        if (endIdx !== -1) { delta = delta.slice(endIdx + 8); }
                        else { inThink = true; delta = ""; }
                    }

                    if (delta) {
                        fullContent += delta;
                        gen.content = fullContent;
                        broadcast(conversationId, { delta, done: false });
                    }

                    persist();
                }

                if (parsed.done) {
                    await finish();
                    return;
                }
            }
        }

        // Fallback if stream ended without a parsed.done event
        if (fullContent) { await finish(); return; }
        cleanup();
        closeGeneration(conversationId);
    } catch (err) {
        cleanup();
        if (err?.name === "AbortError") {
            // Stall (Ollama parou de responder): persiste o parcial e encerra.
            // Não depende mais de o cliente estar conectado — a única causa de
            // abort agora é o próprio Ollama travar.
            await finish("Geração interrompida — o Ollama parou de responder.");
            return;
        }
        console.error("streamOllama error:", err);
        closeGeneration(conversationId, { delta: "", done: true, error: err.message });
    }
}
