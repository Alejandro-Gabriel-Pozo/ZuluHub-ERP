import type {
  EmisionElectronica,
  ErrorDeEmision,
  PuntoDeVentaParaEmision,
  SolicitudDeAutorizacion,
} from "../../src/modulos/fiscal/casos-de-uso/emision-electronica";
import {
  CODIGO_DE_MONEDA,
  CODIGO_DE_TIPO_DE_COMPROBANTE,
  CODIGO_DE_TIPO_DE_DOCUMENTO,
} from "../../src/modulos/fiscal/dominio/codigos-de-arca";
import type { TipoDeComprobante } from "../../src/modulos/fiscal/dominio/comprobante-emitido";
import type {
  DatosConsultados,
  Mensaje,
  ResultadoDeAutorizacionArca,
  ResultadoDeConsulta,
} from "../../src/modulos/fiscal/dominio/estados-de-comprobante";
import { numeroDeDocumentoParaArca } from "../../src/modulos/fiscal/dominio/receptor";
import { importeDesdeTexto, sumar } from "../../src/primitivas/dinero/importe";
import { ARS } from "../../src/primitivas/dinero/moneda";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import type { FechaCivil } from "../../src/primitivas/tiempo/fecha-civil";
import { fecha } from "./facturacion";

/**
 * Adaptador FALSO del puerto de emisión (spec H7 §B.8 y facturación §B.5.2), solo para pruebas: no
 * habla con ARCA. Guarda en memoria el último número autorizado por (CUIT, punto de venta, tipo) y
 * lo que autorizó por número (para `consultar`), y se programa por pedido (`programar`) o con una
 * función (`decidir`):
 *
 * - `AUTORIZA`: autoriza y avanza el último número;
 * - `RECHAZA`: rechaza sin avanzar;
 * - `INCIERTO`: responde incierto SIN autorizar (se perdió el pedido);
 * - `AUTORIZA_Y_SE_CAE`: autoriza (avanza el último número) pero responde incierto: «autorizó y se cayó»;
 * - `NO_ENVIADO`: el pedido seguro no salió (la conexión no se abrió): ARCA no ve nada, no cambia nada;
 * - `AUTORIZA_CON_OTROS_DATOS`: otro sistema usó el número: ARCA lo tiene autorizado con datos distintos
 *   a los pedidos (avanza el último número) y a quien pidió le responde incierto (su pedido nunca llegó
 *   a procesarse). La consulta de ese número da `ENCONTRADO` con otros datos.
 *
 * Una programación puede llevar además las observaciones o los errores que devuelve ARCA (por
 * ejemplo la 10237 de una nota de crédito mayor que su factura): ver `GuionConDetalle`.
 *
 * Como el servicio real, exige la secuencia: un número que no es el siguiente al último autorizado
 * se rechaza (error 10016), sin consultar el guion (salvo que sea `NO_ENVIADO`, que nunca llega).
 */
export type Guion =
  | "AUTORIZA"
  | "RECHAZA"
  | "INCIERTO"
  | "AUTORIZA_Y_SE_CAE"
  | "NO_ENVIADO"
  | "AUTORIZA_CON_OTROS_DATOS";

/** Un guion con lo que ARCA agrega a su respuesta: observaciones (autoriza o rechaza) y errores (rechaza). */
export type GuionConDetalle = Readonly<{
  guion: Guion;
  observaciones?: readonly Mensaje[];
  errores?: readonly Mensaje[];
}>;

export type Decidir = (solicitud: SolicitudDeAutorizacion) => Guion | GuionConDetalle;

export type OpcionesDeEmisionFalsa = Readonly<{
  /** El último número que ya tiene autorizado cada serie al empezar (por defecto 0). */
  ultimoInicial?: bigint;
  /** Qué hacer con un pedido cuando no quedan guiones programados (por defecto autoriza). */
  decidir?: Decidir;
}>;

