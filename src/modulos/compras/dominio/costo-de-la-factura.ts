import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { leerCantidad, leerCantidadPositiva } from "./decimal";
import type { CampoDeHuella } from "./huella";
import { esUuid } from "./identificadores";
import { MAXIMO_DE_RENGLONES_DE_UNA_COMPRA } from "./registrar-compra";

/**
 * Tomar el costo de la factura (E9 N3, decisión del dueño del 25/11/2026, «b chica»): después de conciliar, la línea recibida (sin precio, porque «Recibir» no lo pide) toma su costo del
 * precio neto de la línea de la factura que la cubre. Pura: sin reloj ni azar. El precio NO viaja en el pedido: lo lee el servidor de la factura (quien pide solo dice qué línea recibida). Cuál
 * es la línea de la factura lo decide `facturaUnicaDeLaLinea` con lo conciliado vigente: una línea recibida entera, conciliada con UNA sola línea de UNA sola factura (con dos precios posibles no
 * hay un costo único y no se ofrece).
 */
export type TomarElCostoPedido = Readonly<{
  clave: string;
  recepcionId: string;
  linea: number;
}>;

export type ErrorAlLeerTomarElCosto = "IDENTIFICADOR_INVALIDO" | "LINEA_NO_ENCONTRADA";

/** Lee el pedido: lo que no es de la forma declarada no pasa (ids en forma de UUID, la línea un entero de 1 al máximo de renglones). Nada más viaja: ni precio ni motivo ni cantidad. */
export function leerTomarElCosto(
  valor: unknown,
): Resultado<TomarElCostoPedido, ErrorAlLeerTomarElCosto> {
  const v =
    typeof valor === "object" && valor !== null && !Array.isArray(valor)
      ? (valor as Record<string, unknown>)
      : {};
  const clave = v["clave"];
  const recepcionId = v["recepcionId"];
  if (typeof clave !== "string" || !esUuid(clave)) return err("IDENTIFICADOR_INVALIDO");
  if (typeof recepcionId !== "string" || !esUuid(recepcionId)) return err("IDENTIFICADOR_INVALIDO");
  const linea = v["linea"];
  if (
    typeof linea !== "number" ||
    !Number.isInteger(linea) ||
    linea < 1 ||
    linea > MAXIMO_DE_RENGLONES_DE_UNA_COMPRA
  ) {
    return err("LINEA_NO_ENCONTRADA");
  }
  return ok({ clave, recepcionId, linea });
}

/** Lo que entra a la huella: la misma clave con otra línea es `CLAVE_REUTILIZADA`. El precio no entra: sale de la factura, no del pedido. */
export const camposDeHuellaDeTomarElCosto = (p: TomarElCostoPedido): readonly CampoDeHuella[] => [
  p.recepcionId,
  p.linea,
];

const PREFIJO_DEL_MOTIVO = "COSTO-TOMADO-DE-LA-FACTURA";
const FORMA_DEL_MOTIVO = new RegExp(
  `^${PREFIJO_DEL_MOTIVO}:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([1-9][0-9]{0,5})$`,
);

export type FacturaDeLaLinea = Readonly<{ comprobanteId: string; lineaDeFactura: number }>;

/**
 * El motivo de la corrección que toma el costo: un CÓDIGO (no un texto escrito) con la línea de la factura de la que salió, para que el origen del costo quede en la propia corrección
 * (guion y dos puntos entran en `texto_de_catalogo_valido`; el guion bajo no). Con él se vuelve a calcular el mismo costo más tarde, aunque la conciliación se anule (corregir lo recibido).
 */
export const motivoDelCostoTomado = (f: FacturaDeLaLinea): string =>
  `${PREFIJO_DEL_MOTIVO}:${f.comprobanteId}:${f.lineaDeFactura}`;

/** La factura de la que salió el costo, o `null` si el motivo no es de la forma que escribe `motivoDelCostoTomado` (una corrección de otro tipo). */
export function leerMotivoDelCostoTomado(motivo: string): FacturaDeLaLinea | null {
  const m = FORMA_DEL_MOTIVO.exec(motivo);
  if (m === null) return null;
  return { comprobanteId: m[1] as string, lineaDeFactura: Number(m[2]) };
}

/** Lo conciliado todavía vigente de una línea recibida contra una línea de factura (la suma de sus asignaciones y espejos, ya neta). */
export type AsignacionVigente = Readonly<{
  comprobanteId: string;
  lineaDeFactura: number;
  cantidad: string;
}>;

export type ErrorDeFacturaUnica = "LINEA_NO_CONCILIADA_ENTERA" | "COSTO_SIN_FACTURA_UNICA";

/**
 * De qué línea de factura sale el costo de una línea recibida. La línea tiene que estar conciliada ENTERA (lo asignado es igual a lo recibido, y es más que cero) y toda con la misma línea de
 * la misma factura: con dos líneas o dos facturas no hay un único precio (`COSTO_SIN_FACTURA_UNICA`). Una cantidad ilegible se trata como no conciliada (cierra).
 */
export function facturaUnicaDeLaLinea(
  entrada: Readonly<{
    recibida: string;
    asignada: string;
    vigentes: readonly AsignacionVigente[];
  }>,
): Resultado<FacturaDeLaLinea, ErrorDeFacturaUnica> {
  const recibida = leerCantidadPositiva(entrada.recibida);
  const asignada = leerCantidad(entrada.asignada);
  if (recibida === null || asignada === null || asignada !== recibida) {
    return err("LINEA_NO_CONCILIADA_ENTERA");
  }
  const claves = new Set<string>();
  let suma = 0n;
  for (const a of entrada.vigentes) {
    const cantidad = leerCantidadPositiva(a.cantidad);
    if (cantidad === null) continue;
    claves.add(`${a.comprobanteId}:${a.lineaDeFactura}`);
    suma += cantidad;
  }
  // Lo asignado de la línea y lo que suman sus asignaciones vigentes son lo mismo (los dos los escribe la base): si no coinciden, no hay de dónde tomar nada.
  if (suma !== recibida) return err("LINEA_NO_CONCILIADA_ENTERA");
  const unica = entrada.vigentes[0];
  if (unica === undefined || claves.size !== 1) return err("COSTO_SIN_FACTURA_UNICA");
  return ok({ comprobanteId: unica.comprobanteId, lineaDeFactura: unica.lineaDeFactura });
}
