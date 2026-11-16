import type { IdDeDato } from "../datos/registro";

/**
 * Tipos de `usos` y `fuente` de un texto del catálogo (`DefinicionDeTexto`, `catalogo.ts`). Diseño y motivo:
 * `Pedernal-docs/11-especificaciones/inventario-de-textos-en-codigo-diseno.md` §2.1 (decisión del dueño, fila 173 del registro
 * `decisiones-del-dueno-2026-11.md`: un texto no declarado no se usa y cada texto dice quién lo consume).
 *
 * Este archivo solo declara la FORMA. Ningún chequeo la exige todavía: ambos campos son opcionales en `DefinicionDeTexto` y los
 * catálogos existentes no los traen. Quien mide el consumo es el analizador de `test/arquitectura/declaracion-de-pantallas-apoyo.ts`.
 */

/** Quién consume un texto. */
export type UsoDeTexto =
  /** Una función exportada o declarada en ese archivo (desde la raíz del repositorio), cuyo cuerpo cita la clave. */
  | Readonly<{ como: "FUNCION"; archivo: string; nombre: string }>
  /** Un dato registrado: los archivos salen de sus `consumidores` en el registro de datos. */
  | Readonly<{ como: "DATO"; dato: IdDeDato }>
  /** Solo lo consume una ficha de pantalla (`src/capacidades/pantallas/`): la relación se declara allí, una sola vez. */
  | "DE_FICHA";

/** Marca de un texto cuyo consumo todavía no está declarado: es deuda registrada, nunca una excepción silenciosa. */
export const USOS_PENDIENTES = "pendiente" as const;

/** Los usos de un texto: al menos uno, o `USOS_PENDIENTES`. */
export type UsosDeTexto = readonly [UsoDeTexto, ...UsoDeTexto[]] | typeof USOS_PENDIENTES;

/** Marca de la línea base: los textos que ya existían cuando se creó el inventario. Solo baja. */
export const FUENTE_HEREDADA = "HEREDADO" as const;

/** De dónde salió el texto aprobado. */
export type FuenteDeTexto =
  /** Una decisión del registro del ERP (`arquitectura/decisiones/registro/DEC-NNNN.json`), aceptada (`CONFIRMADA` o `CORREGIDA`). */
  Readonly<{ decision: `DEC-${number}` }> | typeof FUENTE_HEREDADA;
