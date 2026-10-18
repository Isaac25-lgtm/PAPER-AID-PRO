import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    // RBAC: Guard all /admin routes strictly for ADMIN role
    if (pathname.startsWith("/admin")) {
      if (token?.role !== "ADMIN") {
        // Logged-in non-admin user trying to access /admin -> redirect to homepage with flag
        const url = new URL("/", req.url);
        url.searchParams.set("error", "unauthorized");
        return NextResponse.redirect(url);
      }
    }

    // Allow request to proceed
    return NextResponse.next();
  },
  {
    callbacks: {
      // Must return true if the user is considered authenticated to proceed to middleware function
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: "/login",
    },
  }
);

// Define which routes trigger the auth middleware
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/library/:path*",
    "/editor/:path*",
    "/saved/:path*",
    "/conversations/:path*",
    "/history/:path*",
    "/account/:path*",
    "/admin/:path*",
    "/research/:path*",
    "/agent/:path*",
  ],
};
