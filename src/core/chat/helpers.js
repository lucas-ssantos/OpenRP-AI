import fs from "fs";
import path from "path";
import { getGenerationConfig, getConversationModel, addMessage, updateMessage, deleteMessage } from "../../services/database/queries.js";
import { normalize } from "../memory/retrieval.js";
import { llamaChatBody, llamaChatEndpoint } from "../../services/llama.client.js";
import { isLocalModel } from "../../services/llama.models.js";
import { appConfig } from "../../config.js";
import { broadcast, closeGeneration } from "./generationManager.js";

// Último recurso da cadeia de fallback — carregado uma vez no boot.
let MEDIUM_SPEC = {};
try {
    MEDIUM_SPEC = JSON.parse(fs.readFileSync(
        path.join(process.cwd(), "config_recomendadas", "medium_spec.json"), "utf8"
    ));
} catch { /* sem o preset, a cadeia para nos defaults do .env */ }

// Um valor só é aceito de uma fonte se passar no validador do campo — NULL vindo
// do banco (campo deixado em branco no /settings) ou lixo nunca chega ao llama.cpp.
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
const VALIDATORS = {
    model:              (v) => typeof v === "string" && v.trim().length > 0,
    // null/vazio = usa o mesmo modelo principal (bloco INTIMATE SCENE OVERRIDE).
    affection_model:    (v) => v === null || (typeof v === "string" && v.trim().length > 0),
    // true = modelo principal revisa o rascunho do modelo de afeto.
    affection_review:   (v) => typeof v === "boolean",
    temperature:        (v) => isNum(v) && v >= 0 && v <= 2,
    top_p:              (v) => isNum(v) && v > 0 && v <= 1,
    top_k:              (v) => isInt(v) && v >= 0,
    min_p:              (v) => isNum(v) && v >= 0 && v < 1,
    repeat_penalty:     (v) => isNum(v) && v > 0,
    repeat_last_n:      (v) => isInt(v) && v >= -1,
    max_tokens:         (v) => isInt(v) && (v === -1 || v > 0),
    min_tokens:         (v) => isInt(v) && v > -1,
    // null = "contexto automático" (checkbox do /settings) — deliberado, não inválido.
    // Resolvido no start do llama-server para o contexto definido ao iniciar o processo.
    context_size:       (v) => v === null || (isInt(v) && v > 0),
    num_ctx_messages:   (v) => isInt(v) && v > 0,
    memory_interval:    (v) => isInt(v) && v > 0,
    // 0 = extração de persona facts desligada (deliberado, não inválido)
    persona_interval:   (v) => isInt(v) && v >= 0,
    seed:               (v) => isInt(v),
    stream:             (v) => typeof v === "boolean",
    stop:               (v) => Array.isArray(v),
    max_response_chars: (v) => isInt(v) && v >= 0,
    // 'off' = nunca; 'always' = todo turno; 'scoped' = só quando a cena pede
    // (ver resolveThinkingTrigger). O boolean por turno (config.think) é
    // computado nas rotas de chat — nunca vem direto de uma fonte de config.
    think_mode:         (v) => v === "off" || v === "scoped" || v === "always",
};

// Hierarquia por campo: global (banco) → defaults (.env) → medium_spec.json.
// Campo null/inválido numa fonte cai para a próxima — nunca vaza para o llama.cpp.
// Único override existente: modelo exclusivo da conversa (model-only).
export function resolveConfig(conversationId = null) {
    const sources = [getGenerationConfig(), appConfig.defaults, MEDIUM_SPEC];
    const config = {};
    for (const [key, isValid] of Object.entries(VALIDATORS)) {
        const src = sources.find((s) => s && isValid(s[key]));
        if (src) config[key] = src[key];
    }

    if (appConfig.llama.routerMode) {
        // No modo router qualquer GGUF instalado pode ser usado, inclusive o
        // override por conversa.
        if (conversationId) {
            const convModel = getConversationModel(conversationId);
            if (VALIDATORS.model(convModel) && isLocalModel(convModel)) config.model = convModel;
        }
        if (!VALIDATORS.model(config.model) || !isLocalModel(config.model)) {
            if (appConfig.llama.model) config.model = appConfig.llama.model;
        }
    } else {
        // Modo de modelo único (benchmark): o llama-server só tem um modelo.
        if (conversationId) {
            const convModel = getConversationModel(conversationId);
            if (VALIDATORS.model(convModel) && convModel === appConfig.llama.model) config.model = convModel;
        }
        if (appConfig.llama.model) config.model = appConfig.llama.model;
    }

    // Sem escolha explícita, o override de afeto usa o modelo principal.
    if (!VALIDATORS.affection_model(config.affection_model) || !isLocalModel(config.affection_model)) {
        config.affection_model = config.model;
    }
    // Configs antigas/presets sem o campo mantêm a revisão desligada.
    if (typeof config.affection_review !== "boolean") config.affection_review = false;

    return config;
}

