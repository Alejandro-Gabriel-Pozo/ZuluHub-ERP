import type {
  ErrorDeEmision,
  Mensaje,
  ResultadoDeAutorizacionArca,
} from "../../modulos/fiscal/publico";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../primitivas/tiempo/fecha-civil";
import { clasificarConsulta, type EsperadoDeConsulta } from "./clasificar-consulta";
import { codigoDeArca, enteroDeArca, FORMA_DEL_CAE, fechaDeArca } from "./conversiones-de-arca";
import { cuerpoDe, motivoDeSinRespuesta, RESPUESTA_ILEGIBLE } from "./cuerpo-de-respuesta";
import {
  codigoDeFallaDeWsaa,
  codigosComoTexto,
  errorDeFallaDeWsaa,
  hayCategoria,
} from "./errores-de-arca";
import {
  leerAutorizacion,
  leerDummy,
  leerFallaSoap,
  leerTabla,
  leerTicketDeLoginCms,
  leerUltimoAutorizado,
  type AutorizacionLeida,
  type DetalleDeAutorizacionLeido,
  type FilaDeParametro,
} from "./leer-respuestas";
import { textoSeguro } from "./saneamiento";
import type { RespuestaDeTransporte } from "./tipos";

// La consulta vive en su archivo; se reexporta para que `clasificar` siga siendo la puerta de la clasificación.
export { clasificarConsulta, type EsperadoDeConsulta };

/**
 * Clasificación de lo que respondió ARCA (spec H7 facturación §B.5.4): de una respuesta del transporte a lo
 * que entiende el dominio. Valor puro. La regla que ordena todo, y que cada función cumple:
 *
 *   **Lo que no se sabe, no se sabe.** Solo es `NO_ENVIADO` lo que SEGURO no llegó a ARCA (la conexión no se
 *   abrió, o ARCA contestó que no aceptó el token); solo es `RECHAZADO` lo que ARCA rechazó (`Resultado = R`);
 *   solo es `NO_ENCONTRADO` el código 602. Todo lo demás de una escritura (tiempo agotado, corte, HTTP que no
 *   es 200, respuesta ilegible o parcial, una cantidad de detalles distinta de 1, un `A` sin CAE válido)
 *   es `INCIERTO`, y un `INCIERTO` NUNCA se reenvía: se consulta primero.
 *
 * Los motivos que devuelve llevan solo códigos y textos fijos, y los `Msg` de ARCA ya saneados: ni un pedazo
 * del pedido, ni la respuesta, ni el texto de una excepción.
 */

// ---------------------------------------------------------------------------------------------------------------
// FECAESolicitar
// ---------------------------------------------------------------------------------------------------------------

/** Lo que se pidió autorizar: contra esto se comprueba que la respuesta sea la de ESTE comprobante. */
export type EsperadoDeAutorizacion = Readonly<{ numero: bigint; fecha: FechaCivil }>;

const incierto = (motivo: string): ResultadoDeAutorizacionArca => ({ tipo: "INCIERTO", motivo });

/** Un detalle `A`: autoriza solo con el número pedido y un CAE y un vencimiento válidos; si no, es `INCIERTO`. */
function autorizado(
  detalle: DetalleDeAutorizacionLeido,
  esperado: EsperadoDeAutorizacion,
): ResultadoDeAutorizacionArca {
  const numero = String(esperado.numero);
  if (detalle.desde !== numero || detalle.hasta !== numero) {
    return incierto("ARCA respondió por otro número de comprobante");
  }
  const vence = fechaDeArca(detalle.vencimiento);
  if (!FORMA_DEL_CAE.test(detalle.codigo) || vence === null) {
    return incierto("ARCA respondió A sin un CAE y un vencimiento válidos");
  }
  return {
    tipo: "AUTORIZADO",
    codigo: detalle.codigo,
    vence,
    fecha: fechaDeArca(detalle.fecha) ?? esperado.fecha,
    observaciones: detalle.observaciones,
  };
}

