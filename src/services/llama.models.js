import fs from "fs";
import os from "os";
import path from "path";
import { appConfig } from "../config.js";

export function getModelDirectory() {
    return path.resolve(process.env.AI_MODELS_DIR || path.join(os.homedir(), ".ai-models"));
}

function getModelName(modelsDir, modelPath) {
    const parts = path.relative(modelsDir, modelPath).split(path.sep);
    const fileName = parts.pop();
    const name = fileName.slice(0, -path.extname(fileName).length);
    return parts.length ? `${parts.join("/")}:${name}` : name;
}

export function resolveModelFile(modelName) {
    const model = listLocalModels().find((item) => item.name === modelName);
    if (!model) {
        throw new Error(
            `Modelo "${modelName}" não encontrado em ${getModelDirectory()}. ` +
            "Adicione o arquivo GGUF correspondente a esse nome."
        );
    }
    return model.path;
}

// Um GGUF só é um modelo carregável quando não é um arquivo auxiliar
// (mmproj) nem um shard secundário de um modelo dividido em partes.
function isLoadableModelFile(fileName) {
    const lower = fileName.toLowerCase();
    if (!lower.endsWith(".gguf")) return false;
    if (lower.includes("mmproj")) return false;

    const shard = lower.match(/-(\d{5})-of-(\d{5})\.gguf$/);
    if (shard && shard[1] !== "00001") return false;

    return true;
}

export function listLocalModels() {
    const modelsDir = getModelDirectory();
    if (!fs.existsSync(modelsDir)) return [];

    const models = [];
    const stack = [modelsDir];
    while (stack.length) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (!entry.isFile() || !isLoadableModelFile(entry.name)) continue;

            const name = getModelName(modelsDir, fullPath);
            models.push({
                name,
                path: fullPath,
                size: fs.statSync(fullPath).size,
                family: name.split("/").at(-1).split(":")[0],
                parameter_size: null,
            });
        }
    }
    return models.sort((a, b) => a.name.localeCompare(b.name));
}

export function isLocalModel(modelName) {
    return listLocalModels().some((model) => model.name === modelName);
}

// Nomes de seção do models.ini não podem conter ":" (o llama.cpp interpreta o
// trecho após os dois-pontos como tag e altera a caixa). O nome visível para o
// app continua sendo o alias ("gemma4:12b"), preservado no campo `alias`.
function slugifyModelName(name, usedSlugs) {
    const base = name
        .replace(/[^a-zA-Z0-9_.-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "model";

    let slug = base;
    let suffix = 2;
    while (usedSlugs.has(slug.toLowerCase())) {
        slug = `${base}-${suffix++}`;
    }
    usedSlugs.add(slug.toLowerCase());
    return slug;
}

// Gera o preset do modo router a partir de TODOS os GGUFs encontrados em
// ~/.ai-models. O arquivo models.ini é apenas um artefato: a fonte da verdade é
// o sistema de arquivos, portanto ele é sobrescrito a cada inicialização.
export function buildRouterPreset(models, { defaultModel = null } = {}) {
    const lines = [
        "# Gerado automaticamente pelo OpenRP AI a partir dos GGUFs em ~/.ai-models.",
        "# Alterações neste arquivo são sobrescritas na próxima inicialização.",
        "version = 1",
        "",
    ];
    const usedSlugs = new Set();

    for (const model of models) {
        const slug = slugifyModelName(model.name, usedSlugs);
        lines.push(`[${slug}]`);
        lines.push(`model = ${model.path}`);
        if (slug !== model.name) lines.push(`alias = ${model.name}`);
        if (model.name === defaultModel) lines.push("load-on-startup = true");
        lines.push("");
    }

    return lines.join("\n");
}

export function getRouterPresetPath() {
    const modelsDir = getModelDirectory();
    try {
        fs.mkdirSync(modelsDir, { recursive: true });
        fs.accessSync(modelsDir, fs.constants.W_OK);
        return path.join(modelsDir, "models.ini");
    } catch {
        // ~/.ai-models pode ser somente leitura; nesse caso o preset vive em /tmp.
        return path.join(os.tmpdir(), "openrp-ai-models.ini");
    }
}

export function writeRouterPreset(models, options = {}) {
    const presetPath = getRouterPresetPath();
    fs.writeFileSync(presetPath, buildRouterPreset(models, options), "utf8");
    return presetPath;
}

export function getLlamaContextSize() {
    return appConfig.llama.contextSize;
}
