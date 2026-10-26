#!/usr/bin/env node
// Punto de entrada del plugin.
// Uso: node src/index.mjs setup [--logout]  |  node src/index.mjs run  |  node src/index.mjs verify

import { ask, askHidden } from "./prompt.mjs";
// bridge.mjs carga bot-client y, con él, fake-indexeddb: debe importarse antes que verify.mjs.
import { runBridge } from "./bridge.mjs";
import { runVerify } from "./verify.mjs";
import { superviseBridge } from "./supervisor.mjs";
import { runLogout, runSetup } from "./setup.mjs";
import { startBridgeDetached } from "./startup.mjs";
import { configDir, stateDir } from "./store.mjs";
import { fileURLToPath } from "node:url";

const USAGE = "Uso: node src/index.mjs setup [--logout] | node src/index.mjs run | node src/index.mjs verify | node src/index.mjs startup";

const io = {
  ask,
  askHidden,
  log: (message) => console.log(message),
};

async function main(argv) {
  const [command, ...flags] = argv;
  const dirs = { config: configDir(), state: stateDir() };

  if (command === "setup") {
    if (flags.includes("--logout")) {
      await runLogout({ io, fetchImpl: fetch, dirs });
    } else {
      await runSetup({ io, fetchImpl: fetch, dirs });
    }
    return 0;
  }
  if (command === "run") {
    const log = (message) => console.log(message);
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      await superviseBridge({
        run: () => runBridge({ dirs, log }),
        log,
        signal: controller.signal,
      });
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
    return 0;
  }
  if (command === "verify") {
    await runVerify({ io, dirs });
    return 0;
  }
  if (command === "startup") {
    // Lo invoca el [[startup]] de Herdr. Termina de inmediato; el bridge queda en segundo plano.
    await startBridgeDetached({
      dirs,
      entry: fileURLToPath(import.meta.url),
      log: (message) => console.log(message),
    });
    return 0;
  }
  console.error(USAGE);
  return 2;
}

// El SDK rechaza operaciones pendientes al parar el cliente. Es esperado tras el stop, no un fallo.
process.on("unhandledRejection", (reason) => {
  if (reason?.name === "ClientStoppedError") return;
  console.error(`Error: ${reason?.message ?? reason}`);
  process.exit(1);
});

// El SDK deja timers activos al parar; se sale explícitamente al terminar.
main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  },
);
