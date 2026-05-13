export function sameOriginUrl(request: Request, pathname: string) {
  const host = request.headers.get("host") || "127.0.0.1:3000";
  const proto = request.headers.get("x-forwarded-proto") || "http";
  return new URL(pathname, `${proto}://${host}`);
}
