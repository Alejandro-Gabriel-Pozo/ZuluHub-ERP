import type {
  DatosConsultados,
  ErrorDeEmision,
  Mensaje,
  ResultadoDeAutorizacionArca,
  ResultadoDeConsulta,
} from "../../modulos/fiscal/publico";
import { importeDesdeTexto, type Importe } from "../../primitivas/dinero/importe";
import { ARS } from "../../primitivas/dinero/moneda";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../primitivas/tiempo/fecha-civil";
import { alicuotaDeId } from "./codigos";
import {
  codigoDeFallaDeWsaa,
  codigosComoTexto,
  errorDeFallaDeWsaa,
  hayCategoria,
  soloSinDatos,
} from "./errores-de-arca";
import {
  leerAutorizacion,
  leerConsulta,
  leerDummy,
  leerFallaSoap,
  leerTabla,
  leerTicketDeLoginCms,
  leerUltimoAutorizado,
  type AlicuotaLeida,
  type AsociadoLeido,
  type AutorizacionLeida,
  type ComprobanteConsultadoLeido,
  type DetalleDeAutorizacionLeido,
  type FilaDeParametro,
} from "./leer-respuestas";
import { textoSeguro } from "./saneamiento";
import type { RespuestaDeTransporte } from "./tipos";

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
// Conversiones de lo que viene de ARCA como texto
// ---------------------------------------------------------------------------------------------------------------

/** `yyyymmdd` (como lo manda ARCA) a fecha civil, o `null` si no es una fecha real. */
function fechaDeArca(texto: string): FechaCivil | null {
  const partes = /^([0-9]{4})([0-9]{2})([0-9]{2})$/.exec(texto);
  if (partes === null) return null;
  const fecha = fechaCivilDesdeTexto(`${partes[1]}-${partes[2]}-${partes[3]}`);
  return fecha.ok ? fecha.valor : null;
}

/**
 * Un importe de ARCA (`231.5`, `0`, `100`, `10.50`) a `Importe` en pesos, o `null` si no es un decimal no
 * negativo con a lo sumo dos decimales significativos. Nunca pasa por `number`. Los ceros de más
 * (`10.500`) se descartan: no cambian el valor.
 */
function importeDeArca(texto: string): Importe | null {
  const partes = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(texto);
  if (partes === null) return null;
  const decimales = (partes[2] ?? "").replace(/0+$/, "");
  if (decimales.length > 2) return null;
  return importeDesdeTexto(ARS, decimales === "" ? `${partes[1]}` : `${partes[1]}.${decimales}`);
}

/** Un entero sin signo de hasta `digitos` dígitos como `bigint`, o `null`. */
function enteroDeArca(texto: string, digitos: number): bigint | null {
  return new RegExp(`^[0-9]{1,${digitos}}$`).test(texto) ? BigInt(texto) : null;
}

/** Un código de ARCA (tipo, punto de venta, documento) como `number`: nunca es un importe. */
function codigoDeArca(texto: string, digitos: number): number | null {
  const entero = enteroDeArca(texto, digitos);
  return entero === null ? null : Number(entero);
}

/** El CAE: 14 dígitos, como TEXTO (puede empezar con 0), como lo exige `comprobante_autorizado_ck`. */
const FORMA_DEL_CAE = /^[0-9]{14}$/;

// ---------------------------------------------------------------------------------------------------------------
// Lo común: ¿hay una respuesta completa que leer?
// ---------------------------------------------------------------------------------------------------------------

type CuerpoOFalla =
  | Readonly<{ ok: true; cuerpo: string }>
  /** `llego`: ¿puede el pedido haber llegado a ARCA? (`false` solo si la conexión nunca se abrió). */
  | Readonly<{ ok: false; llego: boolean; motivo: string }>;

/** Por qué no hay respuesta completa que leer. */
function motivoDeSinRespuesta(
  respuesta: Exclude<RespuestaDeTransporte, { tipo: "RESPUESTA" }>,
): string {
  return respuesta.tipo === "NO_SALIO"
    ? `no salió: ${textoSeguro(respuesta.motivo)}`
    : `sin respuesta completa: ${textoSeguro(respuesta.motivo)}`;
}

/** Solo una respuesta HTTP 200 completa se lee; todo lo demás es una falla, con su motivo. */
function cuerpoDe(respuesta: RespuestaDeTransporte): CuerpoOFalla {
  if (respuesta.tipo !== "RESPUESTA") {
    return {
      ok: false,
      llego: respuesta.tipo === "SIN_RESPUESTA",
      motivo: motivoDeSinRespuesta(respuesta),
    };
  }
  return respuesta.estadoHttp === 200
    ? { ok: true, cuerpo: respuesta.cuerpo }
    : { ok: false, llego: true, motivo: `HTTP ${respuesta.estadoHttp}` };
}

const RESPUESTA_ILEGIBLE = "la respuesta de ARCA no se pudo leer";

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
// FECompConsultar
// ---------------------------------------------------------------------------------------------------------------

/** Lo que se consultó: la respuesta tiene que ser de ESE número, y una nota tiene que traer su asociado. */
export type EsperadoDeConsulta = Readonly<{
  /** La CUIT del emisor: es la del comprobante asociado de una nota (una nota no asocia otro emisor). */
  cuit: string;
  puntoDeVenta: number;
  tipoDeComprobante: number;
  numero: bigint;
  esNota: boolean;
}>;

const consultaFallida = (detalle: string): ResultadoDeConsulta => ({
  tipo: "CONSULTA_FALLIDA",
  detalle,
});

