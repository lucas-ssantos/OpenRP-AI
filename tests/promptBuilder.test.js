import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPromptMessages } from "../src/core/promptBuilder.js";

const character = { name: "Ana", description: "Uma caçadora.", personality: "Corajosa." };
const persona   = { name: "Luke", description: "Um viajante." };

function systemText(messages) {
  return messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
}

test("estrutura básica: instrução + card + histórico + mensagem do usuário", () => {
  const msgs = buildPromptMessages({
    character, persona,
    historyMessages: [{ role: "assistant", content: "Olá!" }],
    userMessage: "Oi, Ana",
  });

  assert.equal(msgs[0].role, "system");
  assert.match(msgs[0].content, /roleplaying as Ana/);
  assert.equal(msgs[1].role, "system");
  assert.match(msgs[1].content, /You are Ana\. Uma caçadora\./);
  assert.deepEqual(msgs.at(-1), { role: "user", content: "Oi, Ana" });
});

test("system_prompt customizado substitui a instrução e expande {{char}}/{{user}}", () => {
  const msgs = buildPromptMessages({
    character, persona,
    charConfig: { system_prompt: "Você é {{char}} falando com {{user}}." },
    userMessage: "oi",
  });
  const systems = msgs.filter(m => m.role === "system");
  assert.equal(systems.length, 1);
  assert.match(systems[0].content, /Você é Ana falando com Luke\./);
});

test("memórias pinned e contextuais entram em blocos separados", () => {
  const msgs = buildPromptMessages({
    character, persona,
    userMessage: "oi",
    memories: [
      { content: "Confessou amor.", is_pinned: true },
      { content: "Foram ao mercado.", is_pinned: false },
    ],
  });
  const sys = systemText(msgs);
  assert.match(sys, /\[Core memories[^\]]*\]\n- Confessou amor\./);
  assert.match(sys, /\[Relevant memories[^\]]*\]\n- Foram ao mercado\./);
});

test("lorebook: ativa por keyword com fronteira de palavra e sem acentos", () => {
  const lorebooks = [
    { title: "Coração de Ferro", content: "Uma espada lendária.", keywords: "coração de ferro" },
    { title: "Banana",           content: "Não deve ativar.",     keywords: "ana" },
    { title: "Sempre ativo",     content: "Regras do mundo.",     keywords: null },
  ];
  const msgs = buildPromptMessages({
    character, persona,
    userMessage: "me fale sobre o coracao de ferro",
    // "banana" contém "ana" como substring, mas não como palavra
    historyMessages: [{ role: "user", content: "comi uma banana" }],
    lorebooks,
  });
  const sys = systemText(msgs);
  assert.match(sys, /Uma espada lendária\./);
  assert.match(sys, /Regras do mundo\./);
  assert.doesNotMatch(sys, /Não deve ativar\./);
});

test("author's note é injetado a N mensagens do fim", () => {
  const history = Array.from({ length: 6 }, (_, i) => ({
    role: i % 2 ? "assistant" : "user", content: `msg ${i}`,
  }));
  const msgs = buildPromptMessages({
    character, persona,
    charConfig: { system_prompt: "custom", jailbreak: "NOTA" },
    historyMessages: history,
    userMessage: "oi",
    authorNoteDepth: 4,
  });
  const noteIdx = msgs.findIndex(m => m.content === "NOTA");
  assert.ok(noteIdx !== -1, "author's note deve estar presente");
  assert.equal(msgs.length - 1 - noteIdx, 4);
});

test("mensagens system do histórico são descartadas", () => {
  const msgs = buildPromptMessages({
    character, persona,
    historyMessages: [
      { role: "system", content: "lixo antigo" },
      { role: "user", content: "oi" },
    ],
    userMessage: "tudo bem?",
  });
  assert.ok(!msgs.some(m => m.content === "lixo antigo"));
});
