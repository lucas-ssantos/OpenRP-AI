import dotenv from "dotenv";
dotenv.config();

const host = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

export const appConfig = {
    port: parseInt(process.env.PORT) || 3000,
    nodeEnv: process.env.NODE_ENV || "development",
    timezone: process.env.TZ || "America/Sao_Paulo",

    ollama: {
        host,
        chatEndpoint: `${host}/api/chat`,
        tagsEndpoint: `${host}/api/tags`,
    },

    dbPath: process.env.DB_PATH || "./data/roleplay.db",

    defaults: {
        model:            process.env.OLLAMA_DEFAULT_MODEL                       || "qwen3:8b",
        temperature:      parseFloat(process.env.DEFAULT_TEMPERATURE)            || 0.92,
        top_p:            parseFloat(process.env.DEFAULT_TOP_P)                  || 0.90,
        top_k:            parseInt(process.env.DEFAULT_TOP_K)                    || 60,
        min_p:            parseFloat(process.env.DEFAULT_MIN_P)                  || 0.04,
        repeat_penalty:   parseFloat(process.env.DEFAULT_REPEAT_PENALTY)         || 1.05,
        repeat_last_n:    parseInt(process.env.DEFAULT_REPEAT_LAST_N)            || 192,
        tfs_z:            parseFloat(process.env.DEFAULT_TFS_Z)                  || 0.95,
        max_tokens:       parseInt(process.env.DEFAULT_MAX_TOKENS ?? "-1")       || -1,
        min_tokens:       parseInt(process.env.DEFAULT_MIN_TOKENS)               || 60,
        context_size:     parseInt(process.env.DEFAULT_CONTEXT_SIZE)             || 8192,
        num_ctx_messages: parseInt(process.env.DEFAULT_NUM_CTX_MESSAGES)         || 20,
        memory_interval:  parseInt(process.env.MEMORY_INTERVAL)                  || 5,
        seed:             parseInt(process.env.DEFAULT_SEED ?? "-1")             || -1,
        max_response_chars: parseInt(process.env.DEFAULT_MAX_RESPONSE_CHARS)   || 0,
        stream:           true,
        stop: process.env.DEFAULT_STOP
            ? process.env.DEFAULT_STOP.split(",").map((s) => s.trim())
            : ["User:", "Human:", "### User", "\n\nUser:"],
    },
};
