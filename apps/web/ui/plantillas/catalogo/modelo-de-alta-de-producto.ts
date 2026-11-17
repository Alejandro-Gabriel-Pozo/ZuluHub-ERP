import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { CLAVE_DE_CLASE, CLAVE_DE_DESCRIPCION_DE_CLASE } from "./filtros-de-productos";
import { CLAVE_DE_TEXTO_DE_UNIDAD } from "../../../../../src/capacidades/vocabulario/unidades-de-medida";
import { CLAVE_DE_ALICUOTA, nombrar } from "./modelo-de-ficha-de-producto";

/**
 * El modelo de vista del alta de un producto (A1, T6; maqueta aprobada `productos.html`, «Nuevo producto» = la ficha de datos con el borrador `prod({})`): de lo que entrega la
 * composición, los campos que se ven, en el orden de la maqueta, y NADA más. Puro: sin React ni servidor. Los textos salen del catálogo (`catalogo.*`, con su fuente en
 * `catalogo-catalogo.ts`); no se arma ningún texto nuevo, solo se eligen los aprobados.
 *
 * Lo que se ve según la clase (maqueta): el nombre de cocina, la alícuota y la sección solo si la clase se vende. Los valores de partida son los del borrador de la maqueta (`prod({})`):
 * clase «Producto vendible» y unidad «Unidad»; la alícuota y la sección arrancan en «Sin elegir» (la alícuota no tiene valor por defecto: dueño, 12/11/2026, pregunta 4). Lo que la maqueta
 * dibuja y esta pantalla NO tiene: «Se controla el stock» (nace sin tildar, dueño 13/11/2026, y el catálogo no lo guarda: es del artículo de stock) y la clasificación comercial (otro tramo).
 * Las unidades salen con su nombre (`CLAVE_DE_TEXTO_DE_UNIDAD`, los de la maqueta; el valor que viaja sigue siendo el código) y la clase elegida lleva debajo su descripción corta (la maqueta
 * muestra la de la clase elegida, `<p class="ayuda">`). Un valor que la pantalla no sabe nombrar se dice con el propio valor; una clase sin descripción no muestra ninguna.
 */

/** Los valores con los que abre el formulario: los del borrador de la maqueta. */
export const CLASE_POR_DEFECTO = "VENDIBLE";
export const UNIDAD_POR_DEFECTO = "UNIDAD";

/** Lo que entrega la composición (la misma forma, sin importar de dónde venga; la UI no importa los módulos). */
export type OpcionesDelAltaDeLaPantalla = Readonly<{
  clases: readonly Readonly<{ valor: string; seVende: boolean }>[];
  unidades: readonly string[];
  alicuotas: readonly string[];
  secciones: readonly Readonly<{ id: string; nombre: string }>[];
}>;

type Opcion = Readonly<{ valor: string; etiqueta: string }>;
type CampoArmado = Readonly<{ etiqueta: string }>;
type DesplegableArmado = Readonly<{ etiqueta: string; opciones: readonly Opcion[] }>;

export type AltaArmada = Readonly<{
  clase: DesplegableArmado &
    Readonly<{
      valorInicial: string;
      queSeVenden: readonly string[];
      /** La descripción corta de cada clase que la tiene, por valor de la clase. */
      descripciones: Readonly<Record<string, string>>;
    }>;
  nombre: CampoArmado;
  nombreDeCocina: CampoArmado;
  codigo: CampoArmado;
  codigoDeBarras: CampoArmado;
  unidad: DesplegableArmado & Readonly<{ valorInicial: string }>;
  alicuota: DesplegableArmado;
  seccion: DesplegableArmado;
  textoDeElegir: string;
  guardar: string;
}>;

export function armarElAlta(
  o: OpcionesDelAltaDeLaPantalla,
  d: DiccionarioResuelto = {},
): AltaArmada {
  return {
    clase: {
      etiqueta: texto(d, "catalogo.lista.que_es"),
      opciones: o.clases.map((c) => ({
        valor: c.valor,
        etiqueta: nombrar(CLAVE_DE_CLASE, c.valor, d),
      })),
      valorInicial: CLASE_POR_DEFECTO,
      queSeVenden: o.clases.filter((c) => c.seVende).map((c) => c.valor),
      descripciones: Object.fromEntries(
        o.clases
          .filter((c) => Object.hasOwn(CLAVE_DE_DESCRIPCION_DE_CLASE, c.valor))
          .map((c) => [c.valor, nombrar(CLAVE_DE_DESCRIPCION_DE_CLASE, c.valor, d)]),
      ),
    },
    nombre: { etiqueta: texto(d, "catalogo.dato.nombre") },
    nombreDeCocina: { etiqueta: texto(d, "catalogo.dato.nombre_de_cocina") },
    codigo: { etiqueta: texto(d, "catalogo.dato.codigo_interno") },
    codigoDeBarras: { etiqueta: texto(d, "catalogo.dato.codigo_de_barras") },
    unidad: {
      etiqueta: texto(d, "catalogo.dato.unidad"),
      opciones: o.unidades.map((u) => ({
        valor: u,
        etiqueta: nombrar(CLAVE_DE_TEXTO_DE_UNIDAD, u, d),
      })),
      valorInicial: UNIDAD_POR_DEFECTO,
    },
    alicuota: {
      etiqueta: texto(d, "catalogo.dato.alicuota_de_iva"),
      opciones: o.alicuotas.map((a) => ({ valor: a, etiqueta: nombrar(CLAVE_DE_ALICUOTA, a, d) })),
    },
    seccion: {
      etiqueta: texto(d, "catalogo.dato.seccion_de_la_carta"),
      opciones: o.secciones.map((s) => ({ valor: s.id, etiqueta: s.nombre })),
    },
    textoDeElegir: texto(d, "catalogo.dato.sin_elegir"),
    guardar: texto(d, "catalogo.accion.guardar"),
  };
}
