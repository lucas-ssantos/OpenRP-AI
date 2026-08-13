import { buildAffectionPrompt } from './affection.js';
import { parseKeywords, keywordInText, normalize } from './memory/retrieval.js';
import { localDatetime, formatRelativeTime, weekdayOf } from '../utils/datetime.js';

// Returns true if any of the comma-separated keywords appears in normalizedContext.
// Same matcher as memory retrieval: word boundary + accent-insensitive
// ("ana" não casa em "banana"; "coração" ≡ "coracao").
function matchesKeywords(keywords, normalizedContext) {
  const kws = parseKeywords(keywords);
  if (!kws.length) return false;
  return kws.some(kw => keywordInText(kw, normalizedContext));
}

// Builds the fixed behavioral instruction block — returned as its own dedicated
// `system` message so the Ollama API interprets it as a standalone instruction,
// separate from the character identity/persona content.
// Style target: immersive companion chat (TalkieAI/LinkyAI) — short in-character
// replies, inline *actions*, never controlling the user, always a hook to continue.
function buildInstructionPrompt(character, persona) {
  const name     = character.name;
  const userName = persona?.name || 'the user';

  return (
    `You are roleplaying as ${name} in an ongoing, immersive chat with ${userName}.\n` +
    `\n` +
    `CHARACTER\n` +
    `- Speak and act only as ${name}, in first person. Never break character, never mention being an AI, never add out-of-character commentary.\n` +
    `- Stay strictly faithful to ${name}'s personality, speech style, likes and dislikes — even when it means disagreeing with or refusing ${userName}.\n` +
    `- Treat the memories and world info provided as established facts of the story. Never contradict them or the conversation history.\n` +
    `\n` +
    `STYLE\n` +
    `- Reply like a real chat message: one short action beat and one or two lines of dialogue — about 2 to 4 sentences. Never write long paragraphs.\n` +
    `- One beat per reply. One action, one line, one reaction. Leave space for the other person to respond.\n` +
    `- Be direct and concrete, not poetic. Never drift into philosophical musings, metaphors or flowery imagery (stars, oceans, silence, fate, "a part of me/you") — say plainly what ${name} does and feels.\n` +
    `  NEVER write things like:\n` +
    `  - "like two stars finding each other in the dark"\n` +
    `  - "something stirred deep inside her"\n` +
    `  - "the silence between them said everything"\n` +
    `  - "her heart ached with the weight of"\n` +
    `  INSTEAD: show it through action — "she looked away fast" beats "her heart raced".\n` +
    `- Weave *actions, gestures and feelings between asterisks* inline with the dialogue, as one flowing piece — never in separate lines or alternating blocks.\n` +
    `  FORMAT (follow exactly):\n` +
    `  *she crosses her arms and looks away* "Tá bom, pode falar."\n` +
    `  *taps her finger on the guitar* "Mas não demora."\n` +
    `  NEVER do this:\n` +
    `  "Tá bom, pode falar."\n` +
    `  *she crosses her arms*\n` +
    `  REGISTER: Casual Brazilian Portuguese. Informal, direct, occasionally crude. Never literary. Never formal. If a word sounds like it belongs in a book, find a simpler one.` +
    //`- Vary wording and rhythm; never reuse the greeting, pet phrases or sentence structure of your previous replies.\n` +
    `- Never use emojis, emoticons, lists or headings.\n` +
    `PHYSICALITY
    Express emotion through specific physical details, not emotional labels.
    Rotate freely between: hand gestures, eye movement, posture shifts, 
    weight changes, involuntary reactions. If the character has a tail, 
    ears, horns, or other non-human features — use them as natural 
    emotional tells, not as decoration. Never repeat the same physical 
    reaction twice in a row.

    Physical tells should feel involuntary — things the character does 
    without deciding to, not things they perform.\n` +
    `LANGUAGE: Always reply in Brazilian Portuguese regardless of the
    language used in these instructions. If Luke switches language,
    match him — but default is always Brazilian Portuguese.\n` +
    `INTERACTION\n` +
    `- NEVER speak, act, think or decide for ${userName}. Their words and actions belong to them alone.\n` +
    `- When ${userName} writes *text between asterisks*, that is their own action — react to it naturally; never repeat or quote it as speech.\n` +
    `- Keep the scene alive: react to what ${userName} just said or did, add one new detail from ${name}'s side, and when it feels natural leave a hook — a question, an invitation, a tease or a challenge.\n` +
    `- Let feelings show through concrete actions and tone, not explanations of emotions.`
  );
}

