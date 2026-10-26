import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { startBridgeDetached } from "../src/startup.mjs";

async function setup({ config = true, session = true, lock } = {}) {
  const root = await mkdtemp(join(tmpdir(), "hm-startup-"));
  const dirs = { config: join(root, "config"), state: join(root, "state") };
  await mkdir(dirs.config, { recursive: true });
  await mkdir(dirs.state, { recursive: true });
  if (config) await writeFile(join(dirs.config, "config.json"), "{}");
  if (session) await writeFile(join(dirs.state, "session.json"), "{}");
  if (lock !== undefined) await writeFile(join(dirs.state, "bridge.lock"), String(lock));
  return dirs;
}

function fakeSpawn(calls) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.unref = () => calls.push("unref");
    return child;
  };
}

test("sin configuración no lanza nada y lo indica", async () => {
  const dirs = await setup({ config: false });
  const calls = [];
  const lines = [];
  const result = await startBridgeDetached({
    dirs, entry: "/x/src/index.mjs", log: (m) => lines.push(m), spawnImpl: fakeSpawn(calls),
  });
  assert.equal(result, "unconfigured");
  assert.equal(calls.length, 0);
  assert.match(lines.join("\n"), /setup/);
});

test("con el bridge ya en ejecución no lanza otro", async () => {
  const dirs = await setup({ lock: process.pid });
  const calls = [];
  const result = await startBridgeDetached({ dirs, entry: "/x/src/index.mjs", log: () => {}, spawnImpl: fakeSpawn(calls) });
  assert.equal(result, "running");
  assert.equal(calls.length, 0);
});

test("lanza `run` desacoplado, con salida a bridge.log y sin esperar al hijo", async () => {
  const dirs = await setup({ lock: 999999999 }); // bloqueo huérfano: no cuenta como ejecución
  const calls = [];
  const result = await startBridgeDetached({
    dirs, entry: "/x/src/index.mjs", log: () => {}, spawnImpl: fakeSpawn(calls), execPath: "/usr/bin/node",
  });
  assert.equal(result, "started");
  const spawned = calls[0];
  assert.equal(spawned.command, "/usr/bin/node");
  assert.deepEqual(spawned.args, ["/x/src/index.mjs", "run"]);
  assert.equal(spawned.options.detached, true);
  assert.equal(spawned.options.stdio[0], "ignore");
  assert.equal(calls[1], "unref");
  const mode = (await stat(join(dirs.state, "bridge.log"))).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("un fallo al lanzar se registra en el log sin tumbar el lanzador", async () => {
  const dirs = await setup();
  const lines = [];
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => child.emit("error", new Error("ENOENT")));
    return child;
  };
  await startBridgeDetached({ dirs, entry: "/x/src/index.mjs", log: (m) => lines.push(m), spawnImpl });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(lines.join("\n"), /no se pudo lanzar el bridge: ENOENT/);
});
