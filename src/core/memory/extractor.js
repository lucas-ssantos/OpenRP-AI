import { appConfig } from "../../config.js";
import { getPinnedMemories } from "../../services/database/queries.js";
import { createPinnedMemory } from "./create.js";

const OLLAMA_URL = appConfig.ollama.chatEndpoint;

function buildSystemPrompt(character) {
    const name = character?.name || 'the character';
    const baseline = [
        character?.description && `Description: ${character.description}`,
        character?.personality && `Personality: ${character.personality}`,
    ].filter(Boolean).join('\n\n');

    return `You are a strict memory extraction system for a roleplay application.
Your only job is to identify facts that PERMANENTLY AND IRREVERSIBLY change who ${name} is — things that alter their identity, core relationship structure, or fundamental behavior going forward, and that were NOT already part of their established baseline.

---
CHARACTER BASELINE — ${name}:
${baseline || '(no baseline provided)'}
---

Use the baseline above as the reference for what is NORMAL for ${name}. Only create a memory if something in the excerpt DEVIATES from or EXTENDS BEYOND that baseline in a way that is permanent and cannot be undone.

QUALIFY as pinned memory (must meet ALL three conditions):
1. NOT already described or implied in the baseline above
2. Cannot be reversed — it is a fact that will still be true in future conversations
3. Changes WHO ${name} IS, not just what happened in this scene

Examples that qualify:
- Permanent physical or identity change absent from baseline: lost a limb, revealed a hidden power, underwent transformation
- Relationship structure irreversibly shifted: enemy became a trusted ally, a secret bond was forged
- Secret revealed with no way back: knows the user's true identity, learned a fact that redefines everything
- Vow or rule adopted that will govern all future behavior: swore never to do X, made a binding promise

DO NOT qualify (return [] for these):
- Any behavior, trait, or preference ALREADY described in the baseline — even if shown vividly in the excerpt
- Emotional reactions, even intense ones: anger, sadness, fear, excitement — they pass
- Scene details: where they were, what the weather was like
- Temporary states: tired, nervous, hopeful
- Preferences or habits that belong in personality, not memory

When in doubt, return []. A false negative (missing a borderline memory) is far less harmful than a false positive (polluting the context with noise that mimics the baseline).

Respond ONLY with a JSON array — no markdown, no explanation. Each object:
  "content": string (factual statement of the permanent change, minimum 20 characters)
  "keywords": string (comma-separated keywords)
  "summary": string | null

If nothing qualifies, respond with exactly: []`;
}

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
                    { role: 'system', content: buildSystemPrompt(character) },
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
