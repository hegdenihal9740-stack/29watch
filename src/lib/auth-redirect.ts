const APP_ORIGIN = "https://bigb.invalid";
const DEFAULT_POST_AUTH_PATH = "/";
const OAUTH_RETURN_STORAGE_KEY = "pf-auth-return-path";
const LAST_VISITED_PATH_STORAGE_KEY = "pf-last-visited-path";
const OAUTH_RETURN_MAX_AGE_MS = 15 * 60 * 1000;

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function getSafeReturnPath(
  value: string | null | undefined,
  fallback = DEFAULT_POST_AUTH_PATH,
): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  ) {
    return fallback;
  }

  try {
    const url = new URL(value, APP_ORIGIN);
    if (url.origin !== APP_ORIGIN) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function getPostAuthPath(returnPath: string | null | undefined): string {
  return getSafeReturnPath(returnPath, DEFAULT_POST_AUTH_PATH);
}

export function isPasswordRecoveryCallbackUrl(url: URL): boolean {
  const hash = new URLSearchParams(url.hash.slice(1));
  return (
    url.searchParams.get("type") === "recovery" ||
    hash.get("type") === "recovery" ||
    url.searchParams.get("recovery") === "1"
  );
}

export function createAuthEntryPath(returnPath: string, profile = false): string {
  const auth = new URL("/auth", APP_ORIGIN);
  if (profile) auth.searchParams.set("view", "profile");
  auth.searchParams.set("next", getPostAuthPath(returnPath));
  return `${auth.pathname}${auth.search}`;
}

export function createAuthCallbackUrl(origin: string, returnPath: string): string {
  const callback = new URL("/auth", origin);
  callback.searchParams.set("next", getSafeReturnPath(returnPath));
  return callback.toString();
}

export function saveLastVisitedPath(storage: KeyValueStorage, path: string): void {
  const safePath = getSafeReturnPath(path, "");
  if (safePath && !safePath.startsWith("/auth") && !safePath.startsWith("/reset-password")) {
    storage.setItem(LAST_VISITED_PATH_STORAGE_KEY, safePath);
  }
}

export function readLastVisitedPath(storage: KeyValueStorage): string | null {
  const saved = storage.getItem(LAST_VISITED_PATH_STORAGE_KEY);
  if (!saved) return null;
  const path = getSafeReturnPath(saved, "");
  return path && !path.startsWith("/auth") && !path.startsWith("/reset-password") ? path : null;
}

export function saveOAuthReturnPath(
  storage: KeyValueStorage,
  returnPath: string,
  now = Date.now(),
): void {
  storage.setItem(
    OAUTH_RETURN_STORAGE_KEY,
    JSON.stringify({
      path: getSafeReturnPath(returnPath, DEFAULT_POST_AUTH_PATH),
      createdAt: now,
    }),
  );
}

export function readOAuthReturnPath(storage: KeyValueStorage, now = Date.now()): string | null {
  const saved = storage.getItem(OAUTH_RETURN_STORAGE_KEY);
  if (saved === null) return null;

  try {
    const value: unknown = JSON.parse(saved);
    if (typeof value !== "object" || value === null) return null;
    if (!("path" in value) || typeof value.path !== "string") return null;
    if (!("createdAt" in value) || typeof value.createdAt !== "number") return null;
    if (now - value.createdAt < 0 || now - value.createdAt > OAUTH_RETURN_MAX_AGE_MS) return null;
    return getSafeReturnPath(value.path, DEFAULT_POST_AUTH_PATH);
  } catch {
    return null;
  }
}

export function consumeOAuthReturnPath(storage: KeyValueStorage, now = Date.now()): string | null {
  const saved = storage.getItem(OAUTH_RETURN_STORAGE_KEY);
  const returnPath = readOAuthReturnPath(storage, now);
  if (saved !== null) storage.removeItem(OAUTH_RETURN_STORAGE_KEY);
  return returnPath;
}

export function saveBrowserOAuthReturnPath(returnPath: string, now = Date.now()): void {
  if (typeof window === "undefined") return;
  saveOAuthReturnPath(localStorage, returnPath, now);
  try {
    saveOAuthReturnPath(sessionStorage, returnPath, now);
  } catch {
    /* Some mobile browsers restrict session storage. */
  }
}

export function readBrowserOAuthReturnPath(now = Date.now()): string | null {
  if (typeof window === "undefined") return null;
  return (
    readOAuthReturnPath(localStorage, now) ??
    (() => {
      try {
        return readOAuthReturnPath(sessionStorage, now);
      } catch {
        return null;
      }
    })()
  );
}

export function consumeBrowserOAuthReturnPath(now = Date.now()): string | null {
  if (typeof window === "undefined") return null;
  const returnPath = readBrowserOAuthReturnPath(now);
  localStorage.removeItem(OAUTH_RETURN_STORAGE_KEY);
  try {
    sessionStorage.removeItem(OAUTH_RETURN_STORAGE_KEY);
  } catch {
    /* Session storage is optional. */
  }
  return returnPath;
}
