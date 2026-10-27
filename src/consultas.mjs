// Consultas de la tarjeta de tarea (plan 20261027-0755, fase 3): detalle, ver, cambios y cancelar.
// Solo existen con sesión de chat abierta en la sala. Sin sesión se ignoran: ni responden ni revelan nada.
// Lógica pura salvo `gitState`, que recibe el ejecutor para poder probarla.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { redact, safe } from "./card.mjs";
import { chunkText } from "./chat.mjs";
import { foldWord, normalizeBody } from "./commands.mjs";

const execFileAsync = promisify(execFile);

export const CONSULTA_VERBS = ["detalle", "ver", "cambios", "cancelar"];
export const DETALLE_DEFAULT = 10;
export const DETALLE_MAX = 30;
export const ACTION_CHARS = 120;
export const CAMBIOS_LINES = 40;
export const GIT_TIMEOUT_MS = 5_000;

// Orden de consulta, o null. Solo cuenta si el mensaje es la orden sola ("ver", "cambios", "cancelar")
// o "detalle" con un número opcional. Cualquier otro texto es para el agente.
export function consultaOf(body) {
  const words = foldWord(normalizeBody(body)).split(/\s+/);
  const verb = words[0];
  if (!CONSULTA_VERBS.includes(verb)) return null;
  if (verb === "detalle") {
    if (words.length > 2) return null;
    if (words.length === 1) return { verb, n: DETALLE_DEFAULT };
    const n = Number(words[1]);
    return { verb, n: Number.isInteger(n) && n > 0 ? Math.min(n, DETALLE_MAX) : null };
  }
  return words.length === 1 ? { verb, n: null } : null;
}

// Últimas n acciones de herramienta del turno. `actions` null: opencode no las expone.
export function formatDetalle(actions, n) {
  if (actions === null) return "detalle no disponible para este agente.";
  if (!actions.length) return "no hay acciones en el turno actual.";
  const shown = actions.slice(-n);
  const lines = shown.map((action, index) => {
    const detail = action.detail ? `: ${safe(action.detail, ACTION_CHARS)}` : "";
    return `${index + 1}. ${safe(action.name, 40)}${detail}`;
  });
  return [`Últimas ${shown.length} acciones:`, ...lines].join("\n");
}

// Respuesta completa del turno, troceada para que cada mensaje quepa en Matrix.
export function formatVer(turn) {
  if (!turn?.reply) return ["no hay respuesta en el turno actual."];
  return chunkText(redact(turn.reply));
}

// Ejecutor por defecto: lee la salida de un comando, con límite de tiempo y de tamaño.
export async function runCommand(command, args) {
  const { stdout } = await execFileAsync(command, args, { timeout: GIT_TIMEOUT_MS, maxBuffer: 256 * 1024 });
  return stdout;
}

// Estado de git del proyecto: ficheros sin confirmar y resumen de cambios. Lanza si no es un repositorio.
export async function gitState(cwd, run = runCommand) {
  const status = await run("git", ["-C", cwd, "status", "--short"]);
  const stat = await run("git", ["-C", cwd, "diff", "--stat"]);
  return { status, stat };
}

export function formatCambios({ status, stat }) {
  const statusLines = status.split("\n").filter(Boolean);
  if (!statusLines.length) return "no hay cambios sin confirmar en el proyecto.";
  const shown = statusLines.slice(0, CAMBIOS_LINES).map((line) => redact(line));
  const rest = statusLines.length - shown.length;
  const summary = stat.trim().split("\n").at(-1)?.trim() ?? "";
  return [
    `Cambios sin confirmar (${statusLines.length}):`,
    ...shown,
    ...(rest > 0 ? [`… y ${rest} más`] : []),
    ...(summary ? [redact(summary)] : []),
  ].join("\n");
}

export const CANCEL_KEY = "esc";