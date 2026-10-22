import fs from "fs";
import os from "os";
import path from "path";
import { appConfig } from "../config.js";

function getModelDirectories() {
    const configured = process.env.OLLAMA_MODELS;
    return [
        configured,
        path.join(os.homedir(), ".ollama", "models"),
        "/usr/share/ollama/.ollama/models",
        "/var/lib/ollama/.ollama/models",
    ].filter((dir, index, all) => dir && all.indexOf(dir) === index);
}

function getModelName(manifestsDir, manifestPath) {
    const parts = path.relative(manifestsDir, manifestPath).split(path.sep);
    const libraryIndex = parts.indexOf("library");
    const modelParts = libraryIndex >= 0 ? parts.slice(libraryIndex + 1) : parts;
    if (modelParts.length < 2) return null;
    const tag = modelParts.pop();
    return `${modelParts.join("/")}:${tag}`;
}

function findModelManifest(modelName) {
    const requested = modelName.includes(":") ? modelName : `${modelName}:latest`;
    for (const modelsDir of getModelDirectories()) {
        const manifestsDir = path.join(modelsDir, "manifests");
        if (!fs.existsSync(manifestsDir)) continue;

        const stack = [manifestsDir];
        while (stack.length) {
            const current = stack.pop();
            for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
                const fullPath = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    stack.push(fullPath);
                    continue;
                }
                if (entry.isFile() && getModelName(manifestsDir, fullPath) === requested) {
                    return { modelsDir, manifestPath: fullPath };
                }
            }
        }
    }
    return null;
}

export function resolveModelFile(modelName) {
    const found = findModelManifest(modelName);
    if (!found) {
        throw new Error(
            `Modelo "${modelName}" não encontrado no cache local do Ollama. ` +
            "Baixe-o no Ollama antes de iniciar o OpenRP AI."
        );
    }

    const manifest = JSON.parse(fs.readFileSync(found.manifestPath, "utf8"));
    const layer = manifest.layers?.find((item) => item.mediaType === "application/vnd.ollama.image.model");
    if (!layer?.digest) throw new Error(`Manifesto do modelo "${modelName}" não contém o blob do modelo.`);

    const blobPath = path.join(found.modelsDir, "blobs", layer.digest.replace(":", "-"));
    if (!fs.existsSync(blobPath) || !fs.statSync(blobPath).isFile()) {
        throw new Error(`Blob do modelo "${modelName}" não encontrado: ${blobPath}`);
    }
    return blobPath;
}

export function listLocalModels() {
    const models = new Map();
    for (const modelsDir of getModelDirectories()) {
        const manifestsDir = path.join(modelsDir, "manifests");
        if (!fs.existsSync(manifestsDir)) continue;

        const stack = [manifestsDir];
        while (stack.length) {
            const current = stack.pop();
            for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
                const fullPath = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    stack.push(fullPath);
                    continue;
                }
                if (!entry.isFile()) continue;

                const name = getModelName(manifestsDir, fullPath);
                if (!name || models.has(name)) continue;
                try {
                    const manifest = JSON.parse(fs.readFileSync(fullPath, "utf8"));
                    const layer = manifest.layers?.find((item) => item.mediaType === "application/vnd.ollama.image.model");
                    const blobPath = layer?.digest
                        ? path.join(modelsDir, "blobs", layer.digest.replace(":", "-"))
                        : null;
                    if (!blobPath || !fs.existsSync(blobPath)) continue;
                    models.set(name, {
                        name,
                        size: fs.statSync(blobPath).size,
                        family: name.split("/").at(-1).split(":")[0],
                        parameter_size: null,
                    });
                } catch (error) {
                    console.warn(`[llama] Ignorando manifesto inválido ${fullPath}: ${error.message}`);
                }
            }
        }
    }
    return [...models.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getLlamaContextSize() {
    return appConfig.llama.contextSize;
}
