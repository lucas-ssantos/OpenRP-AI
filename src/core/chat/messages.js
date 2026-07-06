import { Router } from "express";
import {
    getCharacter, getPersona, getGenerationConfig,
    getConversation, addMessage, updateMessage, rollbackConversation,
    deleteLastAssistantMessage, getLastNMessages,
    getAllLorebooks, getMemories,
} from "../../services/database/queries.js";
import { buildPromptMessages } from "../promptBuilder.js";
import { resolveConfig, dynamicMaxTokens, startSSE, handleSSEError, streamOllama, trimToLastSentence } from "./helpers.js";
import { getMemoriesForPrompt, processMemoryBacklogIfDue } from "../memory/index.js";
import { logConversationTurn } from "../logger.js";

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
        const config     = resolveConfig(conv.character_id, conversationId);
        const charConfig = getGenerationConfig("character", conv.character_id);

        const recentMsgs = getLastNMessages(conversationId, config.num_ctx_messages || 20);
        const memories   = getMemoriesForPrompt(conversationId, { userMessage: content.trim(), recentMessages: recentMsgs });
        const lorebooks  = getAllLorebooks(conv.character_id);

        const ollamaMessages = buildPromptMessages({
            character, persona, conversation: conv, charConfig,
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
        let turnSaved = false;
        await streamOllama(res, ollamaMessages, sendConfig, async (fullContent, rawContent) => {
            const savedContent = trimToLastSentence(fullContent, config.max_response_chars);
            const asstMsgId = savedContent ? addMessage(conversationId, "assistant", savedContent, nextPos + 1) : null;
            turnSaved = !!fullContent;

            logConversationTurn({
                conversationId,
                character,
                model: sendConfig.model,
                messages: ollamaMessages,
                rawResponse: rawContent,
                filteredResponse: fullContent,
                allMemories: getMemories(conversationId),
                allLorebooks: lorebooks,
            });

            return { message_id: asstMsgId, user_message_id: userMsgId };
        }, async (res) => {
            // Roda após o evento done — o input do usuário já foi liberado no frontend
            if (!turnSaved) return;
            const counts = await processMemoryBacklogIfDue(conversationId, {
                character, persona, config,
                onStart: () => res.write(`data: ${JSON.stringify({ type: "memory_processing" })}\n\n`),
            });
            if (counts) {
                res.write(`data: ${JSON.stringify({ type: "memories_created", auto: counts.auto, pinned: counts.pinned })}\n\n`);
            }
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
        const config     = resolveConfig(conv.character_id, conversationId);
        const charConfig = getGenerationConfig("character", conv.character_id);

        const recentMsgs = getLastNMessages(conversationId, config.num_ctx_messages || 20);
        const lastUser   = [...recentMsgs].reverse().find(m => m.role === "user");
        const memories   = getMemoriesForPrompt(conversationId, { userMessage: lastUser?.content ?? '', recentMessages: recentMsgs });
        const lorebooks  = getAllLorebooks(conv.character_id);

        const ollamaMessages = buildPromptMessages({
            character, persona, conversation: conv, charConfig,
            historyMessages: recentMsgs,
            userMessage: null,
            memories, lorebooks,
        });

        const regenConfig  = { ...config, max_tokens: lastUser ? dynamicMaxTokens(lastUser.content, config) : (config.min_tokens ?? 60) * 2 };

        startSSE(res);
        await streamOllama(res, ollamaMessages, regenConfig, async (fullContent, rawContent) => {
            const savedContent = trimToLastSentence(fullContent, config.max_response_chars);
            const asstMsgId = savedContent ? addMessage(conversationId, "assistant", savedContent, deleted.position) : null;

            logConversationTurn({
                conversationId,
                character,
                model: regenConfig.model,
                messages: ollamaMessages,
                rawResponse: rawContent,
                filteredResponse: fullContent,
                allMemories: getMemories(conversationId),
                allLorebooks: lorebooks,
                isRegen: true,
            });

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
