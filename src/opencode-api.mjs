// Transporte de opencode por la API de su servicio de fondo (`opencode api`). La TUI y el chat
// comparten sesiones: el mensaje entra en la misma sesión que ve la TUI.
// `auto` aprueba los permisos pedidos durante el turno (config: chat.opencode_auto); sin `auto`,
// la petición de permiso queda pendiente y el turno termina por tiempo con un aviso.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OPENCODE_BIN = process.env.OPENCODE_BIN || "opencode";
const PROMPT_TIMEOUT_MS = 3 * 60_000;
const CALL_TIMEOUT_MS = 30_000;
const PERMISSION_POLL_MS = 2_000;
const MAX_BUFFER = 16 * 1024 * 1024;

// Una llamada a la API. Devuelve el campo `data` de la respuesta.
export async function callApi({ method, path, body, exec = execFileAsync, bin = OPENCODE_BIN, timeoutMs = CALL_TIMEOUT_MS }) {
  const args = ["api", method, path];
  if (body !== undefined) args.push("-d", JSON.stringify(body));
  const { stdout } = await exec(bin, args, { timeout: timeoutMs, maxBuffer: MAX_BUFFER });
  // Las respuestas sin contenido (204) llegan como salida vacía.
  if (!String(stdout).trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`respuesta no válida de opencode: ${String(stdout).slice(0, 120)}`);
  }
  return parsed.data ?? null;
}

// Respuesta del último mensaje enviado: texto de los mensajes del asistente posteriores al pedido.
// `messages` viene del más reciente al más antiguo. Devuelve null si el pedido aún no tiene respuesta.
export function replyAfter(messages, sentText) {
  const list = Array.isArray(messages) ? messages : [];
  const index = list.findIndex((message) => message.type === "user" && (message.text ?? message.payload?.text) === sentText);
  if (index === -1) return null;
  const texts = list
    .slice(0, index)
    .filter((message) => message.type === "assistant")
    .reverse()
    .flatMap((message) => (message.content ?? []).filter((part) => part.type === "text").map((part) => part.text.trim()))
    .filter(Boolean);
  return texts.length ? texts.join("\n\n") : null;
}

export async function readOpencodeReply({ sessionId, sentText, exec, bin }) {
  const messages = await callApi({ method: "get", path: `/api/session/${sessionId}/message`, exec, bin });
  return replyAfter(messages, sentText);
}

// Aprueba las peticiones de permiso de la sesión (auto), o avisa una vez de cada una para que el dueño decida.
async function answerPermissions({ sessionId, auto, onPermission, asked, exec, bin }) {
  const requests = (await callApi({ method: "get", path: `/api/session/${sessionId}/permission`, exec, bin })) ?? [];
  for (const request of requests) {
    if (!auto) {
      if (!asked.has(request.id)) {
        asked.add(request.id);
        onPermission?.(request);
      }
      continue;
    }
    await replyOpencodePermission({ sessionId, requestId: request.id, decision: "once", exec, bin });
  }
  return requests.length;
}

// Envía un mensaje y espera a que el turno termine. Con permisos sin aprobar y sin `auto`, el turno
// no progresa y se corta por tiempo.
export async function sendAndWait({ sessionId, text, auto, onPermission, exec, bin, timeoutMs = PROMPT_TIMEOUT_MS, pollMs = PERMISSION_POLL_MS, now = () => Date.now() }) {
  const asked = new Set();
  await callApi({ method: "post", path: `/api/session/${sessionId}/prompt`, body: { text }, exec, bin });
  const deadline = now() + timeoutMs;
  let finished = false;
  const waiting = callApi({ method: "post", path: `/api/experimental/session/${sessionId}/wait`, timeoutMs: timeoutMs + 30_000, exec, bin })
    .then(() => { finished = true; }, (error) => { finished = true; throw error; });
  waiting.catch(() => {});
  while (!finished) {
    if (now() > deadline) throw new Error("opencode no respondió a tiempo");
    await answerPermissions({ sessionId, auto, onPermission, asked, exec, bin });
    await Promise.race([waiting, new Promise((resolve) => setTimeout(resolve, pollMs))]);
  }
  await waiting;
}

