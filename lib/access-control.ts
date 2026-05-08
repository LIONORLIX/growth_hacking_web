const ACCESS_COOKIE_NAME = "ghw_access_token";
const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function normalizePassword(value: string | undefined): string {
  return (value ?? "").trim();
}

function getConfiguredPassword(): string {
  return normalizePassword(process.env.ACCESS_PASSWORD);
}

export function isAccessProtectionEnabled(): boolean {
  return getConfiguredPassword().length > 0;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return toHex(digest);
}

export async function createAccessToken(password: string): Promise<string> {
  return sha256(`ghw-access:${normalizePassword(password)}`);
}

export async function getExpectedAccessToken(): Promise<string | null> {
  const configuredPassword = getConfiguredPassword();
  if (!configuredPassword) return null;
  return createAccessToken(configuredPassword);
}

export function getAccessCookieName(): string {
  return ACCESS_COOKIE_NAME;
}

export function getAccessCookieMaxAge(): number {
  return ACCESS_COOKIE_MAX_AGE;
}
