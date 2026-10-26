import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock } from "../src/lock.mjs";

test("un segundo bloqueo con PID vivo falla", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "hm-lock-")), "bridge.lock");
  const release = await acquireLock(path);
  assert.equal(await readFile(path, "utf8"), String(process.pid));
  await assert.rejects(acquireLock(path), /ya hay una instancia/);
  await release();
});

test("un bloqueo huérfano (PID muerto) se reemplaza", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "hm-lock-")), "bridge.lock");
  await writeFile(path, "999999999");
  const release = await acquireLock(path);
  assert.equal(await readFile(path, "utf8"), String(process.pid));
  await release();
});
