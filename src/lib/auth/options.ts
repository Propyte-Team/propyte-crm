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
    // #79x — marca puesta por el callback jwt de abajo cuando la revalidación contra la
    // base detecta que esta sesión ya no debe seguir viva. No se persiste en la cookie
    // como "revocado para siempre": se vuelve a calcular en cada lectura de sesión.
    revoked?: boolean;
  }
}

// Configuración principal de NextAuth
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as NextAuthOptions["adapter"],

  session: {
    strategy: "jwt",
    // #79x — bajado de 8h a 5h a pedido explícito (decisión de negocio, no un hallazgo
    // de auditoría): una sesión inactiva se cae más rápido. Sigue siendo "hasta 5h", no
    // "5h desde el login": NextAuth reemite el JWT (con un `iat`/`exp` nuevos) en cada
    // lectura de sesión, así que alguien activo no se desloguea a media tarea.
    maxAge: 5 * 60 * 60, // 5 horas
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
    // #79x — hasta aquí, este callback solo copiaba datos de `user` AL INICIAR SESIÓN y
    // nunca volvía a preguntarle a la base nada después: un usuario eliminado o al que le
    // acababan de cambiar la contraseña seguía con el CRM abierto hasta que su JWT
    // expirara solo (hasta 5h, ver session.maxAge). Ver también la tarjeta #777: esa
    // sigue abierta a propósito — DESACTIVAR (isActive:false) NO revalida aquí, fue una
    // decisión explícita dejar ese caso como estaba. Esto solo cubre las dos revocaciones
    // "duras": baja definitiva (deletedAt) y cambio de contraseña (passwordChangedAt).
    async jwt({ token, user }) {
      if (user) {
        // Login fresco: los datos vienen de `authorize()`, que YA validó isActive contra
        // la base en ese mismo instante — no hace falta repetir la consulta aquí.
        token.id = user.id;
        token.role = user.role;
        token.plaza = user.plaza;
        token.careerLevel = user.careerLevel;
        token.revoked = false;
        return token;
      }

      // Re-lectura de una sesión ya existente (getServerSession, /api/auth/session, el
      // polling de useSession en el cliente): aquí es donde antes no se comprobaba nada.
      try {
        const current = await prisma.user.findUnique({
          where: { id: token.id },
          select: { deletedAt: true, passwordChangedAt: true },
        });

        const eliminado = !current || current.deletedAt !== null;
        // `token.iat` (segundos, estándar JWT) es la última vez que ESTE JWT se firmó —
        // no el login original: NextAuth lo re-firma en cada lectura de sesión, así que
        // esta comparación sigue siendo correcta con una sesión que rueda.
        const passwordCambiadaDespues =
          !!current?.passwordChangedAt &&
          typeof token.iat === "number" &&
          current.passwordChangedAt.getTime() > token.iat * 1000;

        if (eliminado || passwordCambiadaDespues) {
          token.revoked = true;
        }
      } catch (err) {
        // Best-effort: si la base no responde, no tumbamos la sesión de todo el mundo por
        // un error transitorio de conexión — se mantiene el token tal como estaba.
        console.error("[auth] no se pudo revalidar la sesión:", err);
      }

      return token;
    },

    async session({ session, token }) {
      // Con el token marcado, `null` es el patrón documentado de NextAuth v4 para forzar
      // el cierre de sesión: useSession()/getServerSession() devuelven "sin sesión" en
      // vez de repetir los datos viejos. El tipo de esta función no incluye `null` en su
      // firma (solo Session | DefaultSession) aunque el propio NextAuth lo acepte en
      // runtime — de ahí el `as any`, acotado a esta única línea.
      if (token.revoked) return null as any;

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
