import { initOllama } from "./services/ollama.init.js";
import { initDB } from "./services/database/db.js";
import { migrate } from "./services/database/migrations.js";
import { saveDB } from "./services/database/save.js";
import { shutdown } from "./core/shutdown.js";
import express from "express";
import path from "path";
import { registerRoutes } from "./api/index.js";

async function main() {

    try {

        console.log("\n=== Starting OpenRP AI ===\n");


    }
    catch (err) {
        
        console.error("Error during initialization:", err);
    }

}

main ();

process.on(

    "SIGINT",

    async () => {

        console.log(

            "\nReceived SIGINT (CTRL+C)"

        );

        await shutdown(0);

    }

);

//SIGTERM
process.on(

    "SIGTERM",

    async () => {

        console.log(

            "\nReceived SIGTERM"

        );

        await shutdown(0);

    }

);

//uncaughtException
process.on(

    "uncaughtException",

    async err => {

        console.error(

            "\nUncaught Exception"

        );

        console.error(err);

        await shutdown(1);

    }

);

//unhandledRejection
process.on(

    "unhandledRejection",

    async err => {

        console.error(

            "\nUnhandled Promise Rejection"

        );

        console.error(err);

        await shutdown(1);

    }

);