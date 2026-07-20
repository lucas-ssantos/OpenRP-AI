import { spawnSync } from "child_process";
import { registerTailscale } from "../core/shutdown.js";

export function isTailscaleServiceActive() {
    const hasSystemctl = spawnSync("which", ["systemctl"]).status === 0;
    if (!hasSystemctl) return false;
    return spawnSync("systemctl", ["is-active", "--quiet", "tailscaled"]).status === 0;
}

// Diferente de isTailscaleServiceActive() (o daemon está de pé?), isto checa
// se o nó está de fato conectado à tailnet — o daemon pode estar ativo desde
// o boot mesmo com a conexão em "down". É o estado certo para refletir/ligar
// no botão Iniciar/Parar Tailscale da bandeja.
export function isTailscaleUp() {
    const result = spawnSync("tailscale", ["status", "--json"], { encoding: "utf8" });
    if (result.status !== 0 || !result.stdout) return false;
    try {
        return JSON.parse(result.stdout).BackendState === "Running";
    } catch {
        return false;
    }
}

// Desconecta da tailnet sem derrubar o serviço tailscaled — ao contrário de
// stopTailscale(), não mexe no systemd e não exige root (uma vez configurado
// `sudo tailscale set --operator=$USER`). É o par simétrico de `tailscale up`
// e o que o botão "Parar Tailscale" da bandeja deve usar.
export function disconnectTailscale() {
    const result = spawnSync("tailscale", ["down"]);
    if (result.status !== 0) {
        const stderr = result.stderr?.toString().trim();
        console.warn("Falha ao executar 'tailscale down':", stderr || "(sem saída)");
    }
}

export function stopTailscale() {
    const hasSystemctl = spawnSync("which", ["systemctl"]).status === 0;
    if (!hasSystemctl) return;

    const isActive = spawnSync("systemctl", ["is-active", "--quiet", "tailscaled"]);
    if (isActive.status === 0) {
        console.log("Stopping systemd-managed Tailscale service...");
        const stop = spawnSync("systemctl", ["stop", "tailscaled", "--no-ask-password"]);
        if (stop.status === 0) {
            console.log("Tailscale systemd service stopped");
        } else {
            console.warn("Failed to stop Tailscale via systemctl — you may need sudo.\nRun: sudo systemctl stop tailscaled");
        }
    }
}

export async function initTailscale() {
    console.log("Checking Tailscale...");

    const which = spawnSync("which", ["tailscale"]);
    if (which.status !== 0) {
        console.warn("Tailscale não encontrado — acesso remoto via Tailscale desativado.");
        return;
    }

    const hasSystemctl = spawnSync("which", ["systemctl"]).status === 0;
    if (!hasSystemctl) {
        console.warn("systemctl não encontrado — não foi possível gerenciar o Tailscale.");
        return;
    }

    const isActive = spawnSync("systemctl", ["is-active", "--quiet", "tailscaled"]);
    if (isActive.status !== 0) {
        console.log("Tailscale service not running. Starting via systemd...");
        const start = spawnSync("systemctl", ["start", "tailscaled", "--no-ask-password"]);
        if (start.status !== 0) {
            console.warn("Falha ao iniciar tailscaled via systemctl. Tente: sudo systemctl start tailscaled");
            return;
        }
    }

    // Conecta à rede Tailscale (sem-op se já estiver conectado)
    const up = spawnSync("tailscale", ["up"]);
    if (up.status !== 0) {
        const stderr = up.stderr?.toString().trim();
        // "already running" não é erro real
        if (!stderr?.includes("already")) {
            console.warn("Falha ao executar 'tailscale up':", stderr || "(sem saída)");
            return;
        }
    }

    // Loga o IP para facilitar acesso pelo celular
    const ip = spawnSync("tailscale", ["ip", "-4"]);
    const tailscaleIP = ip.stdout?.toString().trim();
    if (tailscaleIP) {
        console.log(`Tailscale ativo — acesse a aplicação em: http://${tailscaleIP}:${process.env.PORT || 3000}`);
    } else {
        console.log("Tailscale ativo.");
    }

    registerTailscale();
}
