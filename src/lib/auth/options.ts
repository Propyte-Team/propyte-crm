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
  adapter: PrismaAdapter(prisma) as NextAuthOptions["adapter"],

  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 horas
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
        loginMethod: { label: "Método", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Correo y contraseña son requeridos");
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
          select: {
            id: true,
            email: true,
            name: true,
            passwordHash: true,
            otpHash: true,
            otpExpiresAt: true,
            role: true,
            plaza: true,
            careerLevel: true,
            isActive: true,
          },
        });

        if (!user) {
          throw new Error("Credenciales inválidas");
        }

        if (!user.isActive) {
          throw new Error("Cuenta desactivada. Contacta al administrador.");
        }

        const isOtp = credentials.loginMethod === "otp";

        if (isOtp) {
          // Verificar código OTP
          if (!user.otpHash || !user.otpExpiresAt) {
            throw new Error("No hay código pendiente. Solicita uno nuevo.");
          }

          if (new Date() > user.otpExpiresAt) {
            throw new Error("Código expirado. Solicita uno nuevo.");
          }

          const otpValid = await compare(credentials.password, user.otpHash);
          if (!otpValid) {
            throw new Error("Código inválido");
          }

          // Limpiar OTP después de uso exitoso
          await prisma.user.update({
            where: { id: user.id },
            data: { otpHash: null, otpExpiresAt: null },
          });
        } else {
          // Verificar contraseña
          if (!user.passwordHash) {
            throw new Error("Credenciales inválidas");
          }

          const passwordValid = await compare(credentials.password, user.passwordHash);
          if (!passwordValid) {
            throw new Error("Credenciales inválidas");
          }
        }

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
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.plaza = user.plaza;
        token.careerLevel = user.careerLevel;
      }
      return token;
    },

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

  secret: process.env.NEXTAUTH_SECRET,
};
