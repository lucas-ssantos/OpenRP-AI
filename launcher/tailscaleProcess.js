// Reaproveita a mesma lógica já usada pelo boot/shutdown do app
// (src/services/tailscale.init.js) para expor start/stop sob demanda na bandeja.
import {
    initTailscale,
    stopTailscale,
    disconnectTailscale,
    isTailscaleUp,
} from "../src/services/tailscale.init.js";

export async function startTailscale()
{
    await initTailscale();
}

// Usado pelo botão "Parar Tailscale" — só desconecta (`tailscale down`), sem
// derrubar o serviço. Não exige root (uma vez configurado o operator).
export function stopTailscaleConnection()
{
    disconnectTailscale();
}

// Usado apenas no "Sair" da bandeja, para desligar tudo — inclui parar o
// serviço tailscaled inteiro (mesmo comportamento do shutdown original do app).
export function stopTailscaleService()
{
    stopTailscale();
}

export function isTailscaleRunning()
{
    return isTailscaleUp();
}
