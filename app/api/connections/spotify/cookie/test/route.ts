import { NextResponse } from "next/server";
import crypto from "crypto";
import { requireAuth } from "@/lib/auth/session";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const TOTP_CIPHER = [12, 56, 76, 33, 88, 44, 88, 33, 78, 78, 11, 66, 22, 22, 55, 69, 54];

function makeTotp() {
  const processed = TOTP_CIPHER.map((b, i) => b ^ ((i % 33) + 9));
  const hexStr = processed.map((b) => b.toString()).join("");
  const secret = Buffer.from(hexStr, "utf-8");
  const counter = Math.floor(Date.now() / 30000);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binary % 1_000_000).toString().padStart(6, "0");
}

function browserHeaders(spDc: string, extra?: Record<string, string>) {
  return {
    Cookie: `sp_dc=${spDc}`,
    "User-Agent": UA,
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Upgrade-Insecure-Requests": "1",
    ...extra,
  };
}

export async function POST(request: Request) {
  const session = await requireAuth(request);
  void session;
  const body = await request.json().catch(() => ({}));
  const cookie = typeof body.cookie === "string" ? body.cookie.trim() : "";
  if (!cookie) return NextResponse.json({ error: "Provide cookie" }, { status: 400 });

  const results: Record<string, unknown> = {};

  const totp = makeTotp();
  const ts = Math.floor(Date.now() / 1000);
  for (const url of [
    `https://open.spotify.com/get_access_token?reason=init&productType=web-player&totp=${totp}&totpServer=${totp}&totpVer=5&ts=${ts}`,
    `https://open.spotify.com/get_access_token?reason=transport&productType=web_player&totp=${totp}&totpServer=${totp}&totpVer=5&ts=${ts}`,
    "https://open.spotify.com/get_access_token?reason=init&productType=web-player",
    "https://open.spotify.com/get_access_token?reason=transport&productType=web_player",
  ]) {
    try {
      const r = await fetch(url, {
        headers: browserHeaders(cookie, {
          Accept: "application/json",
          "App-Platform": "WebPlayer",
          Origin: "https://open.spotify.com",
          Referer: "https://open.spotify.com/",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
        }),
        redirect: "follow",
      });
      const text = await r.text();
      results[url] = { status: r.status, contentType: r.headers.get("content-type"), body: text.slice(0, 800) };
    } catch (err) {
      results[url] = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  try {
    const r = await fetch("https://open.spotify.com/", {
      headers: browserHeaders(cookie, {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
      }),
      redirect: "follow",
    });
    const html = await r.text();
    const finds = {
      hasSessionScript: /<script[^>]*id=["']session["'][^>]*>/i.test(html),
      hasConfigScript: /<script[^>]*id=["']config["'][^>]*>/i.test(html),
      hasNextData: /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>/i.test(html),
      mentionsAccessToken: html.includes("accessToken"),
      mentionsIsAnonymous: html.includes("isAnonymous"),
      mentionsLoginRedirect: html.includes("Log in") || html.includes("login.png"),
    };
    const sessionMatch = html.match(/<script[^>]*id=["']session["'][^>]*>([\s\S]*?)<\/script>/);
    const tokenSnippet = html.match(/.{0,80}accessToken.{0,200}/);
    results["https://open.spotify.com/"] = {
      status: r.status,
      contentType: r.headers.get("content-type"),
      length: html.length,
      finds,
      sessionScriptBody: sessionMatch?.[1]?.slice(0, 500) || null,
      tokenSnippet: tokenSnippet?.[0] || null,
    };
  } catch (err) {
    results["https://open.spotify.com/"] = { error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json({ cookieLength: cookie.length, cookiePreview: `${cookie.slice(0, 6)}...${cookie.slice(-6)}`, results });
}
