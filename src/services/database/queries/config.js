import { getDB, saveDB } from "../db.js";
import { localDatetime } from "../../../utils/datetime.js";

// stop é armazenado como CSV. Bancos criados por versões antigas podem ter o
// seed gravado como JSON ("[\"User:\",...]") — detecta e converte.
const parseStop = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  const str = String(raw).trim();
  if (str.startsWith("[")) {
    try {
      const arr = JSON.parse(str);
      if (Array.isArray(arr)) return arr.map((s) => String(s)).filter(Boolean);
    } catch { /* não era JSON válido — segue como CSV */ }
  }
  return [...new Set(str.split(",").map((s) => s.trim()).filter(Boolean))];
};

// think_mode: 'off' | 'scoped' | 'always'. Bancos antigos só têm a coluna
// booleana legada `think` — 1 vira 'always' (comportamento equivalente).
const parseThinkMode = (mode, legacyThink) => {
  if (mode === "off" || mode === "scoped" || mode === "always") return mode;
  return legacyThink === 1 ? "always" : "off";
};

// Mapeia uma linha de db.exec() por nome de coluna — independe da ordem física
// das colunas (bancos antigos podem ter colunas extras, ex.: tfs_z).
function rowToObject(result) {
  if (!result.length || !result[0].values.length) return null;
  const obj = {};
  result[0].columns.forEach((col, i) => { obj[col] = result[0].values[0][i]; });
  return obj;
}

export function getGenerationConfig() {
  const db = getDB();

  const row = rowToObject(db.exec(`SELECT * FROM generation_config WHERE id = 'global'`));
  if (!row) return null;
  return {
    model: row.model, temperature: row.temperature, top_p: row.top_p, top_k: row.top_k,
    min_p: row.min_p, repeat_penalty: row.repeat_penalty, repeat_last_n: row.repeat_last_n,
    max_tokens: row.max_tokens, context_size: row.context_size, stream: row.stream === 1,
    seed: row.seed, stop: parseStop(row.stop), num_ctx_messages: row.num_ctx_messages,
    min_tokens: row.min_tokens ?? 60,
    memory_interval: row.memory_interval ?? 5,
    persona_interval: row.persona_interval ?? 10,
    think_mode: parseThinkMode(row.think_mode, row.think),
  };
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
  db.run(
    `INSERT OR REPLACE INTO conversation_config (conversation_id, model, updated_at)
     VALUES (?, ?, ?)`,
    [conversationId, model?.trim() || null, now]
  );
  saveDB();
}

export function setGenerationConfig(config = {}) {
  const db = getDB();
  const now = localDatetime();
  const toStop = (v) => (Array.isArray(v) ? v.join(", ") : v || "");
  const toStream = (v) => (v === 1 || v === true || v === "1" ? 1 : 0);
  const toSeed = (v) => (v !== null && v !== undefined ? v : -1);
  // Aceita payloads antigos (think boolean) e novos (think_mode string).
  const thinkMode = parseThinkMode(config.think_mode, (config.think === true || config.think === 1 || config.think === "1") ? 1 : 0);

  const { model, temperature, top_p, top_k, min_p, repeat_penalty, repeat_last_n,
          max_tokens, context_size, stream, seed, stop, num_ctx_messages,
          min_tokens, memory_interval, persona_interval } = config;
  db.run(
    `INSERT OR REPLACE INTO generation_config
     (id, model, temperature, top_p, top_k, min_p, repeat_penalty, repeat_last_n,
      max_tokens, context_size, stream, seed, stop, num_ctx_messages, min_tokens,
      memory_interval, persona_interval, think, think_mode, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["global", model, temperature, top_p, top_k, min_p, repeat_penalty, repeat_last_n,
     max_tokens, context_size, toStream(stream), toSeed(seed),
     toStop(stop), num_ctx_messages || 20, min_tokens ?? 60,
     memory_interval ?? 5, persona_interval ?? 10,
     // coluna legada `think` mantida em sincronia (1 = qualquer modo ativo)
     thinkMode !== "off" ? 1 : 0, thinkMode, now]
  );

  saveDB();
}
