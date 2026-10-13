import type { SucursalId } from "../../../primitivas/identificadores/marca";
import type { HoraDelDia } from "../../../primitivas/tiempo/hora-del-dia";

/**
 * Una sucursal tal como la ve una pantalla (ADR-005): objeto plano, sin texto de marca. La sucursal
 * no tiene zona horaria propia: `zonaHoraria` es la de la empresa, para que la pantalla formatee las
 * fechas (que viajan en UTC). Si algún día tiene una propia, el contrato no cambia. `horaDeCorte` es la
 * `HH:MM` desde la que rige su jornada (`00:00` por defecto).
 */
export type SucursalDeLista = Readonly<{
  id: SucursalId;
  nombre: string;
  activa: boolean;
  horaDeCorte: HoraDelDia;
  version: number;
  zonaHoraria: string;
}>;

export type FichaDeSucursal = SucursalDeLista;
