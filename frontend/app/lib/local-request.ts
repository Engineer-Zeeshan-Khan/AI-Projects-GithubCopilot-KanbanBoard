export function isLocalSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (!origin || !host) {
    return false;
  }

  try {
    const originUrl = new URL(origin);
    return (
      originUrl.protocol === "http:" &&
      originUrl.host === host &&
      (originUrl.hostname === "localhost" || originUrl.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}