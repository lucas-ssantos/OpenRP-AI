import { spawnSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { registerOllamaProcess } from "../core/shutdown.js";

export async function initOllama()
{
    console.log("Checking Ollama installation and service...");

    // Check if `ollama` binary is available
    const which = spawnSync("which", ["ollama"]);

    if (which.status !== 0) 
        {
        console.error("Ollama não encontrado. Por favor instale o Ollama: https://ollama.com");
        process.exit(1);
    }

    const binPath = which.stdout.toString().trim();
    console.log("Found ollama at", binPath);

    // Prefer systemd when available
    const hasSystemctl = spawnSync("which", ["systemctl"]).status === 0;

    if(hasSystemctl)
    {
        const isActive = spawnSync("systemctl", ["is-active", "--quiet", "ollama"]);
        if(isActive.status === 0)
        {
            console.log("Ollama service is active (systemd)");
            return;
        }

        console.log("Ollama service is not active. Attempting to start it via systemd...");
        const start = spawnSync("systemctl", ["start", "ollama"]);
        if(start.status === 0)
        {
            const nowActive = spawnSync("systemctl", ["is-active", "--quiet", "ollama"]);
            if (nowActive.status === 0)
            {
                console.log("Ollama service started successfully (systemd)");
                return;
            }
        }

        console.warn("Could not start Ollama via systemd. Will attempt fallback start.");
    }
    else
    {
        console.warn("systemctl not found — skipping systemd steps and using fallback.");
    }

    // Fallback: spawn the daemon under Node's control and register it for shutdown
    try
    {
        const logsDir = path.resolve(process.cwd(), "logs");
        if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

        const outLog = fs.openSync(path.join(logsDir, "ollama.out.log"), "a");
        const errLog = fs.openSync(path.join(logsDir, "ollama.err.log"), "a");

        console.log("Starting Ollama daemon as fallback (node-managed). Logs:", logsDir);
        const child = spawn("ollama", ["daemon"], {
            stdio: ["ignore", outLog, errLog],
        });

        // register so shutdown can kill it
        registerOllamaProcess(child);

        // give the daemon a moment and check API
        await new Promise((r) => setTimeout(r, 1200));
        // quick health check
        try
        {
            const resp = await fetch("http://127.0.0.1:11434/api/tags");
            if(resp.ok)
            {
                console.log("Ollama daemon started and responding (fallback)");
                return;
            }
            console.warn("Ollama daemon started but API returned non-OK status");
        }
        catch (e)
        {
            console.warn("Ollama fallback daemon did not respond yet; check logs for details.");
        }
    }
    catch (err)
    {
        console.error("Failed to start Ollama fallback daemon:", err);
    }

    console.error("Ollama não pôde ser inicializado. Verifique instalação e logs do systemd: sudo journalctl -u ollama -xe");
    process.exit(1);
}
