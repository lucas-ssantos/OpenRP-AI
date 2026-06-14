import { appConfig } from "../../config.js";
import { getPinnedMemories } from "../../services/database/queries.js";
import { createPinnedMemory } from "./create.js";

const OLLAMA_URL = appConfig.ollama.chatEndpoint;

const SYSTEM_PROMPT = `You are a memory extraction system for a roleplay application.
Analyze the conversation excerpt and identify ONLY facts that permanently change WHO the character is.

QUALIFY as pinned memory:
- Permanent physical/state changes: "Lost their right arm in the battle of Ardenmoor"
- Structural relationship shifts: "Now considers the user a fully trusted ally"
- Revealed secrets that cannot be un-revealed: "Knows the user is the rightful heir to the throne"
- Vows or rules that define future behavior: "Swore never to speak their brother's name again"

DO NOT qualify:
- Emotional reactions: "Got angry when horses were mentioned"
- Preferences: "Likes tea" (belongs in character personality, not memory)
- Scene or location details: "They were in the café when the secret was revealed"
- Temporary states: "Is currently nervous about the mission"

Respond ONLY with a JSON array — no markdown, no explanation. Each object must have:
  "content": string (clear statement of the permanent fact, at least 20 characters)
  "keywords": string (comma-separated keywords identifying the topic)
  "summary": string | null (shorter optional label)

If nothing qualifies, respond with exactly: []`;

function isTooSimilar(existing, candidate) {
    const candidateWords = new Set(candidate.toLowerCase().split(/\s+/).filter(w => w.length >= 4));
    if (candidateWords.size === 0) return false;
    return existing.some(m => {
        const existingWords = new Set((m.content || '').toLowerCase().split(/\s+/).filter(w => w.length >= 4));
        const intersection = [...candidateWords].filter(w => existingWords.has(w)).length;
        return intersection / candidateWords.size > 0.55;
    });
}

/**
 * Analisa as mensagens recentes e cria pinned memories automaticamente se identificar
 * mudanças permanentes no personagem. Fire-and-forget — não bloqueia o streaming.
 *
 * @param {string}   conversationId
 * @param {object[]} recentMessages  - últimas mensagens (filtradas de system)
 * @param {object}   character       - { name, ... }
 * @param {object}   modelConfig     - { model, ... } para reutilizar o modelo da conversa
 * @returns {Promise<string[]>}      - IDs das memórias criadas (pode ser [])
 */
export async function extractAndSavePinnedMemories(conversationId, recentMessages, character, modelConfig) {
    if (!recentMessages?.length) return [];

    const excerpt = recentMessages
        .filter(m => m.role !== 'system')
        .slice(-10)
        .map(m => `${m.role === 'user' ? 'User' : character.name}: ${m.content}`)
        .join('\n');

    try {
        const res = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelConfig?.model || appConfig.defaults.model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: `Conversation excerpt:\n\n${excerpt}` },
                ],
                stream: false,
                think: false,
                options: { temperature: 0.1, num_predict: 600, top_p: 0.9 },
            }),
        });

        if (!res.ok) return [];

        const data = await res.json();
        const text = (data.message?.content || '').trim()
            .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

        const jsonStart = text.indexOf('[');
        const jsonEnd   = text.lastIndexOf(']');
        if (jsonStart === -1 || jsonEnd === -1) return [];

        const extracted = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
        if (!Array.isArray(extracted) || extracted.length === 0) return [];

        const existing = getPinnedMemories(conversationId);
        const created  = [];

        for (const item of extracted) {
            if (!item.content?.trim() || !item.keywords?.trim()) continue;
            if (isTooSimilar(existing, item.content)) continue;

            try {
                const id = createPinnedMemory(conversationId, item.content, {
                    keywords: item.keywords,
                    summary:  item.summary || null,
                });
                created.push(id);
                existing.push({ content: item.content, is_pinned: true });
            } catch {
                // validation failed — content too short or keywords missing; skip
            }
        }

        return created;
    } catch {
        return [];
    }
}
