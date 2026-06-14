import { Router } from "express";
import fs from "fs";
import path from "path";
import {
    createCharacter,
    getAllCharacters,
    getCharacter,
    getRecentCharactersWithConversations,
    updateCharacter,
} from "../../database/queries.js";

const publicPath = path.resolve(process.cwd(), "public");

export default function characterRouter(uploadDir) {
    const router = Router();

    router.get("/character/new", (_req, res) => {
        res.sendFile(path.join(publicPath, "new-character.html"));
    });

    router.get("/character/:id/edit", (_req, res) => {
        res.sendFile(path.join(publicPath, "edit-character.html"));
    });

    router.get("/api/characters", (_req, res) => {
        try {
            res.json({ ok: true, characters: getAllCharacters() });
        } catch (err) {
            res.status(500).json({ ok: false, message: err.message });
        }
    });

    router.post("/api/characters", (req, res) => {
        try {
            const { name, description, personality, scenario, first_message, avatar_link, avatar_upload, avatar_filename } = req.body;
            if (!name) return res.status(400).json({ ok: false, message: "O nome do personagem é obrigatório." });

            let avatarUrl = null;

            if (avatar_upload && avatar_filename) {
                const safeName = `${Date.now()}-${avatar_filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
                const destination = path.join(uploadDir, safeName);
                fs.writeFileSync(destination, Buffer.from(avatar_upload, "base64"));
                avatarUrl = `/assets/uploads/${safeName}`;
            } else if (avatar_link) {
                avatarUrl = avatar_link;
            } else {
                return res.status(400).json({ ok: false, message: "Envie um arquivo de imagem ou um link de avatar." });
            }

            const characterId = createCharacter(
                name,
                description || "",
                personality || "",
                avatarUrl,
                scenario || null,
                first_message || null
            );

            res.json({ ok: true, id: characterId });
        } catch (err) {
            res.status(500).json({ ok: false, message: err.message });
        }
    });

    router.get("/api/characters/recent", (_req, res) => {
        try {
            res.json({ ok: true, characters: getRecentCharactersWithConversations(5) });
        } catch (err) {
            res.status(500).json({ ok: false, message: err.message });
        }
    });

    router.get("/api/characters/:id", (req, res) => {
        try {
            const character = getCharacter(req.params.id);
            if (!character) return res.status(404).json({ ok: false, message: "Personagem não encontrado." });
            res.json({ ok: true, character });
        } catch (err) {
            res.status(500).json({ ok: false, message: err.message });
        }
    });

    router.put("/api/characters/:id", (req, res) => {
        try {
            const { id } = req.params;
            const existing = getCharacter(id);
            if (!existing) return res.status(404).json({ ok: false, message: "Personagem não encontrado." });

            const { name, description, personality, scenario, first_message, avatar_link, avatar_upload, avatar_filename } = req.body;

            if (name !== undefined && !name.trim()) {
                return res.status(400).json({ ok: false, message: "O nome do personagem não pode ser vazio." });
            }

            let avatarUrl;
            if (avatar_upload && avatar_filename) {
                const safeName = `${Date.now()}-${avatar_filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
                const destination = path.join(uploadDir, safeName);
                fs.writeFileSync(destination, Buffer.from(avatar_upload, "base64"));
                avatarUrl = `/assets/uploads/${safeName}`;
            } else if (avatar_link) {
                avatarUrl = avatar_link;
            }

            updateCharacter(id, {
                name:          name          !== undefined ? name.trim()          : undefined,
                description:   description   !== undefined ? description           : undefined,
                personality:   personality   !== undefined ? personality           : undefined,
                scenario:      scenario      !== undefined ? scenario              : undefined,
                first_message: first_message !== undefined ? first_message         : undefined,
                avatar_url:    avatarUrl,
            });

            res.json({ ok: true, id });
        } catch (err) {
            res.status(500).json({ ok: false, message: err.message });
        }
    });

    return router;
}
