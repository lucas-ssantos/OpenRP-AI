import { Router } from "express";
import {
    getCharacter, getPersona,
    getConversation, addMessage, updateMessage, rollbackConversation,
    getLastMessage, deleteMessage, getLastNMessages,
    getAllLorebooks, getMemories, addAffectionPoints,
} from "../../services/database/queries.js";
import { buildPromptMessages } from "../promptBuilder.js";
import { resolveConfig, dynamicMaxTokens, withThinkingBudget, startSSE, handleSSEError, streamOllama, trimToLastSentence } from "./helpers.js";
import { getEffectiveAffection, computeAffectionGain } from "../affection.js";
import { getMemoriesForPrompt, processMemoryBacklogIfDue } from "../memory/index.js";
import { logConversationTurn } from "../logger.js";
import { isGenerating, beginGeneration, attachSubscriber, detachSubscriber, broadcast } from "./generationManager.js";

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

        // Uma geração por conversa por vez — evita duas respostas concorrentes
        // pisando na mesma posição/mensagem.
        if (isGenerating(conversationId)) {
            return res.status(409).json({ ok: false, message: "Já existe uma resposta sendo gerada para esta conversa." });
        }

        const persona    = getPersona();
        const config     = resolveConfig(conversationId);

        const recentMsgs = getLastNMessages(conversationId, config.num_ctx_messages || 20);
        const memories   = getMemoriesForPrompt(conversationId, { userMessage: content.trim(), recentMessages: recentMsgs });
        const lorebooks  = getAllLorebooks(conv.character_id);

        // Afeto: cada mensagem do usuário rende pontos ao personagem (compartilhados
        // entre todas as conversas dele). O prompt já reflete o nível novo, mas os
        // pontos só são persistidos se a geração produzir resposta — falha de Ollama
        // não pontua. Com affection_override ativo o estágio é fixo, mas os pontos
        // seguem acumulando para quando voltar ao modo automático.
        const gained        = computeAffectionGain(content);
        const prevAffection = getEffectiveAffection(character);
        const affection     = getEffectiveAffection(character, gained);

        const ollamaMessages = buildPromptMessages({
            character, persona, conversation: conv,
            historyMessages: recentMsgs,
            userMessage: content.trim(),
            memories, lorebooks, affection,
            thinkingEnabled: config.think === true,
        });

        // position null → MAX(position)+1 calculado no SQL (sem corrida entre requisições)
        const userMsgId = addMessage(conversationId, "user", content.trim());
        const gen = beginGeneration(conversationId);

        const sendConfig = { ...config, max_tokens: dynamicMaxTokens(content.trim(), config) };

        startSSE(res);
        attachSubscriber(conversationId, res);
        res.on("close", () => detachSubscriber(conversationId, res));

        let turnSaved = false;
        // A geração roda independente desta conexão: se o cliente desconectar
        // (troca de página, tela apagou), ela continua e persiste no banco —
        // ver generationManager.js e GET /conversations/:id/generation.
        await streamOllama(conversationId, gen, ollamaMessages, sendConfig, async (fullContent, rawContent, rawThinking, asstMsgId) => {
            const savedContent = trimToLastSentence(fullContent, config.max_response_chars);
            if (asstMsgId) {
                if (savedContent) updateMessage(asstMsgId, savedContent);
                else deleteMessage(asstMsgId);
            }
            turnSaved = !!fullContent;
            if (turnSaved) addAffectionPoints(conv.character_id, gained);

            logConversationTurn({
                conversationId,
                character,
                model: sendConfig.model,
                messages: ollamaMessages,
                rawResponse: rawContent,
                filteredResponse: fullContent,
                thinking: rawThinking,
                allMemories: getMemories(conversationId),
                allLorebooks: lorebooks,
            });

            return { message_id: asstMsgId, user_message_id: userMsgId };
        }, {
            afterDone: async () => {
                // Roda após o evento done — o input do usuário já foi liberado no frontend
                if (!turnSaved) return;

                broadcast(conversationId, {
                    type: "affection",
                    ...affection,
                    leveled_up: affection.level > prevAffection.level,
                });

                const counts = await processMemoryBacklogIfDue(conversationId, {
                    character, persona, config,
                    onStart: () => broadcast(conversationId, { type: "memory_processing" }),
                });
                if (counts) {
                    broadcast(conversationId, { type: "memories_created", auto: counts.auto, pinned: counts.pinned });
                }
            },
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

        if (isGenerating(conversationId)) {
            return res.status(409).json({ ok: false, message: "Já existe uma resposta sendo gerada para esta conversa." });
        }

        // Só remove a última resposta se ela for de fato a ÚLTIMA mensagem da
        // conversa — se a última for do usuário (ex.: geração anterior falhou),
        // nada é apagado e a nova resposta entra no fim, sem reordenar o histórico.
        const lastMsg = getLastMessage(conversationId);
        if (!lastMsg) return res.status(400).json({ ok: false, message: "Nenhuma mensagem para regenerar." });

        let insertPos = null; // null → MAX(position)+1 no insert
        if (lastMsg.role === "assistant") {
            deleteMessage(lastMsg.id);
            insertPos = lastMsg.position;
        }

        const persona    = getPersona();
        const config     = resolveConfig(conversationId);

        const recentMsgs = getLastNMessages(conversationId, config.num_ctx_messages || 20);
        const lastUser   = [...recentMsgs].reverse().find(m => m.role === "user");
        const memories   = getMemoriesForPrompt(conversationId, { userMessage: lastUser?.content ?? '', recentMessages: recentMsgs });
        const lorebooks  = getAllLorebooks(conv.character_id);

        const ollamaMessages = buildPromptMessages({
            character, persona, conversation: conv,
            historyMessages: recentMsgs,
            userMessage: null,
            memories, lorebooks,
            affection: getEffectiveAffection(character),
            thinkingEnabled: config.think === true,
        });

        const regenConfig  = { ...config, max_tokens: lastUser ? dynamicMaxTokens(lastUser.content, config) : withThinkingBudget((config.min_tokens ?? 60) * 2, config) };
        const gen = beginGeneration(conversationId);

        startSSE(res);
        attachSubscriber(conversationId, res);
        res.on("close", () => detachSubscriber(conversationId, res));

        await streamOllama(conversationId, gen, ollamaMessages, regenConfig, async (fullContent, rawContent, rawThinking, asstMsgId) => {
            const savedContent = trimToLastSentence(fullContent, config.max_response_chars);
            if (asstMsgId) {
                if (savedContent) updateMessage(asstMsgId, savedContent);
                else deleteMessage(asstMsgId);
            }

            logConversationTurn({
                conversationId,
                character,
                model: regenConfig.model,
                messages: ollamaMessages,
                rawResponse: rawContent,
                filteredResponse: fullContent,
                thinking: rawThinking,
                allMemories: getMemories(conversationId),
                allLorebooks: lorebooks,
                isRegen: true,
            });

            return { message_id: asstMsgId };
        }, { insertPosition: insertPos });
    } catch (err) {
        handleSSEError(res, err, "Regenerate error");
    }
});

// ── PATCH /api/conversations/:id/messages/:msgId ─────────────────────────────
router.patch("/conversations/:id/messages/:msgId", (req, res) => {
    try {
        const { content } = req.body;
        if (!content?.trim()) return res.status(400).json({ ok: false, message: "Conteúdo não pode ser vazio." });
        const updated = updateMessage(req.params.msgId, content.trim(), req.params.id);
        if (!updated) return res.status(404).json({ ok: false, message: "Mensagem não encontrada nesta conversa." });
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
