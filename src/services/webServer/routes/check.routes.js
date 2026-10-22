import { Router } from "express";
import path from "path";
import { getDB } from "../../database/db.js";
import { appConfig } from "../../../config.js";

const publicPath = path.resolve(process.cwd(), "public");

export async function getHealthStatus() {
    const status = {
        llama: { ok: false, message: "llama-server não disponível" },
        database: { ok: false, message: "Banco de dados não inicializado" },
    };

    try {
        const response = await fetch(appConfig.llama.healthEndpoint);
        if (response.ok) {
            status.llama.ok = true;
            status.llama.message = "llama-server está ativo";
        } else {
            status.llama.message = `llama-server respondeu com status ${response.status}`;
        }
    } catch {
        status.llama.message = "llama-server não está acessível";
    }

    try {
        const db = getDB();
        db.exec("SELECT 1");
        status.database.ok = true;
        status.database.message = "Banco de dados inicializado";
    } catch (err) {
        status.database.message = `Erro no banco de dados: ${err.message}`;
    }

    return status;
}

const router = Router();

router.get("/check", (_req, res) => {
    res.sendFile(path.join(publicPath, "check.html"));
});

router.get("/api/status", async (_req, res) => {
    res.json(await getHealthStatus());
});

export default router;
