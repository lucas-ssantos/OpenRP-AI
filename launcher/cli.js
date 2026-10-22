#!/usr/bin/env node
import { startServer, stopServer, isRunning, isServerProcessRunning } from "./serverProcess.js";
import {
    startTailscale,
    stopTailscaleConnection,
    isTailscaleRunning,
} from "./tailscaleProcess.js";
import { appConfig } from "../src/config.js";

const HEALTH_CHECK_TIMEOUT_MS = 1500;

function printUsage()
{
    console.log(`Uso:
  npm run launcher:cli -- status
  npm run launcher:cli -- <start|stop|restart> <server|tailscale>

Exemplos:
  npm run launcher:cli -- start server
  npm run launcher:cli -- restart server
  npm run launcher:cli -- stop tailscale

O comando "server" controla o OpenRP AI e o Ollama juntos.
Parar o servidor também desconecta o Tailscale; reiniciá-lo mantém o Tailscale conectado.
Iniciar o servidor mantém este terminal aberto para exibir os logs.`);
}

async function isReachable(url, { authenticate = false } = {})
{
    try
    {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
            headers: authenticate && appConfig.auth.password
                ? {
                    Authorization: `Basic ${Buffer.from(`${appConfig.auth.user}:${appConfig.auth.password}`).toString("base64")}`,
                }
                : undefined,
        });
        return response.ok;
    }
    catch
    {
        return false;
    }
}

async function showStatus()
{
    const [server, ollama] = await Promise.all([
        isReachable(`http://127.0.0.1:${appConfig.port}/api/status`, { authenticate: true }),
        isReachable(appConfig.ollama.tagsEndpoint),
    ]);
    const tailscale = isTailscaleRunning();

    console.log(`Servidor OpenRP AI: ${server ? "rodando" : "parado"} (http://localhost:${appConfig.port})`);
    console.log(`Ollama: ${ollama ? "rodando" : "parado"} (${appConfig.ollama.host})`);
    console.log(`Tailscale: ${tailscale ? "ativo" : "inativo"}`);
}

function startServerProcess()
{
    if (isRunning())
    {
        console.log("O processo do servidor já foi iniciado por este CLI.");
        return;
    }

    startServer({
        onExit: (code, signal) => {
            console.log(`OpenRP AI encerrado (code=${code}, signal=${signal})`);
            if (code !== 0 && code !== null) process.exitCode = code;
            else if (signal && signal !== "SIGTERM" && signal !== "SIGINT") process.exitCode = 1;
        },
    });
    console.log(`Iniciando OpenRP AI e Ollama em http://localhost:${appConfig.port}...`);
}

async function run()
{
    const [action, target] = process.argv.slice(2);

    if (action === "--help" || action === "-h" || action === "help")
    {
        printUsage();
        return;
    }

    if (action === "status" && target === undefined)
    {
        await showStatus();
        return;
    }

    if (!["start", "stop", "restart"].includes(action) || !["server", "tailscale"].includes(target))
    {
        printUsage();
        process.exitCode = 2;
        return;
    }

    if (target === "server")
    {
        if (action === "start")
        {
            if (isServerProcessRunning() || await isReachable(`http://127.0.0.1:${appConfig.port}/api/status`))
            {
                console.log("OpenRP AI já está rodando.");
                return;
            }
            startServerProcess();
            return;
        }

        if (action === "stop")
        {
            console.log("Parando OpenRP AI e Ollama...");
            await stopServer();
            stopTailscaleConnection();
            console.log("Servidor parado; Tailscale desconectado.");
            return;
        }

        console.log("Reiniciando OpenRP AI e Ollama...");
        await stopServer();
        startServerProcess();
        return;
    }

    if (action === "start")
    {
        console.log("Iniciando Tailscale...");
        await startTailscale();
    }
    else if (action === "stop")
    {
        console.log("Desconectando Tailscale...");
        stopTailscaleConnection();
    }
    else
    {
        console.log("Reiniciando conexão Tailscale...");
        stopTailscaleConnection();
        await startTailscale();
    }

    const active = isTailscaleRunning();
    if ((action === "stop" && active) || (action !== "stop" && !active))
    {
        throw new Error(`Não foi possível ${action === "stop" ? "desconectar" : "conectar"} o Tailscale.`);
    }
    console.log(`Tailscale ${active ? "ativo" : "desconectado"}.`);
}

run().catch((error) => {
    console.error("Falha no comando do launcher:", error.message || error);
    process.exitCode = 1;
});
