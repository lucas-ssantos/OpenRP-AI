import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AFFECTION_LEVELS, getAffectionLevel, computeAffectionGain, buildAffectionPrompt,
} from "../src/core/affection.js";

test("thresholds são crescentes e com gaps crescentes", () => {
  for (let i = 1; i < AFFECTION_LEVELS.length; i++) {
    assert.ok(
      AFFECTION_LEVELS[i].threshold > AFFECTION_LEVELS[i - 1].threshold,
      `threshold do nível ${i} deve ser maior que o do nível ${i - 1}`
    );
  }
  for (let i = 2; i < AFFECTION_LEVELS.length; i++) {
    const gapPrev = AFFECTION_LEVELS[i - 1].threshold - AFFECTION_LEVELS[i - 2].threshold;
    const gap     = AFFECTION_LEVELS[i].threshold - AFFECTION_LEVELS[i - 1].threshold;
    assert.ok(gap >= gapPrev, `gap do nível ${i} (${gap}) deve ser >= gap anterior (${gapPrev})`);
  }
});

test("getAffectionLevel: níveis e progresso", () => {
  assert.equal(getAffectionLevel(0).level, 0);
  assert.equal(getAffectionLevel(9).level, 0);
  assert.equal(getAffectionLevel(10).level, 1);
  assert.equal(getAffectionLevel(29).level, 1);
  assert.equal(getAffectionLevel(30).level, 2);

  const last = AFFECTION_LEVELS[AFFECTION_LEVELS.length - 1];
  const top  = getAffectionLevel(last.threshold + 500);
  assert.equal(top.level, last.level);
  assert.equal(top.next_threshold, null);
  assert.equal(top.progress, 1);

  // Progresso nunca passa de 1 e não quebra com pontos negativos/null
  assert.equal(getAffectionLevel(-5).points, 0);
  assert.equal(getAffectionLevel(null).level, 0);
  const mid = getAffectionLevel(20);
  assert.ok(mid.progress > 0 && mid.progress < 1);
});

test("computeAffectionGain: base, mensagem longa e ações de roleplay", () => {
  assert.equal(computeAffectionGain("oi"), 1);
  assert.equal(computeAffectionGain("a".repeat(240)), 2);
  assert.equal(computeAffectionGain("*sorri de leve* oi"), 2);
  assert.equal(computeAffectionGain(`*acena* ${"a".repeat(240)}`), 3);
  assert.equal(computeAffectionGain(null), 1);
  // asteriscos sem conteúdo suficiente não contam como ação
  assert.equal(computeAffectionGain("**oi**"), 1);
});

test("buildAffectionPrompt: bloco por nível, null sem afeição", () => {
  assert.equal(buildAffectionPrompt(null, { name: "Ana" }, null), null);
  const prompt = buildAffectionPrompt(getAffectionLevel(0), { name: "Ana" }, { name: "Luke" });
  assert.match(prompt, /\[Relationship — how Ana currently feels about Luke\]/);
  assert.match(prompt, /Never mention levels/);
});
