import { cantidadATexto } from "../../../primitivas/cantidad/cantidad";
import { porcentajeATexto } from "../../../primitivas/cantidad/porcentaje";
import type { Domicilio } from "../../../primitivas/domicilio/domicilio";
import { importeATexto } from "../../../primitivas/dinero/importe";
import { precioUnitarioATexto } from "../../../primitivas/dinero/precio-unitario";
import { cuitConGuiones } from "../../../primitivas/identificacion-fiscal/cuit";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { CODIGO_DE_TIPO_DE_COMPROBANTE } from "./codigos-de-arca";
import {
  claseDeComprobante,
  letraDeComprobante,
  type ClaseDeComprobante,
  type LetraDeComprobante,
} from "./comprobante-emitido";
import type { ComprobanteNuevo } from "./comprobante-nuevo";
import { importesParaArca } from "./importes-para-arca";
import { urlDelQr, type ErrorDeQr } from "./qr-de-arca";
import type { CondicionIva } from "./emisor";
import type { DocumentoDelReceptor } from "./receptor";

/**
 * Modelo de impresión de un comprobante autorizado (spec H7 facturación §B.7): un valor puro, sin
 * HTML ni PDF, que la vista imprimible (y más adelante un PDF) solo dibuja. El golden es de este
 * modelo, no del PDF.
 *
 * - Bloque `marca` (nombre de fantasía, logo, color): lo único que viene de la marca. Los rótulos
 *   del bloque `fiscal` (tipo, letra, código, número, CAE) salen de acá y NO se pueden editar: una
 *   marca blanca no puede cambiar «Factura A» ni el CAE.
 * - Totales según la letra: A discrimina neto e IVA por alícuota; B muestra el total y el IVA
 *   CONTENIDO por alícuota (decisión 9 del dueño); C muestra solo el total.
 * - `versionDeRepresentacion` la sella el comprobante al nacer: reimprimir da lo mismo aunque el
 *   formato cambie después. Hoy existe la versión 1.
 * - Todo importe, cantidad y precio sale como texto decimal.
 *
 * NO VERIFICADO (preguntas C8 y C23 al contador): qué leyendas legales deben figurar (por ejemplo,
 * la del IVA contenido). `leyendas` solo trae la de homologación; el modelo admite más sin tocar la
 * base.
 */
export const VERSION_DE_REPRESENTACION_ACTUAL = 1;

export const LEYENDA_DE_HOMOLOGACION = "HOMOLOGACIÓN — SIN VALIDEZ FISCAL";

/** La marca que el comprobante imprime: la completa `marcas`. */
export type MarcaParaImprimir = Readonly<{
  nombreDeFantasia: string | null;
  logoUrl: string | null;
  colorPrincipal: string | null;
}>;

/** Datos fiscales del emisor que la instantánea del comprobante no trae y que se imprimen. */
export type DatosFiscalesParaImprimir = Readonly<{
  iibbNumero: string | null;
  iibbCondicion: string | null;
  inicioDeActividades: FechaCivil;
}>;

export type ComprobanteParaImprimir = Readonly<{
  contenido: ComprobanteNuevo;
  /** Lo que fijó ARCA: el número y la fecha de la reserva, el CAE y su vencimiento. */
  numero: bigint;
  fechaEmision: FechaCivil;
  cae: string;
  caeVence: FechaCivil;
  versionDeRepresentacion: number;
  datosFiscales: DatosFiscalesParaImprimir;
}>;

export type ErrorDeImpresion = ErrorDeQr | "VERSION_DE_REPRESENTACION_DESCONOCIDA";

export type TotalesImpresos =
  | Readonly<{
      letra: "A";
      netoPorAlicuota: readonly { alicuota: string; neto: string; iva: string }[];
      exento: string;
      noGravado: string;
      neto: string;
      iva: string;
      total: string;
    }>
  | Readonly<{
      letra: "B";
      total: string;
      /** El IVA que ya contiene el precio, por alícuota gravada. */
      ivaContenido: readonly { alicuota: string; iva: string }[];
    }>
  | Readonly<{ letra: "C"; total: string }>;

export type ModeloImpreso = Readonly<{
  versionDeRepresentacion: number;
  marca: MarcaParaImprimir;
  fiscal: Readonly<{
    rotulo: "FACTURA" | "NOTA DE CRÉDITO" | "NOTA DE DÉBITO";
    letra: LetraDeComprobante;
    /** Código del tipo con tres dígitos: `006` para la factura B. */
    codigoDelTipo: string;
    /** `PPPPP-NNNNNNNN`. */
    numero: string;
    fecha: FechaCivil;
    cae: string;
    caeVence: FechaCivil;
    emisor: Readonly<{
      cuit: string;
      razonSocial: string;
      condicionIva: CondicionIva;
      domicilioFiscal: Domicilio;
      domicilioDelPuntoDeVenta: Domicilio;
      iibbNumero: string | null;
      iibbCondicion: string | null;
      inicioDeActividades: FechaCivil;
    }>;
  }>;
  receptor: Readonly<{
    nombre: string | null;
    documento: DocumentoDelReceptor;
    condicionIva: string;
    domicilio: string | null;
  }>;
  renglones: readonly Readonly<{
    descripcion: string;
    cantidad: string;
    precioUnitario: string;
    descuento: string | null;
    alicuota: string | null;
    importe: string;
  }>[];
  totales: TotalesImpresos;
  /** Solo en notas: el comprobante que corrigen. */
  asociado: Readonly<{
    rotulo: string;
    letra: LetraDeComprobante;
    numero: string;
    fecha: FechaCivil;
  }> | null;
  qr: Readonly<{ url: string }>;
  leyendas: readonly string[];
}>;

