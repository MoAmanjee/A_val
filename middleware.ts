import { NextResponse, type NextRequest } from "next/server";

const CUSTOMER_HOSTS = new Set(["mochachospotch.co.za", "www.mochachospotch.co.za"]);

function hostName(req: NextRequest) {
  return (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
}

export function middleware(req: NextRequest) {
  const host = hostName(req);
  const { pathname } = req.nextUrl;

  // Free staff subdomain — no second domain purchase needed.
  if (host === "kitchen.mochachospotch.co.za") {
    if (pathname === "/" || pathname === "") {
      const url = req.nextUrl.clone();
      url.pathname = "/kitchen";
      return NextResponse.rewrite(url);
    }
    if (pathname === "/order" || pathname.startsWith("/order/") || pathname.startsWith("/setup/")) {
      return NextResponse.redirect(new URL(`https://mochachospotch.co.za${pathname}`));
    }
    return NextResponse.next();
  }

  // Main shop domain → customer order menu (not kitchen).
  if (CUSTOMER_HOSTS.has(host) || host.endsWith(".apps.newhost.co.za")) {
    if (pathname === "/" || pathname === "") {
      const url = req.nextUrl.clone();
      url.pathname = "/order";
      return NextResponse.rewrite(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/order/:path*", "/setup/:path*"],
};