/** El código del rechazo genérico del falso: inventado, no significa nada en ARCA. */
export const CODIGO_DE_RECHAZO_DEL_FALSO = 9999;
/** El de la numeración fuera de secuencia (WSFE v4.8, error 10016). */
export const CODIGO_FUERA_DE_SECUENCIA = 10016;

const clave = (pv: PuntoDeVentaParaEmision, tipo: TipoDeComprobante) =>
  `${pv.cuit}|${pv.numero}|${tipo}`;
const claveDeNumero = (pv: PuntoDeVentaParaEmision, tipo: TipoDeComprobante, numero: bigint) =>
  `${clave(pv, tipo)}|${numero}`;

const comoDetalle = (g: Guion | GuionConDetalle): GuionConDetalle =>
  typeof g === "string" ? { guion: g } : g;

type Registro = Readonly<{ datos: DatosConsultados; codigo: string; vence: FechaCivil }>;

/** Lo que ARCA tiene registrado de un pedido autorizado, en los términos de la consulta. */
function datosRegistrados(s: SolicitudDeAutorizacion): DatosConsultados {
  return {
    tipoDeComprobante: CODIGO_DE_TIPO_DE_COMPROBANTE[s.tipo],
    puntoDeVenta: s.puntoDeVenta.numero,
    numero: s.numero,
    fecha: s.fecha,
    tipoDeDocumento: CODIGO_DE_TIPO_DE_DOCUMENTO[s.receptor.documento.tipo],
    numeroDeDocumento: numeroDeDocumentoParaArca(s.receptor.documento),
    moneda: CODIGO_DE_MONEDA[s.importes.total.moneda],
    total: s.importes.total,
    neto: s.importes.neto,
    iva: s.importes.iva,
    alicuotas: s.importes.alicuotas,
    asociado:
      s.asociado === null
        ? null
        : {
            tipoDeComprobante: CODIGO_DE_TIPO_DE_COMPROBANTE[s.asociado.tipo],
            puntoDeVenta: s.asociado.puntoDeVenta,
            numero: s.asociado.numero,
            cuit: s.asociado.cuit,
            fecha: s.asociado.fecha,
          },
  };
}

/** Lo mismo con un centavo más de total: «otro sistema emitió por otro importe en este número». */
function datosDeOtroSistema(s: SolicitudDeAutorizacion): DatosConsultados {
  const nuestros = datosRegistrados(s);
  return { ...nuestros, total: sumar(nuestros.total, importeDesdeTexto(ARS, "0.01")) };
}

/** Un número que el falso no vio pero que ARCA ya pasó (se fijó el último a mano): lo emitió otro. */
function datosDeUnNumeroAjeno(
  pv: PuntoDeVentaParaEmision,
  tipo: TipoDeComprobante,
  numero: bigint,
): DatosConsultados {
  return {
    tipoDeComprobante: CODIGO_DE_TIPO_DE_COMPROBANTE[tipo],
    puntoDeVenta: pv.numero,
    numero,
    // Una fecha que ningún comprobante de prueba tiene: nunca coincide con el nuestro.
    fecha: fecha("2000-01-01"),
    tipoDeDocumento: CODIGO_DE_TIPO_DE_DOCUMENTO.SIN_IDENTIFICAR,
    numeroDeDocumento: 0n,
    moneda: CODIGO_DE_MONEDA.ARS,
    total: importeDesdeTexto(ARS, "0.01"),
    neto: importeDesdeTexto(ARS, "0.01"),
    iva: importeDesdeTexto(ARS, "0.00"),
    alicuotas: [],
    asociado: null,
  };
}

/**
 * Un pedido de autorización completo para pruebas: una factura B a consumidor final por $ 121,00 (neto
 * 100,00 más IVA 21 % de 21,00). Lo único que casi siempre se quiere decir es a qué serie y número va.
 */