/** Falta o no se entiende un campo de lo registrado: no se sabe qué tiene ARCA, se reintenta. */
const campoInvalido = (campo: string): ResultadoDeConsulta =>
  consultaFallida(`la respuesta de ARCA no trae un ${campo} válido`);

function alicuotasConsultadas(
  leidas: readonly AlicuotaLeida[],
): DatosConsultados["alicuotas"] | string {
  const alicuotas: DatosConsultados["alicuotas"][number][] = [];
  for (const leida of leidas) {
    const alicuota = alicuotaDeId(leida.id);
    const base = importeDeArca(leida.base);
    const iva = importeDeArca(leida.importe);
    if (alicuota === null || base === null || iva === null) return "Iva";
    alicuotas.push({ alicuota, base, iva });
  }
  return alicuotas;
}

function asociadoConsultado(
  leidos: readonly AsociadoLeido[],
  esperado: EsperadoDeConsulta,
): DatosConsultados["asociado"] | string {
  const [leido] = leidos;
  if (leido === undefined) return esperado.esNota ? "CbtesAsoc" : null;
  const tipo = codigoDeArca(leido.tipoDeComprobante, 3);
  const puntoDeVenta = codigoDeArca(leido.puntoDeVenta, 5);
  const numero = enteroDeArca(leido.numero, 8);
  // ARCA puede no repetir la CUIT: una nota solo asocia comprobantes de su propio emisor (§B.3.5).
  const cuit = leido.cuit === "" ? esperado.cuit : leido.cuit;
  const fecha = fechaDeArca(leido.fecha);
  if (
    leidos.length > 1 ||
    tipo === null ||
    puntoDeVenta === null ||
    numero === null ||
    !/^[0-9]{11}$/.test(cuit) ||
    fecha === null
  ) {
    return "CbtesAsoc";
  }
  return { tipoDeComprobante: tipo, puntoDeVenta, numero, cuit, fecha };
}

/** Lo registrado en ARCA como `DatosConsultados`, o el nombre del primer campo que no sirve. */
function datosConsultados(
  c: ComprobanteConsultadoLeido,
  esperado: EsperadoDeConsulta,
): DatosConsultados | string {
  const puntoDeVenta = codigoDeArca(c.puntoDeVenta, 5);
  const tipoDeComprobante = codigoDeArca(c.tipoDeComprobante, 3);
  const numero = enteroDeArca(c.desde, 8);
  const hasta = enteroDeArca(c.hasta, 8);
  const fecha = fechaDeArca(c.fecha);
  const tipoDeDocumento = codigoDeArca(c.tipoDeDocumento, 2);
  const numeroDeDocumento = enteroDeArca(c.numeroDeDocumento, 11);
  const total = importeDeArca(c.total);
  const neto = importeDeArca(c.neto);
  const iva = importeDeArca(c.iva);
  if (puntoDeVenta !== esperado.puntoDeVenta) return "PtoVta";
  if (tipoDeComprobante !== esperado.tipoDeComprobante) return "CbteTipo";
  if (numero !== esperado.numero || hasta !== esperado.numero) return "CbteDesde";
  if (fecha === null) return "CbteFch";
  if (tipoDeDocumento === null) return "DocTipo";
  if (numeroDeDocumento === null) return "DocNro";
  if (!/^[A-Z0-9]{3}$/.test(c.moneda)) return "MonId";
  if (total === null) return "ImpTotal";
  if (neto === null) return "ImpNeto";
  if (iva === null) return "ImpIVA";
  const alicuotas = alicuotasConsultadas(c.alicuotas);
  if (typeof alicuotas === "string") return alicuotas;
  const asociado = asociadoConsultado(c.asociados, esperado);
  if (typeof asociado === "string") return asociado;
  return {
    tipoDeComprobante,
    puntoDeVenta,
    numero,
    fecha,
    tipoDeDocumento,
    numeroDeDocumento,
    moneda: c.moneda,
    total,
    neto,
    iva,
    alicuotas,
    asociado,
  };
}

/**
 * Lo que ARCA tiene de un número. `NO_ENCONTRADO` es solo el 602 (y solo el 602): un 601, un 500 o
 * cualquier otra falla es `CONSULTA_FALLIDA`, que se reintenta. Un registro que no es de ese número, que no
 * es `A` o cuyo CAE no tiene 14 dígitos tampoco se da por encontrado.
 */
export function clasificarConsulta(
  respuesta: RespuestaDeTransporte,
  esperado: EsperadoDeConsulta,
): ResultadoDeConsulta {
  const cuerpo = cuerpoDe(respuesta);
  if (!cuerpo.ok) return consultaFallida(cuerpo.motivo);
  const leida = leerConsulta(cuerpo.cuerpo);
  if (leida === null) return consultaFallida(RESPUESTA_ILEGIBLE);
  const { errores, comprobante } = leida;
  if (comprobante === null) {
    if (soloSinDatos(errores)) return { tipo: "NO_ENCONTRADO" };
    return consultaFallida(
      errores.length === 0
        ? "ARCA respondió sin datos ni errores"
        : `ARCA respondió con errores (${codigosComoTexto(errores)})`,
    );
  }
  const datos = datosConsultados(comprobante, esperado);
  if (typeof datos === "string") return campoInvalido(datos);
  const vence = fechaDeArca(comprobante.vencimiento);
  if (comprobante.resultado !== "A") return campoInvalido("Resultado");
  if (!FORMA_DEL_CAE.test(comprobante.codigo)) {
    return campoInvalido("CodAutorizacion");
  }
  if (vence === null) return campoInvalido("FchVto");
  return { tipo: "ENCONTRADO", datos, codigo: comprobante.codigo, vence };
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
