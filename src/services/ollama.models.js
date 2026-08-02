import { appConfig } from "../config.js";

const BASE_MODEL = "gemma4:e4b";

// Usado pelo preset "Máquina Forte" (high_spec.json), que trava context_size=65536.
// O preset padrão de fábrica (medium_spec.json) usa gemma4:12b com contexto automático,
// então não depende de uma variante customizada.
const CUSTOM_MODELS = [
    { name: "gemma4:e4b-64k", numCtx: 65536 },
];

async function getAvailableModels() {
    try {
        const res = await fetch(appConfig.ollama.tagsEndpoint);
        if (!res.ok) return [];
        const data = await res.json();
        return (data.models || []).map(m => m.name);
    } catch {
        return [];
    }
}

function modelPresent(available, name) {
    return available.some(n => n === name || n === `${name}:latest`);
}

async function createModel(name, numCtx) {
    const modelfile = `FROM ${BASE_MODEL}\nPARAMETER num_ctx ${numCtx}`;
    console.log(`[models] Creating "${name}" (num_ctx: ${numCtx})...`);

    const res = await fetch(`${appConfig.ollama.host}/api/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, modelfile }),
    });

    if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }

    const reader  = res.body.getReader();
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
                if (parsed.status) process.stdout.write(`\r  [${name}] ${parsed.status.slice(0, 60).padEnd(60)}`);
            } catch { /* ignore malformed chunks */ }
        }
    }

    process.stdout.write("\n");
    console.log(`[models] "${name}" ready.`);
}

// Contexto máximo suportado por um modelo, consultado via /api/show (chave vem
// namespaced pela arquitetura — "qwen35.context_length", "gemma4.context_length"...
// — por isso procura qualquer chave terminada em ".context_length" em vez de
// assumir um nome fixo). Usado para resolver "contexto automático" (context_size
// NULL) para o num_ctx real do modelo, em vez de simplesmente omitir o parâmetro
// e deixar o Ollama cair no default hardcoded de 4096 tokens.
// Cacheado em memória por nome de modelo — não muda em runtime (só reiniciando
// o servidor após recriar o modelo com outro Modelfile invalidaria o valor).
const contextLengthCache = new Map();

export async function getModelContextLength(model) {
    if (contextLengthCache.has(model)) return contextLengthCache.get(model);
    try {
        const res = await fetch(`${appConfig.ollama.host}/api/show`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const info = data.model_info || {};
        const key = Object.keys(info).find((k) => k.endsWith(".context_length"));
        const contextLength = key ? info[key] : null;
        contextLengthCache.set(model, contextLength);
        return contextLength;
    } catch {
        return null;
    }
}

export async function ensureCustomModels() {
    const available = await getAvailableModels();

    if (!modelPresent(available, BASE_MODEL)) {
        console.warn(
            `[models] "${BASE_MODEL}" not found locally — custom context models will not be created.\n` +
            `         Pull it first: ollama pull ${BASE_MODEL}`
        );
        return;
    }

    for (const { name, numCtx } of CUSTOM_MODELS) {
        if (modelPresent(available, name)) {
            console.log(`[models] "${name}" already exists — skipping.`);
        } else {
            try {
                await createModel(name, numCtx);
            } catch (err) {
                console.error(`[models] Failed to create "${name}":`, err.message);
            }
        }
    }
}
