// Returns true if any of the comma-separated keywords appears in contextText (case-insensitive)
function matchesKeywords(keywords, contextText) {
  if (!keywords) return false;
  const kws = keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
  if (!kws.length) return false;
  const lower = contextText.toLowerCase();
  return kws.some(kw => lower.includes(kw));
}

// Builds the base character system prompt.
// If charConfig has a custom system_prompt, uses it with {{char}}/{{user}} substitution.
function buildBaseSystemPrompt(character, persona, charConfig) {
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
  //if (character.scenario) parts.push(`Scenario: ${character.scenario}`);
  if (persona?.name) {
    parts.push(`The user's name is ${persona.name}.${persona.description ? ' ' + persona.description : ''}`);
  }
  parts.push(
    `Respond in first person as ${character.name}. Stay in character at all times.\n` +
    `Mirror the player's energy and length — short messages deserve brief, punchy replies; longer messages deserve richer ones.\n` +
    `Weave *actions and gestures between asterisks* inline with your dialogue — write as one flowing response, not separate paragraphs.\n` +
    `Text between * (asterisks) means actions or gestures, they're to be interpreted as such and NOT as talking to the character.\n` +
    `Never use emojis or emoticons.`
  );
  return parts.join('\n\n');
}

// Returns pinned memories first, then keyword-matched memories sorted by relevance_weight DESC
function filterMemories(memories, contextText) {
  const pinned = memories.filter(m => m.is_pinned);
  const relevant = memories
    .filter(m => !m.is_pinned && matchesKeywords(m.keywords, contextText))
    .sort((a, b) => (b.relevance_weight ?? 1) - (a.relevance_weight ?? 1));
  return [...pinned, ...relevant];
}

// Returns lorebook entries with matching keywords, or no keywords (always-on), sorted by insertion_order
function filterLorebooks(lorebooks, contextText) {
  return lorebooks
    .filter(lb => !lb.keywords || matchesKeywords(lb.keywords, contextText))
    .sort((a, b) => (a.insertion_order ?? 0) - (b.insertion_order ?? 0));
}

/**
 * Builds the Ollama messages array using the following structure:
 *
 *  [1] SYSTEM PROMPT   — character identity + persona + custom system_prompt override
 *  [2] MEMORIES        — pinned first, then keyword-matched (appended to system prompt)
 *  [3] LOREBOOK        — keyword-activated world-info entries (appended to system prompt)
 *  [4] HISTORY         — recent conversation messages
 *  [5] AUTHOR'S NOTE   — charConfig.jailbreak injected `authorNoteDepth` messages from the end
 *  [6] USER MESSAGE    — current user turn (null for regenerate)
 *
 * @param {object} opts
 * @param {object}   opts.character        - character row from DB
 * @param {object}   opts.persona          - persona row from DB (may be null)
 * @param {object}   opts.charConfig       - character_config row (may be null); provides system_prompt + jailbreak
 * @param {object[]} opts.historyMessages  - recent messages from DB (role !== 'system' are forwarded)
 * @param {string}   opts.userMessage      - current user message; null for regenerate
 * @param {object[]} opts.memories         - all memories for this conversation
 * @param {object[]} opts.lorebooks        - global + character lorebooks
 * @param {number}   opts.authorNoteDepth  - how many messages from the end to inject the author's note (default 4)
 * @returns {{ role: string, content: string }[]}
 */
export function buildPromptMessages({
  character,
  persona,
  charConfig = null,
  historyMessages = [],
  userMessage = null,
  memories = [],
  lorebooks = [],
  authorNoteDepth = 4,
}) {
  // Context text for keyword matching: current message + last 5 history messages
  const contextText = [
    userMessage ?? '',
    ...historyMessages.slice(-5).map(m => m.content),
  ].join(' ');

  // ── [1] Base system prompt ─────────────────────────────────────────────────
  const basePrompt = buildBaseSystemPrompt(character, persona, charConfig);

  // ── [2] Relevant memories ──────────────────────────────────────────────────
  const relevantMems = filterMemories(memories, contextText);

  // ── [3] Lorebook entries ───────────────────────────────────────────────────
  const activeEntries = filterLorebooks(lorebooks, contextText);

  // Compose final system content by joining the three sections
  const systemParts = [basePrompt];
  if (relevantMems.length > 0) {
    const memText = relevantMems.map(m => m.summary || m.content).join('\n');
    systemParts.push(`[Relevant memories]\n${memText}`);
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

  return [{ role: 'system', content: systemContent }, ...bodyMessages];
}
