import { getDB, saveDB } from "../db.js";

export function getPersona() {
  const db = getDB();
  const result = db.exec(`SELECT * FROM persona LIMIT 1`);
  if (result.length === 0 || result[0].values.length === 0) return null;
  const row = result[0].values[0];
  return {
    id: row[0],
    name: row[1],
    description: row[2],
    avatar_url: row[3],
    created_at: row[4],
    updated_at: row[5],
  };
}

export function savePersona({ name, description = null, avatar_url = null }) {
  const db = getDB();
  db.run(
    `INSERT OR REPLACE INTO persona (id, name, description, avatar_url, updated_at)
     VALUES ('self', ?, ?, ?, CURRENT_TIMESTAMP)`,
    [name, description, avatar_url]
  );
  saveDB();
  return "self";
}
