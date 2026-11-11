import { fechaCivilDesdeTexto } from "../../../primitivas/tiempo/fecha-civil";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  esNumeroDeComprobanteValido,
  esPuntoDeVentaValido,
  esTipoDeComprobanteDeProveedor,
  type EntradaDeTributo,
  type TipoDeComprobanteDeProveedor,
} from "./comprobante";
import { leerCantidad, leerCantidadPositiva, textoDeCantidad } from "./decimal";
import type { CampoDeHuella } from "./huella";

/**
 * Lo puro de la factura que viaja con la compra (N2, E9 §3.5): leer lo que manda la pantalla como lista de PERMITIDOS, aplanarlo para la huella, la percepción
 * única de la pantalla aprobada (un tributo sin clasificar), el reparto de la conciliación atajo y la razón social copiada. Las cuentas (neto, IVA, totales)
 * son de `calcularComprobante`. Sin reloj ni azar.
 *
 * SUPUESTO (E9-T9): la cantidad y el precio de cada línea de la factura vienen EN LA UNIDAD BASE del producto (la misma en que se guarda lo recibido), para que
 * lo asignado, lo recibido y lo facturado se comparen sin convertir. La pantalla convertirá lo que imprime el papel; costo de revertir: medio (una capa de conversión).
 */
export type LineaDeFacturaPedida = Readonly<{
  /** El renglón de la compra (desde 1) al que corresponde. */
  renglon: number;
  cantidadFacturada: string;
  precioNeto: string;
  alicuota: string | null;
}>;

export type FacturaPedida = Readonly<{
  tipo: TipoDeComprobanteDeProveedor;
  puntoDeVenta: number;
  numero: number;
  fecha: string;
  vencimientoDePago: string | null;
  lineas: readonly LineaDeFacturaPedida[];
  /** El importe de la casilla «Percepciones» de la pantalla (se guarda como un tributo sin clasificar); `null` si no hay. */
  percepciones: string | null;
  totalSegunFactura: string;
  cuitDelProveedor: string | null;
  condicionIva: string | null;
}>;

export type ErrorDeFactura =
  | "TIPO_DE_COMPROBANTE_INVALIDO"
  | "PUNTO_DE_VENTA_INVALIDO"
  | "NUMERO_DE_COMPROBANTE_INVALIDO"
  | "FECHA_INVALIDA"
  | "MONEDA_NO_SOPORTADA"
  | "LINEAS_REQUERIDAS"
  | "RENGLONES_INVALIDOS"
  | "TOTAL_INVALIDO"
  | "CUIT_INVALIDO";

/** El tope de líneas de una factura: el de renglones de una compra (cada línea apunta a un renglón). */
const MAXIMO_DE_LINEAS_DE_UNA_FACTURA = 9_999;

const comoRegistro = (valor: unknown): Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};

/** Un texto opcional: ausente o `null` es `null`; un texto es el texto; otra cosa es inválida (`undefined`). */
function textoOpcional(valor: unknown): string | null | undefined {
  if (valor === undefined || valor === null) return null;
  return typeof valor === "string" ? valor : undefined;
}

const esFechaCivil = (valor: unknown): valor is string =>
  typeof valor === "string" && fechaCivilDesdeTexto(valor).ok;

export function leerFactura(valor: unknown): Resultado<FacturaPedida, ErrorDeFactura> {
  const f = comoRegistro(valor);
  const tipo = f["tipo"];
  // `includes` compara con `===`: lo que no es un texto de la lista no pasa, sin mirar el tipo antes.
  if (!esTipoDeComprobanteDeProveedor(tipo as string)) return err("TIPO_DE_COMPROBANTE_INVALIDO");
  // `Number.isInteger` ya rechaza todo lo que no es un número entero: no hace falta mirar el tipo antes.
  if (!esPuntoDeVentaValido(f["puntoDeVenta"] as number)) return err("PUNTO_DE_VENTA_INVALIDO");
  if (!esNumeroDeComprobanteValido(f["numero"] as number)) {
    return err("NUMERO_DE_COMPROBANTE_INVALIDO");
  }
  if (!esFechaCivil(f["fecha"])) return err("FECHA_INVALIDA");
  const vencimiento = f["vencimientoDePago"] ?? null;
  if (vencimiento !== null && !esFechaCivil(vencimiento)) return err("FECHA_INVALIDA");
  const moneda = f["moneda"];
  if (moneda !== undefined && moneda !== "ARS") return err("MONEDA_NO_SOPORTADA");
  const lineas = f["lineas"];
  if (!Array.isArray(lineas) || lineas.length === 0) return err("LINEAS_REQUERIDAS");
  if (lineas.length > MAXIMO_DE_LINEAS_DE_UNA_FACTURA) return err("RENGLONES_INVALIDOS");
  const leidas: LineaDeFacturaPedida[] = [];
  for (const crudo of lineas as unknown[]) {
    const l = comoRegistro(crudo);
    const alicuota = textoOpcional(l["alicuota"]);
    const renglon = l["renglon"];
    if (
      !Number.isInteger(renglon) ||
      (renglon as number) < 1 ||
      typeof l["cantidadFacturada"] !== "string" ||
      typeof l["precioNeto"] !== "string" ||
      alicuota === undefined
    ) {
      return err("RENGLONES_INVALIDOS");
    }
    leidas.push({
      renglon: renglon as number,
      cantidadFacturada: l["cantidadFacturada"],
      precioNeto: l["precioNeto"],
      alicuota,
    });
  }
  const percepciones = textoOpcional(f["percepciones"]);
  const cuit = textoOpcional(f["cuitDelProveedor"]);
  const condicion = textoOpcional(f["condicionIva"]);
  if (typeof f["totalSegunFactura"] !== "string" || percepciones === undefined) {
    return err("TOTAL_INVALIDO");
  }
  if (cuit === undefined || condicion === undefined) return err("CUIT_INVALIDO");
  return ok({
    tipo: tipo as TipoDeComprobanteDeProveedor,
    puntoDeVenta: f["puntoDeVenta"] as number,
    numero: f["numero"] as number,
    fecha: f["fecha"],
    vencimientoDePago: vencimiento,
    lineas: leidas,
    percepciones,
    totalSegunFactura: f["totalSegunFactura"],
    cuitDelProveedor: cuit,
    condicionIva: condicion,
  });
}

