import { Router } from "express";
import {
    getCharacter, getPersona, getConversation, getLastNMessages,
} from "../../services/database/queries.js";
import { resolveConfig } from "./helpers.js";
import { appConfig } from "../../config.js";

const router = Router();

const OLLAMA_URL      = appConfig.ollama.chatEndpoint;
const IDEAS_PER_PAGE  = 4;
const MAX_EXCLUDE     = IDEAS_PER_PAGE * 4; // até 4 páginas anteriores no bloco de exclusão
const IDEAS_TIMEOUT_MS = 60_000;

// JSON Schema para structured outputs do Ollama — garante JSON válido na resposta.
const RESPONSE_FORMAT = {
    type: "object",
    properties: {
        ideas: { type: "array", items: { type: "string" } },
    },
    required: ["ideas"],
};

function buildIdeasPrompt(character, persona, conversation, exclude) {
    const characterName = character?.name || "Character";
    const personaName   = persona?.name   || "User";

    const card = [
        character?.description  && `Description: ${character.description}`,
        character?.personality  && `Personality: ${character.personality}`,
        conversation?.scenario  && `Current scenario: ${conversation.scenario}`,
    ].filter(Boolean).join("\n");

    const excludeBlock = exclude.length
        ? `\nAlready suggested — do NOT repeat or closely paraphrase any of these:\n${exclude.map(s => `- ${s}`).join("\n")}\n`
        : "";

    return `You are the suggestion engine of a roleplay chat between ${personaName} (the user) and ${characterName} (the character).
Read the conversation excerpt and generate exactly ${IDEAS_PER_PAGE} suggestions for ${personaName}'s NEXT message — possible actions that continue the scene naturally.

---
CHARACTER — ${characterName}:
${card || "(no card provided)"}
---
${excludeBlock}
Rules for each suggestion:
- Written in FIRST PERSON as ${personaName}, ready to be sent as-is
- A short chat message: 1 to 2 sentences, mixing dialogue with *actions between asterisks* in the same style as the conversation
- Must react to the LAST message of the excerpt and move the scene forward
- Each of the ${IDEAS_PER_PAGE} suggestions must take the scene in a clearly DIFFERENT direction (e.g. affectionate, playful, bold, curious, cautious, provocative)
- Never speak, act or decide for ${characterName}
- Same language as the conversation
- Respond ONLY with valid JSON, no markdown, no explanation:
{"ideas": ["...", "...", "...", "..."]}`;
}

async function callOllama(model, systemPrompt, excerpt, withFormat) {
    return fetch(OLLAMA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(IDEAS_TIMEOUT_MS),
        body: JSON.stringify({
            model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user",   content: `Conversation excerpt:\n\n${excerpt}` },
            ],
            stream: false,
            think:  false,
            ...(withFormat ? { format: RESPONSE_FORMAT } : {}),
            options: { temperature: 0.9, top_p: 0.95, num_predict: 600 },
        }),
    });
}

// ── POST /api/conversations/:id/ideas ────────────────────────────────────────
// Gera IDEAS_PER_PAGE sugestões de próxima ação do usuário (uma "página").
// body: { exclude: string[] } — ideias das páginas anteriores, para não repetir.
router.post("/conversations/:id/ideas", async (req, res) => {
    try {
        const conv = getConversation(req.params.id);
        if (!conv) return res.status(404).json({ ok: false, message: "Conversa não encontrada." });

        const character = getCharacter(conv.character_id);
        if (!character) return res.status(404).json({ ok: false, message: "Personagem não encontrado." });

        const persona = getPersona();
        const config  = resolveConfig(conv.character_id, req.params.id);

        const exclude = (Array.isArray(req.body?.exclude) ? req.body.exclude : [])
            .filter(s => typeof s === "string" && s.trim())
            .slice(-MAX_EXCLUDE);

        const personaName   = persona?.name || "User";
        const characterName = character.name;
        const recent  = getLastNMessages(req.params.id, Math.min(config.num_ctx_messages || 20, 12));
        const excerpt = recent
            .filter(m => m.role !== "system")
            .map(m => `${m.role === "user" ? personaName : characterName}: ${m.content}`)
            .join("\n") || "(the conversation has not started yet)";

        const systemPrompt = buildIdeasPrompt(character, persona, conv, exclude);

        // Versões antigas do Ollama podem rejeitar o campo `format` — tenta uma vez sem ele.
        let r = await callOllama(config.model, systemPrompt, excerpt, true);
        if (!r.ok) r = await callOllama(config.model, systemPrompt, excerpt, false);
        if (!r.ok) return res.status(502).json({ ok: false, message: "Falha ao gerar ideias — verifique o Ollama." });

        const data = await r.json();
        const text = (data.message?.content || "")
            .replace(/<think>[\s\S]*?<\/think>/g, "")
            .trim()
            .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

        const jsonStart = text.indexOf("{");
        const jsonEnd   = text.lastIndexOf("}");
        if (jsonStart === -1 || jsonEnd === -1)
            return res.status(502).json({ ok: false, message: "O modelo não retornou ideias válidas." });

        let parsed;
        try { parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)); }
        catch { return res.status(502).json({ ok: false, message: "O modelo não retornou ideias válidas." }); }

        const ideas = (Array.isArray(parsed?.ideas) ? parsed.ideas : [])
            .filter(s => typeof s === "string" && s.trim())
            .map(s => s.trim())
            .slice(0, IDEAS_PER_PAGE);

        if (!ideas.length)
            return res.status(502).json({ ok: false, message: "O modelo não retornou ideias válidas." });

        res.json({ ok: true, ideas });
    } catch (err) {
        if (err?.name === "TimeoutError" || err?.name === "AbortError")
            return res.status(504).json({ ok: false, message: "Tempo esgotado ao gerar ideias." });
        res.status(500).json({ ok: false, message: err.message });
    }
});

export default router;
