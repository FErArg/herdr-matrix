// Lectura y escritura de ficheros JSON del plugin.
// Los ficheros con secretos se escriben con permisos 0600 y de forma atómica.

import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const CONFIG_VERSION = 1;

export function configDir() {
  return process.env.HERDR_PLUGIN_CONFIG_DIR
    || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "herdr-matrix");
}

export function stateDir() {
  return process.env.HERDR_PLUGIN_STATE_DIR
    || join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "herdr-matrix");
}

export async function loadConfig(dir) {
  const config = await readJson(join(dir, "config.json"));
  if (config && config.config_version !== CONFIG_VERSION) {
    throw new Error(`config.json tiene config_version ${config.config_version}; se esperaba ${CONFIG_VERSION}.`);
  }
  return config;
}

export async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeJsonSecure(path, data) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
}

export async function removeFile(path) {
  await rm(path, { force: true });
}

export async function removeDir(path) {
  await rm(path, { recursive: true, force: true });
}

export async function writeBytesSecure(path, bytes) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, bytes, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
}

export async function readBytes(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
