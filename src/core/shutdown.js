let _webServer = null;
let _ollamaProcess = null;

export function registerWebServer(server) {
  _webServer = server;
}

export function registerOllamaProcess(proc) {
  _ollamaProcess = proc;
}

export async function shutdown(code = 0) {
  console.log("Graceful shutdown starting...");

  try {
    if (_webServer) {
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

    if (_ollamaProcess) {
      console.log("Stopping Ollama child process...");
      try {
        _ollamaProcess.kill("SIGTERM");
      } catch (e) {
        console.warn("Failed to SIGTERM ollama process:", e.message || e);
      }
      // wait briefly
      await new Promise((r) => setTimeout(r, 1000));
      if (!_ollamaProcess.killed) {
        try {
          _ollamaProcess.kill("SIGKILL");
        } catch (e) {
          console.warn("Failed to SIGKILL ollama process:", e.message || e);
        }
      }
    }

    console.log("Shutdown finished.");
  } catch (err) {
    console.error("Error during shutdown:", err);
  }
}
