import initSqlJs from "sql.js";
import fs from "fs";
import path from "path";
import { appConfig } from "../../config.js";

const DB_PATH = path.resolve(process.cwd(), appConfig.dbPath);

// Debounce da persistência: sql.js exporta o banco INTEIRO a cada save, então
// gravar em disco a cada escrita (várias por turno de chat) bloqueia o event
// loop à toa. saveDB() apenas marca sujo e agenda; flushDB() grava de fato.
const SAVE_DEBOUNCE_MS = 500;

let db = null;
let SQL = null;
let saveTimer = null;
let dirty = false;

export async function initDB()
{
    console.log("Initializing database...");

    // Initialize sql.js
    SQL = await initSqlJs();

    // Load existing database or create new one
    if(fs.existsSync(DB_PATH))
    {
        console.log("Loading existing database from", DB_PATH);
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
    }
    else
    {
        console.log("Creating new database at", DB_PATH);
        db = new SQL.Database();
    }

    return db;
}

export function getDB()
{
    if (!db) throw new Error("Database not initialized. Call initDB() first.");
    return db;
}

export function getSqlJs()
{
    if (!SQL) throw new Error("SQL.js not initialized. Call initDB() first.");
    return SQL;
}

// Agenda a gravação em disco (debounced). Chamar após toda escrita no banco.
export function saveDB()
{
    if (!db) return;
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        flushDB();
    }, SAVE_DEBOUNCE_MS);
    // Não segura o processo aberto — o shutdown chama flushDB() de qualquer forma
    saveTimer.unref?.();
}

// Grava imediatamente se houver escrita pendente. Usada no shutdown.
export function flushDB()
{
    if (!db || !dirty) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    dirty = false;

    const data = db.export();
    const buffer = Buffer.from(data);

    // Ensure data directory exists
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir))
    {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(DB_PATH, buffer);
}

export function closeDB()
{
    if(db)
    {
        flushDB();
        db.close();
        db = null;
    }
}
