import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaCivilDesdeTexto } from "../../../primitivas/tiempo/fecha-civil";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  alcanceParaMirar,
  exigirPermisoDeConsulta,
  sesionDeConsulta,
  sucursalElegida,
  type ErrorDeConsulta,
  type SesionDeConsulta,
} from "./comun";
import type { DependenciasDeConsultasDeCaja } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type EntradaDeListarSesiones = Readonly<{
  sucursalId: string;
  /** Primera fecha de NEGOCIO (inclusive), `YYYY-MM-DD`. */
  desde: string;
  /** Última fecha de NEGOCIO (inclusive), `YYYY-MM-DD`. */
  hasta: string;
}>;

/** Tope de sesiones por pedido (las más recientes primero): acota lo que lee y devuelve una consulta. */
export const MAXIMO_DE_SESIONES_POR_PEDIDO = 100;

export type ErrorAlListarSesiones = ErrorDeConsulta | "FECHA_INVALIDA" | ErrorDePersistencia;

/**
 * Las sesiones de una sucursal entre dos fechas de NEGOCIO (no de calendario: una sesión abierta a las 05:30 con corte 06:00 es de la
 * jornada anterior), de la más nueva a la más vieja, hasta 100 (e3 §3.10). `cajas.ver`, `read committed`, alcance de sucursal: nunca
 * «todas» si no se eligió una. Fechas mal escritas o `desde` posterior a `hasta` → `FECHA_INVALIDA`.
 */
export function armarListarSesiones({ transacciones, reglas }: DependenciasDeConsultasDeCaja) {
  return async function listarSesiones(
    contexto: ContextoOperativo,
    entrada: EntradaDeListarSesiones,
  ): Promise<Resultado<readonly SesionDeConsulta[], ErrorAlListarSesiones>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<Resultado<readonly SesionDeConsulta[], ErrorDeConsulta | "FECHA_INVALIDA">> => {
        const permiso = await exigirPermisoDeConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.listarSesiones.accion,
        );
        if (!permiso.ok) return permiso;
        const sucursal = sucursalElegida(await alcanceParaMirar(tx, contexto), entrada.sucursalId);
        if (!sucursal.ok) return sucursal;
        const desde = fechaCivilDesdeTexto(typeof entrada.desde === "string" ? entrada.desde : "");
        const hasta = fechaCivilDesdeTexto(typeof entrada.hasta === "string" ? entrada.hasta : "");
        // `YYYY-MM-DD` ordena como texto igual que como fecha.
        if (!desde.ok || !hasta.ok || desde.valor > hasta.valor) return err("FECHA_INVALIDA");
        const sesiones = await tx.sesiones.listar({
          empresa: contexto.empresaId,
          sucursal: sucursal.valor,
          desde: desde.valor,
          hasta: hasta.valor,
          limite: MAXIMO_DE_SESIONES_POR_PEDIDO,
        });
        return ok(sesiones.map(sesionDeConsulta));
      },
    );
  };
}
