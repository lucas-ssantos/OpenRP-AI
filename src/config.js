import dotenv from "dotenv";
dotenv.config();

const llamaUrl = new URL(process.env.LLAMA_HOST || "http://127.0.0.1:8080");
const llamaHost = llamaUrl.origin;
const parseInteger = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : fallback;
};

export const appConfig = {
    port: parseInt(process.env.PORT) || 3000,
    nodeEnv: process.env.NODE_ENV || "development",
    timezone: process.env.TZ || "America/Sao_Paulo",

    llama: {
        host: llamaHost,
        bindHost: llamaUrl.hostname,
        port: parseInteger(llamaUrl.port, 8080),
        chatEndpoint: `${llamaHost}/v1/chat/completions`,
        healthEndpoint: `${llamaHost}/health`,
        binary: process.env.LLAMA_SERVER_BIN || "llama-server",
        gpuLayers: parseInteger(process.env.LLAMA_GPU_LAYERS ?? "999", 999),
        contextSize: parseInteger(process.env.LLAMA_CTX_SIZE || process.env.DEFAULT_CONTEXT_SIZE || "32768", 32768),
        model: null,
    },

    dbPath: process.env.DB_PATH || "./data/roleplay.db",

    // Basic auth opcional — importante quando exposto via Tailscale.
    // Defina AUTH_PASSWORD no .env para exigir login; sem ela, acesso livre.
    auth: {
        user:     process.env.AUTH_USER || "openrp",
        password: process.env.AUTH_PASSWORD || null,
    },

    defaults: {
        model:            process.env.LLAMA_DEFAULT_MODEL || process.env.OLLAMA_DEFAULT_MODEL || "gemma4:12b",
        temperature:      parseFloat(process.env.DEFAULT_TEMPERATURE)            || 0.92,
        top_p:            parseFloat(process.env.DEFAULT_TOP_P)                  || 0.90,
        top_k:            parseInt(process.env.DEFAULT_TOP_K)                    || 60,
        min_p:            parseFloat(process.env.DEFAULT_MIN_P)                  || 0.04,
        repeat_penalty:   parseFloat(process.env.DEFAULT_REPEAT_PENALTY)         || 1.05,
        repeat_last_n:    parseInt(process.env.DEFAULT_REPEAT_LAST_N)            || 192,
        max_tokens:       parseInt(process.env.DEFAULT_MAX_TOKENS ?? "-1")       || -1,
        min_tokens:       parseInt(process.env.DEFAULT_MIN_TOKENS)               || 0,
        // null = contexto definido pela configuração do llama-server.
        context_size:     process.env.DEFAULT_CONTEXT_SIZE ? parseInt(process.env.DEFAULT_CONTEXT_SIZE) : null,
        num_ctx_messages: parseInt(process.env.DEFAULT_NUM_CTX_MESSAGES)         || 20,
        memory_interval:  parseInt(process.env.MEMORY_INTERVAL)                  || 5,
        // Persona facts: extrai a cada N mensagens DO USUÁRIO; 0 = desligado
        // (por isso não usa `||`, que transformaria 0 em 10).
        persona_interval: parseInt(process.env.PERSONA_INTERVAL) >= 0 ? parseInt(process.env.PERSONA_INTERVAL) : 10,
        seed:             parseInt(process.env.DEFAULT_SEED ?? "-1")             || -1,
        max_response_chars: parseInt(process.env.DEFAULT_MAX_RESPONSE_CHARS)   || 0,
        stream:           true,
        // 'off' | 'scoped' | 'always' — DEFAULT_THINK=true legado equivale a 'always'.
        think_mode:       ["off", "scoped", "always"].includes(process.env.DEFAULT_THINK_MODE)
            ? process.env.DEFAULT_THINK_MODE
            : (process.env.DEFAULT_THINK === "true" ? "always" : "off"),
        stop: process.env.DEFAULT_STOP
            ? process.env.DEFAULT_STOP.split(",").map((s) => s.trim())
            : ["User:", "Human:", "### User", "\n\nUser:"],
    },
};
