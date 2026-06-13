import { getDB, saveDB } from "./db.js";
import { v4 as uuidv4 } from "uuid";

// ===== Characters =====
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
  const result = db.exec(
    `SELECT * FROM characters WHERE id = ?`,
    [characterId]
  );
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

// ===== Persona =====
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
  const id = 'self';
  db.run(
    `INSERT OR REPLACE INTO persona (id, name, description, avatar_url, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [id, name, description, avatar_url]
  );
  saveDB();
  return id;
}

// ===== Conversations =====
export function createConversation(characterId, userPersona = null, title = null) {
  const db = getDB();
  const id = uuidv4();
  db.run(
    `INSERT INTO conversations (id, character_id, user_persona, title)
     VALUES (?, ?, ?, ?)`,
    [id, characterId, userPersona, title]
  );
  saveDB();
  return id;
}

export function getConversation(conversationId) {
  const db = getDB();
  const result = db.exec(
    `SELECT * FROM conversations WHERE id = ?`,
    [conversationId]
  );
  if (result.length === 0) return null;
  const row = result[0].values[0];
  return {
    id: row[0],
    character_id: row[1],
    user_persona: row[2],
    title: row[3],
    created_at: row[4],
    updated_at: row[5],
  };
}

// ===== Messages =====
export function addMessage(conversationId, role, content, position = null) {
  const db = getDB();
  const id = uuidv4();
  db.run(
    `INSERT INTO messages (id, conversation_id, role, content, position)
     VALUES (?, ?, ?, ?, ?)`,
    [id, conversationId, role, content, position]
  );
  saveDB();
  return id;
}

export function getConversationMessages(conversationId) {
  const db = getDB();
  const result = db.exec(
    `SELECT * FROM messages WHERE conversation_id = ? ORDER BY position ASC, created_at ASC`,
    [conversationId]
  );
  if (result.length === 0) return [];
  return result[0].values.map((row) => ({
    id: row[0],
    conversation_id: row[1],
    role: row[2],
    content: row[3],
    position: row[4],
    created_at: row[5],
  }));
}

export function getLastNMessages(conversationId, n = 20) {
  const db = getDB();
  const result = db.exec(
    `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ? `,
    [conversationId, n]
  );
  if (result.length === 0) return [];
  return result[0].values.reverse().map((row) => ({
    id: row[0],
    conversation_id: row[1],
    role: row[2],
    content: row[3],
    position: row[4],
    created_at: row[5],
  }));
}

// ===== Memories (auto, manual, pinned) =====
export function createMemory(conversationId, type, content, keywords = null, relevanceWeight = 1.0, isPinned = false, summary = null) {
  const db = getDB();
  const id = uuidv4();
  db.run(
    `INSERT INTO memories (id, conversation_id, type, content, summary, keywords, is_pinned, relevance_weight)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, conversationId, type, content, summary, keywords, isPinned ? 1 : 0, relevanceWeight]
  );
  saveDB();
  return id;
}

export function getMemories(conversationId) {
  const db = getDB();
  const result = db.exec(
    `SELECT * FROM memories WHERE conversation_id = ? ORDER BY is_pinned DESC, relevance_weight DESC`,
    [conversationId]
  );
  if (result.length === 0) return [];
  return result[0].values.map((row) => ({
    id: row[0],
    conversation_id: row[1],
    type: row[2],
    content: row[3],
    summary: row[4],
    keywords: row[5],
    is_pinned: row[6] === 1,
    relevance_weight: row[7],
    vector: row[8],
    created_at: row[9],
    updated_at: row[10],
  }));
}

export function getPinnedMemories(conversationId) {
  const db = getDB();
  const result = db.exec(
    `SELECT * FROM memories WHERE conversation_id = ? AND is_pinned = 1`,
    [conversationId]
  );
  if (result.length === 0) return [];
  return result[0].values.map((row) => ({
    id: row[0],
    conversation_id: row[1],
    type: row[2],
    content: row[3],
    summary: row[4],
    keywords: row[5],
    is_pinned: row[6] === 1,
    relevance_weight: row[7],
    vector: row[8],
    created_at: row[9],
    updated_at: row[10],
  }));
}

export function getMemoriesByType(conversationId, type) {
  const db = getDB();
  const result = db.exec(
    `SELECT * FROM memories WHERE conversation_id = ? AND type = ? ORDER BY relevance_weight DESC`,
    [conversationId, type]
  );
  if (result.length === 0) return [];
  return result[0].values.map((row) => ({
    id: row[0],
    conversation_id: row[1],
    type: row[2],
    content: row[3],
    summary: row[4],
    keywords: row[5],
    is_pinned: row[6] === 1,
    relevance_weight: row[7],
    vector: row[8],
    created_at: row[9],
    updated_at: row[10],
  }));
}

