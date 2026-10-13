import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import type { DependenciasDeConsultasDeEmpresas } from "./contrato";
import type { SucursalDeLista } from "./sucursales";

export type EntradaDeListarSucursales = Readonly<{
  /** `false` (por defecto en las pantallas): solo las activas. */
  incluirInactivas: boolean;
}>;

export type ErrorAlListarSucursales = MotivoDeRechazo | ErrorDePersistencia;

/**
 * Las sucursales de la empresa del contexto (pantalla «Sucursales», H6 §B.5). Pide `sucursales.ver`
 * al guard dentro de su transacción (`read committed`, solo lectura) y devuelve una sola empresa,
 * ordenada por nombre e id. Con `incluirInactivas: false` solo las activas.
 */
export function armarListarSucursales({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeEmpresas) {
  return async function listarSucursales(
    contexto: ContextoOperativo,
    entrada: EntradaDeListarSucursales,
  ): Promise<Resultado<readonly SucursalDeLista[], ErrorAlListarSucursales>> {
    const { empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<readonly SucursalDeLista[], MotivoDeRechazo>> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.listarSucursales.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const empresa = await tx.empresas.obtener(empresaId);
        if (empresa === null)
          throw new Error(`la empresa ${empresaId} no es visible para el contexto`);
        const sucursales = entrada.incluirInactivas
          ? await tx.sucursales.listar(empresaId)
          : await tx.sucursales.listarActivas(empresaId);
        return ok(
          sucursales.map((s) => ({
            id: s.id,
            nombre: s.nombre,
            activa: s.activa,
            horaDeCorte: s.horaDeCorte,
            version: s.version,
            zonaHoraria: empresa.zonaHoraria,
          })),
        );
      },
    );
  };
}
