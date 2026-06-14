import { getDB, saveDB } from "../db.js";
import { v4 as uuidv4 } from "uuid";

export function addMessage(conversationId, role, content, position = null) {
  const db = getDB();
  const id = uuidv4();
  db.run(
    `INSERT INTO messages (id, conversation_id, role, content, position)
     VALUES (?, ?, ?, ?, ?)`,
    [id, conversationId, role, content, position]
  );
  saveDB();
  return id;
}

export function updateMessage(messageId, content) {
  const db = getDB();
  db.run(`UPDATE messages SET content = ? WHERE id = ?`, [content, messageId]);
  saveDB();
}

export function deleteLastAssistantMessage(conversationId) {
  const db = getDB();
  const result = db.exec(
    `SELECT id, position FROM messages
     WHERE conversation_id = ? AND role = 'assistant'
     ORDER BY position DESC LIMIT 1`,
    [conversationId]
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  const [id, position] = result[0].values[0];
  db.run(`DELETE FROM messages WHERE id = ?`, [id]);
  saveDB();
  return { id, position };
}

export function rollbackConversation(conversationId, messageId) {
  const db = getDB();
  const posResult = db.exec(
    `SELECT position FROM messages WHERE id = ? AND conversation_id = ?`,
    [messageId, conversationId]
  );
  if (posResult.length === 0 || posResult[0].values.length === 0) return false;
  const position = posResult[0].values[0][0];
  db.run(
    `DELETE FROM messages WHERE conversation_id = ? AND position > ?`,
    [conversationId, position]
  );
  saveDB();
  return true;
}

// Apaga todas as mensagens e memórias — usado pelo reset de conversa
export function resetConversation(conversationId) {
  const db = getDB();
  db.run(`DELETE FROM messages WHERE conversation_id = ?`, [conversationId]);
  db.run(`DELETE FROM memories WHERE conversation_id = ?`, [conversationId]);
  saveDB();
}

export function getConversationMessages(conversationId) {
  const db = getDB();
  const result = db.exec(
    `SELECT * FROM messages WHERE conversation_id = ? ORDER BY position ASC, created_at ASC`,
    [conversationId]
  );
  if (result.length === 0) return [];
  return result[0].values.map((row) => ({
    id: row[0],
    conversation_id: row[1],
    role: row[2],
    content: row[3],
    position: row[4],
    created_at: row[5],
  }));
}

export function getLastNMessages(conversationId, n = 20) {
  const db = getDB();
  const mapRow = (row) => ({
    id: row[0], conversation_id: row[1], role: row[2],
    content: row[3], position: row[4], created_at: row[5],
  });
  const run = (role) => {
    const r = db.exec(
      `SELECT * FROM messages WHERE conversation_id = ? AND role = ? ORDER BY position DESC LIMIT ?`,
      [conversationId, role, n]
    );
    return r.length > 0 ? r[0].values.map(mapRow) : [];
  };
  return [...run("user"), ...run("assistant")]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}
