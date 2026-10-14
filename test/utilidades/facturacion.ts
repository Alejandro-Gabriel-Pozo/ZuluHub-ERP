import fc from "fast-check";
import { cantidadDesdeTexto } from "../../src/primitivas/cantidad/cantidad";
import { formatearDecimalFijo } from "../../src/primitivas/cantidad/decimal-fijo";
import { porcentajeDesdeTexto } from "../../src/primitivas/cantidad/porcentaje";
import {
  domicilioDesdeDatos,
  formatearDomicilio,
  type Domicilio,
} from "../../src/primitivas/domicilio/domicilio";
import { precioUnitarioDesdeTexto } from "../../src/primitivas/dinero/precio-unitario";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../src/primitivas/tiempo/fecha-civil";
import {
  CODIGOS_DE_ALICUOTA,
  type CodigoDeAlicuota,
} from "../../src/modulos/fiscal/dominio/alicuota";
import type { InstantaneaDeEmisor } from "../../src/modulos/fiscal/dominio/comprobante-emitido";
import {
  armarComprobanteNuevo,
  type ComprobanteNuevo,
  type ContextoDeEmision,
  type EntradaDeComprobante,
  type RenglonAFacturar,
} from "../../src/modulos/fiscal/dominio/comprobante-nuevo";
import { origenId, puntoDeVentaId } from "../../src/modulos/fiscal/dominio/identificadores";
import {
  VERSION_DE_REPRESENTACION_ACTUAL,
  type ComprobanteParaImprimir,
} from "../../src/modulos/fiscal/dominio/modelo-de-impresion";
import type { Receptor } from "../../src/modulos/fiscal/dominio/receptor";
import { CUIT_A, CUIT_B, CUIT_C, EMISOR_1, EMPRESA } from "./fiscal";

/**
 * Datos de ejemplo de la facturación (tramo F1), compartidos por las pruebas del dominio puro.
 * Todos los CUIT de `fiscal.ts` son válidos.
 */
export function fecha(texto: string): FechaCivil {
  const r = fechaCivilDesdeTexto(texto);
  if (!r.ok) throw new Error(`fecha de prueba inválida: ${texto}`);
  return r.valor;
}

function domicilio(calle: string, numero: string): Domicilio {
  const r = domicilioDesdeDatos({
    calle,
    numero,
    localidad: "Ciudad Autónoma de Buenos Aires",
    provincia: "AR-C",
    codigoPostal: "C1043",
  });
  if (!r.ok) throw new Error("domicilio de prueba inválido");
  return r.valor;
}

const DOMICILIO_FISCAL = domicilio("Av. Corrientes", "1234");
const DOMICILIO_DEL_PUNTO_DE_VENTA = domicilio("Calle Falsa", "123");

export const emisorInstantaneo = (
  cambios: Partial<InstantaneaDeEmisor> = {},
): InstantaneaDeEmisor => ({
  cuit: CUIT_B,
  razonSocial: "Panadería Zulu SRL",
  condicionIva: "RESPONSABLE_INSCRIPTO",
  domicilioFiscal: DOMICILIO_FISCAL,
  puntoDeVentaNumero: 1,
  domicilioDelPuntoDeVenta: DOMICILIO_DEL_PUNTO_DE_VENTA,
  ...cambios,
});

export const contextoDeEmision = (cambios: Partial<ContextoDeEmision> = {}): ContextoDeEmision => ({
  empresaId: EMPRESA,
  emisorId: EMISOR_1,
  puntoDeVentaId: puntoDeVentaId("pv-1"),
  ambiente: "HOMOLOGACION",
  origen: { tipo: "MANUAL", id: origenId("clave-1") },
  emisor: emisorInstantaneo(),
  ...cambios,
});

export const consumidorFinal: Receptor = {
  nombre: null,
  documento: { tipo: "SIN_IDENTIFICAR" },
  condicionIva: "CONSUMIDOR_FINAL",
  domicilio: null,
};

export const receptorInscripto: Receptor = {
  nombre: "Distribuidora Sur SA",
  documento: { tipo: "CUIT", numero: CUIT_C },
  condicionIva: "RESPONSABLE_INSCRIPTO",
  domicilio: "Av. Siempreviva 742",
};

export const receptorMonotributista: Receptor = {
  nombre: "Ana Pérez",
  documento: { tipo: "CUIT", numero: CUIT_A },
  condicionIva: "MONOTRIBUTO",
  domicilio: null,
};

export function renglon(
  precio: string,
  cantidad: string,
  alicuota: CodigoDeAlicuota | null,
  descuento: string | null = null,
  descripcion = "Pan",
): RenglonAFacturar {
  return {
    descripcion,
    cantidad: cantidadDesdeTexto(cantidad),
    precioUnitario: precioUnitarioDesdeTexto(precio),
    descuento: descuento === null ? null : porcentajeDesdeTexto(descuento),
    alicuota,
  };
}

