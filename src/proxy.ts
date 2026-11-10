import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, decrypt } from "@/lib/jwt";

// Optimistic redirects only; pages and actions still verify the session and workspace.
export async function proxy(req: NextRequest) {
  const session = await decrypt(req.cookies.get(SESSION_COOKIE)?.value);
  const { pathname, searchParams } = req.nextUrl;
  const protectedPath = ["/app", "/admin", "/dashboard"].some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (protectedPath && !session?.userId) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (pathname === "/dashboard") return NextResponse.redirect(new URL("/app", req.nextUrl));

  if ((pathname === "/login" || pathname === "/signup") && session?.userId) {
    const invite = searchParams.get("invite");
    const next = searchParams.get("next");
    const dest = invite ? `/invite/${invite}` : next?.startsWith("/") && !next.startsWith("//") ? next : "/app";
    return NextResponse.redirect(new URL(dest, req.nextUrl));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/app", "/admin/:path*", "/admin", "/dashboard/:path*", "/dashboard", "/login", "/signup"],
};
