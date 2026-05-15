export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function normalizeTelegramUsername(username: string) {
  return username.trim().replace(/^@/, "").toLowerCase();
}

export function parseTelegramGroupInput(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return { chatId: null as number | null, inviteLink: null as string | null };
  const raw = String(value).trim();
  if (/^(https?:\/\/)?t\.me\//i.test(raw)) return { chatId: null as number | null, inviteLink: raw };
  if (!/^-?\d+$/.test(raw)) {
    throw new Error("Telegram group chat ID must be numeric. To use an invite link, paste it into the Telegram group invite link field and bind the group with /bind PROJECT_CODE.");
  }
  return { chatId: Number(raw), inviteLink: null as string | null };
}

export function formatDateTime(value?: string | null) {
  if (!value) return "No timestamp";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function truncateMiddle(value: string, max = 28) {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 3) / 2);
  const tail = Math.floor((max - 3) / 2);
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}
