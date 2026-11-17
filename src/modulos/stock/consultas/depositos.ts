import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import type { UsoDeDeposito } from "../persistencia/modelo";
import { esUuid } from "../persistencia/filas";
import { type Lector, type RDeConsulta } from "./comun";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type DepositoDeLista = Readonly<{
  id: string;
  sucursalId: string;
  nombre: string;
  uso: UsoDeDeposito;
  deVenta: boolean;
  activo: boolean;
  version: number;
}>;

/**
 * Pestaña Depósitos (E5 §3.4): los depósitos de la empresa (activos e inactivos), por sucursal y nombre. Guard `stock.ver`; el operador solo ve
 * los de sus sucursales: el filtro es de la consulta (con una sucursal que no es suya, la lista sale vacía, no un error).
 */
export function armarConsultasDeDepositos(leer: Lector) {
  return {
    listarDepositos: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ sucursalId?: string | undefined }> = {},
    ): Promise<RDeConsulta<readonly DepositoDeLista[]>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.listarDepositos.accion, async (tx, alcance) => {
        if (entrada.sucursalId !== undefined && !esUuid(entrada.sucursalId)) return [];
        const depositos = await tx.depositos.listar(contexto.empresaId, {
          alcance,
          sucursalId: entrada.sucursalId === undefined ? undefined : sucursalId(entrada.sucursalId),
        });
        return depositos.map((d) => ({
          id: d.id,
          sucursalId: d.sucursalId,
          nombre: d.nombre,
          uso: d.uso,
          deVenta: d.deVenta,
          activo: d.activo,
          version: d.version,
        }));
      }),
  };
}
