import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { compare } from "bcryptjs";
import prisma from "@/lib/db";

// Extensión de tipos de NextAuth para incluir campos personalizados
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
      plaza: string;
      careerLevel: string;
      image?: string | null;
    };
  }

  interface User {
    id: string;
    role: string;
    plaza: string;
    careerLevel: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
    plaza: string;
    careerLevel: string;
  }
}

// Configuración principal de NextAuth
export const authOptions: NextAuthOptions = {
  // Adaptador de Prisma para persistencia de sesiones y cuentas
  adapter: PrismaAdapter(prisma) as NextAuthOptions["adapter"],

  // Estrategia JWT para sesiones stateless
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 horas de inactividad
  },

  pages: {
    signIn: "/login",
    error: "/login",
  },

  providers: [
    CredentialsProvider({
      name: "Credenciales",
      credentials: {
        email: { label: "Correo electrónico", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        // Validar que se proporcionaron ambos campos
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Correo y contraseña son requeridos");
        }

        // Buscar usuario por correo electrónico
        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
          select: {
            id: true,
            email: true,
            name: true,
            passwordHash: true,
            role: true,
            plaza: true,
            careerLevel: true,
            isActive: true,
          },
        });

        if (!user || !user.passwordHash) {
          throw new Error("Credenciales inválidas");
        }

        // Verificar que la cuenta esté activa
        if (!user.isActive) {
          throw new Error("Cuenta desactivada. Contacta al administrador.");
        }

        // Comparar contraseña con hash almacenado
        const passwordValid = await compare(credentials.password, user.passwordHash);
        if (!passwordValid) {
          throw new Error("Credenciales inválidas");
        }

        // Retornar datos del usuario autenticado
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          plaza: user.plaza,
          careerLevel: user.careerLevel,
        };
      },
    }),
  ],

  callbacks: {
    // Agregar campos personalizados al token JWT
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.plaza = user.plaza;
        token.careerLevel = user.careerLevel;
      }
      return token;
    },

    // Exponer campos del JWT en la sesión del cliente
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.plaza = token.plaza;
        session.user.careerLevel = token.careerLevel;
      }
      return session;
    },
  },

  // Clave secreta para firmar tokens
  secret: process.env.NEXTAUTH_SECRET,
};
