/**
 * ARCHIVO CENTRAL
 * QUÉ ES: el catálogo de todos los textos que ve una persona; de acá sale el tipo `ClaveDeTexto`.
 * QUÉ NO ES: el lugar donde se escriben los textos de un módulo ni los del núcleo.
 * EXPORTA: LARGO_MAXIMO_DE_TEXTO, DefinicionDeTexto, CATALOGO_DE_TEXTOS, ClaveDeTexto
 * IMPORTA: src/capacidades/vocabulario/catalogo-*, src/capacidades/vocabulario/uso-y-fuente-de-texto.
 * PARTE DEDICADA: src/capacidades/vocabulario/catalogo-<módulo>.ts (lo de cada módulo va ahí).
 */
/**
 * Catálogo de textos por defecto (marcas y planes, §B.4). Es código, no base de datos: de acá sale el tipo cerrado `ClaveDeTexto`, así que una pantalla que pide una clave
 * inexistente NO compila y, como el catálogo es total por tipo, nunca falta un texto. La marca (el producto) solo reemplaza la redacción; el CÓDIGO de un error o de un motivo
 * es estable y se muestra junto al texto.
 *
 * Hoy trae las claves del módulo `administracion` (su nombre y los roles fijos de empresa), los cinco motivos del guard (un solo lugar para el texto de cada rechazo) y los
 * errores nuevos de este módulo que puede ver una empresa o la puerta de entrada. Cada módulo suma las suyas en el tramo que lo construye, con el prefijo del módulo dueño
 * (`reservas.estadia.singular`).
 *
 * Reglas de las claves y de los textos (las repite la base como defensa en profundidad, sin conocer el
 * catálogo):
 *  - clave: `^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,5}$`, minúsculas. Un código de motivo o de error entra en
 *    minúsculas (`motivo.sin_permiso`): el tipo lo verifica (`Lowercase<MotivoDeRechazo>`).
 *  - texto: es-AR, frases enteras (no se componen artículos ni género), sin `<` ni `>`, sin
 *    caracteres de control; los marcadores van entre llaves (`{limite}`) y se insertan como texto.
 */

import { TEXTOS_DE_CAJA } from "./catalogo-caja";
import { TEXTOS_DE_CATALOGO } from "./catalogo-catalogo";
import { TEXTOS_DE_CIERRE } from "./catalogo-cierre";
import { TEXTOS_DE_COMANDAS } from "./catalogo-comandas";
import { TEXTOS_DE_CLIENTES } from "./catalogo-clientes";
import { TEXTOS_DE_COMPRAS } from "./catalogo-compras";
import { TEXTOS_DE_FISCAL } from "./catalogo-fiscal";
import { TEXTOS_DE_FISCAL_CONFIGURACION } from "./catalogo-fiscal-configuracion";
import { TEXTOS_DE_FISCAL_EMITIR } from "./catalogo-fiscal-emitir";
import { TEXTOS_DE_FISCAL_IMPRIMIR } from "./catalogo-fiscal-imprimir";
import { TEXTOS_DE_FISCAL_PANTALLAS } from "./catalogo-fiscal-pantallas";
import { TEXTOS_DE_LOTES } from "./catalogo-lotes";
import { TEXTOS_DE_PRODUCCION } from "./catalogo-produccion";
import { TEXTOS_DE_SALON } from "./catalogo-salon";
import { TEXTOS_DE_STOCK } from "./catalogo-stock";
import { TEXTOS_DE_VENTAS } from "./catalogo-ventas";
import { TEXTOS_DE_CARTA_PUBLICA } from "./catalogo-carta-publica";
import { TEXTOS_DEL_NUCLEO } from "./catalogo-nucleo";
import { TEXTOS_DE_SESION_Y_EMPRESA } from "./catalogo-sesion-y-empresa";
import type { FuenteDeTexto, UsosDeTexto } from "./uso-y-fuente-de-texto";

/** El largo máximo de un texto que no declara otro (la base admite hasta 200 en cualquier caso). */
export const LARGO_MAXIMO_DE_TEXTO = 80; // fuente-unica: ajeno — el largo de un texto del vocabulario es otro dato que el nombre de cocina

export type DefinicionDeTexto = Readonly<{
  /** El texto por defecto, en es-AR. Es el respaldo de toda la cadena de herencia de la marca. */
  porDefecto: string;
  /** Hasta cuántos caracteres puede tener un reemplazo de la marca. Omitido: `LARGO_MAXIMO_DE_TEXTO`. */
  largoMaximo?: number;
  /** Los marcadores que admite, sin llaves; los mismos que usa `porDefecto`. Omitido: ninguno. */
  marcadores?: readonly string[];
  /**
   * Quién consume el texto (inventario de textos, fila 173 de `decisiones-del-dueno-2026-11.md`). OPCIONAL por ahora: ningún chequeo
   * lo exige; lo medirá el analizador de declaraciones (tramo U2). No se agrega a los catálogos existentes en este tramo.
   */
  usos?: UsosDeTexto;
  /** De dónde salió el texto aprobado: un `DEC` aceptado o `HEREDADO`. OPCIONAL por ahora, igual que `usos`. */
  fuente?: FuenteDeTexto;
}>;

export const CATALOGO_DE_TEXTOS = {
  ...TEXTOS_DEL_NUCLEO,
  ...TEXTOS_DE_CARTA_PUBLICA,
  ...TEXTOS_DE_SESION_Y_EMPRESA,
  // Facturador (H7 facturación): sus errores de negocio y lo que informa ARCA, traducido (`catalogo-fiscal.ts`).
  ...TEXTOS_DE_FISCAL,
  ...TEXTOS_DE_FISCAL_PANTALLAS,
  ...TEXTOS_DE_FISCAL_CONFIGURACION,
  ...TEXTOS_DE_FISCAL_EMITIR,
  ...TEXTOS_DE_FISCAL_IMPRIMIR,
  // Módulos de E2, E3 y E4: nacen vacíos y cada etapa suma los suyos en su archivo (E0-T4).
  ...TEXTOS_DE_CATALOGO,
  ...TEXTOS_DE_CAJA,
  ...TEXTOS_DE_CIERRE,
  ...TEXTOS_DE_VENTAS,
  ...TEXTOS_DE_STOCK,
  ...TEXTOS_DE_PRODUCCION,
  ...TEXTOS_DE_LOTES,
  ...TEXTOS_DE_SALON,
  ...TEXTOS_DE_COMANDAS,
  ...TEXTOS_DE_CLIENTES,
  ...TEXTOS_DE_COMPRAS,
} as const satisfies Record<string, DefinicionDeTexto>;

export type ClaveDeTexto = keyof typeof CATALOGO_DE_TEXTOS;
