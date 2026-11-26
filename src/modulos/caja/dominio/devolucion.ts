import { createHash } from "node:crypto";
import { importeATexto, type Importe, type ImporteJson } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { huellaDeCampos } from "./huella";
import { importeDeEntrada, sumarImportes, type ErrorDeImporte } from "./importes";

/**
 * La devolución de un cobro de ticket (DM-1; decisiones del dueño del 26/11/2026 sobre la devolución con medio): una salida de dinero por UNO o varios medios (una línea por par medio y cuenta)
 * que cita la COBRANZA del ticket. Acá solo lo puro: el tope de la base es la cerradura (`movimiento_de_dinero_devolvible_de_origen`); `decidirDevolucion` es la ayuda
 * temprana para devolver un error claro antes de escribir. Sin reloj ni azar: lo derivado sale de la clave del pedido.
 */

/** Los orígenes que se pueden devolver. Lista cerrada, igual que `movimiento_de_dinero_origen_tipo_ck`: otro origen se agrega con otra migración chica. */
export const ORIGENES_DEVOLUBLES = ["ventas.cobranza_de_ticket"] as const;
export type OrigenDevoluble = (typeof ORIGENES_DEVOLUBLES)[number];

/** Cuántas líneas (medios) admite una devolución. */
export const MAXIMO_DE_LINEAS_DE_UNA_DEVOLUCION = 10;

export type LineaDeDevolucionEntrada = Readonly<{
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  importe: ImporteJson;
}>;

export type LineaDeDevolucion = Readonly<{
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  /** Positivo y en ARS. */
  importe: Importe;
}>;

export type ErrorDeDevolucion =
  ErrorDeImporte | "LINEAS_INVALIDAS" | "LINEA_REPETIDA" | "DEVOLUCION_SUPERA_LO_COBRADO";

/**
 * Valida la FORMA de las líneas de una devolución: de 1 a 10 líneas, cada importe positivo y en ARS, ningún par (medio, cuenta) repetido. Devuelve las líneas validadas y su total.
 * No mira lo devolvible: el caso de uso la corre ANTES de la idempotencia (repetir un pedido ya hecho no puede fallar porque el tope se consumió con él mismo).
 */
export function validarLineasDeDevolucion(
  lineas: readonly LineaDeDevolucionEntrada[],
): Resultado<
  Readonly<{ lineas: readonly LineaDeDevolucion[]; total: Importe }>,
  ErrorDeDevolucion
> {
  if (lineas.length < 1 || lineas.length > MAXIMO_DE_LINEAS_DE_UNA_DEVOLUCION) {
    return err("LINEAS_INVALIDAS");
  }
  const armadas: LineaDeDevolucion[] = [];
  const vistos = new Set<string>();
  for (const l of lineas) {
    const importe = importeDeEntrada(l.importe, "POSITIVO");
    if (!importe.ok) return importe;
    const par = JSON.stringify([l.medioDePagoId, l.cuentaDeCobroId]);
    if (vistos.has(par)) return err("LINEA_REPETIDA");
    vistos.add(par);
    armadas.push({
      medioDePagoId: l.medioDePagoId,
      cuentaDeCobroId: l.cuentaDeCobroId,
      importe: importe.valor,
    });
  }
  return ok({ lineas: armadas, total: sumarImportes(armadas.map((l) => l.importe)) });
}

/**
 * Valida las líneas de una devolución contra lo devolvible de la cobranza (la forma, con `validarLineasDeDevolucion`, y que la suma no supere lo devolvible). El tope
 * definitivo lo impone la base con bloqueo.
 */
export function decidirDevolucion(
  entrada: Readonly<{ devolvible: Importe; lineas: readonly LineaDeDevolucionEntrada[] }>,
): Resultado<
  Readonly<{ lineas: readonly LineaDeDevolucion[]; total: Importe }>,
  ErrorDeDevolucion
> {
  const forma = validarLineasDeDevolucion(entrada.lineas);
  if (!forma.ok) return forma;
  if (forma.valor.total.unidades > entrada.devolvible.unidades) {
    return err("DEVOLUCION_SUPERA_LO_COBRADO");
  }
  return forma;
}

/**
 * La huella del PEDIDO de devolución: la cobranza, la caja (la sesión todavía no se conoce al buscar por clave), las líneas ORDENADAS por (medio, cuenta) —el orden en que
 * la pantalla las mande no cambia la huella— y el motivo. Importes como texto decimal (ADR-006).
 */
export function huellaDeLaDevolucion(
  d: Readonly<{
    cobranzaId: string;
    sesionId: string;
    lineas: readonly LineaDeDevolucion[];
    motivo: string;
  }>,
): string {
  const ordenadas = d.lineas
    .map((l) => [l.medioDePagoId, l.cuentaDeCobroId ?? "", importeATexto(l.importe)] as const)
    .sort((a, b) => (a[0] + "|" + a[1]).localeCompare(b[0] + "|" + b[1]));
  return huellaDeCampos([
    "caja.devolucion_de_un_cobro",
    d.cobranzaId,
    d.sesionId,
    JSON.stringify(ordenadas),
    d.motivo,
  ]);
}

/** La clave de la línea `orden` (desde 1) de un pedido: derivada de la clave del pedido, con la forma que piden las claves de la base (`^[A-Za-z0-9_-]{16,128}$`). Determinística. */
export function claveDeLinea(claveDelPedido: string, orden: number): string {
  const h = createHash("sha256")
    .update(JSON.stringify(["caja.devolucion.linea", claveDelPedido, orden]))
    .digest("hex");
  return `dev_${h}`;
}

/** La clave de la anulación de la línea `orden` (desde 1) de un pedido de anulación: derivada de la clave de ESE pedido (la de anular, no la de devolver), una por línea. Determinística. */
export function claveDeAnulacionDeLinea(claveDelPedido: string, orden: number): string {
  const h = createHash("sha256")
    .update(JSON.stringify(["caja.devolucion.anulacion.linea", claveDelPedido, orden]))
    .digest("hex");
  return `deva_${h}`;
}

/** El identificador del pedido de devolución (el `devolucion_id` que comparten sus líneas): un uuid determinístico derivado de la clave del pedido. */
export function devolucionIdDe(claveDelPedido: string): string {
  const b = Buffer.from(
    createHash("sha256")
      .update(JSON.stringify(["caja.devolucion.id", claveDelPedido]))
      .digest()
      .subarray(0, 16),
  );
  b.writeUInt8((b.readUInt8(6) & 0x0f) | 0x50, 6);
  b.writeUInt8((b.readUInt8(8) & 0x3f) | 0x80, 8);
  const x = b.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
