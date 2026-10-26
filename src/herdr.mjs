// Cliente del socket JSON de Herdr.
// Herdr cierra la conexión tras cada petición normal; solo la suscripción la mantiene abierta.
// Por eso: una conexión por petición, y una conexión persistente para eventos.
// Los eventos son señales para re-leer estado; no se reproducen (ver docs/02-herdr-socket-api.md).

import net from "node:net";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_LINE_BYTES = 1_000_000;

export function defaultSocketPath() {
  return process.env.HERDR_SOCKET_PATH || join(homedir(), ".config", "herdr", "herdr.sock");
}

// Solo se conecta a un socket del usuario actual; un fichero normal o de otro usuario se rechaza.
export async function assertSafeSocket(path) {
  const info = await stat(path);
  if (!info.isSocket()) {
    throw new Error("la ruta de Herdr no es un socket");
  }
  if (info.uid !== process.getuid()) {
    throw new Error("el socket de Herdr no pertenece al usuario actual");
  }
}

// Lee líneas JSON de un socket y las entrega a onLine. Limita el tamaño del búfer.
function lineReader(socket, onLine, onError) {
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    if (buffer.length > MAX_LINE_BYTES) {
      socket.destroy(new Error("respuesta de Herdr demasiado grande"));
      return;
    }
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim()) {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue; // línea no JSON: se ignora sin registrar su contenido
        }
        onLine(message);
      }
    }
  });
  socket.on("error", onError);
}

// Petición de una sola vez: abre el socket, envía, espera la respuesta con el mismo id y cierra.
// timeoutMs: las peticiones con `wait` (agent.prompt) pueden tardar lo que tarde el agente.
export function callHerdr(path, method, params = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const id = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const socket = net.createConnection(path);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Herdr no respondió a ${method}`));
    }, timeoutMs);
    const finish = (fn, value) => {
      clearTimeout(timer);
      socket.destroy();
      fn(value);
    };
    socket.on("connect", () => socket.write(`${JSON.stringify({ id, method, params })}\n`));
    lineReader(socket, (message) => {
      if (message.id !== id) return;
      if (message.error) {
        finish(reject, new Error(`Herdr ${message.error.code}: ${message.error.message}`));
      } else {
        finish(resolve, message.result);
      }
    }, (error) => finish(reject, error));
  });
}

// Suscripción persistente. Resuelve cuando Herdr confirma la suscripción.
// onEvent recibe cada evento; onLost("closed") se llama si la conexión se cierra.
export function openSubscription(path, types, { onEvent = () => {}, onLost = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const id = `sub-${process.pid}-${Date.now()}`;
    const socket = net.createConnection(path);
    let confirmed = false;
    let closedByUs = false;

    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ id, method: "events.subscribe", params: { subscriptions: types.map((type) => ({ type })) } })}\n`);
    });

    lineReader(socket, (message) => {
      if (!confirmed) {
        if (message.id !== id) return;
        if (message.error) {
          socket.destroy();
          reject(new Error(`Herdr ${message.error.code}: ${message.error.message}`));
          return;
        }
        confirmed = true;
        resolve(handle);
        return;
      }
      if (message.event === "events_lost" || message.error?.code === "events_lost") {
        onLost("events_lost");
      } else if (message.event !== undefined) {
        onEvent(message);
      }
    }, (error) => {
      if (!confirmed) reject(error);
    });

    socket.on("close", () => {
      if (!confirmed) {
        reject(new Error("conexión de suscripción cerrada antes de confirmar"));
      } else if (!closedByUs) {
        onLost("closed");
      }
    });

    const handle = {
      close() {
        closedByUs = true;
        socket.destroy();
      },
    };
  });
}

export function createHerdrClient(path) {
  return {
    request: (method, params, timeoutMs) => callHerdr(path, method, params, timeoutMs),
    subscribe: (types, handlers) => openSubscription(path, types, handlers),
  };
}
