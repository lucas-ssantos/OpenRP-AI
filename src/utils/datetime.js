import { appConfig } from "../config.js";

/**
 * Returns the current datetime as a SQLite-compatible string (YYYY-MM-DD HH:MM:SS)
 * in the configured local timezone instead of UTC.
 */
export function localDatetime() {
    return new Date().toLocaleString("sv-SE", { timeZone: appConfig.timezone });
}

// Milissegundos do dia (meia-noite UTC) da parte de data de uma string
// "YYYY-MM-DD ..." — comparar dias assim ignora horário e fuso, já que ambos
// os lados vêm de localDatetime() no mesmo fuso configurado.
function dayMs(datetimeStr) {
    return Date.parse(`${String(datetimeStr).slice(0, 10)}T00:00:00Z`);
}

/**
 * Nome do dia da semana (em inglês, para o prompt) da parte de data de uma
 * string "YYYY-MM-DD HH:MM:SS". Retorna null se a data for inválida.
 */
export function weekdayOf(datetimeStr) {
    const t = dayMs(datetimeStr ?? "");
    if (!Number.isFinite(t)) return null;
    return new Date(t).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

/**
 * Distância em dias de calendário entre um datetime armazenado e o agora,
 * como rótulo relativo em inglês (idioma dos blocos do prompt): "today",
 * "yesterday", "3 days ago", "2 weeks ago", "a month ago"...
 *
 * @param {string} datetimeStr - "YYYY-MM-DD HH:MM:SS" no fuso configurado (formato de localDatetime)
 * @param {string} [nowStr]    - referência de "agora" no mesmo formato (para testes)
 * @returns {string|null} null se datetimeStr for ausente/inválido
 */
export function formatRelativeTime(datetimeStr, nowStr = localDatetime()) {
    const then = dayMs(datetimeStr ?? "");
    const now  = dayMs(nowStr);
    if (!Number.isFinite(then) || !Number.isFinite(now)) return null;

    const days = Math.round((now - then) / 86_400_000);
    if (days <= 0)  return "today";
    if (days === 1) return "yesterday";
    if (days < 7)   return `${days} days ago`;
    if (days < 14)  return "a week ago";
    if (days < 30)  return `${Math.round(days / 7)} weeks ago`;
    if (days < 60)  return "a month ago";
    if (days < 365) return `${Math.round(days / 30)} months ago`;
    const years = Math.round(days / 365);
    return years <= 1 ? "a year ago" : `${years} years ago`;
}
