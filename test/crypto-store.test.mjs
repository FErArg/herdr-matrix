import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dumpDatabases,
  keyPath,
  openStore,
  restoreDatabases,
  restoreStore,
  saveStore,
  sealStore,
  storePath,
} from "../src/crypto-store.mjs";

const PREFIX = "hm-test";
const NAME = `${PREFIX}::roundtrip`;

test("sealStore y openStore recuperan el volcado", () => {
  const key = randomBytes(32);
  const plain = Buffer.from("volcado de prueba");
  const sealed = sealStore(key, plain);
  assert.notDeepEqual(sealed.subarray(4), plain);
  assert.deepEqual(openStore(key, sealed), plain);
});

test("openStore rechaza un fichero alterado o con otra clave", () => {
  const key = randomBytes(32);
  const sealed = sealStore(key, Buffer.from("datos"));
  const tampered = Buffer.from(sealed);
  tampered[tampered.length - 1] ^= 0x01;
  assert.throws(() => openStore(key, tampered));
  assert.throws(() => openStore(randomBytes(32), sealed));
});

test("openStore acepta el formato anterior sin cifrar", () => {
  const legacy = Buffer.from([0xff, 0x0f, 1, 2, 3]);
  assert.deepEqual(openStore(null, legacy), legacy);
});

test("saveStore cifra el almacén y crea store.key con 0600; restoreStore sin clave falla", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hm-crypto-"));
  try {
    await saveStore(dir, PREFIX);
    const sealed = await readFile(storePath(dir));
    assert.equal(sealed.subarray(0, 4).toString(), "HMS1");
    assert.equal((await stat(keyPath(dir))).mode & 0o777, 0o600);
    await restoreStore(dir);

    await rm(keyPath(dir));
    await assert.rejects(restoreStore(dir), /falta store\.key/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("restoreStore acepta un almacén anterior sin cifrar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hm-crypto-"));
  try {
    await writeFile(storePath(dir), await dumpDatabases("hm-no-existe"));
    await restoreStore(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

test("dump y restore conservan stores, índices, claves y valores binarios", async () => {
  const opened = await new Promise((resolve, reject) => {
    const open = indexedDB.open(NAME, 1);
    open.onupgradeneeded = () => {
      const plain = open.result.createObjectStore("plain");
      const inline = open.result.createObjectStore("inline", { keyPath: "id" });
      inline.createIndex("by_room", "room", { unique: false });
      plain.put(new Uint8Array([1, 2, 3]), "account");
      inline.put({ id: "s1", room: "!r", key: new Uint8Array([9]) });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  opened.close();

  const bytes = await dumpDatabases(PREFIX);
  await req(indexedDB.deleteDatabase(NAME));
  await restoreDatabases(bytes);

  const db = await req(indexedDB.open(NAME));
  const tx = db.transaction(["plain", "inline"], "readonly");
  const account = await req(tx.objectStore("plain").get("account"));
  assert.deepEqual([...account], [1, 2, 3]);
  const session = await req(tx.objectStore("inline").get("s1"));
  assert.deepEqual([...session.key], [9]);
  assert.ok(tx.objectStore("inline").indexNames.contains("by_room"));
  db.close();
  await req(indexedDB.deleteDatabase(NAME));
});

test("dumpDatabases ignora bases con otro prefijo", async () => {
  const other = "otra-app::base";
  (await req(indexedDB.open(other, 1))).close();
  const bytes = await dumpDatabases(PREFIX);
  await req(indexedDB.deleteDatabase(other));
  assert.ok(!Buffer.from(bytes).toString("latin1").includes("otra-app"));
});
