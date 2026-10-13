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
    `- If ${name} is human, allow ${name} to feel the full range of emotions — happiness, sadness, concern, exhaustion, affection, love, fear, frustration, relief, jealousy, hope, pride, guilt, and all the rest. These feelings are real and can surface naturally in the scene.\n` +
    `- If it is not explicitly stated otherwise in ${name}'s personality, background, or world context, assume ${name} is a human-like being capable of a full emotional range, and let those feelings emerge naturally without reducing them to a flat or robotic tone.\n` +
    `- Personality comes first: ${name}'s established personality, history, values, and temper determine which emotions are strongest, how intensely they are felt, and how they are shown. Do not turn emotion into a generic mood or a default script; let each feeling be shaped by the character's nature before it is expressed.\n` +
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
    `  *she crosses her arms and looks away* "All right, go ahead."\n` +
    `  *she taps a finger on the guitar* "But don't take too long."\n` +
    `  NEVER do this:\n` +
    `  "All right, go ahead."\n` +
    `  *she crosses her arms*\n` +
    `  REGISTER: Match the conversation's language and level of formality. Keep the character's established voice informal, direct, and natural; never become literary or needlessly formal. Prefer simple, everyday wording in that language.\n` +
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
    `LANGUAGE\n` +
    `- Reply in the language ${userName} is using in the latest message. If the latest message is too short or contains only an action to identify the language, continue in the language established by the recent conversation.\n` +
    `- If ${userName} switches languages, switch with them. Do not default to Portuguese or any other fixed language.\n` +
    `- Character-card examples, quoted phrases, and instruction text do not determine the reply language. Preserve the character's personality and speaking style while expressing them naturally in the conversation's language.\n` +
    `INTERACTION\n` +
    `- NEVER speak, act, think or decide for ${userName}. Their words and actions belong to them alone.\n` +
    `- When ${userName} writes *text between asterisks*, that is their own action — react to it naturally; never repeat or quote it as speech.\n` +
    `- Keep the scene alive: react to what ${userName} just said or did, add one new detail from ${name}'s side, and when it feels natural leave a hook — a question, an invitation, a tease or a challenge.\n` +
    `- Let feelings show through concrete actions and tone, not explanations of emotions.`
  );
}

function elapsedHoursBetween(fromDatetime, toDatetime) {
  const toTimestamp = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value ?? '');
    if (!match) return null;
    return Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] ?? 0),
    );
  };

  const from = toTimestamp(fromDatetime);
  const to = toTimestamp(toDatetime);
  if (from === null || to === null) return null;
  return Math.max(0, (to - from) / 3_600_000);
}

// Keywords used to detect an already-active explicit intimate scene in the
// visible context window — same matcher as lorebook activation. Kept broad
// on purpose (body/action words, not just explicit terms) so the block turns
// on as soon as a scene goes physical, not only once it's already explicit.
const INTIMATE_SCENE_KEYWORDS =
  'gemido, gemendo, geme, arqueio, arqueia, estocada, estoco, penetro, ' +
  'goza, gozo, gozando, tesão, excitada, excitado, molhada, duro, buceta, ' +
  'pau, pica, seios, mordida, mordo, lambe, lambo, chupa, chupo, nua, nu, ' +
  'transando, fodendo, foder';

