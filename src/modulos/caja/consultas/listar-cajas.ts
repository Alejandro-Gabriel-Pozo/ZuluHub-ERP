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

export type EntradaDeListarCajas = Readonly<{
  /** La sucursal de la que se piden las cajas: siempre una elegida, nunca «todas». */
  sucursalId: string;
  /** Por defecto, solo las activas. La pantalla de configuración las pide todas para poder reactivar. */
  incluirInactivas?: boolean;
}>;

export type CajaDeLista = Readonly<{
  id: string;
  sucursalId: string;
  nombre: string;
  activa: boolean;
  version: number;
}>;

/** Sin cajas, `cajas: []`: la pantalla avisa y pide la caja por defecto con su propio comando; esta consulta no escribe. */
export type CajasDeLaSucursal = Readonly<{ cajas: readonly CajaDeLista[] }>;

export type ErrorAlListarCajas = ErrorDeConsulta | ErrorDePersistencia;

/**
 * Las cajas de una sucursal (e3 §3.2.1 y §3.10). Pide `cajas.ver` al guard dentro de su transacción (`read committed`, solo lectura) y
 * valida que la sucursal sea del alcance de quien mira (el operador, solo las suyas). Ordenadas por nombre.
 */
export function armarListarCajas({ transacciones, reglas }: DependenciasDeConsultasDeCaja) {
  return async function listarCajas(
    contexto: ContextoOperativo,
    entrada: EntradaDeListarCajas,
  ): Promise<Resultado<CajasDeLaSucursal, ErrorAlListarCajas>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<CajasDeLaSucursal, ErrorDeConsulta>> => {
        const permiso = await exigirPermisoDeConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.listarCajas.accion,
        );
        if (!permiso.ok) return permiso;
        const sucursal = sucursalElegida(await alcanceParaMirar(tx, contexto), entrada.sucursalId);
        if (!sucursal.ok) return sucursal;
        const cajas = await tx.cajas.listarDeLaSucursal(contexto.empresaId, sucursal.valor, {
          incluirInactivas: entrada.incluirInactivas === true,
        });
        return ok({
          cajas: cajas.map((caja) => ({
            id: caja.id,
            sucursalId: caja.sucursalId,
            nombre: caja.nombre,
            activa: caja.activa,
            version: caja.version,
          })),
        });
      },
    );
  };
}
