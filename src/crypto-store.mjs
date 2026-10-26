// Persistencia del almacén criptográfico del bot.
// matrix-js-sdk con crypto Rust usa IndexedDB. En Node, `fake-indexeddb` es solo en memoria,
// así que el contenido de las bases con un prefijo se vuelca a un fichero (0600) al parar
// y periódicamente, y se restaura antes de iniciar el cliente.
// El volcado es el de structured clone de v8 (`node:v8`), que admite Uint8Array, Date y Map.
// El fichero se cifra con AES-256-GCM. La clave está en `store.key` (0600), junto al almacén:
// el bot no puede pedir una contraseña en cada arranque, así que el cifrado protege copias sueltas
// de `store.bin`. Quien lea el directorio de estado entero puede leer ambos ficheros.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";
// /auto define el API global completo (IDBKeyRange, IDBDatabase…), que el crypto Rust comprueba.
// Debe cargarse antes que matrix-js-sdk: por eso este módulo se importa primero en bot-client.
import "fake-indexeddb/auto";
import { indexedDB } from "fake-indexeddb";
import { readBytes, writeBytesSecure } from "./store.mjs";

const STORE_FILE = "store.bin";
const KEY_FILE = "store.key";
const MAGIC = Buffer.from("HMS1");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export function storePath(cryptoDir) {
  return join(cryptoDir, STORE_FILE);
}

export function keyPath(cryptoDir) {
  return join(cryptoDir, KEY_FILE);
}

// Formato: MAGIC | iv | tag | texto cifrado.
export function sealStore(key, plain) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

// Un fichero sin cabecera es el formato anterior a 0.6.0 (sin cifrar): se acepta una vez y se reescribe cifrado.
export function openStore(key, sealed) {
  if (!sealed.subarray(0, MAGIC.length).equals(MAGIC)) return sealed;
  const ivStart = MAGIC.length;
  const tagStart = ivStart + IV_BYTES;
  const bodyStart = tagStart + TAG_BYTES;
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(ivStart, tagStart));
  decipher.setAuthTag(sealed.subarray(tagStart, bodyStart));
  return Buffer.concat([decipher.update(sealed.subarray(bodyStart)), decipher.final()]);
}

async function readOrCreateKey(cryptoDir) {
  const existing = await readBytes(keyPath(cryptoDir));
  if (existing) return existing;
  const key = randomBytes(KEY_BYTES);
  await writeBytesSecure(keyPath(cryptoDir), key);
  return key;
}

export async function restoreStore(cryptoDir) {
  const sealed = await readBytes(storePath(cryptoDir));
  if (!sealed) return;
  const isSealed = sealed.subarray(0, MAGIC.length).equals(MAGIC);
  const key = isSealed ? await readBytes(keyPath(cryptoDir)) : null;
  if (isSealed && !key) {
    throw new Error("falta store.key: no se puede abrir el almacén criptográfico. Ejecuta setup para crear un dispositivo nuevo.");
  }
  await restoreDatabases(openStore(key, sealed));
}

export async function saveStore(cryptoDir, prefix) {
  const key = await readOrCreateKey(cryptoDir);
  await writeBytesSecure(storePath(cryptoDir), sealStore(key, await dumpDatabases(prefix)));
}

const DONE = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export async function dumpDatabases(prefix) {
  const names = (await indexedDB.databases())
    .map((info) => info.name)
    .filter((name) => name.startsWith(prefix));

  const dumps = [];
  for (const name of names) {
    const db = await DONE(indexedDB.open(name));
    const storeNames = [...db.objectStoreNames];
    const tx = db.transaction(storeNames, "readonly");
    const stores = [];
    for (const storeName of storeNames) {
      const store = tx.objectStore(storeName);
      const indexes = [...store.indexNames].map((indexName) => {
        const index = store.index(indexName);
        return { name: indexName, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
      });
      const keys = store.keyPath === null ? await DONE(store.getAllKeys()) : null;
      const values = await DONE(store.getAll());
      stores.push({
        name: storeName,
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement,
        indexes,
        records: values.map((value, i) => [keys ? keys[i] : undefined, value]),
      });
    }
    dumps.push({ name, version: db.version, stores });
    db.close();
  }
  return serialize(dumps);
}

export async function restoreDatabases(bytes) {
  for (const dump of deserialize(bytes)) {
    await new Promise((resolve, reject) => {
      const open = indexedDB.open(dump.name, dump.version);
      open.onupgradeneeded = () => {
        for (const store of dump.stores) {
          const created = open.result.createObjectStore(store.name, {
            keyPath: store.keyPath,
            autoIncrement: store.autoIncrement,
          });
          for (const index of store.indexes) {
            created.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
          }
        }
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(dump.stores.map((store) => store.name), "readwrite");
        for (const store of dump.stores) {
          const target = tx.objectStore(store.name);
          for (const [key, value] of store.records) {
            if (store.keyPath === null) target.put(value, key);
            else target.put(value);
          }
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  }
}
