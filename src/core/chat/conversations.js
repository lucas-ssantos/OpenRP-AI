import { Router } from "express";
import {
    getCharacter, getPersona,
    createConversation, getConversation, getLatestConversationForCharacter,
    addMessage, getConversationMessages,
} from "../../services/database/queries.js";

const router = Router();

// ── GET /api/characters/:id/conversation ─────────────────────────────────────
router.get("/characters/:id/conversation", (req, res) => {
    try {
        const character = getCharacter(req.params.id);
        if (!character) return res.status(404).json({ ok: false, message: "Personagem não encontrado." });

        let conv = getLatestConversationForCharacter(req.params.id);
        if (conv) return res.json({ ok: true, conversation: conv, is_new: false });

        const persona = getPersona();
        const convId  = createConversation(req.params.id, persona?.name || null, `Chat com ${character.name}`);

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
        const convId  = createConversation(character_id, persona?.name || null, title || `Chat com ${character.name}`);

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

export default router;
