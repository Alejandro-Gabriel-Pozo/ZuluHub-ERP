import type { ClaveAccion, ClaveModulo } from "../modulos/catalogo";
import type { ClavePerilla } from "../planes/perillas";
import type { ClaveDeTexto } from "../vocabulario/catalogo";
import type { IdDeContexto } from "./contextos";

/**
 * OPERACIÓN CONTEXTUAL: la primitiva con la que los módulos se integran sin tocar las pantallas de otros (escalabilidad X-1,
 * decisión del dueño 18/11/2026, `11-especificaciones/briefs/escalabilidad/PR-X1-…` del repositorio de documentos).
 *
 * QUÉ ES: algo que una persona puede HACER sobre una cosa concreta que ya existe (el contexto: una cuenta, un ticket, un
 * cliente), que pertenece a UN módulo y se resuelve en la pantalla de ese módulo, con su permiso, su validación, su
 * transacción y su resultado. La operación apunta a un TIPO de contexto: toda pantalla que lo entregue la ofrece, también las
 * que se construyan después, sin tocarlas.
 *
 * QUÉ NO ES: un botón (el botón, el ítem de «Más» o el acceso directo son formas de dibujarla); un campo dentro del formulario
 * de otro módulo (una operación no tiene forma de declarar un campo: solo una ruta propia); una entrada de menú (el menú no
 * tiene contexto); un destino de cobro (ocurre dentro de la transacción del cobro, X-2); un permiso (usa uno del catálogo); un
 * dato que viaja (lo único que viaja es la referencia: la operación vuelve a leer todo del servidor).
 *
 * REGLA DEL DUEÑO (18/11): el registro y la hoja «Más» definen SOLO sobre qué se opera, la lista de operaciones, cómo se abre la
 * pantalla del módulo dueño y cómo se vuelve. NO definen qué hace cada operación, qué datos pide ni qué resultado deja: por eso
 * `OperacionContextual` no tiene ningún campo de datos, valores ni resultado.
 *
 * POR QUÉ UNA ABSTRACCIÓN NUEVA: requisito explícito del dueño (dos filas del 18/11). Previene que cada módulo nuevo obligue a
 * editar las pantallas de los demás (13 briefs en cola el 18/11/2026). Ya existe con esta forma el menú y la referencia opaca de
 * la cuenta y del cobro. Chequeo: `test/arquitectura/operaciones-contextuales.test.ts`.
 */

/** Un tipo de cosa sobre la que se puede operar. La clave del registro es `modulo.cosa` (`ventas.cuenta`). */
export type TipoDeContexto = Readonly<{
  /** Módulo dueño de la cosa. */
  modulo: ClaveModulo;
  /** Qué es, en una línea (sale en el documento; no es texto de pantalla). */
  proposito: string;
  /** Las páginas que lo entregan, desde la raíz del repositorio. Cada una llama a `operacionesPara` con este contexto. */
  loEntregan: readonly string[];
}>;

export type OperacionContextual<C extends string = IdDeContexto> = Readonly<{
  /** Único, forma `modulo.cosa`. */
  id: string;
  /** Quién la hace: tiene que estar disponible y activo para que se ofrezca. */
  modulo: ClaveModulo;
  contexto: C;
  /** Una acción del catálogo, del módulo dueño. */
  accion: ClaveAccion;
  /** Una función de pago del módulo dueño, o ninguna. */
  perilla: ClavePerilla | null;
  etiqueta: ClaveDeTexto;
  /** Entero, único dentro del contexto. Menor va primero. */
  orden: number;
  /** Ruta de una pantalla del módulo dueño; empieza con `/` y existe en `apps/web/app`. */
  seAbreEn: string;
  /** A dónde va la persona al salir: de vuelta a donde estaba o se queda en la pantalla del módulo. */
  alTerminar: "VUELVE" | "SE_QUEDA";
}>;

/** Las claves de una operación, fijas a propósito: sumar una (un «campo», un «panel», un «destino») obliga a decidirlo. */
export const CLAVES_DE_UNA_OPERACION = [
  "id",
  "modulo",
  "contexto",
  "accion",
  "perilla",
  "etiqueta",
  "orden",
  "seAbreEn",
  "alTerminar",
] as const satisfies readonly (keyof OperacionContextual)[];

/** Falla al compilar si el tipo gana una clave que la lista fija no nombra (cierra el hueco de `satisfies`). */
type _ClavesSinListar = Exclude<
  keyof OperacionContextual,
  (typeof CLAVES_DE_UNA_OPERACION)[number]
>;
export const CLAVES_COMPLETAS: [_ClavesSinListar] extends [never] ? true : false = true;
