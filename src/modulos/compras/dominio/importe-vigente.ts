import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { CodigoDeUnidad } from "../../../primitivas/unidades/unidades";
import { calcularLinea, type ErrorDeLinea, type PresentacionDeLinea } from "./calcular-linea";
import { leerImporte, textoDeImporte } from "./decimal";

/**
 * El importe VIGENTE de una línea de compra y el total de la compra (una sola regla, un solo lugar: la usan la lista y la ficha y nadie más).
 *
 * Una línea corregida NO se edita: su precio vigente es el `precioNuevo` de su última corrección y el `importe` guardado es el del alta. Sin corrección el
 * importe vigente es el guardado; con corrección es el de `calcularLinea` (la misma cuenta del alta: un solo redondeo a centavos) con el precio nuevo.
 * Sin precio el importe es `null` («Sin precio»), nunca cero (D125), y un `null` en cualquier línea hace `null` el total.
 */

export type LineaParaImporte = Readonly<{
  unidadDeCompraId: string;
  cantidadDeCompra: string;
  pesoReal: string | null;
  precioPorTipo: "PRESENTACION" | "UNIDAD" | null;
  unidadDePrecioId: string | null;
  /** El importe guardado al registrar la compra; `null` si la línea no tenía precio. */
  importe: string | null;
}>;

/** Lo que `calcularLinea` necesita del producto y la presentación de la línea para recalcular. */
export type ProductoParaImporte = Readonly<{
  unidadBase: CodigoDeUnidad;
  presentacion: PresentacionDeLinea | null;
}>;

export type ErrorDeImporteVigente =
  ErrorDeLinea | "FALTA_EL_PRODUCTO" | "LINEA_CORREGIDA_SIN_PRECIO_POR";

/**
 * `correccion` es la última corrección de la línea (`null` si no tiene). `producto` solo hace falta con corrección (`null` = no se pudo leer: se falla, no se
 * supone). Una corrección con `precioNuevo: null` deja la línea «Sin precio».
 */
export function importeVigenteDeLinea(
  linea: LineaParaImporte,
  correccion: Readonly<{ precioNuevo: string | null }> | null,
  producto: ProductoParaImporte | null,
): Resultado<string | null, ErrorDeImporteVigente> {
  if (correccion === null) return ok(linea.importe);
  // Una corrección sin precio nuevo deja la línea «Sin precio»: no hay cuenta que hacer.
  if (correccion.precioNuevo === null) return ok(null);
  if (producto === null) return err("FALTA_EL_PRODUCTO");
  if (linea.precioPorTipo === null) return err("LINEA_CORREGIDA_SIN_PRECIO_POR");
  const cuenta = calcularLinea({
    unidadBase: producto.unidadBase,
    presentacion: producto.presentacion,
    unidadDeCompra: linea.unidadDeCompraId as CodigoDeUnidad,
    cantidadDeCompra: linea.cantidadDeCompra,
    pesoReal: linea.pesoReal,
    precioPor: linea.precioPorTipo,
    unidadDePrecio: linea.unidadDePrecioId as CodigoDeUnidad | null,
    precio: correccion.precioNuevo,
  });
  return cuenta.ok ? ok(cuenta.valor.importe) : cuenta;
}

/**
 * El total de la compra: la suma de los importes vigentes de sus líneas, en centavos enteros (nunca `number`). `null` si no hay líneas o si alguna no tiene
 * precio (o su importe no es un decimal de pesos válido): nunca un total parcial ni cero.
 */
export function totalDeCompra(importes: readonly (string | null)[]): string | null {
  if (importes.length === 0) return null;
  let suma = 0n;
  for (const texto of importes) {
    if (texto === null) return null;
    const centavos = leerImporte(texto);
    if (centavos === null) return null;
    suma += centavos;
  }
  return textoDeImporte(suma);
}
