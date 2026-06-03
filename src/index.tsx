#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app";
import { getInstalledHarnesses, supportedHarnessBinaries } from "./installed-harnesses";

const HELP = `
  🎰 slotslop — spin for your harness / model / effort

  usage:
    slotslop "your task prompt here"     (or: bunx slotslop "...")

  press ⏎ or space to stop each reel, left to right.
  the harness you land on restricts which models can appear,
  and the model restricts which effort levels can appear.
  only harnesses with installed CLI binaries on PATH are shown.
  on the results screen, ⏎ runs the rolled command, esc leaves.
`;

function onExit(cmd: string | null, run: boolean): void {
  // Enter on the results screen -> hand the terminal straight to the command.
  if (run && cmd) {
    process.stdout.write(`\n  ▶ launching:  \x1b[1m${cmd}\x1b[0m\n\n`);
    const res = spawnSync(cmd, { shell: true, stdio: "inherit" });
    process.exit(res.status ?? 0);
  }
  // Escape (or quitting mid-spin) -> leave; show the command so it isn't lost.
  if (cmd) {
    process.stdout.write(`\n  left without running:\n\n    \x1b[1m${cmd}\x1b[0m\n\n`);
  } else {
    process.stdout.write("\n  bye 👋\n\n");
  }
  process.exit(0);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(HELP);
    process.exit(0);
  }
  const prompt = args.join(" ").trim() || "do something cool";
  const harnesses = getInstalledHarnesses();

  if (harnesses.length === 0) {
    process.stderr.write(
      "\n  slotslop could not find any supported harness CLIs on PATH.\n" +
        `  Expected one of: ${supportedHarnessBinaries().join(", ")}\n\n`,
    );
    process.exit(1);
  }

  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  createRoot(renderer).render(<App prompt={prompt} harnesses={harnesses} onExit={onExit} />);
}

main();
