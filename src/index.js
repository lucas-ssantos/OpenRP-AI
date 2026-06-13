import { initOllama } from "./core/ollama.init.js";
import { initDB } from "./database/db.js";
import { migrate } from "./database/migrations.js";
import { saveDB } from "./database/save.js";
import { shutdown } from "./core/shutdown.js";

async function main() {

    try {

        console.log("\n=== Starting Roleplay AI ===\n");


        //
        // OLLAMA
        //

        await initOllama();


        //
        // DATABASE
        //

        console.log("\nInitializing database...");

        await initDB();

        console.log("✓ Database loaded.");


        //
        // MIGRATIONS
        //

        console.log("Running migrations...");

        migrate();

        console.log("✓ Database ready.");


        //
        // AUTO SAVE
        //

        setInterval(async () => {

            try {

                await saveDB();

                console.log(

                    "[DB] Saved."

                );

            }

            catch(err){

                console.error(

                    "[DB] Save failed:",

                    err

                );

            }

        }, 30000);


        //
        // EXPRESS
        //

        console.log(

            "\nStarting API..."

        );

        // app.listen(...)


        console.log(

            "\n✓ System ready.\n"

        );

    }

    catch(err){

        console.error(

            "\n❌ Bootstrap failed:\n"

        );

        console.error(err);

        process.exit(1);

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