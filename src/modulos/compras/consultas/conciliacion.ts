import {
  proponerConciliacionDentro,
  type PropuestaDeConciliacion,
} from "../casos-de-uso/proponer-conciliacion";
import { type Lector, type RDeConsulta } from "./comun";

export type { PropuestaDeConciliacion };

export function armarConsultasDeConciliacion(leer: Lector) {
  return {
    /** La propuesta de un toque para conciliar una factura de N3 o N4 (guard `conciliaciones.ver`); `null` si no existe o no es de N3 o N4. */
    proponerConciliacion(
      contexto: Parameters<Lector>[0],
      entrada: Readonly<{ comprobanteId: string }>,
    ): Promise<RDeConsulta<PropuestaDeConciliacion | null>> {
      return leer(contexto, ["conciliaciones.ver"], (tx) =>
        proponerConciliacionDentro(tx, contexto, entrada),
      );
    },
  };
}
