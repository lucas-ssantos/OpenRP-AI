import { getDB, saveDB } from "../db.js";
import { v4 as uuidv4 } from "uuid";

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

export function createMemory(conversationId, type, content, keywords = null, relevanceWeight = 1.0, isPinned = false, summary = null) {
  const db = getDB();
  const id = uuidv4();
  db.run(
    `INSERT INTO memories (id, conversation_id, type, content, summary, keywords, is_pinned, relevance_weight)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, conversationId, type, content, summary, keywords, isPinned ? 1 : 0, relevanceWeight]
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

export function getMemoriesByType(conversationId, type) {
  const db = getDB();
  const result = db.exec(
    `SELECT * FROM memories WHERE conversation_id = ? AND type = ? ORDER BY relevance_weight DESC`,
    [conversationId, type]
  );
  if (result.length === 0) return [];
  return result[0].values.map(mapMemory);
}
