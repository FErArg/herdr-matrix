// Arranque del bridge desde el [[startup]] de Herdr.
// `[[startup]]` es un inicializador de un solo disparo, así que el bridge se lanza como proceso
// desacoplado: el lanzador termina y el bridge sigue vivo. Su salida va a state/bridge.log (0600).
// Sin configuración o con el bridge ya en ejecución, no hace nada.

import { spawn as nodeSpawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { isLocked } from "./lock.mjs";
import { readJson } from "./store.mjs";

export async function startBridgeDetached({
  dirs,
  entry,
  log,
  spawnImpl = nodeSpawn,
  execPath = process.execPath,
}) {
  const config = await readJson(join(dirs.config, "config.json"));
  const session = await readJson(join(dirs.state, "session.json"));
  if (!config || !session) {
    log("herdr-matrix: sin configuración; ejecuta `node src/index.mjs setup` antes de arrancar.");
    return "unconfigured";
  }
  if (await isLocked(join(dirs.state, "bridge.lock"))) {
    log("herdr-matrix: el bridge ya está en ejecución.");
    return "running";
  }

  await mkdir(dirs.state, { recursive: true, mode: 0o700 });
  const logFile = await open(join(dirs.state, "bridge.log"), "a", 0o600);
  try {
    const child = spawnImpl(execPath, [entry, "run"], {
      detached: true,
      stdio: ["ignore", logFile.fd, logFile.fd],
      env: process.env,
    });
    child.on("error", (error) => log(`herdr-matrix: no se pudo lanzar el bridge: ${error.message}`));
    child.unref();
  } finally {
    await logFile.close();
  }
  log("herdr-matrix: bridge arrancado en segundo plano.");
  return "started";
}
