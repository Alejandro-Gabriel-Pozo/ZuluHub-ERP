import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const configuracion: NextConfig = {
  poweredByHeader: false,
  // La raíz del repositorio (donde está el único package-lock.json): la función incluye `src/`, que vive fuera.
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  // La consola reutiliza la interfaz de `apps/web/ui` (UX1 §4): se compila desde fuera de su carpeta.
  experimental: { externalDir: true },
  serverExternalPackages: ["pg", "better-auth"],
};

export default configuracion;
