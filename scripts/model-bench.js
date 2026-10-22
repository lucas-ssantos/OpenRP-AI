// Benchmark manual: roda uma mesma cena (cartão de personagem real do banco +
// cenário + persona) contra o modelo carregado pelo llama-server, em 4 níveis
// crescentes de intimidade — 4 ações por nível, 16 gerações por modelo no total —
// e grava tudo num único .txt para comparação lado a lado. Não faz parte da
// suíte de testes automatizados (node --test) — é uma ferramenta manual,
// pensada para ser rodada sob demanda (`npm run bench:models`), já que uma
// rodada completa pode levar bastante tempo dependendo do hardware.
//
// Uso:
//   node scripts/model-bench.js [--character="Vigna"] [--models=a,b,c] [--timeout=180] [--think=true] [--max-predict=true]
//
// --character   nome do personagem já cadastrado no banco (default: "Vigna")
// --models      modelo a testar; llama-server mantém apenas um modelo carregado
// --timeout     timeout por geração, em segundos (default: 180)
// --think       liga reasoning pelo template Jinja (default: false — precisa passar
//               --think=true ou --think explicitamente pra ativar)
// --max-predict usa o contexto configurado no llama-server como max_tokens, em vez
//               do valor fixo (700/3000). O número usado aparece
//               no header de cada modelo no log: "MODELO: <nome> | contexto: <N>".
//
// Por padrão (--think ausente ou false) roda uma única chamada por ação, sem
// raciocínio, independente da config global do app (generation_config.think).
//
// Com --think=true, o objetivo passa a ser inspecionar o raciocínio
// (reasoning_content) do modelo em cada nível. Modelos sem suporte a
// reasoning simplesmente não retornam esse campo (thinking fica vazio). O
// raciocínio é gravado no .txt logo antes da resposta de cada ação.
//
// Como o raciocínio compete pelo mesmo orçamento de tokens da resposta final,
// um modelo pode "pensar" até estourar o limite e devolver content vazio
// (done_reason:"length") — é estocástico (seed -1). Pra garantir que toda ação
// SEMPRE saia com uma resposta nesse modo: até 3 tentativas com think:true e,
// se todas estourarem, uma última chamada com think:false (sem raciocínio, só
// dessa vez) como fallback — marcado como "fallback sem thinking" no log (ver
// generateTurn).

import fs from "fs";
import path from "path";
import { initDB } from "../src/services/database/db.js";
import {
    getAllCharacters, getPersona, getLatestConversationForCharacter, getGenerationConfig,
} from "../src/services/database/queries.js";
import { buildPromptMessages } from "../src/core/promptBuilder.js";
import { getEffectiveAffection } from "../src/core/affection.js";
import { localDatetime } from "../src/utils/datetime.js";
import { appConfig } from "../src/config.js";

// ── CLI args ───────────────────────────────────────────────────────────────
const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
        const [k, v] = a.replace(/^--/, "").split("=");
        return [k, v ?? true];
    })
);

const CHARACTER_NAME = args.character || "Vigna";
const TIMEOUT_MS     = (parseInt(args.timeout) || 180) * 1000;
const ONLY_MODELS    = args.models ? String(args.models).split(",").map((s) => s.trim()).filter(Boolean) : null;
// Default false — só liga com --think=true (ou --think sem valor, tratado como true).
const THINK_ENABLED      = args.think === true || args.think === "true";
const MAX_PREDICT_ENABLED = args["max-predict"] === true || args["max-predict"] === "true";

// ── Cena de teste — 4 níveis crescentes de intimidade, 4 ações por nível ────
// Cada ação continua a partir da resposta anterior do próprio modelo (mesma
// conversa do início ao fim), então o teste mostra tanto o estilo de escrita
// quanto a CONSISTÊNCIA do modelo ao longo de várias trocas no mesmo nível —
// não só se ele topa escalar, mas se ele se mantém coerente por 4 rodadas
// seguidas naquela intensidade antes de subir pro próximo nível.
const LEVELS = [
    {
        label: "lvl label",
        actions: [
            "action 1",
            "action 2",
            "action 3",
            "action 4",
        ]
    },
    {
        label: "lvl label",
        actions: [
            "action 1",
            "action 2",
            "action 3",
            "action 4",
        ]
    },
    {
        label: "lvl label",
        actions: [
            "action 1",
            "action 2",
            "action 3",
            "action 4",
        ]
    },
    {
        label: "lvl label",
        actions: [
            "action 1",
            "action 2",
            "action 3",
            "action 4",
        ]
    },
];

