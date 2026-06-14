import { getDB, saveDB } from "../db.js";
import { v4 as uuidv4 } from "uuid";

export function createCharacter(name, description, personality, avatarUrl = null, scenario = null, firstMessage = null) {
  const db = getDB();
  const id = uuidv4();
  db.run(
    `INSERT INTO characters (id, name, description, personality, avatar_url, scenario, first_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, name, description, personality, avatarUrl, scenario, firstMessage]
  );
  saveDB();
  return id;
}

export function getCharacter(characterId) {
  const db = getDB();
  const result = db.exec(`SELECT * FROM characters WHERE id = ?`, [characterId]);
  if (result.length === 0) return null;
  const row = result[0].values[0];
  return {
    id: row[0],
    name: row[1],
    description: row[2],
    personality: row[3],
    avatar_url: row[4],
    scenario: row[5],
    first_message: row[6],
    created_at: row[7],
    updated_at: row[8],
  };
}

export function getAllCharacters() {
  const db = getDB();
  const result = db.exec(`SELECT * FROM characters`);
  if (result.length === 0) return [];
  return result[0].values.map((row) => ({
    id: row[0],
    name: row[1],
    description: row[2],
    personality: row[3],
    avatar_url: row[4],
    scenario: row[5],
    first_message: row[6],
    created_at: row[7],
    updated_at: row[8],
  }));
}

export function updateCharacter(id, { name, description, personality, avatar_url, scenario, first_message }) {
  const db = getDB();
  const sets = [];
  const vals = [];

  if (name !== undefined)          { sets.push("name = ?");          vals.push(name); }
  if (description !== undefined)   { sets.push("description = ?");   vals.push(description); }
  if (personality !== undefined)   { sets.push("personality = ?");   vals.push(personality); }
  if (avatar_url !== undefined)    { sets.push("avatar_url = ?");    vals.push(avatar_url); }
  if (scenario !== undefined)      { sets.push("scenario = ?");      vals.push(scenario); }
  if (first_message !== undefined) { sets.push("first_message = ?"); vals.push(first_message); }

  if (sets.length === 0) return false;
  sets.push("updated_at = CURRENT_TIMESTAMP");
  vals.push(id);

  db.run(`UPDATE characters SET ${sets.join(", ")} WHERE id = ?`, vals);
  saveDB();
  return true;
}
