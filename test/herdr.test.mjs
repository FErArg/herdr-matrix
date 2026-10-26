import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeSocket, createHerdrClient } from "../src/herdr.mjs";

// Servidor de socket simulado con el mismo comportamiento que Herdr:
// cierra la conexión tras cada petición normal; mantiene abierta la de events.subscribe.
async function fakeHerdrServer({ onSubscribe } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "hm-sock-"));
  const path = join(dir, "herdr.sock");
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const request = JSON.parse(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        if (request.method === "events.subscribe") {
          socket.write(`${JSON.stringify({ id: request.id, result: { type: "subscription_started" } })}\n`);
          onSubscribe?.(socket);
          return;
        }
        if (request.method === "ping") {
          socket.end(`${JSON.stringify({ id: request.id, result: { type: "pong" } })}\n`);
        } else {
          socket.end(`${JSON.stringify({ id: request.id, error: { code: "unknown_method", message: "no" } })}\n`);
        }
        return;
      }
    });
  });
  await new Promise((resolve) => server.listen(path, resolve));
  return { path, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("request recibe la respuesta con el mismo id", async () => {
  const server = await fakeHerdrServer();
  const herdr = createHerdrClient(server.path);
  assert.deepEqual(await herdr.request("ping", {}), { type: "pong" });
  await server.close();
});

test("un error de Herdr se convierte en excepción con el código", async () => {
  const server = await fakeHerdrServer();
  const herdr = createHerdrClient(server.path);
  await assert.rejects(herdr.request("workspace.nope", {}), /unknown_method/);
  await server.close();
});

test("los eventos de la suscripción llegan a onEvent y events_lost a onLost", async () => {
  const events = [];
  const lost = [];
  const server = await fakeHerdrServer({
    onSubscribe: (socket) => {
      socket.write(`${JSON.stringify({ event: "pane_exited", data: { pane: "w1:p1" } })}\n`);
      socket.write(`${JSON.stringify({ event: "events_lost" })}\n`);
    },
  });
  const herdr = createHerdrClient(server.path);
  const subscription = await herdr.subscribe(["pane.exited"], {
    onEvent: (event) => events.push(event.event),
    onLost: (reason) => lost.push(reason),
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(events, ["pane_exited"]);
  assert.deepEqual(lost, ["events_lost"]);
  subscription.close();
  await server.close();
});

test("cerrar la suscripción no dispara onLost('closed')", async () => {
  const lost = [];
  const server = await fakeHerdrServer();
  const subscription = await createHerdrClient(server.path).subscribe(["pane.exited"], {
    onLost: (reason) => lost.push(reason),
  });
  subscription.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(lost, []);
  await server.close();
});

test("si el servidor cierra la suscripción, onLost('closed')", async () => {
  const lost = [];
  const server = await fakeHerdrServer({ onSubscribe: (socket) => socket.end() });
  await createHerdrClient(server.path).subscribe(["pane.exited"], {
    onLost: (reason) => lost.push(reason),
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(lost, ["closed"]);
  await server.close();
});

test("assertSafeSocket rechaza un fichero que no es socket", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hm-file-"));
  const file = join(dir, "not-a-socket");
  await writeFile(file, "x");
  await assert.rejects(assertSafeSocket(file), /no es un socket/);
});

test("assertSafeSocket acepta un socket del usuario actual", async () => {
  const server = await fakeHerdrServer();
  await assertSafeSocket(server.path);
  await server.close();
});
