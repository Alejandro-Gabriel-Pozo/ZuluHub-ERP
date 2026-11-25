import type { ClaveDeTexto } from "../../../../../src/capacidades/vocabulario/catalogo";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { formatearCantidad } from "../../patrones/formato-fiscal";
import { CLAVE_DE_CLASE } from "../catalogo/filtros-de-productos";
import { costoRedondeado } from "../produccion/modelo-de-orden";
import { cantidadConUnidad } from "../produccion/modelo-de-ordenes";
import { rutaDeEditarLaReceta, rutaDeLaCocina, rutaDeLaRecetaNueva } from "./filtros-de-recetas";
import type { AccionesDeLasRecetas } from "./modelo-de-recetas";

/**
 * El modelo de vista de la ficha de una receta y de su ficha de cocina (maqueta aprobada `receta.html`, 15/11/2026, funciones `vFicha` y `vCocina`): de lo que entrega la composición, lo
 * que se ve y NADA más. Puro: sin React ni servidor. La ficha dice «Versión N · vigente», «Rinde», «Costo de la comida» (solo con `costos.ver`; «Sin costo» si falta algún costo, nunca
 * cero), los ingredientes (clase, bruto y, si hay merma, «Merma» y «Neto»; el costo de la línea solo con `costos.ver`) y los pasos si los hay. La ficha de cocina lleva el bruto y los pasos,
 * sin costos ni precios (D99). Las cantidades y el costo son TEXTO decimal: nada pasa por `Number` (ADR-006); el costo se muestra a 2 decimales con la primitiva de dinero. Los textos salen del
 * catálogo (ya aprobados). Sin receta, «Este producto no tiene receta». No se arma ningún texto nuevo ni se ofrece escribir (guardar es otro tramo).
 */

/** Las líneas como las entrega la composición. */
type LineaDeLaFicha = Readonly<{
  numero: number;
  nombre: string;
  clase: string;
  bruto: string;
  unidadId: string;
  merma: string;
  neto: string;
  costo?: string | null | undefined;
}>;

/** La receta como la entrega la composición (la misma forma, sin importar de dónde venga; la UI no importa la composición). */
export type RecetaDeLaFicha = Readonly<{
  producto: Readonly<{ id: string; nombre: string }>;
  ficha: Readonly<{
    version: number;
    esLaVigente: boolean;
    rinde: string;
    pasos: string | null;
    componentes: readonly LineaDeLaFicha[];
    costos?: Readonly<{ porUnidad: string; incompleto: boolean }> | undefined;
  }> | null;
}>;

type DatoArmado = Readonly<{ rotulo: string; valor: string; fuerte: boolean }>;

type LineaArmada = Readonly<{
  clave: string;
  nombre: string;
  /** El costo de la línea o «Sin costo» (solo con `costos.ver`); `null` si no corresponde mostrarlo. */
  costo: string | null;
  /** «Materia prima · Bruto 1 kg · Merma 10 % · Neto 0,9 kg». */
  detalle: string;
}>;

export type RecetaArmada = Readonly<{
  titulo: string;
  /** «Este producto no tiene receta»; `null` si la tiene (y entonces vienen los demás datos). */
  sinReceta: string | null;
  /** «Versión 3 · vigente». */
  version: string | null;
  datos: readonly DatoArmado[];
  ingredientes: Readonly<{ titulo: string; filas: readonly LineaArmada[] }> | null;
  pasos: Readonly<{ titulo: string; texto: string }> | null;
  cocina: Readonly<{ href: string; texto: string }> | null;
  /** «Editar» (o «Nueva receta» si el producto no tiene), solo si el servidor deja guardar hoy; `null` si no. */
  editar: Readonly<{ href: string; texto: string }> | null;
}>;

const CLASES_CONOCIDAS = new Map<string, ClaveDeTexto>(Object.entries(CLAVE_DE_CLASE));

/** Un valor que la pantalla no conoce se dice con el propio valor (nunca se esconde un ingrediente por no saber nombrar su clase). */
const claseDe = (clase: string, d: DiccionarioResuelto): string => {
  const clave = CLASES_CONOCIDAS.get(clase);
  return clave === undefined ? clase : texto(d, clave);
};

/** ¿La merma es distinta de cero? Es texto decimal («0.0000», «12.5000»): sin pasar por `Number`. */
const hayMerma = (merma: string): boolean => /[1-9]/.test(merma);

const costoDeLaLinea = (costo: string | null | undefined, d: DiccionarioResuelto): string | null =>
  costo === undefined
    ? null
    : costo === null
      ? texto(d, "stock.accion.sin_costo")
      : costoRedondeado(costo);

