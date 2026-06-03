// Pure slot-machine state. No rendering — the UI layer reads `cols`/`done` and
// calls `tick()` each frame and `press()` on keypress.
import {
  EFFORTS,
  type Effort,
  type HarnessDef,
  type ModelDef,
} from "./data";

export type ColKind = "harness" | "model" | "effort";
export type ColState = "spin" | "stopping" | "stopped";

export interface Column {
  kind: ColKind;
  title: string;
  labels: string[];
  idx: number;
  state: ColState;
  wait: number;
  delay: number;
}

const STOP_AT = 7; // higher = longer wind-down
const rand = (n: number) => Math.floor(Math.random() * n);

const allModelLabels = (harnesses: readonly HarnessDef[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of harnesses)
    for (const m of h.models)
      if (!seen.has(m.id)) {
        seen.add(m.id);
        out.push(m.label);
      }
  return out;
};

export class SlotEngine {
  cols: Column[];
  active = 0;
  done = false;

  selectedHarness: HarnessDef | null = null;
  selectedModel: ModelDef | null = null;
  selectedEffort: Effort | null = null;

  private modelPool: ModelDef[] = [];
  private effortPool: Effort[] = EFFORTS;

  constructor(private readonly harnesses: readonly HarnessDef[]) {
    if (harnesses.length === 0) {
      throw new Error("SlotEngine needs at least one harness");
    }

    this.cols = [
      this.mk("harness", "HARNESS", harnesses.map((h) => h.label)),
      this.mk("model", "MODEL", allModelLabels(harnesses)),
      this.mk("effort", "EFFORT", [...EFFORTS]),
    ];
  }

  private mk(kind: ColKind, title: string, labels: string[]): Column {
    return { kind, title, labels, idx: rand(labels.length), state: "spin", wait: 0, delay: 0 };
  }

  /** Advance the machine one animation frame. */
  tick(): void {
    this.cols.forEach((col, i) => this.step(col, i));
  }

  private step(col: Column, i: number): void {
    if (col.state === "stopped") return;
    if (col.state === "spin") {
      col.idx = (col.idx + 1) % col.labels.length;
      return;
    }
    // stopping: step less and less often until it settles
    if (--col.wait <= 0) {
      col.idx = (col.idx + 1) % col.labels.length;
      col.delay += 1;
      col.wait = col.delay;
      if (col.delay > STOP_AT) {
        col.state = "stopped";
        this.onStop(i);
      }
    }
  }

  private onStop(i: number): void {
    const col = this.cols[i]!;
    if (col.kind === "harness") {
      this.selectedHarness = this.harnesses[col.idx]!;
      this.modelPool = this.selectedHarness.models;
      const m = this.cols[1]!;
      m.labels = this.modelPool.map((x) => x.label);
      m.idx = rand(this.modelPool.length);
      this.active = 1;
    } else if (col.kind === "model") {
      this.selectedModel = this.modelPool[col.idx]!;
      this.effortPool = this.selectedModel.efforts;
      const e = this.cols[2]!;
      e.labels = [...this.effortPool];
      e.idx = rand(this.effortPool.length);
      this.active = 2;
    } else {
      this.selectedEffort = this.effortPool[col.idx]!;
      this.done = true;
    }
  }

  /** Stop the currently-active reel (called on keypress). */
  press(): void {
    const col = this.cols[this.active];
    if (col && col.state === "spin") {
      col.state = "stopping";
      col.delay = 1;
      col.wait = 1;
    }
  }

  command(prompt: string): string | null {
    if (!this.done || !this.selectedHarness || !this.selectedModel || !this.selectedEffort)
      return null;
    return this.selectedHarness.buildCommand(this.selectedModel, this.selectedEffort, prompt);
  }
}
