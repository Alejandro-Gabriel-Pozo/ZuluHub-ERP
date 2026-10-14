import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/**
 * Los casos de uso de certificados de ARCA (spec H7 facturación §B.4 y §C, tramo F7) y la acción que cada uno exige
 * al guard (cruce X1 de ADR-003). Los dos son del gerente (`certificados.gestionar`, DECIDIDO): generan o cargan lo
 * que habilita a emitir con valor fiscal.
 */
export const DECLARACIONES_DE_CERTIFICADOS = {
  generarPedidoDeCertificado: { accion: "certificados.gestionar" },
  cargarCertificado: { accion: "certificados.gestionar" },
} as const satisfies Record<string, DeclaracionDeCaso>;
