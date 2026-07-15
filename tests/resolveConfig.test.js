import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

// Banco isolado em arquivo temporário — precisa ser definido antes dos imports
// dinâmicos, pois config.js lê DB_PATH no load do módulo.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "openrp-test-")), "test.db");

let resolveConfig, setGenerationConfig, setConversationModel, getDB, defaults;

before(async () => {
  const db = await import("../src/services/database/db.js");
  await db.initDB();
  getDB = db.getDB;
  const mig = await import("../src/services/database/migrations.js");
  await mig.migrate();
  ({ setGenerationConfig, setConversationModel } = await import("../src/services/database/queries.js"));
  ({ resolveConfig } = await import("../src/core/chat/helpers.js"));
  ({ appConfig: { defaults } } = await import("../src/config.js"));
});

test("campo NULL ou inválido no banco cai para o default do .env", () => {
  setGenerationConfig({
    model: "modelo-teste:8b",
    temperature: 0.55, top_p: null, top_k: null, min_p: null,
    repeat_penalty: -5, // inválido
    repeat_last_n: null, context_size: 4096,
    num_ctx_messages: 30, min_tokens: null, max_tokens: 500,
    memory_interval: 5, stream: 1, seed: -1, stop: [],
  });

  const cfg = resolveConfig();
  assert.equal(cfg.model, "modelo-teste:8b");
  assert.equal(cfg.temperature, 0.55);
  assert.equal(cfg.top_p, defaults.top_p);                   // null → .env
  assert.equal(cfg.top_k, defaults.top_k);                   // null → .env
  assert.equal(cfg.min_p, defaults.min_p);                   // null → .env
  assert.equal(cfg.repeat_penalty, defaults.repeat_penalty); // inválido → .env
  assert.equal(cfg.repeat_last_n, defaults.repeat_last_n);   // null → .env
  assert.equal(cfg.min_tokens, defaults.min_tokens);         // null → .env
  assert.ok(Object.values(cfg).every((v) => v !== undefined), "nenhum campo undefined");
});

test("context_size NULL é 'contexto automático' — preservado, não substituído", () => {
  setGenerationConfig({
    model: "modelo-teste:8b", temperature: 0.7, top_p: 0.9, top_k: 40, min_p: 0.05,
    repeat_penalty: 1.1, repeat_last_n: 64, context_size: null,
    num_ctx_messages: 20, min_tokens: 60, max_tokens: -1,
    memory_interval: 5, stream: 1, seed: -1, stop: [],
  });
  assert.equal(resolveConfig().context_size, null);
});

test("config salva é usada imediatamente na próxima resolução", () => {
  setGenerationConfig({
    model: "antigo:1b", temperature: 0.3, top_p: 0.9, top_k: 40, min_p: 0.05,
    repeat_penalty: 1.1, repeat_last_n: 64, context_size: 8192,
    num_ctx_messages: 20, min_tokens: 60, max_tokens: -1,
    memory_interval: 5, stream: 1, seed: -1, stop: [],
  });
  assert.equal(resolveConfig().model, "antigo:1b");

  setGenerationConfig({
    model: "novo:8b", temperature: 0.9, top_p: 0.9, top_k: 40, min_p: 0.05,
    repeat_penalty: 1.1, repeat_last_n: 64, context_size: 8192,
    num_ctx_messages: 20, min_tokens: 60, max_tokens: -1,
    memory_interval: 5, stream: 1, seed: -1, stop: [],
  });
  const cfg = resolveConfig();
  assert.equal(cfg.model, "novo:8b");
  assert.equal(cfg.temperature, 0.9);
});

test("único override é o modelo da conversa; demais params herdam do global", () => {
  getDB().run(
    `INSERT OR IGNORE INTO conversations (id, character_id) VALUES ('conv-1', 'char-1')`
  );
  setConversationModel("conv-1", "modelo-da-conversa:1b");

  const cfg = resolveConfig("conv-1");
  assert.equal(cfg.model, "modelo-da-conversa:1b");
  assert.equal(cfg.temperature, 0.9); // herdado do global salvo no teste anterior

  setConversationModel("conv-1", null); // limpa o override
  assert.equal(resolveConfig("conv-1").model, "novo:8b");
});

test("tabela character_config não existe mais no schema", () => {
  const tables = getDB()
    .exec("SELECT name FROM sqlite_master WHERE type='table'")[0]
    .values.flat();
  assert.ok(!tables.includes("character_config"));
});