function clasificarAutorizacionLeida(
  leida: AutorizacionLeida,
  esperado: EsperadoDeAutorizacion,
): ResultadoDeAutorizacionArca {
  const { errores, cabecera, detalles } = leida;
  if (cabecera === null) return incierto("la respuesta de ARCA no trae la cabecera");
  if (detalles.length > 1) {
    return incierto(`ARCA respondió ${detalles.length} detalles para un solo comprobante`);
  }
  const detalle = detalles[0];
  if (detalle === undefined) {
    // Sin detalle: solo lo que ARCA dice con todas las letras es definitivo.
    if (hayCategoria(errores, "TOKEN")) {
      return {
        tipo: "NO_ENVIADO",
        motivo: `ARCA no aceptó el token (error ${codigosComoTexto(errores)})`,
      };
    }
    if (hayCategoria(errores, "INFRAESTRUCTURA")) {
      return incierto(`error interno de ARCA (${codigosComoTexto(errores)})`);
    }
    if (cabecera.resultado === "R" && errores.length > 0) {
      return { tipo: "RECHAZADO", errores, observaciones: [] };
    }
    return incierto("ARCA respondió sin detalle del comprobante");
  }
  if (cabecera.resultado === "A" && detalle.resultado === "A") return autorizado(detalle, esperado);
  if (cabecera.resultado === "R" && detalle.resultado === "R") {
    return { tipo: "RECHAZADO", errores, observaciones: detalle.observaciones };
  }
  return incierto("ARCA respondió un resultado que no es ni autorizado ni rechazado");
}

/**
 * Qué pasó con un pedido de autorización. Esta función es la que impide el reenvío a ciegas: de todo lo que
 * puede salir mal, solo es `NO_ENVIADO` lo que seguro no llegó.
 */
export function clasificarAutorizacion(
  respuesta: RespuestaDeTransporte,
  esperado: EsperadoDeAutorizacion,
): ResultadoDeAutorizacionArca {
  const cuerpo = cuerpoDe(respuesta);
  if (!cuerpo.ok) {
    return cuerpo.llego ? incierto(cuerpo.motivo) : { tipo: "NO_ENVIADO", motivo: cuerpo.motivo };
  }
  const leida = leerAutorizacion(cuerpo.cuerpo);
  return leida === null
    ? incierto(RESPUESTA_ILEGIBLE)
    : clasificarAutorizacionLeida(leida, esperado);
}

// ---------------------------------------------------------------------------------------------------------------
// FECompUltimoAutorizado
// ---------------------------------------------------------------------------------------------------------------

export type EsperadoDeUltimoAutorizado = Readonly<{
  puntoDeVenta: number;
  tipoDeComprobante: number;
}>;

const noDisponible = (detalle: string): Resultado<never, ErrorDeEmision> =>
  err({ codigo: "SERVICIO_NO_DISPONIBLE", detalle });

/**
 * Los errores de una operación de WSFE que no es una escritura, como `ErrorDeEmision`: 600 y 601 (el token
 * no sirve para esa CUIT) son una autorización del servicio que falta; cualquier otro error, el servicio no
 * está disponible. `null` si no hay errores.
 */
function errorDeEmisionDe(errores: readonly Mensaje[]): ErrorDeEmision | null {
  if (errores.length === 0) return null;
  if (hayCategoria(errores, "TOKEN")) {
    return {
      codigo: "AUTORIZACION_DEL_SERVICIO_FALTANTE",
      detalle: `ARCA no aceptó el token (error ${codigosComoTexto(errores)})`,
    };
  }
  return {
    codigo: "SERVICIO_NO_DISPONIBLE",
    detalle: `ARCA respondió con errores (${codigosComoTexto(errores)})`,
  };
}

export function clasificarUltimoAutorizado(
  respuesta: RespuestaDeTransporte,
  esperado: EsperadoDeUltimoAutorizado,
): Resultado<bigint, ErrorDeEmision> {
  const cuerpo = cuerpoDe(respuesta);
  if (!cuerpo.ok) return noDisponible(cuerpo.motivo);
  const leida = leerUltimoAutorizado(cuerpo.cuerpo);
  if (leida === null) return noDisponible(RESPUESTA_ILEGIBLE);
  const error = errorDeEmisionDe(leida.errores);
  if (error !== null) return err(error);
  const { puntoDeVenta, tipoDeComprobante, numero } = leida;
  const ultimo = enteroDeArca(numero, 8);
  if (
    ultimo === null ||
    codigoDeArca(puntoDeVenta, 5) !== esperado.puntoDeVenta ||
    codigoDeArca(tipoDeComprobante, 3) !== esperado.tipoDeComprobante
  ) {
    return noDisponible("ARCA respondió un último autorizado que no es el pedido");
  }
  return ok(ultimo);
}

