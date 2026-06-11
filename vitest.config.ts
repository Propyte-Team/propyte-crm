import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // intake/ y robots/ migraron al Hub (T2.3/T6); el CRM núcleo aún no tiene suites propias
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    passWithNoTests: true,
    environment: "node",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
