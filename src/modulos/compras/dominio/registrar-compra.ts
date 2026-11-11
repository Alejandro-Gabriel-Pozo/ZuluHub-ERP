import { fechaCivilDesdeTexto } from "../../../primitivas/tiempo/fecha-civil";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { UNIDADES, type CodigoDeUnidad } from "../../../primitivas/unidades/unidades";
import { esNumeroDeComprobanteValido, esPuntoDeVentaValido } from "./comprobante";
import { huellaDeComando, type CampoDeHuella } from "./huella";
import { textoDeUnaLineaDesdeTexto } from "../../../primitivas/texto/texto-de-una-linea";
import { uuidV5DeLista } from "../../../primitivas/identificadores/uuid-determinista";
import { esUuid } from "./identificadores";

/**
 * Lo puro de «Comprar y recibir» (`registrarCompra`, E9 §3.5): leer lo que manda la pantalla como lista de PERMITIDOS (cada campo, su forma y su largo: lo que no
 * está declarado no pasa), el remito, el depósito de la compra y la huella del pedido. Sin reloj ni azar: el mismo pedido da siempre la misma huella. Las
 * cuentas de cada línea son de `calcularLinea`; acá solo la forma.
 */

/**
 * Cuántos renglones admite una compra como máximo: el mismo tope que stock para un movimiento (`MAXIMO_DE_RENGLONES`), porque cada renglón de la
 * compra es un renglón de su entrada de stock. SUPUESTO (E9-T8): sin fuente propia; costo de revertir bajo (un número).
 */
export const MAXIMO_DE_RENGLONES_DE_UNA_COMPRA = 9_999;

export type RenglonDeCompra = Readonly<{
  productoId: string;
  presentacionId: string | null;
  unidadDeCompraId: CodigoDeUnidad;
  /** Texto decimal: cajas o packs con presentación; si no, la cantidad en la unidad de compra. */
  cantidad: string;
  /** Texto decimal en la unidad de compra; obligatorio con peso variable (lo exige `calcularLinea`). */
  pesoReal: string | null;
  precioPor: "PRESENTACION" | "UNIDAD";
  unidadDePrecioId: CodigoDeUnidad | null;
  /** Texto decimal o `null`: «sin precio» (nunca cero). */
  precio: string | null;
}>;

const esUnidad = (valor: unknown): valor is CodigoDeUnidad =>
  typeof valor === "string" && Object.hasOwn(UNIDADES, valor);

const comoRegistro = (valor: unknown): Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};

/** Un texto opcional: ausente o `null` es `null`; un texto es el texto; cualquier otra cosa es inválida (`undefined` en el resultado). */
function textoOpcional(valor: unknown): string | null | undefined {
  if (valor === undefined || valor === null) return null;
  return typeof valor === "string" ? valor : undefined;
}

/** Un uuid opcional: ausente o `null` es `null`; un uuid es el uuid; cualquier otra cosa es inválida (`undefined` en el resultado). */
function uuidOpcional(valor: unknown): string | null | undefined {
  if (valor === undefined || valor === null) return null;
  return typeof valor === "string" && esUuid(valor) ? valor : undefined;
}

export function leerRenglonesDeCompra(
  valor: unknown,
): Resultado<readonly RenglonDeCompra[], "RENGLONES_INVALIDOS"> {
  if (
    !Array.isArray(valor) ||
    valor.length === 0 ||
    valor.length > MAXIMO_DE_RENGLONES_DE_UNA_COMPRA
  ) {
    return err("RENGLONES_INVALIDOS");
  }
  const leidos: RenglonDeCompra[] = [];
  for (const crudo of valor as unknown[]) {
    const r = comoRegistro(crudo);
    const productoId = r["productoId"];
    const presentacionId = uuidOpcional(r["presentacionId"]);
    const cantidad = r["cantidad"];
    const pesoReal = textoOpcional(r["pesoReal"]);
    const precio = textoOpcional(r["precio"]);
    const precioPor = r["precioPor"];
    const unidadDePrecioId = r["unidadDePrecioId"] ?? null;
    if (
      typeof productoId !== "string" ||
      !esUuid(productoId) ||
      presentacionId === undefined ||
      !esUnidad(r["unidadDeCompraId"]) ||
      typeof cantidad !== "string" ||
      pesoReal === undefined ||
      precio === undefined ||
      (precioPor !== "PRESENTACION" && precioPor !== "UNIDAD") ||
      (unidadDePrecioId !== null && !esUnidad(unidadDePrecioId))
    ) {
      return err("RENGLONES_INVALIDOS");
    }
    leidos.push({
      productoId,
      presentacionId,
      unidadDeCompraId: r["unidadDeCompraId"],
      cantidad,
      pesoReal,
      precioPor,
      unidadDePrecioId,
      precio,
    });
  }
  return ok(leidos);
}

