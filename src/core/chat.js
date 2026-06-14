import { Router } from "express";
import {
    getCharacter, getPersona, getGenerationConfig,
    createConversation, getConversation, getLatestConversationForCharacter,
    addMessage, updateMessage, rollbackConversation, deleteLastAssistantMessage,
    getConversationMessages, getLastNMessages,
    getMemories, getAllLorebooks,
} from "../services/database/queries.js";
import { buildPromptMessages } from "./promptBuilder.js";
import { appConfig } from "../config.js";

const OLLAMA_URL = appConfig.ollama.chatEndpoint;
const DEFAULT_CONFIG = { ...appConfig.defaults };

function resolveConfig(characterId) {
    const globalConfig = getGenerationConfig("global");
    const charConfig = getGenerationConfig("character", characterId);
    return { ...DEFAULT_CONFIG, ...globalConfig, ...(charConfig?.model ? charConfig : {}) };
}

// Estimates token count from text (heuristic: ~1.3 tokens per word)
function estimateTokens(text) {
    return Math.ceil(text.trim().split(/\s+/).length * 1.3);
}

// Returns a max_tokens value proportional to the user message length.
// When max_tokens <= 0 (i.e. -1), passes -1 through to Ollama (natural stop).
// Dynamic capping only applies when the user sets a positive max_tokens ceiling.
function dynamicMaxTokens(userMessage, config) {
    if (!config.max_tokens || config.max_tokens <= 0) return -1;
    const FLOOR = config.min_tokens ?? 60;
    const CEILING = config.max_tokens;
    const RATIO = 1.4;
    return Math.max(FLOOR, Math.min(CEILING, Math.ceil(estimateTokens(userMessage) * RATIO)));
}


function startSSE(res) {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    res.flushHeaders();
}

function handleSSEError(res, err, label) {
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

// Streams Ollama response as SSE. onDone(fullContent) is called synchronously when streaming
// finishes; it should persist the message and return extra fields for the done event.
async function streamOllama(res, messages, config, onDone) {
    const ollamaRes = await fetch(OLLAMA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: config.model,
            messages,
            stream: true,
            think: false,
            options: {
                temperature: config.temperature,
                top_p: config.top_p,
                top_k: config.top_k,
                min_p: config.min_p,
                repeat_penalty: config.repeat_penalty,
                repeat_last_n: config.repeat_last_n,
                num_ctx: config.context_size,
                num_predict: config.max_tokens,
                seed: (config.seed !== -1 && config.seed != null) ? config.seed : undefined,
                stop: config.stop?.length ? config.stop : undefined,
            },
        }),
    });

    if (!ollamaRes.ok) {
        res.write(`data: ${JSON.stringify({ error: `Ollama: ${ollamaRes.status} — ${await ollamaRes.text()}` })}\n\n`);
        res.end();
        return;
    }

    let fullContent = "";
    let inThink = false;
    const reader = ollamaRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

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
                let delta = parsed.message.content;

                if (inThink) {
                    const endIdx = delta.indexOf("</think>");
                    if (endIdx !== -1) { inThink = false; delta = delta.slice(endIdx + 8); }
                    else continue;
                }

                while (delta.includes("<think>")) {
                    const startIdx = delta.indexOf("<think>");
                    const before = delta.slice(0, startIdx);
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
                const extra = onDone(fullContent);
                res.write(`data: ${JSON.stringify({ delta: "", done: true, ...extra })}\n\n`);
                res.end();
                return;
            }
        }
    }

    // Fallback if stream ended without a parsed.done event
    if (fullContent) {
        const extra = onDone(fullContent);
        res.write(`data: ${JSON.stringify({ delta: "", done: true, ...extra })}\n\n`);
    }
    res.end();
}

const router = Router();