const ROTULOS: Readonly<Record<ClaseDeComprobante, ModeloImpreso["fiscal"]["rotulo"]>> = {
  FACTURA: "FACTURA",
  NOTA_CREDITO: "NOTA DE CRÉDITO",
  NOTA_DEBITO: "NOTA DE DÉBITO",
};

function numeroImpreso(puntoDeVenta: number, numero: bigint): string {
  return `${String(puntoDeVenta).padStart(5, "0")}-${String(numero).padStart(8, "0")}`;
}

function totalesImpresos(contenido: ComprobanteNuevo, letra: LetraDeComprobante): TotalesImpresos {
  const importes = importesParaArca(contenido);
  const total = importeATexto(importes.total);
  if (letra === "C") return { letra, total };
  if (letra === "B") {
    return {
      letra,
      total,
      ivaContenido: importes.alicuotas.map((a) => ({
        alicuota: a.alicuota,
        iva: importeATexto(a.iva),
      })),
    };
  }
  return {
    letra,
    netoPorAlicuota: importes.alicuotas.map((a) => ({
      alicuota: a.alicuota,
      neto: importeATexto(a.base),
      iva: importeATexto(a.iva),
    })),
    exento: importeATexto(importes.exento),
    noGravado: importeATexto(importes.noGravado),
    neto: importeATexto(importes.neto),
    iva: importeATexto(importes.iva),
    total,
  };
}

/**
 * Arma el modelo. `VERSION_DE_REPRESENTACION_DESCONOCIDA` si el comprobante sella una versión que
 * este código no sabe dibujar; `CAE_INVALIDO` si el CAE no tiene 14 dígitos (no hay QR posible).
 */
export function modeloDeImpresion(
  comprobante: ComprobanteParaImprimir,
  marca: MarcaParaImprimir,
): Resultado<ModeloImpreso, ErrorDeImpresion> {
  if (comprobante.versionDeRepresentacion !== VERSION_DE_REPRESENTACION_ACTUAL) {
    return err("VERSION_DE_REPRESENTACION_DESCONOCIDA");
  }
  const { contenido } = comprobante;
  const { emisor, asociado } = contenido;
  const letra = letraDeComprobante(contenido.tipo);
  const qr = urlDelQr({
    fecha: comprobante.fechaEmision,
    cuit: emisor.cuit,
    puntoDeVenta: emisor.puntoDeVentaNumero,
    tipo: contenido.tipo,
    numero: comprobante.numero,
    total: contenido.total,
    documento: contenido.receptor.documento,
    cae: comprobante.cae,
  });
  if (!qr.ok) return qr;
  return ok({
    versionDeRepresentacion: comprobante.versionDeRepresentacion,
    marca,
    fiscal: {
      rotulo: ROTULOS[claseDeComprobante(contenido.tipo)],
      letra,
      codigoDelTipo: String(CODIGO_DE_TIPO_DE_COMPROBANTE[contenido.tipo]).padStart(3, "0"),
      numero: numeroImpreso(emisor.puntoDeVentaNumero, comprobante.numero),
      fecha: comprobante.fechaEmision,
      cae: comprobante.cae,
      caeVence: comprobante.caeVence,
      emisor: {
        cuit: cuitConGuiones(emisor.cuit),
        razonSocial: emisor.razonSocial,
        condicionIva: emisor.condicionIva,
        domicilioFiscal: emisor.domicilioFiscal,
        domicilioDelPuntoDeVenta: emisor.domicilioDelPuntoDeVenta,
        iibbNumero: comprobante.datosFiscales.iibbNumero,
        iibbCondicion: comprobante.datosFiscales.iibbCondicion,
        inicioDeActividades: comprobante.datosFiscales.inicioDeActividades,
      },
    },
    receptor: {
      nombre: contenido.receptor.nombre,
      documento: contenido.receptor.documento,
      condicionIva: contenido.receptor.condicionIva,
      domicilio: contenido.receptor.domicilio,
    },
    renglones: contenido.renglones.map((r) => ({
      descripcion: r.descripcion,
      cantidad: cantidadATexto(r.cantidad),
      precioUnitario: precioUnitarioATexto(r.precioUnitario),
      descuento: r.descuento === null ? null : porcentajeATexto(r.descuento),
      alicuota: r.alicuota,
      importe: importeATexto(r.importe),
    })),
    totales: totalesImpresos(contenido, letra),
    asociado:
      asociado === null
        ? null
        : {
            rotulo: ROTULOS[claseDeComprobante(asociado.tipo)],
            letra: letraDeComprobante(asociado.tipo),
            numero: numeroImpreso(asociado.puntoDeVenta, asociado.numero),
            fecha: asociado.fecha,
          },
    qr: { url: qr.valor },
    leyendas: contenido.ambiente === "HOMOLOGACION" ? [LEYENDA_DE_HOMOLOGACION] : [],
  });
}
