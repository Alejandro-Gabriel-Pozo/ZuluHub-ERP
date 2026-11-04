import { fechaDeNegocio } from "../../../src/primitivas/tiempo/fecha-de-negocio";
import type { FiltrosDelListado } from "../ui/plantillas/facturacion/filtros-del-listado";

/**
 * Del período y los filtros de la pantalla al pedido de la consulta de comprobantes (`entradaDeListar`). Las fechas son
 * FECHAS CIVILES de Argentina («AAAA-MM-DD»), no instantes: ARCA es argentina y la consulta filtra por el día civil de la
 * factura. El «hoy» sale de `fechaDeNegocio` (la jornada con corte 00:00 en la zona de Argentina), nunca de la zona del
 * servidor: Vercel corre en UTC y entre las 21:00 y las 24:00 de Argentina el día del servidor ya es el siguiente.
 *
 * «Últimos 7 días» incluye hoy: hoy y los 6 anteriores (D-54 de `facturador-contratos-de-pantalla.md`, confirmada por el dueño el
 * 2026-10-29). Los períodos con fechas (Hoy, Últimos 7 días, Este mes) cierran en hoy.
 *
 * Previene: un día corrido en el filtro de período por usar la hora del servidor. Chequeo: `test/web/listado-entrada.test.ts`
 * (fin de mes, 1.º de enero, medianoche en UTC-3).
 */

/** La zona de la fecha de un comprobante. Es la misma de `ZONA_DE_ARGENTINA` de `lecturas-de-comprobantes.ts`: lo comprueba la prueba. */
export const ZONA_DE_ARGENTINA = "America/Argentina/Buenos_Aires";

const UN_DIA_EN_MILISEGUNDOS = 86_400_000;

/** El día civil de Argentina de este instante. */
export function hoyEnArgentina(ahora: Date): string {
  const hoy = fechaDeNegocio(ahora, ZONA_DE_ARGENTINA, "00:00");
  if (!hoy.ok) throw new RangeError(`no hay fecha de hoy: ${hoy.error}`);
  return hoy.valor;
}

/** El rango del período; un lado ausente es «sin límite» de ese lado. */
export function rangoDelPeriodo(
  filtros: FiltrosDelListado,
  ahora: Date,
): Readonly<{ desde?: string; hasta?: string }> {
  switch (filtros.periodo) {
    case "todo":
      return {};
    case "personalizado":
      return {
        ...(filtros.desde === "" ? {} : { desde: filtros.desde }),
        ...(filtros.hasta === "" ? {} : { hasta: filtros.hasta }),
      };
    case "hoy": {
      const hoy = hoyEnArgentina(ahora);
      return { desde: hoy, hasta: hoy };
    }
    case "7dias":
      return {
        desde: hoyEnArgentina(new Date(ahora.getTime() - 6 * UN_DIA_EN_MILISEGUNDOS)),
        hasta: hoyEnArgentina(ahora),
      };
    case "mes": {
      const hoy = hoyEnArgentina(ahora);
      return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
    }
  }
}

/**
 * Los filtros con las fechas del período FIJADAS (período «Personalizado» con el desde y el hasta efectivos), para el enlace de
 * «Página siguiente». Previene: que el rango se corra entre páginas si pasa la medianoche (con «Hoy» o «Este mes» la página
 * siguiente se pediría con otro día y la clave de página dejaría de corresponder al mismo resultado). «Todo» y «Personalizado» ya
 * son fijos. Chequeo: `test/web/listado-entrada.test.ts` y `test/web/listado-pagina.test.ts`.
 */
export function conElPeriodoFijo(filtros: FiltrosDelListado, ahora: Date): FiltrosDelListado {
  if (filtros.periodo === "todo" || filtros.periodo === "personalizado") return filtros;
  const { desde, hasta } = rangoDelPeriodo(filtros, ahora);
  return { ...filtros, periodo: "personalizado", desde: desde ?? "", hasta: hasta ?? "" };
}

/** El pedido de la consulta: solo las claves con valor, tal como las lee `entradaDeListar`. */
export function entradaDelListado(
  filtros: FiltrosDelListado,
  ahora: Date,
  despues: string | null,
): Readonly<Record<string, string | number>> {
  return {
    ...rangoDelPeriodo(filtros, ahora),
    ...(filtros.estado === "" ? {} : { estado: filtros.estado }),
    ...(filtros.letra === "" ? {} : { letra: filtros.letra }),
    ...(filtros.puntoDeVenta === "" ? {} : { puntoDeVenta: Number(filtros.puntoDeVenta) }),
    ...(filtros.texto === "" ? {} : { texto: filtros.texto }),
    ...(despues === null ? {} : { despuesDe: despues }),
  };
}
