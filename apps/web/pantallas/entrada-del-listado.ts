import { hoyEnArgentina as hoyDeArgentina } from "../../../src/primitivas/tiempo/fecha-civil-hasta-hoy";
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
 * La búsqueda de TEXTO con el período «Todo» mira los ÚLTIMOS 12 MESES (decisión del dueño, 2026-11-07, pregunta directa: para años
 * anteriores se elige el período «Personalizado»). Definición exacta: los comprobantes CREADOS desde la MISMA fecha civil del año
 * anterior, inclusive (el 29 de febrero retrocede al 28 de febrero del año anterior), hasta hoy sin tope; el día es el de Argentina
 * (UTC-3), no el del servidor. Va como `creadoDesde` y no como `desde`: acota la columna por la que el listado ya recorre en orden y la
 * búsqueda deja de leer toda la historia (medido con 800.000 comprobantes en una sucursal y 4 años: de 431-550 ms a 77-109 ms). Es por
 * fecha de CREACIÓN, no de emisión: un comprobante creado el día anterior al corte y emitido después queda afuera, y es el único borde
 * donde difiere de `desde`. Sin texto, «Todo» sigue sin límite.
 *
 * Previene: un día corrido en el filtro de período por usar la hora del servidor. Chequeo: `test/web/listado-entrada.test.ts`
 * (fin de mes, 1.º de enero, medianoche en UTC-3).
 */

const UN_DIA_EN_MILISEGUNDOS = 86_400_000;

/** El día civil de Argentina de este instante. */
export function hoyEnArgentina(ahora: Date): string {
  const hoy = hoyDeArgentina(ahora);
  if (!hoy.ok) throw new RangeError(`no hay fecha de hoy: ${hoy.error}`);
  return hoy.valor;
}

/** La misma fecha civil un año antes; el 29 de febrero, que el año anterior no existe, cae el 28. */
export function mismoDiaDelAnioAnterior(fecha: string): string {
  const anio = Number(fecha.slice(0, 4)) - 1;
  const mesYDia = fecha.slice(5);
  const dia = mesYDia === "02-29" ? "02-28" : mesYDia;
  return `${String(anio).padStart(4, "0")}-${dia}`;
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
    ...(filtros.texto !== "" && filtros.periodo === "todo"
      ? { creadoDesde: mismoDiaDelAnioAnterior(hoyEnArgentina(ahora)) }
      : {}),
    ...(despues === null ? {} : { despuesDe: despues }),
  };
}