export const entradaDeFactura = (
  receptor: Receptor,
  renglones: readonly RenglonAFacturar[],
  cambios: Partial<EntradaDeComprobante> = {},
): EntradaDeComprobante => ({
  receptor,
  modoDePrecio: "IVA_INCLUIDO",
  concepto: "PRODUCTOS",
  servicio: null,
  renglones,
  ...cambios,
});

/** Arma una factura de prueba; si el armado falla, la prueba falla con el error. */
export function facturaArmada(
  receptor: Receptor,
  renglones: readonly RenglonAFacturar[],
  cambios: Partial<EntradaDeComprobante> = {},
  contexto: ContextoDeEmision = contextoDeEmision(),
): ComprobanteNuevo {
  const r = armarComprobanteNuevo(entradaDeFactura(receptor, renglones, cambios), contexto);
  if (!r.ok) throw new Error(`factura de prueba inválida: ${JSON.stringify(r.error)}`);
  return r.valor;
}

/** Generadores de renglones razonables (el total no se sale del rango). */
export const alicuotaArbitraria: fc.Arbitrary<CodigoDeAlicuota> = fc.constantFrom(
  ...CODIGOS_DE_ALICUOTA,
);

export const renglonArbitrario = (
  alicuotas: fc.Arbitrary<CodigoDeAlicuota | null> = alicuotaArbitraria,
): fc.Arbitrary<RenglonAFacturar> =>
  fc.record({
    descripcion: fc.constantFrom("Pan", "Medialuna", "Café"),
    cantidad: fc
      .bigInt({ min: 1n, max: 1_000_000n })
      .map((u) => cantidadDesdeTexto(formatearDecimalFijo(u, 4))),
    precioUnitario: fc
      .bigInt({ min: 0n, max: 100_000_000_000n })
      .map((u) => precioUnitarioDesdeTexto(formatearDecimalFijo(u, 6))),
    descuento: fc.option(
      fc
        .bigInt({ min: 0n, max: 1_000_000n })
        .map((u) => porcentajeDesdeTexto(formatearDecimalFijo(u, 4))),
      { nil: null },
    ),
    alicuota: alicuotas,
  });

/**
 * Como `facturaArmada`, pero devuelve `null` si el total sale en cero (una propiedad con precios al
 * azar puede dar cero). Cualquier otro error es un defecto de la prueba y la hace fallar.
 */
export function facturaOSinTotal(
  receptor: Receptor,
  renglones: readonly RenglonAFacturar[],
  cambios: Partial<EntradaDeComprobante> = {},
  contexto: ContextoDeEmision = contextoDeEmision(),
): ComprobanteNuevo | null {
  const r = armarComprobanteNuevo(entradaDeFactura(receptor, renglones, cambios), contexto);
  if (r.ok) return r.valor;
  if (r.error.codigo === "TOTAL_FUERA_DE_RANGO") return null;
  throw new Error(`factura de prueba inválida: ${JSON.stringify(r.error)}`);
}

/**
 * Lo que se imprime de un comprobante autorizado, armado desde el contenido de prueba: el número, la fecha y el
 * CAE los fijó ARCA, y el emisor se congela con los domicilios como TEXTO (como los guarda la base).
 */
export const imprimibleDe = (
  contenido: ComprobanteNuevo,
  cambios: Partial<ComprobanteParaImprimir> = {},
): ComprobanteParaImprimir => ({
  ambiente: contenido.ambiente,
  tipo: contenido.tipo,
  emisor: {
    cuit: contenido.emisor.cuit,
    razonSocial: contenido.emisor.razonSocial,
    condicionIva: contenido.emisor.condicionIva,
    domicilioFiscal: formatearDomicilio(contenido.emisor.domicilioFiscal),
    inicioDeActividades: fecha("2019-03-01"),
    iibbNumero: "901-123456-7",
    iibbCondicion: "LOCAL",
    puntoDeVentaNumero: contenido.emisor.puntoDeVentaNumero,
    domicilioDelPuntoDeVenta: formatearDomicilio(contenido.emisor.domicilioDelPuntoDeVenta),
  },
  receptor: contenido.receptor,
  renglones: contenido.renglones,
  total: contenido.total,
  desglose: contenido.desglose,
  asociado: contenido.asociado,
  numero: 11n,
  fechaEmision: fecha("2026-10-13"),
  cae: "70417054367476",
  caeVence: fecha("2026-10-23"),
  versionDeRepresentacion: VERSION_DE_REPRESENTACION_ACTUAL,
  ...cambios,
});
