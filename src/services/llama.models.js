import fs from "fs";
import os from "os";
import path from "path";
import { appConfig } from "../config.js";

function getModelDirectory() {
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
            if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".gguf") continue;

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

export function getLlamaContextSize() {
    return appConfig.llama.contextSize;
}
