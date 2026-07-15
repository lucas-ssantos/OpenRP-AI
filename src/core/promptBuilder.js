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
    `- Weave *actions, gestures and feelings between asterisks* inline with the dialogue, as one flowing piece — never in separate lines or alternating blocks.\n` +
    `- Vary wording and rhythm; never reuse the greeting, pet phrases or sentence structure of your previous replies.\n` +
    `- Never use emojis, emoticons, lists or headings.\n` +
    `\n` +
    `INTERACTION\n` +
    `- NEVER speak, act, think or decide for ${userName}. Their words and actions belong to them alone.\n` +
    `- When ${userName} writes *text between asterisks*, that is their own action — react to it naturally; never repeat or quote it as speech.\n` +
    `- Keep the scene alive: react to what ${userName} just said or did, add one new detail from ${name}'s side, and when it feels natural leave a hook — a question, an invitation, a tease or a challenge.\n` +
    `- Let feelings show through concrete actions and tone, not explanations of emotions.`
  );
}

// Builds the base character system prompt (the "character card").
// If charConfig has a custom system_prompt, uses it with {{char}}/{{user}} substitution.
function buildBaseSystemPrompt(character, persona, charConfig, conversation) {
  if (charConfig?.system_prompt) {
    return charConfig.system_prompt
      .replace(/\{\{char\}\}/gi, character.name)
      .replace(/\{\{user\}\}/gi, persona?.name || 'User');
  }

  const parts = [
    character.description
      ? `You are ${character.name}. ${character.description}`
      : `You are ${character.name}.`,
  ];
  if (character.personality) parts.push(`Personality: ${character.personality}`);
  if (character.likes)    parts.push(`Likes: ${character.likes}`);
  if (character.dislikes) parts.push(`Dislikes: ${character.dislikes}`);
  if (conversation?.scenario) {
    parts.push(`Current scenario: ${conversation.scenario}\nEverything in the conversation happens inside this scenario — keep the setting, time and circumstances consistent with it.`);
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
 *  [1] SYSTEM PROMPT   — character identity + persona + custom system_prompt override
 *  [2] MEMORIES        — already selected by the retrieval layer (getMemoriesForPrompt);
 *                        split into [Core memories] (pinned) and [Relevant memories] (contextual)
 *  [3] LOREBOOK        — keyword-activated world-info entries (appended to system prompt)
 *  [4] HISTORY         — recent conversation messages
 *  [5] AUTHOR'S NOTE   — charConfig.jailbreak injected `authorNoteDepth` messages from the end
 *  [6] USER MESSAGE    — current user turn (null for regenerate)
 *
 * @param {object} opts
 * @param {object}   opts.character        - character row from DB
 * @param {object}   opts.persona          - persona row from DB (may be null)
 * @param {object}   opts.conversation     - conversation row from DB (may be null); provides scenario
 * @param {object}   opts.charConfig       - character_config row (may be null); provides system_prompt + jailbreak
 * @param {object[]} opts.historyMessages  - recent messages from DB (role !== 'system' are forwarded)
 * @param {string}   opts.userMessage      - current user message; null for regenerate
 * @param {object[]} opts.memories         - memories already selected by the retrieval layer
 * @param {object[]} opts.lorebooks        - global + character lorebooks
 * @param {object}   opts.affection        - current affection level info (getAffectionLevel); may be null
 * @param {number}   opts.authorNoteDepth  - how many messages from the end to inject the author's note (default 4)
 * @param {string}   opts.now              - "agora" de referência (formato localDatetime) — injetável para testes
 * @returns {{ role: string, content: string }[]}
 */
export function buildPromptMessages({
  character,
  persona,
  conversation = null,
  charConfig = null,
  historyMessages = [],
  userMessage = null,
  memories = [],
  lorebooks = [],
  affection = null,
  authorNoteDepth = 4,
  now = localDatetime(),
}) {
  // Context text for keyword matching: current message + last 5 history messages
  const contextText = [
    userMessage ?? '',
    ...historyMessages.slice(-5).map(m => m.content),
  ].join(' ');

  // ── [0] Fixed behavioral instruction (own system message) ──────────────────
  // Skipped when a custom system_prompt override is provided — that fully replaces it.
  const instructionPrompt = charConfig?.system_prompt ? null : buildInstructionPrompt(character, persona);

  // ── [1] Base system prompt (character card + scenario + persona) ───────────
  const basePrompt = buildBaseSystemPrompt(character, persona, charConfig, conversation);

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
  const systemContent = systemParts.join('\n\n---\n\n');

  // ── [4] Message history (skip any system-role rows from the DB) ────────────
  const history = historyMessages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role, content: m.content }));

  // ── [6] Append current user message ───────────────────────────────────────
  const allMessages = userMessage
    ? [...history, { role: 'user', content: userMessage }]
    : history;

  // ── [5] Inject author's note (jailbreak) N messages from the end ──────────
  const authorNote = charConfig?.jailbreak ?? null;
  let bodyMessages;
  if (authorNote && allMessages.length > 0) {
    const insertIdx = Math.max(0, allMessages.length - authorNoteDepth);
    bodyMessages = [
      ...allMessages.slice(0, insertIdx),
      { role: 'system', content: authorNote },
      ...allMessages.slice(insertIdx),
    ];
  } else {
    bodyMessages = allMessages;
  }

  const systemMessages = [];
  if (instructionPrompt) systemMessages.push({ role: 'system', content: instructionPrompt });
  systemMessages.push({ role: 'system', content: systemContent });

  return [...systemMessages, ...bodyMessages];
}
