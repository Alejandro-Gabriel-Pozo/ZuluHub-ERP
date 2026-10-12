import type {
  EmisionElectronica,
  ErrorDeEmision,
  PuntoDeVentaParaEmision,
  SolicitudDeAutorizacion,
} from "../../src/modulos/fiscal/casos-de-uso/emision-electronica";
import type {
  ResultadoDeAutorizacion,
  TipoDeComprobante,
} from "../../src/modulos/fiscal/dominio/comprobante-emitido";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";

/**
 * Adaptador FALSO del puerto de emisión (spec H7 §B.8), solo para pruebas: no habla con ARCA.
 * Guarda en memoria el último número autorizado por (CUIT, punto de venta, tipo) y se programa por
 * pedido (`programar`) o con una función (`decidir`):
 *
 * - `AUTORIZA`: autoriza y avanza el último número;
 * - `RECHAZA`: rechaza sin avanzar;
 * - `INCIERTO`: responde incierto SIN autorizar (se perdió el pedido);
 * - `AUTORIZA_Y_SE_CAE`: autoriza (avanza el último número) pero responde incierto: «autorizó y se cayó».
 *
 * Como el servicio real, exige la secuencia: un número que no es el siguiente al último autorizado
 * se rechaza, sin consultar el guion.
 */
export type Guion = "AUTORIZA" | "RECHAZA" | "INCIERTO" | "AUTORIZA_Y_SE_CAE";

export type Decidir = (solicitud: SolicitudDeAutorizacion) => Guion;

export type OpcionesDeEmisionFalsa = Readonly<{
  /** El último número que ya tiene autorizado cada serie al empezar (por defecto 0). */
  ultimoInicial?: bigint;
  /** Qué hacer con un pedido cuando no quedan guiones programados (por defecto autoriza). */
  decidir?: Decidir;
}>;

const clave = (pv: PuntoDeVentaParaEmision, tipo: TipoDeComprobante) =>
  `${pv.cuit}|${pv.numero}|${tipo}`;

export class EmisionFalsa implements EmisionElectronica {
  /** Cada pedido de autorización recibido, en orden. */
  readonly pedidos: SolicitudDeAutorizacion[] = [];
  /** Con `true`, `ultimoAutorizado` responde que el servicio no está disponible. */
  servicioCaido = false;

  private readonly ultimos = new Map<string, bigint>();
  private readonly guiones: Guion[] = [];
  private readonly ultimoInicial: bigint;
  private readonly decidir: Decidir;

  constructor(opciones: OpcionesDeEmisionFalsa = {}) {
    this.ultimoInicial = opciones.ultimoInicial ?? 0n;
    this.decidir = opciones.decidir ?? (() => "AUTORIZA");
  }

  /** Los próximos pedidos terminan así, en orden; después manda `decidir`. */
  programar(...guiones: Guion[]): void {
    this.guiones.push(...guiones);
  }

  /** Fija el último número autorizado de una serie (para simular un desfase). */
  fijarUltimo(pv: PuntoDeVentaParaEmision, tipo: TipoDeComprobante, numero: bigint): void {
    this.ultimos.set(clave(pv, tipo), numero);
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
    return Promise.resolve(ok(this.ultimos.get(clave(pv, tipo)) ?? this.ultimoInicial));
  }

  autorizar(solicitud: SolicitudDeAutorizacion): Promise<ResultadoDeAutorizacion> {
    this.pedidos.push(solicitud);
    const id = clave(solicitud.puntoDeVenta, solicitud.tipo);
    const ultimo = this.ultimos.get(id) ?? this.ultimoInicial;
    if (solicitud.numero !== ultimo + 1n) {
      return Promise.resolve({
        tipo: "RECHAZADO",
        observaciones: [`numeración fuera de secuencia: se esperaba ${ultimo + 1n}`],
      });
    }
    const guion = this.guiones.shift() ?? this.decidir(solicitud);
    if (guion === "RECHAZA") {
      return Promise.resolve({ tipo: "RECHAZADO", observaciones: ["rechazado (falso)"] });
    }
    if (guion === "INCIERTO") return Promise.resolve({ tipo: "INCIERTO" });
    this.ultimos.set(id, solicitud.numero);
    if (guion === "AUTORIZA_Y_SE_CAE") return Promise.resolve({ tipo: "INCIERTO" });
    return Promise.resolve({
      tipo: "AUTORIZADO",
      codigo: `CAE-${solicitud.puntoDeVenta.cuit}-${solicitud.puntoDeVenta.numero}-${solicitud.numero}`,
      vence: "2099-12-31",
    });
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
