import { randomUUID } from "node:crypto";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { AHORA_DE_PRUEBA } from "./entorno";
import { escribirMovimiento } from "./stock-apoyo";
import { nuevoId, valorDe, type EscenarioDeStock, type MontajeDeStock } from "./stock-casos-apoyo";

/**
 * Apoyo de las pruebas del conteo con hora (E5, migración 0042). El reloj de cada prueba lo fija el contexto (`ahora`), así que «vender a las
 * 10:05» es escribir un movimiento con `hecho_en` en ese instante (SQL del dueño: el escenario, no lo que se prueba) y «cargar a las 10:10» es
 * un contexto con ese `ahora`. Todo se cuenta en minutos respecto de `AHORA_DE_PRUEBA` (2026-10-11 12:00Z = 09:00 en Argentina, jornada del
 * 11/10): el conteo del dueño queda con `AHORA` = 10:10, la hora del conteo = `AHORA − 10 min`, la venta = `AHORA − 5 min`.
 */

export const AHORA = AHORA_DE_PRUEBA;
/** El instante a `minutos` de `AHORA` (negativo: antes). */
export const hace = (minutos: number): Date => new Date(AHORA.getTime() + minutos * 60_000);
/** El mismo actor con su reloj en otro instante. */
export const conReloj = (quien: ContextoOperativo, instante: Date): ContextoOperativo => ({
  ...quien,
  ahora: instante,
});

export type ConteoDePrueba = Readonly<{
  /** Un depósito con UN artículo que ya tiene `existencia` desde `hace(-120)`. */
  dep: string;
  articulo: string;
  producto: string;
}>;

/** Un movimiento del libro con su hora exacta (`hecho_en`), escrito con SQL del dueño. Devuelve su id. Cantidad con signo. */
export async function movimientoEn(
  c: MontajeDeStock,
  e: EscenarioDeStock,
  datos: Readonly<{
    dep: string;
    articulo: string;
    /** Con signo: negativa resta. */
    cantidad: string;
    hechoEn: Date;
    clase?: "ENTRADA" | "SALIDA";
    motivo?: string;
    persona?: string;
    ejemplarId?: string;
  }>,
): Promise<string> {
  const clase = datos.clase ?? (datos.cantidad.startsWith("-") ? "SALIDA" : "ENTRADA");
  const motivo = datos.motivo ?? (clase === "SALIDA" ? "MERMA" : "COMPRA");
  await c.dueno.query("begin");
  try {
    const escrito = await escribirMovimiento(
      async (texto, parametros) => {
        const r = await c.dueno.query(texto, parametros);
        return { ok: true, filas: r.rowCount ?? 0, rows: r.rows as Record<string, unknown>[] };
      },
      e.empresa,
      {
        clase,
        motivo,
        deposito: datos.dep,
        persona: datos.persona ?? e.personaDelGerente,
        accion: clase === "SALIDA" ? "stock.registrar_salida" : "stock.registrar_entrada",
        hechoEn: datos.hechoEn.toISOString(),
        ...(datos.ejemplarId === undefined
          ? {}
          : {
              origen: { tipo: "EJEMPLAR_DE_TICKET", id: datos.ejemplarId },
              // La salida por venta trae la jornada del ticket (la de `AHORA`: 11/10).
              fechaDeNegocio: "2026-10-11",
            }),
        renglones: [{ articulo: datos.articulo, cantidad: datos.cantidad }],
      },
    );
    await c.dueno.query("commit");
    return escrito.id;
  } catch (error) {
    await c.dueno.query("rollback");
    throw error;
  }
}

/** Un depósito con un artículo y su existencia inicial cargada dos horas antes (cero: nada cargado). */
export async function conStock(
  c: MontajeDeStock,
  e: EscenarioDeStock,
  existencia: string,
  articulo: Parameters<MontajeDeStock["articulo"]>[1] = {},
  cargadaEn: Date = hace(-120),
): Promise<ConteoDePrueba> {
  const dep = await c.deposito(e);
  const a = await c.articulo(e, articulo);
  if (existencia !== "0") {
    await movimientoEn(c, e, {
      dep,
      articulo: a.articulo,
      cantidad: existencia,
      hechoEn: cargadaEn,
      motivo: "CARGA_INICIAL",
    });
  }
  return { dep, articulo: a.articulo, producto: a.producto };
}

export const abrirConteoDe = async (
  c: MontajeDeStock,
  e: EscenarioDeStock,
  dep: string,
  quien: ContextoOperativo = e.gerente,
): Promise<string> =>
  valorDe(await c.casos.abrirConteo(quien, { id: nuevoId(), depositoId: dep })).conteoId;

/** Cargar lo contado de un artículo, con su hora (o sin ella: «en vivo»). */
export const contarEn = (
  c: MontajeDeStock,
  quien: ContextoOperativo,
  conteoId: string,
  producto: string,
  cantidad: string,
  extra: Readonly<{ contadoEn?: Date; id?: string; unidadId?: string }> = {},
) =>
  c.casos.registrarConteo(quien, {
    id: extra.id ?? randomUUID(),
    conteoId,
    productoId: producto,
    cantidadContada: cantidad,
    unidadId: extra.unidadId ?? "UNIDAD",
    ...(extra.contadoEn === undefined ? {} : { contadoEn: extra.contadoEn }),
  });

export const conteoDiferencia = (c: MontajeDeStock, conteoId: string) =>
  c.filas<Record<string, string | null>>(
    `select articulo_id, contada::text, contado_en, existencia_a_la_hora::text, diferencia_bruta::text, marcado::text,
            diferencia_final::text, motivo, detalle, explicada_por
       from conteo_diferencia where conteo_id = $1 order by articulo_id`,
    [conteoId],
  );
