import { stopTailscale } from "../services/tailscale.init.js";

let _webServer = null;
let _stopLlamaServer = null;
let _saveDB = null;
let _stopTailscale = false;

export function registerWebServer(server) { _webServer = server; }
export function registerLlamaServerStop(stopFn) { _stopLlamaServer = stopFn; }
export function registerSaveDB(saveFn) { _saveDB = saveFn; }
export function registerTailscale() { _stopTailscale = true; }

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

        if (_stopLlamaServer) await _stopLlamaServer();

        // Save database before shutdown
        if(_saveDB)
        {
            console.log("Saving database...");
            try
            {
                _saveDB();
                console.log("Database saved successfully");
            }
            catch (e)
            {
                console.error("Error saving database:", e);
            }
        }

        if (_stopTailscale)
        {
            try
            {
                stopTailscale();
            }
            catch (e)
            {
                console.warn("Error while attempting to stop systemd Tailscale service:", e.message || e);
            }
        }

    console.log("Shutdown finished.");
    }
    catch (err)
    {
        console.error("Error during shutdown:", err);
    }
}
