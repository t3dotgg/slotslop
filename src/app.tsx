import { createTextAttributes, RGBA, type BoxRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useEffect, useReducer, useRef, type ReactNode } from "react";
import { EFFORTS, type HarnessDef } from "./data";
import { SlotEngine, type Column } from "./engine";
import { Confetti, THEMES } from "./confetti";
import { Shockwaves, SHOCK_DUR, SHOCK_MAXR } from "./shockwave";
import { classify, type Outcome } from "./outcome";

const FRAME_MS = 70; // reel step cadence
const VISUAL_MS = 33; // ~30fps re-render for the flashy layers

const A = {
  bold: createTextAttributes({ bold: true }),
  dim: createTextAttributes({ dim: true }),
};
// Reel paylines stay on the terminal's themed ANSI palette (high contrast).
const IDX = {
  black: RGBA.fromIndex(0),
  green: RGBA.fromIndex(2),
  yellow: RGBA.fromIndex(3),
  white: RGBA.fromIndex(7),
  dimGray: RGBA.fromIndex(8), // active reel's underlying border (hidden by shimmer)
};

const ACTIVE_TITLE = "▸ HARNESS ◂";
const GAP = 2;

interface MachineMetrics {
  contentW: number;
  reelW: number;
  machineW: number;
}

function machineMetrics(harnesses: readonly HarnessDef[]): MachineMetrics {
  const maxLabel = Math.max(
    ACTIVE_TITLE.length,
    ...harnesses.map((h) => h.label.length),
    ...harnesses.flatMap((h) => h.models.map((m) => m.label.length)),
    ...EFFORTS.map((e) => e.length),
  );
  const contentW = maxLabel + 2;
  const reelW = contentW + 4;
  return { contentW, reelW, machineW: reelW * 3 + GAP * 2 };
}

// ── helpers ──────────────────────────────────────────────────────────────────
function payline(label: string, w: number): string {
  if (label.length >= w) return label.slice(0, w);
  const total = w - label.length;
  const left = Math.floor(total / 2);
  return " ".repeat(left) + label + " ".repeat(total - left);
}

/** HSV (h in degrees) -> #rrggbb. */
function hsv(h: number, s = 1, v = 1): string {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g] = [c, x];
  else if (h < 120) [r, g] = [x, c];
  else if (h < 180) [g, b] = [c, x];
  else if (h < 240) [g, b] = [x, c];
  else if (h < 300) [r, b] = [x, c];
  else [r, b] = [c, x];
  const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}
