import { appConfig } from "../../config.js";
import { getMemories, getPinnedMemories } from "../../services/database/queries.js";
import { createAutoMemory, createPinnedMemory } from "./create.js";
import { extractKeywordsFromText } from "./retrieval.js";

const OLLAMA_URL = appConfig.ollama.chatEndpoint;

// JSON Schema para structured outputs do Ollama — garante JSON válido na resposta.
const RESPONSE_FORMAT = {
    type: "object",
    properties: {
        memories: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    content:    { type: "string" },
                    keywords:   { type: "string" },
                    summary:    { type: ["string", "null"] },
                    pinned:     { type: "boolean" },
                    importance: { type: "integer", minimum: 1, maximum: 5 },
                },
                required: ["content", "keywords", "pinned", "importance"],
            },
        },
    },
    required: ["memories"],
};

function buildExtractionPrompt(character, personaName) {
    const characterName = character?.name || 'Character';
    const baseline = [
        character?.description && `Description: ${character.description}`,
        character?.personality && `Personality: ${character.personality}`,
    ].filter(Boolean).join('\n\n');

    return `You are the memory system of a roleplay chat between ${personaName} (the user) 
and ${characterName} (the AI character).

Your job: read the conversation excerpt and extract memory entries that will 
help reconstruct context in future sessions. Think like someone writing 
session notes after a tabletop RPG — capture what matters, skip what doesn't.

---
CHARACTER BASELINE — ${characterName}:
${baseline || '(no baseline provided)'}
---
The baseline is permanent. Never extract a memory that restates, paraphrases, 
or slightly rewords anything already in it. Only extract what is NEW.

---
WHAT TO EXTRACT:

1. CONTEXTUAL memories ("pinned": false)
The episodic record. Capture only what is new and retrievable — things that 
would matter if mentioned again three sessions from now.

Extract when present:
- New facts about ${personaName} or ${characterName}: job, past, family, 
  fears, plans, preferences, physical details not in the baseline
- Scene developments: where they went, what they did, decisions made, 
  objects acquired or lost
- Agreements, plans, open threads: "they agreed to meet again", 
  "she promised to teach him guitar"
- Reactions that reveal character: how someone responded to a specific 
  situation that wasn't obvious from the baseline

Skip: jokes with no consequence, small talk that reveals nothing, 
reactions that are completely predictable from the baseline, 
anything that won't matter in a future session.

2. CORE memories ("pinned": true)
Reserve for moments that permanently change the character, the relationship,
or the story. The bar is high — pinned memories must stay rare, not a
running highlight reel of nice moments. Ask: would this person still think
about this moment a year later, unprompted?

THE MUNDANE TEST — apply before marking anything pinned:
If this could plausibly happen again on an ordinary day between two people
who already have this relationship — without changing who they are to each
other — it is NOT pinned, no matter how warm, sweet, or emotionally charged
the scene felt in the moment. The question is never "was this a nice
moment?" but "does this permanently move the baseline of the relationship
or the character going forward?"

Pin only:
- High-stakes events: death, violence, rescue, betrayal, serious injury,
  major loss, physical transformation
- Emotional turning points that happen for the FIRST time: love confession,
  grief, overwhelming fear, a moment of genuine rage — not a routine repeat
  of a dynamic that's already established
- Relationship stage changes: strangers becoming close, trust broken,
  forgiveness after real conflict, first physical intimacy
- Decisions that close off other paths: "she left Rhodes Island",
  "he told her the truth about his past"

Do NOT pin — everyday life, even when tender or emotional in the moment:
- Routine affection once the relationship is already established: hugs,
  kisses, cuddling, holding hands, saying "I love you" again
- Shared daily activities: eating together, sleeping together, waking up
  together, watching something, running errands, going to work, cooking
- Ordinary conversation: talking about their day, making small plans,
  minor complaints, jokes, compliments, comforting each other after an
  everyday bad mood or a rough day at work
- Ordinary mood shifts: passing frustration, mild embarrassment, being
  tired, hungry, or sleepy
- Anything that could plausibly repeat next week without either of them
  remarking on it as unusual

When in doubt, do NOT pin — extract it as a contextual (auto) memory
instead. Missing a pin costs little; a mundane pin pollutes every future
prompt for the rest of the conversation.

---
FOR EVERY MEMORY:

"content": One standalone sentence. Third person, past tense. 
Must be understandable with zero context from the excerpt — 
someone reading only this sentence should know what happened, 
who was involved, and why it matters.

"keywords": 3-6 terms. Specific enough that they would naturally 
appear in a future message if this topic came up again.
Good: character names, place names, object names, specific emotions 
(grief, jealousy, pride), specific topics (guitar, the mission, her brother)
Bad: "conversation", "moment", "feeling", "reaction", "event", "chat"

"summary": 3-6 word label, or null if the content is already short enough.

"pinned": true only if it meets the CORE criteria. Core memories are rare —
most excerpts produce zero.

"importance": 1-5
1 — minor detail, useful but forgettable
2 — worth keeping, adds texture
3 — clearly relevant to future sessions
4 — significantly shapes the character or relationship
5 — would redefine the story if forgotten
Most contextual memories are 2-3. Inflating importance makes the system useless.
Pinned memories REQUIRE importance 4 or 5 — if a moment doesn't reach a 4,
it does not meet the CORE bar; set "pinned": false instead.

---
OUTPUT RULES:
- Typically 1-4 contextual memories per excerpt, 0-1 core memories
- Never merge unrelated facts into one entry
- Never restate the baseline
- Respond ONLY with valid JSON, no markdown, no preamble, no explanation
- Format: {"memories": [{"content": "...", "keywords": "kw1, kw2, kw3", 
  "summary": "short label or null", "pinned": false, "importance": 2}]}
- If nothing notable happened: {"memories": []}`;
}

