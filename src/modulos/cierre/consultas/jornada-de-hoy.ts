import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaDeNegocio, type ErrorDeJornada } from "../../../primitivas/tiempo/fecha-de-negocio";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { datosDeJornada } from "../../empresas/publico";
import type { EstadoConsultado } from "../estados";
import { FORMA_DE_UUID } from "../persistencia/repositorio-de-jornadas";
import { exigirAlcanceDeConsulta, exigirPermisoDeConsulta, type ErrorDeConsulta } from "./comun";
import type { DependenciasDeConsultasDeCierre, TxDeConsultasDeCierre } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type EntradaDeJornadaDeHoy = Readonly<{ sucursalId: string }>;

/** La fecha de negocio de hoy en la sucursal (`AAAA-MM-DD`) y el estado de esa jornada; `SIN_ACTIVIDAD` si todavía no existe. */
export type JornadaDeHoy = Readonly<{ fechaDeNegocio: string; estado: EstadoConsultado }>;

export type ErrorAlPedirLaJornadaDeHoy =
  ErrorDeConsulta | ErrorDeJornada | ErrorDePersistencia | "JORNADA_NO_ENCONTRADA";

/**
 * Qué día de negocio es hoy en una sucursal y cómo está esa jornada (mostrador mínimo, X1). Pide `jornadas.ver` al guard dentro de su
 * transacción (`read committed`, solo lectura) y valida el alcance de sucursal. La fecha sale de `fechaDeNegocio(ahora, zona de la empresa,
 * hora de corte de la sucursal)` con lo que `datosDeJornada` lee ahora mismo, sin caché: la misma cuenta con la que caja sella sus
 * sesiones, así que no hay dos «hoy». SOLO LEE: no abre ni crea la jornada (`SIN_ACTIVIDAD` si nadie registró nada todavía, igual que
 * `estadoDeJornada`). Fail-closed: una sucursal inexistente, ajena o con zona o corte inválidos devuelve error, nunca una fecha supuesta.
 */
export function armarJornadaDeHoy<TAportes>({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeCierre<TAportes>) {
  return async function jornadaDeHoy(
    contexto: ContextoOperativo,
    entrada: EntradaDeJornadaDeHoy,
  ): Promise<Resultado<JornadaDeHoy, ErrorAlPedirLaJornadaDeHoy>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx: TxDeConsultasDeCierre,
      ): Promise<Resultado<JornadaDeHoy, ErrorAlPedirLaJornadaDeHoy>> => {
        const permiso = await exigirPermisoDeConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.jornadaDeHoy.accion,
        );
        if (!permiso.ok) return permiso;
        // Lo que se PERMITE: un uuid; cualquier otra cosa no puede ser una sucursal.
        if (typeof entrada.sucursalId !== "string" || !FORMA_DE_UUID.test(entrada.sucursalId)) {
          return err("JORNADA_NO_ENCONTRADA");
        }
        const sucursal = sucursalId(entrada.sucursalId);
        const alcance = await exigirAlcanceDeConsulta(tx, contexto, sucursal);
        if (!alcance.ok) return alcance;
        const datos = await datosDeJornada(tx, sucursal);
        if (!datos.ok) return err("JORNADA_NO_ENCONTRADA");
        const hoy = fechaDeNegocio(
          contexto.ahora,
          datos.valor.zonaHoraria,
          datos.valor.horaDeCorte,
        );
        if (!hoy.ok) return hoy;
        const jornada = await tx.jornadas.obtener({
          empresa: contexto.empresaId,
          sucursal,
          fecha: hoy.valor,
        });
        return ok({ fechaDeNegocio: hoy.valor, estado: jornada?.estado ?? "SIN_ACTIVIDAD" });
      },
    );
  };
}
