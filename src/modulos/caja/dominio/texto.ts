import { explicacionDesdeTexto } from "../../cierre/publico";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * Los textos libres de caja (motivos, observación del cierre) usan LA lista de permitidos de la explicación del cierre
 * (`cierre/dominio/explicacion.ts`; decisión del diseño de 0027, C7): una regla, un lugar. El motivo es obligatorio; la observación,
 * opcional. La base repite la lista en `movimiento_caja_motivo_ck`, `correccion_de_medio_motivo_ck` y `sesion_caja_observacion_ck`.
 */
export function motivoObligatorio(
  texto: string | null | undefined,
): Resultado<string, "MOTIVO_INVALIDO"> {
  const explicacion = explicacionDesdeTexto(texto);
  if (!explicacion.ok || explicacion.valor === null) return err("MOTIVO_INVALIDO");
  return ok(explicacion.valor);
}

export function observacionOpcional(
  texto: string | null | undefined,
): Resultado<string | null, "OBSERVACION_INVALIDA"> {
  const explicacion = explicacionDesdeTexto(texto);
  return explicacion.ok ? explicacion : err("OBSERVACION_INVALIDA");
}