// ===== Lorebooks (World Info) =====
export function createLorebook(title, content, keywords = null, scope = 'global', characterId = null) {
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

export function getGlobalLorebooks() {
  const db = getDB();
  const result = db.exec(
    `SELECT * FROM lorebooks WHERE scope = 'global' ORDER BY insertion_order ASC`
  );
  if (result.length === 0) return [];
  return result[0].values.map((row) => ({
    id: row[0],
    scope: row[1],
    character_id: row[2],
    title: row[3],
    content: row[4],
    keywords: row[5],
    insertion_order: row[6],
    created_at: row[7],
    updated_at: row[8],
  }));
}

export function getCharacterLorebooks(characterId) {
  const db = getDB();
  const result = db.exec(
    `SELECT * FROM lorebooks WHERE character_id = ? ORDER BY insertion_order ASC`,
    [characterId]
  );
  if (result.length === 0) return [];
  return result[0].values.map((row) => ({
    id: row[0],
    scope: row[1],
    character_id: row[2],
    title: row[3],
    content: row[4],
    keywords: row[5],
    insertion_order: row[6],
    created_at: row[7],
    updated_at: row[8],
  }));
}

export function getAllLorebooks(characterId) {
  const db = getDB();
  const result = db.exec(
    `SELECT * FROM lorebooks WHERE scope = 'global' OR character_id = ? ORDER BY insertion_order ASC`,
    [characterId]
  );
  if (result.length === 0) return [];
  return result[0].values.map((row) => ({
    id: row[0],
    scope: row[1],
    character_id: row[2],
    title: row[3],
    content: row[4],
    keywords: row[5],
    insertion_order: row[6],
    created_at: row[7],
    updated_at: row[8],
  }));
}

// ===== Generation Config =====
export function getGenerationConfig(level = 'global', id = null) {
  const db = getDB();
  let query = '';
  let params = [];

  if (level === 'global') {
    query = 'SELECT * FROM generation_config WHERE id = ?';
    params = ['global'];
  } else if (level === 'character') {
    query = 'SELECT * FROM character_config WHERE character_id = ?';
    params = [id];
  } else if (level === 'conversation') {
    query = 'SELECT * FROM conversation_config WHERE conversation_id = ?';
    params = [id];
  }

  const result = db.exec(query, params);
  if (result.length === 0) return null;
  
  const row = result[0].values[0];
  return {
    model: row[1],
    temperature: row[2],
    top_p: row[3],
    top_k: row[4],
    min_p: row[5],
    repeat_penalty: row[6],
    max_tokens: row[7],
    context_size: row[8],
    stream: row[9] === 1,
    num_ctx_messages: row[10],
  };
}

export function setGenerationConfig(level = 'global', id = null, config = {}) {
  const db = getDB();
  const now = new Date().toISOString();

  if (level === 'global') {
    const { model, temperature, top_p, top_k, min_p, repeat_penalty, max_tokens, context_size, stream, num_ctx_messages } = config;
    db.run(
      `INSERT OR REPLACE INTO generation_config 
       (id, model, temperature, top_p, top_k, min_p, repeat_penalty, max_tokens, context_size, stream, num_ctx_messages, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['global', model, temperature, top_p, top_k, min_p, repeat_penalty, max_tokens, context_size, stream ? 1 : 0, num_ctx_messages, now]
    );
  } else if (level === 'character') {
    const { model, temperature, top_p, top_k, min_p, repeat_penalty, max_tokens, context_size, stream, num_ctx_messages, system_prompt, jailbreak } = config;
    db.run(
      `INSERT OR REPLACE INTO character_config 
       (character_id, model, temperature, top_p, top_k, min_p, repeat_penalty, max_tokens, context_size, stream, num_ctx_messages, system_prompt, jailbreak, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, model, temperature, top_p, top_k, min_p, repeat_penalty, max_tokens, context_size, stream ? 1 : 0, num_ctx_messages, system_prompt, jailbreak, now]
    );
  } else if (level === 'conversation') {
    const { model, temperature, top_p, top_k, min_p, repeat_penalty, max_tokens, context_size, stream, num_ctx_messages } = config;
    db.run(
      `INSERT OR REPLACE INTO conversation_config 
       (conversation_id, model, temperature, top_p, top_k, min_p, repeat_penalty, max_tokens, context_size, stream, num_ctx_messages, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, model, temperature, top_p, top_k, min_p, repeat_penalty, max_tokens, context_size, stream ? 1 : 0, num_ctx_messages, now]
    );
  }

  saveDB();
}

// ===== Token Usage =====
export function recordTokenUsage(conversationId, messageId = null, estimatedTokens = 0) {
  const db = getDB();
  const id = uuidv4();
  db.run(
    `INSERT INTO token_usage (id, conversation_id, message_id, estimated_tokens)
     VALUES (?, ?, ?, ?)`,
    [id, conversationId, messageId, estimatedTokens]
  );
  saveDB();
  return id;
}

export function getTotalTokensInConversation(conversationId) {
  const db = getDB();
  const result = db.exec(
    `SELECT SUM(estimated_tokens) as total FROM token_usage WHERE conversation_id = ?`,
    [conversationId]
  );
  if (result.length === 0 || result[0].values.length === 0) return 0;
  return result[0].values[0][0] || 0;
}
