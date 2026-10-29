import { describe, expect, it } from "vitest";
import {
  createAuthCallbackUrl,
  createAuthEntryPath,
  consumeBrowserOAuthReturnPath,
  consumeOAuthReturnPath,
  getPostAuthPath,
  getSafeReturnPath,
  isPasswordRecoveryCallbackUrl,
  readLastVisitedPath,
  readBrowserOAuthReturnPath,
  readOAuthReturnPath,
  saveBrowserOAuthReturnPath,
  saveLastVisitedPath,
  saveOAuthReturnPath,
} from "@/lib/auth-redirect";

describe("auth redirect handling", () => {
  it.each([
    ["/account", "/account"],
    ["/checkout?item=steel", "/checkout?item=steel"],
    ["/", "/"],
    ["//example.com", "/"],
    ["https://example.com/account", "/"],
    ["/\\example.com", "/"],
  ])("accepts only safe in-app return paths (%s)", (input, expected) => {
    expect(getSafeReturnPath(input)).toBe(expected);
  });

  it("builds a same-origin auth callback with the requested return path", () => {
    expect(createAuthCallbackUrl("https://shop.example", "/account?tab=orders")).toBe(
      "https://shop.example/auth?next=%2Faccount%3Ftab%3Dorders",
    );
  });

  it.each(["http://localhost:8090", "http://127.0.0.1:8090", "http://192.168.1.14:8090"])(
    "keeps the selected watch in the auth callback on %s",
    (origin) => {
      expect(createAuthCallbackUrl(origin, "/shop/rosegold")).toBe(
        `${origin}/auth?next=%2Fshop%2Frosegold`,
      );
    },
  );

  it("preserves the home page as the post-auth destination", () => {
    expect(createAuthCallbackUrl("https://shop.example", "/")).toBe(
      "https://shop.example/auth?next=%2F",
    );
  });

  it("preserves the selected watch on a phone using the local network address", () => {
    expect(createAuthCallbackUrl("http://192.168.1.14:8090", "/shop/gold")).toBe(
      "http://192.168.1.14:8090/auth?next=%2Fshop%2Fgold",
    );
  });

  it("preserves the selected watch page and its state through the auth callback", () => {
    const selectedWatch = "/shop/steel?variant=42#details";
    expect(createAuthEntryPath(selectedWatch)).toBe(
      "/auth?next=%2Fshop%2Fsteel%3Fvariant%3D42%23details",
    );
    expect(createAuthCallbackUrl("https://shop.example", selectedWatch)).toBe(
      "https://shop.example/auth?next=%2Fshop%2Fsteel%3Fvariant%3D42%23details",
    );
  });

  it("returns users to the original screen and safely falls back to home", () => {
    expect(getPostAuthPath("/shop/steel?variant=gold#reviews")).toBe(
      "/shop/steel?variant=gold#reviews",
    );
    expect(getPostAuthPath(null)).toBe("/");
    expect(getPostAuthPath("//example.com")).toBe("/");
  });

  it.each([
    ["https://shop.example/#access_token=token&type=recovery", true],
    ["https://shop.example/reset-password?token_hash=token&type=recovery", true],
    ["https://shop.example/reset-password?recovery=1", true],
    ["https://shop.example/?next=%2Faccount", false],
  ])("recognizes password recovery callbacks (%s)", (input, expected) => {
    expect(isPasswordRecoveryCallbackUrl(new URL(input))).toBe(expected);
  });

  it("returns profile-link sign-ins to their original page instead of the profile editor", () => {
    expect(getPostAuthPath("/account")).toBe("/account");
    expect(getPostAuthPath("/shop/steel?variant=gold")).toBe("/shop/steel?variant=gold");
  });

  it("persists return destinations in auth entry and callback URLs", () => {
    expect(createAuthEntryPath("/checkout?item=steel")).toBe(
      "/auth?next=%2Fcheckout%3Fitem%3Dsteel",
    );
    expect(createAuthEntryPath("/account", true)).toBe("/auth?view=profile&next=%2Faccount");
    expect(createAuthEntryPath("/account")).toBe("/auth?next=%2Faccount");
    expect(createAuthCallbackUrl("https://shop.example", "/checkout?item=steel")).toBe(
      "https://shop.example/auth?next=%2Fcheckout%3Fitem%3Dsteel",
    );
  });

  it("saves a safe OAuth destination and consumes it once", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };

    saveOAuthReturnPath(storage, "/checkout?item=steel", 1000);

    expect(readOAuthReturnPath(storage, 2000)).toBe("/checkout?item=steel");
    expect(readOAuthReturnPath(storage, 2000)).toBe("/checkout?item=steel");
    expect(consumeOAuthReturnPath(storage, 2000)).toBe("/checkout?item=steel");
    expect(consumeOAuthReturnPath(storage, 2000)).toBeNull();
  });

  it("persists and consumes the OAuth destination across browser storage areas", () => {
    localStorage.clear();
    sessionStorage.clear();
    saveBrowserOAuthReturnPath("/shop/steel?variant=42");

    expect(readBrowserOAuthReturnPath()).toBe("/shop/steel?variant=42");
    expect(consumeBrowserOAuthReturnPath()).toBe("/shop/steel?variant=42");
    expect(readBrowserOAuthReturnPath()).toBeNull();
  });

  it("remembers the last visited screen but never remembers auth or reset pages", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };

    saveLastVisitedPath(storage, "/shop/steel?variant=42");
    expect(readLastVisitedPath(storage)).toBe("/shop/steel?variant=42");

    saveLastVisitedPath(storage, "/");
    expect(readLastVisitedPath(storage)).toBe("/");
    saveLastVisitedPath(storage, "/auth?next=%2F");
    expect(readLastVisitedPath(storage)).toBe("/");
    saveLastVisitedPath(storage, "/reset-password");
    expect(readLastVisitedPath(storage)).toBe("/");
  });

  it("rejects expired and unsafe OAuth return destinations", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };

    saveOAuthReturnPath(storage, "//example.com", 1000);
    expect(consumeOAuthReturnPath(storage, 1000)).toBe("/");

    saveOAuthReturnPath(storage, "/account", 1000);
    expect(consumeOAuthReturnPath(storage, 15 * 60 * 1000 + 1001)).toBeNull();
  });
});
