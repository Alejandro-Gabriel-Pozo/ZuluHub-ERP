import type { AlcanceDeSucursales } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { fechaCivilDesdeTexto } from "../../../primitivas/tiempo/fecha-civil";
import { esUuid } from "../persistencia/filas";
import type { FilaDeLibro } from "../persistencia/lecturas-del-libro";
import type { Movimiento, RenglonGuardado } from "../persistencia/modelo";
import type { TxDeConsultasDeStock } from "../casos-de-uso/contrato";
import { type Lector, type RDeConsulta } from "./comun";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import { TAMANO_DE_PAGINA } from "./existencias";

/** Dónde sigue el libro de un artículo: el último renglón visto, en el orden `(fecha de negocio, hecho en, movimiento, renglón)`. */
export type CursorDeLibro = Readonly<{
  fechaDeNegocio: string;
  /** ISO 8601 (`Date.toISOString()`). */
  hechoEn: string;
  movimientoId: string;
  numero: number;
}>;

export type EntradaDeLibroDeArticulo = Readonly<{
  articuloId: string;
  depositoId: string;
  /** Fechas de NEGOCIO `YYYY-MM-DD`, extremos incluidos. */
  desde: string;
  hasta: string;
  despuesDe?: CursorDeLibro | undefined;
}>;

export type PaginaDeLibro = Readonly<{
  /** Cada renglón con el saldo corrido DESPUÉS de aplicarlo (desde el primer movimiento del par, no desde `desde`). */
  renglones: readonly FilaDeLibro[];
  siguiente: CursorDeLibro | null;
}>;

/** La cabecera de un movimiento sin lo que no se muestra (la clave de idempotencia y la huella son del sistema). */
export type CabeceraDeMovimiento = Readonly<{
  id: string;
  clase: Movimiento["clase"];
  motivo: string;
  detalle: string | null;
  origenTipo: string;
  origenId: string | null;
  /** El depósito del acto (el de origen en una transferencia). */
  depositoId: string;
  /** La autorización con que se hizo. */
  accion: string;
  anulaA: string | null;
  conteoId: string | null;
  hechoEn: Date;
  registradoEn: Date;
  fechaDeNegocio: string;
  registradoPor: PersonaId;
}>;

export type RenglonDeFicha = Readonly<{
  numero: number;
  depositoId: string;
  articuloId: string;
  productoId: string;
  /** Con signo, texto decimal exacto, en la unidad de stock. */
  cantidad: string;
  composicionId: string | null;
  confirmoNegativo: boolean;
}>;

export type FichaDeMovimiento = Readonly<{
  movimiento: CabeceraDeMovimiento;
  renglones: readonly RenglonDeFicha[];
  /** El movimiento que lo anuló, si lo hay. */
  anulacion: Readonly<{
    id: string;
    hechoEn: Date;
    registradoPor: PersonaId;
    detalle: string | null;
  }> | null;
}>;

const cabecera = (m: Movimiento): CabeceraDeMovimiento => ({
  id: m.id,
  clase: m.clase,
  motivo: m.motivo,
  detalle: m.detalle,
  origenTipo: m.origenTipo,
  origenId: m.origenId,
  depositoId: m.depositoId,
  accion: m.accion,
  anulaA: m.anulaA,
  conteoId: m.conteoId,
  hechoEn: m.hechoEn,
  registradoEn: m.registradoEn,
  fechaDeNegocio: m.fechaDeNegocio,
  registradoPor: m.registradoPor,
});

const enAlcance = (alcance: AlcanceDeSucursales, sucursal: string): boolean =>
  alcance === "TODAS" || (alcance as readonly string[]).includes(sucursal);

/**
 * La ficha de un movimiento SI todos los depósitos que toca están en el alcance de quien pide (el operador, solo sus sucursales); si no, o si
 * no existe, `null`: no se distingue. Un movimiento de dos sucursales solo lo ve quien tiene las dos.
 */
async function fichaVisible(
  tx: TxDeConsultasDeStock,
  empresa: ContextoOperativo["empresaId"],
  alcance: AlcanceDeSucursales,
  movimiento: Movimiento,
): Promise<FichaDeMovimiento | null> {
  const guardados: readonly RenglonGuardado[] = await tx.movimientosDeStock.renglonesDe(
    empresa,
    movimiento.id,
  );
  for (const depositoId of new Set(guardados.map((r) => r.depositoId))) {
    const deposito = await tx.depositos.obtener(empresa, depositoId);
    if (deposito === null || !enAlcance(alcance, deposito.sucursalId)) return null;
  }
  const articulos = await tx.articulosDeStock.porIds(
    empresa,
    guardados.map((r) => r.articuloId),
  );
  const productoDe = new Map(articulos.map((a) => [a.id, a.productoId]));
  const anulacion = await tx.movimientosDeStock.anulacionDe(empresa, movimiento.id);
  return {
    movimiento: cabecera(movimiento),
    renglones: guardados.map((r) => ({
      numero: r.numero,
      depositoId: r.depositoId,
      articuloId: r.articuloId,
      productoId: productoDe.get(r.articuloId) ?? r.articuloId,
      cantidad: r.cantidad,
      composicionId: r.composicionId,
      confirmoNegativo: r.confirmoNegativo,
    })),
    anulacion:
      anulacion === null
        ? null
        : {
            id: anulacion.id,
            hechoEn: anulacion.hechoEn,
            registradoPor: anulacion.registradoPor,
            detalle: anulacion.detalle,
          },
  };
}

