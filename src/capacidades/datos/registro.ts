import { DATOS_DE_ADMINISTRACION } from "./registro-de-administracion";
import { DATOS_DE_CAJA } from "./registro-de-caja";
import { DATOS_DE_FACTURACION } from "./registro-de-facturacion";
import { DATOS_DE_PRODUCTOS } from "./registro-de-productos";
import type { DefinicionDeDato } from "./tipos-de-datos";

export type { DefinicionDeDato } from "./tipos-de-datos";

/**
 * REGISTRO DE DATOS (regla 5 de `Pedernal-docs/01-vision/primitivas-de-negocio.md`; dueño, 2026-11-05: «sin declaración de
 * existencia debería fallar»). Todo campo de entrada de la web y de la consola dice qué dato pide con la prop `dato`, y ese dato
 * tiene que estar acá, con su primitiva (ficha), para qué existe, dónde se pide, quién lo pone y qué necesita para existir.
 *
 * Previene: el fallo real que lo originó. La primitiva del CUIT existía y el campo de documento de «Emitir» no la usaba; el
 * nombre aceptó solo números y el CUIT quedó escrito como nombre. El chequeo mecánico es
 * `test/arquitectura/campos-con-dato.test.ts` (control crudo, campo sin dato, dato no registrado, consumidor no declarado y dato
 * huérfano fallan; cada uno con su violación inyectada).
 *
 * Todo nace cerrado: un dato nuevo se agrega acá, con consumidor real; lo que todavía no está declarado usa `DATO_PENDIENTE` y es
 * deuda registrada con vencimiento en `arquitectura/deuda/registro.json` (entradas `campos-sin-dato--*`), nunca una excepción
 * silenciosa. Solo se registran datos cuya primitiva ya está en `main` y que tienen al menos una pantalla real que los pide.
 *
 * SUPUESTO (DEC-0062) (a confirmar por el dueño): `estadoDeEmpresa` es solo `ACTIVE` (lo más cerrado); `ponerPor` de un filtro de lectura es la
 * acción que permite mirar.
 */

/** Marca de un campo cuyo dato todavía no está registrado: es deuda, la cuenta y la limita el chequeo. */
export const DATO_PENDIENTE = "pendiente" as const;

/**
 * Los datos por módulo, cada uno en su archivo (`registro-de-<módulo>.ts`): un módulo nuevo suma su archivo y UNA línea acá, y dos ramas que suman datos de módulos
 * distintos no se pisan. Un mismo id en dos fragmentos se perdería en silencio al juntarlos: `test/arquitectura/datos-por-modulo.test.ts` lo hace fallar.
 */
export const FRAGMENTOS_DEL_REGISTRO = {
  administracion: DATOS_DE_ADMINISTRACION,
  caja: DATOS_DE_CAJA,
  facturacion: DATOS_DE_FACTURACION,
  productos: DATOS_DE_PRODUCTOS,
} as const;

export const REGISTRO_DE_DATOS = {
  ...DATOS_DE_ADMINISTRACION,
  ...DATOS_DE_CAJA,
  ...DATOS_DE_FACTURACION,
  ...DATOS_DE_PRODUCTOS,
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;

export type IdDeDato = keyof typeof REGISTRO_DE_DATOS;

/** Lo que acepta la prop `dato` de un componente de campo. */
export type DatoDeCampo = IdDeDato | typeof DATO_PENDIENTE;

/**
 * Los únicos archivos que pueden tener un `<input>`, `<textarea>` o `<select>` crudo, y los únicos cuyo uso exige `dato`. Cada uno
 * tiene que declarar la prop `dato: DatoDeCampo` (lo comprueba el chequeo). Un componente de campo nuevo se suma acá.
 */
export const COMPONENTES_DE_CAMPO = [
  "apps/web/ui/componentes/Campo.tsx",
  "apps/web/ui/componentes/CampoDeCodigo.tsx",
  "apps/web/ui/componentes/CampoDeDocumento.tsx",
  "apps/web/ui/componentes/CampoImporte.tsx",
  "apps/web/ui/componentes/CampoNumero.tsx",
  "apps/web/ui/componentes/Selector.tsx",
] as const;
