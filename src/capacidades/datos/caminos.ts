import { CAMINOS_DE_CAJA } from "./caminos-de-caja";
import { CAMINOS_DE_PRODUCTOS } from "./caminos-de-productos";
import type { DefinicionDeCamino } from "./tipos-de-caminos";

export type { DefinicionDeCamino, PasoDeCamino } from "./tipos-de-caminos";

/**
 * CAMINOS DECLARADOS (regla 5.b de `Pedernal-docs/01-vision/primitivas-de-negocio.md`, dueño 05/11/2026; D1 del estudio `generacion-de-pantallas-estudio.md`, piloto
 * «B + D1», 12/11/2026): cada pantalla con formulario declara su función, la acción que ejecuta y qué dato completa cada paso. Es un VERIFICADOR, no un generador: no
 * arma nada, solo permite que `test/arquitectura/caminos-declarados.test.ts` falle cuando lo declarado no cuadra.
 *
 * Previene el fallo que originó la regla: al emitir, el aviso decía «nombre, documento, condición frente al IVA o domicilio» sin marcar cuál y la pantalla no tenía
 * campo de domicilio (nada garantizaba que los pasos cubrieran lo que la acción requiere). Chequeos (cada uno con su violación inyectada en
 * `test/arquitectura/caminos-declarados-evasiones.test.ts`):
 *  (a) un dato que la acción EXIGE y ningún paso completa (ni se deriva solo) falla;
 *  (b) un dato que un paso pide y la acción no consume (ni exige ni admite) falla;
 *  (c) un `campo` que el servidor puede devolver en un error y no existe en ningún paso falla.
 * Y la forma: todo dato existe en el registro, la acción existe en el catálogo, la pantalla existe y la pide (`consumidores` del dato). Lo que no se declara no se
 * verifica (por eso los caminos de las demás pantallas se suman cada uno con su pantalla: la limpieza del registro va con cada pantalla nueva, no aparte).
 */

/**
 * Los caminos por módulo, cada uno en su archivo (`caminos-de-<módulo>.ts`): un módulo nuevo suma su archivo y UNA línea acá. Un mismo id en dos fragmentos se
 * perdería en silencio al juntarlos: `test/arquitectura/datos-por-modulo.test.ts` lo hace fallar.
 */
export const FRAGMENTOS_DE_CAMINOS = {
  caja: CAMINOS_DE_CAJA,
  productos: CAMINOS_DE_PRODUCTOS,
} as const;

export const CAMINOS = {
  ...CAMINOS_DE_CAJA,
  ...CAMINOS_DE_PRODUCTOS,
} as const satisfies Readonly<Record<string, DefinicionDeCamino>>;

export type IdDeCamino = keyof typeof CAMINOS;
