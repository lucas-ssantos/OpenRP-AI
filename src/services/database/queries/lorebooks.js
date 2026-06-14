import { getDB, saveDB } from "../db.js";
import { v4 as uuidv4 } from "uuid";

const mapLorebook = (row) => ({
  id: row[0],
  scope: row[1],
  character_id: row[2],
  title: row[3],
  content: row[4],
  keywords: row[5],
  insertion_order: row[6],
  created_at: row[7],
  updated_at: row[8],
});

export function createLorebook(title, content, keywords = null, scope = "global", characterId = null) {
  const db = getDB();
  const id = uuidv4();
  db.run(
    `INSERT INTO lorebooks (id, scope, character_id, title, content, keywords)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, scope, characterId, title, content, keywords]
  );
  saveDB();
  return id;
}

export function getLorebook(id) {
  const db = getDB();
  const result = db.exec(`SELECT * FROM lorebooks WHERE id = ?`, [id]);
  if (!result.length || !result[0].values.length) return null;
  return mapLorebook(result[0].values[0]);
}

export function getGlobalLorebooks() {
  const db = getDB();
  const result = db.exec(
    `SELECT * FROM lorebooks WHERE scope = 'global' ORDER BY insertion_order ASC`
  );
  if (result.length === 0) return [];
  return result[0].values.map(mapLorebook);
}

export function getCharacterLorebooks(characterId) {
  const db = getDB();
  const result = db.exec(
    `SELECT * FROM lorebooks WHERE character_id = ? ORDER BY insertion_order ASC`,
    [characterId]
  );
  if (result.length === 0) return [];
  return result[0].values.map(mapLorebook);
}

// Retorna os lorebooks associados ao personagem, ou todos se não houver associação explícita (fallback)
export function getAllLorebooks(characterId) {
  const db = getDB();
  const countResult = db.exec(
    `SELECT COUNT(*) FROM character_lorebooks WHERE character_id = ?`,
    [characterId]
  );
  const hasAssignments = countResult.length > 0 && countResult[0].values[0][0] > 0;

  const sql = hasAssignments
    ? `SELECT l.* FROM lorebooks l
       INNER JOIN character_lorebooks cl ON l.id = cl.lorebook_id
       WHERE cl.character_id = ?
       ORDER BY l.insertion_order ASC`
    : `SELECT * FROM lorebooks ORDER BY insertion_order ASC`;

  const result = db.exec(sql, [characterId]);
  if (result.length === 0) return [];
  return result[0].values.map(mapLorebook);
}

export function updateLorebook(id, { title, content, keywords, insertion_order }) {
  const db = getDB();
  const sets = [];
  const vals = [];
  if (title           !== undefined) { sets.push("title = ?");           vals.push(title); }
  if (content         !== undefined) { sets.push("content = ?");         vals.push(content); }
  if (keywords        !== undefined) { sets.push("keywords = ?");        vals.push(keywords); }
  if (insertion_order !== undefined) { sets.push("insertion_order = ?"); vals.push(insertion_order); }
  if (!sets.length) return false;
  sets.push("updated_at = CURRENT_TIMESTAMP");
  vals.push(id);
  db.run(`UPDATE lorebooks SET ${sets.join(", ")} WHERE id = ?`, vals);
  saveDB();
  return true;
}

export function deleteLorebook(id) {
  const db = getDB();
  db.run(`DELETE FROM character_lorebooks WHERE lorebook_id = ?`, [id]);
  db.run(`DELETE FROM lorebooks WHERE id = ?`, [id]);
  saveDB();
  return true;
}

// ── Character ↔ Lorebook junction ─────────────────────────────────────────────

export function getCharacterLorebookIds(characterId) {
  const db = getDB();
  const result = db.exec(
    `SELECT lorebook_id FROM character_lorebooks WHERE character_id = ?`,
    [characterId]
  );
  return result.length > 0 ? result[0].values.map((r) => r[0]) : [];
}

export function setCharacterLorebooks(characterId, lorebookIds) {
  const db = getDB();
  db.run(`DELETE FROM character_lorebooks WHERE character_id = ?`, [characterId]);
  for (const lid of lorebookIds) {
    db.run(
      `INSERT OR IGNORE INTO character_lorebooks (character_id, lorebook_id) VALUES (?, ?)`,
      [characterId, lid]
    );
  }
  saveDB();
}
