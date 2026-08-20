import { Router } from "express";
import fs from "fs";
import path from "path";

const LOG_DIR     = path.resolve(process.cwd(), "data/logs");
const publicPath  = path.resolve(process.cwd(), "public");
const router      = Router();

// Se o log de uma conversa passa disso, arquivos antigos são rotacionados para
// "*_old.log" (fora do escopo desta rota) — arquivos grandes demais para o
// navegador renderizar de uma vez recebem só a cauda por padrão; o front pode
// pedir o arquivo inteiro com ?full=1.
const DEFAULT_TAIL_BYTES = 400 * 1024;

// Arquivos rotacionados ("*_old.log", "*_old_old.log", ...) não interessam à
// visualização — são histórico substituído pelo log ativo do mesmo personagem.
function isIgnored(filename) {
    return /old/i.test(filename);
}

function resolveLogPath(rawFilename) {
    const filename = path.basename(rawFilename || "");
    if (!filename.endsWith(".log") || isIgnored(filename)) return null;

    const filepath = path.join(LOG_DIR, filename);
    if (!filepath.startsWith(LOG_DIR + path.sep)) return null; // defesa extra contra path traversal
    return { filename, filepath };
}

router.get("/logs", (_req, res) => {
    res.sendFile(path.join(publicPath, "logs.html"));
});

router.get("/api/logs", (_req, res) => {
    try {
        if (!fs.existsSync(LOG_DIR)) return res.json({ ok: true, files: [] });

        const files = fs.readdirSync(LOG_DIR)
            .filter((name) => name.endsWith(".log") && !isIgnored(name))
            .map((name) => {
                const stat = fs.statSync(path.join(LOG_DIR, name));
                return { name, size: stat.size, mtime: stat.mtime };
            })
            .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

        res.json({ ok: true, files });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

router.get("/api/logs/:filename", (req, res) => {
    try {
        const resolved = resolveLogPath(req.params.filename);
        if (!resolved || !fs.existsSync(resolved.filepath)) {
            return res.status(404).json({ ok: false, message: "Log não encontrado." });
        }

        const { filename, filepath } = resolved;
        const stat = fs.statSync(filepath);
        const size = stat.size;
        const full = req.query.full === "1";

        let content;
        let truncated = false;

        if (full || size <= DEFAULT_TAIL_BYTES) {
            content = fs.readFileSync(filepath, "utf8");
        } else {
            // Entradas são gravadas por append — a cauda do arquivo é sempre a mais recente.
            const fd  = fs.openSync(filepath, "r");
            const buf = Buffer.alloc(DEFAULT_TAIL_BYTES);
            fs.readSync(fd, buf, 0, DEFAULT_TAIL_BYTES, size - DEFAULT_TAIL_BYTES);
            fs.closeSync(fd);
            content = buf.toString("utf8");
            truncated = true;
        }

        res.json({
            ok: true,
            name: filename,
            size,
            mtime: stat.mtime,
            content,
            truncated,
        });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

router.get("/api/logs/:filename/download", (req, res) => {
    try {
        const resolved = resolveLogPath(req.params.filename);
        if (!resolved || !fs.existsSync(resolved.filepath)) {
            return res.status(404).json({ ok: false, message: "Log não encontrado." });
        }
        res.download(resolved.filepath, resolved.filename);
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

export default router;
