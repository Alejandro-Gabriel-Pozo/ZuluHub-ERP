import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { esAnulable } from "../casos-de-uso/anulaciones";
import { esUuid } from "../persistencia/filas";
import type { ArticuloControlado } from "../persistencia/lecturas-del-libro";
import type { Movimiento } from "../persistencia/modelo";
import { type Lector, type RDeConsulta } from "./comun";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import { TAMANO_DE_PAGINA } from "./existencias";
import { enAlcance } from "./libro";

/** Dónde sigue el libro de un depósito: el último renglón visto, en el orden `(hecho en, movimiento, renglón)` descendente. */
export type CursorDeMovimientosDeDeposito = Readonly<{
  /** ISO 8601 (`Date.toISOString()`). */
  hechoEn: string;
  movimientoId: string;
  numero: number;
}>;

export type { ArticuloControlado };

export type EntradaDeMovimientosDeDeposito = Readonly<{
  depositoId: string;
  despuesDe?: CursorDeMovimientosDeDeposito | undefined;
}>;

/** Un renglón del libro de un depósito para la tarjeta de «Movimientos»: lo que cambió, de qué artículo, cuándo y quién (por id: la pantalla lo muestra por correo). */
export type MovimientoDeDeposito = Readonly<{
  movimientoId: string;
  numero: number;
  clase: Movimiento["clase"];
  motivo: string;
  hechoEn: Date;
  registradoPor: PersonaId;
  articuloId: string;
  nombre: string;
  unidadId: string;
  /** Con signo, texto decimal exacto, en la unidad de stock. */
  cantidad: string;
  /** Este movimiento es la anulación de otro. */
  esAnulacion: boolean;
  /** Otro movimiento lo anuló. */
  anulado: boolean;
  /**
   * Si se puede anular desde stock: lo decide el servidor (`esAnulable`: solo los manuales, y ni una anulación ni un ajuste por conteo) y no
   * lo está ya. Compras, ventas, devoluciones y producción los revierte su módulo.
   */
  anulable: boolean;
}>;

export type PaginaDeMovimientosDeDeposito = Readonly<{
  movimientos: readonly MovimientoDeDeposito[];
  siguiente: CursorDeMovimientosDeDeposito | null;
}>;

const PAGINA_VACIA_DE_DEPOSITO: PaginaDeMovimientosDeDeposito = {
  movimientos: [],
  siguiente: null,
};

function cursorDeDeposito(
  c: CursorDeMovimientosDeDeposito | undefined,
): c is CursorDeMovimientosDeDeposito | undefined {
  return (
    c === undefined ||
    (typeof c.hechoEn === "string" &&
      !Number.isNaN(Date.parse(c.hechoEn)) &&
      esUuid(c.movimientoId) &&
      Number.isInteger(c.numero) &&
      c.numero > 0)
  );
}

/**
 * Lo que lee la pestaña «Movimientos» y los formularios de movimiento: el libro de un depósito y los artículos que se pueden mover. Aparte de `libro.ts` (el libro por artículo y las fichas) para que ninguno crezca de más.
 */
export function armarConsultasDelLibroDelDeposito(leer: Lector) {
  return {
    /** Los artículos activos que se pueden mover, por nombre (los selectores de los formularios de movimiento). Guard `stock.ver`; no trae costos. */
    articulosControlados: (
      contexto: ContextoOperativo,
    ): Promise<RDeConsulta<readonly ArticuloControlado[]>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.articulosControlados.accion, (tx) =>
        tx.movimientosDeStock.articulosControlados(contexto.empresaId),
      ),

    /**
     * El libro de un depósito para la pestaña «Movimientos»: un renglón por tarjeta, del más nuevo al más viejo, de a `TAMANO_DE_PAGINA` por cursor. Guard
     * `stock.ver`. Un depósito ajeno al alcance (el operador solo ve sus sucursales), uno que no existe, de otra empresa o un cursor mal formado dan una página
     * vacía, indistinguibles entre sí. Nunca devuelve costos ni la clave de idempotencia.
     */
    movimientosDelDeposito: (
      contexto: ContextoOperativo,
      entrada: EntradaDeMovimientosDeDeposito,
    ): Promise<RDeConsulta<PaginaDeMovimientosDeDeposito>> =>
      leer(
        contexto,
        DECLARACIONES_DE_CONSULTAS.movimientosDelDeposito.accion,
        async (tx, alcance) => {
          if (!esUuid(entrada.depositoId) || !cursorDeDeposito(entrada.despuesDe)) {
            return PAGINA_VACIA_DE_DEPOSITO;
          }
          const deposito = await tx.depositos.obtener(contexto.empresaId, entrada.depositoId);
          if (deposito === null || !enAlcance(alcance, deposito.sucursalId)) {
            return PAGINA_VACIA_DE_DEPOSITO;
          }
          const filas = await tx.movimientosDeStock.movimientosDeDeposito(contexto.empresaId, {
            depositoId: entrada.depositoId,
            despuesDe:
              entrada.despuesDe === undefined
                ? undefined
                : {
                    hechoEn: new Date(entrada.despuesDe.hechoEn),
                    movimientoId: entrada.despuesDe.movimientoId,
                    numero: entrada.despuesDe.numero,
                  },
            limite: TAMANO_DE_PAGINA + 1,
          });
          const pagina = filas.slice(0, TAMANO_DE_PAGINA);
          const ultima = pagina[pagina.length - 1];
          return {
            movimientos: pagina.map((f) => ({
              movimientoId: f.movimientoId,
              numero: f.numero,
              clase: f.clase,
              motivo: f.motivo,
              hechoEn: f.hechoEn,
              registradoPor: f.registradoPor,
              articuloId: f.articuloId,
              nombre: f.nombre,
              unidadId: f.unidadId,
              cantidad: f.cantidad,
              esAnulacion: f.anulaA !== null,
              anulado: f.anuladoPor !== null,
              anulable: f.anuladoPor === null && esAnulable(f.clase, f.origenTipo),
            })),
            siguiente:
              filas.length > TAMANO_DE_PAGINA && ultima !== undefined
                ? {
                    hechoEn: ultima.hechoEn.toISOString(),
                    movimientoId: ultima.movimientoId,
                    numero: ultima.numero,
                  }
                : null,
          };
        },
      ),
  };
}
