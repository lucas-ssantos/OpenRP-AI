import { Router } from "express";
import {
    getCharacter, getPersona,
    createConversation, getConversation, getConversationsForCharacter, updateConversation, deleteConversation,
    addMessage, getConversationMessages, resetConversation,
    getConversationModel, setConversationModel,
} from "../../services/database/queries.js";
import { resolveConfig, startSSE } from "./helpers.js";
import { getEffectiveAffection } from "../affection.js";
import { extractAndSaveMemories } from "../memory/index.js";
import { getGeneration, attachSubscriber, detachSubscriber } from "./generationManager.js";

const router = Router();

// Placeholders do first_message: {{user}} → nome da persona, {{char}} → nome do personagem.
function renderFirstMessage(template, character, persona) {
    return template
        .replace(/\{\{user\}\}/gi, persona?.name || "você")
        .replace(/\{\{char\}\}/gi, character?.name || "");
}

// ── GET /api/characters/:id/conversations ────────────────────────────────────
// Lista as conversas de um personagem (cada uma com seu cenário e mensagem inicial).
router.get("/characters/:id/conversations", (req, res) => {
    try {
        const character = getCharacter(req.params.id);
        if (!character) return res.status(404).json({ ok: false, message: "Personagem não encontrado." });

        res.json({ ok: true, conversations: getConversationsForCharacter(req.params.id) });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

// ── POST /api/conversations ───────────────────────────────────────────────────
// Cria uma nova conversa com cenário + mensagem inicial próprios.
router.post("/conversations", (req, res) => {
    try {
        const { character_id, title, scenario, first_message, model } = req.body;
        if (!character_id) return res.status(400).json({ ok: false, message: "character_id é obrigatório." });

        const character = getCharacter(character_id);
        if (!character) return res.status(404).json({ ok: false, message: "Personagem não encontrado." });

        const persona = getPersona();
        const convId  = createConversation(
            character_id,
            persona?.name || null,
            title?.trim() || `Chat com ${character.name}`,
            scenario?.trim() || null,
            first_message?.trim() || null
        );

        if (first_message?.trim()) {
            addMessage(convId, "assistant", renderFirstMessage(first_message.trim(), character, persona), 0);
        }

        // Modelo exclusivo da conversa (opcional)
        if (model?.trim()) setConversationModel(convId, model);

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
        const character = getCharacter(conv.character_id);
        res.json({ ok: true, conversation: conv, affection: getEffectiveAffection(character) });
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

// ── GET /api/conversations/:id/generation ────────────────────────────────────
// Regruda numa geração em andamento — usado quando o cliente volta a olhar a
// conversa (reload, troca de página, tela apagou e voltou) enquanto o Ollama
// ainda está respondendo. A geração roda no backend independente do cliente
// (ver generationManager.js); isto só serve para voltar a "assistir" a ela.
// 204 sem corpo = nenhuma geração ativa para esta conversa.
router.get("/conversations/:id/generation", (req, res) => {
    const conversationId = req.params.id;
    const gen = getGeneration(conversationId);
    if (!gen) return res.status(204).end();

    startSSE(res);
    // Snapshot do que já foi gerado até agora — o cliente sincroniza a bolha
    // com isso antes de continuar recebendo deltas normalmente.
    res.write(`data: ${JSON.stringify({ delta: gen.content, done: false, sync: true, message_id: gen.assistantMessageId })}\n\n`);
    attachSubscriber(conversationId, res);
    res.on("close", () => detachSubscriber(conversationId, res));
});

// ── GET /api/conversations/:id/model ─────────────────────────────────────────
// Retorna o override de modelo da conversa (ou null) e o modelo herdado (global/personagem).
router.get("/conversations/:id/model", (req, res) => {
    try {
        const conv = getConversation(req.params.id);
        if (!conv) return res.status(404).json({ ok: false, message: "Conversa não encontrada." });
        const globalConfig = resolveConfig();
        res.json({
            ok: true,
            model: getConversationModel(req.params.id),
            inherited_model: globalConfig.model,
            // null = "contexto automático" (usa o context_length real do modelo escolhido);
            // número = valor fixo travado em /settings, o mesmo para qualquer modelo.
            context_size: globalConfig.context_size,
        });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

// ── PUT /api/conversations/:id ────────────────────────────────────────────────
// Edita título, cenário e/ou mensagem inicial de uma conversa existente.
router.put("/conversations/:id", (req, res) => {
    try {
        const conv = getConversation(req.params.id);
        if (!conv) return res.status(404).json({ ok: false, message: "Conversa não encontrada." });

        const { title, scenario, first_message, model } = req.body;
        if (title !== undefined && !title.trim()) {
            return res.status(400).json({ ok: false, message: "O título não pode ser vazio." });
        }

        updateConversation(req.params.id, {
            title: title !== undefined ? title.trim() : undefined,
            scenario: scenario !== undefined ? (scenario.trim() || null) : undefined,
            first_message: first_message !== undefined ? (first_message.trim() || null) : undefined,
        });

        if (model !== undefined) setConversationModel(req.params.id, model || null);

        res.json({ ok: true, conversation: getConversation(req.params.id) });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

// ── POST /api/conversations/:id/model ────────────────────────────────────────
// Define (ou limpa, com model vazio) o modelo exclusivo da conversa.
router.post("/conversations/:id/model", (req, res) => {
    try {
        const conv = getConversation(req.params.id);
        if (!conv) return res.status(404).json({ ok: false, message: "Conversa não encontrada." });
        setConversationModel(req.params.id, req.body?.model || null);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

// ── POST /api/conversations/:id/reset ────────────────────────────────────────
router.post("/conversations/:id/reset", (req, res) => {
    try {
        const conv = getConversation(req.params.id);
        if (!conv) return res.status(404).json({ ok: false, message: "Conversa não encontrada." });

        resetConversation(req.params.id);

        const character = getCharacter(conv.character_id);
        let firstMsg = null;
        if (conv.first_message) {
            const persona = getPersona();
            const content = renderFirstMessage(conv.first_message, character, persona);
            const msgId   = addMessage(req.params.id, "assistant", content, 0);
            firstMsg = { id: msgId, role: "assistant", content };
        }

        // A afeição pertence ao personagem — resetar a conversa não a zera.
        res.json({ ok: true, first_message: firstMsg, affection: getEffectiveAffection(character) });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

// ── DELETE /api/conversations/:id ────────────────────────────────────────────
router.delete("/conversations/:id", (req, res) => {
    try {
        const conv = getConversation(req.params.id);
        if (!conv) return res.status(404).json({ ok: false, message: "Conversa não encontrada." });

        deleteConversation(req.params.id);
        res.json({ ok: true, character_id: conv.character_id });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

// ── POST /api/conversations/:id/memories/generate ────────────────────────────
router.post("/conversations/:id/memories/generate", async (req, res) => {
    try {
        const { messages } = req.body;
        if (!Array.isArray(messages) || messages.length < 2)
            return res.status(400).json({ ok: false, message: "Selecione ao menos 2 mensagens." });

        const conv = getConversation(req.params.id);
        if (!conv) return res.status(404).json({ ok: false, message: "Conversa não encontrada." });

        const character = getCharacter(conv.character_id);
        const persona   = getPersona();
        const config    = resolveConfig(req.params.id);

        const result = await extractAndSaveMemories(req.params.id, messages, { character, persona, config });
        if (result === null) return res.status(502).json({ ok: false, message: "Falha ao gerar memórias — verifique o Ollama." });
        res.json({ ok: true, created: result.auto.length + result.pinned.length, pinned: result.pinned.length });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

export default router;
