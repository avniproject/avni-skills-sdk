// ui.mjs — terminal UI helpers (ANSI colours, boxes, rules, spinners).
//
// All helpers respect TTY: colour codes and animated spinners are stripped
// when stdout is not a TTY (e.g. piped to a file / driven by the
// scripts/demo-spec-pipeline.sh harness) so output stays clean.

export const TTY = process.stdout.isTTY;

const c = (code) => (s) => TTY ? `\x1b[${code}m${s}\x1b[0m` : s;
export const dim = c("2");
export const bold = c("1");
export const cyan = c("36");
export const green = c("32");
export const yellow = c("33");
export const red = c("31");
export const blue = c("34");
export const magenta = c("35");

// Visible-character length, ignoring ANSI escape codes (so coloured strings
// don't overflow the box).
export function visibleLen(s) { return s.replace(/\x1b\[[0-9;]*m/g, "").length; }

// Rotating Braille spinner — drop-in replacement for the static "⠋ ..."
// pattern that was scattered around. Use:
//
//   const stop = startSpinner("doing the thing");
//   await someAsyncWork();
//   stop("✓ done");      // overwrites the spinner line with the success msg
//   stop();              // or just clear the line
//
// No-op (just prints the label statically) when stdout isn't a TTY — so the
// REPL still produces sensible output when piped to a file or driven by a
// non-interactive harness (e.g. scripts/demo-spec-pipeline.sh).
const SPINNER_FRAMES = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];

export function startSpinner(label) {
  if (!TTY) {
    process.stdout.write(dim(label + "\n"));
    return () => {};
  }
  let i = 0;
  // Hide cursor while spinning
  process.stdout.write("\x1b[?25l");
  const render = () => {
    process.stdout.write(`\r${cyan(SPINNER_FRAMES[i % SPINNER_FRAMES.length])} ${dim(label)}`);
    i++;
  };
  render();
  const handle = setInterval(render, 80);
  return (finalMsg) => {
    clearInterval(handle);
    process.stdout.write("\r\x1b[K");          // clear the spinner line
    process.stdout.write("\x1b[?25h");         // restore cursor
    if (finalMsg) process.stdout.write(finalMsg + "\n");
  };
}

// Run an async fn under the spinner. Auto-clears on success/failure, prints
// a final ✓ msg on success or ✗ + error on failure. Returns the fn's value.
export async function withSpinner(label, fn, { okMsg, errMsg } = {}) {
  const stop = startSpinner(label);
  try {
    const result = await fn();
    stop("  " + green("✓") + " " + (okMsg || label));
    return result;
  } catch (e) {
    stop("  " + red("✗") + " " + (errMsg || label) + dim(" — " + (e?.message || String(e))));
    throw e;
  }
}

export function box(lines, { style = "round", indent = 0 } = {}) {
  const w = Math.max(...lines.map(visibleLen)) + 2;
  const corners = style === "square" ? "┌┐└┘" : "╭╮╰╯";
  const pad = " ".repeat(indent);
  const top = pad + corners[0] + "─".repeat(w) + corners[1];
  const bot = pad + corners[2] + "─".repeat(w) + corners[3];
  console.log(top);
  for (const l of lines) {
    const padding = " ".repeat(w - visibleLen(l) - 1);
    console.log(pad + "│ " + l + padding + "│");
  }
  console.log(bot);
}

// Horizontal rule with optional label.
export function rule(label = "", color = dim) {
  const w = Math.max(40, (process.stdout.columns || 80) - 2);
  if (!label) { console.log(color("─".repeat(w))); return; }
  const left = "── " + label + " ";
  const right = "─".repeat(Math.max(3, w - visibleLen(left)));
  console.log(color(left + right));
}
