import { getDB, saveDB } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { localDatetime } from "../../../utils/datetime.js";

// Categorias válidas de um persona fact — qualquer outra vira 'fact' na criação.
export const PERSONA_FACT_CATEGORIES = ["preference", "dislike", "trait", "fact", "relationship", "goal"];

const FACT_COLUMNS = `persona_facts.id, persona_facts.category, persona_facts.character_id, persona_facts.content, persona_facts.keywords, persona_facts.confidence, persona_facts.times_confirmed, persona_facts.status, persona_facts.superseded_by, persona_facts.source_conversation_id, persona_facts.created_at, persona_facts.updated_at`;

const mapFact = (row) => ({
  id: row[0],
  category: row[1],
  character_id: row[2],
  content: row[3],
  keywords: row[4],
  confidence: row[5],
  times_confirmed: row[6],
  status: row[7],
  superseded_by: row[8],
  source_conversation_id: row[9],
  created_at: row[10],
  updated_at: row[11],
  character_name: row[12] ?? null,
});

export function createPersonaFact({ category, characterId = null, content, keywords = null, confidence = 0.6, sourceConversationId = null } = {}) {
  if (!content?.trim()) throw new Error("Persona fact requer conteúdo.");
  const cat = PERSONA_FACT_CATEGORIES.includes(category) ? category : "fact";
  const db = getDB();
  const id = uuidv4();
  const now = localDatetime();
  db.run(
    `INSERT INTO persona_facts (id, category, character_id, content, keywords, confidence, times_confirmed, status, source_conversation_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'active', ?, ?, ?)`,
    [id, cat, characterId, content.trim(), keywords, confidence, sourceConversationId, now, now]
  );
  saveDB();
  return id;
}

// Fatos ativos (os que entram no prompt), mais confiáveis primeiro.
// `limit` opcional — o cap de injeção no prompt fica no caller.
export function getActivePersonaFacts(limit = null, characterId = null) {
  const db = getDB();
  const scopedFilter = characterId === null
    ? ` AND character_id IS NULL`
    : ` AND (character_id IS NULL OR character_id = ?)`;
  const sql = `SELECT ${FACT_COLUMNS} FROM persona_facts WHERE status = 'active'${scopedFilter}
               ORDER BY confidence DESC, times_confirmed DESC, updated_at DESC` +
              (limit ? ` LIMIT ?` : ``);
  const params = [];
  if (characterId !== null) params.push(characterId);
  if (limit) params.push(limit);
  const result = db.exec(sql, params);
  if (result.length === 0) return [];
  return result[0].values.map(mapFact);
}

// Todos os fatos, incluindo os superados — usado na UI da persona e auditoria.
export function getAllPersonaFacts() {
  const db = getDB();
  const result = db.exec(
    `SELECT ${FACT_COLUMNS}, characters.name FROM persona_facts
     LEFT JOIN characters ON characters.id = persona_facts.character_id
     ORDER BY persona_facts.status = 'active' DESC, persona_facts.confidence DESC,
              persona_facts.times_confirmed DESC, persona_facts.updated_at DESC`
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

export function deletePersonaFactsForConversation(conversationId) {
  const db = getDB();
  db.run(
    `UPDATE persona_facts SET superseded_by = NULL
     WHERE superseded_by IN (
       SELECT id FROM persona_facts WHERE source_conversation_id = ?
     )`,
    [conversationId]
  );
  const referencesChanged = db.getRowsModified() > 0;
  db.run(`DELETE FROM persona_facts WHERE source_conversation_id = ?`, [conversationId]);
  const changed = referencesChanged || db.getRowsModified() > 0;
  if (changed) saveDB();
  return changed;
}

export function deletePersonaFactsForCharacter(characterId) {
  const db = getDB();
  const relatedFacts = `character_id = ?
    OR source_conversation_id IN (SELECT id FROM conversations WHERE character_id = ?)`;
  db.run(
    `UPDATE persona_facts SET superseded_by = NULL
     WHERE superseded_by IN (
       SELECT id FROM persona_facts WHERE ${relatedFacts}
     )`,
    [characterId, characterId]
  );
  const referencesChanged = db.getRowsModified() > 0;
  db.run(`DELETE FROM persona_facts WHERE ${relatedFacts}`, [characterId, characterId]);
  const changed = referencesChanged || db.getRowsModified() > 0;
  if (changed) saveDB();
  return changed;
}