/** La factura aplanada en campos para la huella del pedido (el orden de los campos es parte de la huella). */
export function camposDeHuellaDeFactura(f: FacturaPedida): readonly CampoDeHuella[] {
  return [
    f.tipo,
    f.puntoDeVenta,
    f.numero,
    f.fecha,
    f.vencimientoDePago,
    f.percepciones,
    f.totalSegunFactura,
    f.cuitDelProveedor,
    f.condicionIva,
    JSON.stringify(f.lineas.map((l) => [l.renglon, l.cantidadFacturada, l.precioNeto, l.alicuota])),
  ];
}

/**
 * La pantalla aprobada (`compra.html`) tiene UN campo «Percepciones»: se guarda como un solo tributo `PERCEPCION_SIN_CLASIFICAR` (D175: sin texto nuevo).
 * Vacío o cero no es un tributo.
 */
export function tributosDeLaPantalla(percepciones: string | null): readonly EntradaDeTributo[] {
  if (percepciones === null) return [];
  const importe = leerCantidad(percepciones);
  // un texto que no es decimal lo rechaza `calcularComprobante` (`TRIBUTO_INVALIDO`): acá solo se descarta el cero
  return importe === 0n ? [] : [{ tipo: "PERCEPCION_SIN_CLASIFICAR", importe: percepciones }];
}

export type AsignacionDeAtajo = Readonly<{
  /** La línea de la factura (desde 1, en el orden en que vinieron). */
  lineaDeFactura: number;
  renglon: number;
  cantidad: string;
}>;

/**
 * La conciliación ATAJO de una compra con factura (E9 §3.3: los atajos colapsan, no omiten): cada línea de la factura se asigna al renglón que dice, por lo que
 * ENTRÓ (lo asignado nunca supera lo recibido ni lo facturado, `compras.md D-43`). Si la factura dice más de lo recibido se asigna lo recibido; varias líneas del
 * mismo renglón comparten su saldo en orden. Lo que no se puede asignar (saldo cero) no genera asignación. Un renglón que no existe es `RENGLONES_INVALIDOS`.
 */
export function repartirConciliacionDeAtajo(
  lineas: readonly Pick<LineaDeFacturaPedida, "renglon" | "cantidadFacturada">[],
  recibidasPorRenglon: ReadonlyMap<number, string>,
): Resultado<readonly AsignacionDeAtajo[], "RENGLONES_INVALIDOS" | "CANTIDAD_INVALIDA"> {
  const restante = new Map<number, bigint>();
  for (const [renglon, recibida] of recibidasPorRenglon) {
    const unidades = leerCantidadPositiva(recibida);
    if (unidades === null) return err("CANTIDAD_INVALIDA");
    restante.set(renglon, unidades);
  }
  const asignaciones: AsignacionDeAtajo[] = [];
  for (const [i, linea] of lineas.entries()) {
    const saldo = restante.get(linea.renglon);
    if (saldo === undefined) return err("RENGLONES_INVALIDOS");
    const facturada = leerCantidadPositiva(linea.cantidadFacturada);
    if (facturada === null) return err("CANTIDAD_INVALIDA");
    // Stryker disable next-line EqualityOperator: con la factura igual al saldo da lo mismo
    const cantidad = facturada < saldo ? facturada : saldo;
    if (cantidad === 0n) continue;
    restante.set(linea.renglon, saldo - cantidad);
    asignaciones.push({
      lineaDeFactura: i + 1,
      renglon: linea.renglon,
      cantidad: textoDeCantidad(cantidad),
    });
  }
  return ok(asignaciones);
}

/** Lo máximo de la razón social (la copia que queda en la factura): el de la columna. */
const MAXIMO_DE_LA_RAZON_SOCIAL = 200;

/** La razón social que se copia a la factura: nombre y apellido de la parte, cortada al largo de la columna (por caracteres, sin partir uno). */
export function razonSocialDeLaParte(nombre: string | null, apellido: string | null): string {
  const texto = [nombre, apellido].filter((p): p is string => p !== null && p !== "").join(" ");
  return texto === ""
    ? "Sin nombre"
    : Array.from(texto).slice(0, MAXIMO_DE_LA_RAZON_SOCIAL).join("");
}
