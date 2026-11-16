import { uuidV5DeLista } from "../../../primitivas/identificadores/uuid-determinista";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { textoDeUnaLineaDesdeTexto } from "../../../primitivas/texto/texto-de-una-linea";
import { leerCantidadPositiva, textoDeCantidad } from "./decimal";
import { esFechaCivil } from "./factura";
import { huellaDeComando } from "./huella";
import { esUuid } from "./identificadores";
import { MAXIMO_DE_RENGLONES_DE_UNA_COMPRA } from "./registrar-compra";

/**
 * La devolución de mercadería al proveedor (N4, E9 §3.8; decisión del dueño 14 y 15/11/2026): una salida de stock con su motivo (de la lista del sistema de motivos de rechazo,
 * obligatorio y cerrado: sin texto libre), de UN depósito, con el número y la fecha del remito de devolución como dato opcional. Devolver mercadería NO devuelve dinero ni crea una
 * nota de crédito: son otros hechos. Las cantidades van en la unidad base del producto. Pura: sin reloj ni azar.
 */
export const LARGO_MAXIMO_DEL_REMITO_DE_DEVOLUCION = 40;

export type RemitoDeDevolucion = Readonly<{ numero: string; fecha: string }>;

/** La línea devuelta: el producto, la cantidad y, si se sabe de qué recepción vino, esa línea recibida (las dos juntas o ninguna). */
export type LineaDeDevolucion = Readonly<{
  productoId: string;
  /** Texto decimal de hasta 4 decimales, mayor que cero, en la unidad base del producto. */
  cantidad: string;
  origen: Readonly<{ recepcionId: string; lineaDeRecepcion: number }> | null;
}>;

export type DevolucionPedida = Readonly<{
  sucursalId: string;
  proveedorId: string;
  depositoId: string;
  motivoId: string;
  remito: RemitoDeDevolucion | null;
  lineas: readonly LineaDeDevolucion[];
}>;

export type ErrorDeDevolucion =
  | "IDENTIFICADOR_INVALIDO"
  | "RENGLONES_INVALIDOS"
  | "FECHA_INVALIDA"
  | "NUMERO_DE_COMPROBANTE_INVALIDO";

const comoRegistro = (valor: unknown): Record<string, unknown> =>
  // Stryker disable next-line ConditionalExpression: un texto o un número como «registro» no tiene ninguno de los campos y cae en la misma validación de abajo
  typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};

/** Lo que no es un texto no pasa por `esUuid` (su expresión regular lo rechaza sin mirar el tipo antes). */
const idValido = (valor: unknown): valor is string => esUuid(valor as string);

function leerLinea(valor: unknown): LineaDeDevolucion | null {
  const l = comoRegistro(valor);
  const cantidad = typeof l["cantidad"] === "string" ? leerCantidadPositiva(l["cantidad"]) : null;
  if (!idValido(l["productoId"]) || cantidad === null) return null;
  const recepcionId = l["recepcionId"] ?? null;
  const lineaDeRecepcion = l["lineaDeRecepcion"] ?? null;
  // La línea recibida de origen se dice completa (recepción y número) o no se dice.
  if ((recepcionId === null) !== (lineaDeRecepcion === null)) return null;
  if (recepcionId === null) {
    return { productoId: l["productoId"], cantidad: textoDeCantidad(cantidad), origen: null };
  }
  if (
    !idValido(recepcionId) ||
    !Number.isInteger(lineaDeRecepcion) ||
    (lineaDeRecepcion as number) < 1
  ) {
    return null;
  }
  return {
    productoId: l["productoId"],
    cantidad: textoDeCantidad(cantidad),
    origen: { recepcionId, lineaDeRecepcion: lineaDeRecepcion as number },
  };
}

