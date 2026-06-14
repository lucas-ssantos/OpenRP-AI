import { getMemories, getPinnedMemories } from "../../services/database/queries.js";

// Palavras irrelevantes filtradas na extração de keywords do texto da conversa
const STOP_WORDS = new Set([
    // PT
    'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
    'ao', 'aos', 'por', 'para', 'com', 'sem', 'sob', 'que', 'não',
    'uma', 'uns', 'umas', 'isso', 'este', 'esta', 'esse', 'essa',
    'ele', 'ela', 'nós', 'eles', 'elas', 'você', 'vocês', 'lhe',
    'ser', 'ter', 'foi', 'era', 'são', 'tem', 'há', 'mas', 'mais',
    // EN
    'the', 'and', 'for', 'with', 'are', 'was', 'were', 'have', 'has',
    'had', 'does', 'did', 'this', 'that', 'they', 'from', 'been',
]);

/**
 * Converte a string de keywords armazenada no banco (csv) em array normalizado.
 */
export function parseKeywords(str) {
    if (!str) return [];
    return str.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
}

/**
 * Extrai termos relevantes de um texto livre para usar na busca por memórias.
 * Remove stop words e palavras curtas, retorna array de palavras únicas.
 */
export function extractKeywordsFromText(text) {
    if (!text) return [];
    return [...new Set(
        text.toLowerCase()
            .replace(/[^\wáàâãéèêíïóôõúüç\s]/gi, ' ')
            .split(/\s+/)
            .filter(w => w.length >= 3 && !STOP_WORDS.has(w))
    )];
}

/**
 * Pontua uma memória contra um texto de contexto.
 * Score = (hits / total_keywords) * relevance_weight
 * Memórias com keywords que cobrem mais do contexto recebem score maior.
 * Retorna 0 se a memória não tiver keywords cadastradas.
 */
function scoreMemory(memory, contextText) {
    const keywords = parseKeywords(memory.keywords);
    if (keywords.length === 0) return 0;
    const lower = contextText.toLowerCase();
    const hits = keywords.filter(kw => lower.includes(kw)).length;
    return (hits / keywords.length) * (memory.relevance_weight ?? 1);
}

/**
 * Retorna as memórias mais relevantes para o contexto fornecido.
 *
 * Regras:
 *  - Pinned: sempre incluídas, mas limitadas por `maxPinned` e ordenadas por relevance_weight DESC.
 *    Se houver mais pinned do que o limite, as de menor peso são descartadas.
 *    Isso previne que o prompt estoure por acúmulo de pinned ao longo de conversas longas.
 *  - Não-pinned: filtradas por score de keyword matching, limitadas por `limit` e `minScore`.
 *  - Ordem final: pinned primeiro (por peso), depois não-pinned por score decrescente.
 *
 * @param {string}  conversationId
 * @param {string}  contextText - texto de contexto para matching (mensagem atual + histórico recente)
 * @param {object}  [opts]
 * @param {number}  [opts.limit=5]      - max de memórias não-pinned retornadas
 * @param {number}  [opts.minScore=0]   - score mínimo para incluir memória não-pinned
 * @param {number}  [opts.maxPinned=10] - cap de memórias pinned injetadas no prompt
 */
export function getRelevantMemories(conversationId, contextText, { limit = 5, minScore = 0, maxPinned = 10 } = {}) {
    const allPinned = getPinnedMemories(conversationId)
        .sort((a, b) => (b.relevance_weight ?? 1) - (a.relevance_weight ?? 1))
        .slice(0, maxPinned);

    const pinnedIds = new Set(allPinned.map(m => m.id));

    const all       = getMemories(conversationId);
    const nonPinned = all.filter(m => !pinnedIds.has(m.id));

    const scored = nonPinned
        .map(m => ({ ...m, _score: scoreMemory(m, contextText) }))
        .filter(m => m._score > minScore)
        .sort((a, b) => b._score - a._score)
        .slice(0, limit);

    return [...allPinned, ...scored];
}

/**
 * Entry point principal para montar as memórias que serão injetadas no prompt.
 * Combina a mensagem atual com as últimas mensagens do histórico para formar
 * o contexto de busca.
 *
 * @param {string}   conversationId
 * @param {object}   [opts]
 * @param {string}   [opts.userMessage='']      - mensagem atual do usuário
 * @param {object[]} [opts.recentMessages=[]]   - últimas N mensagens do histórico
 * @param {number}   [opts.contextWindow=5]     - quantas mensagens do histórico usar na busca
 * @param {number}   [opts.limit=5]             - max de memórias não-pinned retornadas
 */
export function getMemoriesForPrompt(conversationId, {
    userMessage    = '',
    recentMessages = [],
    contextWindow  = 5,
    limit          = 5,
} = {}) {
    const contextText = [
        userMessage,
        ...recentMessages.slice(-contextWindow).map(m => m.content),
    ].join(' ');

    return getRelevantMemories(conversationId, contextText, { limit });
}
