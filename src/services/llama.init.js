import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { appConfig } from "../config.js";
import { getGenerationConfig } from "./database/queries.js";
import { listLocalModels, resolveModelFile, writeRouterPreset } from "./llama.models.js";
import { registerLlamaServerStop } from "../core/shutdown.js";

const STARTUP_TIMEOUT_MS = 600_000;
const HEALTH_CHECK_INTERVAL_MS = 500;
const STOP_TIMEOUT_MS = 10_000;
let serverProcess = null;
let serverWasHealthy = false;

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child, timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
        const onExit = () => {
            clearTimeout(timer);
            resolve(true);
        };
        const timer = setTimeout(() => {
            child.removeListener("exit", onExit);
            resolve(false);
        }, timeoutMs);
        child.once("exit", onExit);
    });
}

function getServerEnvironment(binary) {
    const executable = binary.includes(path.sep)
        ? path.resolve(binary)
        : (process.env.PATH || "")
            .split(path.delimiter)
            .map((directory) => path.join(directory, binary))
            .find((candidate) => {
                try {
                    fs.accessSync(candidate, fs.constants.X_OK);
                    return true;
                } catch {
                    return false;
                }
            });
    const env = { ...process.env };
    delete env.MANGOHUD;
    if (!executable) return env;

    const executableDir = path.dirname(executable);
    const libraryDir = [
        path.resolve(executableDir, "../lib"),
        path.resolve(executableDir, "../lib64"),
        executableDir,
    ].find((directory) => fs.existsSync(path.join(directory, "libllama-server-impl.so")));

    if (libraryDir) {
        env.LD_LIBRARY_PATH = [libraryDir, env.LD_LIBRARY_PATH]
            .filter(Boolean)
            .join(path.delimiter);
    }
    return env;
}

async function isHealthy() {
    try {
        const response = await fetch(appConfig.llama.healthEndpoint, {
            signal: AbortSignal.timeout(1_000),
        });
        return response.ok;
    } catch {
        return false;
    }
}

async function stopLlamaServer({ includeExternal = false } = {}) {
    const child = serverProcess;
    if (child && child.exitCode === null && child.signalCode === null) {
        console.log("[llama] Encerrando llama-server...");
        child.kill("SIGTERM");
        const stopped = await waitForExit(child, STOP_TIMEOUT_MS);
        if (!stopped) {
            console.warn("[llama] llama-server não encerrou no prazo; enviando SIGKILL.");
            child.kill("SIGKILL");
            if (!await waitForExit(child, 2_000)) {
                console.error("[llama] llama-server ainda não encerrou após SIGKILL.");
            }
        }
    }

    // O app pode ter iniciado o llama-server, perdido o processo filho (por
    // exemplo, quando o benchmark reiniciou o servidor) e ainda assim precisar
    // encerrar quem estiver ocupando a porta no shutdown.
    if (includeExternal && serverWasHealthy) {
        await stopExternalLlamaServer();
    }
}

// Descobre o PID que está ouvindo a porta do llama-server, mesmo que ele não
// tenha sido iniciado por este processo (ex.: app já em execução).
function findPidListeningOnPort(port) {
    const result = spawnSync("ss", ["-H", "-ltnp", `sport = :${port}`], { encoding: "utf8" });
    if (result.status !== 0 || !result.stdout) return null;
    const match = result.stdout.match(/pid=(\d+)/);
    return match ? parseInt(match[1], 10) : null;
}

function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

// Encerra um llama-server externo (não gerenciado por este processo). Usado
// pelo benchmark para trocar de modelo quando o servidor já estava ativo.
async function stopExternalLlamaServer() {
    const pid = findPidListeningOnPort(appConfig.llama.port);
    if (!pid) return;

    console.log(`[llama] Encerrando llama-server externo (pid ${pid})...`);
    try {
        process.kill(pid, "SIGTERM");
    } catch {
        return;
    }

    const deadline = Date.now() + STOP_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (!isPidAlive(pid)) return;
        await wait(200);
    }

    console.warn("[llama] llama-server externo não encerrou no prazo; enviando SIGKILL.");
    try {
        process.kill(pid, "SIGKILL");
    } catch {
        // já não existe
    }

    const killDeadline = Date.now() + 2_000;
    while (Date.now() < killDeadline && isPidAlive(pid)) await wait(100);
}

// Encerra tanto o servidor iniciado por este processo quanto um servidor
// externo que esteja ocupando a mesma porta.
export async function stopAnyLlamaServer() {
    await stopLlamaServer();
    await stopExternalLlamaServer();
}

// Deixa o llama-server em execução, mas remove o vínculo com o shutdown deste
// processo. Usado quando o benchmark assume um servidor externo, restaura o
// modelo original e precisa deixá-lo rodando para o app que já estava ativo.
export function detachLlamaServer() {
    if (serverProcess) serverProcess.unref();
    serverProcess = null;
    serverWasHealthy = false;
    registerLlamaServerStop(null);
}

