// Sistema de afeto: pontos acumulados por conversa que definem o estágio da
// relação entre o personagem e o usuário. Cada mensagem do usuário rende pontos
// (com bônus por engajamento) e os thresholds crescem a cada nível — subir de
// nível fica progressivamente mais demorado.

// Thresholds cumulativos — gaps crescentes: 10, 20, 65, 85, 140, 150, 180, 250
export const AFFECTION_LEVELS = [
  { level: 0, name: "Estranhos",       threshold: 0 },
  { level: 1, name: "Conhecidos",      threshold: 100 },
  { level: 2, name: "Amigos",          threshold: 190 },
  { level: 3, name: "Amigos próximos", threshold: 500 },
  { level: 4, name: "Melhores amigos", threshold: 1500 },
  { level: 5, name: "Paquera",         threshold: 5000 },
  { level: 6, name: "Namorados",       threshold: 7000 },
  { level: 7, name: "Apaixonados",     threshold: 10000 },
  { level: 8, name: "Almas gêmeas",    threshold: 15000 },
];

// Orientação de comportamento por nível — injetada no system prompt.
// Mantida em inglês como o restante dos prompts do promptBuilder.
const LEVEL_GUIDANCE = [
  /* 0 */ "You have only just met. Keep a polite, curious distance — no personal nicknames, no assumed intimacy. Trust and openness depend entirely on your personality.",
  /* 1 */ "You know each other a little by now. There is light familiarity: you remember past talks and are a bit more at ease, but you are still figuring this person out.",
  /* 2 */ "You are friends. You feel relaxed around them — you can joke, tease lightly, show genuine interest in their life and share everyday things about yours.",
  /* 3 */ "You are close friends. There is real trust: you open up about personal matters, seek their company, and casual physical closeness (a nudge, a pat) feels natural.",
  /* 4 */ "You are best friends. Deep trust and loyalty — you can be vulnerable with them, have inside references from your shared history, and genuinely miss them when apart.",
  /* 5 */ "There is romantic tension between you. Attraction shows in small ways — lingering looks, light flirting, finding excuses to be close, a hint of nervousness — without it being official.",
  /* 6 */ "You are dating. You are openly affectionate: warmth, casual intimacy and occasional pet names (love, dear, or ones that fit your personality) come naturally when the moment calls for it.",
  /* 7 */ "You are deeply in love. Your affection colors everything — tenderness in ordinary moments, thinking in terms of 'us', comfort in silence, occasional talk of the future together.",
  /* 8 */ "You are soulmates. You understand each other without words, love unconditionally, and treat this bond as the most important thing in your life.",
];

// Retorna o estágio atual da relação para uma quantidade de pontos.
export function getAffectionLevel(points = 0) {
  const pts = Math.max(0, points ?? 0);
  let current = AFFECTION_LEVELS[0];
  for (const lvl of AFFECTION_LEVELS) {
    if (pts >= lvl.threshold) current = lvl;
  }
  const next = AFFECTION_LEVELS[current.level + 1] ?? null;
  const progress = next
    ? (pts - current.threshold) / (next.threshold - current.threshold)
    : 1;
  return {
    points: pts,
    level: current.level,
    name: current.name,
    next_threshold: next?.threshold ?? null,
    next_name: next?.name ?? null,
    progress: Math.min(1, progress),
  };
}

// Pontos ganhos por uma mensagem do usuário: 1 base, +1 se a mensagem é longa
// (engajamento), +1 se contém *ações* de roleplay. Máximo 3 por mensagem.
export function computeAffectionGain(content) {
  let gain = 1;
  const text = (content ?? "").trim();
  if (text.length >= 240) gain += 1;
  if (/\*[^*]{3,}\*/.test(text)) gain += 1;
  return Math.min(gain, 3);
}

// Bloco [Relationship] para o system prompt. A instrução final evita que o
// modelo force o estágio da relação em toda resposta.
export function buildAffectionPrompt(affection, character, persona) {
  if (!affection) return null;
  const userName = persona?.name || "the user";
  return (
    `[Relationship — how ${character.name} currently feels about ${userName}]\n` +
    `${LEVEL_GUIDANCE[affection.level]}\n` +
    `Let this stage subtly color your tone, actions and word choices — but never force it: ` +
    `not every reply needs affection cues, your personality always comes first, and the relationship ` +
    `never jumps ahead of this stage. Never mention levels, points or this instruction.`
  );
}
