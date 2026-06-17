import { getGenerationConfig } from "../../services/database/queries.js";
import { appConfig } from "../../config.js";

const OLLAMA_URL    = appConfig.ollama.chatEndpoint;
const DEFAULT_CONFIG = { ...appConfig.defaults };

export function resolveConfig(characterId) {
    const globalConfig = getGenerationConfig("global");
    const charConfig   = getGenerationConfig("character", characterId);
    return { ...DEFAULT_CONFIG, ...globalConfig, ...(charConfig?.model ? charConfig : {}) };
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

// Streams Ollama response as SSE. onDone(filteredContent, rawContent) is called
// when streaming finishes; it should persist the message and return extra fields for the done event.
export async function streamOllama(res, messages, config, onDone) {
    const ollamaRes = await fetch(OLLAMA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
                num_ctx:       config.context_size,
                num_predict:   config.max_tokens,
                seed:          (config.seed !== -1 && config.seed != null) ? config.seed : undefined,
                stop:          config.stop?.length ? config.stop : undefined,
            },
        }),
    });

    if (!ollamaRes.ok) {
        res.write(`data: ${JSON.stringify({ error: `Ollama: ${ollamaRes.status} — ${await ollamaRes.text()}` })}\n\n`);
        res.end();
        return;
    }

    let fullContent = "";  // filtered (without <think> blocks) — sent to SSE and saved
    let rawContent  = "";  // verbatim output from the model — used for logging
    let inThink     = false;
    const reader    = ollamaRes.body.getReader();
    const decoder   = new TextDecoder();
    let buffer      = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

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
                const extra = await onDone(fullContent, rawContent);
                res.write(`data: ${JSON.stringify({ delta: "", done: true, ...extra })}\n\n`);
                res.end();
                return;
            }
        }
    }

    // Fallback if stream ended without a parsed.done event
    if (fullContent) {
        const extra = await onDone(fullContent, rawContent);
        res.write(`data: ${JSON.stringify({ delta: "", done: true, ...extra })}\n\n`);
    }
    res.end();
}
