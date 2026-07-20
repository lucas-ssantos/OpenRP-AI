// Sobe/derruba `src/index.js` como processo filho. O próprio index.js já
// cuida de iniciar/parar o Ollama (services/ollama.init.js, core/shutdown.js),
// então controlar este processo é suficiente para controlar a stack inteira.
import { spawn, spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { appConfig } from "../src/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const entryPoint = path.join(projectRoot, "src", "index.js");

const SHUTDOWN_TIMEOUT_MS = 8000;
const KILL_POLL_INTERVAL_MS = 300;

let child = null;

export function isRunning()
{
    return child !== null && !child.killed;
}

// Descobre o PID que está ouvindo a porta configurada, mesmo que não tenha
// sido esta instância da bandeja que o iniciou (outra instância, `npm start`
// manual, etc.) — usa `ss` (iproute2), presente por padrão em qualquer Linux.
function findPidListeningOnPort(port)
{
    const result = spawnSync("ss", ["-H", "-ltnp", `sport = :${port}`], { encoding: "utf8" });
    if (result.status !== 0 || !result.stdout) return null;
    const match = result.stdout.match(/pid=(\d+)/);
    return match ? parseInt(match[1], 10) : null;
}

function isPidAlive(pid)
{
    try
    {
        process.kill(pid, 0);
        return true;
    }
    catch
    {
        return false;
    }
}

export function startServer({ onExit } = {})
{
    if (isRunning()) return child;

    child = spawn(process.execPath, [entryPoint], {
        cwd: projectRoot,
        stdio: "inherit",
    });

    child.on("exit", (code, signal) => {
        child = null;
        if (onExit) onExit(code, signal);
    });

    return child;
}

export function stopServer()
{
    return new Promise((resolve) => {
        if (isRunning())
        {
            const proc = child;
            proc.once("exit", () => resolve());

            // Aciona o graceful shutdown já implementado em src/index.js
            // (fecha o servidor web, salva o banco, para o Ollama).
            proc.kill("SIGTERM");

            setTimeout(() => {
                if (proc && !proc.killed) proc.kill("SIGKILL");
            }, SHUTDOWN_TIMEOUT_MS);
            return;
        }

        // Não é um processo filho desta instância — localiza pelo que está
        // ouvindo a porta configurada e mata diretamente.
        const pid = findPidListeningOnPort(appConfig.port);
        if (!pid)
        {
            resolve();
            return;
        }

        try { process.kill(pid, "SIGTERM"); } catch { /* já não existe */ }

        const start = Date.now();
        const poll = setInterval(() => {
            if (!isPidAlive(pid))
            {
                clearInterval(poll);
                resolve();
                return;
            }
            if (Date.now() - start > SHUTDOWN_TIMEOUT_MS)
            {
                clearInterval(poll);
                try { process.kill(pid, "SIGKILL"); } catch { /* já não existe */ }
                resolve();
            }
        }, KILL_POLL_INTERVAL_MS);
    });
}
