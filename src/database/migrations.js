import { getDB } from "./db.js";

export function migrate(){

    const db = getDB();

    db.run(`

        CREATE TABLE IF NOT EXISTS settings (

            key TEXT PRIMARY KEY,

            value TEXT,

            type TEXT

        )

    `);


    db.run(`

        CREATE TABLE IF NOT EXISTS generation_presets (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            name TEXT,

            temperature REAL,

            top_p REAL,

            top_k INTEGER,

            min_p REAL,

            repeat_penalty REAL,

            num_ctx INTEGER,

            max_tokens INTEGER,

            stream INTEGER

        )

    `);


    db.run(`

        CREATE TABLE IF NOT EXISTS characters (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            name TEXT,

            display_name TEXT,

            description TEXT,

            personality TEXT,

            scenario TEXT,

            first_message TEXT,

            avatar TEXT,

            tags TEXT,

            creator_notes TEXT,

            preset_id INTEGER,

            override_enabled INTEGER DEFAULT 0,

            temperature REAL,

            top_p REAL,

            top_k INTEGER,

            min_p REAL,

            repeat_penalty REAL,

            num_ctx INTEGER,

            max_tokens INTEGER,

            history_messages INTEGER

        )

    `);


    db.run(`

        CREATE TABLE IF NOT EXISTS chats (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            character_id INTEGER,

            title TEXT,

            created_at DATETIME,

            updated_at DATETIME

        )

    `);


    db.run(`

        CREATE TABLE IF NOT EXISTS messages (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            chat_id INTEGER,

            role TEXT,

            content TEXT,

            token_count INTEGER,

            created_at DATETIME

        )

    `);


    db.run(`

        CREATE TABLE IF NOT EXISTS memories (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            chat_id INTEGER,

            content TEXT,

            importance INTEGER,

            created_at DATETIME

        )

    `);


    db.run(`

        CREATE TABLE IF NOT EXISTS summaries (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            chat_id INTEGER,

            content TEXT,

            created_at DATETIME

        )

    `);

}