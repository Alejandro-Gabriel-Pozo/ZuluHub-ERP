import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const configuracion: NextConfig = {
  // Sin la cabecera X-Powered-By: no se avisa qué framework hay detrás.
  poweredByHeader: false,
  // La raíz del repositorio (donde está el único package-lock.json): así la función incluye `src/` y
  // `migraciones/`, que viven fuera de `apps/web`.
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  // `pg` y la librería de ingreso se cargan en tiempo de ejecución desde node_modules; no se empaquetan
  // (la librería trae adaptadores opcionales de otras bases que el empaquetador no sabe resolver). `pdfkit` también: carga sus tipografías
  // del propio paquete en tiempo de ejecución, y así la función de Vercel corre el mismo camino que probó `pdf-de-la-factura.test.ts`
  // (empaquetado, el PDF no tendría cómo probarse sin un despliegue). Chequeo: `test/arquitectura/pdf-en-la-funcion.test.ts`.
  serverExternalPackages: ["pg", "better-auth", "pdfkit"],
};

export default configuracion;
