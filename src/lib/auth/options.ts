import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { compare } from "bcryptjs";
import prisma from "@/lib/db";
import { registrarIntento, olvidarIntentos } from "@/lib/security/rate-limit";

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

        const correo = credentials.email.toLowerCase().trim();
        const politica = credentials.loginMethod === "otp" ? "otp_verificar" : "login";

        // #714 (S-06): el login no tenía NINGÚN tope de intentos, y este `authorize` es la
        // puerta de las dos credenciales — contraseña y código de acceso. El código es el
        // caso grave: son 6 dígitos que viven 10 minutos, y hasta ahora se podían probar
        // aquí sin límite igual que en reset-password. Por eso la política se elige según
        // el método y no es una sola: 5 intentos para el código, 10 para la contraseña.
        //
        // Se cuenta ANTES de la consulta y de bcrypt, que es lo que cuesta. Y se cuenta
        // aunque el correo no exista: si solo se contaran los usuarios reales, el propio
        // contador diría cuáles lo son.
        //
        // Va por correo, no por IP: `authorize` de NextAuth no recibe las cabeceras del
        // proxy de forma fiable, y el blanco de un ataque a una contraseña es una cuenta
        // concreta. Lo que esto NO frena es un ataque distribuido contra muchas cuentas a
        // la vez — está declarado en lib/security/rate-limit.ts.
        const limite = registrarIntento(politica, correo);
        if (!limite.permitido) {
          const minutos = Math.ceil(limite.esperarMs / 60000);
          throw new Error(
            `Demasiados intentos. Espera ${minutos} minuto${minutos === 1 ? "" : "s"} e inténtalo de nuevo.`,
          );
        }

        const user = await prisma.user.findUnique({
          where: { email: correo },
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

        // Entró: se olvidan los fallos previos de ESTE método. Quien se equivocó de
        // contraseña nueve veces y acertó a la décima no debe arrastrar el castigo al
        // siguiente cuarto de hora — ya demostró que la cuenta es suya.
        olvidarIntentos(politica, correo);

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