const gray = (v: number) => {
  const h = Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h}${h}${h}`;
};

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const rectOf = (b: BoxRenderable | null): Rect | null =>
  b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;

function Rainbow({ text, phase, speed = 120, spread = 16 }: { text: string; phase: number; speed?: number; spread?: number }) {
  return (
    <text attributes={A.bold}>
      {[...text].map((ch, i) => (
        <span key={i} fg={hsv(phase * speed + i * spread)}>
          {ch}
        </span>
      ))}
    </text>
  );
}

/**
 * The Vegas marquee bar. With no `hue` it's a scrolling rainbow; with a `hue`
 * it becomes a pulsing single-mood band (red for a bust, amber for so-close…).
 */
function MarqueeBar({ width, phase, hue = null }: { width: number; phase: number; hue?: number | null }) {
  const cells = Array.from({ length: width }, (_, i) => i);
  return (
    <text>
      {cells.map((i) => {
        const color =
          hue == null
            ? hsv(-phase * 220 + i * 9)
            : hsv(hue + Math.sin(i * 0.35 + phase * 5) * 18, 1, 0.45 + 0.5 * Math.abs(Math.sin(phase * 3.5 + i * 0.25)));
        return (
          <span key={i} fg={color}>
            █
          </span>
        );
      })}
    </text>
  );
}

/** A flashing single-mood banner used for the loss / near-miss outcomes. */
function MoodText({ text, hue, phase }: { text: string; hue: number; phase: number }) {
  const flash = Math.sin(phase * 7) > 0.78; // occasional white pop
  return (
    <text attributes={A.bold}>
      {[...text].map((ch, i) => (
        <span key={i} fg={flash ? "#ffffff" : hsv(hue, 1, 0.55 + 0.45 * Math.abs(Math.sin(phase * 4 + i * 0.2)))}>
          {ch}
        </span>
      ))}
    </text>
  );
}

/** Horizontally center its child. (Boxes default to column flex, so we need an
 *  explicit row direction for justifyContent to center on the horizontal axis.) */
function Centered({ children, width = "100%" }: { children: ReactNode; width?: number | `${number}%` }) {
  return <box style={{ width, flexDirection: "row", justifyContent: "center" }}>{children}</box>;
}

const REEL_ROWS = [-2, -1, 0, 1, 2]; // 5 rows tall; 0 is the payline

function Reel({
  col,
  active,
  done,
  boxRef,
  contentW,
  reelW,
}: {
  col: Column;
  active: boolean;
  done: boolean;
  boxRef: (el: BoxRenderable | null) => void;
  contentW: number;
  reelW: number;
}) {
  const L = col.labels.length;
  const at = (o: number) => col.labels[(col.idx + o + L * 8) % L]!;
  const stopped = col.state === "stopped";
  const barBg = stopped ? IDX.green : active && col.state === "stopping" ? IDX.yellow : IDX.white;
  const titleAttr = active && !done ? A.bold : A.dim;
  const title = stopped ? `✔ ${col.title}` : active && !done ? `▸ ${col.title} ◂` : col.title;
  // Active reel's real border is hidden under the shimmer overlay.
  const borderColor = stopped ? IDX.green : IDX.dimGray;

  return (
    <box style={{ flexDirection: "column", width: reelW, flexShrink: 0 }}>
      <Centered>
        <text attributes={titleAttr}>{title}</text>
      </Centered>
      <box ref={boxRef} style={{ width: "100%", flexDirection: "column", border: true, borderColor, paddingLeft: 1, paddingRight: 1 }}>
        {REEL_ROWS.map((o) =>
          o === 0 ? (
            <text key={o} fg={IDX.black} bg={barBg} attributes={A.bold}>
              {payline(at(0), contentW)}
            </text>
          ) : (
            <Centered key={o}>
              <text attributes={A.dim}>{at(o)}</text>
            </Centered>
          ),
        )}
      </box>
    </box>
  );
}

/** Ordered (clockwise) perimeter cells of a box border. */
function borderCells(r: Rect): { px: number; py: number; ch: string }[] {
  const out: { px: number; py: number; ch: string }[] = [];
  const { x, y, w, h } = r;
  for (let i = 0; i < w; i++) out.push({ px: x + i, py: y, ch: i === 0 ? "┌" : i === w - 1 ? "┐" : "─" });
  for (let j = 1; j < h - 1; j++) out.push({ px: x + w - 1, py: y + j, ch: "│" });
  for (let i = w - 1; i >= 0; i--) out.push({ px: x + i, py: y + h - 1, ch: i === 0 ? "└" : i === w - 1 ? "┘" : "─" });
  for (let j = h - 2; j >= 1; j--) out.push({ px: x, py: y + j, ch: "│" });
  return out;
}

function FXLayer({
  activeRect,
  shocks,
  phase,
  w,
  h,
}: {
  activeRect: Rect | null;
  shocks: Shockwaves;
  phase: number;
  w: number;
  h: number;
}) {
  const inBounds = (px: number, py: number) => px >= 0 && px < w && py >= 0 && py < h;
  return (
    <box style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", zIndex: 90 }}>
      {/* shimmer border around the active column */}
      {activeRect &&
        borderCells(activeRect).map((c, i) =>
          inBounds(c.px, c.py) ? (
            <text key={`b${i}`} style={{ position: "absolute", left: c.px, top: c.py }} fg={hsv(phase * 260 - i * 12, 1, 1)} attributes={A.bold}>
              {c.ch}
            </text>
          ) : null,
        )}
      {/* expanding shockwave rings from the last press */}
      {shocks.waves.flatMap((wv) => {
        const r = (wv.t / SHOCK_DUR) * SHOCK_MAXR;
        const bright = 1 - wv.t / SHOCK_DUR;
        const ch = bright > 0.6 ? "●" : bright > 0.3 ? "•" : "·";
        const v = 90 + bright * 165;
        const fg = `#${Math.round(v * 0.55).toString(16).padStart(2, "0")}${Math.round(v).toString(16).padStart(2, "0")}${Math.round(v).toString(16).padStart(2, "0")}`;
        const seen = new Set<string>();
        const steps = Math.max(18, Math.round(r * 9));
        const nodes = [];
        for (let k = 0; k < steps; k++) {
          const a = (k / steps) * Math.PI * 2;
          const px = Math.round(wv.cx + Math.cos(a) * r * 2);
          const py = Math.round(wv.cy + Math.sin(a) * r);
          const key = `${px},${py}`;
          if (seen.has(key) || !inBounds(px, py)) continue;
          seen.add(key);
          nodes.push(
            <text key={`s${wv.id}-${k}`} style={{ position: "absolute", left: px, top: py }} fg={fg} attributes={A.bold}>
              {ch}
            </text>,
          );
        }
        return nodes;
      })}
    </box>
  );
}