export type Remito = Readonly<{ puntoDeVenta: number; numero: number; fecha: string }>;
export type ErrorDeRemito =
  "PUNTO_DE_VENTA_INVALIDO" | "NUMERO_DE_COMPROBANTE_INVALIDO" | "FECHA_INVALIDA";

/** El remito que trae la mercadería (el papel del proveedor): punto de venta y número en los rangos de ARCA y la fecha civil impresa. */
export function leerRemito(valor: unknown): Resultado<Remito, ErrorDeRemito> {
  const r = comoRegistro(valor);
  const puntoDeVenta = r["puntoDeVenta"];
  const numero = r["numero"];
  const fecha = r["fecha"];
  // `Number.isInteger` ya rechaza todo lo que no es un número entero: no hace falta mirar el tipo antes.
  if (!esPuntoDeVentaValido(puntoDeVenta as number)) return err("PUNTO_DE_VENTA_INVALIDO");
  if (!esNumeroDeComprobanteValido(numero as number)) return err("NUMERO_DE_COMPROBANTE_INVALIDO");
  if (typeof fecha !== "string" || !fechaCivilDesdeTexto(fecha).ok) return err("FECHA_INVALIDA");
  return ok({ puntoDeVenta: puntoDeVenta as number, numero: numero as number, fecha });
}

/**
 * El depósito de la compra (S-4): el que elige la persona, que tiene que ser uno de los depósitos de uso normal y activos de la sucursal; sin elegir, el
 * ÚNICO que hay (con más de uno hay que elegir: nunca se adivina). `candidatos` son los ids de los depósitos normales activos de la sucursal.
 */
export function elegirDepositoDeLaCompra(
  candidatos: readonly string[],
  elegido: string | null,
): Resultado<string, "DEPOSITO_NO_ENCONTRADO" | "DEPOSITO_A_ELEGIR"> {
  if (elegido !== null) {
    return candidatos.includes(elegido) ? ok(elegido) : err("DEPOSITO_NO_ENCONTRADO");
  }
  const [unico, ...resto] = candidatos;
  if (unico === undefined) return err("DEPOSITO_NO_ENCONTRADO");
  return resto.length === 0 ? ok(unico) : err("DEPOSITO_A_ELEGIR");
}

export type PedidoDeCompra = Readonly<{
  sucursalId: string;
  proveedorId: string;
  /** El que eligió la persona (no el que se resolvió por defecto): mismo pedido, misma huella. */
  depositoId: string | null;
  /** Solo si la persona lo mandó: el `ahora` del contexto no entra (un reintento daría otra huella y una falsa `CLAVE_REUTILIZADA`). */
  hechoEn: string | null;
  remito: Remito | null;
  renglones: readonly RenglonDeCompra[];
  /** Lo que aporta la factura y el pago, ya aplanado por su propia función pura (T9 y T10); `null` si no vienen. */
  factura: readonly CampoDeHuella[] | null;
  pago: readonly CampoDeHuella[] | null;
}>;

/** La huella del pedido: sha256 del contenido canónico. Los renglones se ordenan antes de hashear (la misma compra en otro orden es el mismo pedido). */
export function huellaDeLaCompra(pedido: PedidoDeCompra): string {
  const remito =
    pedido.remito === null
      ? [null, null, null]
      : [pedido.remito.puntoDeVenta, pedido.remito.numero, pedido.remito.fecha];
  return huellaDeComando(
    "registrar_compra",
    [
      pedido.sucursalId,
      pedido.proveedorId,
      pedido.depositoId,
      pedido.hechoEn,
      ...remito,
      pedido.factura === null ? null : JSON.stringify(pedido.factura),
      pedido.pago === null ? null : JSON.stringify(pedido.pago),
    ],
    pedido.renglones.map((r) => [
      r.productoId,
      r.presentacionId,
      r.unidadDeCompraId,
      r.cantidad,
      r.pesoReal,
      r.precioPor,
      r.unidadDePrecioId,
      r.precio,
    ]),
  );
}

