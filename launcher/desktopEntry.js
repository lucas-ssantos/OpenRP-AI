// Instala/remove o atalho do OpenRP AI no menu de aplicativos do Linux
// (~/.local/share/applications), sem precisar de sudo.
//
// Uso:
//   node launcher/desktopEntry.js             → instala
//   node launcher/desktopEntry.js --uninstall → remove
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const trayScript = path.join(projectRoot, "launcher", "tray.js");
const iconPath = path.join(projectRoot, "launcher", "assets", "app-icon.png");

const desktopDir = path.join(os.homedir(), ".local", "share", "applications");
const desktopFile = path.join(desktopDir, "openrp-ai.desktop");

function buildDesktopEntry()
{
    return [
        "[Desktop Entry]",
        "Type=Application",
        "Version=1.0",
        "Name=OpenRP AI",
        "Comment=Plataforma local de roleplay com IA (Ollama)",
        `Exec=${process.execPath} "${trayScript}"`,
        `Path=${projectRoot}`,
        `Icon=${iconPath}`,
        "Terminal=false",
        "Categories=Utility;Network;",
        "",
    ].join("\n");
}

function refreshDesktopDatabase()
{
    try
    {
        spawnSync("update-desktop-database", [desktopDir]);
    }
    catch (e)
    {
        // best-effort — alguns ambientes não têm esse binário
    }
}

function install()
{
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(desktopFile, buildDesktopEntry(), { mode: 0o755 });
    refreshDesktopDatabase();
    console.log(`Desktop entry criado em: ${desktopFile}`);
}

function uninstall()
{
    if (fs.existsSync(desktopFile))
    {
        fs.unlinkSync(desktopFile);
        refreshDesktopDatabase();
        console.log(`Desktop entry removido: ${desktopFile}`);
    }
    else
    {
        console.log("Nenhum desktop entry encontrado para remover.");
    }
}

if (process.argv.includes("--uninstall")) uninstall();
else install();
