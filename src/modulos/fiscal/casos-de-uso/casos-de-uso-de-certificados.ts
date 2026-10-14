import { armarCargarCertificado } from "./cargar-certificado";
import type { DependenciasDeCertificados } from "./contrato-de-certificados";
import type { DECLARACIONES_DE_CERTIFICADOS } from "./declaraciones-de-certificados";
import { armarGenerarPedidoDeCertificado } from "./generar-pedido-de-certificado";

/**
 * Los casos de uso de certificados de ARCA (H7 facturación, F7), listos para que la composición los ofrezca. El
 * `satisfies` exige que sean EXACTAMENTE los que declara `DECLARACIONES_DE_CERTIFICADOS`: un caso nuevo sin
 * declarar, o una declaración sin caso, no compila.
 */
export function crearCasosDeUsoDeCertificados(dependencias: DependenciasDeCertificados) {
  return {
    generarPedidoDeCertificado: armarGenerarPedidoDeCertificado(dependencias),
    cargarCertificado: armarCargarCertificado(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES_DE_CERTIFICADOS, unknown>;
}

export type CasosDeUsoDeCertificados = ReturnType<typeof crearCasosDeUsoDeCertificados>;
