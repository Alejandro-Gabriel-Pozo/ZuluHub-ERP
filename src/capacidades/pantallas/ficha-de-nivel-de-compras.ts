import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LA FICHA DE LA PANTALLA «NIVEL DE COMPRAS» (DDD:174: toda pantalla nueva nace con ficha; Compras PR 11). Una ruta (`/compras/nivel`): un selector con los niveles que se eligen y «Guardar». Solo el
 * gerente (`compras.configurar`). La comprueba `test/web/ficha-de-nivel-de-compras.test.ts` contra el catálogo de textos, el de permisos y la tabla del menú. No crea acciones ni permisos.
 * Previene: un botón o un texto que nadie aprobó, y una ruta o una fila de menú que se mueve sin que la ficha lo note.
 *
 * DIFERENCIAS CON LA MAQUETA (`compra-nivel.html`; la maqueta manda: cada desvío lleva su fundamento y lo decide el dueño, DDD:294):
 *  1. El selector ofrece DOS niveles («Sin factura» y «Con factura»), no los cuatro de la maqueta: «Recepción separada» y «Tres vías» (textos aprobados) son de la fase 5, pausada por el dueño (24/11/2026).
 *     Fundamento: ofrecerlos haría elegir un nivel cuyas pantallas no existen (las compras, las recepciones y las notas de crédito de N3 y N4 no se pueden cargar desde la web). El servidor, además, no los acepta desde esta pantalla.
 *  2. Sin el «Registro de cambios» ni la barra con el nombre de la sucursal del prototipo: son del armazón del prototipo, no de la pantalla.
 */

type FuenteDeTexto = Readonly<{ decidio: string; donde: string }>;
type TextoDeFicha = Readonly<{ usos: readonly string[]; fuente: FuenteDeTexto }>;
type BotonDeFicha = Readonly<{
  id: string;
  texto: ClaveDeTexto;
  hace: Readonly<{ navega: string }> | Readonly<{ envia: ClaveAccion }>;
  /** El botón apagado o ausente es solo una ayuda: decide el servidor. */
  sinPermiso: "APAGADO" | "AUSENTE";
}>;

export type FichaDeNivelDeCompras = Readonly<{
  archivos: readonly string[];
  rutas: readonly string[];
  titulo: ClaveDeTexto;
  /** La acción que exige la lectura de la pantalla y la fila del menú. */
  acceso: ClaveAccion;
  botones: readonly BotonDeFicha[];
  /** El error y la falta de permiso salen con el mensaje genérico aprobado. */
  estados: Readonly<Record<"ERROR" | "SIN_PERMISO", "GENERICO">>;
  textos: Readonly<Partial<Record<ClaveDeTexto, TextoDeFicha>>>;
  estadoDeLaFicha: "EN_CONSTRUCCION" | "TERMINADA";
}>;

const APROBADO_POR_EL_DUENO: FuenteDeTexto = {
  decidio:
    "el dueño: los cinco textos de compra-nivel.html aprobados tal cual (fila del 23/11/2026 «Compras: el dueño aprueba las recomendaciones del plan a las 10 preguntas», pregunta 9) y orden del 24/11/2026 (PR 11 solo N1 y N2)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta compra-nivel.html; brief PR-11-nivel-de-compras-pantalla.md de Compras (rama de planificación de la Ola 1); decisiones-del-dueno-2026-11.md (DDD:120 punto 3 y DDD:248)",
};
const USO = "apps/web/ui/plantillas/compras/nivel/";

export const FICHA_DE_NIVEL_DE_COMPRAS = {
  archivos: [
    "apps/web/app/s/app/(operacion)/compras/nivel/page.tsx",
    "apps/web/app/s/app/acciones-de-nivel-de-compras.ts",
    "apps/web/servidor/nivel-de-compras.ts",
    "apps/web/ui/plantillas/compras/nivel/FormularioDeNivelDeCompras.cliente.tsx",
    "apps/web/ui/plantillas/compras/nivel/modelo-de-nivel-de-compras.ts",
    "apps/web/ui/plantillas/compras/nivel/resultado-de-nivel.ts",
    "apps/web/ui/plantillas/compras/nivel/textos-de-nivel-de-compras.ts",
    "src/composicion/entradas-de-nivel-de-compras.ts",
    "src/composicion/nivel-de-compras-web.ts",
  ],
  rutas: ["/compras/nivel"],
  titulo: "compras.nivel.titulo",
  acceso: "compras.configurar",
  botones: [
    {
      id: "guardar-nivel",
      texto: "caja.accion.guardar",
      hace: { envia: "compras.configurar" },
      sinPermiso: "AUSENTE",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "compras.nivel.titulo": {
      usos: [`${USO}textos-de-nivel-de-compras.ts`, "título de la pantalla y nombre del selector"],
      fuente: APROBADO_POR_EL_DUENO,
    },
    "compras.nivel.compra_simple": {
      usos: [`${USO}textos-de-nivel-de-compras.ts`, "opción del selector (nivel 1)"],
      fuente: APROBADO_POR_EL_DUENO,
    },
    "compras.nivel.con_comprobante": {
      usos: [`${USO}textos-de-nivel-de-compras.ts`, "opción del selector (nivel 2)"],
      fuente: APROBADO_POR_EL_DUENO,
    },
    "caja.accion.guardar": {
      usos: [`${USO}textos-de-nivel-de-compras.ts`, "botón «Guardar»"],
      fuente: APROBADO_POR_EL_DUENO,
    },
    "compras.error.sin_permiso": {
      usos: [
        "cualquier rechazo del servidor y quien no tiene permiso (el genérico, interfaz sobria)",
      ],
      fuente: APROBADO_POR_EL_DUENO,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDeNivelDeCompras;
