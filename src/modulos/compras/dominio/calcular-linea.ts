import { dividirRedondeando } from "../../../primitivas/cantidad/redondeo-entero";
import { POLITICA_VIGENTE } from "../../../primitivas/dinero/redondeo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { convertirCantidad } from "../../../primitivas/unidades/convertir-cantidad";
import { UNIDADES, type CodigoDeUnidad } from "../../../primitivas/unidades/unidades";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import {
  MAXIMO_DE_UNIDADES_EXACTAS,
  UNO_DE_CANTIDAD,
  UNO_DE_IMPORTE,
  UNO_DE_PRECIO,
  leerCantidad,
  leerCantidadPositiva,
  leerPrecioPositivo,
  textoDeCantidad,
  textoDeImporte,
  textoDePrecio,
} from "./decimal";

/**
 * La cuenta de una línea de compra (E9 §3.4; D135, D109, D91, D92). Pura, con `bigint`: sin `number`, sin reloj ni azar. Dada una línea, dice
 * cuánto ENTRA al stock (siempre en la unidad base del producto), cuánto es el importe y cuánto cuesta cada unidad de stock.
 *
 *  - Cantidad en stock: con una presentación de peso variable, el PESO REAL (obligatorio: sin pesar no se confirma; el aproximado de la presentación
 *    nunca entra a la cuenta), expresado en la unidad de compra y convertido EXACTO a la base. Con una presentación de cantidad fija,
 *    `cantidadDeCompra × cantidad de la presentación` (en la base). Sin presentación, la cantidad de compra convertida exacta desde la unidad de
 *    compra. Nunca se redondea una cantidad (D21): lo que no es exacto se rechaza (`CONVERSION_NO_EXACTA`).
 *  - Importe: precio por PRESENTACION × cantidad de presentaciones, o precio por UNIDAD (la de `unidadDePrecio`) × la cantidad en stock expresada en
 *    esa unidad. Se calcula como una fracción exacta y se redondea UNA vez a centavos con la política vigente.
 *  - Costo por unidad de stock: el importe EXACTO dividido la cantidad que entra, redondeado UNA vez a 6 decimales (D135: «el importe dividido el peso
 *    real»). Se parte del exacto y no del importe ya redondeado para no redondear dos veces.
 *  - Sin precio (`precio: null`): importe y costo quedan `null` JUNTOS, nunca cero (D125).
 *
 * SUPUESTO (E9-T5): un precio de cero se rechaza (`PRECIO_INVALIDO`): un cero se confundiría con «sin precio»; costo de revertir bajo (aflojar un `<=`).
 */
export type PresentacionDeLinea = Readonly<{
  /** La cantidad de la presentación en la unidad base del producto, texto decimal (en peso variable es solo el aproximado). */
  cantidadEnBase: string;
  dePesoVariable: boolean;
}>;

export type EntradaDeLinea = Readonly<{
  /** La unidad base del producto: la de stock. */
  unidadBase: CodigoDeUnidad;
  presentacion: PresentacionDeLinea | null;
  /** La unidad en que se escribe la cantidad (sin presentación) o el peso real (peso variable). Misma dimensión que la base. */
  unidadDeCompra: CodigoDeUnidad;
  /** Cajas o packs si hay presentación; si no, la cantidad en la unidad de compra. */
  cantidadDeCompra: string;
  /** Obligatorio con peso variable, en la unidad de compra. */
  pesoReal: string | null;
  precioPor: "PRESENTACION" | "UNIDAD";
  /** Obligatoria con `precioPor: "UNIDAD"` y precio. Misma dimensión que la base. */
  unidadDePrecio: CodigoDeUnidad | null;
  /** Texto decimal de hasta 6 decimales, o `null` si todavía no se sabe. */
  precio: string | null;
}>;

export type SalidaDeLinea = Readonly<{
  /** Texto decimal de 4 decimales, en la unidad base. */
  cantidadEnStock: string;
  /** Texto decimal de 2 decimales; `null` si no hay precio. */
  importe: string | null;
  /** Texto decimal de 6 decimales; `null` si no hay precio. */
  costoPorUnidadDeStock: string | null;
}>;

export type ErrorDeLinea =
  | "CANTIDAD_INVALIDA"
  | "PRESENTACION_INVALIDA"
  | "PESO_REAL_REQUERIDO"
  | "PESO_REAL_NO_CORRESPONDE"
  | "DIMENSION_DISTINTA"
  | "CONVERSION_NO_EXACTA"
  | "FUERA_DE_RANGO"
  | "PRECIO_INVALIDO"
  | "PRECIO_POR_INVALIDO"
  | "UNIDAD_DE_PRECIO_REQUERIDA";

type R<T> = Resultado<T, ErrorDeLinea>;

/** `cantidad` en `de` expresada en `a`, exacta; `DIMENSION_DISTINTA`, `CONVERSION_NO_EXACTA` o `FUERA_DE_RANGO` si no se puede. */
function convertirExacta(unidades: bigint, de: CodigoDeUnidad, a: CodigoDeUnidad): R<bigint> {
  const convertida = convertirCantidad(cantidadDesdeTexto(textoDeCantidad(unidades)), de, a);
  if (!convertida.ok) return err(convertida.error);
  return ok(convertida.valor.unidades);
}

