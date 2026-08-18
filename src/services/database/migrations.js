import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { getDB, saveDB } from "./db.js";
import { appConfig } from "../../config.js";

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
  // Personagem carrega apenas: foto, descrição física, personalidade (e lorebooks via tabela própria).
  // Cenário e mensagem inicial vivem na conversa (ver tabela conversations).
  db.run(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      personality TEXT,
      likes TEXT,
      dislikes TEXT,
      physical_traits TEXT,
      avatar_url TEXT,
      affection_points INTEGER DEFAULT 0,
      affection_override INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration para DBs criados antes das colunas likes/dislikes
  try { db.run(`ALTER TABLE characters ADD COLUMN likes TEXT`); } catch {}
  try { db.run(`ALTER TABLE characters ADD COLUMN dislikes TEXT`); } catch {}

  // Migration: traços físicos (tells) usados na seção PHYSICAL TELLS do prompt
  try { db.run(`ALTER TABLE characters ADD COLUMN physical_traits TEXT`); } catch {}

  // Migration: afeição passou de conversa → personagem. Se a coluna acabou de ser
  // criada num DB antigo, herda o maior valor entre as conversas do personagem
  // (a relação mais avançada já alcançada).
  let affectionColumnAdded = false;
  try {
    db.run(`ALTER TABLE characters ADD COLUMN affection_points INTEGER DEFAULT 0`);
    affectionColumnAdded = true;
  } catch {}
  if (affectionColumnAdded) {
    try {
      db.run(`
        UPDATE characters SET affection_points = COALESCE(
          (SELECT MAX(affection_points) FROM conversations WHERE character_id = characters.id), 0
        )
      `);
    } catch { /* DB antigo sem affection_points em conversations — começa em 0 */ }
  }

  // Migration: override manual do estágio de afeição (NULL = progressão automática)
  try { db.run(`ALTER TABLE characters ADD COLUMN affection_override INTEGER`); } catch {}

  // ===== CHARACTER IMAGES (galeria — o chat sorteia uma por sessão) =====
  // characters.avatar_url continua existindo como imagem principal (cards, sidebar,
  // header do chat) e é sempre a primeira imagem da galeria.
  const hadCharacterImages = tableNames.includes("character_images");
  db.run(`
    CREATE TABLE IF NOT EXISTS character_images (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      url TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );
  `);

  // Seed em DBs antigos: o avatar existente vira a primeira imagem da galeria.
  if (!hadCharacterImages) {
    const existing = db.exec(`SELECT id, avatar_url FROM characters WHERE avatar_url IS NOT NULL AND avatar_url != ''`);
    if (existing.length > 0) {
      for (const [charId, avatarUrl] of existing[0].values) {
        db.run(
          `INSERT INTO character_images (id, character_id, url, position) VALUES (?, ?, ?, 0)`,
          [uuidv4(), charId, avatarUrl]
        );
      }
    }
  }

  // ===== CONVERSATIONS =====
  // Cada conversa pertence a um personagem e carrega seu próprio cenário + mensagem inicial.
  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      user_persona TEXT,
      title TEXT,
      scenario TEXT,
      first_message TEXT,
      last_memory_position INTEGER DEFAULT 0,
      last_persona_position INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (character_id) REFERENCES characters(id)
    );
  `);

  // Migration para DBs criados antes do cursor de extração de memórias
  try { db.run(`ALTER TABLE conversations ADD COLUMN last_memory_position INTEGER DEFAULT 0`); } catch {}

  // Migration: cursor da extração de persona facts (perfil do usuário) — em DBs
  // antigos começa em 0, então o histórico existente vira backlog e é minerado
  // gradualmente (mesmo comportamento do cursor de memórias episódicas).
  try { db.run(`ALTER TABLE conversations ADD COLUMN last_persona_position INTEGER DEFAULT 0`); } catch {}

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

  // ===== PERSONA FACTS (perfil do usuário — quem ele é, não o que aconteceu) =====
  // Sistema irmão das memórias episódicas: fatos atemporais sobre o usuário,
  // globais (não pertencem a uma conversa), sempre injetados no prompt.
  // Um fato reconfirmado é reforçado (times_confirmed/confidence sobem); um fato
  // contradito nunca é deletado — vira status='superseded' apontando o substituto,
  // sai do prompt mas permanece no banco como histórico auditável.
  db.run(`
    CREATE TABLE IF NOT EXISTS persona_facts (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL DEFAULT 'fact',
      content TEXT NOT NULL,
      keywords TEXT,
      confidence REAL DEFAULT 0.6,
      times_confirmed INTEGER DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      superseded_by TEXT,
      source_conversation_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      model TEXT NOT NULL DEFAULT 'gemma4:12b',
      temperature REAL DEFAULT 0.85,
      top_p REAL DEFAULT 0.95,
      top_k INTEGER DEFAULT 40,
      min_p REAL DEFAULT 0.05,
      repeat_penalty REAL DEFAULT 1.1,
      repeat_last_n INTEGER DEFAULT 64,
      max_tokens INTEGER DEFAULT -1,
      context_size INTEGER DEFAULT NULL,
      stream INTEGER DEFAULT 1,
      seed INTEGER DEFAULT -1,
      stop TEXT,
      num_ctx_messages INTEGER DEFAULT 20,
      min_tokens INTEGER DEFAULT 60,
      memory_interval INTEGER DEFAULT 5,
      persona_interval INTEGER DEFAULT 10,
      think INTEGER DEFAULT 0,
      think_mode TEXT DEFAULT 'off',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration para DBs existentes sem a coluna memory_interval
  try { db.run(`ALTER TABLE generation_config ADD COLUMN memory_interval INTEGER DEFAULT 5`); } catch {}

  // Migration: intervalo da extração de persona facts (a cada N mensagens do
  // usuário; 0 = desligado).
  try { db.run(`ALTER TABLE generation_config ADD COLUMN persona_interval INTEGER DEFAULT 10`); } catch {}

  // Migration: raciocínio nativo do Ollama (thinking) — desligado por padrão,
  // preserva o comportamento anterior (hardcoded think:false) em DBs existentes.
  try { db.run(`ALTER TABLE generation_config ADD COLUMN think INTEGER DEFAULT 0`); } catch {}

  // Migration: modo de thinking ('off' | 'scoped' | 'always'). Adicionada SEM
  // default para que linhas existentes fiquem NULL e o backfill abaixo rode uma
  // única vez — think=1 legado vira 'always' (comportamento equivalente). O
  // UPDATE é no-op em toda inicialização seguinte (nenhuma linha NULL).
  try { db.run(`ALTER TABLE generation_config ADD COLUMN think_mode TEXT`); } catch {}
  db.run(`UPDATE generation_config SET think_mode = CASE WHEN think = 1 THEN 'always' ELSE 'off' END WHERE think_mode IS NULL`);

  // Seed inicial: usa o preset de "PC médio" (mesclado sobre os defaults do .env, que
  // preenchem campos que o preset não traz, como num_ctx_messages/memory_interval).
  // INSERT OR IGNORE preserva qualquer config já salva pelo usuário.
  let seed = { ...appConfig.defaults };
  try {
    const mediumPath = path.join(process.cwd(), "config_recomendadas", "medium_spec.json");
    seed = { ...seed, ...JSON.parse(fs.readFileSync(mediumPath, "utf8")) };
  } catch { /* sem o arquivo de preset, mantém os defaults do .env */ }
  const d = seed;
  // stop é armazenado como CSV (mesmo formato que setGenerationConfig grava e
  // parseStop lê) — nunca como JSON, senão os tokens chegam corrompidos ao Ollama.
  const stopCsv = Array.isArray(d.stop) ? d.stop.join(", ") : (d.stop || "");
  db.run(`
    INSERT OR IGNORE INTO generation_config
      (id, model, temperature, top_p, top_k, min_p,
       repeat_penalty, repeat_last_n, max_tokens,
       context_size, stream, seed, stop, num_ctx_messages, min_tokens, memory_interval, persona_interval, think, think_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    'global', d.model, d.temperature, d.top_p, d.top_k, d.min_p,
    d.repeat_penalty, d.repeat_last_n, d.max_tokens,
    d.context_size, d.stream ? 1 : 0, d.seed,
    stopCsv, d.num_ctx_messages, d.min_tokens, d.memory_interval ?? 5, d.persona_interval ?? 10,
    d.think_mode && d.think_mode !== 'off' ? 1 : 0, d.think_mode ?? 'off',
  ]);

  // O override de config por personagem foi removido — o único override que
  // existe é o modelo por conversa (conversation_config). Limpa DBs antigos.
  db.run(`DROP TABLE IF EXISTS character_config`);

  // ===== CONVERSATION-SPECIFIC CONFIG =====
  // Override por conversa é model-only (ver resolveConfig / setConversationModel).
  db.run(`
    CREATE TABLE IF NOT EXISTS conversation_config (
      conversation_id TEXT PRIMARY KEY,
      model TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );
  `);

  // ===== CHARACTER ↔ LOREBOOK (many-to-many) =====
  db.run(`
    CREATE TABLE IF NOT EXISTS character_lorebooks (
      character_id TEXT NOT NULL,
      lorebook_id  TEXT NOT NULL,
      PRIMARY KEY (character_id, lorebook_id),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      FOREIGN KEY (lorebook_id)  REFERENCES lorebooks(id)  ON DELETE CASCADE
    );
  `);

  // ===== INDEXES =====
  db.run(`CREATE INDEX IF NOT EXISTS idx_conv_char ON conversations(character_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_char_images ON character_images(character_id, position);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_msg_pos ON messages(conversation_id, position);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_mem_conv ON memories(conversation_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_mem_type ON memories(type);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_mem_pinned ON memories(is_pinned);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pfacts_status ON persona_facts(status);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_lorebook_scope ON lorebooks(scope);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_lorebook_char ON lorebooks(character_id, scope);`);

  saveDB();
  console.log("Migrations completed successfully.");
}
