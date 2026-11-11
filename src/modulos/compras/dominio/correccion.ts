import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  leerCantidad,
  leerCantidadPositiva,
  leerPrecioPositivo,
  textoDeCantidad,
  textoDePrecio,
} from "./decimal";
import type { CampoDeHuella } from "./huella";
import { esUuid } from "./identificadores";
import { MAXIMO_DE_RENGLONES_DE_UNA_COMPRA, motivoDeAnulacionDesdeTexto } from "./registrar-compra";

/**
 * La corrección del PRECIO de una línea de una compra ya hecha (E9 §3.7, T11): no se anula y se recarga, se corrige con un ajuste y un motivo. Pura: sin reloj ni
 * azar. La línea original no se edita: cada corrección es una fila nueva con el precio de antes y el de ahora y un número (la versión optimista de la línea:
 * `correccionesVistas` es la última que vio quien pide). Corregir cantidad o peso real no entra en esta tanda (DEC-0319).
 */
export type CorreccionPedida = Readonly<{
  clave: string;
  recepcionId: string;
  linea: number;
  /** Cuántas correcciones de esta línea había cuando quien pide miró la compra (0 si ninguna). */
  correccionesVistas: number;
  /** Texto decimal de hasta 6 decimales, mayor que cero, en el mismo «precio por» y unidad de precio de la línea. */
  precio: string;
  motivo: string;
}>;

export type ErrorDeCorreccion =
  | "IDENTIFICADOR_INVALIDO"
  | "LINEA_NO_ENCONTRADA"
  | "CORRECCION_DESACTUALIZADA"
  | "PRECIO_INVALIDO"
  | "MOTIVO_REQUERIDO";

const MAXIMO_DE_CORRECCIONES_VISTAS = 1_000_000;

const esEnteroEntre = (valor: unknown, minimo: number, maximo: number): valor is number =>
  Number.isInteger(valor) && (valor as number) >= minimo && (valor as number) <= maximo;

/** Lee el pedido: lo que no es de la forma declarada no pasa. El orden de los errores es el del pedido (ids, línea, versión, precio, motivo). */
export function leerCorreccion(valor: unknown): Resultado<CorreccionPedida, ErrorDeCorreccion> {
  const v =
    typeof valor === "object" && valor !== null && !Array.isArray(valor)
      ? (valor as Record<string, unknown>)
      : {};
  const clave = v["clave"];
  const recepcionId = v["recepcionId"];
  if (typeof clave !== "string" || !esUuid(clave)) return err("IDENTIFICADOR_INVALIDO");
  if (typeof recepcionId !== "string" || !esUuid(recepcionId)) return err("IDENTIFICADOR_INVALIDO");
  const linea = v["linea"];
  if (!esEnteroEntre(linea, 1, MAXIMO_DE_RENGLONES_DE_UNA_COMPRA))
    return err("LINEA_NO_ENCONTRADA");
  const vistas = v["correccionesVistas"];
  if (!esEnteroEntre(vistas, 0, MAXIMO_DE_CORRECCIONES_VISTAS)) {
    return err("CORRECCION_DESACTUALIZADA");
  }
  const precio = v["precio"];
  const unidades = typeof precio === "string" ? leerPrecioPositivo(precio) : null;
  if (unidades === null) return err("PRECIO_INVALIDO");
  const motivo = motivoDeAnulacionDesdeTexto(v["motivo"]);
  if (!motivo.ok) return motivo;
  return ok({
    clave,
    recepcionId,
    linea,
    correccionesVistas: vistas,
    precio: textoDePrecio(unidades),
    motivo: motivo.valor,
  });
}

/** Los campos de la huella del pedido: el precio ya en su forma canónica (`2.5` y `2.500000` son el mismo pedido). */
export const camposDeHuellaDeCorreccion = (pedido: CorreccionPedida): readonly CampoDeHuella[] => [
  pedido.recepcionId,
  pedido.linea,
  pedido.correccionesVistas,
  pedido.precio,
  pedido.motivo,
];

/** ¿El precio pedido es el que ya rige? (`null`: la línea todavía no tiene precio, así que cualquier precio es un cambio.) */
export const esElMismoPrecio = (vigente: string | null, pedido: string): boolean =>
  vigente !== null && leerPrecioPositivo(vigente) === leerPrecioPositivo(pedido);

/**
 * Lo que ya no estaba de lo que entró cuando se corrigió: `entró − queda` (ambas cantidades en texto decimal; la primera es positiva, la segunda puede ser cero y nunca es mayor que la primera: stock la acota).
 * Lanza si las cantidades guardadas no se leen (un defecto, no un dato de la pantalla).
 */
export function cantidadConsumida(entro: string, queda: string): string {
  const entrada = leerCantidadPositiva(entro);
  // Lo que queda puede ser cero (se consumió todo).
  const resto = leerCantidad(queda);
  if (entrada === null || resto === null || resto > entrada) {
    throw new RangeError("compras: las cantidades de la corrección no son consistentes");
  }
  return textoDeCantidad(entrada - resto);
}
