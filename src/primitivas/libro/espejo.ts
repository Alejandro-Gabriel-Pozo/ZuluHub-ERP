import { err, ok, type Resultado } from "../resultado/resultado";

/** Lo mínimo de un asiento que mira la regla del espejo. `M` es la medida del libro (importe o cantidad con signo). */
export type AsientoParaEspejo<M> = Readonly<{
  id: string;
  parteId: string;
  sentido: string;
  clase: string;
  magnitud: M;
  anulaA: string | null;
}>;

/** El espejo todavía no tiene `id`: lo asigna quien lo inserta (esta pieza es pura, sin azar). */
export type EspejoSinId<M> = Omit<AsientoParaEspejo<M>, "id">;

export type ErrorDeEspejo = "YA_ES_UNA_ANULACION" | "DETALLE_OBLIGATORIO";

/** Un asiento se puede anular si no es él mismo una anulación (no se anula una anulación). */
export function esAnulable<M>(a: AsientoParaEspejo<M>): boolean {
  return a.anulaA === null;
}

/**
 * El espejo de un asiento: misma parte, sentido y clase; la magnitud invertida por `invertir` (la medida del libro sabe cómo);
 * `anulaA` apunta al original. Exige un detalle (el motivo) con algún carácter que no sea espacio.
 */
export function espejoDe<M>(
  a: AsientoParaEspejo<M>,
  detalle: string,
  invertir: (magnitud: M) => M,
): Resultado<EspejoSinId<M>, ErrorDeEspejo> {
  if (!esAnulable(a)) return err("YA_ES_UNA_ANULACION");
  if (detalle.trim() === "") return err("DETALLE_OBLIGATORIO");
  return ok({
    parteId: a.parteId,
    sentido: a.sentido,
    clase: a.clase,
    magnitud: invertir(a.magnitud),
    anulaA: a.id,
  });
}