/** La forma de un tipo de origen (la misma que exige `movimiento_de_stock_origen_tipo_ck`): otra cosa no puede ser el origen de nada. */
const FORMA_DE_ORIGEN = /^[A-Z][A-Z_]{1,39}$/;

const PAGINA_VACIA: PaginaDeLibro = { renglones: [], siguiente: null };

function cursorDeLibro(c: CursorDeLibro | undefined): c is CursorDeLibro | undefined {
  return (
    c === undefined ||
    (fechaCivilDesdeTexto(c.fechaDeNegocio).ok &&
      typeof c.hechoEn === "string" &&
      !Number.isNaN(Date.parse(c.hechoEn)) &&
      esUuid(c.movimientoId) &&
      Number.isInteger(c.numero) &&
      c.numero > 0)
  );
}

/**
 * Pestaña Movimientos y trazabilidad (E5 §3.4): el libro de un artículo en un depósito, por fecha de negocio, con el saldo corrido, la clase, el
 * motivo, el origen, el autor, cuándo ocurrió y cuándo se registró, quién lo anuló y la versión de composición. Guard `stock.ver`. Un depósito
 * ajeno al alcance, uno que no existe y cualquier parámetro mal formado dan una página vacía.
 */
export function armarConsultasDeLibro(leer: Lector) {
  return {
    libroDeArticulo: (
      contexto: ContextoOperativo,
      entrada: EntradaDeLibroDeArticulo,
    ): Promise<RDeConsulta<PaginaDeLibro>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.libroDeArticulo.accion, async (tx, alcance) => {
        const desde = fechaCivilDesdeTexto(entrada.desde);
        const hasta = fechaCivilDesdeTexto(entrada.hasta);
        if (
          !desde.ok ||
          !hasta.ok ||
          desde.valor > hasta.valor ||
          !esUuid(entrada.articuloId) ||
          !esUuid(entrada.depositoId) ||
          !cursorDeLibro(entrada.despuesDe)
        ) {
          return PAGINA_VACIA;
        }
        const deposito = await tx.depositos.obtener(contexto.empresaId, entrada.depositoId);
        if (deposito === null || !enAlcance(alcance, deposito.sucursalId)) return PAGINA_VACIA;
        const filas = await tx.movimientosDeStock.libroDeArticulo(contexto.empresaId, {
          articuloId: entrada.articuloId,
          depositoId: entrada.depositoId,
          desde: desde.valor,
          hasta: hasta.valor,
          despuesDe:
            entrada.despuesDe === undefined
              ? undefined
              : {
                  fechaDeNegocio: entrada.despuesDe.fechaDeNegocio,
                  hechoEn: new Date(entrada.despuesDe.hechoEn),
                  movimientoId: entrada.despuesDe.movimientoId,
                  numero: entrada.despuesDe.numero,
                },
          limite: TAMANO_DE_PAGINA + 1,
        });
        const pagina = filas.slice(0, TAMANO_DE_PAGINA);
        const ultima = pagina[pagina.length - 1];
        return {
          renglones: pagina,
          siguiente:
            filas.length > TAMANO_DE_PAGINA && ultima !== undefined
              ? {
                  fechaDeNegocio: ultima.fechaDeNegocio,
                  hechoEn: ultima.hechoEn.toISOString(),
                  movimientoId: ultima.movimientoId,
                  numero: ultima.numero,
                }
              : null,
        };
      }),

    /** Cabecera, renglones y anulación de un movimiento. `null` si no existe o toca un depósito fuera del alcance. */
    fichaDeMovimiento: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ movimientoId: string }>,
    ): Promise<RDeConsulta<FichaDeMovimiento | null>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.fichaDeMovimiento.accion, async (tx, alcance) => {
        const movimiento = await tx.movimientosDeStock.obtener(
          contexto.empresaId,
          entrada.movimientoId,
        );
        return movimiento === null
          ? null
          : fichaVisible(tx, contexto.empresaId, alcance, movimiento);
      }),

    /**
     * Todo lo que el libro tiene de un origen (la salida de un ejemplar y su anulación, la entrada de una recepción), del más viejo al más
     * nuevo, con lo que el alcance deje ver. El tipo de origen tiene la forma que exige la base (`EJEMPLAR_DE_TICKET`, `RECEPCION`...): lo que no
     * tiene esa forma, o un origen que el libro no tiene, da una lista vacía.
     */
    movimientosPorOrigen: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ origenTipo: string; origenId: string }>,
    ): Promise<RDeConsulta<readonly FichaDeMovimiento[]>> =>
      leer(
        contexto,
        DECLARACIONES_DE_CONSULTAS.movimientosPorOrigen.accion,
        async (tx, alcance) => {
          if (
            typeof entrada.origenTipo !== "string" ||
            !FORMA_DE_ORIGEN.test(entrada.origenTipo) ||
            !esUuid(entrada.origenId)
          ) {
            return [];
          }
          const fichas: FichaDeMovimiento[] = [];
          for (const m of await tx.movimientosDeStock.delOrigen(
            contexto.empresaId,
            entrada.origenTipo,
            entrada.origenId,
          )) {
            const ficha = await fichaVisible(tx, contexto.empresaId, alcance, m);
            if (ficha !== null) fichas.push(ficha);
          }
          return fichas;
        },
      ),
  };
}
