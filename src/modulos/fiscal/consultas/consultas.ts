import type { DependenciasDeConsultasDeFacturacion } from "./contrato";
import type { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import { armarListarComprobantes } from "./listar-comprobantes";
import { armarModeloDeImpresion } from "./modelo-de-impresion";
import { armarVerComprobante } from "./ver-comprobante";

/**
 * Las consultas por pantalla del facturador (ADR-005). El `satisfies` exige que sean EXACTAMENTE las que declara
 * `DECLARACIONES_DE_CONSULTAS` (qué acción exige cada una): una consulta sin declarar, o una declaración sin
 * consulta, no compila.
 */
export function crearConsultasDeFacturacion(dependencias: DependenciasDeConsultasDeFacturacion) {
  return {
    listarComprobantes: armarListarComprobantes(dependencias),
    verComprobante: armarVerComprobante(dependencias),
    modeloDeImpresion: armarModeloDeImpresion(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES_DE_CONSULTAS, unknown>;
}

export type ConsultasDeFacturacion = ReturnType<typeof crearConsultasDeFacturacion>;
