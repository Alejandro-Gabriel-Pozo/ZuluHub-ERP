import type { Cantidad } from "../../../primitivas/cantidad/cantidad";
import type { Porcentaje } from "../../../primitivas/cantidad/porcentaje";
import type { Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import type { PrecioUnitario } from "../../../primitivas/dinero/precio-unitario";
import { POLITICA_VIGENTE } from "../../../primitivas/dinero/redondeo";
import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { CodigoDeAlicuota } from "./alicuota";
import type { DesgloseDeAlicuota } from "./comprobante";
import {
  type ClaseDeComprobante,
  type InstantaneaDeEmisor,
  type LetraDeComprobante,
  type OrigenDeComprobante,
  type TipoDeComprobante,
} from "./comprobante-emitido";
import { calcularRenglones, type ModoDePrecio } from "./calculo-de-renglones";
import type { EmisorId, PuntoDeVentaId } from "./identificadores";
import { letraParaFactura, tipoDeComprobante } from "./letra-de-comprobante";
import { validarReceptor, type ErrorDeReceptor, type Receptor } from "./receptor";

/**
 * Comprobante nuevo (spec H7 facturación §B.3.4-§B.3.6): el contenido COMPLETO e inmutable de una
 * factura, nota de crédito o nota de débito, armado y calculado antes de pedirle nada a ARCA. Todo
 * lo que entra acá nace de datos (sin reloj, sin azar): quien emite pone el contexto, el receptor y
 * los renglones. La fecha del comprobante y el número NO son parte del contenido: se fijan al
 * reservar el número (§B.3.6).
 */

export const AMBIENTES = ["HOMOLOGACION", "PRODUCCION"] as const;

/** `HOMOLOGACION` son las pruebas de ARCA (sin valor fiscal); cada ambiente es otro ARCA. */
export type Ambiente = (typeof AMBIENTES)[number];

/** Concepto (WSFE v4.8, error 10030): 1 productos, 2 servicios, 3 productos y servicios. */
export const CONCEPTOS = ["PRODUCTOS", "SERVICIOS", "PRODUCTOS_Y_SERVICIOS"] as const;

export type Concepto = (typeof CONCEPTOS)[number];

/** Fechas del abono, obligatorias en los conceptos 2 y 3 (errores 10031 a 10035). */
export type PeriodoDeServicio = Readonly<{
  desde: FechaCivil;
  hasta: FechaCivil;
  vencimientoDePago: FechaCivil;
}>;

/**
 * Límites ASUMIDOS (no son requisitos de ARCA; previenen pedidos gigantes y fijan lo que la base
 * puede aceptar sin migración): renglones por comprobante y largo de los textos.
 */
export const LIMITES_DE_COMPROBANTE = { renglones: 200, descripcion: 200, motivo: 200 } as const;

export type RenglonAFacturar = Readonly<{
  descripcion: string;
  cantidad: Cantidad;
  precioUnitario: PrecioUnitario;
  descuento: Porcentaje | null;
  /** `null` solo en la letra C. */
  alicuota: CodigoDeAlicuota | null;
}>;

/** Un renglón con su importe final (con IVA), ya prorrateado: los renglones suman el total. */
export type RenglonCalculado = RenglonAFacturar & Readonly<{ importe: Importe }>;

/** El comprobante que una nota corrige o aumenta: lo que viaja en `CbtesAsoc`. */
export type ComprobanteAsociado = Readonly<{
  tipo: TipoDeComprobante;
  puntoDeVenta: number;
  numero: bigint;
  cuit: Cuit;
  fecha: FechaCivil;
}>;

export type ComprobanteNuevo = Readonly<{
  empresaId: EmpresaId;
  emisorId: EmisorId;
  puntoDeVentaId: PuntoDeVentaId;
  ambiente: Ambiente;
  origen: OrigenDeComprobante;
  tipo: TipoDeComprobante;
  emisor: InstantaneaDeEmisor;
  receptor: Receptor;
  modoDePrecio: ModoDePrecio;
  concepto: Concepto;
  servicio: PeriodoDeServicio | null;
  renglones: readonly RenglonCalculado[];
  /** Los tres, en positivo (también en una nota de crédito). Con letra C: neto = total e IVA = 0. */
  total: Importe;
  neto: Importe;
  iva: Importe;
  /** Por alícuota; vacío en la letra C. */
  desglose: readonly DesgloseDeAlicuota[];
  /** Solo las notas de crédito y de débito. */
  asociado: ComprobanteAsociado | null;
  motivo: string | null;
}>;

/** Quién emite y desde dónde: lo fijan la sesión y la configuración, no el formulario. */
export type ContextoDeEmision = Readonly<{
  empresaId: EmpresaId;
  emisorId: EmisorId;
  puntoDeVentaId: PuntoDeVentaId;
  /** Se copia del punto de venta al nacer el comprobante. */
  ambiente: Ambiente;
  origen: OrigenDeComprobante;
  emisor: InstantaneaDeEmisor;
}>;

export type EntradaDeComprobante = Readonly<{
  receptor: Receptor;
  modoDePrecio: ModoDePrecio;
  concepto: Concepto;
  servicio: PeriodoDeServicio | null;
  renglones: readonly RenglonAFacturar[];
}>;

export type CampoDeRenglon = "descripcion" | "cantidad";

export type ErrorDeComprobanteNuevo =
  | ErrorDeReceptor
  | Readonly<{ codigo: "SIN_RENGLONES" }>
  | Readonly<{ codigo: "DEMASIADOS_RENGLONES" }>
  | Readonly<{ codigo: "RENGLON_INVALIDO"; posicion: number; campo: CampoDeRenglon }>
  /** La letra C no discrimina IVA: ningún renglón lleva alícuota. */
  | Readonly<{ codigo: "ALICUOTA_EN_LETRA_C"; posicion: number }>
  | Readonly<{ codigo: "FALTA_ALICUOTA"; posicion: number }>
  | Readonly<{ codigo: "MODO_DE_PRECIO_INVALIDO_PARA_C" }>
  | Readonly<{ codigo: "FECHAS_DE_SERVICIO_INVALIDAS" }>
  | Readonly<{ codigo: "TOTAL_FUERA_DE_RANGO" }>;

/** Lo que cambia entre armar una factura y armar una nota: la clase, la letra, el receptor y el asociado. */
export type PedidoDeArmado = Readonly<{
  contexto: ContextoDeEmision;
  clase: ClaseDeComprobante;
  letra: LetraDeComprobante;
  receptor: Receptor;
  asociado: ComprobanteAsociado | null;
  motivo: string | null;
  entrada: Omit<EntradaDeComprobante, "receptor">;
}>;

function validarRenglones(
  renglones: readonly RenglonAFacturar[],
  letra: LetraDeComprobante,
): Resultado<readonly RenglonAFacturar[], ErrorDeComprobanteNuevo> {
  if (renglones.length === 0) return err({ codigo: "SIN_RENGLONES" });
  if (renglones.length > LIMITES_DE_COMPROBANTE.renglones) {
    return err({ codigo: "DEMASIADOS_RENGLONES" });
  }
  const normalizados: RenglonAFacturar[] = [];
  for (const [posicion, renglon] of renglones.entries()) {
    const descripcion = renglon.descripcion.trim();
    if (descripcion === "" || descripcion.length > LIMITES_DE_COMPROBANTE.descripcion) {
      return err({ codigo: "RENGLON_INVALIDO", posicion, campo: "descripcion" });
    }
    if (renglon.cantidad.unidades === 0n) {
      return err({ codigo: "RENGLON_INVALIDO", posicion, campo: "cantidad" });
    }
    if (letra === "C" && renglon.alicuota !== null) {
      return err({ codigo: "ALICUOTA_EN_LETRA_C", posicion });
    }
    if (letra !== "C" && renglon.alicuota === null)
      return err({ codigo: "FALTA_ALICUOTA", posicion });
    normalizados.push({ ...renglon, descripcion });
  }
  return ok(normalizados);
}

function servicioValido(concepto: Concepto, servicio: PeriodoDeServicio | null): boolean {
  if (concepto === "PRODUCTOS") return servicio === null;
  // Las fechas son `YYYY-MM-DD`: el orden del texto es el orden del calendario.
  return servicio !== null && servicio.desde <= servicio.hasta;
}

/**
 * El armado común de facturas y notas: valida renglones, modo de precio y fechas del servicio,
 * calcula con el redondeo vigente (una sola vez por comprobante) y devuelve el contenido completo.
 * Devuelve el PRIMER error: renglones (en orden), modo de precio, fechas del servicio, total.
 */
export function armarContenido(
  para: PedidoDeArmado,
): Resultado<ComprobanteNuevo, ErrorDeComprobanteNuevo> {
  const { contexto, clase, letra, entrada } = para;
  const renglones = validarRenglones(entrada.renglones, letra);
  if (!renglones.ok) return renglones;
  if (letra === "C" && entrada.modoDePrecio !== "IVA_INCLUIDO") {
    return err({ codigo: "MODO_DE_PRECIO_INVALIDO_PARA_C" });
  }
  if (!servicioValido(entrada.concepto, entrada.servicio)) {
    return err({ codigo: "FECHAS_DE_SERVICIO_INVALIDAS" });
  }
  const calculo = calcularRenglones(ARS, renglones.valor, entrada.modoDePrecio, POLITICA_VIGENTE);
  if (!calculo.ok) return err({ codigo: "TOTAL_FUERA_DE_RANGO" });
  const { total, neto, iva, desglose } = calculo.valor;
  return ok({
    empresaId: contexto.empresaId,
    emisorId: contexto.emisorId,
    puntoDeVentaId: contexto.puntoDeVentaId,
    ambiente: contexto.ambiente,
    origen: contexto.origen,
    tipo: tipoDeComprobante(clase, letra),
    emisor: contexto.emisor,
    receptor: para.receptor,
    modoDePrecio: entrada.modoDePrecio,
    concepto: entrada.concepto,
    servicio: entrada.servicio,
    renglones: renglones.valor.flatMap((renglon, posicion) => {
      const importe = calculo.valor.renglones[posicion];
      // Stryker disable next-line all: `calcularRenglones` devuelve un importe por renglón; la guarda solo satisface noUncheckedIndexedAccess
      return importe === undefined ? [] : [{ ...renglon, importe }];
    }),
    total,
    neto,
    iva,
    desglose,
    asociado: para.asociado,
    motivo: para.motivo,
  });
}

/**
 * Arma una FACTURA nueva. La letra sale del emisor y de la condición del receptor
 * (`letraParaFactura`); el receptor se valida para esa letra. La nota de crédito y la de débito se
 * arman con `armarNotaAsociada`.
 */
export function armarComprobanteNuevo(
  entrada: EntradaDeComprobante,
  contexto: ContextoDeEmision,
): Resultado<ComprobanteNuevo, ErrorDeComprobanteNuevo> {
  const letra = letraParaFactura(contexto.emisor.condicionIva, entrada.receptor.condicionIva);
  const receptor = validarReceptor(entrada.receptor, {
    letra,
    cuitDelEmisor: contexto.emisor.cuit,
  });
  if (!receptor.ok) return receptor;
  return armarContenido({
    contexto,
    clase: "FACTURA",
    letra,
    receptor: receptor.valor,
    asociado: null,
    motivo: null,
    entrada,
  });
}
