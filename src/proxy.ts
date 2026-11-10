import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, decrypt } from "@/lib/jwt";

// Optimistic redirect only; pages still verify the session via the DAL.
export async function proxy(req: NextRequest) {
  const session = await decrypt(req.cookies.get(SESSION_COOKIE)?.value);
  const path = req.nextUrl.pathname;

  if (path.startsWith("/dashboard") && !session?.userId) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  if ((path === "/login" || path === "/signup") && session?.userId) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/signup"],
};
