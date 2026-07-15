import { getDB, saveDB } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { localDatetime } from "../../../utils/datetime.js";

const mapMemory = (row) => ({
  id: row[0],
  conversation_id: row[1],
  type: row[2],
  content: row[3],
  summary: row[4],
  keywords: row[5],
  is_pinned: row[6] === 1,
  relevance_weight: row[7],
  vector: row[8],
  created_at: row[9],
  updated_at: row[10],
});

// createdAt opcional: memórias extraídas do backlog carregam o horário da
// mensagem de origem, não o da extração — é ele que define o "quando aconteceu"
// mostrado no prompt (formatRelativeTime).
export function createMemory(conversationId, type, content, keywords = null, relevanceWeight = 1.0, isPinned = false, summary = null, createdAt = null) {
  const db = getDB();
  const id = uuidv4();
  const now = localDatetime();
  db.run(
    `INSERT INTO memories (id, conversation_id, type, content, summary, keywords, is_pinned, relevance_weight, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, conversationId, type, content, summary, keywords, isPinned ? 1 : 0, relevanceWeight, createdAt || now, now]
  );
  saveDB();
  return id;
}

export function getMemories(conversationId) {
  const db = getDB();
  const result = db.exec(
    `SELECT * FROM memories WHERE conversation_id = ? ORDER BY is_pinned DESC, relevance_weight DESC`,
    [conversationId]
  );
  if (result.length === 0) return [];
  return result[0].values.map(mapMemory);
}

export function getPinnedMemories(conversationId) {
  const db = getDB();
  const result = db.exec(
    `SELECT * FROM memories WHERE conversation_id = ? AND is_pinned = 1`,
    [conversationId]
  );
  if (result.length === 0) return [];
  return result[0].values.map(mapMemory);
}

export function updateMemory(id, { content, keywords, summary, type } = {}) {
  const db = getDB();
  const sets = [];
  const vals = [];
  if (content  !== undefined && content  !== null) { sets.push("content = ?");  vals.push(content); }
  if (keywords !== undefined)                      { sets.push("keywords = ?"); vals.push(keywords); }
  if (summary  !== undefined)                      { sets.push("summary = ?");  vals.push(summary); }
  if (type     !== undefined) {
    sets.push("type = ?");     vals.push(type);
    sets.push("is_pinned = ?"); vals.push(type === "pinned" ? 1 : 0);
  }
  if (!sets.length) return false;
  sets.push("updated_at = ?"); vals.push(localDatetime());
  vals.push(id);
  db.run(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?`, vals);
  saveDB();
  return true;
}

export function deleteMemory(id) {
  const db = getDB();
  db.run(`DELETE FROM memories WHERE id = ?`, [id]);
  saveDB();
  return true;
}

export function getMemoriesByType(conversationId, type) {
  const db = getDB();
  const result = db.exec(
    `SELECT * FROM memories WHERE conversation_id = ? AND type = ? ORDER BY relevance_weight DESC`,
    [conversationId, type]
  );
  if (result.length === 0) return [];
  return result[0].values.map(mapMemory);
}
