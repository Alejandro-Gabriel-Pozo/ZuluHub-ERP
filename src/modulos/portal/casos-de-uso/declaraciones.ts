import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

const ARCHIVO = "test/integracion/portal-casos-de-uso.test.ts";

/**
 * Los casos de uso del portal de la empresa y la acción que cada uno exige al guard (cruce X1 de ADR-003), con cómo se repite sin duplicar (ADR-015 §4) y la prueba que lo
 * fija. Además de la acción, `guardarPortalDeLaEmpresa` exige alcance sobre TODAS las sucursales (el portal es de toda la empresa): lo decide el servidor.
 */
export const DECLARACIONES = {
  guardarPortalDeLaEmpresa: {
    accion: "vidrieras.administrar_portal",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO,
        it: "P-1: guardarPortalDeLaEmpresa con el mismo id dos veces deja UN portal, un solo código y una entrada de auditoría; la segunda es yaExistia",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
