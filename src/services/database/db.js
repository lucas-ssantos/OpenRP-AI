import initSqlJs from "sql.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../../../data/roleplay.db");

let db = null;
let SQL = null;

export async function initDB() {
  console.log("Initializing database...");

  // Initialize sql.js
  SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    console.log("Loading existing database from", DB_PATH);
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    console.log("Creating new database at", DB_PATH);
    db = new SQL.Database();
  }

  return db;
}

export function getDB() {
  if (!db) throw new Error("Database not initialized. Call initDB() first.");
  return db;
}

export function getSqlJs() {
  if (!SQL) throw new Error("SQL.js not initialized. Call initDB() first.");
  return SQL;
}

export function saveDB() {
  if (!db) return;

  const data = db.export();
  const buffer = Buffer.from(data);

  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(DB_PATH, buffer);
  console.log("Database saved to", DB_PATH);
}

export function closeDB() {
  if (db) {
    db.close();
    db = null;
  }
}
