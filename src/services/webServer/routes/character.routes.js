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
import { AFFECTION_LEVELS } from "../../../core/affection.js";

const publicPath = path.resolve(process.cwd(), "public");

// O arquivo vai parar em public/ e é servido pelo Express — sem validação de
// tipo, um .html/.svg enviado como "avatar" viraria página executável (XSS).
// A extensão vem do tipo real detectado (magic bytes), nunca do nome enviado.
const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

function detectImageType(buffer) {
    if (buffer.length < 12) return null;
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "png";
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
    if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
    if (buffer.toString("ascii", 0, 4) === "GIF8") return "gif";
    return null;
}

// Decodifica, valida e grava o avatar. Retorna a URL pública ou lança com
// mensagem amigável para a rota devolver 400.
function saveAvatarUpload(uploadDir, base64Data, filename) {
    const buffer = Buffer.from(base64Data, "base64");
    if (buffer.length > MAX_AVATAR_BYTES) {
        throw new Error("Imagem muito grande — o avatar deve ter no máximo 8MB.");
    }
    const type = detectImageType(buffer);
    if (!type) {
        throw new Error("Arquivo de avatar inválido — envie uma imagem PNG, JPEG, WebP ou GIF.");
    }
    const base = path.basename(filename || "avatar", path.extname(filename || ""))
        .replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeName = `${Date.now()}-${base}.${type}`;
    fs.writeFileSync(path.join(uploadDir, safeName), buffer);
    return `/assets/uploads/${safeName}`;
}

export default function characterRouter(uploadDir) {
    const router = Router();

    router.get("/character/new", (_req, res) => {
        res.sendFile(path.join(publicPath, "new-character.html"));
    });

    router.get("/character/:id/edit", (_req, res) => {
        res.sendFile(path.join(publicPath, "edit-character.html"));
    });

    // Página do personagem: lista de conversas + criação de nova conversa.
    router.get("/character/:id", (_req, res) => {
        res.sendFile(path.join(publicPath, "conversations.html"));
    });

    // Escala de afeição — usada pelo select de override na edição de personagem.
    router.get("/api/affection/levels", (_req, res) => {
        res.json({ ok: true, levels: AFFECTION_LEVELS });
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
            const { name, description, personality, likes, dislikes, avatar_link, avatar_upload, avatar_filename } = req.body;
            if (!name) return res.status(400).json({ ok: false, message: "O nome do personagem é obrigatório." });

            let avatarUrl = null;

            if (avatar_upload) {
                try {
                    avatarUrl = saveAvatarUpload(uploadDir, avatar_upload, avatar_filename);
                } catch (e) {
                    return res.status(400).json({ ok: false, message: e.message });
                }
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
                likes || null,
                dislikes || null
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

            const { name, description, personality, likes, dislikes, avatar_link, avatar_upload, avatar_filename, affection_override } = req.body;

            if (name !== undefined && !name.trim()) {
                return res.status(400).json({ ok: false, message: "O nome do personagem não pode ser vazio." });
            }

            // Override de afeição: null = automático; senão precisa ser um nível válido.
            if (affection_override !== undefined && affection_override !== null) {
                const lvl = Number(affection_override);
                if (!Number.isInteger(lvl) || lvl < 0 || lvl >= AFFECTION_LEVELS.length) {
                    return res.status(400).json({ ok: false, message: "Estágio de afeição inválido." });
                }
            }

            let avatarUrl;
            if (avatar_upload) {
                try {
                    avatarUrl = saveAvatarUpload(uploadDir, avatar_upload, avatar_filename);
                } catch (e) {
                    return res.status(400).json({ ok: false, message: e.message });
                }
            } else if (avatar_link) {
                avatarUrl = avatar_link;
            }

            updateCharacter(id, {
                name:          name          !== undefined ? name.trim()          : undefined,
                description:   description   !== undefined ? description           : undefined,
                personality:   personality   !== undefined ? personality           : undefined,
                likes:         likes         !== undefined ? likes                 : undefined,
                dislikes:      dislikes      !== undefined ? dislikes              : undefined,
                avatar_url:    avatarUrl,
                affection_override: affection_override !== undefined
                    ? (affection_override === null ? null : Number(affection_override))
                    : undefined,
            });

            res.json({ ok: true, id });
        } catch (err) {
            res.status(500).json({ ok: false, message: err.message });
        }
    });

    return router;
}
