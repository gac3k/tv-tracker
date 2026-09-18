import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Cookie",
  "Access-Control-Allow-Private-Network": "true",
};

const PUBLIC_PAGES = new Set(["/login", "/register"]);

function apiUrl(): string {
  return process.env.API_URL ?? "http://127.0.0.1:3000";
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", path);

  if (path.startsWith("/api")) {
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: cors });
    }
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    for (const [key, value] of Object.entries(cors)) {
      response.headers.set(key, value);
    }
    return response;
  }

  if (PUBLIC_PAGES.has(path) || path === "/mcp" || path.startsWith("/mcp/")) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const cookie = request.headers.get("cookie") ?? "";
  let signedIn = false;
  try {
    const res = await fetch(`${apiUrl()}/api/auth/get-session`, {
      headers: cookie ? { cookie } : {},
      cache: "no-store",
    });
    signedIn = res.ok && Boolean((await res.json())?.user);
  } catch {
    signedIn = false;
  }

  if (!signedIn) {
    const login = new URL("/login", request.url);
    return NextResponse.redirect(login);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
