import fs from "fs";
import path from "path";
import { getGenerationConfig, getConversationModel } from "../../services/database/queries.js";
import { appConfig } from "../../config.js";

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
    // null = "contexto automático" (checkbox do /settings) — deliberado, não inválido
    context_size:       (v) => v === null || (isInt(v) && v > 0),
    num_ctx_messages:   (v) => isInt(v) && v > 0,
    memory_interval:    (v) => isInt(v) && v > 0,
    seed:               (v) => isInt(v),
    stream:             (v) => typeof v === "boolean",
    stop:               (v) => Array.isArray(v),
    max_response_chars: (v) => isInt(v) && v >= 0,
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

// When max_tokens <= 0 (i.e. -1), passes -1 through to Ollama (natural stop).
// Dynamic capping only applies when the user sets a positive max_tokens ceiling.
export function dynamicMaxTokens(userMessage, config) {
    if (!config.max_tokens || config.max_tokens <= 0) return -1;
    const FLOOR   = config.min_tokens ?? 60;
    const CEILING = config.max_tokens;
    const RATIO   = 1.4;
    return Math.max(FLOOR, Math.min(CEILING, Math.ceil(estimateTokens(userMessage) * RATIO)));
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

// Streams Ollama response as SSE. onDone(filteredContent, rawContent) is called
// when streaming finishes; it should persist the message and return extra fields for the done event.
// afterDone(res) runs AFTER the done event is written but before res.end() — for background
// work (e.g. memory extraction) that may still push SSE events without blocking the client's
// perception of completion (the frontend unlocks the input on `done`).
//
// Se o cliente desconectar no meio do stream, a geração no Ollama é abortada
// (libera a GPU); o conteúdo parcial já gerado ainda é persistido via onDone.
export async function streamOllama(res, messages, config, onDone, afterDone = null) {
    const controller = new AbortController();
    let clientGone   = false;
    let stallTimer   = null;

    const onClientClose = () => { clientGone = true; controller.abort(); };
    res.on("close", onClientClose);

    const resetStallTimer = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => controller.abort(), STREAM_STALL_TIMEOUT_MS);
        stallTimer.unref?.();
    };
    const cleanup = () => {
        if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
        res.off("close", onClientClose);
    };

    let fullContent = "";  // filtered (without <think> blocks) — sent to SSE and saved
    let rawContent  = "";  // verbatim output from the model — used for logging

    const finish = async () => {
        cleanup();
        const extra = await onDone(fullContent, rawContent);
        if (clientGone) return;
        res.write(`data: ${JSON.stringify({ delta: "", done: true, ...extra })}\n\n`);
        if (afterDone) { try { await afterDone(res); } catch { /* trabalho pós-done não pode derrubar o stream */ } }
        res.end();
    };

    try {
        resetStallTimer();
        const ollamaRes = await fetch(OLLAMA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
                model: config.model,
                messages,
                stream: true,
                think: false,
                options: {
                    temperature:   config.temperature,
                    top_p:         config.top_p,
                    top_k:         config.top_k,
                    min_p:         config.min_p,
                    repeat_penalty: config.repeat_penalty,
                    repeat_last_n: config.repeat_last_n,
                    num_ctx:       config.context_size || undefined,
                    num_predict:   config.max_tokens,
                    seed:          (config.seed !== -1 && config.seed != null) ? config.seed : undefined,
                    stop:          config.stop?.length ? config.stop : undefined,
                },
            }),
        });

        if (!ollamaRes.ok) {
            cleanup();
            res.write(`data: ${JSON.stringify({ error: `Ollama: ${ollamaRes.status} — ${await ollamaRes.text()}` })}\n\n`);
            res.end();
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
                            res.write(`data: ${JSON.stringify({ delta: before, done: false })}\n\n`);
                        }
                        const endIdx = delta.indexOf("</think>", startIdx);
                        if (endIdx !== -1) { delta = delta.slice(endIdx + 8); }
                        else { inThink = true; delta = ""; }
                    }

                    if (delta) {
                        fullContent += delta;
                        res.write(`data: ${JSON.stringify({ delta, done: false })}\n\n`);
                    }
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
        res.end();
    } catch (err) {
        cleanup();
        if (err?.name === "AbortError") {
            // Cliente desconectou (ou o stream travou): persiste o parcial e encerra.
            if (fullContent) { try { await onDone(fullContent, rawContent); } catch { /* já estamos encerrando */ } }
            if (!clientGone) {
                try {
                    res.write(`data: ${JSON.stringify({ error: "Geração interrompida — o Ollama parou de responder." })}\n\n`);
                    res.end();
                } catch { /* conexão já fechada */ }
            }
            return;
        }
        throw err;
    }
}
