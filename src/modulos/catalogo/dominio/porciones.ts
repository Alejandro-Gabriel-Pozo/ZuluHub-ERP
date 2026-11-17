import { cantidadDesdeTexto, type Cantidad } from "../../../primitivas/cantidad/cantidad";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { UNIDADES, type CodigoDeUnidad } from "../../../primitivas/unidades/unidades";

/**
 * Las PORCIONES de un producto que se vende por fracciones (dueño, 12/11/2026, `decisiones-del-dueno-2026-11.md`: «Solo 2, 4 y 8»): en cuántas partes se divide el
 * entero (2 → ½, 4 → ¼, 8 → ⅛), una o varias a la vez. Tercios y sextos quedan fuera hasta nueva orden (no caben exactos en el paso decimal). El PASO MÍNIMO se
 * deriva de la porción más fina que se ofrece (confirmado por el dueño el 14/11/2026): 2 y 8 → ⅛ = 0,125; así ⅛ + ⅛ = ¼ vale aunque ¼ no se ofrezca. Puro: sin
 * reloj ni azar. La base repite esta lista y este cálculo (`producto_validar`, 0051); una prueba falla si difieren.
 */
export const PORCIONES_PERMITIDAS = [2, 4, 8] as const;
export type Porcion = (typeof PORCIONES_PERMITIDAS)[number];

/** El paso que corresponde a cada porción: 1 / porción, exacto en 4 decimales. */
const PASO_DE_LA_PORCION: Readonly<Record<Porcion, string>> = {
  2: "0.5",
  4: "0.25",
  8: "0.125",
};

export const esPorcion = (valor: number): valor is Porcion =>
  (PORCIONES_PERMITIDAS as readonly number[]).includes(valor);

/**
 * Las porciones que se piden, en orden ascendente y sin repetir: al menos una, todas entre las permitidas, ninguna dos veces. Cualquier otra cosa es
 * `PORCIONES_INVALIDAS` (una lista vacía no ofrece fracciones: para vender sin fracciones simplemente no se mandan).
 */
export function validarPorciones(
  porciones: readonly number[],
): Resultado<readonly Porcion[], "PORCIONES_INVALIDAS"> {
  if (porciones.length === 0 || new Set(porciones).size !== porciones.length) {
    return err("PORCIONES_INVALIDAS");
  }
  if (!porciones.every(esPorcion)) return err("PORCIONES_INVALIDAS");
  return ok(PORCIONES_PERMITIDAS.filter((p) => porciones.includes(p)));
}

/** El paso mínimo derivado: el de la porción más fina de la lista (la mayor). Sin porciones no hay paso que derivar: es un defecto de quien llama, no un dato. */
export function pasoDePorciones(porciones: readonly Porcion[]): Cantidad {
  const masFina = Math.max(...porciones);
  if (!esPorcion(masFina)) throw new RangeError("pasoDePorciones: hace falta al menos una porción");
  return cantidadDesdeTexto(PASO_DE_LA_PORCION[masFina]);
}

/**
 * ¿Se pueden ofrecer fracciones en esta forma de venta? Solo de un producto «por unidad»: la unidad de venta es la misma que la base y su dimensión es de conteo
 * (media pizza sí; medio kilo es venta por peso, otra cosa). La base lo repite (`producto_porciones_unidad_ck`, 0051).
 */
export function fraccionesAdmitidasEn(unidadBaseId: string, unidadDeVentaId: string): boolean {
  return (
    unidadBaseId === unidadDeVentaId &&
    Object.hasOwn(UNIDADES, unidadDeVentaId) &&
    UNIDADES[unidadDeVentaId as CodigoDeUnidad].dimension === "CONTEO"
  );
}
