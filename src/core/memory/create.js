import { createMemory } from "../../services/database/queries.js";

/**
 * Memória gerada automaticamente pelo summaryService quando o contexto ultrapassa o limite.
 * Captura fatos importantes que aconteceram em sessões anteriores para não serem perdidos.
 * Ex: "Na sessão anterior, o usuário revelou que trabalha à noite."
 */
export function createAutoMemory(conversationId, content, { keywords = null, summary = null } = {}) {
    if (!content?.trim()) throw new Error("Memória auto requer conteúdo.");
    return createMemory(conversationId, 'auto', content.trim(), keywords, 1.0, false, summary);
}

/**
 * Memória criada manualmente pelo usuário.
 * Para fatos relevantes mas situacionais — aparecem só quando keywords batem com o contexto.
 * Ex: "Ele adora café e odeia segunda-feira." / "Ficou com raiva quando mencionaram cavalos."
 */
export function createManualMemory(conversationId, content, { keywords = null, summary = null } = {}) {
    if (!content?.trim()) throw new Error("Memória manual requer conteúdo.");
    return createMemory(conversationId, 'manual', content.trim(), keywords, 1.0, false, summary);
}

/**
 * Memória permanente — sempre injetada no prompt, sem depender de keywords ou relevância contextual.
 *
 * Use SOMENTE para fatos que mudam QUEM o personagem é, não apenas o que ele sabe ou sentiu:
 *   ✓ Estado físico permanente: "Perdeu a visão do olho esquerdo na batalha de Ardenmoor."
 *   ✓ Mudança de relação estrutural: "Passou a considerar o usuário um aliado de confiança."
 *   ✓ Segredo revelado sem volta: "Sabe que o usuário é o herdeiro legítimo do trono."
 *   ✓ Regra narrativa fixa: "Nunca pronuncia o nome do irmão morto — chama-o apenas de 'ele'."
 *   ✗ Eventos situacionais: "Ficou com raiva quando mencionaram cavalos." → use createManualMemory
 *   ✗ Preferências: "Gosta de chá." → faz parte da descrição/personality do personagem
 *   ✗ Detalhes de uma cena: "Estavam no café quando o usuário contou seu segredo." → use auto/manual
 *
 * Requisitos obrigatórios:
 *  - content: mínimo 20 caracteres (fatos muito curtos costumam ser vagos demais)
 *  - keywords: obrigatório — serve de referência semântica e permite futuras buscas/auditorias
 *  - relevanceWeight: pode ser elevado (padrão 1.5) para priorizar sobre outras pinned
 *
 * Limite recomendado por conversa: máximo 10 memórias pinned ativas.
 * Se ultrapassar, as de menor relevanceWeight são descartadas do prompt automaticamente.
 */
export function createPinnedMemory(conversationId, content, {
    keywords = null,
    summary  = null,
    relevanceWeight = 1.5,
} = {}) {
    if (!content?.trim()) throw new Error("Memória pinned requer conteúdo.");
    if (content.trim().length < 20) throw new Error("Memória pinned requer ao menos 20 caracteres — descreva o fato com clareza.");
    if (!keywords?.trim()) throw new Error("Memória pinned requer keywords. Elas identificam o tema e permitem auditoria futura.");

    return createMemory(conversationId, 'pinned', content.trim(), keywords.trim(), relevanceWeight, true, summary);
}