// Início da janela de histórico visível: null = histórico completo; com o
// "novo histórico" ativo, só entram mensagens posteriores ao marco zero salvo.
export function promptHistoryStart(conversation) {
    if (!conversation?.omit_history) return null;
    return conversation.history_start_position ?? -1;
}

function estimateTokens(text) {
    return Math.ceil(text.trim().split(/\s+/).length * 1.3);
}

// ── Thinking scoped: decide por turno se o raciocínio vale o custo ───────────
// Gatilhos do modo 'scoped' — momentos onde consistência de personagem é mais
// fácil de escorregar. Palavras já normalizadas (sem acento — o texto do
// usuário passa por normalize() antes do match, então "coração" ≡ "coracao").
const EMOTIONAL_KEYWORDS = [
    "triste", "tristeza", "chorar", "chorando", "chorei", "choro",
    "medo", "assustado", "assustada", "panico",
    "amo", "amor", "apaixonado", "apaixonada", "paixao", "beijo", "beijar",
    "perdao", "perdoa", "perdoar", "desculpa", "magoou", "magoado", "magoada",
    "morrer", "morte", "morreu", "morrendo", "adeus", "despedida",
    "odeio", "odio", "raiva", "trair", "traiu", "ciume", "ciumes",
    "saudade", "sofrer", "sofrendo", "sozinho", "sozinha", "abandonar", "abandonou",
    "segredo", "confessar", "confesso", "prometo", "promessa",
    "casar", "casamento", "terminar", "separar", "sad", "sadness", "to cry", "crying", "I cried", "crying/tears",
"fear", "scared", "panic",
"I love", "love", "in love", "passion", "kiss", "to kiss",
"forgiveness", "forgive", "to forgive", "apology/sorry", "hurt (someone)", "hurt (feeling)",
"to die", "death", "died", "dying", "goodbye", "farewell",
"I hate", "hatred", "anger", "to betray", "betrayed", "jealousy",
"longing/missing someone", "to suffer", "suffering", "alone", "to abandon", "abandoned",
"secret", "to confess", "I confess", "I promise", "promise",
"to marry", "marriage/wedding", "to end (a relationship)", "to separate"
];
const EMOTIONAL_RE = new RegExp(`\\b(?:${EMOTIONAL_KEYWORDS.join("|")})\\b`, "i");

// Retorna o motivo da ativação do thinking neste turno, ou null (desativado).
// 'forced'      → force_thinking:true no body (teste manual pontual)
// 'always'      → modo always: todo turno
// 'level_up'    → a relação acabou de mudar de estágio (afeto)
// 'emotional'   → a mensagem do usuário carrega palavras emocionalmente pesadas
// 'memory_load' → 3+ memórias injetadas de uma vez — muito fato para conciliar
// O motivo vai para o log do turno — é o que permite calibrar os gatilhos depois.
export function resolveThinkingTrigger({ mode, forced = false, userMessage = "", memories = [], leveledUp = false }) {
    if (mode !== "scoped" && mode !== "always") return null;
    if (forced) return "forced";
    if (mode === "always") return "always";
    if (leveledUp) return "level_up";
    if (EMOTIONAL_RE.test(normalize(userMessage))) return "emotional";
    if (memories.length >= 3) return "memory_load";
    return null;
}

// Com thinking ativo, os tokens de raciocínio saem do mesmo num_predict que a
// resposta — sem folga, o check (por mais mínimo que a instrução THINKING peça)
// rouba espaço da resposta real. O bônus só se aplica a orçamentos positivos:
// -1 (parada natural) já não tem teto a estourar.
const THINKING_TOKEN_BONUS = 800;
export function withThinkingBudget(tokens, config) {
    if (!tokens || tokens <= 0 || config.think !== true) return tokens;
    return tokens + THINKING_TOKEN_BONUS;
}

