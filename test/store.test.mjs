import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJson, writeJsonSecure } from "../src/store.mjs";

test("writeJsonSecure escribe con permisos 0600 y readJson lo lee", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hm-store-"));
  const path = join(dir, "session.json");
  await writeJsonSecure(path, { access_token: "x" });

  const mode = (await stat(path)).mode & 0o777;
  assert.equal(mode, 0o600);
  assert.deepEqual(await readJson(path), { access_token: "x" });
  assert.match(await readFile(path, "utf8"), /"access_token"/);
});

test("readJson devuelve null si el fichero no existe", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hm-store-"));
  assert.equal(await readJson(join(dir, "missing.json")), null);
});