/*
export async function initLlamaServer({ model: modelOverride = null, contextSize: contextOverride = null } = {}) {
    serverWasHealthy = false;
    const config = getGenerationConfig();
    const model = modelOverride || config?.model || appConfig.defaults.model;
    const modelPath = resolveModelFile(model);
    const ctxSize = contextOverride || config?.context_size || appConfig.llama.contextSize;
    const logsDir = path.resolve(process.cwd(), "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    const logFd = fs.openSync(path.join(logsDir, "llama-server.log"), "a");
    const args = [
        "-m", modelPath,
        "--host", appConfig.llama.bindHost,
        "--ctx-size", String(ctxSize),
        "-ngl", String(appConfig.llama.gpuLayers),
        "--port", String(appConfig.llama.port),
        "--jinja",
    ];

    console.log(`[llama] Iniciando llama-server para "${model}" (${modelPath})...`);
    serverProcess = spawn(appConfig.llama.binary, args, {
        cwd: process.cwd(),
        env: getServerEnvironment(appConfig.llama.binary),
        stdio: ["ignore", logFd, logFd],
    });
    fs.closeSync(logFd);
    let spawnError = null;
    serverProcess.once("error", (error) => {
        spawnError = error;
        console.error(`[llama] Falha ao iniciar "${appConfig.llama.binary}": ${error.message}`);
    });
    serverProcess.once("exit", (code, signal) => {
        if (code !== 0 && signal !== "SIGTERM") {
            console.error(`[llama] llama-server encerrou inesperadamente (code=${code}, signal=${signal}).`);
        }
    });
    registerLlamaServerStop(() => stopLlamaServer({ includeExternal: true }));

    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (spawnError) throw new Error(`Não foi possível iniciar llama-server: ${spawnError.message}`);
        if (serverProcess.exitCode !== null || serverProcess.signalCode !== null) {
            throw new Error(`llama-server encerrou durante a inicialização. Consulte logs/llama-server.log.`);
        }
        if (await isHealthy()) {
            serverWasHealthy = true;
            appConfig.llama.model = model;
            appConfig.llama.contextSize = ctxSize;
            console.log(`[llama] llama-server pronto em ${appConfig.llama.host} (contexto ${ctxSize}).`);
            return;
        }
        await wait(HEALTH_CHECK_INTERVAL_MS);
    }

    await stopLlamaServer();
    throw new Error(`llama-server não respondeu em ${STARTUP_TIMEOUT_MS / 1000}s. Consulte logs/llama-server.log.`);
}
*/


export async function initLlamaServer({
    model: modelOverride = null,
    contextSize: contextOverride = null
} = {}) {
    serverWasHealthy = false;

    const config = getGenerationConfig();
    const routerMode = !modelOverride;

    // O modo normal usa o modelo principal escolhido em /settings. Todos os
    // GGUFs de ~/.ai-models entram no preset do router; um modelOverride
    // explícito mantém o modo de modelo único, usado por benchmarks.
    let model;
    let presetPath = null;
    if (routerMode) {
        const models = listLocalModels();
        if (!models.length) {
            throw new Error(
                `Nenhum modelo .gguf encontrado em ${process.env.AI_MODELS_DIR || "~/.ai-models"}.`
            );
        }

        const candidates = [config?.model, appConfig.llama.model, appConfig.defaults.model]
            .filter(Boolean);
        model = candidates.find((name) => models.some((item) => item.name === name))
            || models[0].name;

        presetPath = writeRouterPreset(models, { defaultModel: model });
    } else {
        model = modelOverride || config?.model || appConfig.defaults.model;
    }

    const modelPath = routerMode ? null : resolveModelFile(model);
    const ctxSize = contextOverride || config?.context_size || appConfig.llama.contextSize;

    const logsDir = path.resolve(process.cwd(), "logs");
    fs.mkdirSync(logsDir, { recursive: true });

    const logFd = fs.openSync(
        path.join(logsDir, "llama-server.log"),
        "a"
    );

    const args = [
        ...(routerMode
            ? [
                "--models-preset", presetPath,
                "--models-max", "1",
            ]
            : ["-m", modelPath]),

        "--host", appConfig.llama.bindHost,
        "--ctx-size", String(ctxSize),
        "-ngl", String(appConfig.llama.gpuLayers),
        "--port", String(appConfig.llama.port),
        "--jinja",
    ];

    console.log(
        routerMode
            ? `[llama] Iniciando llama-server em modo router (padrão: ${model}; preset: ${presetPath})...`
            : `[llama] Iniciando llama-server para "${model}" (${modelPath})...`
    );

    serverProcess = spawn(appConfig.llama.binary, args, {
        cwd: process.cwd(),
        env: getServerEnvironment(appConfig.llama.binary),
        stdio: ["ignore", logFd, logFd],
    });

    fs.closeSync(logFd);

    let spawnError = null;

    serverProcess.once("error", (error) => {
        spawnError = error;
        console.error(
            `[llama] Falha ao iniciar "${appConfig.llama.binary}": ${error.message}`
        );
    });

    serverProcess.once("exit", (code, signal) => {
        if (code !== 0 && signal !== "SIGTERM") {
            console.error(
                `[llama] llama-server encerrou inesperadamente (code=${code}, signal=${signal}).`
            );
        }
    });

    registerLlamaServerStop(() =>
        stopLlamaServer({ includeExternal: true })
    );

    const deadline = Date.now() + STARTUP_TIMEOUT_MS;

    while (Date.now() < deadline) {
        if (spawnError) {
            throw new Error(
                `Não foi possível iniciar llama-server: ${spawnError.message}`
            );
        }

        if (
            serverProcess.exitCode !== null ||
            serverProcess.signalCode !== null
        ) {
            throw new Error(
                "llama-server encerrou durante a inicialização. Consulte logs/llama-server.log."
            );
        }

        if (await isHealthy()) {
            serverWasHealthy = true;

            appConfig.llama.model = model;
            appConfig.llama.routerMode = routerMode;
            appConfig.llama.contextSize = ctxSize;

            console.log(
                `[llama] llama-server pronto em ${appConfig.llama.host} (contexto ${ctxSize}).`
            );

            return;
        }

        await wait(HEALTH_CHECK_INTERVAL_MS);
        appConfig.llama.routerMode = routerMode;
    }

    await stopLlamaServer();

    throw new Error(
        `llama-server não respondeu em ${STARTUP_TIMEOUT_MS / 1000}s. Consulte logs/llama-server.log.`
    );
}
