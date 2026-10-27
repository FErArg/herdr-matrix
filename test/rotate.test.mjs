import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createRotator } from "../src/rotate.mjs";

async function withDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "hm-rotate-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const at = (iso) => () => new Date(iso);

test("rename: al superar el tamaño, archiva comprimido y deja el fichero vacío de nuevo", () => withDir(async (dir) => {
  const path = join(dir, "audit.log");
  await writeFile(path, "a".repeat(20));
  const rotator = createRotator({ path, mode: "rename", maxBytes: 10, now: at("2026-10-27T10:00:00") });
  assert.equal(await rotator.check(), true);
  await assert.rejects(stat(path), { code: "ENOENT" });
  const [archived] = (await readdir(dir)).filter((name) => name.endsWith(".gz"));
  assert.equal(archived, "audit.log.20261027-100000.gz");
  assert.equal(gunzipSync(await readFile(join(dir, archived))).toString(), "a".repeat(20));
}));

test("copy: copia el contenido, trunca el original y conserva el descriptor abierto", () => withDir(async (dir) => {
  const path = join(dir, "bridge.log");
  await writeFile(path, "b".repeat(30));
  const rotator = createRotator({ path, mode: "copy", maxBytes: 10, now: at("2026-10-27T10:00:00") });
  assert.equal(await rotator.check(), true);
  assert.equal((await stat(path)).size, 0);
  const [archived] = (await readdir(dir)).filter((name) => name.endsWith(".gz"));
  assert.equal(gunzipSync(await readFile(join(dir, archived))).toString(), "b".repeat(30));
}));

test("no rota un fichero pequeño del mismo día", () => withDir(async (dir) => {
  const path = join(dir, "audit.log");
  await writeFile(path, "pequeño");
  const rotator = createRotator({ path, maxBytes: 1024, now: at("2026-10-27T10:00:00") });
  assert.equal(await rotator.check(), false);
  assert.equal(await readFile(path, "utf8"), "pequeño");
}));

test("rota una vez al cambiar el día, aunque no llegue al tamaño máximo", () => withDir(async (dir) => {
  const path = join(dir, "audit.log");
  await writeFile(path, "hoy");
  let current = new Date("2026-10-27T23:59:00");
  const rotator = createRotator({ path, maxBytes: 1024, now: () => current });
  assert.equal(await rotator.check(), false);
  current = new Date("2026-10-28T00:01:00");
  await writeFile(path, "mañana aún sin rotar");
  assert.equal(await rotator.check(), true);
  assert.equal(await rotator.check(), false);
}));

test("un fichero que no existe no es un error", () => withDir(async (dir) => {
  const rotator = createRotator({ path: join(dir, "no-existe.log"), maxBytes: 10 });
  assert.equal(await rotator.check(), false);
}));