export function dynamicMaxTokens(userMessage, config) {
    if (!config.max_tokens || config.max_tokens <= 0) {
        return -1;
    }

    return config.max_tokens;
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



async function generateDraft(messages, config, signal, model) {
    const maxTokens = Math.min(
        config.max_tokens > 0 ? config.max_tokens : 600,
        600
    );

    const response = await fetch(llamaChatEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify(llamaChatBody({
            model,
            messages,
            stream: false,
            think: config.think === true,
            options: {
                temperature: config.temperature,
                top_p: config.top_p,
                top_k: config.top_k,
                min_p: config.min_p,
                repeat_penalty: config.repeat_penalty,
                repeat_last_n: config.repeat_last_n,
                num_predict: maxTokens,
                seed: config.seed !== -1 && config.seed != null
                    ? config.seed
                    : undefined,
                stop: config.stop?.length ? config.stop : undefined,
            },
        })),
    });

    if (!response.ok) {
        throw new Error(
            `Modelo de afeto "${model}" falhou: ${response.status} — ${await response.text()}`
        );
    }

    const data = await response.json();
    const draft = data.choices?.[0]?.message?.content ?? "";

    if (!draft.trim()) {
        throw new Error(`O modelo de afeto "${model}" retornou um rascunho vazio.`);
    }

    return draft.trim();
}


// Sem nenhum chunk do llama-server por este tempo, o stream é abortado (modelo travado).
// 5 min: cobre load a frio + prompt eval de contextos grandes em hardware lento
// antes de declarar timeout.
const STREAM_STALL_TIMEOUT_MS = 300_000;

// Progresso é persistido no banco à medida que chega, e não só no final — é o
// que garante que a resposta sobrevive mesmo se ninguém estiver com o SSE
// aberto para recebê-la. Throttled para não bater no banco a cada token.
const PERSIST_THROTTLE_MS = 300;