// Envía un mensaje a una sesión de opencode (la crea si no hay). Devuelve el ID de sesión.
// cwd: directorio del proyecto del workspace. opencode guarda sus sesiones por proyecto, así que
// usar otro directorio mezcla proyectos.
export async function runOpencode({ sessionId, text, cwd, auto = true, onPermission, exec, bin, timeoutMs, pollMs, now }) {
  if (!cwd) throw new Error("falta el directorio del proyecto del workspace");
  let id = sessionId;
  if (!id) {
    const created = await callApi({ method: "post", path: "/api/session", body: { location: { directory: cwd } }, exec, bin });
    id = created.id;
  }
  await sendAndWait({ sessionId: id, text, auto, onPermission, exec, bin, timeoutMs, pollMs, now });
  return id;
}

// Herramientas de opencode que cambian ficheros (la ruta va en `input.path`).
const EDIT_TOOLS = ["write", "edit", "patch"];

function textOfParts(parts) {
  return (Array.isArray(parts) ? parts : []).filter((part) => part.type === "text").map((part) => part.text.trim()).filter(Boolean).join("\n\n");
}

// Una acción de herramienta para `detalle`: nombre y el dato más útil (comando, ruta o patrón).
function actionOfTool(part) {
  const input = part.state?.input ?? {};
  const detail = input.command ?? input.path ?? input.pattern ?? input.url ?? input.description ?? input.query ?? "";
  return { name: String(part.name ?? "herramienta"), detail: String(detail) };
}

// Turno de opencode desde la API, con la misma forma que `turnIn` de Claude Code.
// `messages` viene del más reciente al más antiguo, como devuelve `opencode api get /api/session/<id>/message`.
export function opencodeApiTurn(messages) {
  const ordered = [...(Array.isArray(messages) ? messages : [])].reverse();

  let start = -1;
  ordered.forEach((message, index) => {
    if (message.type === "user") start = index;
  });
  const request = start === -1 ? null : (ordered[start].text ?? ordered[start].payload?.text ?? null);

  const files = [];
  const problems = [];
  const actions = [];
  const replies = [];
  for (const message of ordered.slice(start + 1)) {
    if (message.type !== "assistant") continue;
    const text = textOfParts(message.content);
    if (text) replies.push(text);
    for (const part of message.content ?? []) {
      if (part.type !== "tool") continue;
      actions.push(actionOfTool(part));
      const path = part.state?.input?.path;
      if (EDIT_TOOLS.includes(part.name) && path && !files.includes(path)) files.push(path);
      if (part.state?.status === "error") {
        const error = typeof part.state.error === "string" ? part.state.error : textOfParts(part.state.content);
        problems.push(error || `error de ${part.name}`);
      }
    }
  }

  return { request, reply: replies.length ? replies.join("\n\n") : null, files, problems, actions };
}

export async function readOpencodeApiTurn({ sessionId, exec, bin }) {
  const messages = await callApi({ method: "get", path: `/api/session/${sessionId}/message`, exec, bin });
  return opencodeApiTurn(messages ?? []);
}

// Decisiones que el dueño puede tomar desde la sala. `always` no se ofrece: no deja aprobaciones guardadas.
const CHAT_DECISIONS = ["once", "reject"];

// Responde a una petición de permiso de la sesión (una vez o rechazar).
export async function replyOpencodePermission({ sessionId, requestId, decision, exec, bin }) {
  if (!CHAT_DECISIONS.includes(decision)) throw new Error(`decisión no permitida: ${decision}`);
  await callApi({ method: "post", path: `/api/session/${sessionId}/permission/${requestId}/reply`, body: { decision }, exec, bin });
}

// Interrumpe el turno en curso de la sesión (equivale a Escape en la TUI).
export async function interruptOpencode({ sessionId, exec, bin }) {
  await callApi({ method: "post", path: `/api/session/${sessionId}/interrupt`, exec, bin });
}

// Texto corto de una petición de permiso para la sala: la acción y los recursos afectados.
export function describePermission(request) {
  const resources = Array.isArray(request?.resources) ? request.resources.filter(Boolean) : [];
  const text = [request?.action ?? "permiso", resources.join(", ")].filter(Boolean).join(": ");
  return text.slice(0, 300);
}
