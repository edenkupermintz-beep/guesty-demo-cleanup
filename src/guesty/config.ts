import "dotenv/config";

export type GuestyConfig = {
  accessToken: string;
  baseUrl: string;
  accountingBaseUrl: string;
  tolerance: number;
  /** True when the bearer was minted from client credentials (not a static env token). */
  tokenFromOAuth: boolean;
};

function readClientCredentials(): { clientId: string; clientSecret: string } | undefined {
  const clientId = (
    process.env.GUESTY_CLIENT_ID ?? process.env.CLIENT_ID ?? ""
  ).trim();
  const clientSecret = (
    process.env.GUESTY_CLIENT_SECRET ?? process.env.CLIENT_SECRET ?? ""
  ).trim();
  if (!clientId || !clientSecret) return undefined;
  return { clientId, clientSecret };
}

/**
 * Resolve Guesty Open API config.
 * Prefers GUESTY_ACCESS_TOKEN when set; otherwise exchanges OAuth client credentials.
 */
export async function loadConfig(): Promise<GuestyConfig> {
  const baseUrl = (process.env.GUESTY_API_BASE_URL ?? "https://open-api.guesty.com/v1").replace(
    /\/$/,
    "",
  );

  let accessToken = process.env.GUESTY_ACCESS_TOKEN?.trim() ?? "";
  let tokenFromOAuth = false;

  if (!accessToken) {
    const creds = readClientCredentials();
    if (!creds) {
      throw new Error(
        "Missing Guesty auth. Set GUESTY_ACCESS_TOKEN or GUESTY_CLIENT_ID + GUESTY_CLIENT_SECRET in .env (see .env.example).",
      );
    }
    accessToken = await fetchAccessToken(creds);
    tokenFromOAuth = true;
  }

  return {
    accessToken,
    baseUrl,
    accountingBaseUrl: (
      process.env.GUESTY_ACCOUNTING_API_BASE_URL ?? `${baseUrl}/accounting-api`
    ).replace(/\/$/, ""),
    tolerance: Number(process.env.GUESTY_DELTA_TOLERANCE ?? "0.01"),
    tokenFromOAuth,
  };
}

/** True if either a static bearer or OAuth client credentials are configured. */
export function hasGuestyAuthConfigured(): boolean {
  if (process.env.GUESTY_ACCESS_TOKEN?.trim()) return true;
  return Boolean(readClientCredentials());
}

export async function fetchAccessToken(creds: {
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const tokenUrl = (
    process.env.GUESTY_OAUTH_TOKEN_URL ?? "https://open-api.guesty.com/oauth2/token"
  ).replace(/\/$/, "");

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "open-api",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Guesty OAuth token exchange failed (${res.status} ${res.statusText}): ${text.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Guesty OAuth response missing access_token");
  }
  return data.access_token;
}