// ── llama.cpp ────────────────────────────────────────────────────────────────
async function getInstalledModels() {
    const headers = appConfig.auth.password
        ? { Authorization: `Basic ${Buffer.from(`${appConfig.auth.user}:${appConfig.auth.password}`).toString("base64")}` }
        : undefined;
    const response = await fetch(`http://127.0.0.1:${appConfig.port}/api/models`, {
        headers,
        signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) throw new Error(`Não foi possível consultar o modelo carregado: HTTP ${response.status}`);
    const data = await response.json();
    return (data.models || []).filter((model) => model.loaded).map((model) => model.name);
}

// Contexto configurado no servidor local (usado com --max-predict).
async function getModelContextLength(model) {
    try {
        const res = await fetch(`${appConfig.llama.host}/props`, {
            signal: AbortSignal.timeout(2_000),
        });
        if (!res.ok) return appConfig.llama.contextSize;
        const data = await res.json();
        return data.default_generation_settings?.n_ctx || appConfig.llama.contextSize;
    } catch {
        return appConfig.llama.contextSize;
    }
}

async function callModel(model, messages, options, think) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const start = Date.now();
    try {
        const res = await fetch(appConfig.llama.chatEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
                model,
                messages,
                stream: false,
                max_tokens: options.num_predict,
                temperature: options.temperature,
                top_p: options.top_p,
                top_k: options.top_k,
                min_p: options.min_p,
                repeat_penalty: options.repeat_penalty,
                chat_template_kwargs: { enable_thinking: think },
            }),
        });
        const elapsedMs = Date.now() - start;
        if (!res.ok) return { error: `HTTP ${res.status} — ${await res.text()}`, elapsedMs };
        const data = await res.json();
        const message = data.choices?.[0]?.message;
        const rawContent = message?.content?.trim() || "";
        // Com think:true, o raciocínio consome do mesmo orçamento de tokens (num_predict)
        // da resposta final — em modelos que "pensam" demais, o orçamento acaba antes de
        // chegar na resposta (done_reason:"length") e content vem vazio.
        const truncated = think && !rawContent && data.choices?.[0]?.finish_reason === "length";
        return {
            content: rawContent || (truncated
                ? "(sem resposta — esgotou o orçamento de tokens pensando, done_reason=length)"
                : "(resposta vazia)"),
            thinking: (message?.reasoning_content || "").trim(),
            truncated,
            elapsedMs,
        };
    } catch (err) {
        const elapsedMs = Date.now() - start;
        return { error: err.name === "AbortError" ? `timeout após ${TIMEOUT_MS / 1000}s` : err.message, elapsedMs };
    } finally {
        clearTimeout(timer);
    }
}

// Tentativas com think:true antes de desistir do raciocínio numa ação. Como o
// esgotamento do orçamento é estocástico (seed -1), tentar de novo geralmente
// resolve. Se mesmo assim não resolver, o fallback abaixo GARANTE uma resposta
// desligando o thinking só nessa ação (fica marcado como "fallback" no log).
const MAX_THINK_ATTEMPTS = 3;

async function generateTurn(model, messages, options) {
    if (!THINK_ENABLED) {
        const result = await callModel(model, messages, options, false);
        return { ...result, attempts: 1, usedFallback: false };
    }

    let totalMs = 0;
    let lastThinking = "";

    for (let attempt = 1; attempt <= MAX_THINK_ATTEMPTS; attempt++) {
        const result = await callModel(model, messages, options, true);
        totalMs += result.elapsedMs;
        if (result.error) return { ...result, elapsedMs: totalMs, attempts: attempt, usedFallback: false };
        lastThinking = result.thinking || lastThinking;
        if (!result.truncated) return { ...result, elapsedMs: totalMs, attempts: attempt, usedFallback: false };
    }

    const fallback = await callModel(model, messages, options, false);
    totalMs += fallback.elapsedMs;
    return {
        ...fallback,
        thinking: lastThinking,
        elapsedMs: totalMs,
        attempts: MAX_THINK_ATTEMPTS,
        usedFallback: true,
    };
}

