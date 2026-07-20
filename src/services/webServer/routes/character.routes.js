import { Router } from "express";
import fs from "fs";
import path from "path";
import {
    addCharacterImages,
    createCharacter,
    deleteCharacterImage,
    getAllCharacters,
    getCharacter,
    getCharacterImages,
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

function decodeAndValidateAvatar(base64Data, filename) {
    const buffer = Buffer.from(base64Data, "base64");
    if (buffer.length > MAX_AVATAR_BYTES) {
        throw new Error("Imagem muito grande — cada imagem deve ter no máximo 8MB.");
    }
    const type = detectImageType(buffer);
    if (!type) {
        throw new Error("Arquivo de imagem inválido — envie imagens PNG, JPEG, WebP ou GIF.");
    }
    const base = path.basename(filename || "avatar", path.extname(filename || ""))
        .replace(/[^a-zA-Z0-9._-]/g, "_");
    return { buffer, type, base };
}

// Decodifica, valida e grava os uploads. Valida TODOS antes de gravar qualquer
// um (falha no meio do lote não deixa arquivos órfãos). Retorna as URLs públicas
// ou lança com mensagem amigável para a rota devolver 400.
function saveAvatarUploads(uploadDir, uploads) {
    const validated = uploads.map((u) => decodeAndValidateAvatar(u.data, u.filename));
    return validated.map((v, i) => {
        const safeName = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}-${v.base}.${v.type}`;
        fs.writeFileSync(path.join(uploadDir, safeName), v.buffer);
        return `/assets/uploads/${safeName}`;
    });
}

// Normaliza o body: aceita o novo formato `avatar_uploads: [{data, filename}]`
// e o legado `avatar_upload`/`avatar_filename` (singular).
function collectUploads(body) {
    if (Array.isArray(body.avatar_uploads)) {
        return body.avatar_uploads
            .filter((u) => u && typeof u.data === "string" && u.data)
            .map((u) => ({ data: u.data, filename: u.filename }));
    }
    if (body.avatar_upload) {
        return [{ data: body.avatar_upload, filename: body.avatar_filename }];
    }
    return [];
}

function deleteUploadedFile(uploadDir, url) {
    if (typeof url !== "string" || !url.startsWith("/assets/uploads/")) return;
    try { fs.unlinkSync(path.join(uploadDir, path.basename(url))); } catch { /* já removido */ }
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
            const { name, description, personality, likes, dislikes, avatar_link } = req.body;
            if (!name) return res.status(400).json({ ok: false, message: "O nome do personagem é obrigatório." });

            let imageUrls;
            try {
                imageUrls = saveAvatarUploads(uploadDir, collectUploads(req.body));
            } catch (e) {
                return res.status(400).json({ ok: false, message: e.message });
            }
            if (avatar_link) imageUrls.push(avatar_link);
            if (imageUrls.length === 0) {
                return res.status(400).json({ ok: false, message: "Envie ao menos uma imagem ou um link de avatar." });
            }

            // A primeira imagem é o avatar principal (cards, sidebar, header do chat)
            const characterId = createCharacter(
                name,
                description || "",
                personality || "",
                imageUrls[0],
                likes || null,
                dislikes || null
            );
            addCharacterImages(characterId, imageUrls);

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
            character.images = getCharacterImages(character.id);
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

            const { name, description, personality, likes, dislikes, avatar_link, affection_override, remove_image_ids } = req.body;

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

            const uploads = collectUploads(req.body);
            const currentImages = getCharacterImages(id);
            const removeIds = Array.isArray(remove_image_ids)
                ? remove_image_ids.filter((rid) => currentImages.some((img) => img.id === rid))
                : [];

            // Valida antes de gravar qualquer arquivo: a galeria não pode ficar vazia.
            const finalCount = currentImages.length - removeIds.length + uploads.length + (avatar_link ? 1 : 0);
            const touchesImages = removeIds.length > 0 || uploads.length > 0 || Boolean(avatar_link);
            if (touchesImages && finalCount === 0) {
                return res.status(400).json({ ok: false, message: "O personagem precisa de ao menos uma imagem." });
            }

            let newUrls;
            try {
                newUrls = saveAvatarUploads(uploadDir, uploads);
            } catch (e) {
                return res.status(400).json({ ok: false, message: e.message });
            }
            if (avatar_link) newUrls.push(avatar_link);

            for (const rid of removeIds) {
                const removedUrl = deleteCharacterImage(id, rid);
                deleteUploadedFile(uploadDir, removedUrl);
            }
            if (newUrls.length) addCharacterImages(id, newUrls);

            // Avatar principal acompanha a primeira imagem da galeria.
            let avatarUrl;
            if (touchesImages) {
                const images = getCharacterImages(id);
                avatarUrl = images.length ? images[0].url : undefined;
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
