import { sucursalesEnAlcance } from "../../../capacidades/permisos/alcance";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { DependenciasDeConsultasDeEmpresas } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/** Una sucursal que la persona puede elegir (selector de sucursal): solo lo que la pantalla muestra. */
export type SucursalElegible = Readonly<{
  id: SucursalId;
  nombre: string;
  /** `false`: la sucursal está cerrada (se elige para ver su historial). El texto «cerrada» lo pone la pantalla. */
  activa: boolean;
}>;

export type ErrorAlListarSucursalesElegibles = MotivoDeRechazo | ErrorDePersistencia;

/**
 * Las sucursales que la persona del contexto puede ELEGIR para mirar (el selector de sucursal, D-18 y D-37): las de su empresa
 * que su alcance deja usar (`sucursalesEnAlcance`: gerente y administrador, todas; el operador, las que tiene asignadas),
 * ABIERTAS y CERRADAS, ordenadas por nombre, cada una con `activa` (las cerradas se eligen para ver su historial). Es la misma regla con la que el servidor verifica la sucursal elegida en las consultas
 * del facturador, así que lo que ofrece el selector es exactamente lo que esas consultas aceptan. A diferencia de
 * `listarSucursales` (que es de administración y pide `sucursales.ver`), la pueden pedir los tres roles: pide
 * `permisos.ver_propios`. Pide la acción al guard dentro de su transacción (`read committed`, solo lectura).
 */
export function armarSucursalesElegibles({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeEmpresas) {
  return async function sucursalesElegibles(
    contexto: ContextoOperativo,
  ): Promise<Resultado<readonly SucursalElegible[], ErrorAlListarSucursalesElegibles>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<readonly SucursalElegible[], MotivoDeRechazo>> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.sucursalesElegibles.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const alcance = await tx.autorizacion.sucursalesDelActor(contexto, {
          incluirDesactivadas: true,
        });
        const todas = await tx.sucursales.listar(contexto.empresaId);
        return ok(
          sucursalesEnAlcance(alcance, todas).map((s) => ({
            id: s.id,
            nombre: s.nombre,
            activa: s.activa,
          })),
        );
      },
    );
  };
}