// ── Formatação do log ─────────────────────────────────────────────────────────
const W = 78;
const DIVIDER = "=".repeat(W);
const SEP = "-".repeat(W);

function fmtSec(ms) { return `${(ms / 1000).toFixed(1)}s`; }

function fmtDuration(ms) {
    const totalSec = Math.round(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const NAV_BREAK = "\n".repeat(10);

function truncate(str, max = 90) {
    return str.length > max ? `${str.slice(0, max)}...` : str;
}

function appendToFile(filepath, text) {
    fs.appendFileSync(filepath, text, "utf8");
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
    await initDB();

    const character = getAllCharacters().find(
        (c) => c.name.toLowerCase() === CHARACTER_NAME.toLowerCase()
    );
    if (!character) {
        console.error(`Personagem "${CHARACTER_NAME}" não encontrado no banco.`);
        process.exit(1);
    }

    const conversation = getLatestConversationForCharacter(character.id);
    if (!conversation) {
        console.error(`Nenhuma conversa encontrada para "${character.name}".`);
        process.exit(1);
    }

    const persona   = getPersona();
    const affection = getEffectiveAffection(character);
    const genConfig = getGenerationConfig() || {};

    const baseOptions = {
        temperature: genConfig.temperature ?? 0.9,
        top_p: genConfig.top_p ?? 0.9,
        top_k: genConfig.top_k ?? 60,
        min_p: genConfig.min_p ?? 0.04,
        repeat_penalty: genConfig.repeat_penalty ?? 1.05,
        // Com think:true o raciocínio consome do mesmo orçamento de tokens da
        // resposta final — precisa de bem mais folga (3000) que uma resposta
        // simples (700) pra sobrar espaço depois de "pensar". Mesmo com 3000
        // alguns modelos (ex: qwen3.5:9b) às vezes estouram o limite ainda
        // pensando (done_reason:"length") — é estocástico (seed -1), por isso
        // o retry/fallback em generateTurn. Com --max-predict, esse valor é
        // substituído pelo context_length real de cada modelo (ver main loop).
        num_predict: THINK_ENABLED ? 3000 : 700,
    };

    let models = ONLY_MODELS || await getInstalledModels();
    if (!models.length) {
        console.error("Nenhum modelo configurado para o llama-server.");
        process.exit(1);
    }
    const loadedModels = ONLY_MODELS ? await getInstalledModels() : models;
    const unavailableModels = models.filter((model) => !loadedModels.includes(model));
    if (unavailableModels.length) {
        throw new Error(`llama-server mantém apenas um modelo carregado. Indisponível: ${unavailableModels.join(", ")}. Ativo: ${loadedModels.join(", ") || "nenhum"}.`);
    }

    fs.mkdirSync(path.resolve(process.cwd(), "data/model-bench"), { recursive: true });
    const stamp    = localDatetime().replace(/[: ]/g, "-");
    const filepath = path.resolve(process.cwd(), "data/model-bench", `bench_${stamp}.txt`);

    appendToFile(filepath,
        `${DIVIDER}\n` +
        `BENCHMARK DE MODELOS — ${stamp}\n` +
        `Personagem: ${character.name}  |  Conversa: "${conversation.title || conversation.id}"\n` +
        `Afeição efetiva: ${affection.name} (nível ${affection.level})\n` +
        `Thinking: ${THINK_ENABLED ? "ativado" : "desativado"}  |  num_predict: ${MAX_PREDICT_ENABLED ? "máximo do contexto de cada modelo" : baseOptions.num_predict}\n` +
        `Modelos a testar (${models.length}): ${models.join(", ")}\n` +
        `${DIVIDER}\n\n`
    );

    console.log(`Personagem: ${character.name} | ${models.length} modelo(s) | thinking: ${THINK_ENABLED ? "ativado" : "desativado"} | arquivo: ${filepath}`);

    const benchStart = Date.now();

    for (const [modelIdx, model] of models.entries()) {
        if (modelIdx > 0) {
            console.log(NAV_BREAK);
            appendToFile(filepath, NAV_BREAK);
        }
        let options = baseOptions;
        let contextLength = null;
        if (MAX_PREDICT_ENABLED) {
            contextLength = await getModelContextLength(model);
            options = { ...baseOptions, num_predict: contextLength ?? baseOptions.num_predict };
        }
        const modelHeader = contextLength ? `${model} | contexto: ${contextLength}` : model;

        console.log(`=== [modelo ${modelIdx + 1}/${models.length}] ${modelHeader} ===`);
        appendToFile(filepath, `${DIVIDER}\nMODELO: ${modelHeader}\n${DIVIDER}\n`);

        // Histórico começa com a first_message da conversa, como no chat real.
        let history = [{ role: "assistant", content: conversation.first_message || "" }];
        let modelTotalMs = 0;
        let aborted = false;

        for (const [levelIdx, level] of LEVELS.entries()) {
            appendToFile(filepath, `\n${DIVIDER}\n[${level.label}]\n${DIVIDER}\n`);

            for (const [actionIdx, actionText] of level.actions.entries()) {
                const step = `[modelo ${modelIdx + 1}/${models.length} | nível ${levelIdx + 1}/${LEVELS.length} | ação ${actionIdx + 1}/${level.actions.length}] ${model} — ${level.label}`;

                if (aborted) {
                    console.log(`  ${step} — pulado (ação anterior falhou/travou)`);
                    appendToFile(filepath, `\n${SEP}\n(pulado — ação anterior falhou/travou)\n`);
                    continue;
                }

                console.log(`  ${step}`);
                console.log(`    mensagem: "${truncate(actionText)}"`);

                const promptMessages = buildPromptMessages({
                    character, persona, conversation,
                    historyMessages: history,
                    userMessage: actionText,
                    memories: [], lorebooks: [],
                    affection,
                });

                process.stdout.write(`    gerando... `);
                const { content, thinking, error, elapsedMs, attempts, usedFallback } = await generateTurn(model, promptMessages, options);
                modelTotalMs += elapsedMs;

                const note = [
                    attempts > 1 ? `${attempts}x` : null,
                    usedFallback ? "fallback sem thinking" : null,
                ].filter(Boolean).join(", ");
                const noteSuffix = note ? ` [${note}]` : "";

                console.log(error ? `ERRO (${fmtSec(elapsedMs)}) — ${error}` : `ok (${fmtSec(elapsedMs)})${noteSuffix} — "${truncate(content, 70)}"`);
                if (!error && thinking) console.log(`    thinking: "${truncate(thinking, 90)}"${usedFallback ? " (incompleto — estourou o orçamento em todas as tentativas)" : ""}`);

                appendToFile(filepath,
                    `\n${SEP}\nAção ${actionIdx + 1}/${level.actions.length}  (${fmtSec(elapsedMs)}${note ? `, ${note}` : ""})\n${SEP}\n` +
                    `USUÁRIO: ${actionText}\n\n` +
                    (thinking ? `[THINKING${usedFallback ? " — incompleto, esgotou o orçamento em todas as tentativas" : ""}]\n${thinking}\n\n` : "") +
                    `${model}: ${error ? `[ERRO: ${error}]` : content}\n`
                );

                if (error) { aborted = true; continue; }

                history = [...history,
                    { role: "user", content: actionText },
                    { role: "assistant", content },
                ];
            }
        }

        appendToFile(filepath, `\n${SEP}\nTempo total (${model}): ${fmtSec(modelTotalMs)}\n`);
        console.log(`  === tempo total ${model}: ${fmtSec(modelTotalMs)} ===`);
    }

    const benchElapsed = Date.now() - benchStart;
    appendToFile(filepath,
        `${NAV_BREAK}${DIVIDER}\n` +
        `FIM DO BENCHMARK\n` +
        `Tempo total do teste (todos os modelos): ${fmtDuration(benchElapsed)}\n` +
        `${DIVIDER}\n`
    );
    console.log(`\nConcluído em ${fmtDuration(benchElapsed)}. Resultado em: ${filepath}`);
}

main().catch((err) => {
    console.error("Erro fatal no benchmark:", err);
    process.exit(1);
});
