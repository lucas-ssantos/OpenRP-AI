import { spawnSync } from "child_process";

let _webServer = null;
let _ollamaProcess = null;
let _saveDB = null;

export function registerWebServer(server) { _webServer = server;}

export function registerOllamaProcess(proc) { _ollamaProcess = proc;}

export function registerSaveDB(saveFn) { _saveDB = saveFn;}

export async function shutdown(code = 0)
{
    console.log("Graceful shutdown starting...");

    try
    {
        if (_webServer) 
        {
            console.log("Closing web server...");
            await new Promise((resolve) => {
                const timer = setTimeout(() => {
                    console.warn("Web server close timed out");
                    resolve();
                }, 5000);

                _webServer.close((err) => {
                    clearTimeout(timer);
                    if (err) console.error("Error closing web server:", err);
                    else console.log("Web server closed");
                    resolve();
                });
            });
        }

        if (_ollamaProcess) 
        {
            console.log("Stopping Ollama child process...");
            try 
            {
                _ollamaProcess.kill("SIGTERM");
            }
            catch (e)
            {
                console.warn("Failed to SIGTERM ollama process:", e.message || e);
            }

            // wait briefly
            await new Promise((r) => setTimeout(r, 1000));
            if (!_ollamaProcess.killed) 
            {
                try
                {
                    _ollamaProcess.kill("SIGKILL");
                }
                catch (e)
                {
                    console.warn("Failed to SIGKILL ollama process:", e.message || e);
                }
            }
        }
        else
        {
            // If no child process was spawned, Ollama may be managed by systemd.
            try
            {
                const hasSystemctl = spawnSync("which", ["systemctl"]).status === 0;
                if(hasSystemctl)
                {
                    const isActive = spawnSync("systemctl", ["is-active", "--quiet", "ollama"]);
                    if (isActive.status === 0)
                    {
                        console.log("Stopping systemd-managed Ollama service...");
                        const stop = spawnSync("systemctl", ["stop", "ollama"]);
                        if (stop.status === 0)
                        {
                            console.log("Ollama systemd service stopped");
                        }
                        else
                        {
                            console.warn("Failed to stop Ollama via systemctl — you may need sudo.\nRun: sudo systemctl stop ollama");
                        }
                    }
                }
            }
            catch (e)
            {
                console.warn("Error while attempting to stop systemd Ollama service:", e.message || e);
            }
        }

        // Save database before shutdown
        if (_saveDB) {
            console.log("Saving database...");
            try {
                _saveDB();
                console.log("Database saved successfully");
            } catch (e) {
                console.error("Error saving database:", e);
            }
        }

    console.log("Shutdown finished.");
    }
    catch (err)
    {
        console.error("Error during shutdown:", err);
    }
}
