import type { CodigoDeUnidad } from "../../primitivas/unidades/unidades";
import type { ClaveDeTexto } from "./catalogo";

/**
 * El texto que se muestra para cada unidad de medida: el código (`UNIDADES`, la lista cerrada de `src/primitivas/unidades/unidades.ts`) lleva a su clave del vocabulario (los nombres de
 * la maqueta de productos, aprobados el 13/11/2026: ver `catalogo-catalogo.ts`). `Record<CodigoDeUnidad, …>` obliga a que TODA unidad tenga su nombre: una unidad nueva sin texto no
 * compila. Previene: un desplegable de unidades con el código a la vista («METRO_CUBICO») o con una unidad sin nombre.
 */
export const CLAVE_DE_TEXTO_DE_UNIDAD = {
  UNIDAD: "catalogo.unidad.unidad",
  GRAMO: "catalogo.unidad.gramo",
  KILOGRAMO: "catalogo.unidad.kilogramo",
  TONELADA: "catalogo.unidad.tonelada",
  MILILITRO: "catalogo.unidad.mililitro",
  LITRO: "catalogo.unidad.litro",
  METRO_CUBICO: "catalogo.unidad.metro_cubico",
  MILIMETRO: "catalogo.unidad.milimetro",
  CENTIMETRO: "catalogo.unidad.centimetro",
  METRO: "catalogo.unidad.metro",
  CENTIMETRO_CUADRADO: "catalogo.unidad.centimetro_cuadrado",
  METRO_CUADRADO: "catalogo.unidad.metro_cuadrado",
  MINUTO: "catalogo.unidad.minuto",
  HORA: "catalogo.unidad.hora",
} as const satisfies Record<CodigoDeUnidad, ClaveDeTexto>;
