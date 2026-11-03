export function sameOriginUrl(request: Request, pathname: string) {
  const configuredUrl = process.env.APP_URL?.trim();
  if (configuredUrl) {
    try {
      return new URL(pathname, new URL(configuredUrl).origin);
    } catch {
      throw new Error("APP_URL must be a valid absolute URL.");
    }
  }

  const requestUrl = new URL(request.url);
  const host = request.headers.get("host")?.trim();
  if (host) {
    try {
      const hostname = new URL(`${requestUrl.protocol}//${host}`).hostname;
      if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
        return new URL(pathname, `${requestUrl.protocol}//${host}`);
      }
    } catch {}
  }
  const origin = requestUrl.origin;
  return new URL(pathname, origin);
}
