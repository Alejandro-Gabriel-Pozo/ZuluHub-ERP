import { exigirAccion } from "../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import type {
  ClaveAccionDePlataforma,
  ReglasDePlataforma,
} from "../../capacidades/permisos/plataforma";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import type { Resultado } from "../../primitivas/resultado/resultado";
import type { CargaDeAutorizacionDePlataforma } from "../../puertos/autorizacion-de-plataforma";

/**
 * El guard como PRIMER paso de cada consulta y caso de uso de plataforma (ADR-003): el administrador
 * del contexto se lee dentro de la transacción en curso (nada en caché: bajar a un administrador corta
 * su acceso en la operación siguiente) y la matriz decide. La plataforma no tiene módulos activables ni
 * sucursales, así que el único rechazo posible es `SIN_PERMISO`.
 */
export function exigirAccionDePlataforma(
  reglas: ReglasDePlataforma,
  accion: ClaveAccionDePlataforma,
  autorizacion: CargaDeAutorizacionDePlataforma,
  contexto: ContextoDePlataforma,
): Promise<Resultado<null, MotivoDeRechazo>> {
  return exigirAccion(reglas, accion, async () => ({
    ...(await autorizacion.delActor(contexto)),
    modulosActivados: [],
    modulosHabilitados: [],
  }));
}
