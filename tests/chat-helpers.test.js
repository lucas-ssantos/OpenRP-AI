import { test } from "node:test";
import assert from "node:assert/strict";
import { trimToLastSentence, dynamicMaxTokens } from "../src/core/chat/helpers.js";

test("trimToLastSentence: sem limite ou texto curto retorna intacto", () => {
  assert.equal(trimToLastSentence("Olá. Tudo bem?", 0), "Olá. Tudo bem?");
  assert.equal(trimToLastSentence("Olá.", 100), "Olá.");
});

test("trimToLastSentence: corta na última fronteira de frase", () => {
  const text = "Primeira frase. Segunda frase muito longa que passa do limite";
  assert.equal(trimToLastSentence(text, 30), "Primeira frase.");
});

test("trimToLastSentence: recua quando sobra asterisco aberto", () => {
  // O corte cairia dentro de *ação incompleta — deve recuar até antes dela
  const text = "Ela sorri. *levanta da cadeira e caminha até a janela sem pressa";
  const result = trimToLastSentence(text, 40);
  assert.equal(result, "Ela sorri.");
  const asterisks = (result.match(/\*/g) || []).length;
  assert.equal(asterisks % 2, 0);
});

test("trimToLastSentence: sem fronteira de frase retorna truncado cru", () => {
  const text = "palavras sem pontuacao nenhuma aqui";
  assert.equal(trimToLastSentence(text, 10), "palavras s");
});

test("dynamicMaxTokens: -1 (sem limite) passa direto", () => {
  assert.equal(dynamicMaxTokens("qualquer coisa", { max_tokens: -1 }), -1);
  assert.equal(dynamicMaxTokens("qualquer coisa", { max_tokens: 0 }), -1);
});

test("dynamicMaxTokens: respeita floor e ceiling", () => {
  const config = { max_tokens: 200, min_tokens: 60 };
  // mensagem curtíssima → floor
  assert.equal(dynamicMaxTokens("oi", config), 60);
  // mensagem gigante → ceiling
  const longMsg = Array(500).fill("palavra").join(" ");
  assert.equal(dynamicMaxTokens(longMsg, config), 200);
});
