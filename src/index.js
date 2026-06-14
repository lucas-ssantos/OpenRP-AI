import { initOllama } from "./services/ollama.init.js";
import { ensureCustomModels } from "./services/ollama.models.js";
import { initTailscale } from "./services/tailscale.init.js";
import { startWebServer } from "./services/webServer/webServer.init.js";
import { shutdown, registerSaveDB } from "./core/shutdown.js";
import { initDB } from "./services/database/db.js";
import { migrate } from "./services/database/migrations.js";
import { saveDB } from "./services/database/save.js";
import express from "express";
import path from "path";

//
//  SHUTDOWN
//

let _isShuttingDown = false;

async function handleProcessEvent(type, err)
{
    if (_isShuttingDown) return;
    _isShuttingDown = true;

    if (type === "SIGINT") console.log("\nReceived SIGINT (CTRL+C)");
    else if (type === "SIGTERM") console.log("\nReceived SIGTERM");
    else if (type === "uncaughtException")
    {
        console.error("\nUncaught Exception");
        console.error(err);
    }
    else if(type === "unhandledRejection")
    {
        console.error("\nUnhandled Promise Rejection");
        console.error(err);
    }

    const code = (type === "uncaughtException" || type === "unhandledRejection") ? 1 : 0;

    try
    {
        await shutdown(code);
    }
    catch (e)
    {
        console.error("Error during shutdown:", e);
    }

    process.exit(code);
}

["SIGINT", "SIGTERM"].forEach(sig => process.on(sig, () => handleProcessEvent(sig)));
process.on("uncaughtException", (err) => handleProcessEvent("uncaughtException", err));
process.on("unhandledRejection", (err) => handleProcessEvent("unhandledRejection", err));

//
//  MAIN
//

async function main()
{

    try
    {
        console.log("\n=== Starting OpenRP AI ===\n");
        await initTailscale();
        await initOllama();
        await ensureCustomModels();
        await initDB();
        await migrate();
        registerSaveDB(saveDB);
        await startWebServer();
    }
    catch (err)
    {    
        console.error("Error during initialization:", err);
    }

}

main ();