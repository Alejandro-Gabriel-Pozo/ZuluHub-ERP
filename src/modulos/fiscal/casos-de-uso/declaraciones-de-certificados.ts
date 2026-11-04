import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

/**
 * Los casos de uso de certificados de ARCA (spec H7 facturación §B.4 y §C, tramo F7) y la acción que cada uno exige
 * al guard (cruce X1 de ADR-003). Los dos son del gerente (`certificados.gestionar`, DECIDIDO): generan o cargan lo
 * que habilita a emitir con valor fiscal.
 */
export const DECLARACIONES_DE_CERTIFICADOS = {
  generarPedidoDeCertificado: {
    accion: "certificados.gestionar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: "test/integracion/certificados-casos.test.ts",
        it: "repetir con la misma clave devuelve el mismo pedido, SIN generar otra clave, ni escribir ni auditar",
      },
    },
  },
  cargarCertificado: {
    accion: "certificados.gestionar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/fiscal-certificados-web.test.ts",
        it: "el mismo certificado cargado dos veces: la segunda dice «ya estaba», con el mismo vencimiento, sin escribir ni auditar",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
