import { spawnSync } from "child_process";
import { registerTailscale } from "../core/shutdown.js";

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
        const start = spawnSync("systemctl", ["start", "tailscaled"]);
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
