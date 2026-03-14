import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

// Middleware de autenticación para proteger rutas del CRM
export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    // Si no hay token, redirigir a login (manejado por withAuth automáticamente)
    if (!token) {
      return NextResponse.redirect(new URL("/login", req.url));
    }

    // Verificar acceso al portal de desarrolladores externos
    if (pathname.startsWith("/portal")) {
      // Solo DEVELOPER_EXT puede acceder al portal
      if (token.role !== "DEVELOPER_EXT") {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
    }

    // Verificar acceso a rutas administrativas
    if (pathname.startsWith("/dashboard/admin")) {
      const adminRoles = ["ADMIN", "SUPER_ADMIN"];
      if (!adminRoles.includes(token.role as string)) {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
    }

    // Verificar acceso a configuración de plazas
    if (pathname.startsWith("/dashboard/plazas")) {
      const plazaRoles = ["MANAGER", "ADMIN", "SUPER_ADMIN"];
      if (!plazaRoles.includes(token.role as string)) {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      // Permitir acceso solo si existe un token válido
      authorized: ({ token }) => !!token,
    },
  }
);

// Rutas protegidas por el middleware
export const config = {
  matcher: [
    // Proteger todas las rutas del dashboard
    "/dashboard/:path*",
    // Proteger el portal de clientes
    "/portal/:path*",
    // Proteger rutas de API (excepto auth y webhooks externos)
    "/api/contacts/:path*",
    "/api/deals/:path*",
    "/api/activities/:path*",
    "/api/reports/:path*",
    "/api/users/:path*",
    "/api/commissions/:path*",
    "/api/teams/:path*",
    "/api/plazas/:path*",
    "/api/imports/:path*",
    "/api/twilio/:path*",
    "/api/messages/:path*",
    // Nota: /api/webhooks/** NO está protegido — usa firma Twilio o API key
  ],
};
