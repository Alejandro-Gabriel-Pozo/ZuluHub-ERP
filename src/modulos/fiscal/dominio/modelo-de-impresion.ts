import { cantidadATexto } from "../../../primitivas/cantidad/cantidad";
import { porcentajeATexto } from "../../../primitivas/cantidad/porcentaje";
import { importeATexto, importeCero, type Importe } from "../../../primitivas/dinero/importe";
import type { Moneda } from "../../../primitivas/dinero/moneda";
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
import type { Ambiente, RenglonCalculado } from "./comprobante-nuevo";
import type { CondicionIibb } from "./datos-fiscales";
import { importesParaArca } from "./importes-para-arca";
import { urlDelQr, type ErrorDeQr } from "./qr-de-arca";
import type { CondicionIva } from "./emisor";
import type { DocumentoDelReceptor, Receptor } from "./receptor";

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
 *   formato cambie después. Existen la versión 1 y la 2 (ver `VERSIONES_SOPORTADAS`).
 * - Todo importe, cantidad y precio sale como texto decimal.
 *
 * NO VERIFICADO (preguntas C8 y C23 al contador): qué otras leyendas legales deben figurar. `leyendas`
 * trae la de homologación; el modelo admite más sin tocar la base.
 */

/**
 * Las versiones que este código sabe dibujar; cualquier otra se rechaza (`VERSION_DE_REPRESENTACION_DESCONOCIDA`):
 * lista cerrada, no «todo lo menor o igual a la actual», para que subir la versión sea una decisión explícita.
 * - 1: el formato anterior a los textos legales de la RG 5614/2024. Se conserva SIN CAMBIOS: lo sellado con 1
 *   reimprime idéntico (golden `modelo-factura-b-marca-*` y `modelo-nota-de-credito-a-produccion`).
 * - 2: suma la leyenda del receptor consumidor final y el bloque de transparencia fiscal de la B.
 * Previene que reimprimir un AUTORIZADO muestre textos que su original no tenía. Sin migración: la columna es
 * `smallint` con `CHECK (>= 1)` (0009) y `emitir-comprobante` sella `VERSION_DE_REPRESENTACION_ACTUAL`. Chequeo:
 * los golden de la 1 y de la 2 y la prueba de versiones desconocidas de `modelo-de-impresion.test.ts`.
 */
const VERSIONES_SOPORTADAS: readonly number[] = [1, 2];

/** La que sellan los comprobantes nuevos. */
export const VERSION_DE_REPRESENTACION_ACTUAL = 2;

/** Primera versión que lleva los textos legales de la norma; las anteriores no los llevan. */
const PRIMERA_VERSION_CON_TEXTOS_LEGALES = 2;

/**
 * Textos legales (versión 2), copiados de la norma sin parafrasear; si ARCA los cambia, es una versión nueva.
 * FUENTE (repositorio de docs, `12-referencias-externas/arca-normas-de-comprobantes/`, rama
 * `web/especificaciones-del-qr`, PR #3; SHA-256 en su README):
 * - Título y rótulos: `norma_5614_2024.html`, RG 5614/2024 art. 2 punto 7 (sustituye el inciso g) del Apartado B
 *   del Anexo II de la RG 1415; subpunto 1, «espacio inferior izquierdo»), art. 5 (la representación gráfica de la
 *   RG 4291 debe incluirlos) y art. 6 b) (obligatorio desde el 01/04/2025). Texto vigente: `rg1415_dcp.html`,
 *   «Anexo II - Texto vigente según Resolución General Nº 5866/2026 ARCA», Apartado B, inciso g) 1.
 * - Leyenda: `rg5866.html`, RG 5866/2026 art. 1 f) (sustituye el inciso d) del Título II del Apartado A del
 *   Anexo II; punto 1; vigente desde el 01/07/2026); está en `rg1415_dcp.html`, Anexo II, Apartado A, Título II, d) 1.
 */
const TITULO_DE_TRANSPARENCIA_FISCAL = "Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)";
const ROTULO_DE_IVA_CONTENIDO = "IVA Contenido";
const ROTULO_DE_OTROS_IMPUESTOS_INDIRECTOS = "Otros Impuestos Nacionales Indirectos";
const LEYENDA_A_CONSUMIDOR_FINAL = "A CONSUMIDOR FINAL";

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

/**
 * Bloque «espacio inferior izquierdo» de la B a consumidor final (versión 2 en adelante). Los textos son los de la
 * norma (ver la fuente arriba); los valores salen de los mismos importes que `totales`.
 */
export type TransparenciaFiscalImpresa = Readonly<{
  titulo: string;
  ivaContenido: Readonly<{
    rotulo: string;
    /** Por alícuota, como `totales.ivaContenido` (decisión 9 del dueño; el contador debe ratificarla, C23). */
    porAlicuota: readonly { alicuota: string; iva: string }[];
  }>;
  otrosImpuestosNacionalesIndirectos: Readonly<{ rotulo: string; valor: string }>;
}>;

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
  }>;
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
 * «Otros Impuestos Nacionales Indirectos» que inciden en el precio (RG 5614 art. 2 punto 4: Anexo II A.III.f; art. 6
 * a): los impuestos internos). SUPUESTO: el producto no tiene hoy ese dato (no hay impuestos internos ni otros
 * tributos en el comprobante: `ImpTrib` es cero), así que el valor es siempre cero. Lo confirma el contador (C23).
 * ÚNICO lugar para cambiarlo cuando el producto tenga el dato.
 */
function otrosImpuestosNacionalesIndirectos(moneda: Moneda): Importe {
  return importeCero(moneda);
}

/**
 * El bloque de transparencia fiscal, o `null` si no corresponde: letra B (sus `totales` traen el IVA contenido) y
 * receptor consumidor final, según la autorización del dueño del 2026-11-04. PREGUNTAS PENDIENTES (contador, C23),
 * por eso NO se agrega fuera de este caso: ¿lleva el bloque la C a consumidor final (monotributo o exento; la RG 5614
 * art. 2 punto 7 no limita la letra y el art. 99 de la Ley 27.743 no está en el repo)? ¿La A? ¿La B a exento o no
 * alcanzado (Anexo II A.IV.a punto 2 manda discriminar el IVA también a ellos)?
 */
function transparenciaFiscal(
  totales: TotalesImpresos,
  receptor: Receptor,
  moneda: Moneda,
): TransparenciaFiscalImpresa | null {
  if (totales.letra !== "B" || receptor.condicionIva !== "CONSUMIDOR_FINAL") return null;
  return {
    titulo: TITULO_DE_TRANSPARENCIA_FISCAL,
    ivaContenido: { rotulo: ROTULO_DE_IVA_CONTENIDO, porAlicuota: totales.ivaContenido },
    otrosImpuestosNacionalesIndirectos: {
      rotulo: ROTULO_DE_OTROS_IMPUESTOS_INDIRECTOS,
      valor: importeATexto(otrosImpuestosNacionalesIndirectos(moneda)),
    },
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
        iibbCondicion: emisor.iibbCondicion,
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
    },
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
  });
}
