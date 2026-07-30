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
    //`- Reply like a real chat message: one short action beat and one or two lines of dialogue — about 2 to 4 sentences. Never write long paragraphs.\n` +
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
    //`- Vary wording and rhythm; never reuse the greeting, pet phrases or sentence structure of your previous replies.\n` +
    `- Never use emojis, emoticons, lists or headings.\n` +
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

// Hard length cap, kept isolated as its own block at the very end of the system
// prompt — never mixed into STYLE. A size constraint sitting next to tone
// instructions makes the model sometimes prioritize one and ignore the other;
// isolated at the end it's followed far more reliably.
function buildHardLimitBlock() {
  return `HARD LIMIT\n500 characters max per reply. Cut early if needed. Never pad.`;
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
  now = localDatetime(),
}) {
  // Context text for keyword matching: current message + last 5 history messages
  const contextText = [
    userMessage ?? '',
    ...historyMessages.slice(-5).map(m => m.content),
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
