import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import type { DependenciasDeConsultasDeEmpresas } from "./contrato";
import type { FichaDeSucursal } from "./sucursales";

export type EntradaDeFichaDeSucursal = Readonly<{ sucursalId: SucursalId }>;

export type ErrorAlPedirLaFichaDeSucursal = MotivoDeRechazo | ErrorDePersistencia;

/**
 * La ficha de una sucursal (H6 §B.5). Pide `sucursales.ver` al guard dentro de su transacción
 * (`read committed`, solo lectura). Devuelve `null` si no existe en esta empresa: la de otra empresa
 * es indistinguible de una que no existe.
 */
export function armarFichaDeSucursal({ transacciones, reglas }: DependenciasDeConsultasDeEmpresas) {
  return async function fichaDeSucursal(
    contexto: ContextoOperativo,
    entrada: EntradaDeFichaDeSucursal,
  ): Promise<Resultado<FichaDeSucursal | null, ErrorAlPedirLaFichaDeSucursal>> {
    const { empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<FichaDeSucursal | null, MotivoDeRechazo>> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.fichaDeSucursal.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const empresa = await tx.empresas.obtener(empresaId);
        if (empresa === null)
          throw new Error(`la empresa ${empresaId} no es visible para el contexto`);
        const sucursal = await tx.sucursales.obtener(empresaId, entrada.sucursalId);
        if (sucursal === null) return ok(null);
        return ok({
          id: sucursal.id,
          nombre: sucursal.nombre,
          activa: sucursal.activa,
          horaDeCorte: sucursal.horaDeCorte,
          version: sucursal.version,
          zonaHoraria: empresa.zonaHoraria,
        });
      },
    );
  };
}
