export function getEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
}

export function requireEnv(name: string): string {
  const value = getEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function getBaseUrl() {
  const configuredUrl =
    getEnv("TELEGRAM_WEBHOOK_BASE_URL") ??
    getEnv("Installer_webhook_base_URL") ??
    getEnv("INSTALLER_WEBHOOK_BASE_URL") ??
    getEnv("ORCHESTRATOR_URL") ??
    getEnv("NEXT_PUBLIC_APP_URL") ??
    getEnv("VERCEL_PROJECT_PRODUCTION_URL") ??
    getEnv("VERCEL_URL");

  return configuredUrl ? normalizeBaseUrl(configuredUrl) : "http://localhost:3000";
}

export function getRequestBaseUrl(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host");
  if (host) {
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const protocol = forwardedProto ?? (host.includes("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return `${protocol}://${host}`.replace(/\/$/, "");
  }

  return getBaseUrl();
}