// ---------------------------------------------------------------------------------------------------------------
// loginCms (WSAA)
// ---------------------------------------------------------------------------------------------------------------

/** El ticket de acceso de WSAA, con su vencimiento ya como instante. */
export type TicketDeWsaa = Readonly<{ token: string; sign: string; venceEn: Date }>;

/**
 * Qué pasó con el pedido del ticket. Una falla SOAP de WSAA se mira SIEMPRE, con el estado HTTP que tenga
 * (WSAA contesta 500): `coe.alreadyAuthenticated` es `ACCESO_YA_EMITIDO` (no se insiste), `coe.notAuthorized`
 * es `AUTORIZACION_DEL_SERVICIO_FALTANTE`, `cms.*` es `SIN_CREDENCIAL`, y el resto, servicio no disponible.
 */
export function clasificarLoginCms(
  respuesta: RespuestaDeTransporte,
): Resultado<TicketDeWsaa, ErrorDeEmision> {
  if (respuesta.tipo !== "RESPUESTA") return noDisponible(motivoDeSinRespuesta(respuesta));
  const falla = leerFallaSoap(respuesta.cuerpo);
  if (falla !== null) {
    return err({
      codigo: errorDeFallaDeWsaa(falla.codigo),
      detalle: `WSAA ${codigoDeFallaDeWsaa(falla.codigo)}: ${falla.texto}`,
    });
  }
  const cuerpo = cuerpoDe(respuesta);
  if (!cuerpo.ok) return noDisponible(cuerpo.motivo);
  const ticket = leerTicketDeLoginCms(cuerpo.cuerpo);
  if (ticket === null) return noDisponible("la respuesta de WSAA no se pudo leer");
  const venceEn = new Date(ticket.vencimiento);
  if (Number.isNaN(venceEn.getTime()))
    return noDisponible("el vencimiento del ticket no es una fecha");
  return ok({ token: ticket.token, sign: ticket.sign, venceEn });
}

// ---------------------------------------------------------------------------------------------------------------
// FEParamGet* y FEDummy
// ---------------------------------------------------------------------------------------------------------------

/**
 * Las filas de una tabla de `FEParamGet<tabla>`: todos los hijos de `ResultGet`. Una tabla sin errores y sin
 * filas es una respuesta válida pero sospechosa de vacía: se devuelve como vacía, quien la pide decide.
 */
export function clasificarParametros(
  respuesta: RespuestaDeTransporte,
  operacion: string,
): Resultado<readonly FilaDeParametro[], ErrorDeEmision> {
  const cuerpo = cuerpoDe(respuesta);
  if (!cuerpo.ok) return noDisponible(cuerpo.motivo);
  const leida = leerTabla(cuerpo.cuerpo, operacion);
  if (leida === null) return noDisponible(RESPUESTA_ILEGIBLE);
  const error = errorDeEmisionDe(leida.errores);
  return error === null ? ok(leida.filas) : err(error);
}

/** El estado de los tres servidores de ARCA que informa `FEDummy`. */
export type EstadoDelServicio = Readonly<{
  aplicacion: string;
  baseDeDatos: string;
  autenticacion: string;
}>;

export function clasificarDummy(
  respuesta: RespuestaDeTransporte,
): Resultado<EstadoDelServicio, ErrorDeEmision> {
  const cuerpo = cuerpoDe(respuesta);
  if (!cuerpo.ok) return noDisponible(cuerpo.motivo);
  const leida = leerDummy(cuerpo.cuerpo);
  if (leida === null) return noDisponible(RESPUESTA_ILEGIBLE);
  const { aplicacion, baseDeDatos, autenticacion } = leida;
  if (aplicacion === "" || baseDeDatos === "" || autenticacion === "") {
    return noDisponible(RESPUESTA_ILEGIBLE);
  }
  return ok({
    aplicacion: textoSeguro(aplicacion),
    baseDeDatos: textoSeguro(baseDeDatos),
    autenticacion: textoSeguro(autenticacion),
  });
}