// ── GET /api/characters/:id/conversation ─────────────────────────────────────
router.get("/characters/:id/conversation", (req, res) => {
    try {
        const character = getCharacter(req.params.id);
        if (!character) return res.status(404).json({ ok: false, message: "Personagem não encontrado." });

        let conv = getLatestConversationForCharacter(req.params.id);
        if (conv) return res.json({ ok: true, conversation: conv, is_new: false });

        const persona = getPersona();
        const convId = createConversation(req.params.id, persona?.name || null, `Chat com ${character.name}`);

        if (character.first_message) {
            const userName = persona?.name || "você";
            addMessage(convId, "assistant", character.first_message.replace(/\{\{user\}\}/gi, userName), 0);
        }

        conv = getConversation(convId);
        res.json({ ok: true, conversation: conv, is_new: true });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

// ── POST /api/conversations ───────────────────────────────────────────────────
router.post("/conversations", (req, res) => {
    try {
        const { character_id, title } = req.body;
        if (!character_id) return res.status(400).json({ ok: false, message: "character_id é obrigatório." });

        const character = getCharacter(character_id);
        if (!character) return res.status(404).json({ ok: false, message: "Personagem não encontrado." });

        const persona = getPersona();
        const convId = createConversation(character_id, persona?.name || null, title || `Chat com ${character.name}`);

        if (character.first_message) {
            const userName = persona?.name || "você";
            addMessage(convId, "assistant", character.first_message.replace(/\{\{user\}\}/gi, userName), 0);
        }

        res.json({ ok: true, id: convId });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

// ── GET /api/conversations/:id ────────────────────────────────────────────────
router.get("/conversations/:id", (req, res) => {
    try {
        const conv = getConversation(req.params.id);
        if (!conv) return res.status(404).json({ ok: false, message: "Conversa não encontrada." });
        res.json({ ok: true, conversation: conv });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

// ── GET /api/conversations/:id/messages ──────────────────────────────────────
router.get("/conversations/:id/messages", (req, res) => {
    try {
        res.json({ ok: true, messages: getConversationMessages(req.params.id) });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

// ── POST /api/conversations/:id/messages (streaming) ─────────────────────────
router.post("/conversations/:id/messages", async (req, res) => {
    const conversationId = req.params.id;
    try {
        const { content } = req.body;
        if (!content?.trim()) return res.status(400).json({ ok: false, message: "Conteúdo da mensagem é obrigatório." });

        const conv = getConversation(conversationId);
        if (!conv) return res.status(404).json({ ok: false, message: "Conversa não encontrada." });

        const character = getCharacter(conv.character_id);
        if (!character) return res.status(404).json({ ok: false, message: "Personagem não encontrado." });

        const persona = getPersona();
        const config = resolveConfig(conv.character_id);
        const charConfig = getGenerationConfig("character", conv.character_id);

        const recentMsgs = getLastNMessages(conversationId, config.num_ctx_messages || 20);
        const memories = getMemories(conversationId);
        const lorebooks = getAllLorebooks(conv.character_id);

        const ollamaMessages = buildPromptMessages({
            character,
            persona,
            charConfig,
            historyMessages: recentMsgs,
            userMessage: content.trim(),
            memories,
            lorebooks,
        });

        const nextPos = recentMsgs.length > 0
            ? (recentMsgs[recentMsgs.length - 1].position ?? recentMsgs.length) + 1
            : 1;
        const userMsgId = addMessage(conversationId, "user", content.trim(), nextPos);

        const sendConfig = { ...config, max_tokens: dynamicMaxTokens(content.trim(), config) };

        startSSE(res);
        await streamOllama(res, ollamaMessages, sendConfig, (fullContent) => {
            const asstMsgId = fullContent ? addMessage(conversationId, "assistant", fullContent, nextPos + 1) : null;
            return { message_id: asstMsgId, user_message_id: userMsgId };
        });
    } catch (err) {
        handleSSEError(res, err, "Chat error");
    }
});

// ── POST /api/conversations/:id/regenerate ────────────────────────────────────
router.post("/conversations/:id/regenerate", async (req, res) => {
    const conversationId = req.params.id;
    try {
        const conv = getConversation(conversationId);
        if (!conv) return res.status(404).json({ ok: false, message: "Conversa não encontrada." });

        const character = getCharacter(conv.character_id);
        if (!character) return res.status(404).json({ ok: false, message: "Personagem não encontrado." });

        const deleted = deleteLastAssistantMessage(conversationId);
        if (!deleted) return res.status(400).json({ ok: false, message: "Nenhuma mensagem do personagem para regenerar." });

        const persona = getPersona();
        const config = resolveConfig(conv.character_id);
        const charConfig = getGenerationConfig("character", conv.character_id);

        const recentMsgs = getLastNMessages(conversationId, config.num_ctx_messages || 20);
        const memories = getMemories(conversationId);
        const lorebooks = getAllLorebooks(conv.character_id);

        const ollamaMessages = buildPromptMessages({
            character,
            persona,
            charConfig,
            historyMessages: recentMsgs,
            userMessage: null,
            memories,
            lorebooks,
        });

        const lastUserMsg = [...recentMsgs].reverse().find(m => m.role === "user");
        const regenConfig = { ...config, max_tokens: lastUserMsg ? dynamicMaxTokens(lastUserMsg.content, config) : (config.min_tokens ?? 60) * 2 };

        startSSE(res);
        await streamOllama(res, ollamaMessages, regenConfig, (fullContent) => {
            const asstMsgId = fullContent ? addMessage(conversationId, "assistant", fullContent, deleted.position) : null;
            return { message_id: asstMsgId };
        });
    } catch (err) {
        handleSSEError(res, err, "Regenerate error");
    }
});

// ── PATCH /api/conversations/:id/messages/:msgId ─────────────────────────────
router.patch("/conversations/:id/messages/:msgId", (req, res) => {
    try {
        const { content } = req.body;
        if (!content?.trim()) return res.status(400).json({ ok: false, message: "Conteúdo não pode ser vazio." });
        updateMessage(req.params.msgId, content.trim());
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

// ── DELETE /api/conversations/:id/rollback ────────────────────────────────────
router.delete("/conversations/:id/rollback", (req, res) => {
    try {
        const { messageId } = req.body;
        if (!messageId) return res.status(400).json({ ok: false, message: "messageId é obrigatório." });
        const ok = rollbackConversation(req.params.id, messageId);
        if (!ok) return res.status(404).json({ ok: false, message: "Mensagem não encontrada." });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

export default router;
