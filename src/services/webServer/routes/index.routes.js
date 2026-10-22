import { Router } from "express";
import path from "path";
import { getPersona } from "../../database/queries.js";
import { getHealthStatus } from "./check.routes.js";

const publicPath = path.resolve(process.cwd(), "public");
const router = Router();

router.get("/", async (_req, res) => {
    const status = await getHealthStatus();
    if (!status.llama.ok || !status.database.ok) return res.redirect("/check");
    if (!getPersona()) return res.redirect("/persona");
    res.sendFile(path.join(publicPath, "index.html"));
});

export default router;
