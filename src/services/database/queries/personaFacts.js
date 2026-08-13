import { getDB, saveDB } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { localDatetime } from "../../../utils/datetime.js";

// Categorias válidas de um persona fact — qualquer outra vira 'fact' na criação.
export const PERSONA_FACT_CATEGORIES = ["preference", "dislike", "trait", "fact", "relationship", "goal"];

const FACT_COLUMNS = `id, category, content, keywords, confidence, times_confirmed, status, superseded_by, source_conversation_id, created_at, updated_at`;

const mapFact = (row) => ({
  id: row[0],
  category: row[1],
  content: row[2],
  keywords: row[3],
  confidence: row[4],
  times_confirmed: row[5],
  status: row[6],
  superseded_by: row[7],
  source_conversation_id: row[8],
  created_at: row[9],
  updated_at: row[10],
});

export function createPersonaFact({ category, content, keywords = null, confidence = 0.6, sourceConversationId = null } = {}) {
  if (!content?.trim()) throw new Error("Persona fact requer conteúdo.");
  const cat = PERSONA_FACT_CATEGORIES.includes(category) ? category : "fact";
  const db = getDB();
  const id = uuidv4();
  const now = localDatetime();
  db.run(
    `INSERT INTO persona_facts (id, category, content, keywords, confidence, times_confirmed, status, source_conversation_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?, ?)`,
    [id, cat, content.trim(), keywords, confidence, sourceConversationId, now, now]
  );
  saveDB();
  return id;
}

// Fatos ativos (os que entram no prompt), mais confiáveis primeiro.
// `limit` opcional — o cap de injeção no prompt fica no caller.
export function getActivePersonaFacts(limit = null) {
  const db = getDB();
  const sql = `SELECT ${FACT_COLUMNS} FROM persona_facts WHERE status = 'active'
               ORDER BY confidence DESC, times_confirmed DESC, updated_at DESC` +
              (limit ? ` LIMIT ?` : ``);
  const result = db.exec(sql, limit ? [limit] : []);
  if (result.length === 0) return [];
  return result[0].values.map(mapFact);
}

// Todos os fatos, incluindo os superados — usado na UI da persona e auditoria.
export function getAllPersonaFacts() {
  const db = getDB();
  const result = db.exec(
    `SELECT ${FACT_COLUMNS} FROM persona_facts
     ORDER BY status = 'active' DESC, confidence DESC, times_confirmed DESC, updated_at DESC`
  );
  if (result.length === 0) return [];
  return result[0].values.map(mapFact);
}

// Reforço: o fato foi reconfirmado na conversa — sobe o contador e a confiança
// (cap em 1.0) em vez de criar uma duplicata.
export function reinforcePersonaFact(id) {
  const db = getDB();
  db.run(
    `UPDATE persona_facts
     SET times_confirmed = times_confirmed + 1,
         confidence = MIN(1.0, confidence + 0.1),
         updated_at = ?
     WHERE id = ? AND status = 'active'`,
    [localDatetime(), id]
  );
  const changed = db.getRowsModified() > 0;
  if (changed) saveDB();
  return changed;
}

// Contradição: o fato antigo sai do prompt mas fica no banco como histórico,
// apontando para o fato que o substituiu.
export function supersedePersonaFact(oldId, newId) {
  const db = getDB();
  db.run(
    `UPDATE persona_facts SET status = 'superseded', superseded_by = ?, updated_at = ?
     WHERE id = ? AND status = 'active'`,
    [newId, localDatetime(), oldId]
  );
  const changed = db.getRowsModified() > 0;
  if (changed) saveDB();
  return changed;
}

export function deletePersonaFact(id) {
  const db = getDB();
  db.run(`DELETE FROM persona_facts WHERE id = ?`, [id]);
  const changed = db.getRowsModified() > 0;
  if (changed) saveDB();
  return changed;
}
