import { getDB, saveDB } from "../db.js";
import { v4 as uuidv4 } from "uuid";

export function recordTokenUsage(conversationId, messageId = null, estimatedTokens = 0) {
  const db = getDB();
  const id = uuidv4();
  db.run(
    `INSERT INTO token_usage (id, conversation_id, message_id, estimated_tokens)
     VALUES (?, ?, ?, ?)`,
    [id, conversationId, messageId, estimatedTokens]
  );
  saveDB();
  return id;
}

export function getTotalTokensInConversation(conversationId) {
  const db = getDB();
  const result = db.exec(
    `SELECT SUM(estimated_tokens) FROM token_usage WHERE conversation_id = ?`,
    [conversationId]
  );
  if (result.length === 0 || result[0].values.length === 0) return 0;
  return result[0].values[0][0] || 0;
}
