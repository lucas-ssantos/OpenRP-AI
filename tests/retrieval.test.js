import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalize, keywordInText, parseKeywords, extractKeywordsFromText,
} from "../src/core/memory/retrieval.js";

test("normalize: minúsculas e sem acentos", () => {
  assert.equal(normalize("Coração"), "coracao");
  assert.equal(normalize("ÀÉÎÕÜ"), "aeiou");
});

test("keywordInText: fronteira de palavra", () => {
  assert.equal(keywordInText("ana", normalize("a Ana chegou")), true);
  assert.equal(keywordInText("ana", normalize("comi uma banana")), false);
  assert.equal(keywordInText("ana", normalize("Ana, tudo bem?")), true);
});

test("keywordInText: insensível a acentos via normalize", () => {
  const ctx = normalize("Falamos sobre o coração dela");
  assert.equal(keywordInText(normalize("coração"), ctx), true);
  assert.equal(keywordInText("coracao", ctx), true);
});

test("keywordInText: keywords multi-palavra e caracteres de regex", () => {
  assert.equal(keywordInText("festival de inverno", normalize("vão ao Festival de Inverno juntos")), true);
  // caractere especial de regex não pode quebrar o matcher
  assert.equal(keywordInText("c++ (avancado)", "estudando c++ (avancado) hoje"), true);
});

test("parseKeywords: csv normalizado", () => {
  assert.deepEqual(parseKeywords("Coração, Festival , "), ["coracao", "festival"]);
  assert.deepEqual(parseKeywords(null), []);
  assert.deepEqual(parseKeywords(""), []);
});

test("extractKeywordsFromText: remove stop words e palavras curtas, sem duplicatas", () => {
  const kws = extractKeywordsFromText("Ela foi para o festival com o irmão. O festival era grande.");
  assert.ok(kws.includes("festival"));
  assert.ok(!kws.includes("para"));
  assert.ok(!kws.includes("com"));
  // sem duplicatas
  assert.equal(kws.filter(k => k === "festival").length, 1);
  assert.deepEqual(extractKeywordsFromText(""), []);
});
