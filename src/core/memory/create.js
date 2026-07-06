import { createMemory } from "../../services/database/queries.js";

/**
 * Memória gerada automaticamente pelo extrator unificado (extraction.js) quando
 * mensagens saem da janela de contexto — o registro episódico da conversa.
 * Recuperada por keyword matching quando o assunto volta à tona.
 * Ex: "Na sessão anterior, o usuário revelou que trabalha à noite."
 *
 * relevanceWeight (0.8–1.2 quando vindo do extrator) modula o score do retrieval.
 */
export function createAutoMemory(conversationId, content, { keywords = null, summary = null, relevanceWeight = 1.0 } = {}) {
    if (!content?.trim()) throw new Error("Memória auto requer conteúdo.");
    return createMemory(conversationId, 'auto', content.trim(), keywords, relevanceWeight, false, summary);
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
 * Use para momentos que definem o personagem ou a relação daqui em diante —
 * o que uma pessoa ainda lembraria anos depois:
 *   ✓ Evento muito forte: "Quase morreu no incêndio do teatro; foi salva pelo usuário."
 *   ✓ Sentimento intenso declarado: "Confessou estar apaixonada pelo usuário."
 *   ✓ Grande virada emocional: "Deixou de confiar no usuário após descobrir a mentira sobre a carta."
 *   ✓ Mudança física: "Perdeu a visão do olho esquerdo na batalha de Ardenmoor."
 *   ✗ Variação de humor passageira: "Ficou irritada durante o jantar." → use auto/manual
 *   ✗ Preferências: "Gosta de chá." → faz parte da descrição/personality do personagem
 *   ✗ Detalhes de uma cena: "Estavam no café quando o usuário contou seu segredo." → use auto/manual
 *
 * Requisitos obrigatórios:
 *  - content: mínimo 20 caracteres (fatos muito curtos costumam ser vagos demais)
 *  - keywords: obrigatório — serve de referência semântica e permite futuras buscas/auditorias
 *  - relevanceWeight: gradua a prioridade entre pinned (extrator usa 1.2–2.0 conforme a importância)
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
