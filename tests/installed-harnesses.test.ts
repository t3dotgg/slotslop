import { describe, expect, test } from "bun:test";
import type { HarnessDef } from "../src/data";
import { SlotEngine } from "../src/engine";
import { getInstalledHarnesses } from "../src/installed-harnesses";

const harness = (id: string, binary: string): HarnessDef => ({
  id,
  label: id,
  binary,
  models: [],
  buildCommand: () => "",
});

describe("getInstalledHarnesses", () => {
  test("keeps only harnesses with binaries on PATH", () => {
    const input = [harness("codex", "codex"), harness("antigravity", "agy")];

    const installed = getInstalledHarnesses(input, (binary) => (binary === "codex" ? "/bin/codex" : null));

    expect(installed.map((h) => h.id)).toEqual(["codex"]);
  });

  test("treats null and undefined as missing", () => {
    const input = [harness("pi", "pi"), harness("cursor", "cursor-agent")];

    const installed = getInstalledHarnesses(input, (binary) => (binary === "pi" ? undefined : null));

    expect(installed).toEqual([]);
  });
});

describe("SlotEngine", () => {
  test("initializes reels from the provided harness list", () => {
    const codex: HarnessDef = {
      ...harness("codex", "codex"),
      label: "Codex",
      models: [
        {
          id: "gpt-test",
          label: "GPT Test",
          provider: "openai",
          slug: "gpt-test",
          efforts: ["low"],
        },
      ],
    };

    const engine = new SlotEngine([codex]);

    expect(engine.cols[0]?.labels).toEqual(["Codex"]);
    expect(engine.cols[1]?.labels).toEqual(["GPT Test"]);
  });
});
