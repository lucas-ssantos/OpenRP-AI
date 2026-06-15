import { appConfig } from "../config.js";

const BASE_MODEL = "gemma4:e4b";

const CUSTOM_MODELS = [
    { name: "gemma4:e4b-32k", numCtx: 32768 },
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
