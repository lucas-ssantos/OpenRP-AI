import express from "express";
import fs from "fs";
import path from "path";
import { registerWebServer } from "../../core/shutdown.js";
import { appConfig } from "../../config.js";

import indexRouter     from "./routes/index.routes.js";
import checkRouter     from "./routes/check.routes.js";
import personaRouter   from "./routes/persona.routes.js";
import characterRouter from "./routes/character.routes.js";
import chatRouter      from "./routes/chat.routes.js";
import settingsRouter  from "./routes/settings.routes.js";
import viewdbRouter    from "./routes/viewdb.routes.js";
import lorebookRouter  from "./routes/lorebook.routes.js";
import logsRouter      from "./routes/logs.routes.js";

// Basic auth opcional: ativo apenas se AUTH_PASSWORD estiver definido no .env.
// Importante quando o app é exposto via Tailscale — sem isso, qualquer
// dispositivo do tailnet acessa tudo (chat, config, viewdb).
function basicAuthMiddleware(req, res, next) {
    const { user, password } = appConfig.auth;

    const header = req.headers.authorization || "";
    if (header.startsWith("Basic ")) {
        const [reqUser, ...rest] = Buffer.from(header.slice(6), "base64").toString().split(":");
        if (reqUser === user && rest.join(":") === password) return next();
    }

    res.set("WWW-Authenticate", 'Basic realm="OpenRP AI"');
    res.status(401).send("Autenticação necessária.");
}

export async function startWebServer(port = appConfig.port) {
    const app = express();
    const publicPath = path.resolve(process.cwd(), "public");
    const uploadDir  = path.join(publicPath, "assets/uploads");

    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    if (appConfig.auth.password) {
        app.use(basicAuthMiddleware);
        console.log("Basic auth habilitado (AUTH_PASSWORD definido).");
    }

    app.use(express.json({ limit: "10mb" }));

    app.use(indexRouter);
    app.use(checkRouter);
    app.use(personaRouter);
    app.use(characterRouter(uploadDir));
    app.use(chatRouter);
    app.use(settingsRouter);
    app.use(viewdbRouter);
    app.use(lorebookRouter);
    app.use(logsRouter);

    app.use(express.static(publicPath));

    const server = app.listen(port, () => {
        console.log(`Web server listening on http://localhost:${port}`);
    });

    registerWebServer(server);
    return { app, server };
}
