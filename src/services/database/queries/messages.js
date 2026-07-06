import { getDB, saveDB } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { localDatetime } from "../../../utils/datetime.js";

const mapRow = (row) => ({
  id: row[0], conversation_id: row[1], role: row[2],
  content: row[3], position: row[4], created_at: row[5],
});

// position null → calcula MAX(position)+1 no próprio SQL, evitando colisão
// quando duas requisições calculam a posição em paralelo no JS.
export function addMessage(conversationId, role, content, position = null) {
  const db = getDB();
  const id = uuidv4();
  if (position === null || position === undefined) {
    db.run(
      `INSERT INTO messages (id, conversation_id, role, content, position, created_at)
       VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM messages WHERE conversation_id = ?), ?)`,
      [id, conversationId, role, content, conversationId, localDatetime()]
    );
  } else {
    db.run(
      `INSERT INTO messages (id, conversation_id, role, content, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, conversationId, role, content, position, localDatetime()]
    );
  }
  saveDB();
  return id;
}

// Atualiza somente se a mensagem pertencer à conversa. Retorna false se nada foi alterado.
export function updateMessage(messageId, content, conversationId = null) {
  const db = getDB();
  if (conversationId) {
    db.run(
      `UPDATE messages SET content = ? WHERE id = ? AND conversation_id = ?`,
      [content, messageId, conversationId]
    );
  } else {
    db.run(`UPDATE messages SET content = ? WHERE id = ?`, [content, messageId]);
  }
  const changed = db.getRowsModified() > 0;
  if (changed) saveDB();
  return changed;
}

// Última mensagem não-system da conversa (ou null).
export function getLastMessage(conversationId) {
  const db = getDB();
  const result = db.exec(
    `SELECT id, conversation_id, role, content, position, created_at
     FROM messages WHERE conversation_id = ? AND role != 'system'
     ORDER BY position DESC LIMIT 1`,
    [conversationId]
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  return mapRow(result[0].values[0]);
}

export function deleteMessage(messageId) {
  const db = getDB();
  db.run(`DELETE FROM messages WHERE id = ?`, [messageId]);
  const changed = db.getRowsModified() > 0;
  if (changed) saveDB();
  return changed;
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
  // Clampeia o cursor de extração de memórias: mensagens reescritas após o
  // rollback não podem ser consideradas "já processadas"
  db.run(
    `UPDATE conversations SET last_memory_position = MIN(last_memory_position, ?) WHERE id = ?`,
    [position, conversationId]
  );
  saveDB();
  return true;
}

// Apaga todas as mensagens e memórias — usado pelo reset de conversa
export function resetConversation(conversationId) {
  const db = getDB();
  db.run(`DELETE FROM messages WHERE conversation_id = ?`, [conversationId]);
  db.run(`DELETE FROM memories WHERE conversation_id = ?`, [conversationId]);
  db.run(`UPDATE conversations SET last_memory_position = 0, affection_points = 0 WHERE id = ?`, [conversationId]);
  saveDB();
}

export function getConversationMessages(conversationId) {
  const db = getDB();
  const result = db.exec(
    `SELECT id, conversation_id, role, content, position, created_at
     FROM messages WHERE conversation_id = ? ORDER BY position ASC, created_at ASC`,
    [conversationId]
  );
  if (result.length === 0) return [];
  return result[0].values.map(mapRow);
}

// Últimas N mensagens não-system da conversa, mais antiga primeiro.
// N é o total (user + assistant juntos) — a mesma definição de "janela de
// contexto" usada pelo gatilho de memórias (trigger.js).
export function getLastNMessages(conversationId, n = 20) {
  const db = getDB();
  const result = db.exec(
    `SELECT id, conversation_id, role, content, position, created_at
     FROM messages WHERE conversation_id = ? AND role != 'system'
     ORDER BY position DESC LIMIT ?`,
    [conversationId, n]
  );
  if (result.length === 0) return [];
  return result[0].values.map(mapRow).reverse();
}

// Mensagens fora da janela de contexto (as numCtx mais recentes) e ainda não
// processadas pela extração (position > lastProcessed), mais antigas primeiro.
// Feito direto no SQL para não carregar a conversa inteira a cada turno.
export function getMemoryBacklog(conversationId, numCtx, lastProcessed, limit) {
  const db = getDB();
  const result = db.exec(
    `SELECT id, conversation_id, role, content, position, created_at
     FROM messages
     WHERE conversation_id = ? AND role != 'system' AND position > ?
       AND position < COALESCE((
         SELECT MIN(position) FROM (
           SELECT position FROM messages
           WHERE conversation_id = ? AND role != 'system'
           ORDER BY position DESC LIMIT ?
         )
       ), 0)
     ORDER BY position ASC LIMIT ?`,
    [conversationId, lastProcessed, conversationId, numCtx, limit]
  );
  if (result.length === 0) return [];
  return result[0].values.map(mapRow);
}
