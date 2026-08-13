import { appConfig } from "../../config.js";
import {
    getActivePersonaFacts, createPersonaFact, reinforcePersonaFact, supersedePersonaFact,
    getPersonaBacklog, getLastPersonaPosition, setLastPersonaPosition,
    PERSONA_FACT_CATEGORIES,
} from "../../services/database/queries.js";
import { parseKeywords, extractKeywordsFromText, normalize } from "./retrieval.js";

const OLLAMA_URL = appConfig.ollama.chatEndpoint;

// Cap de fatos injetados no prompt. Fatos são frases de uma linha (~10 tokens
// cada) — 30 fatos ≈ 300 tokens, barato o bastante para estar sempre presente.
const PROMPT_FACTS_CAP = 30;

// Fatos que formam o bloco [About {{user}}] — sempre injetado, sem keyword
// matching (o perfil do usuário é sempre relevante, como a ficha do personagem).
export function getPersonaFactsForPrompt() {
    return getActivePersonaFacts(PROMPT_FACTS_CAP);
}

// JSON Schema para structured outputs do Ollama — garante JSON válido na resposta.
const RESPONSE_FORMAT = {
    type: "object",
    properties: {
        facts: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    content:   { type: "string" },
                    category:  { type: "string", enum: PERSONA_FACT_CATEGORIES },
                    keywords:  { type: "string" },
                    action:    { type: "string", enum: ["new", "reinforce", "supersede"] },
                    target:    { type: ["integer", "null"] },
                    certainty: { type: "integer", minimum: 1, maximum: 5 },
                },
                required: ["content", "category", "keywords", "action", "certainty"],
            },
        },
    },
    required: ["facts"],
};

function buildPersonaExtractionPrompt(personaName, characterName, persona, knownFacts) {
    const baseline  = persona?.description?.trim() || '(no baseline provided)';
    const factsList = knownFacts.length
        ? knownFacts.map((f, i) => `#${i} [${f.category}] ${f.content}`).join('\n')
        : '(none yet — the profile is empty)';

    return `You are the profile-learning system of a roleplay chat platform.
${personaName} is the human user; ${characterName} is the AI character they talk to.

Your job: read the conversation excerpt and update the persistent profile of
${personaName} — WHO they are, not what happened. Think of it as a character
sheet for the user, filled in gradually as they reveal themselves.

THE FRAMING TEST — the most important rule:
Events belong to another system. You only record TIMELESS characteristics.
- "I'm hungry today" → NOT a fact (transient state)
- complains about hunger every afternoon → trait (pattern)
- "rough day at work today" → NOT a fact (event)
- "I work the night shift as a nurse" → fact (biography)
Ask: would this still be true about ${personaName} a month from now, in any
scene? If not, skip it.

---
PERSONA BASELINE — what ${personaName}'s sheet already says:
${baseline}
---
The baseline is permanent. Never extract anything that restates or paraphrases it.

KNOWN FACTS — the profile learned so far:
${factsList}
---

FOR EACH FACT YOU FIND, choose ONE action:

"new"       → not covered by any KNOWN FACT: create it ("target": null)
"reinforce" → the excerpt confirms a KNOWN FACT again (same meaning, any
              wording): do NOT duplicate it ("target": its #number)
"supersede" → the excerpt CONTRADICTS a KNOWN FACT — it is now outdated
              (changed job, changed taste, dropped habit). The new fact
              replaces the old one ("target": the outdated fact's #number)

CATEGORIES:
- "preference":   likes, enjoys, is drawn to
- "dislike":      avoids, dislikes, is bothered by
- "trait":        behavior pattern you OBSERVE across messages — what they
                  demonstrate, not what they claim about themselves
- "fact":         concrete biography — work, routine, family, home, skills
- "relationship": how they relate to people or things outside this roleplay
- "goal":         something they are pursuing or working toward

FOR EVERY ITEM:
"content": one short standalone sentence about ${personaName}. Third person,
present tense, understandable with zero context. Write it in the language
${personaName} uses in the excerpt.
"keywords": 2-5 specific terms — the subject of the fact ("cheese",
"night shift"), never generic words ("likes", "conversation", "person").
"certainty": 1-5. 5 = ${personaName} stated it plainly; 3 = clearly implied;
1 = weak hint. When in doubt, use the lower number.

RULES:
- Facts are about ${personaName} ONLY — never about ${characterName}.
- Only what the excerpt actually shows. Never invent or embellish.
- In-character actions still reveal the persona; scene details do not.
- Most excerpts contain 0-3 facts. An empty list is a common, correct answer.
- Respond ONLY with valid JSON, no markdown, no preamble.
- Format: {"facts": [{"content": "...", "category": "preference",
  "keywords": "kw1, kw2", "action": "new", "target": null, "certainty": 3}]}
- Nothing timeless revealed: {"facts": []}`;
}