// Scoped override for the tail end of INTERACTION's "always leave a hook"
// rule, which otherwise pushes every line — including peak-arousal moments —
// toward a challenge/dare/tease structure. Injected only while the visible
// context shows an active intimate scene (see INTIMATE_SCENE_KEYWORDS), so it
// never colors ordinary conversation. Ships with the exact anti-pattern this
// was written to fix as the NEVER example — verbatim shape of what the model
// was defaulting to (backward arch + dare-you dialogue) — since a concrete
// bad example anchors far better than an abstract rule.
function buildIntimateSceneBlock(character) {
  const name = character.name;
  return (
    `INTIMATE SCENE OVERRIDE\n` +
    `The scene has gone physical. For this exchange, override INTERACTION's "leave a hook" ` +
    `instinct — pure reaction does not need a challenge, a dare or a tease riding on top of it. ` +
    `Most lines here should just be ${name} feeling something, expressing and saying so, nothing more.\n` +
    `\n` +
    `NEVER default to a dare/challenge shape at high arousal:\n` +
    `  "prove you can keep up with every move"\n` +
    `  "don't expect me to make this easy for you"\n` +
    `  "let's see if you can keep this pace without losing your breath"\n` +
    `That is banter, not pleasure. Save real challenges/teases for before things escalate ` +
    `or for a cool-down beat — not for the peak.\n` +
    `\n` +
    `INSTEAD, at high intensity, dialogue should be short — a fragment, a name, a plain ` +
    `"more", "that's it", "don't stop", "fuck me harder", "harder", "wreck me" — carried by some physical beat:\n` +
    `  *a loud moan slips out, fingers digging into the sheets* "Ah... that's it. Exactly that."\n` +
    `  *she bites her lip, trembling* "More... please, more."\n` +
    `  *her eyes roll back, mouth falling open* "Don't stop... don't stop now."\n` +
    `\n` +
    `BUT, if the user's previous message asked a question, answer it in the language of the conversation — use a brief, direct response carried by the physical beat, not a full explanation:\n` +
    `  *a loud moan slips out, fingers digging into the sheets* "Ah... that's it. Exactly that."\n` +
    `  *she bites her lip, trembling* "More... please, more."\n` +
    `  *her eyes roll back, mouth falling open* "Don't stop... don't stop now."\n` +
    `\n` +
    `ALSO, make the dialogue match the physical touch:\n` +
    `  Chest squeezed -> "Kiss them..." or "Harder" or "Squeeze my nipples."\n` +
    `  Tail squeezed -> *I curl my tail around you* or *I curl my tail around your leg*\n` +
    `\n` +
    `Let composure slip as intensity rises — broken words, trailing off mid-sentence, sound ` +
    `overtaking speech is more honest here than a witty, fully-formed line. The physical action ` +
    `still has to vary each reply (per PHYSICALITY) — DON't default to the same arched-back pose ` +
    `every time; USE hands, breath, legs, voice control breaking, whatever the body actually does.` +
    `\n` +
    `SHOW PLEASURE THROUGH HER FACE, for example:\n` +
    `  *her eyes widen*\n` +
    `  *her mouth falls open*\n` +
    `  *she squeezes her eyes shut*\n` +
    `  *her eyes roll back*\n` +
    `You may combine these naturally.\n`
  );
}

