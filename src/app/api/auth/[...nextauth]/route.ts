import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth/options";

// Manejador de rutas de autenticación NextAuth (GET y POST)
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
