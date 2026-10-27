// Rotación de registros: al pasar de 10 MB o al cambiar el día, el fichero se archiva con fecha y hora
// y la copia archivada se comprime con gzip. Dos modos:
// - "rename": mueve el fichero (audit.log se abre en cada escritura, así que la siguiente línea crea uno nuevo).
// - "copy": copia y trunca (bridge.log tiene un descriptor abierto por el lanzador, que sigue escribiendo al final).

import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, rename, stat, truncate, unlink } from "node:fs/promises";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

export const MAX_LOG_BYTES = 10 * 1024 * 1024;

const pad = (value) => String(value).padStart(2, "0");

function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function stampOf(date) {
  return `${dayKey(date).replaceAll("-", "")}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function compress(path) {
  await pipeline(createReadStream(path), createGzip(), createWriteStream(`${path}.gz`, { mode: 0o600 }));
  await unlink(path);
}

export function createRotator({ path, mode = "rename", maxBytes = MAX_LOG_BYTES, now = () => new Date() }) {
  let day = null;

  return {
    // Devuelve true si rotó. Un fichero que no existe no es un error.
    async check() {
      let info;
      try {
        info = await stat(path);
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
      const current = now();
      const today = dayKey(current);
      // La primera vez, el día del último registro: un fichero de ayer se archiva al arrancar.
      if (day === null) day = dayKey(info.mtime);
      if (info.size === 0 || (info.size < maxBytes && day === today)) {
        day = today;
        return false;
      }
      const archived = `${path}.${stampOf(current)}`;
      if (mode === "rename") {
        await rename(path, archived);
      } else {
        await copyFile(path, archived);
        await truncate(path, 0);
      }
      await compress(archived);
      day = today;
      return true;
    },
  };
}