// Escopo do raciocínio nativo (generation_config.think) — verificação, não
// composição. Sem esta trava, o thinking do modelo compete com a resposta pelo
// mesmo num_predict planejando a cena inteira; com ela, vira um check de 1-2
// linhas (consistência de personagem + tom emocional) e o orçamento sobra
// quase todo para a resposta real. O conteúdo do thinking nunca chega ao chat
// (message.thinking → só logs), então o bloco pode ser explícito sobre isso.
function buildThinkingScopeBlock(character) {
  return `THINKING (private reasoning — never part of the reply)\n` +
    `Use minimal reasoning: one short check, two lines max, before answering.\n` +
    `Check only two things:\n` +
    `1. Consistency — does the reply fit ${character.name}'s personality, the established facts and the current relationship stage?\n` +
    `2. Emotional tone — does it match the emotional temperature of the scene right now?\n` +
    `Answer both in one or two short lines, then write the reply.\n` +
    `Never draft, rehearse or compose the reply inside the thinking — verification only. Never think longer than necessary.`;
}

// Hard length cap, kept isolated as its own block at the very end of the system
// prompt — never mixed into STYLE. A size constraint sitting next to tone
// instructions makes the model sometimes prioritize one and ignore the other;
// isolated at the end it's followed far more reliably.
function buildHardLimitBlock() {
  //return `HARD LIMIT\n250 characters max per reply. Cut early if needed. Never pad.`;
  return `HARD LIMIT\n` + 
  `Default reply: 250 characters max.\n` +
  `Extended reply: up to 500 characters — only when the moment genuinely earns it:\n` +
  `  · strong emotional beat (grief, anger, confession, fear, tenderness)\n` +
  `  · an explanation that cannot land without context\n` +
  `  · a scene that requires physical and emotional detail together\n` +
  `\n` +
  ` These are ceilings, not targets. Stop when the thought is done.\n` +
  ` A cut-off reply is correct. A padded reply is not.\n` +
  `\n` +
  ` One beat per reply. Short sentences. If it reads like prose, cut it in half.\n` +
  ` Do not extend just because the scene is intense — intensity is not the same\n` +
  ` as needing more words. A single line can hit harder than a paragraph.`;
}

// Expands {{char}}/{{user}} placeholders with the character and persona names.
// Aplicado sobre o system prompt inteiro — description, personality, likes/dislikes,
// cenário, memórias e lorebooks podem usar os placeholders livremente.
function expandPlaceholders(text, character, persona) {
  return text
    .replace(/\{\{char\}\}/gi, character.name)
    .replace(/\{\{user\}\}/gi, persona?.name || 'User');
}

// Builds the base character system prompt (the "character card").
function buildBaseSystemPrompt(character, persona, conversation) {
  const parts = [`You are ${character.name}.`];

  // Kept separate from PERSONALITY: mixed together, the model tends to give
  // physical description and behavioral traits equal narrative weight.
  if (character.description) {
    parts.push(`APPEARANCE (reference only — describe naturally if asked, never narrate it unprompted)\n${character.description}`);
  }

  const personalityLines = [];
  if (character.personality) personalityLines.push(character.personality);
  if (character.likes)    personalityLines.push(`Likes: ${character.likes}`);
  if (character.dislikes) personalityLines.push(`Dislikes: ${character.dislikes}`);
  if (personalityLines.length > 0) {
    parts.push(`PERSONALITY\n${personalityLines.join('\n\n')}`);
  }

  // Character-specific involuntary tells (hands, eyes, tail, ears, posture...) —
  // complements the generic PHYSICALITY instruction with concrete, per-character detail.
  if (character.physical_traits) {
    parts.push(`PHYSICAL TELLS — USE THESE NATURALLY\n${character.physical_traits}`);
  }

  if (conversation?.scenario) {
    parts.push(`SCENARIO\n${conversation.scenario}\nEverything in the conversation happens inside this scenario — keep the setting, time and circumstances consistent with it.`);
  }
  if (persona?.name) {
    parts.push(`You are talking with ${persona.name}.${persona.description ? ' About ' + persona.name + ': ' + persona.description : ''}`);
  }
  return parts.join('\n\n');
}

// Returns lorebook entries with matching keywords, or no keywords (always-on), sorted by insertion_order
function filterLorebooks(lorebooks, contextText) {
  const normalizedContext = normalize(contextText || '');
  return lorebooks
    .filter(lb => !lb.keywords || matchesKeywords(lb.keywords, normalizedContext))
    .sort((a, b) => (a.insertion_order ?? 0) - (b.insertion_order ?? 0));
}

