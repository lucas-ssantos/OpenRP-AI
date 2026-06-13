import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const OLLAMA_API = "http://127.0.0.1:11434/api/tags";

async function commandExists(command) {

    try {

        await execAsync(`which ${command}`);

        return true;

    }

    catch {

        return false;

    }

}


async function isOllamaRunning() {

    try {

        const { stdout } = await execAsync(

            "systemctl is-active ollama"

        );

        return stdout.trim() === "active";

    }

    catch {

        return false;

    }

}


async function checkOllamaAPI() {

    try {

        const response = await fetch(

            OLLAMA_API

        );

        return response.ok;

    }

    catch {

        return false;

    }

}


async function waitForOllama({

    timeout = 15000,

    interval = 1000

} = {}) {

    const start = Date.now();

    while (

        Date.now() - start < timeout

    ) {

        const ready =

            await checkOllamaAPI();

        if (ready) {

            return true;

        }

        await new Promise(

            resolve =>

                setTimeout(

                    resolve,

                    interval

                )

        );

    }

    return false;

}


export async function initOllama() {

    console.log(

        "\nChecking Ollama..."

    );


    //
    // Existe?
    //

    const exists =

        await commandExists(

            "ollama"

        );

    if (!exists) {

        console.error(

            `\n❌ Ollama was not found on this system.\n`

        );

        console.error(

            `Install it before starting the project.\n`

        );

        console.error(

            `Arch Linux:

            sudo pacman -S ollama

            or

            yay -S ollama
            `

        );

        process.exit(1);

    }

    console.log(

        "✓ Ollama installed."

    );


    //
    // Serviço ativo?
    //

    const running =

        await isOllamaRunning();

    if (!running) {

        console.log(

            "Ollama is not running."

        );

        console.log(

            "Trying to start service..."

        );


        try {

            await execAsync(

                "systemctl start ollama"

            );

        }

        catch (err) {

            console.error(

                "\n❌ Failed to start Ollama.\n"

            );

            console.error(

                err.stderr ||

                err.message

            );

            process.exit(1);

        }

    }

    else {

        console.log(

            "✓ Ollama service is active."

        );

    }


    //
    // Espera API responder
    //

    console.log(

        "Waiting for Ollama API..."

    );

    const ready =

        await waitForOllama({

            timeout: 15000,

            interval: 1000

        });

    if (!ready) {

        console.error(

            `\n❌ Ollama API is not responding.

            Expected:

            http://127.0.0.1:11434

            Try:

            journalctl -u ollama -xe
            `

        );

        process.exit(1);

    }

    console.log(

        "✓ Ollama API ready."

    );

}