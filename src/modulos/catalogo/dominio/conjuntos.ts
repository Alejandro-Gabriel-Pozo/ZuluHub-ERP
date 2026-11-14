import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { OpcionId, ProductoId, SeccionDeCartaId } from "./identificadores";

/**
 * El contenido de un combo (E8 §3.1 y §3.3): un producto de clase `CONJUNTO` con un solo precio que lleva otros productos, fijos o a elegir. Funciones PURAS, sin
 * base ni reloj: el tipo del contenido, su validación de forma y quién es elegible en una sección (UNA sola vez: la pantalla, el guardado y la venta usan esta).
 * Las comprobaciones que necesitan la base (que el producto exista, esté activo, se venda) las hace el caso de uso con estos mismos tipos.
 */

/** Un componente entra con cantidad entera de 1 a 9 (`componente_de_conjunto.cantidad smallint 1..9`). */
export const CANTIDAD_MINIMA_DE_COMPONENTE = 1;
export const CANTIDAD_MAXIMA_DE_COMPONENTE = 9;

export type ComponenteDeConjunto =
  | Readonly<{
      tipo: "FIJO";
      cantidad: number;
      productoId: ProductoId;
      /** El tamaño fijo, opcional: una opción de un grupo `VARIANTE` de ESE producto. */
      varianteOpcionId: OpcionId | null;
    }>
  | Readonly<{
      tipo: "ELECCION_EN_SECCION";
      cantidad: number;
      seccionDeCartaId: SeccionDeCartaId;
    }>;

export type ErrorDeContenido =
  | Readonly<{ codigo: "CONJUNTO_SIN_COMPONENTES" }>
  | Readonly<{ codigo: "CANTIDAD_INVALIDA"; posicion: number }>;

/**
 * La forma del contenido: al menos un componente y cada cantidad un ENTERO entre 1 y 9. La posición de un componente es su lugar en la lista (desde 1): no se manda.
 * Previene: un combo vacío o con «2,5 gaseosas» (la cantidad de la línea y de las unidades selladas es entera).
 */
export function validarContenidoDeConjunto(
  componentes: readonly ComponenteDeConjunto[],
): Resultado<readonly ComponenteDeConjunto[], ErrorDeContenido> {
  if (componentes.length === 0) return err({ codigo: "CONJUNTO_SIN_COMPONENTES" });
  for (const [indice, componente] of componentes.entries()) {
    const { cantidad } = componente;
    const valida =
      Number.isInteger(cantidad) &&
      cantidad >= CANTIDAD_MINIMA_DE_COMPONENTE &&
      cantidad <= CANTIDAD_MAXIMA_DE_COMPONENTE;
    if (!valida) return err({ codigo: "CANTIDAD_INVALIDA", posicion: indice + 1 });
  }
  return ok(componentes);
}

/** Lo que hace falta saber de un producto para decidir si se puede elegir en una sección. */
export type CandidatoDeSeccion = Readonly<{
  productoId: ProductoId;
  claseDeProducto: "SIMPLE" | "CONJUNTO";
  activo: boolean;
  seVende: boolean;
  seccionDeCartaId: SeccionDeCartaId | null;
  /** Solo importa si hay un grupo de tamaños (`VARIANTE`) activo; la clase llega como texto del grupo. */
  grupos: readonly Readonly<{ clase: string; activo: boolean }>[];
  /** Con precio vigente en la sucursal: los sin precio no entran (D175, punto 6). */
  conPrecioVigente: boolean;
  agotado: boolean;
}>;

/**
 * Quién es elegible en una sección de un combo (E8 §3.3): producto SIMPLE (un combo no lleva combos), activo, que se vende, de esa sección, SIN tamaños (sin grupo
 * `VARIANTE` activo: un tamaño dentro de una elección no se admite, PP-7), con precio vigente y no agotado. Conserva el orden de la entrada. Un candidato sin
 * sección nunca es elegible (todo nace cerrado).
 */
export function elegiblesDeSeccion(
  seccion: SeccionDeCartaId,
  candidatos: readonly CandidatoDeSeccion[],
): ProductoId[] {
  return candidatos
    .filter(
      (c) =>
        c.claseDeProducto === "SIMPLE" &&
        c.activo &&
        c.seVende &&
        c.seccionDeCartaId === seccion &&
        !c.grupos.some((g) => g.clase === "VARIANTE" && g.activo) &&
        c.conPrecioVigente &&
        !c.agotado,
    )
    .map((c) => c.productoId);
}
