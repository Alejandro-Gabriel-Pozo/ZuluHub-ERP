import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { formatearFecha, formatearImporte } from "../facturacion/formato-fiscal";
import { RUTA_DE_PRODUCTOS } from "./filtros-de-productos";

/**
 * El modelo de vista de los precios de un producto (A1, T3; maqueta aprobada `productos.html`, función `vPrecios`): de lo que entrega la composición, lo que se ve y en qué orden,
 * y NADA más. Puro: sin React ni servidor. Los textos salen del catálogo (`catalogo.*`, con su fuente en `catalogo-catalogo.ts`); no se arma ningún texto nuevo, solo se eligen los
 * aprobados. Los importes son TEXTO decimal de punta a punta (ADR-006): se formatean y se arman con funciones de cadena, nunca con `Number`.
 *
 * Qué se ve (maqueta): el precio (IVA incluido) para editar; debajo, «Vigente desde» con el día o «Precio abierto» si no hay precio; y el historial, solo si hay anteriores. Un producto
 * con variante activa dice «Según medida» y no tiene campo: su precio es de cada medida.
 */

export const rutaDeLosPrecios = (id: string): string => `${RUTA_DE_PRODUCTOS}/${id}/precios`;

/** Los precios como los entrega la composición (la misma forma, sin importar de dónde venga; la UI no importa los módulos). */
export type PreciosDeLaPantalla = Readonly<{
  id: string;
  nombre: string;
  tipo: "DE_LA_EMPRESA" | "SEGUN_MEDIDA";
  vigente: Readonly<{ precioId: string; importe: string | null; desde: string }> | null;
  historial: readonly Readonly<{ importe: string | null; desde: string }>[];
  claveDelCambio: string;
}>;

export type PreciosArmados = Readonly<{
  id: string;
  titulo: string;
  /** «Según medida» si el producto tiene variante activa (no hay campo); `null` si el precio es de la empresa. */
  segunMedida: string | null;
  campo: Readonly<{ etiqueta: string; valorInicial: string }>;
  /** «Vigente desde dd/mm/aaaa» o «Precio abierto». */
  vigencia: string;
  /** Los precios anteriores, del más nuevo al más viejo; `null` si no hay (la sección no se muestra). */
  historial: Readonly<{
    titulo: string;
    filas: readonly Readonly<{ precio: string; desde: string }>[];
  }> | null;
  guardar: string;
}>;

/**
 * El precio vigente como lo muestra el campo: texto canónico con dos decimales («13000.000000» pasa a «13000.00»). Si el precio tiene más decimales que el campo (uno de 6
 * decimales, por kilo), el campo sale vacío: mostrarlo recortado y guardarlo sin querer cambiaría el precio.
 */
export function valorInicialDelCampo(importe: string | null): string {
  if (importe === null) return "";
  const partes = /^([0-9]+)(?:\.([0-9]*))?$/.exec(importe);
  if (partes === null) return "";
  const [, entera = "", fraccion = ""] = partes;
  const util = fraccion.replace(/0+$/, "");
  return util.length > 2 ? "" : `${entera}.${util.padEnd(2, "0")}`;
}

/** El importe sin el «$ » que le pone `formatearImporte`: la frase aprobada ya lo trae («El precio vigente ahora es $ {importe}»). */
const sinSimbolo = (importe: string): string => formatearImporte(importe).slice("$ ".length);

export function armarLosPrecios(
  p: PreciosDeLaPantalla,
  d: DiccionarioResuelto = {},
): PreciosArmados {
  const abierto = texto(d, "catalogo.precio.abierto");
  return {
    id: p.id,
    titulo: p.nombre,
    segunMedida: p.tipo === "SEGUN_MEDIDA" ? texto(d, "catalogo.precio.segun_medida") : null,
    campo: {
      etiqueta: texto(d, "catalogo.precio.importe"),
      valorInicial: valorInicialDelCampo(p.vigente === null ? null : p.vigente.importe),
    },
    vigencia:
      p.vigente === null || p.vigente.importe === null
        ? abierto
        : `${texto(d, "catalogo.precio.vigente_desde")} ${formatearFecha(p.vigente.desde)}`,
    historial:
      p.historial.length === 0
        ? null
        : {
            titulo: texto(d, "catalogo.precio.historial"),
            filas: p.historial.map((h) => ({
              precio: h.importe === null ? abierto : formatearImporte(h.importe),
              desde: formatearFecha(h.desde),
            })),
          },
    guardar: texto(d, "catalogo.accion.guardar"),
  };
}

/** El texto de un error de esta pantalla; el del precio que otra persona cambió lleva el importe vigente, con el formato de la pantalla. */
export function textoDelError(error: ErrorPublico, d: DiccionarioResuelto = {}): string {
  const importe = error.parametros === undefined ? undefined : error.parametros["importe"];
  return importe === undefined
    ? texto(d, error.clave)
    : texto(d, error.clave, { importe: sinSimbolo(importe) });
}