function leerRemitoDeDevolucion(
  valor: unknown,
): Resultado<RemitoDeDevolucion | null, "NUMERO_DE_COMPROBANTE_INVALIDO" | "FECHA_INVALIDA"> {
  if (valor === undefined || valor === null) return ok(null);
  const r = comoRegistro(valor);
  if (typeof r["numero"] !== "string") return err("NUMERO_DE_COMPROBANTE_INVALIDO");
  const numero = textoDeUnaLineaDesdeTexto(r["numero"], {
    maximo: LARGO_MAXIMO_DEL_REMITO_DE_DEVOLUCION,
    exigirUnaLetra: false,
  });
  if (!numero.ok) return err("NUMERO_DE_COMPROBANTE_INVALIDO");
  if (typeof r["fecha"] !== "string" || !esFechaCivil(r["fecha"])) return err("FECHA_INVALIDA");
  return ok({ numero: numero.valor, fecha: r["fecha"] });
}

/**
 * Lee lo que la persona pide: sucursal, proveedor, depósito y motivo (ids), el remito de devolución opcional y una lista de líneas (no vacía, con tope, sin repetir producto: stock
 * descuenta un renglón por artículo en cada salida). Que todo exista y sea de la empresa lo comprueban el caso de uso y la base con lo guardado.
 */
export function leerDevolucion(valor: unknown): Resultado<DevolucionPedida, ErrorDeDevolucion> {
  const d = comoRegistro(valor);
  if (
    !idValido(d["sucursalId"]) ||
    !idValido(d["proveedorId"]) ||
    !idValido(d["depositoId"]) ||
    !idValido(d["motivoId"])
  ) {
    return err("IDENTIFICADOR_INVALIDO");
  }
  const remito = leerRemitoDeDevolucion(d["remito"]);
  if (!remito.ok) return remito;
  const crudas = d["lineas"];
  if (
    !Array.isArray(crudas) ||
    crudas.length === 0 ||
    crudas.length > MAXIMO_DE_RENGLONES_DE_UNA_COMPRA
  ) {
    return err("RENGLONES_INVALIDOS");
  }
  const lineas: LineaDeDevolucion[] = [];
  const vistos = new Set<string>();
  for (const cruda of crudas as readonly unknown[]) {
    const linea = leerLinea(cruda);
    if (linea === null || vistos.has(linea.productoId)) return err("RENGLONES_INVALIDOS");
    vistos.add(linea.productoId);
    lineas.push(linea);
  }
  return ok({
    sucursalId: d["sucursalId"],
    proveedorId: d["proveedorId"],
    depositoId: d["depositoId"],
    motivoId: d["motivoId"],
    remito: remito.valor,
    lineas,
  });
}

/**
 * La huella del pedido de devolver: todo el contenido. `hechoEn` entra solo si la persona lo mandó (el `ahora` del contexto no: un reintento daría otra huella y una falsa
 * `CLAVE_REUTILIZADA`); las líneas se ordenan antes de hashear.
 */
export function huellaDeLaDevolucion(devolucion: DevolucionPedida, hechoEn: string | null): string {
  return huellaDeComando(
    "devolver_al_proveedor",
    [
      devolucion.sucursalId,
      devolucion.proveedorId,
      devolucion.depositoId,
      devolucion.motivoId,
      devolucion.remito === null ? null : devolucion.remito.numero,
      devolucion.remito === null ? null : devolucion.remito.fecha,
      hechoEn,
    ],
    devolucion.lineas.map((l) => [
      l.productoId,
      l.cantidad,
      l.origen === null ? null : l.origen.recepcionId,
      l.origen === null ? null : l.origen.lineaDeRecepcion,
    ]),
  );
}

const ESPACIO_DE_LA_CLAVE_DE_SALIDA_DE_DEVOLUCION = "6c0e8b4a-2f71-4d5c-9a3e-1b7d4f8a2c96";

/** La clave de idempotencia de la salida de stock de una devolución (stock la pide como uuid): determinista de la devolución, para que un reintento repita el mismo pedido. */
export const claveDeLaSalidaDeDevolucion = (devolucionId: string): string =>
  uuidV5DeLista(ESPACIO_DE_LA_CLAVE_DE_SALIDA_DE_DEVOLUCION, [devolucionId]);