export function solicitudDeAutorizacion(
  base: Pick<SolicitudDeAutorizacion, "puntoDeVenta" | "tipo" | "numero" | "solicitud">,
  cambios: Partial<SolicitudDeAutorizacion> = {},
): SolicitudDeAutorizacion {
  const importe = (texto: string) => importeDesdeTexto(ARS, texto);
  return {
    ...base,
    fecha: fecha("2026-10-13"),
    concepto: "PRODUCTOS",
    servicio: null,
    receptor: { documento: { tipo: "SIN_IDENTIFICAR" }, condicionIva: "CONSUMIDOR_FINAL" },
    importes: {
      total: importe("121.00"),
      neto: importe("100.00"),
      iva: importe("21.00"),
      exento: importe("0.00"),
      noGravado: importe("0.00"),
      tributos: importe("0.00"),
      alicuotas: [{ alicuota: "21", base: importe("100.00"), iva: importe("21.00") }],
    },
    asociado: null,
    ...cambios,
  };
}

export class EmisionFalsa implements EmisionElectronica {
  /** Cada pedido de autorización que se le hizo al adaptador, en orden (también los no enviados). */
  readonly pedidos: SolicitudDeAutorizacion[] = [];
  /** Cada consulta de un número, en orden. */
  readonly consultas: {
    puntoDeVenta: PuntoDeVentaParaEmision;
    tipo: TipoDeComprobante;
    numero: bigint;
  }[] = [];
  /** Con `true`, `ultimoAutorizado` responde que el servicio no está disponible. */
  servicioCaido = false;
  /** Con `true`, `consultar` responde `CONSULTA_FALLIDA` (la consulta no pudo hacerse). */
  consultaCaida = false;

  private readonly ultimos = new Map<string, bigint>();
  private readonly registros = new Map<string, Registro>();
  private readonly guiones: GuionConDetalle[] = [];
  private readonly ultimoInicial: bigint;
  private readonly decidir: Decidir;

  constructor(opciones: OpcionesDeEmisionFalsa = {}) {
    this.ultimoInicial = opciones.ultimoInicial ?? 0n;
    this.decidir = opciones.decidir ?? (() => "AUTORIZA");
  }

  /** Los próximos pedidos terminan así, en orden; después manda `decidir`. */
  programar(...guiones: (Guion | GuionConDetalle)[]): void {
    this.guiones.push(...guiones.map(comoDetalle));
  }

  /** Fija el último número autorizado de una serie (para simular un desfase). */
  fijarUltimo(pv: PuntoDeVentaParaEmision, tipo: TipoDeComprobante, numero: bigint): void {
    this.ultimos.set(clave(pv, tipo), numero);
  }

  private ultimo(pv: PuntoDeVentaParaEmision, tipo: TipoDeComprobante): bigint {
    return this.ultimos.get(clave(pv, tipo)) ?? this.ultimoInicial;
  }

  ultimoAutorizado(
    pv: PuntoDeVentaParaEmision,
    tipo: TipoDeComprobante,
  ): Promise<Resultado<bigint, ErrorDeEmision>> {
    if (this.servicioCaido) {
      return Promise.resolve(
        err({ codigo: "SERVICIO_NO_DISPONIBLE", detalle: "servicio caído (falso)" }),
      );
    }
    return Promise.resolve(ok(this.ultimo(pv, tipo)));
  }