// Gera a resposta do llama.cpp para `conversationId`, transmitindo cada delta para
// todo subscriber atualmente registrado em `gen` (ver generationManager.js) e
// persistindo o conteúdo progressivamente — a geração roda até o fim
// independentemente de haver alguém conectado ouvindo. onDone(filteredContent,
// rawContent, rawThinking, assistantMessageId, draftRawOutput) é chamado quando a geração
// termina (com sucesso ou interrompida por stall, desde que tenha gerado algo);
// deve persistir o conteúdo final (já trimado) e retornar campos extras para o
// evento `done`. opts.afterDone() roda depois do evento `done` ser transmitido
// — trabalho em background (ex.: extração de memória) que ainda pode emitir
// eventos SSE próprios sem atrasar a percepção de conclusão do cliente.
// opts.insertPosition replica a posição de uma mensagem substituída (regenerate).
export async function streamLlama(conversationId, gen, messages, config, onDone, opts = {}) {
    const hasIntimateSceneBlock = messages.some(
        (message) =>
            message.role === "system" &&
            typeof message.content === "string" &&
            message.content.includes("INTIMATE SCENE OVERRIDE")
    );

    const { afterDone = null, insertPosition = null, automated = false } = opts;

    // config.model já chega resolvido (modelo principal ou override por
    // conversa); affection_model é o modelo escolhido para o bloco íntimo.
    const mainModel = config.model;
    const affectionModel = config.affection_model || mainModel;

    if (appConfig.llama.routerMode) {
        config.model = hasIntimateSceneBlock ? affectionModel : mainModel;
    }

    const controller = new AbortController();
    gen.controller = controller; // cancelGeneration() usa isto para abortar de fora
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
            gen.assistantMessageId = addMessage(conversationId, "assistant", fullContent, insertPosition, automated);
        } else {
            updateMessage(gen.assistantMessageId, fullContent);
        }
    };

    const finish = async (errorMsg = null) => {
        cleanup();
        if (errorMsg) gen.error = errorMsg;
        persist(true);
        let extra = {};
        // No caminho de sucesso, onDone sempre roda (mesmo com fullContent vazio —
        // é o que loga/trata uma resposta vazia do llama.cpp). No caminho de stall,
        // só roda se algo chegou a ser gerado, preservando esse parcial.
        if (!errorMsg || fullContent) {
            try { extra = (await onDone(fullContent, rawContent, rawThinking, gen.assistantMessageId, draftRawOutput)) ?? {}; }
            catch (e) { console.error("streamLlama onDone error:", e); }
        }
        broadcast(conversationId, { delta: "", done: true, ...extra, ...(errorMsg ? { error: errorMsg } : {}) });
        if (!errorMsg && afterDone) { try { await afterDone(); } catch { /* trabalho pós-done não pode derrubar o stream */ } }
        closeGeneration(conversationId);
    };

    let draftRawOutput = null;
    try {
        // Supervisor de cena íntima: o modelo de afeto escreve o rascunho e o
        // modelo principal revisa. Só faz sentido no router, com modelos
        // diferentes e com a revisão ligada; caso contrário o modelo de afeto
        // (ou o principal, sem override) responde diretamente.
        if (
            appConfig.llama.routerMode &&
            hasIntimateSceneBlock &&
            config.affection_review &&
            affectionModel &&
            affectionModel !== mainModel
        ) {
            console.log(`[SUPERVISOR] Gerando rascunho com "${affectionModel}"...`);

            const draft = await generateDraft(messages, config, controller.signal, affectionModel);
            draftRawOutput = draft;

            const reviewerInstruction =
                "[FINAL RESPONSE REVIEW — HIGH PRIORITY]\n" +
                "You are editing a roleplay draft, not continuing the conversation.\n" +
                "Preserve the draft's personality, voice, tone, physical reactions, " +
                "dialogue, and established events as much as possible.\n" +
                "Correct instruction violations, especially controlling the user's " +
                "character, inventing their actions or thoughts, and adding unrelated events.\n" +
                "The final answer MUST be ONE paragraph maximum, with 2–5 sentences.\n" +
                "Keep the response concise. Do not add new plot twists or characters.\n" +
                "Do not explain your edits, provide commentary, or mention this review.\n" +
                "Output only the corrected roleplay response.";

            let reviewMessages = messages.map((message, index) =>
                index === 0 && message.role === "system"
                    ? {
                        ...message,
                        content: `${message.content}\n\n${reviewerInstruction}`,
                    }
                    : message
            );

            if (!reviewMessages.some(message => message.role === "system")) {
                reviewMessages.unshift({
                    role: "system",
                    content: reviewerInstruction,
                });
            }

            reviewMessages.push(
                {
                    role: "assistant",
                    content: draft,
                },
                {
                    role: "user",
                    content:
                        "Review and correct the assistant draft immediately above " +
                        "according to the system review instructions. Return only " +
                        "the final corrected response.",
                }
            );

            console.log(`[SUPERVISOR] Enviando rascunho ao "${mainModel}"...`);

            messages = reviewMessages;
            // Cópia local: não altera max_tokens/think do config usado depois
            // pelo log e pelos hooks de memória/persona.
            config = { ...config, model: mainModel, max_tokens: 260, think: false };
        }

        /*
        if (config.enableSupervisor !== false) {
            console.log("[SUPERVISOR] Gerando rascunho com Stheno...");

            const draft = await generateDraft(
                messages,
                config,
                controller.signal
            );

            sthenoRawOutput = draft;

            const reviewerInstruction =
                "[FINAL RESPONSE REVIEW — HIGH PRIORITY]\n" +
                "You are reviewing a draft written by another model.\n" +
                "Preserve its style, personality, tone, dialogue and established events.\n" +
                "Correct instruction violations, contradictions and unwanted control over the user's character.\n" +
                "Do not invent the user's actions, thoughts, feelings or dialogue.\n" +
                "Do not add unrelated events, characters or plot twists.\n" +
                "Respect the original conversation's instructions and formatting requirements.\n" +
                "Keep the final response concise and natural.\n" +
                "Output only the corrected response, without explanations or commentary.";

            const reviewMessages = [
                ...messages.map(message => ({ ...message })),
                {
                    role: "system",
                    content: reviewerInstruction,
                },
                {
                    role: "assistant",
                    content: draft,
                },
                {
                    role: "user",
                    content:
                        "Review the draft above against the conversation context " +
                        "and all applicable instructions. Return only the final response.",
                },
            ];

            console.log("[SUPERVISOR] Enviando rascunho ao Gemma 4...");

            messages = reviewMessages;
            config.model = "gemma4-12b";
            config.max_tokens = 700;
            config.think = false;
        }
        */

        console.log("[LLAMA REQUEST]", {
            num_predict: config.max_tokens,
            think: config.think,
            min_tokens: config.min_tokens,
            model: config.model,
        });

        resetStallTimer();
        const llamaRes = await fetch(llamaChatEndpoint(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify(llamaChatBody({
                model: config.model,
                messages,
                stream: true,
                think: config.think === true,
                options: {
                    temperature: config.temperature,
                    top_p: config.top_p,
                    top_k: config.top_k,
                    min_p: config.min_p,
                    repeat_penalty: config.repeat_penalty,
                    repeat_last_n: config.repeat_last_n,
                    num_predict: config.max_tokens,
                    seed: config.seed !== -1 && config.seed != null ? config.seed : undefined,
                    stop: config.stop?.length ? config.stop : undefined,
                },
            })),
        });

        if (!llamaRes.ok) {
            cleanup();
            gen.error = `llama.cpp: ${llamaRes.status} — ${await llamaRes.text()}`;
            closeGeneration(conversationId, { delta: "", done: true, error: gen.error });
            return;
        }

        let inThink   = false;
        const reader  = llamaRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer    = "";
        let receivedDone = false;

        const handleEvent = async (eventData) => {
            if (!eventData || eventData === "[DONE]") {
                if (eventData === "[DONE]") receivedDone = true;
                return;
            }
            let parsed;
            try { parsed = JSON.parse(eventData); }
            catch { return; }
            if (parsed.error) throw new Error(parsed.error.message || JSON.stringify(parsed.error));

            const choice = parsed.choices?.[0];
            const reasoning = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
            if (reasoning) rawThinking += reasoning;
            const raw = choice?.delta?.content;
            if (typeof raw !== "string" || !raw) return;
            rawContent += raw;

            let delta = raw;
            if (inThink) {
                const endIdx = delta.indexOf("</think>");
                if (endIdx !== -1) { inThink = false; delta = delta.slice(endIdx + 8); }
                else return;
            }

            while (delta.includes("<think>")) {
                const startIdx = delta.indexOf("<think>");
                const before = delta.slice(0, startIdx);
                if (before) {
                    fullContent += before;
                    gen.content = fullContent;
                    broadcast(conversationId, { delta: before, done: false });
                }
                const endIdx = delta.indexOf("</think>", startIdx);
                if (endIdx !== -1) delta = delta.slice(endIdx + 8);
                else { inThink = true; delta = ""; }
            }

            if (delta) {
                fullContent += delta;
                gen.content = fullContent;
                broadcast(conversationId, { delta, done: false });
            }
            persist();
        };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            resetStallTimer();

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.startsWith("data:")) continue;
                await handleEvent(line.slice(5).trimStart());
            }
            if (receivedDone) { await finish(); return; }
        }

        if (buffer.startsWith("data:")) {
            await handleEvent(buffer.slice(5).trim());
        }
        if (receivedDone) { await finish(); return; }
        // Some builds close the stream without the OpenAI-compatible [DONE] marker.
        if (fullContent) { await finish(); return; }
        cleanup();
        closeGeneration(conversationId);
    } catch (err) {
        cleanup();
        if (err?.name === "AbortError") {
            if (gen.cancelled) {
                // Pause do usuário: descarta a mensagem parcial (se já persistida
                // pelo throttle de persist()) em vez de salvá-la, e pula onDone —
                // nada de pontuar afeto ou disparar extração de memória para um
                // turno que o próprio usuário descartou.
                if (gen.assistantMessageId) deleteMessage(gen.assistantMessageId);
                closeGeneration(conversationId, { delta: "", done: true, cancelled: true });
                return;
            }
            // Stall (llama-server parou de responder): persiste o parcial e encerra.
            // Não depende mais de o cliente estar conectado — a única causa de
            // abort agora é o próprio llama-server travar.
            await finish("Geração interrompida — o llama-server parou de responder.");
            return;
        }
        console.error("streamLlama error:", err);
        gen.error = err.message;
        closeGeneration(conversationId, { delta: "", done: true, error: err.message });
    }
}
