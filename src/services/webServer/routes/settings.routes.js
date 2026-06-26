import { Router } from "express";
import fs from "fs";
import path from "path";
import { getGenerationConfig, setGenerationConfig } from "../../database/queries.js";
import { appConfig } from "../../../config.js";

const publicPath = path.resolve(process.cwd(), "public");
const router = Router();

router.get("/settings", (_req, res) => {
    res.sendFile(path.join(publicPath, "settings.html"));
});

router.get("/api/presets", (_req, res) => {
    try {
        const presetsDir = path.join(process.cwd(), "config_recomendadas");
        const presets = {
            weak: {
                name: "Máquina Fraca",
                desc: "i5 7ª gen, 8GB RAM, GTX 1060 6GB",
                config: JSON.parse(fs.readFileSync(path.join(presetsDir, "low_spec.json"), "utf8")),
            },
            medium: {
                name: "Máquina Média",
                desc: "Ryzen 5 5600, 16GB RAM, RX 9060 XT 8GB",
                config: JSON.parse(fs.readFileSync(path.join(presetsDir, "medium_spec.json"), "utf8")),
            },
            strong: {
                name: "Máquina Forte",
                desc: "Ryzen 9 9800X3D, 32GB RAM, RTX 5080 16GB",
                config: JSON.parse(fs.readFileSync(path.join(presetsDir, "high_spec.json"), "utf8")),
            },
        };
        res.json({ ok: true, presets });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

router.get("/api/models", async (_req, res) => {
    try {
        const ollamaRes = await fetch(appConfig.ollama.tagsEndpoint);
        if (!ollamaRes.ok) throw new Error(`Ollama: ${ollamaRes.status}`);
        const data = await ollamaRes.json();
        const models = (data.models || []).map(m => ({
            name:           m.name,
            size:           m.size,
            family:         m.details?.family || null,
            parameter_size: m.details?.parameter_size || null,
        }));
        res.json({ ok: true, models });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

router.post("/api/models/pull", async (req, res) => {
    const { model } = req.body;
    if (!model?.trim()) return res.status(400).json({ ok: false, message: "Nome do modelo obrigatório." });

    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    res.flushHeaders();

    try {
        const pullRes = await fetch(`${appConfig.ollama.host}/api/pull`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: model.trim(), stream: true }),
        });

        if (!pullRes.ok) {
            const text = await pullRes.text();
            res.write(`data: ${JSON.stringify({ error: text })}\n\n`);
            res.end();
            return;
        }

        const reader  = pullRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer    = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const parsed = JSON.parse(line);
                    res.write(`data: ${JSON.stringify(parsed)}\n\n`);
                } catch { /* skip malformed chunk */ }
            }
        }

        res.end();
    } catch (err) {
        try {
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
        } catch { /* client disconnected */ }
    }
});

router.get("/api/config", (_req, res) => {
    try {
        // config null → o front carrega o preset "Máquina Média" como ponto de partida.
        res.json({ ok: true, config: getGenerationConfig("global") || null });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

router.post("/api/config", (req, res) => {
    try {
        const config = req.body;
        if (!config.model) return res.status(400).json({ ok: false, message: "Modelo é obrigatório." });
        setGenerationConfig("global", null, config);
        res.json({ ok: true, message: "Configuração salva com sucesso." });
    } catch (err) {
        res.status(500).json({ ok: false, message: `Erro ao salvar: ${err.message}` });
    }
});

export default router;
