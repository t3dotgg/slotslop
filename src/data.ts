// ── Data model for the slot machine ────────────────────────────────────────
// Column 1 (harness) restricts column 2 (model); column 2 restricts column 3
// (effort). Each harness knows how to render the final command in its own
// CLI syntax.

export type Effort = "no-reasoning" | "low" | "medium" | "high";

export const EFFORTS: Effort[] = ["no-reasoning", "low", "medium", "high"];

export type Provider = "anthropic" | "openai" | "google";

export interface ModelDef {
  /** Short id used on most CLIs, e.g. "haiku-4.6". */
  id: string;
  /** Human label shown in the reel. */
  label: string;
  provider: Provider;
  /** Provider-prefixed slug, e.g. "claude-haiku-4-6" (used by opencode). */
  slug: string;
  /** Which reasoning levels this model actually supports. */
  efforts: Effort[];
}

// ── Models ──────────────────────────────────────────────────────────────────
const M = {
  "sonnet-4.6": {
    id: "sonnet-4.6",
    label: "Sonnet 4.6",
    provider: "anthropic",
    slug: "claude-sonnet-4-6",
    efforts: ["no-reasoning", "low", "medium", "high"],
  },
  "haiku-4.6": {
    id: "haiku-4.6",
    label: "Haiku 4.6",
    provider: "anthropic",
    slug: "claude-haiku-4-6",
    efforts: ["no-reasoning", "low", "medium", "high"],
  },
  "opus-4.8": {
    id: "opus-4.8",
    label: "Opus 4.8",
    provider: "anthropic",
    slug: "claude-opus-4-8",
    efforts: ["no-reasoning", "low", "medium", "high"],
  },
  "gpt-5.5": {
    id: "gpt-5.5",
    label: "GPT-5.5",
    provider: "openai",
    slug: "gpt-5.5",
    efforts: ["low", "medium", "high"],
  },
  "gpt-5.4": {
    id: "gpt-5.4",
    label: "GPT-5.4",
    provider: "openai",
    slug: "gpt-5.4",
    efforts: ["low", "medium", "high"],
  },
  "gpt-5.4-mini": {
    id: "gpt-5.4-mini",
    label: "GPT-5.4-mini",
    provider: "openai",
    slug: "gpt-5.4-mini",
    efforts: ["no-reasoning", "low", "medium"],
  },
  "gpt-5.3-codex-spark": {
    id: "gpt-5.3-codex-spark",
    label: "GPT-5.3-codex-spark",
    provider: "openai",
    slug: "gpt-5.3-codex-spark",
    efforts: ["low", "medium", "high"],
  },
  "gemini-3.1-pro": {
    id: "gemini-3.1-pro",
    label: "Gemini 3.1 Pro",
    provider: "google",
    slug: "gemini-3.1-pro",
    efforts: ["low", "medium", "high"],
  },
  "gemini-3.5-flash": {
    id: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    provider: "google",
    slug: "gemini-3.5-flash",
    efforts: ["no-reasoning", "low", "medium", "high"],
  },
} satisfies Record<string, ModelDef>;

type ModelKey = keyof typeof M;
const models = (...keys: ModelKey[]): ModelDef[] => keys.map((k) => M[k]);

// ── Command-builder helpers ──────────────────────────────────────────────────
/** Single-quote a prompt for the shell, escaping embedded single quotes. */
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

const hasReasoning = (e: Effort): boolean => e !== "no-reasoning";

export interface HarnessDef {
  id: string;
  label: string;
  /** Executable this harness uses when launched. Must be present on PATH. */
  binary: string;
  models: ModelDef[];
  buildCommand: (model: ModelDef, effort: Effort, prompt: string) => string;
}

// ── Harnesses ────────────────────────────────────────────────────────────────
export const HARNESSES: HarnessDef[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    binary: "claude",
    models: models("sonnet-4.6", "haiku-4.6", "opus-4.8"),
    // claude is interactive by default (a positional prompt seeds the session).
    // --effort is a real flag (low|medium|high|xhigh|max); omit it for no-reasoning.
    buildCommand: (m, e, p) => {
      const effort = hasReasoning(e) ? ` --effort ${e}` : "";
      return `claude --model ${m.id}${effort} ${q(p)}`;
    },
  },
  {
    id: "codex",
    label: "Codex",
    binary: "codex",
    models: models("gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"),
    buildCommand: (m, e, p) => {
      const effort = hasReasoning(e)
        ? ` -c model_reasoning_effort="${e}"`
        : "";
      // interactive TUI (not `codex exec`, which is the headless one-shot)
      return `codex -m ${m.id}${effort} ${q(p)}`;
    },
  },
  {
    id: "opencode",
    label: "OpenCode",
    binary: "opencode",
    // Multi-provider — supports everything.
    models: models(
      "sonnet-4.6",
      "haiku-4.6",
      "opus-4.8",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex-spark",
      "gemini-3.1-pro",
      "gemini-3.5-flash",
    ),
    buildCommand: (m, e, p) => {
      // its interactive TUI takes a project path (not a prompt), so use `run`;
      // --variant carries provider-specific reasoning effort.
      const variant = hasReasoning(e) ? ` --variant ${e}` : "";
      return `opencode run -m ${m.provider}/${m.slug}${variant} ${q(p)}`;
    },
  },
  {
    id: "pi",
    label: "Pi",
    binary: "pi",
    models: models(
      "sonnet-4.6",
      "haiku-4.6",
      "opus-4.8",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
    ),
    buildCommand: (m, _e, p) =>
      // pi has no reasoning-effort flag
      `pi --model ${m.id} ${q(p)}`,
  },
  {
    id: "antigravity",
    label: "Antigravity CLI",
    binary: "agy",
    models: models("gemini-3.1-pro", "gemini-3.5-flash"),
    // bound as `agy`; new + lightly documented, so no speculative effort flag
    buildCommand: (m, _e, p) => `agy -m ${m.id} ${q(p)}`,
  },
  {
    id: "cursor",
    label: "Cursor CLI",
    binary: "cursor-agent",
    // Curated multi-provider selection.
    models: models("sonnet-4.6", "opus-4.8", "gpt-5.5", "gpt-5.4", "gemini-3.1-pro"),
    // interactive session (no `-p` print mode); cursor-agent uses --model, no effort flag
    buildCommand: (m, _e, p) => `cursor-agent --model ${m.id} ${q(p)}`,
  },
];
