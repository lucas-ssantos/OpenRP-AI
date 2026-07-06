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

    return `You are the memory system of a roleplay chat between ${personaName} (the user) and ${characterName} (the character).
Analyze the conversation excerpt and extract memory entries capturing what happened, what was revealed, and what changed.

---
CHARACTER BASELINE — ${characterName}:
${baseline || '(no baseline provided)'}
---
Everything in the baseline is already permanent knowledge. NEVER create a memory that merely restates or paraphrases it.

Extract two kinds of memories:

1. CONTEXTUAL memories ("pinned": false) — the episodic record of this excerpt. Capture ALL of:
- Facts revealed about the user or the character (job, past, family, plans, fears)
- Story and scene developments: what they did, where they went, decisions made
- Emotional moments and reactions worth recalling later
- Promises, plans and open threads ("they agreed to meet at the festival")
Write each as ONE standalone sentence, third person, past tense, understandable without the excerpt.

2. CORE memories ("pinned": true) — reserve for moments that will define the character or the relationship from now on:
- Very strong events: death, birth, violence, rescue, betrayal, first intimacy, a life-changing decision
- Intense feelings explicitly expressed or unmistakably shown: a love confession, deep hatred, grief, overwhelming fear or joy
- Major emotional turns: love <-> hate, trust <-> betrayal, stranger -> lover, friend -> enemy, forgiveness after a grudge
- Physical changes: injury, scar, transformation, pregnancy, marked change of appearance
Do NOT pin ordinary mood swings or mild passing reactions. Pin the moments a person would still remember years later.

For EVERY memory provide:
- "content": self-contained factual sentence, minimum 20 characters, no commentary
- "keywords": 3-6 comma-separated specific terms someone would naturally use when this topic comes up again (names, places, objects, feelings — never generic words like "conversation" or "moment")
- "summary": very short label (3-6 words) or null
- "pinned": true only if it meets the CORE criteria above
- "importance": integer 1-5 (5 = unforgettable). Core memories must be 3 or higher.

Rules:
- Cover everything notable in the excerpt; do not merge unrelated facts into one entry
- Typically 1-4 contextual memories and 0-1 core memories per excerpt; core memories are rare
- Never restate the character baseline
- Respond ONLY with valid JSON, no markdown, no explanation:
{"memories": [{"content": "...", "keywords": "kw1, kw2, kw3", "summary": "short label or null", "pinned": false, "importance": 3}]}
- If nothing notable happened, respond with exactly: {"memories": []}`;
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

async function callOllama(model, systemPrompt, excerpt, withFormat) {
    return fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

        for (const item of parsed.memories) {
            const content = item?.content?.trim();
            if (!content) continue;

            // Nenhuma memória fica órfã: sem keywords do modelo, deriva do próprio content
            const keywords = item.keywords?.trim()
                || extractKeywordsFromText(content).slice(0, 6).join(', ')
                || null;
            const weight  = importanceToWeight(item.importance, !!item.pinned);
            const summary = item.summary?.trim() || null;

            try {
                if (item.pinned) {
                    if (isTooSimilar(existingPinned, content)) continue;
                    const id = createPinnedMemory(conversationId, content, {
                        keywords, summary, relevanceWeight: weight,
                    });
                    created.pinned.push(id);
                    existingPinned.push({ content, is_pinned: true });
                } else {
                    // Auto que duplica uma pinned também é ruído — dedup contra as duas listas
                    if (isTooSimilar(existingAuto, content) || isTooSimilar(existingPinned, content)) continue;
                    const id = createAutoMemory(conversationId, content, {
                        keywords, summary, relevanceWeight: weight,
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
