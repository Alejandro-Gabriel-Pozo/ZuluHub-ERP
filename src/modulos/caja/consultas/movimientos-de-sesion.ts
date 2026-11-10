import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import { esUuidCanonico } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  motivoNoAnulable,
  movimientoAnulableDe,
  type MotivoNoAnulable,
} from "../dominio/anulacion";
import type { ClaseDeMovimiento, EstadoDeSesion, TipoDeMedio } from "../estados";
import { exigirPermisoDeConsulta, sesionParaMirar, type ErrorDeConsultaDeSesion } from "./comun";
import type { DependenciasDeConsultasDeCaja } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/** El último `(registrado_en, id)` visto: de dónde sigue la página siguiente. `registradoEn` es ISO UTC. */
export type CursorDeLaLista = Readonly<{ registradoEn: string; id: string }>;

export type EntradaDeMovimientosDeSesion = Readonly<{
  sesionId: string;
  /** `null` o ausente: desde el principio. */
  despuesDe?: CursorDeLaLista | null;
  /** Hasta `MAXIMO_DE_MOVIMIENTOS_POR_PAGINA`; por defecto, el máximo. */
  limite?: number;
}>;

/** Tope de movimientos por pedido: acota lo que lee y devuelve una consulta (e3 §3.10). */
export const MAXIMO_DE_MOVIMIENTOS_POR_PAGINA = 100;

export type MovimientoDeLaSesion = Readonly<{
  id: string;
  clase: ClaseDeMovimiento;
  medioDePagoId: string;
  medioTipo: TipoDeMedio;
  medioNombre: string | null;
  cuentaDeCobroId: string | null;
  cuentaNombre: string | null;
  /** Con signo: entra > 0, sale < 0. */
  importe: ImporteJson;
  motivo: string | null;
  /** La anulación lleva el id del movimiento que anula. */
  anulaA: string | null;
  /** El id de la anulación de este movimiento, si ya se anuló. */
  anuladoPor: string | null;
  corrigeJornada: string | null;
  registradoEn: string;
  registradoPor: string;
  /** Solo un cobro trae su origen. */
  origen: Readonly<{ tipo: string; id: string }> | null;
  /** Calculados en el servidor con la MISMA regla que la anulación: la pantalla no decide. */
  anulablePorElActor: boolean;
  motivoNoAnulable: MotivoNoAnulable | null;
}>;

export type PaginaDeMovimientos = Readonly<{
  movimientos: readonly MovimientoDeLaSesion[];
  /** El cursor de la página siguiente; `null` si no hay más. */
  siguiente: CursorDeLaLista | null;
}>;

export type ErrorAlListarMovimientos =
  ErrorDeConsultaDeSesion | "CURSOR_INVALIDO" | "LIMITE_INVALIDO" | ErrorDePersistencia;

/**
 * Los movimientos de una sesión en orden `(registrado_en, id)`, con cursor, hasta 100 por pedido (e3 §3.10). `cajas.ver`, `read committed`,
 * alcance de la sucursal. Cada uno trae `anulablePorElActor` y `motivoNoAnulable`, calculados acá con `motivoNoAnulable` del dominio (la
 * misma función que decide la anulación) y con el permiso REAL del actor (`movimientos_caja.anular` y `anular_de_otros`), nunca con un
 * dato de la pantalla: un cobro con origen nunca es anulable desde caja.
 */
export function armarMovimientosDeSesion({ transacciones, reglas }: DependenciasDeConsultasDeCaja) {
  return async function movimientosDeSesion(
    contexto: ContextoOperativo,
    entrada: EntradaDeMovimientosDeSesion,
  ): Promise<Resultado<PaginaDeMovimientos, ErrorAlListarMovimientos>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<
        Resultado<
          PaginaDeMovimientos,
          ErrorDeConsultaDeSesion | "CURSOR_INVALIDO" | "LIMITE_INVALIDO"
        >
      > => {
        const permiso = await exigirPermisoDeConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.movimientosDeSesion.accion,
        );
        if (!permiso.ok) return permiso;
        const sesion = await sesionParaMirar(tx, contexto, entrada.sesionId);
        if (!sesion.ok) return sesion;

        const limite = entrada.limite ?? MAXIMO_DE_MOVIMIENTOS_POR_PAGINA;
        if (!Number.isInteger(limite) || limite < 1 || limite > MAXIMO_DE_MOVIMIENTOS_POR_PAGINA) {
          return err("LIMITE_INVALIDO");
        }
        let cursor: { registradoEn: Date; id: string } | null = null;
        if (entrada.despuesDe !== undefined && entrada.despuesDe !== null) {
          const instante = new Date(entrada.despuesDe.registradoEn);
          if (Number.isNaN(instante.getTime()) || !esUuidCanonico(entrada.despuesDe.id)) {
            return err("CURSOR_INVALIDO");
          }
          cursor = { registradoEn: instante, id: entrada.despuesDe.id };
        }

        const persona = contexto.personaId;
        const puedeAnular =
          persona !== null &&
          (
            await exigirAccion(reglas, "movimientos_caja.anular", () =>
              tx.autorizacion.delActor(contexto),
            )
          ).ok;
        const puedeAnularDeOtros = (
          await exigirAccion(reglas, "movimientos_caja.anular_de_otros", () =>
            tx.autorizacion.delActor(contexto),
          )
        ).ok;
        const estado: EstadoDeSesion = sesion.valor.estado;
        // Una fila de más: si vuelve, hay otra página.
        const filas = await tx.movimientos.pagina(
          contexto.empresaId,
          sesion.valor.id,
          cursor,
          limite + 1,
        );
        const pagina = filas.slice(0, limite);
        const ultimo = pagina.at(-1);
        return ok({
          movimientos: pagina.map((m) => {
            const motivo: MotivoNoAnulable | null =
              persona !== null && puedeAnular
                ? motivoNoAnulable({
                    movimiento: movimientoAnulableDe(m),
                    yaAnulado: m.anuladoPor !== null,
                    sesion: estado,
                    actor: { personaId: persona, puedeAnularDeOtros },
                  })
                : "NO_ANULABLE";
            return {
              id: m.id,
              clase: m.clase,
              medioDePagoId: m.medioDePagoId,
              medioTipo: m.medioTipo,
              medioNombre: m.medioNombre,
              cuentaDeCobroId: m.cuentaDeCobroId,
              cuentaNombre: m.cuentaNombre,
              importe: importeAJson(m.importe),
              motivo: m.motivo,
              anulaA: m.anulaA,
              anuladoPor: m.anuladoPor,
              corrigeJornada: m.corrigeJornada,
              registradoEn: m.registradoEn.toISOString(),
              registradoPor: m.registradoPor,
              origen: m.origen,
              anulablePorElActor: motivo === null,
              motivoNoAnulable: motivo,
            };
          }),
          siguiente:
            filas.length > limite && ultimo !== undefined
              ? { registradoEn: ultimo.registradoEn.toISOString(), id: ultimo.id }
              : null,
        });
      },
    );
  };
}
