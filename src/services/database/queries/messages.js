import { getDB, saveDB } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { localDatetime } from "../../../utils/datetime.js";
import { deletePersonaFactsForConversation } from "./personaFacts.js";

const mapRow = (row) => ({
  id: row[0], conversation_id: row[1], role: row[2],
  content: row[3], position: row[4], automated: row[5] === 1, created_at: row[6],
});

// position null → calcula MAX(position)+1 no próprio SQL, evitando colisão
// quando duas requisições calculam a posição em paralelo no JS.
export function addMessage(conversationId, role, content, position = null, automated = false) {
  const db = getDB();
  const id = uuidv4();
  if (position === null || position === undefined) {
    db.run(
      `INSERT INTO messages (id, conversation_id, role, content, position, automated, created_at)
       VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM messages WHERE conversation_id = ?), ?, ?)`,
      [id, conversationId, role, content, conversationId, automated ? 1 : 0, localDatetime()]
    );
  } else {
    db.run(
      `INSERT INTO messages (id, conversation_id, role, content, position, automated, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, conversationId, role, content, position, automated ? 1 : 0, localDatetime()]
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
    `SELECT id, conversation_id, role, content, position, automated, created_at
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
  // Clampeia os cursores de extração (memórias e persona facts): mensagens
  // reescritas após o rollback não podem ser consideradas "já processadas".
  // O marco do novo histórico também não pode ficar à frente do ponto de
  // rollback — senão as próximas mensagens cairiam antes dele e ficariam fora
  // do prompt até a posição ultrapassar o marco antigo.
  db.run(
    `UPDATE conversations SET
       last_memory_position  = MIN(last_memory_position, ?),
       last_persona_position = MIN(last_persona_position, ?),
       history_start_position = CASE
         WHEN history_start_position IS NOT NULL AND history_start_position > ? THEN ?
         ELSE history_start_position
       END
     WHERE id = ?`,
    [position, position, position, position, conversationId]
  );
  saveDB();
  return true;
}

// Apaga mensagens, memórias e fatos de persona extraídos desta conversa.
export function resetConversation(conversationId) {
  const db = getDB();
  db.run(`DELETE FROM messages WHERE conversation_id = ?`, [conversationId]);
  db.run(`DELETE FROM memories WHERE conversation_id = ?`, [conversationId]);
  deletePersonaFactsForConversation(conversationId);
  db.run(`UPDATE conversations SET
            last_memory_position = 0,
            last_persona_position = 0,
            history_start_position = CASE WHEN omit_history = 1 THEN -1 ELSE NULL END
          WHERE id = ?`, [conversationId]);
  saveDB();
}

export function getConversationMessages(conversationId) {
  const db = getDB();
  const result = db.exec(
    `SELECT id, conversation_id, role, content, position, automated, created_at
     FROM messages WHERE conversation_id = ? ORDER BY position ASC, created_at ASC`,
    [conversationId]
  );
  if (result.length === 0) return [];
  return result[0].values.map(mapRow);
}

// Últimas N mensagens não-system da conversa, mais antiga primeiro.
// N é o total (user + assistant juntos) — a mesma definição de "janela de
// contexto" usada pelo gatilho de memórias (trigger.js).
// afterPosition (opcional): só mensagens com position > marco — usado pelo
// "novo histórico" para começar a janela depois do ponto de ativação.
export function getLastNMessages(conversationId, n = 20, afterPosition = null) {
  const db = getDB();
  const hasStart = Number.isInteger(afterPosition);
  const params = [conversationId];
  if (hasStart) params.push(afterPosition);
  params.push(n);
  const result = db.exec(
    `SELECT id, conversation_id, role, content, position, automated, created_at
     FROM messages
     WHERE conversation_id = ? AND role != 'system'
       ${hasStart ? "AND position > ?" : ""}
     ORDER BY position DESC LIMIT ?`,
    params
  );
  if (result.length === 0) return [];
  return result[0].values.map(mapRow).reverse();
}

// Mensagens novas para extração: cursor exclusivo, mais antigas primeiro.
export function getPersonaBacklog(conversationId, lastProcessed, limit) {
  const db = getDB();
  const result = db.exec(
    `SELECT id, conversation_id, role, content, position, automated, created_at
     FROM messages
     WHERE conversation_id = ? AND role != 'system' AND position > ?
     ORDER BY position ASC LIMIT ?`,
    [conversationId, lastProcessed, limit]
  );
  if (result.length === 0) return [];
  return result[0].values.map(mapRow);
}

// Backlog de memórias: todas as mensagens ainda não processadas anteriores às
// mais recentes. Feito direto no SQL para não carregar tudo a cada turno.
export function getMemoryBacklog(conversationId, lastProcessed, recentCount) {
  const db = getDB();
  const result = db.exec(
    `SELECT id, conversation_id, role, content, position, automated, created_at
     FROM messages
     WHERE conversation_id = ? AND role != 'system' AND position > ?
       AND position < COALESCE((
         SELECT MIN(position) FROM (
           SELECT position FROM messages
           WHERE conversation_id = ? AND role != 'system'
           ORDER BY position DESC LIMIT ?
         )
       ), 0)
     ORDER BY position ASC`,
    [conversationId, lastProcessed, conversationId, recentCount]
  );
  if (result.length === 0) return [];
  return result[0].values.map(mapRow);
}
