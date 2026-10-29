import { Router } from "express";
import fs from "fs";
import path from "path";
import { getGenerationConfig, setGenerationConfig } from "../../database/queries.js";
import { listLocalModels, getLlamaContextSize } from "../../llama.models.js";
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
        const models = listLocalModels().map((model) => ({
            name: model.name,
            size: model.size,
            family: model.family,
            parameter_size: model.parameter_size,
            loaded: model.name === appConfig.llama.model,
            context_length: model.name === appConfig.llama.model ? getLlamaContextSize() : null,
        }));
        res.json({
            ok: true,
            models,
            loaded_model: appConfig.llama.model,
            router_mode: appConfig.llama.routerMode === true,
        });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

router.post("/api/models/pull", (_req, res) => {
    res.status(410).json({
        ok: false,
        message: "O llama.cpp não baixa modelos. Adicione arquivos GGUF em ~/.ai-models e reinicie o OpenRP AI.",
    });
});

router.get("/api/config", (_req, res) => {
    try {
        // config null → o front carrega o preset "Máquina Média" como ponto de partida.
        res.json({ ok: true, config: getGenerationConfig() || null });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

router.post("/api/config", (req, res) => {
    try {
        const config = req.body;
        if (!config.model) return res.status(400).json({ ok: false, message: "Modelo é obrigatório." });

        const installed = new Set(listLocalModels().map((model) => model.name));
        if (!installed.has(config.model)) {
            return res.status(400).json({ ok: false, message: `O modelo "${config.model}" não está em ~/.ai-models.` });
        }
        if (config.affection_model && !installed.has(config.affection_model)) {
            return res.status(400).json({
                ok: false,
                message: `O modelo de afeto "${config.affection_model}" não está em ~/.ai-models.`,
            });
        }

        const previous = getGenerationConfig();
        setGenerationConfig(config);

        const contextChanged = (config.context_size ?? null) !== (previous?.context_size ?? null);
        // No modo router o llama.cpp troca de modelo sob demanda, então mudar
        // de modelo não exige reiniciar — só o contexto (definido no processo).
        const restartRequired = contextChanged
            || (!appConfig.llama.routerMode && config.model !== appConfig.llama.model);

        res.json({
            ok: true,
            restart_required: restartRequired,
            message: restartRequired
                ? "Configuração salva. Reinicie o OpenRP AI para aplicar o novo contexto."
                : "Configuração salva com sucesso.",
        });
    } catch (err) {
        res.status(500).json({ ok: false, message: `Erro ao salvar: ${err.message}` });
    }
});

export default router;
