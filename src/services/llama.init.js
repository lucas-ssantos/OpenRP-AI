import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { appConfig } from "../config.js";
import { getGenerationConfig } from "./database/queries.js";
import { resolveModelFile } from "./llama.models.js";
import { registerLlamaServerStop } from "../core/shutdown.js";

const STARTUP_TIMEOUT_MS = 600_000;
const HEALTH_CHECK_INTERVAL_MS = 500;
const STOP_TIMEOUT_MS = 10_000;
let serverProcess = null;

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

async function stopLlamaServer() {
    const child = serverProcess;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

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

export async function initLlamaServer() {
    const config = getGenerationConfig();
    const model = config?.model || appConfig.defaults.model;
    const modelPath = resolveModelFile(model);
    const ctxSize = config?.context_size || appConfig.llama.contextSize;
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
    registerLlamaServerStop(stopLlamaServer);

    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (spawnError) throw new Error(`Não foi possível iniciar llama-server: ${spawnError.message}`);
        if (serverProcess.exitCode !== null || serverProcess.signalCode !== null) {
            throw new Error(`llama-server encerrou durante a inicialização. Consulte logs/llama-server.log.`);
        }
        if (await isHealthy()) {
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