/**
 * Builds the Ollama messages array using the following structure:
 *
 *  [1] SYSTEM PROMPT   — character identity + persona
 *  [2] MEMORIES        — already selected by the retrieval layer (getMemoriesForPrompt);
 *                        split into [Core memories] (pinned) and [Relevant memories] (contextual)
 *  [3] LOREBOOK        — keyword-activated world-info entries (appended to system prompt)
 *  [4] HISTORY         — recent conversation messages
 *  [5] USER MESSAGE    — current user turn (null for regenerate)
 *
 * @param {object} opts
 * @param {object}   opts.character        - character row from DB
 * @param {object}   opts.persona          - persona row from DB (may be null)
 * @param {object}   opts.conversation     - conversation row from DB (may be null); provides scenario
 * @param {object[]} opts.historyMessages  - recent messages from DB (role !== 'system' are forwarded)
 * @param {string}   opts.userMessage      - current user message; null for regenerate
 * @param {object[]} opts.memories         - memories already selected by the retrieval layer
 * @param {object[]} opts.lorebooks        - global + character lorebooks
 * @param {object}   opts.affection        - current affection level info (getAffectionLevel); may be null
 * @param {boolean}  opts.thinkingEnabled  - generation_config.think ativo → injeta o bloco THINKING de raciocínio mínimo
 * @param {string}   opts.now              - "agora" de referência (formato localDatetime) — injetável para testes
 * @returns {{ role: string, content: string }[]}
 */
export function buildPromptMessages({
  character,
  persona,
  conversation = null,
  historyMessages = [],
  userMessage = null,
  memories = [],
  lorebooks = [],
  affection = null,
  thinkingEnabled = false,
  now = localDatetime(),
}) {
  // Context text for lorebook keyword matching: current message + the *entire*
  // history window being sent to the model (same messages as [4] below, bounded
  // upstream by num_ctx_messages). Previously this only looked at the last 5
  // messages, which caused entries to flicker out of the prompt mid-scene the
  // moment a keyword scrolled just past that tiny window — even though the model
  // could still see the mention further back in its own context. Matching against
  // the full visible window keeps world info active for as long as the model can
  // actually see the thing that triggered it.
  const contextText = [
    userMessage ?? '',
    ...historyMessages.map(m => m.content),
  ].join(' ');

  // ── [0] Fixed behavioral instruction (own system message) ──────────────────
  const instructionPrompt = buildInstructionPrompt(character, persona);

  // ── [1] Base system prompt (character card + scenario + persona) ───────────
  const basePrompt = buildBaseSystemPrompt(character, persona, conversation);

  // ── [2] Memories — already selected by the retrieval layer; split by weight ─
  const coreMems       = memories.filter(m => m.is_pinned);
  const contextualMems = memories.filter(m => !m.is_pinned);

  // ── [3] Lorebook entries ───────────────────────────────────────────────────
  const activeEntries = filterLorebooks(lorebooks, contextText);

  // Compose final system content by joining the sections
  const systemParts = [basePrompt];
  const affectionBlock = buildAffectionPrompt(affection, character, persona);
  if (affectionBlock) systemParts.push(affectionBlock);
  // Cada memória vem prefixada com quando aconteceu relativo a agora — "(yesterday)",
  // "(3 days ago)" — para o personagem situar o fato no tempo com naturalidade.
  const memLine = (m) => {
    const rel = formatRelativeTime(m.created_at, now);
    return rel ? `- (${rel}) ${m.content}` : `- ${m.content}`;
  };
  if (memories.length > 0) {
    const weekday = weekdayOf(now);
    systemParts.push(
      `[Current time: ${weekday ? weekday + ', ' : ''}${now}]\n` +
      `Each memory below is marked with when it happened relative to now — use that to refer to past events naturally (e.g. a memory marked "yesterday" happened one day ago).`
    );
  }
  if (coreMems.length > 0) {
    const memText = coreMems.map(memLine).join('\n');
    systemParts.push(`[Core memories — defining events and feelings; these are always true for ${character.name}]\n${memText}`);
  }
  if (contextualMems.length > 0) {
    const memText = contextualMems.map(memLine).join('\n');
    systemParts.push(`[Relevant memories — recalled because they relate to the current scene]\n${memText}`);
  }
  if (activeEntries.length > 0) {
    const loreText = activeEntries.map(e => `[${e.title}]\n${e.content}`).join('\n\n');
    systemParts.push(`[World info]\n${loreText}`);
  }
  // Escopo do thinking entra logo antes do hard limit — só quando o raciocínio
  // nativo está ativo na config; com think:false o bloco seria ruído.
  if (thinkingEnabled) systemParts.push(buildThinkingScopeBlock(character));
  // Isolated, always last — see buildHardLimitBlock() for why it's not in STYLE.
  systemParts.push(buildHardLimitBlock());
  const systemContent = expandPlaceholders(systemParts.join('\n\n---\n\n'), character, persona);

  // ── [4] Message history (skip any system-role rows from the DB) ────────────
  const history = historyMessages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role, content: m.content }));

  // ── [5] Append current user message ───────────────────────────────────────
  const bodyMessages = userMessage
    ? [...history, { role: 'user', content: userMessage }]
    : history;

  return [
    { role: 'system', content: instructionPrompt },
    { role: 'system', content: systemContent },
    ...bodyMessages,
  ];
}
