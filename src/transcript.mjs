// Lectura de la respuesta completa del agente desde su transcripción.
// El panel de Herdr solo muestra lo visible: una respuesta larga se pierde. La transcripción sí la guarda.
// Lector de Claude Code (JSONL por sesión). opencode se lee por su API (src/opencode-api.mjs).

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Un ID de sesión que llega de fuera se usa en un nombre de fichero: solo caracteres seguros.
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

// Claude Code guarda las transcripciones en ~/.claude/projects/<cwd con cada carácter que no sea letra o dígito cambiado por ->.
// Así "/private/var/folders/hx/784_4k/T/x.y" es "-private-var-folders-hx-784-4k-T-x-y".
export function transcriptPath(cwd, sessionId, home = homedir()) {
  if (!SESSION_ID.test(String(sessionId ?? ""))) throw new Error("id de sesión no válido");
  const folder = cwd.replace(/[^A-Za-z0-9]/g, "-");
  return join(home, ".claude", "projects", folder, `${sessionId}.jsonl`);
}

// Herramientas de Claude Code que cambian ficheros. Su `input.file_path` es la ruta editada.
const EDIT_TOOLS = ["Edit", "Write", "MultiEdit"];

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block?.type === "text").map((block) => block.text).join("");
}

function parseEntries(jsonl) {
  return jsonl
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// Devuelve el texto de respuesta que sigue al último mensaje del usuario igual a `sentText`.
// Un mensaje del usuario con texto real corta la respuesta; los resultados de herramientas no.
export function replyAfter(jsonl, sentText) {
  const entries = parseEntries(jsonl);

  let start = -1;
  entries.forEach((entry, index) => {
    if (entry.type === "user" && textOf(entry.message?.content).trim() === sentText.trim()) start = index;
  });
  if (start === -1) return null;

  const parts = [];
  for (const entry of entries.slice(start + 1)) {
    if (entry.type === "user" && typeof entry.message?.content === "string") break;
    if (entry.type === "assistant") {
      const text = textOf(entry.message?.content).trim();
      if (text) parts.push(text);
    }
  }
  return parts.length ? parts.join("\n\n") : null;
}

// Una acción de herramienta para `detalle`: nombre y el dato más útil (comando, ruta o patrón).
function actionOf(block) {
  const input = block.input ?? {};
  const detail = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.description ?? "";
  return { name: String(block.name ?? "herramienta"), detail: String(detail) };
}

// Claude Code guarda una orden con barra (p. ej. /commit-push) como mensaje de usuario con etiquetas.
// El pedido de la tarjeta es el nombre del comando y sus argumentos, sin etiquetas.
export function requestText(text) {
  const value = String(text ?? "");
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(value)?.[1];
  if (name === undefined) return value;
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(value)?.[1];
  return [name.trim(), args?.trim()].filter(Boolean).join(" ");
}

export function turnIn(jsonl) {
  const entries = parseEntries(jsonl);

  let start = -1;
  entries.forEach((entry, index) => {
    if (entry.type === "user" && typeof entry.message?.content === "string") start = index;
  });
  const turn = entries.slice(start + 1);

  const files = [];
  const problems = [];
  const actions = [];
  for (const entry of turn) {
    const blocks = Array.isArray(entry.message?.content) ? entry.message.content : [];
    for (const block of blocks) {
      if (entry.type === "assistant" && block?.type === "tool_use") actions.push(actionOf(block));
      if (entry.type === "assistant" && block?.type === "tool_use" && EDIT_TOOLS.includes(block.name)) {
        const path = block.input?.file_path;
        if (path && !files.includes(path)) files.push(path);
      }
      if (entry.type === "user" && block?.type === "tool_result" && block.is_error) {
        problems.push(textOf(block.content).trim() || "error de herramienta");
      }
    }
  }

  const replies = turn
    .filter((entry) => entry.type === "assistant")
    .map((entry) => textOf(entry.message?.content).trim())
    .filter(Boolean);

  return {
    request: start === -1 ? null : requestText(entries[start].message.content),
    reply: replies.length ? replies.join("\n\n") : null,
    files,
    problems,
    actions,
  };
}

export async function readTurn({ cwd, sessionId, read = (path) => readFile(path, "utf8") }) {
  return turnIn(await read(transcriptPath(cwd, sessionId)));
}

export async function readReply({ cwd, sessionId, sentText, read = (path) => readFile(path, "utf8") }) {
  const jsonl = await read(transcriptPath(cwd, sessionId));
  return replyAfter(jsonl, sentText);
}
