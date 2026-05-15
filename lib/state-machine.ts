import type { BotState } from "@/types";

export function normalizeProjectName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function levenshtein(a: string, b: string) {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      matrix[i][j] =
        a[i - 1] === b[j - 1]
          ? matrix[i - 1][j - 1]
          : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }

  return matrix[a.length][b.length];
}

export function isProjectNameMatch(candidate: string, projectName: string) {
  const a = normalizeProjectName(candidate);
  const b = normalizeProjectName(projectName);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const distance = levenshtein(a, b);
  return distance / Math.max(a.length, b.length) <= 0.2;
}

export function parsePositiveInteger(value: string) {
  const match = value.match(/\d+/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isInteger(number) && number > 0 && number < 200 ? number : null;
}

export function parseFloorNames(value: string, expectedCount: number) {
  const names = value
    .split(/\r?\n|,/)
    .map((line) => line.replace(/^\d+[\).\-\s]+/, "").trim())
    .filter(Boolean);

  if (names.length !== expectedCount) {
    return { ok: false as const, names, error: `Expected ${expectedCount} floor names, received ${names.length}.` };
  }

  return { ok: true as const, names };
}

export function parseBindCommand(text: string) {
  const match = text.trim().match(/^\/bind(?:@\w+)?\s+([A-Za-z0-9_-]+)\s*$/i);
  return match?.[1]?.toUpperCase() ?? null;
}

export function stateLabel(state: BotState) {
  return state
    .split("_")
    .map((part) => part[0] + part.slice(1).toLowerCase())
    .join(" ");
}