// ---- los identificadores de la entrada de stock de una recepción -------------------------------------------------------------------

/** Espacios de nombres (uuid v5) de lo que se deriva de una recepción: nunca se cambian (cambiarlos reescribiría el origen de lo ya guardado). */
const ESPACIO_DEL_ORIGEN_DE_ENTRADA = "87d185ca-c698-4554-80df-bda1043f757c";
const ESPACIO_DE_LA_CLAVE_DE_ENTRADA = "3f15b9d6-3d3b-4414-96ce-9204dd1352f2";
const ESPACIO_DE_LA_CLAVE_DE_ANULACION = "ce71df41-27be-494a-ba5a-9c8c1172aa29";
const ESPACIO_DE_LA_CLAVE_DE_CONCILIACION = "b2b4f0a6-6f0b-4f4e-9d52-7c3a1e8d5a10";
const ESPACIO_DE_LA_CLAVE_DE_ANULACION_DE_CONCILIACION = "0e9c7a31-5d8b-4c62-8a47-2b6f3d1c9e55";

/**
 * El origen de la entrada de stock de una recepción en un depósito: determinista de `(recepción, depósito)`. Un mismo gesto con depósitos distintos no choca
 * con el único de origen de stock (una entrada por origen) y cada reintento da el mismo id, así que una segunda llamada devuelve la entrada ya hecha (I4).
 */
export const origenDeLaEntradaDeStock = (recepcionId: string, depositoId: string): string =>
  uuidV5DeLista(ESPACIO_DEL_ORIGEN_DE_ENTRADA, [recepcionId, depositoId]);

/** La clave de idempotencia de esa entrada (stock la pide como uuid): también determinista, para que un reintento repita el mismo pedido. */
export const claveDeLaEntradaDeStock = (recepcionId: string, depositoId: string): string =>
  uuidV5DeLista(ESPACIO_DE_LA_CLAVE_DE_ENTRADA, [recepcionId, depositoId]);

/** La clave de la anulación espejo de esa entrada (una sola por entrada). */
export const claveDeLaAnulacionDeLaEntrada = (recepcionId: string, depositoId: string): string =>
  uuidV5DeLista(ESPACIO_DE_LA_CLAVE_DE_ANULACION, [recepcionId, depositoId]);

/**
 * El motivo de una anulación (obligatorio, queda en el registro): una línea de texto de hasta 500 caracteres, con la lista de permitidos de siempre. El
 * mismo límite lo repite la base (`recepcion_motivo_ck` y sus hermanas) y lo compara una prueba de integración.
 */
const MAXIMO_DEL_MOTIVO_DE_ANULACION = 500;
export function motivoDeAnulacionDesdeTexto(texto: unknown): Resultado<string, "MOTIVO_REQUERIDO"> {
  if (typeof texto !== "string") return err("MOTIVO_REQUERIDO");
  const motivo = textoDeUnaLineaDesdeTexto(texto, {
    maximo: MAXIMO_DEL_MOTIVO_DE_ANULACION,
    exigirUnaLetra: true,
  });
  return motivo.ok ? ok(motivo.valor) : err("MOTIVO_REQUERIDO");
}

/** La clave de la conciliación atajo de una recepción (una por compra): determinista, para que un reintento repita el mismo pedido. */
export const claveDeLaConciliacionDeAtajo = (recepcionId: string): string =>
  uuidV5DeLista(ESPACIO_DE_LA_CLAVE_DE_CONCILIACION, [recepcionId]);

/** La clave del espejo de una conciliación (una sola por conciliación: además la impone el único `(empresa, anula_a)`). */
export const claveDeLaAnulacionDeLaConciliacion = (conciliacionId: string): string =>
  uuidV5DeLista(ESPACIO_DE_LA_CLAVE_DE_ANULACION_DE_CONCILIACION, [conciliacionId]);