/** `a × b` de dos cantidades de 4 decimales, exacta (el resultado también tiene 4 decimales). */
function multiplicarCantidades(a: bigint, b: bigint): R<bigint> {
  const producto = a * b;
  if (producto % UNO_DE_CANTIDAD !== 0n) return err("CONVERSION_NO_EXACTA");
  const resultado = producto / UNO_DE_CANTIDAD;
  return resultado > MAXIMO_DE_UNIDADES_EXACTAS ? err("FUERA_DE_RANGO") : ok(resultado);
}

function cantidadEnStock(entrada: EntradaDeLinea): R<bigint> {
  const cantidad = leerCantidadPositiva(entrada.cantidadDeCompra);
  if (cantidad === null) return err("CANTIDAD_INVALIDA");
  const dimensionBase = UNIDADES[entrada.unidadBase].dimension;
  if (UNIDADES[entrada.unidadDeCompra].dimension !== dimensionBase)
    return err("DIMENSION_DISTINTA");
  const presentacion = entrada.presentacion;
  if (presentacion === null) {
    if (entrada.pesoReal !== null) return err("PESO_REAL_NO_CORRESPONDE");
    return convertirExacta(cantidad, entrada.unidadDeCompra, entrada.unidadBase);
  }
  const enBase = leerCantidadPositiva(presentacion.cantidadEnBase);
  if (enBase === null) return err("PRESENTACION_INVALIDA");
  if (!presentacion.dePesoVariable) {
    if (entrada.pesoReal !== null) return err("PESO_REAL_NO_CORRESPONDE");
    return multiplicarCantidades(cantidad, enBase);
  }
  const peso = entrada.pesoReal === null ? null : leerCantidadPositiva(entrada.pesoReal);
  if (peso === null) return err("PESO_REAL_REQUERIDO");
  return convertirExacta(peso, entrada.unidadDeCompra, entrada.unidadBase);
}

/** El importe como fracción exacta `numerador / denominador` en pesos (antes de redondear), o el error del precio. */
function importeExacto(
  entrada: EntradaDeLinea,
  precio: bigint,
  cantidadDeCompra: bigint,
  enStock: bigint,
): R<Readonly<{ numerador: bigint; denominador: bigint }>> {
  if (entrada.precioPor === "PRESENTACION") {
    if (entrada.presentacion === null) return err("PRECIO_POR_INVALIDO");
    return ok({
      numerador: precio * cantidadDeCompra,
      denominador: UNO_DE_PRECIO * UNO_DE_CANTIDAD,
    });
  }
  if (entrada.unidadDePrecio === null) return err("UNIDAD_DE_PRECIO_REQUERIDA");
  const deLaBase = UNIDADES[entrada.unidadBase];
  const dePrecio = UNIDADES[entrada.unidadDePrecio];
  if (dePrecio.dimension !== deLaBase.dimension) return err("DIMENSION_DISTINTA");
  return ok({
    numerador: precio * enStock * deLaBase.factor,
    denominador: UNO_DE_PRECIO * UNO_DE_CANTIDAD * dePrecio.factor,
  });
}

export function calcularLinea(entrada: EntradaDeLinea): R<SalidaDeLinea> {
  const enStock = cantidadEnStock(entrada);
  if (!enStock.ok) return enStock;
  if (entrada.precio === null) {
    return ok({
      cantidadEnStock: textoDeCantidad(enStock.valor),
      importe: null,
      costoPorUnidadDeStock: null,
    });
  }
  const precio = leerPrecioPositivo(entrada.precio);
  if (precio === null) return err("PRECIO_INVALIDO");
  // La cantidad de compra ya se validó en `cantidadEnStock` (no puede fallar acá).
  const cantidadDeCompra = leerCantidad(entrada.cantidadDeCompra) ?? 0n;
  const exacto = importeExacto(entrada, precio, cantidadDeCompra, enStock.valor);
  if (!exacto.ok) return exacto;
  const { numerador, denominador } = exacto.valor;
  const importe = dividirRedondeando(numerador * UNO_DE_IMPORTE, denominador, POLITICA_VIGENTE);
  // costo = importe exacto ÷ cantidad en stock, en millonésimos: (N/D) × 10^6 ÷ (q / 10^4)
  const costo = dividirRedondeando(
    numerador * UNO_DE_PRECIO * UNO_DE_CANTIDAD,
    denominador * enStock.valor,
    POLITICA_VIGENTE,
  );
  // Stryker disable next-line EqualityOperator: el importe exacto de numeric(18,2) (10^18 − 1 centavos) no se alcanza con un precio de 6 decimales por una cantidad de 4; el borde del costo lo prueba un caso aparte
  if (importe > MAXIMO_DE_UNIDADES_EXACTAS || costo > MAXIMO_DE_UNIDADES_EXACTAS) {
    return err("FUERA_DE_RANGO");
  }
  return ok({
    cantidadEnStock: textoDeCantidad(enStock.valor),
    importe: textoDeImporte(importe),
    costoPorUnidadDeStock: textoDePrecio(costo),
  });
}
