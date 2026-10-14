import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const configuracion: NextConfig = {
  // Sin la cabecera X-Powered-By: no se avisa qué framework hay detrás.
  poweredByHeader: false,
  // La raíz del repositorio (donde está el único package-lock.json): así la función incluye `src/` y
  // `migraciones/`, que viven fuera de `apps/web`.
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  // `pg` y la librería de ingreso se cargan en tiempo de ejecución desde node_modules; no se empaquetan
  // (la librería trae adaptadores opcionales de otras bases que el empaquetador no sabe resolver).
  serverExternalPackages: ["pg", "better-auth"],
};

export default configuracion;
