import { getDB, saveDB } from "../db.js";
import { localDatetime } from "../../../utils/datetime.js";

const parseStop = (raw) =>
  raw ? (typeof raw === "string" ? raw.split(",").map((s) => s.trim()) : raw) : [];

export function getGenerationConfig(level = "global", id = null) {
  const db = getDB();

  if (level === "global") {
    const result = db.exec(
      `SELECT model, temperature, top_p, top_k, min_p, repeat_penalty, repeat_last_n,
              tfs_z, max_tokens, context_size, stream, seed, stop, num_ctx_messages,
              COALESCE(min_tokens, 60) AS min_tokens,
              COALESCE(memory_interval, 5) AS memory_interval
       FROM generation_config WHERE id = 'global'`
    );
    if (!result.length || !result[0].values.length) return null;
    const row = result[0].values[0];
    return {
      model: row[0], temperature: row[1], top_p: row[2], top_k: row[3], min_p: row[4],
      repeat_penalty: row[5], repeat_last_n: row[6], tfs_z: row[7], max_tokens: row[8],
      context_size: row[9], stream: row[10] === 1, seed: row[11],
      stop: parseStop(row[12]), num_ctx_messages: row[13], min_tokens: row[14],
      memory_interval: row[15] ?? 5,
    };
  }

  let query, params;
  if (level === "character") {
    query = "SELECT * FROM character_config WHERE character_id = ?";
    params = [id];
  } else if (level === "conversation") {
    query = "SELECT * FROM conversation_config WHERE conversation_id = ?";
    params = [id];
  } else {
    return null;
  }

  const result = db.exec(query, params);
  if (!result.length || !result[0].values.length) return null;
  const row = result[0].values[0];
  const config = {
    model: row[1], temperature: row[2], top_p: row[3], top_k: row[4], min_p: row[5],
    repeat_penalty: row[6], repeat_last_n: row[7], tfs_z: row[8], max_tokens: row[9],
    context_size: row[10], stream: row[11] === 1, seed: row[12],
    stop: parseStop(row[13]), num_ctx_messages: row[14],
  };
  if (level === "character") {
    config.system_prompt = row[15] ?? null;
    config.jailbreak = row[16] ?? null;
  }
  return config;
}

// ── Override de modelo por conversa (model-only) ─────────────────────────────
// A conversa pode ter um modelo exclusivo; os demais parâmetros continuam
// herdando de global → personagem (ver resolveConfig).
export function getConversationModel(conversationId) {
  const db = getDB();
  const result = db.exec(
    `SELECT model FROM conversation_config WHERE conversation_id = ?`,
    [conversationId]
  );
  if (!result.length || !result[0].values.length) return null;
  return result[0].values[0][0] || null;
}

export function setConversationModel(conversationId, model) {
  const db = getDB();
  const now = localDatetime();
  // INSERT OR REPLACE grava só o modelo; demais colunas ficam NULL (sem override).
  db.run(
    `INSERT OR REPLACE INTO conversation_config (conversation_id, model, updated_at)
     VALUES (?, ?, ?)`,
    [conversationId, model?.trim() || null, now]
  );
  saveDB();
}

export function setGenerationConfig(level = "global", id = null, config = {}) {
  const db = getDB();
  const now = localDatetime();
  const toStop = (v) => (Array.isArray(v) ? v.join(", ") : v || "");
  const toStream = (v) => (v === 1 || v === true || v === "1" ? 1 : 0);
  const toSeed = (v) => (v !== null && v !== undefined ? v : -1);

  if (level === "global") {
    const { model, temperature, top_p, top_k, min_p, repeat_penalty, repeat_last_n,
            tfs_z, max_tokens, context_size, stream, seed, stop, num_ctx_messages,
            min_tokens, memory_interval } = config;
    db.run(
      `INSERT OR REPLACE INTO generation_config
       (id, model, temperature, top_p, top_k, min_p, repeat_penalty, repeat_last_n,
        tfs_z, max_tokens, context_size, stream, seed, stop, num_ctx_messages, min_tokens,
        memory_interval, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["global", model, temperature, top_p, top_k, min_p, repeat_penalty, repeat_last_n,
       tfs_z, max_tokens, context_size, toStream(stream), toSeed(seed),
       toStop(stop), num_ctx_messages || 20, min_tokens ?? 60,
       memory_interval ?? 5, now]
    );
  } else if (level === "character") {
    const { model, temperature, top_p, top_k, min_p, repeat_penalty, repeat_last_n,
            tfs_z, max_tokens, context_size, stream, seed, stop, num_ctx_messages,
            system_prompt, jailbreak } = config;
    db.run(
      `INSERT OR REPLACE INTO character_config
       (character_id, model, temperature, top_p, top_k, min_p, repeat_penalty, repeat_last_n,
        tfs_z, max_tokens, context_size, stream, seed, stop, num_ctx_messages, system_prompt, jailbreak, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, model, temperature, top_p, top_k, min_p, repeat_penalty, repeat_last_n,
       tfs_z, max_tokens, context_size, toStream(stream), toSeed(seed),
       toStop(stop), num_ctx_messages || 20, system_prompt, jailbreak, now]
    );
  } else if (level === "conversation") {
    const { model, temperature, top_p, top_k, min_p, repeat_penalty, repeat_last_n,
            tfs_z, max_tokens, context_size, stream, seed, stop, num_ctx_messages } = config;
    db.run(
      `INSERT OR REPLACE INTO conversation_config
       (conversation_id, model, temperature, top_p, top_k, min_p, repeat_penalty, repeat_last_n,
        tfs_z, max_tokens, context_size, stream, seed, stop, num_ctx_messages, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, model, temperature, top_p, top_k, min_p, repeat_penalty, repeat_last_n,
       tfs_z, max_tokens, context_size, toStream(stream), toSeed(seed),
       toStop(stop), num_ctx_messages || 20, now]
    );
  }

  saveDB();
}