// Overlap de palavras (>= 4 chars) acima de 0.55 = memória duplicada
function isTooSimilar(existingList, candidate) {
    const words = new Set(candidate.toLowerCase().split(/\s+/).filter(w => w.length >= 4));
    if (words.size === 0) return false;
    return existingList.some(m => {
        const existing = new Set((m.content || '').toLowerCase().split(/\s+/).filter(w => w.length >= 4));
        return [...words].filter(w => existing.has(w)).length / words.size > 0.55;
    });
}

// Converte a nota de importância (1-5) do modelo em relevance_weight.
// Pinned: 1.2–2.0 (prioriza dentro do cap de 10); auto: 0.8–1.2 (modula o score do retrieval).
function importanceToWeight(importance, pinned) {
    const level = Math.min(5, Math.max(1, Number.isFinite(importance) ? importance : 3));
    return pinned ? 1.0 + 0.2 * level : 0.7 + 0.1 * level;
}

// Timeout da chamada de extração — sem isso uma travada do Ollama seguraria a
// promise (e o lock do trigger) indefinidamente.
const EXTRACTION_TIMEOUT_MS = 120_000;

async function callOllama(model, systemPrompt, excerpt, withFormat) {
    return fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user',   content: `Conversation excerpt:\n\n${excerpt}` },
            ],
            stream: false,
            think:  false,
            ...(withFormat ? { format: RESPONSE_FORMAT } : {}),
            options: { temperature: 0.15, num_predict: 1000, top_p: 0.9 },
        }),
    });
}

/**
 * Extrator unificado: uma única chamada Ollama que analisa o trecho e retorna
 * memórias contextuais (auto) e core (pinned) de uma vez.
 *
 * @param {string}   conversationId
 * @param {object[]} recentMessages - mensagens a analisar (role !== 'system')
 * @param {object}   opts
 * @param {object}   opts.character - { name, description, personality, ... }
 * @param {object}   opts.persona   - { name, ... }
 * @param {object}   opts.config    - { model, ... }
 * @returns {Promise<{auto: string[], pinned: string[]} | null>}
 *          null em falha de rede/modelo/parsing — o caller NÃO deve avançar o cursor.
 */
export async function extractAndSaveMemories(conversationId, recentMessages, { character, persona, config } = {}) {
    if (!recentMessages?.length) return { auto: [], pinned: [] };

    const characterName = character?.name || 'Character';
    const personaName   = persona?.name   || 'User';
    const model         = config?.model   || appConfig.defaults.model;

    const excerpt = recentMessages
        .filter(m => m.role !== 'system')
        .map(m => `${m.role === 'user' ? personaName : characterName}: ${m.content}`)
        .join('\n');

    const systemPrompt = buildExtractionPrompt(character, personaName);

    try {
        // Structured outputs garantem JSON; versões antigas do Ollama podem rejeitar
        // o campo `format` — nesse caso tenta uma vez sem ele.
        let res = await callOllama(model, systemPrompt, excerpt, true);
        if (!res.ok) res = await callOllama(model, systemPrompt, excerpt, false);
        if (!res.ok) return null;

        const data = await res.json();
        const text = (data.message?.content || '').trim()
            .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

        const jsonStart = text.indexOf('{');
        const jsonEnd   = text.lastIndexOf('}');
        if (jsonStart === -1 || jsonEnd === -1) return null;

        const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
        if (!Array.isArray(parsed?.memories)) return null;

        const existingPinned = getPinnedMemories(conversationId);
        const existingAuto   = getMemories(conversationId).filter(m => !m.is_pinned);
        const created = { auto: [], pinned: [] };

        // A memória registra QUANDO o fato aconteceu (horário das mensagens de
        // origem), não quando a extração rodou — se o usuário voltar dias depois
        // e o backlog for processado, o prompt ainda mostra "3 days ago" correto.
        const happenedAt = recentMessages.at(-1)?.created_at ?? null;

        for (const item of parsed.memories) {
            const content = item?.content?.trim();
            if (!content) continue;

            // Nenhuma memória fica órfã: sem keywords do modelo, deriva do próprio content
            const keywords = item.keywords?.trim()
                || extractKeywordsFromText(content).slice(0, 6).join(', ')
                || null;
            const summary = item.summary?.trim() || null;

            // Trava de segurança independente do prompt: pinned exige importance >= 4
            // (ver buildExtractionPrompt). Um modelo que desobedecer é rebaixado para
            // auto em vez de virar memória mundana permanente no prompt para sempre.
            const importance = Number.isFinite(item.importance) ? item.importance : 3;
            const isPinned = !!item.pinned && importance >= 4;
            const weight    = importanceToWeight(importance, isPinned);

            try {
                if (isPinned) {
                    if (isTooSimilar(existingPinned, content)) continue;
                    const id = createPinnedMemory(conversationId, content, {
                        keywords, summary, relevanceWeight: weight, happenedAt,
                    });
                    created.pinned.push(id);
                    existingPinned.push({ content, is_pinned: true });
                } else {
                    // Auto que duplica uma pinned também é ruído — dedup contra as duas listas
                    if (isTooSimilar(existingAuto, content) || isTooSimilar(existingPinned, content)) continue;
                    const id = createAutoMemory(conversationId, content, {
                        keywords, summary, relevanceWeight: weight, happenedAt,
                    });
                    created.auto.push(id);
                    existingAuto.push({ content, type: 'auto' });
                }
            } catch { /* validação falhou (content curto demais) — ignora o item */ }
        }

        return created;
    } catch {
        return null;
    }
}