function ConfettiLayer({ confetti, w, h }: { confetti: Confetti; w: number; h: number }) {
  return (
    <box style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", zIndex: 100 }}>
      {confetti.particles.map((p) => {
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        if (x < 0 || x >= w || y < 0 || y >= h) return null;
        return (
          <text key={p.id} style={{ position: "absolute", left: x, top: y }} fg={p.color} attributes={A.bold}>
            {p.char}
          </text>
        );
      })}
    </box>
  );
}

export function App({
  prompt,
  harnesses,
  onExit,
}: {
  prompt: string;
  harnesses: readonly HarnessDef[];
  onExit: (cmd: string | null, run: boolean) => void;
}) {
  const renderer = useRenderer();
  const { width, height } = useTerminalDimensions();
  const metrics = machineMetrics(harnesses);
  const engineRef = useRef<SlotEngine | null>(null);
  if (!engineRef.current) engineRef.current = new SlotEngine(harnesses);
  const engine = engineRef.current;

  const confettiRef = useRef<Confetti>(undefined as unknown as Confetti);
  if (!confettiRef.current) confettiRef.current = new Confetti();
  const confetti = confettiRef.current;

  const shockRef = useRef<Shockwaves>(undefined as unknown as Shockwaves);
  if (!shockRef.current) shockRef.current = new Shockwaves();
  const shocks = shockRef.current;

  const boxRefs = useRef<(BoxRenderable | null)[]>([null, null, null]);

  const [, force] = useReducer((n: number) => n + 1, 0);
  const acc = useRef(0);
  const vacc = useRef(0);
  const phase = useRef(0);
  const prevActive = useRef(0);
  const prevDone = useRef(false);
  const outcomeRef = useRef<Outcome | null>(null);

  // center / top of a reel box, for spawning effects
  const center = (i: number): { cx: number; cy: number } | null => {
    const r = rectOf(boxRefs.current[i] ?? null);
    return r ? { cx: r.x + r.w / 2, cy: r.y + r.h / 2 } : null;
  };

  useEffect(() => {
    const cb = async (deltaMs: number) => {
      const dt = deltaMs / 1000;
      phase.current += dt;

      if (!engine.done) {
        acc.current += deltaMs;
        while (acc.current >= FRAME_MS) {
          acc.current -= FRAME_MS;
          engine.tick();
        }
      }

      // lock in the verdict once everything has stopped
      if (engine.done && !outcomeRef.current && engine.selectedHarness && engine.selectedModel && engine.selectedEffort) {
        outcomeRef.current = classify(engine.selectedHarness, engine.selectedModel, engine.selectedEffort);
      }

      // confetti ONLY when a selection ends (a reel locks / the win)
      if (engine.active > prevActive.current) {
        const c = center(prevActive.current);
        if (c) confetti.burst(c.cx, c.cy - 1, 42);
        prevActive.current = engine.active;
      }
      // the final reel reveals the verdict — celebrate or mourn accordingly
      if (engine.done && !prevDone.current) {
        prevDone.current = true;
        const o = outcomeRef.current;
        const c = center(2);
        if (o?.vibe === "win") {
          if (c) confetti.burst(c.cx, c.cy - 1, 70, THEMES.party);
          confetti.rain(width, 90, THEMES.party);
        } else if (o?.vibe === "soclose") {
          if (c) confetti.burst(c.cx, c.cy - 1, 55, THEMES.amber); // one hopeful puff that fizzles
        } else if (o?.kind === "gemini") {
          confetti.rain(width, 40, THEMES.gloom);
        } else {
          // bust / low-effort: red debris
          confetti.rain(width, 120, THEMES.bust);
          if (c) confetti.burst(c.cx, c.cy, 40, THEMES.bust);
        }
      }
      if (engine.done) {
        const o = outcomeRef.current;
        if (o?.vibe === "win") confetti.rain(width, 2, THEMES.party);
        else if (o?.kind === "gemini") confetti.rain(width, 1, THEMES.gloom);
        else if (o?.vibe === "lose") confetti.rain(width, 3, THEMES.bust);
        // soclose: no steady rain — let the one puff fizzle out
      }

      confetti.update(dt, height);
      shocks.update(dt);

      vacc.current += deltaMs;
      if (vacc.current >= VISUAL_MS) {
        vacc.current = 0;
        force();
      }
      renderer.requestRender();
    };
    renderer.setFrameCallback(cb);
    return () => renderer.removeFrameCallback(cb);
  }, [engine, renderer, confetti, shocks, width, height]);

  const finish = (run: boolean) => {
    (renderer as CliRenderer).destroy();
    onExit(engine.command(prompt), run);
  };

  useKeyboard((key: KeyEvent) => {
    const isEnter = key.name === "return" || key.name === "enter" || key.sequence === "\r";
    const isSpace = key.name === "space" || key.sequence === " ";
    if (key.name === "q" || key.name === "escape") {
      finish(false); // leave without running
      return;
    }
    if (engine.done) {
      if (isEnter) finish(true); // Enter runs the rolled command
      return; // (space does nothing on the results screen)
    }
    if (isEnter || isSpace) {
      // press feedback: a shockwave radiating from the column you hit
      const c = center(engine.active);
      if (c) shocks.emit(c.cx, c.cy);
      engine.press();
      force();
    }
  });

  const cmd = engine.command(prompt);
  const p = phase.current;
  const activeRect = !engine.done ? rectOf(boxRefs.current[engine.active] ?? null) : null;
  const outcome: Outcome | null =
    engine.done && engine.selectedHarness && engine.selectedModel && engine.selectedEffort
      ? classify(engine.selectedHarness, engine.selectedModel, engine.selectedEffort)
      : null;
  const moodHue = outcome ? outcome.hue : null; // null => rainbow marquee
  const boxBorder =
    outcome == null || outcome.vibe === "win" ? hsv(p * 200) : hsv((outcome.hue ?? 0) + Math.sin(p * 4) * 12, 1, 0.6);

  return (
    <>
      <box style={{ flexDirection: "column", padding: 1 }}>
        <Centered width={metrics.machineW}>
          <Rainbow text="🎰   S L O T - S L O P   🎰" phase={p} />
        </Centered>
        <Centered width={metrics.machineW}>
          <text attributes={A.dim}>task: {prompt}</text>
        </Centered>
        <box style={{ height: 1 }} />
        <MarqueeBar width={metrics.machineW} phase={p} hue={moodHue} />
        <box style={{ height: 1 }} />

        <box style={{ flexDirection: "row", gap: GAP }}>
          {engine.cols.map((col, i) => (
            <Reel
              key={col.kind}
              col={col}
              active={i === engine.active}
              done={engine.done}
              contentW={metrics.contentW}
              reelW={metrics.reelW}
              boxRef={(el) => {
                boxRefs.current[i] = el;
              }}
            />
          ))}
        </box>

        <box style={{ height: 1 }} />
        <MarqueeBar width={metrics.machineW} phase={p + 0.5} hue={moodHue} />
        <box style={{ height: 1 }} />

        {engine.done && cmd && outcome ? (
          <box style={{ flexDirection: "column" }}>
            {outcome.vibe === "win" ? (
              <Rainbow text={outcome.title} phase={p} speed={200} spread={10} />
            ) : (
              <MoodText text={outcome.title} hue={outcome.hue ?? 0} phase={p} />
            )}
            <text attributes={A.dim}>{outcome.subtitle}</text>
            <box style={{ height: 1 }} />
            <box style={{ border: true, borderColor: boxBorder, paddingLeft: 1, paddingRight: 1, flexDirection: "column" }}>
              <text attributes={A.bold}>{cmd}</text>
            </box>
            <box style={{ height: 1 }} />
            <text attributes={A.dim}>
              <span attributes={A.bold}>⏎</span> run it now {"   ·   "}
              <span attributes={A.bold}>esc</span> to leave
            </text>
          </box>
        ) : (
          <text attributes={A.dim}>
            press <span attributes={A.bold}>⏎ / space</span> to stop the{" "}
            <span attributes={A.bold}>{engine.cols[engine.active]!.title.toLowerCase()}</span> reel
            {"     "}(q to quit)
          </text>
        )}
      </box>
      <FXLayer activeRect={activeRect} shocks={shocks} phase={p} w={width} h={height} />
      <ConfettiLayer confetti={confetti} w={width} h={height} />
    </>
  );
}