  autorizar(solicitud: SolicitudDeAutorizacion): Promise<ResultadoDeAutorizacionArca> {
    this.pedidos.push(solicitud);
    const id = clave(solicitud.puntoDeVenta, solicitud.tipo);
    const programado = this.guiones[0];
    const elegido = programado ?? comoDetalle(this.decidir(solicitud));
    // Lo que no salió nunca llega: no mira la secuencia ni cambia nada en ARCA.
    if (elegido.guion === "NO_ENVIADO") {
      if (programado !== undefined) this.guiones.shift();
      return Promise.resolve({ tipo: "NO_ENVIADO", motivo: "no salió (falso)" });
    }
    const ultimo = this.ultimo(solicitud.puntoDeVenta, solicitud.tipo);
    if (solicitud.numero !== ultimo + 1n) {
      return Promise.resolve({
        tipo: "RECHAZADO",
        errores: [
          {
            codigo: CODIGO_FUERA_DE_SECUENCIA,
            texto: `numeración fuera de secuencia: se esperaba ${ultimo + 1n}`,
          },
        ],
        observaciones: [],
      });
    }
    if (programado !== undefined) this.guiones.shift();
    const { guion } = elegido;
    if (guion === "RECHAZA") {
      return Promise.resolve({
        tipo: "RECHAZADO",
        errores: elegido.errores ?? [
          { codigo: CODIGO_DE_RECHAZO_DEL_FALSO, texto: "rechazado (falso)" },
        ],
        observaciones: elegido.observaciones ?? [],
      });
    }
    if (guion === "INCIERTO") {
      return Promise.resolve({ tipo: "INCIERTO", motivo: "sin respuesta (falso)" });
    }
    this.ultimos.set(id, solicitud.numero);
    const codigo = `CAE-${solicitud.puntoDeVenta.cuit}-${solicitud.puntoDeVenta.numero}-${solicitud.numero}`;
    const vence = fecha("2099-12-31");
    const datos =
      guion === "AUTORIZA_CON_OTROS_DATOS"
        ? datosDeOtroSistema(solicitud)
        : datosRegistrados(solicitud);
    this.registros.set(claveDeNumero(solicitud.puntoDeVenta, solicitud.tipo, solicitud.numero), {
      datos,
      codigo,
      vence,
    });
    if (guion === "AUTORIZA_Y_SE_CAE" || guion === "AUTORIZA_CON_OTROS_DATOS") {
      return Promise.resolve({
        tipo: "INCIERTO",
        motivo:
          guion === "AUTORIZA_Y_SE_CAE"
            ? "autorizó y se cayó (falso)"
            : "sin respuesta; otro sistema usó el número (falso)",
      });
    }
    return Promise.resolve({
      tipo: "AUTORIZADO",
      codigo,
      vence,
      fecha: solicitud.fecha,
      observaciones: elegido.observaciones ?? [],
    });
  }

  consultar(
    pv: PuntoDeVentaParaEmision,
    tipo: TipoDeComprobante,
    numero: bigint,
  ): Promise<ResultadoDeConsulta> {
    this.consultas.push({ puntoDeVenta: pv, tipo, numero });
    if (this.consultaCaida) {
      return Promise.resolve({ tipo: "CONSULTA_FALLIDA", detalle: "consulta caída (falso)" });
    }
    const registro = this.registros.get(claveDeNumero(pv, tipo, numero));
    if (registro !== undefined) {
      return Promise.resolve({
        tipo: "ENCONTRADO",
        datos: registro.datos,
        codigo: registro.codigo,
        vence: registro.vence,
      });
    }
    // Un número que ARCA ya pasó pero que este falso no autorizó (se fijó el último a mano) lo emitió otro.
    if (numero >= 1n && numero <= this.ultimo(pv, tipo)) {
      return Promise.resolve({
        tipo: "ENCONTRADO",
        datos: datosDeUnNumeroAjeno(pv, tipo, numero),
        codigo: `CAE-AJENO-${numero}`,
        vence: fecha("2099-12-31"),
      });
    }
    return Promise.resolve({ tipo: "NO_ENCONTRADO" });
  }
}

/**
 * Una función `decidir` al azar, repetible con la semilla: `pesos` dice cuánto pesa cada guion
 * (los que no figuran, nada). Generador mulberry32.
 */
export function guionAlAzar(
  semilla: number,
  pesos: Readonly<Partial<Record<Guion, number>>>,
): Decidir {
  let estado = semilla >>> 0;
  const siguiente = (): number => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const opciones = (Object.entries(pesos) as [Guion, number][]).filter(([, peso]) => peso > 0);
  const total = opciones.reduce((suma, [, peso]) => suma + peso, 0);
  const ultima = opciones.at(-1);
  if (ultima === undefined) throw new RangeError("guionAlAzar: sin pesos");
  return () => {
    let punto = siguiente() * total;
    for (const [guion, peso] of opciones) {
      if (punto < peso) return guion;
      punto -= peso;
    }
    return ultima[0];
  };
}
