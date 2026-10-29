// Impede que a bandeja seja lançada duas vezes (ex: clique duplo no atalho do
// menu de aplicativos). Usa um lock file com o PID do dono em os.tmpdir() —
// se o processo daquele PID não existir mais (lock órfão de uma sessão
// anterior encerrada à força), o lock é considerado stale e é retomado.
import fs from "fs";
import os from "os";
import path from "path";

const LOCK_PATH = path.join(os.tmpdir(), "openrp-ai-launcher.lock");

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

function readLockedPid()
{
    try
    {
        const pid = parseInt(fs.readFileSync(LOCK_PATH, "utf8").trim(), 10);
        return Number.isInteger(pid) ? pid : null;
    }
    catch
    {
        return null;
    }
}

// Retorna true se o lock foi adquirido (nenhuma outra instância viva), ou
// false se já existe uma bandeja rodando.
export function acquireSingleInstanceLock()
{
    const existingPid = readLockedPid();
    if (existingPid && existingPid !== process.pid && isPidAlive(existingPid))
    {
        return false;
    }

    fs.writeFileSync(LOCK_PATH, String(process.pid));

    const release = () => {
        if (readLockedPid() === process.pid)
        {
            try { fs.unlinkSync(LOCK_PATH); } catch { /* já removido */ }
        }
    };
    process.on("exit", release);

    return true;
}