function lineaArmada(l: LineaDeLaFicha, d: DiccionarioResuelto): LineaArmada {
  const partes = [
    claseDe(l.clase, d),
    `${texto(d, "receta.ficha.bruto")} ${cantidadConUnidad(l.bruto, l.unidadId, d)}`,
  ];
  if (hayMerma(l.merma)) {
    partes.push(
      `${texto(d, "receta.ficha.merma")} ${formatearCantidad(l.merma)} %`,
      `${texto(d, "receta.ficha.neto")} ${cantidadConUnidad(l.neto, l.unidadId, d)}`,
    );
  }
  return {
    clave: String(l.numero),
    nombre: l.nombre,
    costo: costoDeLaLinea(l.costo, d),
    detalle: partes.join(" · "),
  };
}

export function armarLaReceta(
  receta: RecetaDeLaFicha,
  acciones: AccionesDeLasRecetas = {},
  d: DiccionarioResuelto = {},
): RecetaArmada {
  const { ficha } = receta;
  const titulo = receta.producto.nombre;
  if (ficha === null) {
    return {
      titulo,
      sinReceta: texto(d, "receta.lista.producto_sin_receta"),
      version: null,
      datos: [],
      ingredientes: null,
      pasos: null,
      cocina: null,
      editar:
        acciones.editar === true
          ? {
              href: rutaDeLaRecetaNueva(receta.producto.id),
              texto: texto(d, "receta.lista.nueva_receta"),
            }
          : null,
    };
  }
  const datos: DatoArmado[] = [
    {
      rotulo: texto(d, "receta.ficha.rinde"),
      valor: formatearCantidad(ficha.rinde),
      fuerte: false,
    },
  ];
  if (ficha.costos !== undefined) {
    datos.push({
      rotulo: texto(d, "receta.ficha.costo_de_la_comida"),
      valor: ficha.costos.incompleto
        ? texto(d, "stock.accion.sin_costo")
        : costoRedondeado(ficha.costos.porUnidad),
      fuerte: true,
    });
  }
  const numero = String(ficha.version);
  return {
    titulo,
    sinReceta: null,
    version: ficha.esLaVigente
      ? `${texto(d, "receta.ficha.version")} ${numero} · ${texto(d, "receta.ficha.vigente")}`
      : `${texto(d, "receta.ficha.version")} ${numero}`,
    datos,
    ingredientes: {
      titulo: texto(d, "receta.ficha.ingredientes"),
      filas: ficha.componentes.map((l) => lineaArmada(l, d)),
    },
    pasos:
      ficha.pasos === null ? null : { titulo: texto(d, "receta.ficha.pasos"), texto: ficha.pasos },
    cocina: {
      href: rutaDeLaCocina(receta.producto.id),
      texto: texto(d, "receta.ficha_de_cocina.titulo"),
    },
    editar:
      acciones.editar === true
        ? {
            href: rutaDeEditarLaReceta(receta.producto.id),
            texto: texto(d, "receta.edicion.editar"),
          }
        : null,
  };
}

/** La ficha de cocina como la entrega la composición (sin costos ni precios: la consulta no los trae). */
export type CocinaDeLaFicha = Readonly<{
  version: number;
  rinde: string;
  pasos: string | null;
  componentes: readonly Readonly<{
    productoId: string;
    nombre: string;
    cantidad: string;
    unidadId: string;
  }>[];
}>;

export type CocinaArmada = Readonly<{
  titulo: string;
  /** «Rinde 10 · Versión 3». */
  encabezado: string;
  filas: readonly Readonly<{ clave: string; nombre: string; cantidad: string }>[];
  pasos: string | null;
}>;

export function armarLaCocina(
  nombre: string,
  cocina: CocinaDeLaFicha,
  d: DiccionarioResuelto = {},
): CocinaArmada {
  return {
    titulo: nombre,
    encabezado: `${texto(d, "receta.ficha.rinde")} ${formatearCantidad(cocina.rinde)} · ${texto(d, "receta.ficha.version")} ${String(cocina.version)}`,
    filas: cocina.componentes.map((c, indice) => ({
      // El mismo ingrediente no se repite en una receta (el servidor lo garantiza), pero el id no es una clave de confianza: el índice la completa.
      clave: `${String(indice)}-${c.productoId}`,
      nombre: c.nombre,
      cantidad: cantidadConUnidad(c.cantidad, c.unidadId, d),
    })),
    pasos: cocina.pasos,
  };
}
