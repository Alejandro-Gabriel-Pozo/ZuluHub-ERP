import {
  CODIGO_DE_TIPO_DE_COMPROBANTE,
  claseDeComprobante,
  type EmisionElectronica,
  type EmisorId,
  type ErrorDeEmision,
  type PuntoDeVentaParaEmision,
  type ProveedorDeEmision,
  type ResultadoDeAutorizacionArca,
  type ResultadoDeConsulta,
  type SolicitudDeAutorizacion,
  type TipoDeComprobante,
} from "../../modulos/fiscal/publico";
import type { EmpresaId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import { Secreto } from "../../primitivas/secreto/secreto";
import type { AlmacenDeTickets, TicketDeAcceso } from "../../puertos/almacen-de-tickets";
import type {
  AmbienteDeArca,
  CredencialesDeEmisor,
  CredencialesDescifradas,
  ErrorDeCredenciales,
} from "../../puertos/credenciales-de-emisor";
import type { VerificacionDeAutorizacion } from "../../puertos/verificacion-de-autorizacion";
import {
  clasificarAutorizacion,
  clasificarConsulta,
  clasificarDummy,
  clasificarLoginCms,
  clasificarParametros,
  clasificarUltimoAutorizado,
  type EstadoDelServicio,
} from "./clasificar";
import type { TablaDeParametros } from "./codigos";
import {
  DESTINOS_DE_ARCA,
  ESPERA_TRAS_ACCESO_YA_EMITIDO_EN_MS,
  MARGEN_DEL_TICKET_EN_MS,
  SERVICIO_DE_ARCA,
  TIEMPO_LIMITE_DE_LOGIN_EN_MS,
  TIEMPO_LIMITE_DE_WSFE_EN_MS,
} from "./constantes";
import { firmarTra } from "./firmar-cms";
import type { FilaDeParametro } from "./leer-respuestas";
import { armarTra, pedidoLoginCms } from "./pedidos-de-wsaa";
import {
  accionDeWsfe,
  pedidoFECAESolicitar,
  pedidoFECompConsultar,
  pedidoFECompUltimoAutorizado,
  pedidoFEDummy,
  pedidoFEParamGet,
  type AutenticacionDeWsfe,
} from "./pedidos-de-wsfe";
import type { RespuestaDeTransporte, Transporte } from "./tipos";
import { aSolicitudDeWsfe } from "./traducir";

/**
 * El adaptador REAL del puerto de emisión (spec H7 facturación §B.5, tramo F8): habla con WSAA y WSFE v4.8
 * de ARCA. Uno por (empresa, emisor, ambiente): cada cliente es dueño de su certificado y cada ambiente es otro
 * ARCA. Lo arma la composición con `crearProveedorDeEmisionArca`.
 *
 * Las reglas que lo ordenan, y su chequeo (las pruebas de `adaptador-arca.test.ts`):
 *  1. **Una escritura se manda UNA vez.** `FECAESolicitar` sale a lo sumo una vez por llamada, sin reintento ni
 *     reenvío con otro ticket: lo que no se sabe es `INCIERTO` y se resuelve consultando (el reenvío de un
 *     número ya autorizado devuelve 10016, no el CAE, y el cierre ya no se puede reconstruir).
 *  2. **El ticket de acceso se reutiliza.** Se lee el guardado y solo se pide uno nuevo si no hay uno vigente
 *     (con 5 minutos de margen). Ante `coe.alreadyAuthenticated` NO se insiste: se espera y se relee el ticket
 *     guardado, una vez. El ticket recién emitido se guarda ANTES de usarse (si el proceso muriera en el medio,
 *     ese certificado quedaría sin poder pedir otro por horas).
 *  3. **Todo con tiempo límite propio** que cubre también la lectura completa del cuerpo.
 *  4. **Nada secreto sale.** El token, la firma y el PEM no aparecen en ningún resultado (motivo, detalle,
 *     mensaje): los textos se arman solo con códigos, textos fijos y los `Msg` de ARCA saneados, y el texto de
 *     una excepción no se usa nunca.
 *  5. **La primera llamada exitosa verifica la autorización** (D-42, 2026-10-29): cuando una operación de WSFE que usa
 *     el ticket vuelve con éxito, se anota en el certificado que pidió ese ticket que ARCA lo aceptó para la CUIT del
 *     emisor. Anotarlo nunca cambia lo que se devuelve: si falla, se ignora y la próxima llamada exitosa lo intenta de
 *     nuevo. Fuente: `h7-facturacion.md` §B.6.2 («`autorizacion_verificada_en` se fija en el primer `loginCms` +
 *     `FEDummy`/`FECompUltimoAutorizado` exitoso»). SUPUESTO (pendiente de confirmar con el dueño): también cuentan
 *     `FECAESolicitar` autorizado, `FECompConsultar` encontrado y `FEParamGet*` exitoso, que usan el mismo ticket y la
 *     misma CUIT representada; `FEDummy` NO cuenta porque no usa ticket y no prueba nada de la autorización. Revertirlo
 *     es borrar tres líneas de `aceptado(...)`.
 *
 * No lanza: toda falla es un valor del puerto. Los desenlaces son los de `clasificar.ts`.
 */

export type DependenciasDeArca = Readonly<{
  /** Las credenciales (certificado y clave) de cada (emisor, ambiente), descifradas solo en memoria (F7). */
  credenciales: CredencialesDeEmisor;
  /** El ticket de acceso guardado y compartido entre procesos (F7). */
  tickets: AlmacenDeTickets;
  transporte: Transporte;
  /** La hora: del TRA, de la vigencia del ticket. El adaptador no lee el reloj por su cuenta. */
  reloj: Readonly<{ ahora(): Date }>;
  /** Espera `ms` milisegundos (tras `coe.alreadyAuthenticated`). En pruebas, instantánea. */
  esperar(ms: number): Promise<void>;
  /** Anota que ARCA aceptó al certificado, la primera vez que una llamada con su ticket sale bien (D-42). */
  verificacion: VerificacionDeAutorizacion;
  /** Por defecto, la firma CMS real; las pruebas la reemplazan para forzar un fallo. */
  firmar?: typeof firmarTra;
}>;

/** El puerto de emisión y, además, lo que la operación de ARCA ofrece fuera de él (salud y tablas de códigos). */
export interface AdaptadorDeArca extends EmisionElectronica {
  /** `FEDummy`: la salud de los tres servidores de ARCA; no necesita ticket. */
  estadoDelServicio(): Promise<Resultado<EstadoDelServicio, ErrorDeEmision>>;
  /** Una de las seis tablas `FEParamGet*`: todas sus filas, cada campo como texto. */
  parametros(
    cuit: string,
    tabla: TablaDeParametros,
  ): Promise<Resultado<readonly FilaDeParametro[], ErrorDeEmision>>;
}

/**
 * Por qué no hay credencial, con un texto fijo (nunca el de una excepción): las tres causas de la credencial
 * misma son `SIN_CREDENCIAL` (hay que cargar o corregir el certificado); un error de persistencia es que el
 * servicio no está disponible (se reintenta).
 */
function errorDeCredenciales(error: ErrorDeCredenciales): ErrorDeEmision {
  switch (error) {
    case "SIN_CERTIFICADO_VIGENTE":
      return {
        codigo: "SIN_CREDENCIAL",
        detalle: "el emisor no tiene un certificado vigente en este ambiente",
      };
    case "CERTIFICADO_VENCIDO":
      return { codigo: "SIN_CREDENCIAL", detalle: "el certificado del emisor está vencido" };
    case "CLAVE_ILEGIBLE":
      return {
        codigo: "SIN_CREDENCIAL",
        detalle: "la clave del certificado del emisor no se pudo leer",
      };
    default:
      return {
        codigo: "SERVICIO_NO_DISPONIBLE",
        detalle: "no se pudieron obtener las credenciales del emisor",
      };
  }
}

const textoDeError = (e: ErrorDeEmision): string => `${e.codigo}: ${e.detalle}`;

export function crearEmisionArca(
  dependencias: DependenciasDeArca,
  empresa: EmpresaId,
  emisor: EmisorId,
  ambiente: AmbienteDeArca,
): AdaptadorDeArca {
  const { credenciales, tickets, transporte, reloj, esperar, verificacion } = dependencias;
  const firmar = dependencias.firmar ?? firmarTra;
  const destinos = DESTINOS_DE_ARCA[ambiente];

  /** Un POST con el tiempo límite dado. Si el transporte lanzara, es una respuesta que no se sabe cómo terminó. */
  async function enviar(
    url: string,
    accionSoap: string,
    cuerpo: string,
    limiteEnMs: number,
  ): Promise<RespuestaDeTransporte> {
    try {
      return await transporte({ url, accionSoap, cuerpo, limiteEnMs });
    } catch {
      return { tipo: "SIN_RESPUESTA", motivo: "FALLA_DEL_TRANSPORTE" };
    }
  }

  const vigente = (ticket: TicketDeAcceso): boolean =>
    ticket.venceEn.getTime() - MARGEN_DEL_TICKET_EN_MS > reloj.ahora().getTime();

  /** Pide un ticket nuevo a WSAA con la credencial del emisor, y lo envuelve como lo guarda el almacén. */
  async function pedirTicket(
    credencial: CredencialesDescifradas,
  ): Promise<Resultado<TicketDeAcceso, ErrorDeEmision>> {
    const ahora = reloj.ahora();
    let cms: string;
    try {
      cms = await firmar(armarTra(ahora, SERVICIO_DE_ARCA), credencial, ahora);
    } catch {
      return err({
        codigo: "SIN_CREDENCIAL",
        detalle: "la credencial del emisor no sirve para firmar el pedido de acceso",
      });
    }
    const ticket = clasificarLoginCms(
      await enviar(destinos.wsaa, "", pedidoLoginCms(cms), TIEMPO_LIMITE_DE_LOGIN_EN_MS),
    );
    if (!ticket.ok) return ticket;
    return ok({
      certificadoId: credencial.certificadoId,
      token: new Secreto(ticket.valor.token),
      firma: new Secreto(ticket.valor.sign),
      generadoEn: ahora,
      venceEn: ticket.valor.venceEn,
    });
  }

  /**
   * El ticket para operar: el guardado si está vigente; si no, uno nuevo, que se guarda enseguida. Ante
   * `coe.alreadyAuthenticated` (otro proceso lo acaba de pedir) se espera y se relee el guardado, sin insistir.
   * Si el almacén falla al LEER no se sabe si hay un ticket vigente: pedir otro dejaría al certificado bloqueado
   * por horas (`coe.alreadyAuthenticated`), así que no se pide: el servicio no está disponible.
   */
  async function obtenerTicket(): Promise<Resultado<TicketDeAcceso, ErrorDeEmision>> {
    const guardado = await tickets.leer(empresa, emisor, ambiente, SERVICIO_DE_ARCA);
    if (!guardado.ok) {
      return err({
        codigo: "SERVICIO_NO_DISPONIBLE",
        detalle: "no se pudo leer el ticket de acceso guardado",
      });
    }
    if (guardado.valor !== null && vigente(guardado.valor)) return ok(guardado.valor);
    const credencial = await credenciales.obtener(empresa, emisor, ambiente);
    if (!credencial.ok) return err(errorDeCredenciales(credencial.error));
    const nuevo = await pedirTicket(credencial.valor);
    if (nuevo.ok) {
      // Si no se pudiera guardar (falla o error del almacén), igual se usa: tirarlo dejaría al certificado sin
      // poder pedir otro por horas.
      try {
        await tickets.guardar(empresa, emisor, ambiente, SERVICIO_DE_ARCA, nuevo.valor);
      } catch {
        // Sin guardar, el ticket igual se usa; el próximo pedido intentará de nuevo con lo que haya.
      }
      return nuevo;
    }
    if (nuevo.error.codigo !== "ACCESO_YA_EMITIDO") return nuevo;
    await esperar(ESPERA_TRAS_ACCESO_YA_EMITIDO_EN_MS);
    const releido = await tickets.leer(empresa, emisor, ambiente, SERVICIO_DE_ARCA);
    return releido.ok && releido.valor !== null && vigente(releido.valor)
      ? ok(releido.valor)
      : nuevo;
  }

  /** El ticket para armar un pedido a WSFE (con la CUIT del emisor) y el certificado que lo pidió. */
  type SesionDeWsfe = Readonly<{ autenticacion: AutenticacionDeWsfe; certificadoId: string }>;

  /**
   * El ticket con la CUIT del emisor, o el error de emisión. Una falla del almacén o de las credenciales no
   * lanza (y su texto no se usa: podría traer una cadena de conexión): es que no hay ticket.
   */
  async function conAutenticacion(cuit: string): Promise<Resultado<SesionDeWsfe, ErrorDeEmision>> {
    try {
      const ticket = await obtenerTicket();
      if (!ticket.ok) return ticket;
      // Los secretos se revelan acá, en el último punto posible: solo para armar el pedido a WSFE.
      return ok({
        autenticacion: {
          token: ticket.valor.token.revelar(),
          sign: ticket.valor.firma.revelar(),
          cuit,
        },
        certificadoId: ticket.valor.certificadoId,
      });
    } catch {
      return err({
        codigo: "SERVICIO_NO_DISPONIBLE",
        detalle: "no se pudo obtener el ticket de acceso",
      });
    }
  }

  /**
   * ARCA aceptó el ticket del certificado para la CUIT del emisor: se anota (una sola vez, la base lo garantiza). No
   * lanza y no cambia lo que la operación devuelve: si no se pudo anotar, la próxima llamada exitosa lo intenta.
   */
  async function aceptado(sesion: SesionDeWsfe): Promise<void> {
    try {
      await verificacion.anotar(empresa, sesion.certificadoId);
    } catch {
      // Un fallo de la base al anotar no es un fallo de ARCA.
    }
  }

  const llamarWsfe = (operacion: string, cuerpo: string): Promise<RespuestaDeTransporte> =>
    enviar(destinos.wsfe, accionDeWsfe(operacion), cuerpo, TIEMPO_LIMITE_DE_WSFE_EN_MS);

  return {
    async ultimoAutorizado(
      puntoDeVenta: PuntoDeVentaParaEmision,
      tipo: TipoDeComprobante,
    ): Promise<Resultado<bigint, ErrorDeEmision>> {
      const auth = await conAutenticacion(puntoDeVenta.cuit);
      if (!auth.ok) return auth;
      const tipoDeComprobante = CODIGO_DE_TIPO_DE_COMPROBANTE[tipo];
      const ultimo = clasificarUltimoAutorizado(
        await llamarWsfe(
          "FECompUltimoAutorizado",
          pedidoFECompUltimoAutorizado(
            auth.valor.autenticacion,
            puntoDeVenta.numero,
            tipoDeComprobante,
          ),
        ),
        { puntoDeVenta: puntoDeVenta.numero, tipoDeComprobante },
      );
      if (ultimo.ok) await aceptado(auth.valor);
      return ultimo;
    },

    async autorizar(solicitud: SolicitudDeAutorizacion): Promise<ResultadoDeAutorizacionArca> {
      const auth = await conAutenticacion(solicitud.puntoDeVenta.cuit);
      // Sin ticket no se pide nada a WSFE: seguro que no salió.
      if (!auth.ok) {
        return { tipo: "NO_ENVIADO", motivo: `sin ticket de acceso (${textoDeError(auth.error)})` };
      }
      let cuerpo: string;
      try {
        cuerpo = pedidoFECAESolicitar(auth.valor.autenticacion, aSolicitudDeWsfe(solicitud));
      } catch {
        return {
          tipo: "NO_ENVIADO",
          motivo: "el pedido no se pudo traducir a los valores de WSFE",
        };
      }
      const resultado = clasificarAutorizacion(await llamarWsfe("FECAESolicitar", cuerpo), {
        numero: solicitud.numero,
        fecha: solicitud.fecha,
      });
      if (resultado.tipo === "AUTORIZADO") await aceptado(auth.valor);
      return resultado;
    },

    async consultar(
      puntoDeVenta: PuntoDeVentaParaEmision,
      tipo: TipoDeComprobante,
      numero: bigint,
    ): Promise<ResultadoDeConsulta> {
      const auth = await conAutenticacion(puntoDeVenta.cuit);
      if (!auth.ok) {
        return {
          tipo: "CONSULTA_FALLIDA",
          detalle: `sin ticket de acceso (${textoDeError(auth.error)})`,
        };
      }
      const tipoDeComprobante = CODIGO_DE_TIPO_DE_COMPROBANTE[tipo];
      const consulta = clasificarConsulta(
        await llamarWsfe(
          "FECompConsultar",
          pedidoFECompConsultar(
            auth.valor.autenticacion,
            puntoDeVenta.numero,
            tipoDeComprobante,
            String(numero),
          ),
        ),
        {
          cuit: puntoDeVenta.cuit,
          puntoDeVenta: puntoDeVenta.numero,
          tipoDeComprobante,
          numero,
          esNota: claseDeComprobante(tipo) !== "FACTURA",
        },
      );
      if (consulta.tipo === "ENCONTRADO") await aceptado(auth.valor);
      return consulta;
    },

    async estadoDelServicio(): Promise<Resultado<EstadoDelServicio, ErrorDeEmision>> {
      return clasificarDummy(await llamarWsfe("FEDummy", pedidoFEDummy()));
    },

    async parametros(
      cuit: string,
      tabla: TablaDeParametros,
    ): Promise<Resultado<readonly FilaDeParametro[], ErrorDeEmision>> {
      const auth = await conAutenticacion(cuit);
      if (!auth.ok) return auth;
      const filas = clasificarParametros(
        await llamarWsfe(`FEParamGet${tabla}`, pedidoFEParamGet(auth.valor.autenticacion, tabla)),
        `FEParamGet${tabla}`,
      );
      if (filas.ok) await aceptado(auth.valor);
      return filas;
    },
  };
}

/** El proveedor que arma la composición: un adaptador por (empresa, emisor, ambiente). */
export function crearProveedorDeEmisionArca(dependencias: DependenciasDeArca): ProveedorDeEmision {
  return {
    para: (empresa, emisor, ambiente) => crearEmisionArca(dependencias, empresa, emisor, ambiente),
  };
}
