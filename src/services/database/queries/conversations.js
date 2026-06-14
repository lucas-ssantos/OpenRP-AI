import { getDB, saveDB } from "../db.js";
import { v4 as uuidv4 } from "uuid";

export function createConversation(characterId, userPersona = null, title = null) {
  const db = getDB();
  const id = uuidv4();
  db.run(
    `INSERT INTO conversations (id, character_id, user_persona, title)
     VALUES (?, ?, ?, ?)`,
    [id, characterId, userPersona, title]
  );
  saveDB();
  return id;
}

export function getConversation(conversationId) {
  const db = getDB();
  const result = db.exec(`SELECT * FROM conversations WHERE id = ?`, [conversationId]);
  if (result.length === 0) return null;
  const row = result[0].values[0];
  return {
    id: row[0],
    character_id: row[1],
    user_persona: row[2],
    title: row[3],
    created_at: row[4],
    updated_at: row[5],
  };
}

export function getLatestConversationForCharacter(characterId) {
  const db = getDB();
  const result = db.exec(
    `SELECT * FROM conversations WHERE character_id = ? ORDER BY created_at DESC LIMIT 1`,
    [characterId]
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  const row = result[0].values[0];
  return {
    id: row[0],
    character_id: row[1],
    user_persona: row[2],
    title: row[3],
    created_at: row[4],
    updated_at: row[5],
  };
}

export function getRecentCharactersWithConversations(limit = 5) {
  const db = getDB();
  const result = db.exec(
    `SELECT c.id, c.name, c.avatar_url,
            COALESCE(MAX(m.created_at), MAX(conv.created_at)) AS last_activity
     FROM characters c
     INNER JOIN conversations conv ON conv.character_id = c.id
     LEFT  JOIN messages m ON m.conversation_id = conv.id
     GROUP BY c.id
     ORDER BY last_activity DESC
     LIMIT ?`,
    [limit]
  );
  if (result.length === 0) return [];
  return result[0].values.map((row) => ({
    id: row[0],
    name: row[1],
    avatar_url: row[2],
    last_activity: row[3],
  }));
}
