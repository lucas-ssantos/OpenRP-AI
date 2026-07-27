import { getDB, saveDB } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { localDatetime } from "../../../utils/datetime.js";

const CHAR_COLUMNS = `id, name, description, personality, likes, dislikes, avatar_url, affection_points, affection_override, created_at, updated_at`;

function mapCharacterRow(row) {
  return {
    id: row[0],
    name: row[1],
    description: row[2],
    personality: row[3],
    likes: row[4],
    dislikes: row[5],
    avatar_url: row[6],
    affection_points: row[7] ?? 0,
    affection_override: row[8] ?? null,
    created_at: row[9],
    updated_at: row[10],
  };
}

export function createCharacter(name, description, personality, avatarUrl = null, likes = null, dislikes = null) {
  const db = getDB();
  const id = uuidv4();
  const now = localDatetime();
  db.run(
    `INSERT INTO characters (id, name, description, personality, likes, dislikes, avatar_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, description, personality, likes, dislikes, avatarUrl, now, now]
  );
  saveDB();
  return id;
}

export function getCharacter(characterId) {
  const db = getDB();
  const result = db.exec(`SELECT ${CHAR_COLUMNS} FROM characters WHERE id = ?`, [characterId]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  return mapCharacterRow(result[0].values[0]);
}

export function getAllCharacters() {
  const db = getDB();
  const result = db.exec(`SELECT ${CHAR_COLUMNS} FROM characters`);
  if (result.length === 0) return [];
  return result[0].values.map(mapCharacterRow);
}

export function updateCharacter(id, { name, description, personality, likes, dislikes, avatar_url, affection_override }) {
  const db = getDB();
  const sets = [];
  const vals = [];

  if (name !== undefined)          { sets.push("name = ?");          vals.push(name); }
  if (description !== undefined)   { sets.push("description = ?");   vals.push(description); }
  if (personality !== undefined)   { sets.push("personality = ?");   vals.push(personality); }
  if (likes !== undefined)         { sets.push("likes = ?");         vals.push(likes); }
  if (dislikes !== undefined)      { sets.push("dislikes = ?");      vals.push(dislikes); }
  if (avatar_url !== undefined)    { sets.push("avatar_url = ?");    vals.push(avatar_url); }
  // null = volta para a progressão automática por pontos
  if (affection_override !== undefined) { sets.push("affection_override = ?"); vals.push(affection_override); }

  if (sets.length === 0) return false;
  sets.push("updated_at = ?");
  vals.push(localDatetime());
  vals.push(id);

  db.run(`UPDATE characters SET ${sets.join(", ")} WHERE id = ?`, vals);
  saveDB();
  return true;
}

// Apaga o personagem e tudo que depende dele: conversas (com mensagens/memórias/
// override de modelo), galeria de imagens e associações de lorebook. As URLs das
// imagens devem ser lidas (getCharacterImages) e os arquivos removidos do disco
// pela rota ANTES de chamar esta função — aqui só apaga as linhas do banco.
export function deleteCharacter(characterId) {
  const db = getDB();
  db.run(
    `DELETE FROM memories WHERE conversation_id IN (SELECT id FROM conversations WHERE character_id = ?)`,
    [characterId]
  );
  db.run(
    `DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE character_id = ?)`,
    [characterId]
  );
  db.run(
    `DELETE FROM conversation_config WHERE conversation_id IN (SELECT id FROM conversations WHERE character_id = ?)`,
    [characterId]
  );
  db.run(`DELETE FROM conversations WHERE character_id = ?`, [characterId]);
  db.run(`DELETE FROM character_lorebooks WHERE character_id = ?`, [characterId]);
  db.run(`DELETE FROM character_images WHERE character_id = ?`, [characterId]);
  db.run(`DELETE FROM characters WHERE id = ?`, [characterId]);
  const changed = db.getRowsModified() > 0;
  saveDB();
  return changed;
}

// Soma pontos de afeto ao personagem e retorna o total atualizado.
export function addAffectionPoints(characterId, delta) {
  const db = getDB();
  db.run(
    `UPDATE characters SET affection_points = MAX(0, affection_points + ?) WHERE id = ?`,
    [delta, characterId]
  );
  const result = db.exec(`SELECT affection_points FROM characters WHERE id = ?`, [characterId]);
  saveDB();
  if (result.length === 0 || result[0].values.length === 0) return 0;
  return result[0].values[0][0] ?? 0;
}
