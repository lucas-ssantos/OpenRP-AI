import systray2 from "systray2";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { startServer, stopServer, isRunning } from "./serverProcess.js";
import { startTailscale, stopTailscaleConnection, isTailscaleRunning } from "./tailscaleProcess.js";
import { notify } from "./notify.js";
import { appConfig } from "../src/config.js";

// No Linux, o nome do processo (ps/htop) reflete o argv original — sem isso
// aparece só como "node".
process.title = "OpenRP AI";

const SysTray = systray2.default;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICON_RUNNING = path.join(__dirname, "assets", "icon-running.png");
const ICON_STOPPED = path.join(__dirname, "assets", "icon-stopped.png");

const REFRESH_INTERVAL_MS = 4000;
const HEALTH_CHECK_TIMEOUT_MS = 1500;

// Indicador em texto (verde/cinza) via emoji — ao contrário do ícone por item
// de menu, isso não depende do painel/host suportar ícones em itens de menu.
const DOT_ON = "🟢";
const DOT_OFF = "⚪";

// Verifica se o servidor responde de fato (independente de quem o iniciou —
// pode ter sido a própria bandeja ou um `npm start` manual em outro terminal).
async function isServerReachable()
{
    try
    {
        const res = await fetch(`http://127.0.0.1:${appConfig.port}/api/status`, {
            signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
        });
        return res.ok;
    }
    catch
    {
        return false;
    }
}

// Checa o Ollama diretamente (não via /api/status) — assim seu status é
// independente do servidor Node estar de pé ou não.
async function isOllamaReachable()
{
    try
    {
        const res = await fetch(appConfig.ollama.tagsEndpoint, {
            signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
        });
        return res.ok;
    }
    catch
    {
        return false;
    }
}

function buildMenu({ reachable, tailscaleActive })
{
    return {
        icon: reachable ? ICON_RUNNING : ICON_STOPPED,
        title: "OpenRP AI",
        tooltip: reachable ? "OpenRP AI — rodando" : "OpenRP AI — parado",
        items: [
            {
                title: `${reachable ? DOT_ON : DOT_OFF} Servidor: ${reachable ? "rodando" : "parado"}`,
                tooltip: "",
                enabled: false,
                checked: false,
            },
            SysTray.separator,
            {
                title: "Iniciar servidor",
                tooltip: `Inicia o OpenRP AI em http://localhost:${appConfig.port}`,
                enabled: !reachable,
                checked: false,
                click: handleStart,
            },
            {
                title: "Parar servidor",
                tooltip: "Encerra o OpenRP AI (Node + Ollama) e desconecta o Tailscale",
                enabled: reachable,
                checked: false,
                click: handleStop,
            },
            {
                title: "Reiniciar servidor",
                tooltip: "Para e inicia o OpenRP AI novamente",
                enabled: reachable,
                checked: false,
                click: handleRestart,
            },
            SysTray.separator,
            {
                title: `${tailscaleActive ? DOT_ON : DOT_OFF} Tailscale: ${tailscaleActive ? "ativo" : "inativo"}`,
                tooltip: "",
                enabled: false,
                checked: false,
            },
            {
                title: "Iniciar Tailscale",
                tooltip: "Ativa o serviço tailscaled e conecta na tailnet",
                enabled: !tailscaleActive,
                checked: false,
                click: handleStartTailscale,
            },
            {
                title: "Parar Tailscale",
                tooltip: "Para o serviço tailscaled",
                enabled: tailscaleActive,
                checked: false,
                click: handleStopTailscale,
            },
            SysTray.separator,
            {
                title: "Abrir no navegador",
                tooltip: "",
                enabled: true,
                checked: false,
                click: openBrowser,
            },
            {
                title: "Sair",
                tooltip: "",
                enabled: true,
                checked: false,
                click: handleExit,
            },
        ],
    };
}

// Alguns hosts de bandeja (ex: waybar em compositores Wayland minimalistas)
// não aplicam `update-menu` em um ícone já existente de forma confiável.
// Por isso, em vez de só reenviar a ação, recriamos o ícone quando o estado
// realmente muda — isso garante que o menu/ícone fiquem corretos independente
// do host, ao custo de um piscar rápido do ícone no momento da mudança.
let systray = null;
let lastState = null;

function statesEqual(a, b)
{
    return !!a && !!b && a.reachable === b.reachable && a.tailscaleActive === b.tailscaleActive;
}

async function createTray(state)
{
    const instance = new SysTray({
        menu: buildMenu(state),
        debug: false,
        copyDir: false,
    });
    instance.onClick((action) => {
        if (action.item.click) action.item.click();
    });
    await instance.ready();
    return instance;
}

async function applyState(state)
{
    if (statesEqual(state, lastState)) return;

    const previous = systray;
    systray = await createTray(state);
    lastState = state;

    if (previous)
    {
        try
        {
            await previous.kill(false);
        }
        catch (e)
        {
            console.warn("Falha ao remover ícone antigo da bandeja:", e.message || e);
        }
    }
}

