import { armarAbrirOrden } from "./abrir-orden";
import { armarAnularOrden, armarCancelarOrden } from "./cancelar-y-anular";
import { armarCerrarOrden } from "./cerrar-orden";
import type { DependenciasDeProduccion } from "./contrato";
import type { DECLARACIONES } from "./declaraciones";

/**
 * Los casos de uso de producción, listos para que la composición los ofrezca. El `satisfies` exige que sean EXACTAMENTE los que declara
 * `DECLARACIONES`: uno nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeProduccion(dependencias: DependenciasDeProduccion) {
  return {
    abrirOrden: armarAbrirOrden(dependencias),
    cerrarOrden: armarCerrarOrden(dependencias),
    cancelarOrden: armarCancelarOrden(dependencias),
    anularOrden: armarAnularOrden(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDeProduccion = ReturnType<typeof crearCasosDeUsoDeProduccion>;
