import { Router } from "express";
import {
    getCharacter, getPersona, getGenerationConfig,
    getConversation, addMessage, updateMessage, rollbackConversation,
    deleteLastAssistantMessage, getLastNMessages,
    getAllLorebooks,
} from "../../services/database/queries.js";
import { buildPromptMessages } from "../promptBuilder.js";
import { resolveConfig, dynamicMaxTokens, startSSE, handleSSEError, streamOllama } from "./helpers.js";
import { getMemoriesForPrompt, extractAndSavePinnedMemories } from "../memory/index.js";

const router = Router();

// ── POST /api/conversations/:id/messages (streaming) ─────────────────────────
router.post("/conversations/:id/messages", async (req, res) => {
    const conversationId = req.params.id;
    try {
        const { content } = req.body;
        if (!content?.trim()) return res.status(400).json({ ok: false, message: "Conteúdo da mensagem é obrigatório." });

        const conv = getConversation(conversationId);
        if (!conv) return res.status(404).json({ ok: false, message: "Conversa não encontrada." });

        const character  = getCharacter(conv.character_id);
        if (!character) return res.status(404).json({ ok: false, message: "Personagem não encontrado." });

        const persona    = getPersona();
        const config     = resolveConfig(conv.character_id);
        const charConfig = getGenerationConfig("character", conv.character_id);

        const recentMsgs = getLastNMessages(conversationId, config.num_ctx_messages || 20);
        const memories   = getMemoriesForPrompt(conversationId, { userMessage: content.trim(), recentMessages: recentMsgs });
        const lorebooks  = getAllLorebooks(conv.character_id);

        const ollamaMessages = buildPromptMessages({
            character, persona, charConfig,
            historyMessages: recentMsgs,
            userMessage: content.trim(),
            memories, lorebooks,
        });

        const nextPos   = recentMsgs.length > 0
            ? (recentMsgs[recentMsgs.length - 1].position ?? recentMsgs.length) + 1
            : 1;
        const userMsgId = addMessage(conversationId, "user", content.trim(), nextPos);

        const sendConfig = { ...config, max_tokens: dynamicMaxTokens(content.trim(), config) };

        startSSE(res);
        await streamOllama(res, ollamaMessages, sendConfig, async (fullContent) => {
            const asstMsgId = fullContent ? addMessage(conversationId, "assistant", fullContent, nextPos + 1) : null;

            let pinnedMemoriesCreated = 0;
            if (fullContent && nextPos % 5 === 0) {
                const msgsForExtraction = getLastNMessages(conversationId, 10);
                const created = await extractAndSavePinnedMemories(conversationId, msgsForExtraction, character, config);
                pinnedMemoriesCreated = created.length;
            }

            return {
                message_id: asstMsgId,
                user_message_id: userMsgId,
                ...(pinnedMemoriesCreated > 0 ? { pinned_memories_created: pinnedMemoriesCreated } : {}),
            };
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

        const persona    = getPersona();
        const config     = resolveConfig(conv.character_id);
        const charConfig = getGenerationConfig("character", conv.character_id);

        const recentMsgs = getLastNMessages(conversationId, config.num_ctx_messages || 20);
        const lastUser   = [...recentMsgs].reverse().find(m => m.role === "user");
        const memories   = getMemoriesForPrompt(conversationId, { userMessage: lastUser?.content ?? '', recentMessages: recentMsgs });
        const lorebooks  = getAllLorebooks(conv.character_id);

        const ollamaMessages = buildPromptMessages({
            character, persona, charConfig,
            historyMessages: recentMsgs,
            userMessage: null,
            memories, lorebooks,
        });

        const regenConfig  = { ...config, max_tokens: lastUser ? dynamicMaxTokens(lastUser.content, config) : (config.min_tokens ?? 60) * 2 };

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
