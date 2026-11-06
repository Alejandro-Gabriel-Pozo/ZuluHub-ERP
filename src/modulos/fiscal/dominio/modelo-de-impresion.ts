import { cantidadATexto } from "../../../primitivas/cantidad/cantidad";
import { porcentajeATexto } from "../../../primitivas/cantidad/porcentaje";
import { importeATexto, type Importe } from "../../../primitivas/dinero/importe";
import { precioUnitarioATexto } from "../../../primitivas/dinero/precio-unitario";
import { cuitConGuiones, type Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { CODIGO_DE_TIPO_DE_COMPROBANTE } from "./codigos-de-arca";
import type { DesgloseDeAlicuota } from "./comprobante";
import {
  claseDeComprobante,
  letraDeComprobante,
  type ClaseDeComprobante,
  type LetraDeComprobante,
  type TipoDeComprobante,
} from "./comprobante-emitido";
import type { ModoDePrecio } from "./calculo-de-renglones";
import type { Ambiente, RenglonCalculado } from "./comprobante-nuevo";
import { contactoImpreso, type ContactoCongelado, type ContactoImpreso } from "./contacto-impreso";
import {
  sucursalImpresa,
  type NombreDeSucursalCongelado,
  type SucursalImpresa,
} from "./sucursal-impresa";
import type { CondicionIibb } from "./datos-fiscales";
import { condicionDeIibbImpresa } from "./iibb-impreso";
import { importesParaArca } from "./importes-para-arca";
import { leyendaDeCreditoFiscal } from "./leyenda-de-credito-fiscal";
import {
  LEYENDA_A_CONSUMIDOR_FINAL,
  leyendaDeCondicionDelReceptor,
} from "./leyenda-de-condicion-del-receptor";
import { urlDelQr, type ErrorDeQr } from "./qr-de-arca";
import type { CondicionIva } from "./emisor";
import type { DocumentoDelReceptor, Receptor } from "./receptor";
import { transparenciaFiscal, type TransparenciaFiscalImpresa } from "./transparencia-fiscal";
import {
  PRIMERA_VERSION_CON_CONTACTO,
  PRIMERA_VERSION_CON_LEYENDA_DE_CONDICION,
  PRIMERA_VERSION_CON_MODO_DE_PRECIO,
  PRIMERA_VERSION_CON_SUCURSAL,
  PRIMERA_VERSION_CON_TEXTOS_LEGALES,
  VERSIONES_SOPORTADAS,
} from "./versiones-de-representacion";

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
 *   formato cambie después. Existen las versiones 1, 2 y 3 (ver `VERSIONES_SOPORTADAS`).
 * - Todo importe, cantidad y precio sale como texto decimal.
 *
 * NO VERIFICADO (preguntas C8 y C23 al contador): qué otras leyendas legales deben figurar. `leyendas`
 * trae la de homologación; el modelo admite más sin tocar la base.
 */

export { VERSION_DE_REPRESENTACION_ACTUAL } from "./versiones-de-representacion";

export const LEYENDA_DE_HOMOLOGACION = "HOMOLOGACIÓN — SIN VALIDEZ FISCAL";

/** La marca que el comprobante imprime: la completa `marcas`. */
export type MarcaParaImprimir = Readonly<{
  nombreDeFantasia: string | null;
  logoUrl: string | null;
  colorPrincipal: string | null;
}>;

/**
 * El emisor y el punto de venta tal como los congeló el comprobante al nacer. Los domicilios son el TEXTO que
 * se guardó (`formatearDomicilio`): la base no conserva sus partes, y reimprimir tiene que dar lo que se
 * emitió aunque el domicilio de la empresa cambie después.
 */
export type EmisorParaImprimir = Readonly<{
  cuit: Cuit;
  razonSocial: string;
  condicionIva: CondicionIva;
  domicilioFiscal: string;
  inicioDeActividades: FechaCivil;
  iibbNumero: string | null;
  iibbCondicion: CondicionIibb | null;
  puntoDeVentaNumero: number;
  domicilioDelPuntoDeVenta: string;
}>;

/** El comprobante que una nota corrige: lo que se imprime de él. */
export type AsociadoParaImprimir = Readonly<{
  tipo: TipoDeComprobante;
  puntoDeVenta: number;
  numero: bigint;
  fecha: FechaCivil;
}>;

/**
 * Un comprobante `AUTORIZADO` con todo lo que se imprime, leído de lo que se guardó (no se recalcula nada:
 * el total y el desglose son los que se informaron a ARCA). Lo que fijó ARCA es el número, la fecha de la
 * reserva, el CAE y su vencimiento.
 */
export type ComprobanteParaImprimir = Readonly<{
  ambiente: Ambiente;
  tipo: TipoDeComprobante;
  emisor: EmisorParaImprimir;
  receptor: Receptor;
  renglones: readonly RenglonCalculado[];
  total: Importe;
  desglose: readonly DesgloseDeAlicuota[];
  asociado: AsociadoParaImprimir | null;
  numero: bigint;
  fechaEmision: FechaCivil;
  cae: string;
  caeVence: FechaCivil;
  versionDeRepresentacion: number;
  /** Cómo se cargaron los precios unitarios, tal como se guardó (la C siempre es `IVA_INCLUIDO`). */
  modoDePrecio: ModoDePrecio;
  /** El contacto de la sucursal congelado al nacer el comprobante; NUNCA el de la sucursal de hoy (D-98). */
  contacto: ContactoCongelado;
  /** El nombre de la sucursal congelado al nacer el comprobante, NUNCA el de hoy (D-114); nulo si es anterior a 0022. */
  sucursalNombre: NombreDeSucursalCongelado;
}>;

/**
 * Una referencia de contexto de un renglón: un código del vocabulario del módulo que facturó (`tipo`, por
 * ejemplo `RESERVA_FOLIO`) y su texto copiado (`valor`), spec H7 facturación §B.10. Fiscal solo las lleva, no
 * las interpreta. Las plantillas reservan la línea con ella.
 */
export type ReferenciaImpresa = Readonly<{ tipo: string; valor: string }>;

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
      domicilioFiscal: string;
      domicilioDelPuntoDeVenta: string;
      iibbNumero: string | null;
      iibbCondicion: CondicionIibb | null;
      inicioDeActividades: FechaCivil;
    }>;
  }>;
  receptor: Readonly<{
    nombre: string | null;
    documento: DocumentoDelReceptor;
    condicionIva: string;
    domicilio: string | null;
    /**
     * Versión 2 en adelante y solo si el receptor es consumidor final: «A CONSUMIDOR FINAL» (RG 5866 art. 1 f).
     * Ausente en la versión 1 y en cualquier otra condición.
     */
    leyenda?: string;
    /**
     * Versión 3 en adelante y solo si la norma da una leyenda para la condición del receptor (RG 1415 Anexo II A.II;
     * `leyenda-de-condicion-del-receptor.ts`), consumidor final incluido: se imprime siempre, con o sin nombre. Ausente en las
     * versiones 1 y 2 y en las condiciones sin leyenda.
     */
    leyendaDeCondicion?: string;
  }>;
  /**
   * Versión 2 en adelante: si los precios unitarios de los renglones llevan el IVA incluido o van sin IVA. Lo guardó el
   * comprobante; la C siempre es `IVA_INCLUIDO`. Sin rótulos: el texto del encabezado lo elige la vista. Ausente en la versión 1.
   */
  modoDePrecio?: ModoDePrecio;
  renglones: readonly Readonly<{
    descripcion: string;
    cantidad: string;
    precioUnitario: string;
    descuento: string | null;
    alicuota: string | null;
    importe: string;
    /**
     * SIEMPRE vacío hoy: la fuente real (las referencias que el módulo de origen copia al emitir) llega con el
     * tramo F12 (§B.10). Existe desde ya para que las plantillas reserven la línea sin que el formato cambie
     * después; no entra en ningún cálculo ni en el QR.
     */
    referencias: readonly ReferenciaImpresa[];
  }>[];
  totales: TotalesImpresos;
  /**
   * Versión 2 en adelante y solo en la letra B con receptor consumidor final (factura, nota de crédito y de
   * débito B). Ausente en la versión 1 y en todo lo demás.
   */
  transparenciaFiscal?: TransparenciaFiscalImpresa;
  /**
   * Versión 2 en adelante y solo si la sucursal tenía al menos un dato de contacto al emitir (D-98): el que congeló el
   * comprobante, no el vigente. Ausente en la versión 1 y sin contacto. Cada dato va solo si existe; sin rótulos.
   */
  contacto?: ContactoImpreso;
  /** Versión 2 en adelante y solo si el comprobante congeló el nombre de su sucursal (D-114), no el vigente. Sin rótulo. */
  sucursal?: SucursalImpresa;
  /** Solo en notas: el comprobante que corrigen. */
  asociado: Readonly<{
    rotulo: string;
    letra: LetraDeComprobante;
    numero: string;
    fecha: FechaCivil;
  }> | null;
  qr: Readonly<{ url: string }>;
  /**
   * Solo avisos del sistema, que la vista dibuja destacados: hoy la de homologación. NUNCA un texto legal de la norma (van en
   * `leyendasLegales`).
   */
  leyendas: readonly string[];
  /**
   * Versión 2 en adelante: textos legales de la norma, tal cual, para dibujarlos como texto del comprobante y no como aviso.
   * Hoy 0 o 1: la de crédito fiscal de la A a monotributista (`LEYENDA_DE_CREDITO_FISCAL_A_MONOTRIBUTISTA`). Ausente si no hay
   * y en la versión 1. Separada de `leyendas` para que un texto legal no se muestre como aviso de pruebas.
   */
  leyendasLegales?: readonly string[];
}>;

