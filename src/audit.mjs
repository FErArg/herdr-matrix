// Registro de auditoría de órdenes: una línea por orden, aceptada o rechazada.
// El texto de `enviar` nunca se registra. Los saltos de línea y caracteres de control se escapan.

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

function escapeField(value) {
  return String(value ?? "-")
    .replace(/\\/g, "\\\\")
    .replace(/[\u0000-\u001f\u007f]/g, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

export function auditLine({ at, sender, room, verb, pane, result }) {
  return [at, sender, room, verb, pane, result].map(escapeField).join("\t");
}

export function createAudit(path, now = () => new Date()) {
  return {
    async record(entry) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await appendFile(path, `${auditLine({ at: now().toISOString(), ...entry })}\n`, { mode: 0o600 });
    },
  };
}
