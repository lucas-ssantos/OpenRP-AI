import { getDB, saveDB } from "./db.js";

export async function migrate() {
  console.log("Running migrations...");

  const db = getDB();

  // Check if tables already exist to avoid re-running
  const tables = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table';"
  );

  const tableNames = tables.length > 0 ? tables[0].values.map((row) => row[0]) : [];
  if (tableNames.length === 0) {
    console.log("Creating database schema...");
  } else {
    console.log("Applying missing migrations if needed...");
  }

  // ===== CHARACTERS =====
  db.run(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      personality TEXT,
      avatar_url TEXT,
      scenario TEXT,
      first_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ===== CONVERSATIONS =====
  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      user_persona TEXT,
      title TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (character_id) REFERENCES characters(id)
    );
  `);

  // ===== PERSONA =====
  db.run(`
    CREATE TABLE IF NOT EXISTS persona (
      id TEXT PRIMARY KEY DEFAULT 'self',
      name TEXT NOT NULL,
      description TEXT,
      avatar_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ===== MESSAGES =====
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      position INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );
  `);

  // ===== MEMORIES (auto, manual, pinned) =====
  db.run(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'manual',
      content TEXT NOT NULL,
      summary TEXT,
      keywords TEXT,
      is_pinned INTEGER DEFAULT 0,
      relevance_weight REAL DEFAULT 1.0,
      vector BLOB,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );
  `);

  // ===== LOREBOOKS (World Info, ativado por keywords) =====
  db.run(`
    CREATE TABLE IF NOT EXISTS lorebooks (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'global',
      character_id TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      keywords TEXT,
      insertion_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (character_id) REFERENCES characters(id)
    );
  `);

  // ===== GENERATION CONFIG (global defaults) =====
  db.run(`
    CREATE TABLE IF NOT EXISTS generation_config (
      id TEXT PRIMARY KEY DEFAULT 'global',
      model TEXT NOT NULL DEFAULT 'qwen3:8b',
      temperature REAL DEFAULT 0.85,
      top_p REAL DEFAULT 0.95,
      top_k INTEGER DEFAULT 40,
      min_p REAL DEFAULT 0.05,
      repeat_penalty REAL DEFAULT 1.1,
      repeat_last_n INTEGER DEFAULT 64,
      tfs_z REAL DEFAULT 1.0,
      max_tokens INTEGER DEFAULT 512,
      context_size INTEGER DEFAULT 4096,
      stream INTEGER DEFAULT 1,
      seed INTEGER DEFAULT -1,
      stop TEXT,
      num_ctx_messages INTEGER DEFAULT 20,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ===== CHARACTER-SPECIFIC CONFIG =====
  db.run(`
    CREATE TABLE IF NOT EXISTS character_config (
      character_id TEXT PRIMARY KEY,
      model TEXT,
      temperature REAL,
      top_p REAL,
      top_k INTEGER,
      min_p REAL,
      repeat_penalty REAL,
      repeat_last_n INTEGER,
      tfs_z REAL,
      max_tokens INTEGER,
      context_size INTEGER,
      stream INTEGER,
      seed INTEGER,
      stop TEXT,
      num_ctx_messages INTEGER,
      system_prompt TEXT,
      jailbreak TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (character_id) REFERENCES characters(id)
    );
  `);

  // ===== CONVERSATION-SPECIFIC CONFIG =====
  db.run(`
    CREATE TABLE IF NOT EXISTS conversation_config (
      conversation_id TEXT PRIMARY KEY,
      model TEXT,
      temperature REAL,
      top_p REAL,
      top_k INTEGER,
      min_p REAL,
      repeat_penalty REAL,
      repeat_last_n INTEGER,
      tfs_z REAL,
      max_tokens INTEGER,
      context_size INTEGER,
      stream INTEGER,
      seed INTEGER,
      stop TEXT,
      num_ctx_messages INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );
  `);

  // ===== TOKEN TRACKING (para context management) =====
  db.run(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      message_id TEXT,
      estimated_tokens INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (message_id) REFERENCES messages(id)
    );
  `);

  // ===== INDEXES =====
  db.run(`CREATE INDEX IF NOT EXISTS idx_conv_char ON conversations(character_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_msg_pos ON messages(conversation_id, position);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_mem_conv ON memories(conversation_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_mem_type ON memories(type);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_mem_pinned ON memories(is_pinned);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_lorebook_scope ON lorebooks(scope);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_lorebook_char ON lorebooks(character_id, scope);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_token_conv ON token_usage(conversation_id);`);

  saveDB();
  console.log("Migrations completed successfully.");
}
