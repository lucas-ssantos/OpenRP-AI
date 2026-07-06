import { getDB, saveDB } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { localDatetime } from "../../../utils/datetime.js";

const CONV_COLUMNS = `id, character_id, user_persona, title, scenario, first_message, last_memory_position, affection_points, created_at, updated_at`;

function mapConversationRow(row) {
  return {
    id: row[0],
    character_id: row[1],
    user_persona: row[2],
    title: row[3],
    scenario: row[4],
    first_message: row[5],
    last_memory_position: row[6] ?? 0,
    affection_points: row[7] ?? 0,
    created_at: row[8],
    updated_at: row[9],
  };
}

export function createConversation(characterId, userPersona = null, title = null, scenario = null, firstMessage = null) {
  const db = getDB();
  const id = uuidv4();
  const now = localDatetime();
  db.run(
    `INSERT INTO conversations (id, character_id, user_persona, title, scenario, first_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, characterId, userPersona, title, scenario, firstMessage, now, now]
  );
  saveDB();
  return id;
}

export function getConversation(conversationId) {
  const db = getDB();
  const result = db.exec(`SELECT ${CONV_COLUMNS} FROM conversations WHERE id = ?`, [conversationId]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  return mapConversationRow(result[0].values[0]);
}

export function getLatestConversationForCharacter(characterId) {
  const db = getDB();
  const result = db.exec(
    `SELECT ${CONV_COLUMNS} FROM conversations WHERE character_id = ? ORDER BY created_at DESC LIMIT 1`,
    [characterId]
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  return mapConversationRow(result[0].values[0]);
}

// Cursor da extração de memórias: maior position de mensagem já processada pelo extrator.
export function getLastMemoryPosition(conversationId) {
  const db = getDB();
  const result = db.exec(`SELECT last_memory_position FROM conversations WHERE id = ?`, [conversationId]);
  if (result.length === 0 || result[0].values.length === 0) return 0;
  return result[0].values[0][0] ?? 0;
}

export function setLastMemoryPosition(conversationId, position) {
  const db = getDB();
  db.run(`UPDATE conversations SET last_memory_position = ? WHERE id = ?`, [position, conversationId]);
  saveDB();
}

// Soma pontos de afeto e retorna o total atualizado.
export function addAffectionPoints(conversationId, delta) {
  const db = getDB();
  db.run(
    `UPDATE conversations SET affection_points = MAX(0, affection_points + ?) WHERE id = ?`,
    [delta, conversationId]
  );
  const result = db.exec(`SELECT affection_points FROM conversations WHERE id = ?`, [conversationId]);
  saveDB();
  if (result.length === 0 || result[0].values.length === 0) return 0;
  return result[0].values[0][0] ?? 0;
}

// Lista todas as conversas de um personagem, mais recentes (por última atividade) primeiro.
export function getConversationsForCharacter(characterId) {
  const db = getDB();
  const result = db.exec(
    `SELECT conv.id, conv.title, conv.scenario, conv.created_at,
            COALESCE(MAX(m.created_at), conv.created_at) AS last_activity,
            COUNT(m.id) AS message_count
     FROM conversations conv
     LEFT JOIN messages m ON m.conversation_id = conv.id
     WHERE conv.character_id = ?
     GROUP BY conv.id
     ORDER BY last_activity DESC`,
    [characterId]
  );
  if (result.length === 0) return [];
  return result[0].values.map((row) => ({
    id: row[0],
    title: row[1],
    scenario: row[2],
    created_at: row[3],
    last_activity: row[4],
    message_count: row[5],
  }));
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
