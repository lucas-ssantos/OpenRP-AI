import { saveDB } from "../database/save.js";

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

let shuttingDown = false;

export async function shutdown(code = 0) {

    if (shuttingDown) {

        return;

    }

    shuttingDown = true;

    console.log("\n=== Shutting down ===\n");

    //
    // Salva banco
    //

    try {

        console.log("Saving database...");

        await saveDB();

        console.log("✓ Database saved.");

    }

    catch(err) {

        console.error(

            "❌ Failed to save database."

        );

        console.error(err);

    }


    //
    // Para o Ollama
    //

    try {

        console.log(

            "Stopping Ollama..."

        );

        await execAsync(

            "systemctl stop ollama"

        );

        console.log(

            "✓ Ollama stopped."

        );

    }

    catch(err){

        console.warn(

            "❌ Failed to stop Ollama."

        );

        console.warn(

            err.stderr ||

            err.message

        );

    }


    console.log(

        "\nBye!\n"

    );

    process.exit(code);

}