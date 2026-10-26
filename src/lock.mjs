// Bloqueo de instancia única. Un fichero con el PID; si el PID ya no existe, el bloqueo es huérfano.

import { open, readFile, rm } from "node:fs/promises";

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// true si el bloqueo existe y su PID sigue vivo. No modifica el fichero.
export async function isLocked(path) {
  const pid = Number.parseInt(await readFile(path, "utf8").catch(() => ""), 10);
  return Number.isInteger(pid) && processAlive(pid);
}

export async function acquireLock(path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.writeFile(String(process.pid));
      await handle.close();
      return async () => rm(path, { force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = Number.parseInt(await readFile(path, "utf8").catch(() => ""), 10);
      if (Number.isInteger(pid) && processAlive(pid)) {
        throw new Error(`ya hay una instancia del bridge en ejecución (pid ${pid})`);
      }
      await rm(path, { force: true }); // bloqueo huérfano: se elimina y se reintenta
    }
  }
  throw new Error("no se pudo adquirir el bloqueo de instancia");
}