// Dispara "iniciado com sucesso" ao detectar uma transição parado→rodando —
// funciona tanto para ações feitas pela própria bandeja quanto para mudanças
// externas (outra instância, `npm start` manual, etc.), já que só depende do
// estado real observado a cada checagem.
let previousNotifyState = null;

function notifyTransitions(previous, current)
{
    if (!previous) return;

    if (!previous.reachable && current.reachable)
    {
        notify("OpenRP AI", `Servidor iniciado com sucesso — http://localhost:${appConfig.port}`, { icon: ICON_RUNNING });
    }
    if (!previous.ollamaReachable && current.ollamaReachable)
    {
        notify("Ollama", "Ollama iniciado com sucesso.", { icon: ICON_RUNNING });
    }
    if (!previous.tailscaleActive && current.tailscaleActive)
    {
        notify("Tailscale", "Tailscale iniciado com sucesso.", { icon: ICON_RUNNING });
    }
}

let refreshInFlight = false;

async function refreshMenu()
{
    // evita empilhar checagens se uma ainda estiver em andamento (ex: health check lento)
    if (refreshInFlight) return;
    refreshInFlight = true;
    try
    {
        const state = {
            reachable: await isServerReachable(),
            ollamaReachable: await isOllamaReachable(),
            tailscaleActive: isTailscaleRunning(),
        };

        notifyTransitions(previousNotifyState, state);
        previousNotifyState = state;

        await applyState(state);
    }
    finally
    {
        refreshInFlight = false;
    }
}

function handleStart()
{
    if (isRunning()) return;
    console.log("Iniciando OpenRP AI...");
    notify("OpenRP AI", `Iniciando servidor em http://localhost:${appConfig.port}...`);
    // Iniciar o servidor também aciona o start do Ollama (ver src/index.js → initOllama()).
    notify("Ollama", "Iniciando Ollama...");
    startServer({
        onExit: (code, signal) => {
            console.log(`OpenRP AI encerrado (code=${code}, signal=${signal})`);
            refreshMenu();
        },
    });
    refreshMenu();
}

async function handleStop()
{
    console.log("Parando OpenRP AI...");
    await stopServer();

    try
    {
        stopTailscaleConnection();
    }
    catch (e)
    {
        console.warn("Falha ao parar Tailscale:", e.message || e);
    }

    refreshMenu();
}

async function handleRestart()
{
    console.log("Reiniciando OpenRP AI...");
    notify("OpenRP AI", "Reiniciando servidor...");

    // Não mexe no Tailscale — reiniciar o servidor não deve derrubar a VPN.
    await stopServer();

    startServer({
        onExit: (code, signal) => {
            console.log(`OpenRP AI encerrado (code=${code}, signal=${signal})`);
            refreshMenu();
        },
    });
    refreshMenu();
}

async function handleStartTailscale()
{
    console.log("Iniciando Tailscale...");
    notify("Tailscale", "Iniciando Tailscale...");
    await startTailscale();
    refreshMenu();
}

function handleStopTailscale()
{
    console.log("Parando Tailscale...");
    stopTailscaleConnection();
    refreshMenu();
}

function openBrowser()
{
    spawn("xdg-open", [`http://localhost:${appConfig.port}`], {
        detached: true,
        stdio: "ignore",
    }).unref();
}

let refreshTimer = null;

async function handleExit()
{
    if (refreshTimer) clearInterval(refreshTimer);

    // Checa quem estava de fato ativo antes de derrubar tudo, para só notificar
    // o encerramento dos serviços que realmente estavam rodando.
    const wasServerRunning = await isServerReachable();
    const wasOllamaRunning = await isOllamaReachable();
    const wasTailscaleActive = isTailscaleRunning();

    await stopServer();
    if (wasServerRunning) notify("OpenRP AI", "Servidor encerrado.", { icon: ICON_STOPPED });
    if (wasOllamaRunning) notify("Ollama", "Ollama encerrado.", { icon: ICON_STOPPED });

    try
    {
        stopTailscaleConnection();
        if (wasTailscaleActive) notify("Tailscale", "Tailscale desconectado.", { icon: ICON_STOPPED });
    }
    catch (e)
    {
        console.warn("Falha ao parar Tailscale:", e.message || e);
    }

    if (systray) await systray.kill(true);
    else process.exit(0);
}

process.on("SIGINT", () => handleExit());
process.on("SIGTERM", () => handleExit());

async function main()
{
    const initialState = {
        reachable: false,
        ollamaReachable: false,
        tailscaleActive: isTailscaleRunning(),
    };
    systray = await createTray(initialState);
    lastState = initialState;
    previousNotifyState = initialState;

    console.log("Tray iniciada.");
    handleStart();
    refreshTimer = setInterval(refreshMenu, REFRESH_INTERVAL_MS);
}

main().catch((err) => {
    console.error("Falha ao iniciar a bandeja do sistema:", err.message || err);
    process.exit(1);
});
