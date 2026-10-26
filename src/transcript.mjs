// Lectura de la respuesta completa del agente desde su transcripción.
// El panel de Herdr solo muestra lo visible: una respuesta larga se pierde. La transcripción sí la guarda.
// Lectores: Claude Code (JSONL por sesión) y opencode (ficheros JSON en su storage).

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Claude Code guarda las transcripciones en ~/.claude/projects/<cwd con / y . cambiados por ->.
export function transcriptPath(cwd, sessionId, home = homedir()) {
  const folder = cwd.replace(/[/.]/g, "-");
  return join(home, ".claude", "projects", folder, `${sessionId}.jsonl`);
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block?.type === "text").map((block) => block.text).join("");
}

// Devuelve el texto de respuesta que sigue al último mensaje del usuario igual a `sentText`.
// Un mensaje del usuario con texto real corta la respuesta; los resultados de herramientas no.
export function replyAfter(jsonl, sentText) {
  const entries = jsonl
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

export async function readReply({ cwd, sessionId, sentText, read = (path) => readFile(path, "utf8") }) {
  const jsonl = await read(transcriptPath(cwd, sessionId));
  return replyAfter(jsonl, sentText);
}

// opencode guarda las sesiones en una base SQLite (opencode.db): tablas message y part, con JSON en `data`.
// La respuesta son las partes `text` de los mensajes del asistente que siguen al mensaje enviado.
export function opencodeDbPath(home = homedir()) {
  return join(process.env.XDG_DATA_HOME || join(home, ".local", "share"), "opencode", "opencode.db");
}

// `messages`: [{ id, role, created, parts: [{ type, text }] }]. Devuelve la respuesta o null.
export function opencodeReplyAfter(messages, sentText) {
  const ordered = [...messages].sort((a, b) => (a.created ?? 0) - (b.created ?? 0) || a.id.localeCompare(b.id));
  const textOf = (message) => message.parts.filter((part) => part.type === "text").map((part) => part.text).join("").trim();

  let start = -1;
  ordered.forEach((message, index) => {
    if (message.role === "user" && textOf(message) === sentText.trim()) start = index;
  });
  if (start === -1) return null;

  const replies = [];
  for (const message of ordered.slice(start + 1)) {
    if (message.role === "user") break;
    const text = textOf(message);
    if (text) replies.push(text);
  }
  return replies.length ? replies.join("\n\n") : null;
}

// Quita las comillas que envuelven el texto del usuario en session_message.
function unquote(text) {
  const value = String(text ?? "");
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

// Lee la sesión desde la base. Versiones recientes de opencode (y `opencode run`) guardan en session_message;
// las anteriores, en message y part. `node:sqlite` es experimental en Node 22: solo se carga al usarlo.
export async function readOpencodeReply({ sessionId, sentText, dbPath = opencodeDbPath() }) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const turns = db
      .prepare("SELECT seq, type, time_created, data FROM session_message WHERE session_id = ? AND type IN ('user', 'assistant') ORDER BY seq")
      .all(sessionId);
    if (turns.length) {
      const messages = turns.map((row) => {
        const data = JSON.parse(row.data);
        const parts = row.type === "user"
          ? [{ type: "text", text: unquote(data.text) }]
          : (data.content ?? []).filter((block) => block.type === "text").map((block) => ({ type: "text", text: block.text }));
        return { id: String(row.seq), role: row.type, created: row.time_created, parts };
      });
      return opencodeReplyAfter(messages, sentText);
    }

    const rows = db.prepare("SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id").all(sessionId);
    const partsOf = db.prepare("SELECT data FROM part WHERE message_id = ? ORDER BY time_created, id");
    const messages = rows.map((row) => {
      const data = JSON.parse(row.data);
      const parts = partsOf.all(row.id).map((part) => JSON.parse(part.data));
      return { id: row.id, role: data.role, created: row.time_created, parts };
    });
    return opencodeReplyAfter(messages, sentText);
  } finally {
    db.close();
  }
}
