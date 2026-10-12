import type { SucursalId } from "../../../primitivas/identificadores/marca";

/**
 * Una sucursal tal como la ve una pantalla (ADR-005): objeto plano, sin texto de marca. La sucursal
 * no tiene zona horaria propia: `zonaHoraria` es la de la empresa, para que la pantalla formatee las
 * fechas (que viajan en UTC). Si algún día tiene una propia, el contrato no cambia.
 */
export type SucursalDeLista = Readonly<{
  id: SucursalId;
  nombre: string;
  activa: boolean;
  version: number;
  zonaHoraria: string;
}>;

export type FichaDeSucursal = SucursalDeLista;
