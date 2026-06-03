import { HARNESSES, type HarnessDef } from "./data";

export type WhichCommand = (binary: string) => string | null | undefined;

const defaultWhich: WhichCommand = (binary) => Bun.which(binary);

export function getInstalledHarnesses(
  harnesses: readonly HarnessDef[] = HARNESSES,
  which: WhichCommand = defaultWhich,
): HarnessDef[] {
  return harnesses.filter((harness) => which(harness.binary) != null);
}

export function supportedHarnessBinaries(harnesses: readonly HarnessDef[] = HARNESSES): string[] {
  return harnesses.map((harness) => harness.binary);
}
