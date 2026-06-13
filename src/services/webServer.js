import express from "express";
import { spawn } from "child_process";
import { registerWebServer } from "../core/shutdown.js";

export async function startWebServer(port = process.env.PORT || 3000)
{
    const app = express();

    app.get("/", async (req, res) => {
        try
        {
            const resp = await fetch("http://127.0.0.1:11434/api/tags");
            if(resp.ok)
            {
                res.send("<html><body><h1>Ollama está ativo ✅</h1></body></html>");
            }
            else
            {
                res.send(`<html><body><h1>Ollama respondeu com status ${resp.status}</h1></body></html>`);
            }
        }
        catch (err)
        {
            res.send("<html><body><h1>Ollama não está acessível ❌</h1></body></html>");
        }
    });

    const server = app.listen(port, () => {
        const url = `http://localhost:${port}`;
        console.log(`Web server listening on ${url}`);
        // Open URL in default browser (Linux: xdg-open)
        try
        {
            const opener = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
            opener.unref();
        }
        catch (e)
        {
            console.warn("Falha ao abrir o navegador automaticamente:", e.message);
        }
    });

    // register server for graceful shutdown
    registerWebServer(server);

    return { app, server };
}
