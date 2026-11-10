import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  alcanceParaMirar,
  exigirPermisoDeConsulta,
  sucursalElegida,
  type ErrorDeConsulta,
} from "./comun";
import type { DependenciasDeConsultasDeCaja } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type EntradaDeListarCuentasDeCobro = Readonly<{
  /** Solo las cuentas de esta sucursal. Omitida: las de las sucursales a las que llega quien mira (nunca las de otras). */
  sucursalId?: string | null;
  /** Por defecto, solo las activas. La pantalla de configuración las pide todas para poder reactivar. */
  incluirInactivas?: boolean;
}>;

export type CuentaDeLista = Readonly<{
  id: string;
  tipo: string;
  nombre: string;
  identificadorExterno: string | null;
  sucursalId: string;
  activa: boolean;
  version: number;
}>;

export type CuentasDeCobroDeLaEmpresa = Readonly<{ cuentas: readonly CuentaDeLista[] }>;

export type ErrorAlListarCuentasDeCobro = ErrorDeConsulta | ErrorDePersistencia;

/**
 * Las cuentas de cobro (e3 §3.10), con su versión. Pide `cajas.ver` al guard dentro de su transacción (`read committed`, solo lectura).
 * Con una sucursal, valida que sea del alcance de quien mira; sin ella, devuelve las cuentas de las sucursales a las que llega (el
 * operador, solo las suyas; una persona sin sucursales no ve ninguna). Ordenadas por sucursal y nombre.
 */
export function armarListarCuentasDeCobro({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeCaja) {
  return async function listarCuentasDeCobro(
    contexto: ContextoOperativo,
    entrada: EntradaDeListarCuentasDeCobro = {},
  ): Promise<Resultado<CuentasDeCobroDeLaEmpresa, ErrorAlListarCuentasDeCobro>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<CuentasDeCobroDeLaEmpresa, ErrorDeConsulta>> => {
        const permiso = await exigirPermisoDeConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.listarCuentasDeCobro.accion,
        );
        if (!permiso.ok) return permiso;
        const alcance = await alcanceParaMirar(tx, contexto);
        let sucursales = alcance === "TODAS" ? null : alcance;
        if (entrada.sucursalId !== undefined && entrada.sucursalId !== null) {
          const elegida = sucursalElegida(alcance, entrada.sucursalId);
          if (!elegida.ok) return elegida;
          sucursales = [elegida.valor];
        }
        const cuentas = await tx.cuentasDeCobro.listar(contexto.empresaId, {
          sucursales,
          incluirInactivas: entrada.incluirInactivas === true,
        });
        return ok({
          cuentas: cuentas.map((cuenta) => ({
            id: cuenta.id,
            tipo: cuenta.tipo,
            nombre: cuenta.nombre,
            identificadorExterno: cuenta.identificadorExterno,
            sucursalId: cuenta.sucursalId,
            activa: cuenta.activa,
            version: cuenta.version,
          })),
        });
      },
    );
  };
}
