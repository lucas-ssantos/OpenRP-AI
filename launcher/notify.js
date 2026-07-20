// Notificações desktop via D-Bus (org.freedesktop.Notifications), consumidas
// pelo daemon de notificação ativo na sessão (ex: swaync). Usa `gdbus`
// (glib2, já presente por padrão em qualquer desktop Linux) em vez de
// `notify-send` para não depender de mais um pacote instalado.
import { spawn } from "child_process";

const APP_NAME = "OpenRP AI";
const DEFAULT_TIMEOUT_MS = 6000;

const URGENCY = { low: 0, normal: 1, critical: 2 };

export function notify(summary, body = "", { icon = "", urgency = "normal", timeoutMs = DEFAULT_TIMEOUT_MS } = {})
{
    const args = [
        "call", "--session",
        "--dest", "org.freedesktop.Notifications",
        "--object-path", "/org/freedesktop/Notifications",
        "--method", "org.freedesktop.Notifications.Notify",
        APP_NAME,
        "0",
        icon,
        summary,
        body,
        "[]",
        `{"urgency": <byte ${URGENCY[urgency] ?? URGENCY.normal}>}`,
        String(timeoutMs),
    ];

    // best-effort: notificação nunca deve derrubar a bandeja (ex: gdbus
    // ausente, sem daemon de notificação rodando, etc.)
    const child = spawn("gdbus", args, { stdio: "ignore" });
    child.on("error", () => {});
}