// ── Dedup mecânico (rede de segurança sob as ações do modelo) ────────────────

// Sobreposição de keywords entre dois fatos: interseção / menor conjunto.
function keywordOverlap(aCsv, bCsv) {
    const a = parseKeywords(aCsv);
    const b = parseKeywords(bCsv);
    if (!a.length || !b.length) return 0;
    const setB = new Set(b);
    return a.filter(k => setB.has(k)).length / Math.min(a.length, b.length);
}

// Sobreposição de palavras (≥4 chars, sem acentos) do conteúdo.
function contentOverlap(a, b) {
    const wa = new Set(normalize(a).split(/\s+/).filter(w => w.length >= 4));
    const wb = new Set(normalize(b).split(/\s+/).filter(w => w.length >= 4));
    if (!wa.size || !wb.size) return 0;
    return [...wa].filter(w => wb.has(w)).length / Math.min(wa.size, wb.size);
}

// Fato equivalente já ativo NA MESMA categoria → reforço em vez de duplicata.
// Restrito à categoria de propósito: entre categorias diferentes, keywords
// iguais costumam ser contradição ("gosta de queijo" × "não gosta de queijo"),
// e contradição é decisão semântica do modelo (action: "supersede"), não nossa.
function findDuplicate(activeFacts, { category, content, keywords }) {
    return activeFacts.find(f =>
        f.status === 'active' && f.category === category &&
        (keywordOverlap(f.keywords, keywords) >= 0.6 || contentOverlap(f.content, content) >= 0.7)
    ) || null;
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
            options: { temperature: 0.15, num_predict: 800, top_p: 0.9 },
        }),
    });
}

/**
 * Extrator de persona facts: UMA chamada Ollama que lê o trecho junto com os
 * fatos já conhecidos e decide, item a item, se cria (new), reforça um
 * existente (reinforce: times_confirmed/confidence sobem) ou substitui um
 * desatualizado (supersede: o antigo vira histórico, nunca é deletado).
 *
 * @param {string}   conversationId  - origem dos fatos (auditoria); os fatos em si são globais
 * @param {object[]} recentMessages  - mensagens a analisar (role !== 'system')
 * @param {object}   opts
 * @param {object}   opts.character  - { name, ... }
 * @param {object}   opts.persona    - { name, description, ... }
 * @param {object}   opts.config     - { model, ... }
 * @returns {Promise<{created: string[], reinforced: string[], superseded: string[]} | null>}
 *          null em falha de rede/modelo/parsing — o caller NÃO deve avançar o cursor.
 */