const ROTULOS: Readonly<Record<ClaseDeComprobante, ModeloImpreso["fiscal"]["rotulo"]>> = {
  FACTURA: "FACTURA",
  NOTA_CREDITO: "NOTA DE CRÉDITO",
  NOTA_DEBITO: "NOTA DE DÉBITO",
};

/** `PPPPP-NNNNNNNN`: punto de venta de cinco dígitos y número de ocho, con ceros a la izquierda. */
export function numeroImpreso(puntoDeVenta: number, numero: bigint): string {
  return `${String(puntoDeVenta).padStart(5, "0")}-${String(numero).padStart(8, "0")}`;
}

function totalesImpresos(
  comprobante: Pick<ComprobanteParaImprimir, "tipo" | "total" | "desglose">,
  letra: LetraDeComprobante,
): TotalesImpresos {
  const importes = importesParaArca(comprobante);
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
 * La versión 1 sale como siempre; los textos legales de la norma son de la versión 2 en adelante.
 */
export function modeloDeImpresion(
  comprobante: ComprobanteParaImprimir,
  marca: MarcaParaImprimir,
): Resultado<ModeloImpreso, ErrorDeImpresion> {
  if (!VERSIONES_SOPORTADAS.includes(comprobante.versionDeRepresentacion)) {
    return err("VERSION_DE_REPRESENTACION_DESCONOCIDA");
  }
  const { emisor, asociado } = comprobante;
  const letra = letraDeComprobante(comprobante.tipo);
  const qr = urlDelQr({
    fecha: comprobante.fechaEmision,
    cuit: emisor.cuit,
    puntoDeVenta: emisor.puntoDeVentaNumero,
    tipo: comprobante.tipo,
    numero: comprobante.numero,
    total: comprobante.total,
    documento: comprobante.receptor.documento,
    cae: comprobante.cae,
  });
  if (!qr.ok) return qr;
  const totales = totalesImpresos(comprobante, letra);
  const conTextosLegales =
    comprobante.versionDeRepresentacion >= PRIMERA_VERSION_CON_TEXTOS_LEGALES;
  const contacto =
    comprobante.versionDeRepresentacion >= PRIMERA_VERSION_CON_CONTACTO
      ? contactoImpreso(comprobante.contacto)
      : null;
  const sucursal =
    comprobante.versionDeRepresentacion >= PRIMERA_VERSION_CON_SUCURSAL
      ? sucursalImpresa(comprobante.sucursalNombre)
      : null;
  const conModoDePrecio = comprobante.versionDeRepresentacion >= PRIMERA_VERSION_CON_MODO_DE_PRECIO;
  const leyendaDeCredito = conTextosLegales
    ? leyendaDeCreditoFiscal(letra, comprobante.receptor.condicionIva)
    : null;
  const leyendaDeCondicion =
    comprobante.versionDeRepresentacion >= PRIMERA_VERSION_CON_LEYENDA_DE_CONDICION
      ? leyendaDeCondicionDelReceptor(comprobante.receptor.condicionIva)
      : null;
  const bloqueDeTransparencia = conTextosLegales
    ? transparenciaFiscal(totales, comprobante.receptor, comprobante.total.moneda)
    : null;
  return ok({
    versionDeRepresentacion: comprobante.versionDeRepresentacion,
    marca,
    fiscal: {
      rotulo: ROTULOS[claseDeComprobante(comprobante.tipo)],
      letra,
      codigoDelTipo: String(CODIGO_DE_TIPO_DE_COMPROBANTE[comprobante.tipo]).padStart(3, "0"),
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
        iibbNumero: emisor.iibbNumero,
        iibbCondicion: condicionDeIibbImpresa(comprobante),
        inicioDeActividades: emisor.inicioDeActividades,
      },
    },
    receptor: {
      nombre: comprobante.receptor.nombre,
      documento: comprobante.receptor.documento,
      condicionIva: comprobante.receptor.condicionIva,
      domicilio: comprobante.receptor.domicilio,
      ...(conTextosLegales && comprobante.receptor.condicionIva === "CONSUMIDOR_FINAL"
        ? { leyenda: LEYENDA_A_CONSUMIDOR_FINAL }
        : {}),
      ...(leyendaDeCondicion === null ? {} : { leyendaDeCondicion }),
    },
    ...(conModoDePrecio ? { modoDePrecio: comprobante.modoDePrecio } : {}),
    renglones: comprobante.renglones.map((r) => ({
      descripcion: r.descripcion,
      cantidad: cantidadATexto(r.cantidad),
      precioUnitario: precioUnitarioATexto(r.precioUnitario),
      descuento: r.descuento === null ? null : porcentajeATexto(r.descuento),
      alicuota: r.alicuota,
      importe: importeATexto(r.importe),
      referencias: [],
    })),
    totales,
    ...(bloqueDeTransparencia === null ? {} : { transparenciaFiscal: bloqueDeTransparencia }),
    ...(contacto === null ? {} : { contacto }),
    ...(sucursal === null ? {} : { sucursal }),
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
    leyendas: comprobante.ambiente === "HOMOLOGACION" ? [LEYENDA_DE_HOMOLOGACION] : [],
    ...(leyendaDeCredito === null ? {} : { leyendasLegales: [leyendaDeCredito] }),
  });
}
