#!/usr/bin/env node
// Launcher. slot-slop is built on OpenTUI, which uses Bun's FFI + a native
// library, so the app must run under the Bun runtime. This shim works whether
// it's invoked by Node (`npx slotslop`) or Bun (`bunx slotslop`): under Bun it
// runs the app in-process; under Node it re-execs via `bun`. If Bun isn't
// installed it explains how to get it.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const entry = resolve(dirname(fileURLToPath(import.meta.url)), "../src/index.tsx");

if (typeof process.versions.bun === "string") {
  // Already running under Bun (e.g. `bunx slotslop`): run the app directly.
  await import(entry);
} else {
  const { spawnSync } = await import("node:child_process");
  const res = spawnSync("bun", [entry, ...process.argv.slice(2)], { stdio: "inherit" });
  if (res.error && res.error.code === "ENOENT") {
    process.stderr.write(
      "\n  slot-slop needs the Bun runtime (it's built on OpenTUI, which uses Bun's FFI).\n" +
        "  Install Bun from https://bun.sh and run it with:\n\n" +
        '      bunx slotslop "your task"\n\n',
    );
    process.exit(1);
  }
  process.exit(res.status ?? 1);
}