export async function extractAndSavePersonaFacts(conversationId, recentMessages, { character, persona, config } = {}) {
    if (!recentMessages?.length) return { created: [], reinforced: [], superseded: [] };

    const characterName = character?.name || 'Character';
    const personaName   = persona?.name   || 'User';
    const model         = config?.model   || appConfig.defaults.model;

    // Snapshot local dos fatos ativos: indexa o prompt (#N do target) e serve de
    // base para o dedup; atualizado em memória conforme os itens são aplicados.
    const activeFacts = getActivePersonaFacts();

    const excerpt = recentMessages
        .filter(m => m.role !== 'system')
        .map(m => `${m.role === 'user' ? personaName : characterName}: ${m.content}`)
        .join('\n');

    const systemPrompt = buildPersonaExtractionPrompt(personaName, characterName, persona, activeFacts);

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
        if (!Array.isArray(parsed?.facts)) return null;

        const result = { created: [], reinforced: [], superseded: [] };

        for (const item of parsed.facts) {
            const content = item?.content?.trim();
            if (!content || content.length < 6) continue;

            const category = PERSONA_FACT_CATEGORIES.includes(item.category) ? item.category : 'fact';
            const keywords = item.keywords?.trim()
                || extractKeywordsFromText(content).slice(0, 5).join(', ')
                || null;
            const certainty  = Math.min(5, Math.max(1, Number.isFinite(item.certainty) ? item.certainty : 3));
            const confidence = 0.4 + 0.1 * certainty; // 0.5–0.9; cada reforço soma +0.1 (cap 1.0)

            const target      = Number.isInteger(item.target) ? activeFacts[item.target] : null;
            const validTarget = target && target.status === 'active' ? target : null;

            if (item.action === 'reinforce' && validTarget) {
                reinforcePersonaFact(validTarget.id);
                result.reinforced.push(validTarget.id);
                continue;
            }

            if (item.action === 'supersede' && validTarget) {
                // Conteúdo idêntico ao alvo não é contradição — é reforço; substituir
                // zeraria confiança/contador à toa. (Só a igualdade exata é segura
                // aqui: contradições compartilham keywords por natureza.)
                if (normalize(content) === normalize(validTarget.content)) {
                    reinforcePersonaFact(validTarget.id);
                    result.reinforced.push(validTarget.id);
                    continue;
                }
                const newId = createPersonaFact({ category, content, keywords, confidence, sourceConversationId: conversationId });
                supersedePersonaFact(validTarget.id, newId);
                validTarget.status = 'superseded';
                activeFacts.push({ id: newId, category, content, keywords, status: 'active' });
                result.created.push(newId);
                result.superseded.push(validTarget.id);
                continue;
            }

            // "new" (ou reinforce/supersede com target inválido): dedup mecânico
            // por sobreposição antes de criar — reconfirmação vira reforço.
            const dup = findDuplicate(activeFacts, { category, content, keywords });
            if (dup) {
                reinforcePersonaFact(dup.id);
                result.reinforced.push(dup.id);
                continue;
            }

            const id = createPersonaFact({ category, content, keywords, confidence, sourceConversationId: conversationId });
            activeFacts.push({ id, category, content, keywords, status: 'active' });
            result.created.push(id);
        }

        return result;
    } catch {
        return null;
    }
}

// Conversas com extração de perfil em andamento — evita processar o mesmo
// backlog duas vezes quando turnos chegam em sequência rápida.
const processing = new Set();

/**
 * Gatilho da extração de persona facts — irmão de processMemoryBacklogIfDue,
 * com cursor próprio (conversations.last_persona_position) e ritmo próprio:
 * dispara a cada `persona_interval` mensagens DO USUÁRIO após o cursor
 * (0 = desligado). Não espera as mensagens saírem da janela de contexto —
 * fatos de perfil não duplicam o histórico, então quanto antes, melhor.
 *
 * O cursor só avança se a extração concluir com sucesso — falha de Ollama
 * vira retry natural no próximo turno; rollback clampeia, reset zera.
 *
 * @returns {Promise<{created: number, reinforced: number, superseded: number} | null>}
 *          null se nada era devido, extração desligada ou falha.
 */
export async function processPersonaBacklogIfDue(conversationId, { character, persona, config, onStart } = {}) {
    if (processing.has(conversationId)) return null;

    const interval = config?.persona_interval;
    if (!Number.isInteger(interval) || interval <= 0) return null;

    // O batch traz user+assistant (o extrator precisa do diálogo completo como
    // contexto), mas o intervalo conta só as mensagens do usuário. Cap em
    // interval*6 ≈ 3 janelas de pares; backlog longo entra nos próximos turnos.
    const lastProcessed = getLastPersonaPosition(conversationId);
    const batch = getPersonaBacklog(conversationId, lastProcessed, interval * 6);

    const userMsgCount = batch.filter(m => m.role === 'user').length;
    if (userMsgCount < interval) return null;

    processing.add(conversationId);
    try {
        onStart?.();
        const result = await extractAndSavePersonaFacts(conversationId, batch, { character, persona, config });
        if (result === null) return null;

        setLastPersonaPosition(conversationId, Math.max(...batch.map(m => m.position ?? 0)));
        return {
            created:    result.created.length,
            reinforced: result.reinforced.length,
            superseded: result.superseded.length,
        };
    } finally {
        processing.delete(conversationId);
    }
}
