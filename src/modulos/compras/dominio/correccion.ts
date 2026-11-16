import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { type CodigoDeUnidad } from "../../../primitivas/unidades/unidades";
import {
  leerCantidad,
  leerCantidadPositiva,
  leerPrecioPositivo,
  textoDeCantidad,
  textoDePrecio,
} from "./decimal";
import type { CampoDeHuella } from "./huella";
import { esUuid } from "./identificadores";
import {
  esUnidad,
  MAXIMO_DE_RENGLONES_DE_UNA_COMPRA,
  motivoDeAnulacionDesdeTexto,
} from "./registrar-compra";

/**
 * La corrección de una línea de una compra ya hecha (E9 §3.7, T11; ampliada por la decisión del dueño del 15/11/2026, «Respuestas 24 a 27», Q2 = C): no se anula y se recarga, se
 * corrige con un ajuste y un motivo. Puede cambiar el PRECIO, la CANTIDAD de compra o el PESO REAL (de una línea de peso variable), uno o varios a la vez, y completar el precio de una línea
 * «Sin precio» (con su «precio por»). Pura: sin reloj ni azar. La línea original no se edita: cada corrección es una fila nueva con lo de antes y lo de ahora y un número (la versión
 * optimista de la línea: `correccionesVistas` es la última que vio quien pide). Qué corresponde a cada línea (cantidad o peso real, «precio por» solo si no tenía precio) lo decide el caso de
 * uso con la línea a la vista.
 */
export type CorreccionPedida = Readonly<{
  clave: string;
  recepcionId: string;
  linea: number;
  /** Cuántas correcciones de esta línea había cuando quien pide miró la compra (0 si ninguna). */
  correccionesVistas: number;
  /** Texto decimal de hasta 6 decimales, mayor que cero, en el mismo «precio por» y unidad de precio de la línea (o los de `precioPor` al completar «Sin precio»); `null` si no cambia. */
  precio: string | null;
  /** La cantidad de compra nueva (texto decimal de hasta 4 decimales, mayor que cero); `null` si no cambia. */
  cantidad: string | null;
  /** El peso real nuevo, en la unidad de compra de la línea (peso variable); `null` si no cambia. */
  pesoReal: string | null;
  /** SOLO al completar el precio de una línea que no tenía: por presentación o por unidad. */
  precioPor: "PRESENTACION" | "UNIDAD" | null;
  /** SOLO con `precioPor: "UNIDAD"`: la unidad en que se paga el precio. */
  unidadDePrecio: CodigoDeUnidad | null;
  motivo: string;
}>;

export type ErrorDeCorreccion =
  | "IDENTIFICADOR_INVALIDO"
  | "LINEA_NO_ENCONTRADA"
  | "CORRECCION_DESACTUALIZADA"
  | "PRECIO_INVALIDO"
  | "CANTIDAD_INVALIDA"
  | "PESO_REAL_INVALIDO"
  | "PRECIO_POR_INVALIDO"
  | "CORRECCION_SIN_CAMBIOS_PEDIDOS"
  | "CORRECCION_DE_CANTIDAD_NO_DISPONIBLE"
  | "MOTIVO_REQUERIDO";

const MAXIMO_DE_CORRECCIONES_VISTAS = 1_000_000;

const esEnteroEntre = (valor: unknown, minimo: number, maximo: number): valor is number =>
  Number.isInteger(valor) && (valor as number) >= minimo && (valor as number) <= maximo;

/** Lee el pedido: lo que no es de la forma declarada no pasa. El orden de los errores es el del pedido (ids, línea, versión, precio, cantidad, peso real, «precio por», al menos un cambio, motivo). */
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
  // Un campo que no viene (`undefined`) es «no cambia»; uno que viene tiene que ser válido (`null` o vacío no es «no cambia»: se rechaza).
  const precio = v["precio"];
  const unidadesDePrecio =
    precio === undefined ? null : typeof precio === "string" ? leerPrecioPositivo(precio) : null;
  if (precio !== undefined && unidadesDePrecio === null) return err("PRECIO_INVALIDO");
  const cantidad = v["cantidad"];
  const unidadesDeCantidad =
    cantidad === undefined
      ? null
      : typeof cantidad === "string"
        ? leerCantidadPositiva(cantidad)
        : null;
  if (cantidad !== undefined && unidadesDeCantidad === null) return err("CANTIDAD_INVALIDA");
  const pesoReal = v["pesoReal"];
  const unidadesDePeso =
    pesoReal === undefined
      ? null
      : typeof pesoReal === "string"
        ? leerCantidadPositiva(pesoReal)
        : null;
  if (pesoReal !== undefined && unidadesDePeso === null) return err("PESO_REAL_INVALIDO");
  const precioPor = v["precioPor"];
  const unidadDePrecio = v["unidadDePrecio"];
  if (precioPor !== undefined || unidadDePrecio !== undefined) {
    // El «precio por» solo acompaña a un precio; por unidad lleva su unidad de precio y por presentación no (lo mismo que pide la base).
    const bien =
      unidadesDePrecio !== null &&
      ((precioPor === "UNIDAD" && esUnidad(unidadDePrecio)) ||
        (precioPor === "PRESENTACION" && unidadDePrecio === undefined));
    if (!bien) return err("PRECIO_POR_INVALIDO");
  }
  if (unidadesDePrecio === null && unidadesDeCantidad === null && unidadesDePeso === null)
    return err("CORRECCION_SIN_CAMBIOS_PEDIDOS");
  const motivo = motivoDeAnulacionDesdeTexto(v["motivo"]);
  if (!motivo.ok) return motivo;
  return ok({
    clave,
    recepcionId,
    linea,
    correccionesVistas: vistas,
    precio: unidadesDePrecio === null ? null : textoDePrecio(unidadesDePrecio),
    cantidad: unidadesDeCantidad === null ? null : textoDeCantidad(unidadesDeCantidad),
    pesoReal: unidadesDePeso === null ? null : textoDeCantidad(unidadesDePeso),
    precioPor: precioPor === undefined ? null : precioPor,
    unidadDePrecio: unidadDePrecio === undefined ? null : unidadDePrecio,
    motivo: motivo.valor,
  });
}

/**
 * Los campos de la huella del pedido, con lo canónico (`2.5` y `2.500000` son el mismo pedido). Una corrección que solo cambia el precio conserva EXACTAMENTE los campos de antes de la
 * ampliación: repetir con la misma clave una corrección ya hecha es una repetición y no una clave reutilizada.
 */
export const camposDeHuellaDeCorreccion = (pedido: CorreccionPedida): readonly CampoDeHuella[] => {
  const base = [pedido.recepcionId, pedido.linea, pedido.correccionesVistas];
  const soloPrecio =
    pedido.precio !== null &&
    pedido.cantidad === null &&
    pedido.pesoReal === null &&
    pedido.precioPor === null;
  return soloPrecio
    ? [...base, pedido.precio, pedido.motivo]
    : [
        ...base,
        pedido.precio ?? "",
        pedido.cantidad ?? "",
        pedido.pesoReal ?? "",
        pedido.precioPor ?? "",
        pedido.unidadDePrecio ?? "",
        pedido.motivo,
      ];
};

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
