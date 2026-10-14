import { createHash } from "node:crypto";
import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import type { TipoDeComprobante } from "../dominio/comprobante-emitido";
import type {
  ResultadoDeAutorizacionArca,
  ResultadoDeConsulta,
} from "../dominio/estados-de-comprobante";
import type { ComprobanteId } from "../dominio/identificadores";
import type { OperacionDeIntento } from "../persistencia/repositorio-de-intentos";
import type { TiemposLimite } from "./contrato-de-facturacion";
import type {
  EmisionElectronica,
  ErrorDeEmision,
  PuntoDeVentaParaEmision,
  SolicitudDeAutorizacion,
} from "./emision-electronica";

/**
 * Las llamadas al servicio de emisión desde los casos de uso de facturación, siempre FUERA de una transacción
 * (ADR-007) y con tiempo límite PROPIO (§B.5.4): un adaptador que no vuelve, o que lanza, no deja al trabajo
 * colgado ni lo hace reintentar a ciegas. Lo que no se sabe se trata como no sabido:
 *  - autorizar: `INCIERTO` (pudo haber llegado: NUNCA se reenvía, se consulta);
 *  - consultar: `CONSULTA_FALLIDA` (se reintenta en la próxima reconciliación);
 *  - último autorizado: `SERVICIO_NO_DISPONIBLE`.
 * Los motivos no llevan el texto de la excepción: podría traer la credencial del adaptador.
 */

/** La llamada, o lo que se decide si no vuelve a tiempo o lanza. El temporizador no retiene el proceso. */
function conTiempoLimite<T>(
  llamada: () => Promise<T>,
  ms: number,
  siNoVuelve: (motivo: "TIEMPO_AGOTADO" | "FALLA") => T,
): Promise<T> {
  return new Promise<T>((resolver) => {
    let resuelto = false;
    const terminar = (valor: T) => {
      if (resuelto) return;
      resuelto = true;
      clearTimeout(temporizador);
      resolver(valor);
    };
    const temporizador = setTimeout(() => terminar(siNoVuelve("TIEMPO_AGOTADO")), ms);
    temporizador.unref();
    llamada().then(terminar, () => terminar(siNoVuelve("FALLA")));
  });
}

const motivoDe = (motivo: "TIEMPO_AGOTADO" | "FALLA", operacion: string, ms: number): string =>
  motivo === "TIEMPO_AGOTADO"
    ? `${operacion}: sin respuesta en ${ms} ms`
    : `${operacion}: el adaptador falló sin respuesta`;

export function autorizarConLimite(
  emision: EmisionElectronica,
  solicitud: SolicitudDeAutorizacion,
  tiempos: TiemposLimite,
): Promise<ResultadoDeAutorizacionArca> {
  return conTiempoLimite(
    () => emision.autorizar(solicitud),
    tiempos.autorizarEnMs,
    (motivo): ResultadoDeAutorizacionArca => ({
      tipo: "INCIERTO",
      motivo: motivoDe(motivo, "autorizar", tiempos.autorizarEnMs),
    }),
  );
}

export function consultarConLimite(
  emision: EmisionElectronica,
  puntoDeVenta: PuntoDeVentaParaEmision,
  tipo: TipoDeComprobante,
  numero: bigint,
  tiempos: TiemposLimite,
): Promise<ResultadoDeConsulta> {
  return conTiempoLimite(
    () => emision.consultar(puntoDeVenta, tipo, numero),
    tiempos.consultarEnMs,
    (motivo): ResultadoDeConsulta => ({
      tipo: "CONSULTA_FALLIDA",
      detalle: motivoDe(motivo, "consultar", tiempos.consultarEnMs),
    }),
  );
}

export function ultimoAutorizadoConLimite(
  emision: EmisionElectronica,
  puntoDeVenta: PuntoDeVentaParaEmision,
  tipo: TipoDeComprobante,
  tiempos: TiemposLimite,
): Promise<Resultado<bigint, ErrorDeEmision>> {
  return conTiempoLimite(
    () => emision.ultimoAutorizado(puntoDeVenta, tipo),
    tiempos.ultimoAutorizadoEnMs,
    (motivo): Resultado<bigint, ErrorDeEmision> =>
      err({
        codigo: "SERVICIO_NO_DISPONIBLE",
        detalle: motivoDe(motivo, "último autorizado", tiempos.ultimoAutorizadoEnMs),
      }),
  );
}

/** SHA-256 en hexadecimal de un texto. */
export const sha256 = (texto: string): string => createHash("sha256").update(texto).digest("hex");

/**
 * El id de un intento contra ARCA, derivado de lo que lo identifica (el comprobante, la operación, el número
 * y cuándo empezó): repetir la transacción que lo guarda (un conflicto serializable) da el mismo id y el
 * repositorio lo absorbe, sin un intento duplicado. Sin azar (los casos de uso no sortean nada).
 */
export function idDeIntento(
  comprobante: ComprobanteId,
  operacion: OperacionDeIntento,
  numero: bigint | null,
  iniciadoEn: Date,
): string {
  const h = sha256(
    JSON.stringify([comprobante, operacion, numero?.toString() ?? null, iniciadoEn.toISOString()]),
  );
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * La forma canónica de un valor armado por los casos de uso (objetos, listas, textos, números enteros,
 * `bigint`, booleanos y `null`): JSON con las claves ordenadas y los `bigint` como texto. Dos pedidos iguales
 * dan el mismo texto aunque sus campos vengan en otro orden. Lanza ante lo que JSON cambiaría en silencio.
 */
function canonico(valor: unknown): string {
  if (valor === null || typeof valor === "string" || typeof valor === "boolean") {
    return JSON.stringify(valor);
  }
  if (typeof valor === "bigint") return JSON.stringify(`${valor}n`);
  if (typeof valor === "number") {
    if (!Number.isSafeInteger(valor)) throw new RangeError("canonico: solo números enteros");
    return JSON.stringify(valor);
  }
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`;
  if (typeof valor === "object") {
    const pares = Object.entries(valor as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonico(v)}`);
    return `{${pares.join(",")}}`;
  }
  throw new RangeError(`canonico: valor no admitido (${typeof valor})`);
}

/** SHA-256 de la forma canónica: la huella de un pedido (la del comprobante, la de una solicitud a ARCA). */
export const huellaDe = (valor: unknown): string => sha256(canonico(valor));
