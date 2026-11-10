import type { DependenciasDeConsultasDeCaja } from "./contrato";
import type { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import { armarListarCajas } from "./listar-cajas";
import { armarListarCuentasDeCobro } from "./listar-cuentas-de-cobro";
import { armarListarMediosDePago } from "./listar-medios-de-pago";

/**
 * Las consultas por pantalla de caja (ADR-005). El `satisfies` exige que cada una tenga su declaración (qué acción exige): una consulta
 * sin declarar, o con una acción que no existe en el catálogo, no compila. Hoy, la configuración; la operación la suman los tramos
 * siguientes.
 */
export function crearConsultasDeCaja(dependencias: DependenciasDeConsultasDeCaja) {
  return {
    listarCajas: armarListarCajas(dependencias),
    listarMediosDePago: armarListarMediosDePago(dependencias),
    listarCuentasDeCobro: armarListarCuentasDeCobro(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES_DE_CONSULTAS, unknown>;
}

export type ConsultasDeCaja = ReturnType<typeof crearConsultasDeCaja>;