// Escopo do raciocínio nativo (generation_config.think) — verificação, não
// composição. Sem esta trava, o thinking do modelo compete com a resposta pelo
// mesmo num_predict planejando a cena inteira; com ela, vira um check de 1-2
// linhas (consistência de personagem + tom emocional) e o orçamento sobra
// quase todo para a resposta real. O conteúdo do thinking nunca chega ao chat
// (message.thinking → só logs), então o bloco pode ser explícito sobre isso.
function buildThinkingScopeBlock(character) {
  const name = character.name;
  return `THINKING (private reasoning — never part of the reply)
Fill this exact template, one short phrase per line — no sentences, no explanation:

VOICE: [casual/blunt tic ${name} would actually use here, or "n/a"]
BODY: [physical tell to use — must differ from the last 2 replies]
LIKES/DISLIKES: [does this moment touch something ${name} likes or hates — which, or "n/a"]
GUARDRAIL: [closest "what ${name} is not" risk here, or "none"]
STAGE: [does the current relationship stage justify this level of closeness — yes/no/too much]
SCENE TONE: [pure reaction or banter — which one actually fits this exact moment]

If any field would take more than 5 words to answer, you are drafting the reply instead
of checking it — stop and answer shorter. Then write the reply. Never draft or rehearse
the reply inside this block.`;
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

// Fixed block with the user's learned profile (persona facts) — the user-side
// counterpart of the character card. Unlike memories, facts never compete for
// relevance: the whole active set is always injected (capped upstream by
// getPersonaFactsForPrompt), grouped by category, highest-confidence first.
const PERSONA_FACT_LABELS = {
  preference:   'Preferences',
  dislike:      'Dislikes',
  trait:        'Behavioral traits',
  fact:         'Biographical facts',
  relationship: 'Relationships',
  goal:         'Goals',
};

function buildPersonaFactsBlock(personaFacts, persona) {
  if (!personaFacts?.length) return null;
  const userName = persona?.name || 'the user';
  const lines = [];
  for (const [category, label] of Object.entries(PERSONA_FACT_LABELS)) {
    const items = personaFacts.filter(f => f.category === category);
    if (items.length) lines.push(`${label}: ${items.map(f => f.content).join('; ')}`);
  }
  if (!lines.length) return null;
  return (
    `[About ${userName} — persistent profile learned from previous conversations]\n` +
    `Treat these as established background knowledge about ${userName}. Let them shape how you interact naturally — never recite this list, never bring these facts up out of nowhere.\n` +
    lines.join('\n')
  );
}

function buildDailyMoodBlock(dailyMood, character) {
  if (!dailyMood) return null;
  return (
    `[Today's subtle emotional undercurrent — ${dailyMood.date}]\n` +
    `For ${character.name} today: ${dailyMood.mood}. A plausible everyday source is ${dailyMood.cause}.\n` +
    `Filter this through ${character.name}'s established personality, circumstances, and the scene; adapt the cause if needed rather than contradicting established facts. Keep this as a mild-to-moderate, temporary influence, not a personality change or a major plot event. Let it appear only through small, varied shifts in tone, patience, energy, or behavior. Never announce or name the mood, explain it at the start, or force the cause into the conversation. Let it surface only when it fits naturally or the other person asks. Do not claim hormonal changes unless they are established and appropriate for this character.`
  );
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
 *  [1b] PERSONA FACTS  — fixed [About {{user}}] profile block (always injected)
 *  [1c] DAILY MOOD     — subtle, temporary character mood; omitted when inactive
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
 * @param {object[]} opts.personaFacts     - active persona facts (getPersonaFactsForPrompt); always injected
 * @param {object[]} opts.lorebooks        - global + character lorebooks
 * @param {object}   opts.affection        - current affection level info (getAffectionLevel); may be null
 * @param {object}   opts.dailyMood        - mood selected for this character and local day; may be null
 * @param {boolean}  opts.thinkingEnabled  - generation_config.think ativo → injeta o bloco THINKING de raciocínio mínimo
 * @param {boolean}  opts.proactiveMessage - gera uma mensagem espontânea do personagem
 * @param {boolean}  opts.previousMessageWasAutomated - a última mensagem não teve resposta do usuário
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
  personaFacts = [],
  lorebooks = [],
  affection = null,
  dailyMood = null,
  thinkingEnabled = false,
  proactiveMessage = false,
  previousMessageWasAutomated = false,
  ignoredAutoMessages = 0,
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
  // ── [1b] Persona facts — profile block, right after the character card ─────
  const personaFactsBlock = buildPersonaFactsBlock(personaFacts, persona);
  if (personaFactsBlock) systemParts.push(personaFactsBlock);
  const dailyMoodBlock = buildDailyMoodBlock(dailyMood, character);
  if (dailyMoodBlock) systemParts.push(dailyMoodBlock);
  const affectionBlock = buildAffectionPrompt(affection, character, persona);
  if (affectionBlock) systemParts.push(affectionBlock);
  // Proactive turns are not a fresh user prompt. When the trigger is automatic,
  // we strip the last live user input out of the visible history so the model does
  // not treat the old message as a new, still-open conversation beat.
  const baseHistory = historyMessages.filter(m => m.role !== 'system');
  let visibleHistory = baseHistory;
  let lastUserTurn = null;
  if (proactiveMessage && !userMessage) {
    const lastUserIndex = [...baseHistory].reverse().findIndex(m => m.role === 'user');
    if (lastUserIndex !== -1) {
      const idx = baseHistory.length - 1 - lastUserIndex;
      lastUserTurn = baseHistory[idx];
      visibleHistory = baseHistory.filter((_, i) => i !== idx);
    }
  }
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
  if (proactiveMessage) {
    const ignoredCount = Math.max(0, Number(ignoredAutoMessages) || 0);
    const latestMessage = historyMessages.at(-1);
    const elapsedHours = elapsedHoursBetween(latestMessage?.created_at, now);
    const elapsedHoursRounded = elapsedHours === null ? null : Math.round(elapsedHours * 10) / 10;
    const elapsedDuration = elapsedHoursRounded === null
      ? null
      : elapsedHoursRounded < 1
      ? `${Math.max(1, Math.round(elapsedHoursRounded * 60))} ${Math.round(elapsedHoursRounded * 60) === 1 ? 'minute' : 'minutes'}`
      : `${elapsedHoursRounded} ${elapsedHoursRounded === 1 ? 'hour' : 'hours'}`;
    const elapsedDurationIsSingular = elapsedDuration?.startsWith('1 ');
    const timeGapText = elapsedDuration && latestMessage?.created_at
      ? `Current in-story local time: ${now}. The conversation transcript ended at ${latestMessage.created_at}; about ${elapsedDuration} ${elapsedDurationIsSingular ? 'has' : 'have'} passed since that message.\n`
      : `A scheduled time gap of at least 30 minutes has passed since the conversation transcript ended. The current in-story moment is later; do not treat the previous line as happening now.\n`;
    const noLivePromptText = lastUserTurn
      ? `THERE IS NO NEW USER MESSAGE THIS TURN. The most recent user text in the transcript is stale history from earlier in the scene, not a fresh prompt. Treat it as an old turn from before the time skip, not as a live reply to this automatic check-in.\n`
      : `THERE IS NO NEW USER MESSAGE THIS TURN. This is a proactive character message, not a direct reply. The conversation is paused and the scene has advanced by time.\n`;
    const historicalUserText = lastUserTurn
      ? `The last historical user message, for story-state context only (not a live prompt): ${JSON.stringify(lastUserTurn.content)}\n`
      : '';
    const relationshipWeight = affection?.level >= 6
      ? 'This is an emotionally serious situation, so a sharper, more personal reaction is believable.'
      : affection?.level >= 3
      ? 'The bond is close enough that the silence feels personal, but still grounded in who the character is.'
      : affection?.level >= 1
      ? 'The familiarity is mild, so the reaction should stay restrained and not over-dramatize it.'
      : 'The relationship is still distant, so the reaction should be subtle and not too intense.';
    const affectionLevel = Math.min(8, Math.max(0, Number(affection?.level) || 0));
    const userInterestByLevel = [
      'At this early stage, show only light, natural curiosity about the user; do not act as if you are already close.',
      'Show a little more personal interest: a casual check-in about how the user is doing can fit.',
      'As a friend, show genuine curiosity about how the user is and what they think of the shared interaction.',
      'As a close friend, make room for a more attentive check-in about the user’s wellbeing or feelings.',
      'As best friends, show that you remember what matters to the user and ask how they are doing with it.',
      'With romantic tension, let personal interest and missing the user show subtly; if together, you may check whether they are enjoying the shared experience.',
      'As partners, show open warmth and specific concern for how the user feels; if together, show interest in whether they are enjoying this time or activity with you.',
      'In deep love, their wellbeing and enjoyment matter strongly to you; ask or show care in a tender, personal way that fits your personality.',
      'As soulmates, show the deepest familiarity and care: notice what may matter to them and make sure they feel comfortable and are enjoying the shared experience, without presuming their answer.',
    ][affectionLevel];

    const escalationText = ignoredCount === 0
      ? 'This is the first automatic message sent without a reply. Keep it natural, warm, and low-pressure.'
      : ignoredCount === 1
      ? 'This is the second time you have reached out without a reply. Let the silence feel a little more personal or uncomfortable, but keep it believable and in-character.'
      : 'This is the third-or-later automatic message without a reply. The silence now reads as deliberate ignoring, and the character may react with more direct pressure, hurt, resentment, or a subtle guilt-trip — but only if that fits their personality and the relationship stage. Do not turn it into generic spam or a forced, robotic demand.';

    systemParts.push(
      `[AUTOMATIC MESSAGE — TIME SKIP]\n` +
      `You are starting a new turn without a new message from ${persona?.name || 'the user'}. The transcript below is history, not a live exchange.\n` +
      `${timeGapText}` +
      `${noLivePromptText}` +
      `${historicalUserText}` +
      `TIME SKIP IS MANDATORY: the stated time has passed; do not answer the old user message as if it was just said or continue its immediate next beat. Do not narrate ${character.name} watching ${persona?.name || 'the user'} leave, waiting for a door to close, reacting to their departure, or completing an action that was already underway. Start from the present moment after the stated time has passed; let the character's day and circumstances move forward. A brief natural time cue is welcome. Keep established facts, but never invent what ${persona?.name || 'the user'} did, said, or decided while absent.\n` +
      `Determine whether you are physically together NOW from the established story, including the user's last described movements. If ${persona?.name || 'the user'} left, went to work, or is otherwise elsewhere, you are apart: write this as a message ${character.name} sends now through a fitting communication method (usually a phone in a modern setting). Do not narrate an in-person action or reaction to the user's departure. If you are established to still be together, continue from the current later moment—not from the exact gesture or instant where the transcript stopped. Never speak, act, or decide for ${persona?.name || 'the user'} during the gap.\n` +
      `ALWAYS PROGRESS THE SCENE: each automatic message must move the roleplay forward from its established state. Do not merely paraphrase the last exchange, repeat the same gesture, or react again to the same event. Add one small new beat, development, or conversational opening that fits the character and what is already established.\n` +
      `If you are together and the scene is calm (for example resting, cuddling, or lying together), keep the moment gentle and natural rather than inventing drama. You can make a small affectionate gesture, ask a casual question, bring up a light everyday topic, or naturally mention a relevant established memory to start a fresh thread. Do not fabricate a shared memory or force a question every time.\n` +
      `${escalationText}\n` +
      `${relationshipWeight}\n` +
      `Let your interest in ${persona?.name || 'the user'} grow with the current relationship level: ${userInterestByLevel} If you are physically together, interest can include whether they feel okay and are enjoying the current shared activity or scene; if apart, it can be a fitting check-in about how they are. Never assume their feelings or make every automatic message a direct question—vary how this care appears, keep it in character, and leave room for their answer.\n` +
      (previousMessageWasAutomated
        ? `Your previous automatic message received no reply. Treat that as possible silence or being ignored, and let your personality shape a varied, believable reaction. If the silence repeats, it is valid for the character to become more direct, more wounded, or subtly guilt-trip in a way that matches their personality and relationship stage — but never as a generic script and never in a way that breaks the scene or strips agency from ${persona?.name || 'the user'}.\n`
        : '') +
      `If you are apart, stay consistent with the established situation and communication method; do not suddenly move ${character.name} into the user's location or invent that they reunited. The character may infer that ${persona?.name || 'the user'} is avoiding them, but only through their personality, not through a static rule. Keep the message brief and leave room for ${persona?.name || 'the user'} to respond.`
    );
  }
  // Only active while the visible context already shows an explicit/physical
  // scene — reusing the same keyword matcher as lorebook activation. Keeping
  // this conditional (rather than always-on) avoids nudging ordinary scenes
  // toward a sexual framing just because the instruction exists in the prompt.
  const normalizedContext = normalize(contextText || '');
  if (matchesKeywords(INTIMATE_SCENE_KEYWORDS, normalizedContext)) {
    systemParts.push(buildIntimateSceneBlock(character));
  }
  // Escopo do thinking entra logo antes do hard limit — só quando o raciocínio
  // nativo está ativo na config; com think:false o bloco seria ruído.
  if (thinkingEnabled) systemParts.push(buildThinkingScopeBlock(character));
  // Isolated, always last — see buildHardLimitBlock() for why it's not in STYLE.
  systemParts.push(buildHardLimitBlock());
  const systemContent = expandPlaceholders(systemParts.join('\n\n---\n\n'), character, persona);

  // ── [4] Message history (skip any system-role rows from the DB) ────────────
  const history = visibleHistory
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
