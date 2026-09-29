/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 15: esta clave se graduó de "experimental" y se movió a la raíz
  // (antes era experimental.serverComponentsExternalPackages).
  serverExternalPackages: ["@prisma/client", "bcryptjs", "sharp"],
  experimental: {
    // Reduce el uso de memoria pico de Webpack durante `next build` a cambio de un
    // ligero aumento en el tiempo de compilación. Disponible desde Next 15.0.0,
    // documentado como "de bajo riesgo" aunque sigue marcado experimental. Se activó
    // tras un OOM real (`JavaScript heap out of memory`) en el build de la migración
    // #805 en Windows — ver COMO-APLICAR-805 para el resto de los pasos de mitigación.
    webpackMemoryOptimizations: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
