import { getDB, saveDB } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { localDatetime } from "../../../utils/datetime.js";

export function getCharacterImages(characterId) {
  const db = getDB();
  const result = db.exec(
    `SELECT id, url, position FROM character_images
     WHERE character_id = ?
     ORDER BY position ASC, created_at ASC`,
    [characterId]
  );
  if (result.length === 0) return [];
  return result[0].values.map((row) => ({ id: row[0], url: row[1], position: row[2] }));
}

export function addCharacterImages(characterId, urls) {
  if (!urls || urls.length === 0) return [];
  const db = getDB();
  const now = localDatetime();
  const ids = [];
  for (const url of urls) {
    const id = uuidv4();
    db.run(
      `INSERT INTO character_images (id, character_id, url, position, created_at)
       VALUES (?, ?, ?, COALESCE((SELECT MAX(position) + 1 FROM character_images WHERE character_id = ?), 0), ?)`,
      [id, characterId, url, characterId, now]
    );
    ids.push(id);
  }
  saveDB();
  return ids;
}

// Remove a imagem e retorna a URL removida (ou null se não pertencer ao personagem).
export function deleteCharacterImage(characterId, imageId) {
  const db = getDB();
  const result = db.exec(
    `SELECT url FROM character_images WHERE id = ? AND character_id = ?`,
    [imageId, characterId]
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  const url = result[0].values[0][0];
  db.run(`DELETE FROM character_images WHERE id = ? AND character_id = ?`, [imageId, characterId]);
  saveDB();
  return url;
}
