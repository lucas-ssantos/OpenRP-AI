import express from "express";
import path from "path";
import { spawn } from "child_process";
import { registerWebServer } from "../core/shutdown.js";
import { getDB } from "./database/db.js";

export async function startWebServer(port = process.env.PORT || 3000)
{
    const app = express();
    const publicPath = path.resolve(process.cwd(), "public");

    app.use(express.static(publicPath));

    app.get("/api/status", async (req, res) => 
    {
        const ollamaStatus = {
            ok: false,
            message: "Ollama não disponível",
        };

        try
        {
            const response = await fetch("http://127.0.0.1:11434/api/tags");
            if(response.ok)
            {
                ollamaStatus.ok = true;
                ollamaStatus.message = "Ollama está ativo";
            }
            else
            {
                ollamaStatus.message = `Ollama respondeu com status ${response.status}`;
            }
        }
        catch (err)
        {
            ollamaStatus.message = "Ollama não está acessível";
        }

        const dbStatus = {
            ok: false,
            message: "Banco de dados não inicializado",
        };

        try
        {
            const db = getDB();
            db.exec("SELECT 1");
            dbStatus.ok = true;
            dbStatus.message = "Banco de dados inicializado";
        }
        catch (err)
    {
            dbStatus.message = `Erro no banco de dados: ${err.message}`;
        }

        res.json({ ollama: ollamaStatus, database: dbStatus });
    });

    const server = app.listen(port, () => {
        const url = `http://localhost:${port}`;
        console.log(`Web server listening on ${url}`);
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

    registerWebServer(server);
    return { app, server };
}
