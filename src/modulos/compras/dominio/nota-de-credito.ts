import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  claseDeTipoDeComprobante,
  esNumeroDeComprobanteValido,
  esPuntoDeVentaValido,
  esTipoDeComprobanteDeProveedor,
  type TipoDeComprobanteDeProveedor,
} from "./comprobante";
import { esFechaCivil } from "./factura";
import { huellaDeComando } from "./huella";

/**
 * La nota de crédito del proveedor (N4, E9 §3.8; decisión del dueño 16/11/2026): un comprobante que corrige UNA factura, SIN saldo: no tiene líneas, no se concilia, no reduce lo que se paga y
 * no toca stock; el libro de saldos va aparte. Se carga por sus importes por alícuota (lo que dice el papel), positivos: la clase de la nota le da el sentido (ADR-006). Pura: sin reloj ni azar.
 */
export const MAXIMO_DE_IMPORTES_DE_UNA_NOTA = 99;

export type ImporteDeNota = Readonly<{
  /** Una de las ocho; `null` en una B o C (no discriminan IVA) y obligatoria en una A (lo comprueba `calcularComprobante`). */
  alicuota: string | null;
  /** Texto decimal, mayor que cero. */
  neto: string;
}>;

export type NotaPedida = Readonly<{
  tipo: TipoDeComprobanteDeProveedor;
  puntoDeVenta: number;
  numero: number;
  /** Fecha civil `YYYY-MM-DD` impresa en la nota. */
  fecha: string;
  importes: readonly ImporteDeNota[];
  totalSegunNota: string;
}>;

export type ErrorDeNota =
  | "TIPO_DE_COMPROBANTE_INVALIDO"
  | "PUNTO_DE_VENTA_INVALIDO"
  | "NUMERO_DE_COMPROBANTE_INVALIDO"
  | "FECHA_INVALIDA"
  | "MONEDA_NO_SOPORTADA"
  | "LINEAS_REQUERIDAS"
  | "RENGLONES_INVALIDOS"
  | "TOTAL_INVALIDO";

const comoRegistro = (valor: unknown): Record<string, unknown> =>
  // Stryker disable next-line ConditionalExpression: un texto o un número como «registro» no tiene ninguno de los campos y cae en la misma validación de abajo
  typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};

/**
 * Lee lo que la persona carga de la nota: tipo (solo una nota de crédito), punto de venta y número en los rangos de ARCA, fecha civil, moneda (solo pesos), los importes por alícuota
 * (no vacíos, con tope) y el total que dice el papel. Las cuentas y que la letra discrimine o no el IVA las hace `calcularComprobante`.
 */
export function leerNotaDeCredito(valor: unknown): Resultado<NotaPedida, ErrorDeNota> {
  const n = comoRegistro(valor);
  const tipo = n["tipo"];
  // `includes` compara con `===`: lo que no es un texto de la lista no pasa, sin mirar el tipo antes.
  if (
    !esTipoDeComprobanteDeProveedor(tipo as string) ||
    claseDeTipoDeComprobante(tipo as TipoDeComprobanteDeProveedor) !== "NOTA_DE_CREDITO"
  ) {
    return err("TIPO_DE_COMPROBANTE_INVALIDO");
  }
  // `Number.isInteger` ya rechaza todo lo que no es un número entero: no hace falta mirar el tipo antes.
  if (!esPuntoDeVentaValido(n["puntoDeVenta"] as number)) return err("PUNTO_DE_VENTA_INVALIDO");
  if (!esNumeroDeComprobanteValido(n["numero"] as number)) {
    return err("NUMERO_DE_COMPROBANTE_INVALIDO");
  }
  if (!esFechaCivil(n["fecha"])) return err("FECHA_INVALIDA");
  const moneda = n["moneda"];
  if (moneda !== undefined && moneda !== "ARS") return err("MONEDA_NO_SOPORTADA");
  const crudos = n["importes"];
  if (!Array.isArray(crudos) || crudos.length === 0) return err("LINEAS_REQUERIDAS");
  if (crudos.length > MAXIMO_DE_IMPORTES_DE_UNA_NOTA) return err("RENGLONES_INVALIDOS");
  const importes: ImporteDeNota[] = [];
  for (const crudo of crudos as unknown[]) {
    const i = comoRegistro(crudo);
    const alicuota = i["alicuota"] ?? null;
    if (typeof i["neto"] !== "string" || (alicuota !== null && typeof alicuota !== "string")) {
      return err("RENGLONES_INVALIDOS");
    }
    importes.push({ alicuota, neto: i["neto"] });
  }
  if (typeof n["totalSegunNota"] !== "string") return err("TOTAL_INVALIDO");
  return ok({
    tipo: tipo as TipoDeComprobanteDeProveedor,
    puntoDeVenta: n["puntoDeVenta"] as number,
    numero: n["numero"] as number,
    fecha: n["fecha"],
    importes,
    totalSegunNota: n["totalSegunNota"],
  });
}

/** La huella del pedido de cargar la nota: la factura que corrige y todo el contenido; los importes se ordenan antes de hashear (los mismos importes en otro orden son el mismo pedido). */
export function huellaDeLaNotaDeCredito(
  proveedorId: string,
  facturaId: string,
  nota: NotaPedida,
): string {
  return huellaDeComando(
    "cargar_nota_de_credito",
    [
      proveedorId,
      facturaId,
      nota.tipo,
      nota.puntoDeVenta,
      nota.numero,
      nota.fecha,
      nota.totalSegunNota,
    ],
    nota.importes.map((i) => [i.alicuota, i.neto]),
  );
}
