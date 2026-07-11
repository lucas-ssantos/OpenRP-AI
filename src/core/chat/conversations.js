import { Router } from "express";
import {
    getCharacter, getPersona,
    createConversation, getConversation, getConversationsForCharacter,
    addMessage, getConversationMessages, resetConversation,
    getConversationModel, setConversationModel,
} from "../../services/database/queries.js";
import { resolveConfig } from "./helpers.js";
import { getAffectionLevel } from "../affection.js";
import { extractAndSaveMemories } from "../memory/index.js";

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
        res.json({ ok: true, conversation: conv, affection: getAffectionLevel(character?.affection_points ?? 0) });
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

// ── GET /api/conversations/:id/model ─────────────────────────────────────────
// Retorna o override de modelo da conversa (ou null) e o modelo herdado (global/personagem).
router.get("/conversations/:id/model", (req, res) => {
    try {
        const conv = getConversation(req.params.id);
        if (!conv) return res.status(404).json({ ok: false, message: "Conversa não encontrada." });
        res.json({
            ok: true,
            model: getConversationModel(req.params.id),
            inherited_model: resolveConfig(conv.character_id).model,
        });
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
        res.json({ ok: true, first_message: firstMsg, affection: getAffectionLevel(character?.affection_points ?? 0) });
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
        const config    = resolveConfig(conv.character_id, req.params.id);

        const result = await extractAndSaveMemories(req.params.id, messages, { character, persona, config });
        if (result === null) return res.status(502).json({ ok: false, message: "Falha ao gerar memórias — verifique o Ollama." });
        res.json({ ok: true, created: result.auto.length + result.pinned.length, pinned: result.pinned.length });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

export default router;
