import { createHash } from "node:crypto";

/**
 * La huella de una línea de combo (E8 §3.4): sha256 (hex) de lo que pidió quien toma el pedido: el combo, las elecciones por `(posición, unidad)`, las opciones y
 * los cambios de cada una. Con el `lineaId` decide si un reintento es la misma línea (misma huella: devuelve lo hecho) o un `lineaId` reutilizado con otro contenido
 * (`LINEA_ID_EN_USO`). Determinista y puro: no depende del orden en que la pantalla manda las elecciones, las opciones ni los cambios, y no lleva reloj ni azar. La
 * versión del combo NO entra: la lee el servidor en su transacción, no la manda la pantalla.
 * Previene: un clic doble que agrega dos combos, o un `lineaId` pisado con otras elecciones.
 */
export type CambioDeEleccion = Readonly<{
  ingredienteId: string;
  accion: "SACAR" | "CAMBIAR";
  reemplazoId: string | null;
}>;

export type EleccionDeComponente = Readonly<{
  posicion: number;
  unidad: number;
  /** Solo si el componente es a elegir; `null` en un componente fijo. */
  productoId: string | null;
  opcionIds: readonly string[];
  cambios: readonly CambioDeEleccion[];
}>;

export type PedidoDeConjunto = Readonly<{
  cuentaId: string;
  productoId: string;
  componentes: readonly EleccionDeComponente[];
}>;

export function huellaDeLineaDeConjunto(pedido: PedidoDeConjunto): string {
  const componentes = pedido.componentes
    .map((c) => [
      c.posicion,
      c.unidad,
      c.productoId,
      [...c.opcionIds].sort(),
      // Cada cambio como texto JSON y en el orden por defecto de `sort()` (por unidades de código): determinista, sin comparador propio.
      c.cambios.map((x) => JSON.stringify([x.ingredienteId, x.accion, x.reemplazoId])).sort(),
    ])
    .sort((a, b) => (a[0] as number) - (b[0] as number) || (a[1] as number) - (b[1] as number));
  return createHash("sha256")
    .update(JSON.stringify([pedido.cuentaId, pedido.productoId, componentes]))
    .digest("hex");
}
