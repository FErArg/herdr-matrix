// Entrada interactiva de la terminal. La contraseña se lee sin eco.

import { createInterface } from "node:readline/promises";

export async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

export function askHidden(question) {
  if (!process.stdin.isTTY) {
    throw new Error("se necesita una terminal interactiva para leer la contraseña.");
  }
  return new Promise((resolve) => {
    process.stdout.write(question);
    let value = "";

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.removeListener("data", onData);
      process.stdin.pause();
    };

    const onData = (chunk) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}
