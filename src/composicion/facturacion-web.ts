import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import {
  prefijoDeValidacion,
  type ComprobanteId,
  type DetalleDeComprobante,
  type PaginaDeComprobantes,
} from "../modulos/fiscal/publico";
import type { SucursalId } from "../primitivas/identificadores/marca";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import { aRespuestaDeExcepcion, errorAPublico, type DependenciasDeRespuesta } from "./a-respuesta";
import {
  entradaDeCambiarAmbiente,
  entradaDeDescartar,
  entradaDeFactura,
  entradaDeListar,
  entradaDeNotaDeCredito,
  entradaDeNotaDeDebito,
  entradaDeReintentar,
  entradaDeResincronizar,
  entradaDeVerComprobante,
  type ErrorDeEntrada,
} from "./entradas-de-facturacion";
import {
  aRespuestaFiscal,
  traducirMensajeDeArca,
  type MensajeDeArcaParaLaPantalla,
} from "./errores-fiscales";
import type { Web } from "./web";

/**
 * Lo que hacen las acciones de facturación de la web (H7 facturación §B.4 y §C): emitir una factura, una nota de crédito
 * o de débito, descartar, reintentar, resincronizar una serie, cambiar el ambiente de un punto de venta, y listar y ver
 * comprobantes. Vive acá, y no en `apps/web`, para probarse con la base real sin levantar Next (como
 * `sesion-y-empresa.ts`): la acción del servidor resuelve el CONTEXTO (la persona, la empresa y la marca, de la
 * sesión, el host y la cookie validada) y se lo pasa; todo lo demás del pedido lo toma `entradas-de-facturacion.ts`.
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/fiscal-cableado-web.test.ts`):
 *  - **El servidor decide quién y dónde.** El `contexto` es lo único que dice la empresa y la persona; el pedido no
 *    puede traer otras. Cada caso de uso exige SU acción al guard dentro de su transacción: acá no se decide ningún permiso.
 *  - **Repetir no duplica.** Emitir lleva la clave de la pantalla (que es el id del comprobante): dos clics, o un reintento de
 *    red, con la misma clave dan el mismo comprobante (`yaExistia`). Descartar, reintentar, resincronizar y cambiar el
 *    ambiente se repiten con su regla natural (el estado ya cambiado: «ya estaba» o un error de negocio sin efecto).
 *  - **Todo resultado sale por `aRespuestaFiscal`** (ADR-016): sin error de persistencia, sin código técnico y sin
 *    texto crudo de ARCA; lo inesperado, con su referencia `PD-…`.
 *  - **Lo que se muestra es lo que la pantalla necesita**: el detalle de un comprobante no lleva el id del emisor ni
 *    quién lo creó, y lo que ARCA contestó va traducido.
 */

export type DependenciasDeFacturacionWeb = Readonly<{
  casosDeUso: () => ReturnType<Web["casosDeUsoDeFacturacion"]>;
  consultas: () => ReturnType<Web["consultasDeFacturacion"]>;
  respuesta: DependenciasDeRespuesta;
}>;

/** La entrada que no tiene la forma pedida, como error público (sin el valor recibido). */
const entradaInvalida = (
  d: DependenciasDeFacturacionWeb,
  error: ErrorDeEntrada,
): Respuesta<never> => ({ ok: false, error: errorAPublico(error, d.respuesta) });

/**
 * Lee el pedido, corre el caso de uso con el contexto del servidor y traduce el resultado. Una excepción (la base
 * caída, un defecto) sale sin detalle y con referencia.
 */
async function accion<E, S, D>(
  d: DependenciasDeFacturacionWeb,
  crudo: unknown,
  leer: (crudo: unknown) => Resultado<E, ErrorDeEntrada>,
  correr: (entrada: E) => Promise<Resultado<S, unknown>>,
  presentar: (salida: S) => D,
): Promise<Respuesta<D>> {
  const entrada = leer(crudo);
  if (!entrada.ok) return entradaInvalida(d, entrada.error);
  try {
    return aRespuestaFiscal(await correr(entrada.valor), d.respuesta, presentar);
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Emitir
// ---------------------------------------------------------------------------------------------------------------

export type ComprobanteEmitidoParaLaPantalla = Readonly<{
  comprobanteId: ComprobanteId;
  estado: string;
  tipo: string;
  /** Texto decimal (ADR-006). */
  total: string;
  /** `true`: la misma clave con el mismo pedido ya lo había creado; no se escribió nada. */
  yaExistia: boolean;
}>;

type SalidaDeEmitirDeLaWeb = Readonly<{
  comprobanteId: ComprobanteId;
  estado: string;
  tipo: string;
  total: string;
  yaExistia: boolean;
}>;

const presentarEmision = (s: SalidaDeEmitirDeLaWeb): ComprobanteEmitidoParaLaPantalla => ({
  comprobanteId: s.comprobanteId,
  estado: s.estado,
  tipo: s.tipo,
  total: s.total,
  yaExistia: s.yaExistia,
});

/** Una factura a mano (`comprobantes.emitir_manual`). */
export function emitirFactura(
  d: DependenciasDeFacturacionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<ComprobanteEmitidoParaLaPantalla>> {
  return accion(
    d,
    crudo,
    entradaDeFactura,
    (entrada) => d.casosDeUso().emitirComprobanteManual(contexto, entrada),
    presentarEmision,
  );
}

/** Una nota de crédito sobre un comprobante autorizado (`notas_de_credito.emitir`). */
export function emitirNotaDeCredito(
  d: DependenciasDeFacturacionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<ComprobanteEmitidoParaLaPantalla>> {
  return accion(
    d,
    crudo,
    entradaDeNotaDeCredito,
    (entrada) => d.casosDeUso().emitirNotaDeCredito(contexto, entrada),
    presentarEmision,
  );
}

/** Una nota de débito sobre un comprobante autorizado (`comprobantes.emitir_manual`). */
export function emitirNotaDeDebito(
  d: DependenciasDeFacturacionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<ComprobanteEmitidoParaLaPantalla>> {
  return accion(
    d,
    crudo,
    entradaDeNotaDeDebito,
    (entrada) => d.casosDeUso().emitirNotaDeDebito(contexto, entrada),
    presentarEmision,
  );
}

/**
 * Las claves de idempotencia de los trabajos de validación que un comprobante recién emitido deja encolados: la
 * primera (`fiscal.validar:<id>:1`). Con ellas la acción pide el intento inmediato (ADR-007) sin conocer la cola.
 */
export const clavesDeLaValidacionInicial = (comprobante: ComprobanteId): readonly string[] => [
  `${prefijoDeValidacion(comprobante)}1`,
];

// ---------------------------------------------------------------------------------------------------------------
// Descartar, reintentar, resincronizar, cambiar el ambiente
// ---------------------------------------------------------------------------------------------------------------

export function descartarComprobante(
  d: DependenciasDeFacturacionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaEstaba: boolean }>>> {
  return accion(
    d,
    crudo,
    entradaDeDescartar,
    (entrada) => d.casosDeUso().descartarComprobante(contexto, entrada),
    (s) => ({ yaEstaba: s.yaEstaba }),
  );
}

export function reintentarComprobante(
  d: DependenciasDeFacturacionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ encolado: boolean }>>> {
  return accion(
    d,
    crudo,
    entradaDeReintentar,
    (entrada) => d.casosDeUso().reintentarComprobante(contexto, entrada),
    (s) => ({ encolado: s.encolado }),
  );
}

export function resincronizarSerie(
  d: DependenciasDeFacturacionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ ultimoNumero: string; reencolados: number }>>> {
  return accion(
    d,
    crudo,
    entradaDeResincronizar,
    (entrada) => d.casosDeUso().resincronizarSerie(contexto, entrada),
    // Un número de comprobante viaja como texto: un `bigint` no se serializa a la pantalla.
    (s) => ({ ultimoNumero: s.ultimoNumero.toString(), reencolados: s.reencolados }),
  );
}

export function cambiarAmbienteDePuntoDeVenta(
  d: DependenciasDeFacturacionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaEstaba: boolean }>>> {
  return accion(
    d,
    crudo,
    entradaDeCambiarAmbiente,
    (entrada) => d.casosDeUso().cambiarAmbienteDePuntoDeVenta(contexto, entrada),
    (s) => ({ yaEstaba: s.yaEstaba }),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------------------------------------------

/**
 * El listado de comprobantes de UNA sucursal de la empresa (`comprobantes.ver`, D-18); `crudo` puede faltar.
 * `sucursalElegida` NO sale del pedido del navegador: la toma el servidor de su sesión (o es `null` si la persona todavía no
 * eligió) y la consulta la verifica contra el alcance antes de filtrar. Sin elegir y con varias a elegir, responde
 * `FISCAL_SUCURSAL_NO_ELEGIDA`; con una sola, la toma sola; fuera de alcance, `FISCAL_SUCURSAL_FUERA_DE_ALCANCE`.
 */
export function listarComprobantes(
  d: DependenciasDeFacturacionWeb,
  contexto: ContextoOperativo,
  sucursalElegida: SucursalId | null,
  crudo: unknown,
): Promise<Respuesta<PaginaDeComprobantes>> {
  return accion(
    d,
    crudo,
    entradaDeListar,
    (pedido) => d.consultas().listarComprobantes(contexto, { ...pedido, sucursalElegida }),
    // Lista blanca: la sucursal que usó el servidor (D-18) sale con su id, su nombre y si está abierta, y nada más.
    (pagina) => ({
      items: pagina.items,
      siguiente: pagina.siguiente,
      sucursal: {
        id: pagina.sucursal.id,
        nombre: pagina.sucursal.nombre,
        activa: pagina.sucursal.activa,
      },
    }),
  );
}

/**
 * Los puntos de venta de la sucursal, para el filtro «Punto de venta» del listado: el número (el formato de 5 dígitos lo pone la
 * pantalla) y si está activo (`false`: dado de baja, D-58).
 */
export type PuntosDeVentaParaLaPantalla = Readonly<{
  items: readonly Readonly<{ numero: number; activo: boolean }>[];
}>;

/**
 * Los puntos de venta ACTIVOS Y DADOS DE BAJA de UNA sucursal de la empresa (`comprobantes.ver`, D-6, D-18 y D-58), de menor a mayor número. La sucursal
 * se resuelve con la MISMA regla que el listado (D-34, D-36 y D-37) y por el servidor: `sucursalElegida` NO sale del pedido del
 * navegador sin más (la toma el servidor de su sesión, o es `null` si la persona todavía no eligió) y la consulta la verifica
 * contra el alcance de la persona, dentro de su transacción, antes de leer nada: un id ajeno, de otra empresa o mal formado es
 * `FISCAL_SUCURSAL_FUERA_DE_ALCANCE` y no devuelve ningún punto de venta. Sin elegir y con varias a elegir, `FISCAL_SUCURSAL_NO_ELEGIDA`.
 * Nunca trae puntos de venta de otra empresa ni de otra sucursal.
 */
export function listarPuntosDeVentaDeLaSucursal(
  d: DependenciasDeFacturacionWeb,
  contexto: ContextoOperativo,
  sucursalElegida: SucursalId | null,
): Promise<Respuesta<PuntosDeVentaParaLaPantalla>> {
  return accion(
    d,
    null,
    () => ok({ sucursalElegida }),
    (entrada) => d.consultas().listarPuntosDeVentaDeLaSucursal(contexto, entrada),
    (puntos) => ({
      items: puntos.items.map((punto) => ({ numero: punto.numero, activo: punto.activo })),
    }),
  );
}

/** Lo que la pantalla ve de lo último que contestó ARCA: el desenlace y cada mensaje en palabras del negocio. */
export type IntentoParaLaPantalla = Readonly<{
  operacion: NonNullable<DetalleDeComprobante["ultimoIntento"]>["operacion"];
  desenlace: NonNullable<DetalleDeComprobante["ultimoIntento"]>["desenlace"];
  iniciadoEn: string;
  mensajes: readonly MensajeDeArcaParaLaPantalla[];
}>;

/**
 * El detalle de un comprobante tal como lo ve la pantalla: sin el id del emisor ni quién lo creó, sin el id del origen,
 * y con lo que ARCA contestó traducido (el texto crudo de ARCA no sale). Es una lista blanca, campo por campo: lo que
 * se agregue después al detalle no sale a la pantalla sin decidirlo acá.
 */
export type DetalleParaLaPantalla = Readonly<{
  id: DetalleDeComprobante["id"];
  puntoDeVentaId: DetalleDeComprobante["puntoDeVentaId"];
  ambiente: DetalleDeComprobante["ambiente"];
  origenTipo: DetalleDeComprobante["origen"]["tipo"];
  clase: DetalleDeComprobante["clase"];
  tipo: DetalleDeComprobante["tipo"];
  concepto: DetalleDeComprobante["concepto"];
  servicio: DetalleDeComprobante["servicio"];
  modoDePrecio: DetalleDeComprobante["modoDePrecio"];
  estado: DetalleDeComprobante["estado"];
  envios: number;
  numero: string | null;
  fechaEmision: DetalleDeComprobante["fechaEmision"];
  cae: string | null;
  caeVence: DetalleDeComprobante["caeVence"];
  autorizadoEn: string | null;
  resueltoPor: DetalleDeComprobante["resueltoPor"];
  importes: DetalleDeComprobante["importes"];
  alicuotas: DetalleDeComprobante["alicuotas"];
  renglones: DetalleDeComprobante["renglones"];
  emisor: DetalleDeComprobante["emisor"];
  receptor: DetalleDeComprobante["receptor"];
  asociado: DetalleDeComprobante["asociado"];
  motivo: string | null;
  motivoDeDescarte: string | null;
  notasQueLoCitan: DetalleDeComprobante["notasQueLoCitan"];
  acreditado: DetalleDeComprobante["acreditado"];
  acreditacion: DetalleDeComprobante["acreditacion"];
  ultimoIntento: IntentoParaLaPantalla | null;
  serie: DetalleDeComprobante["serie"];
  creadoEn: string;
  version: number;
}>;

export function presentarDetalle(c: DetalleDeComprobante): DetalleParaLaPantalla {
  return {
    id: c.id,
    puntoDeVentaId: c.puntoDeVentaId,
    ambiente: c.ambiente,
    origenTipo: c.origen.tipo,
    clase: c.clase,
    tipo: c.tipo,
    concepto: c.concepto,
    servicio: c.servicio,
    modoDePrecio: c.modoDePrecio,
    estado: c.estado,
    envios: c.envios,
    numero: c.numero,
    fechaEmision: c.fechaEmision,
    cae: c.cae,
    caeVence: c.caeVence,
    autorizadoEn: c.autorizadoEn,
    resueltoPor: c.resueltoPor,
    importes: c.importes,
    alicuotas: c.alicuotas,
    renglones: c.renglones,
    emisor: c.emisor,
    receptor: c.receptor,
    asociado: c.asociado,
    motivo: c.motivo,
    motivoDeDescarte: c.motivoDeDescarte,
    notasQueLoCitan: c.notasQueLoCitan,
    acreditado: c.acreditado,
    acreditacion: c.acreditacion,
    ultimoIntento:
      c.ultimoIntento === null
        ? null
        : {
            operacion: c.ultimoIntento.operacion,
            desenlace: c.ultimoIntento.desenlace,
            iniciadoEn: c.ultimoIntento.iniciadoEn,
            mensajes: c.ultimoIntento.mensajes.map(traducirMensajeDeArca),
          },
    serie: c.serie,
    creadoEn: c.creadoEn,
    version: c.version,
  };
}

/** Un comprobante de la empresa, con todo lo que la pantalla de detalle necesita (`comprobantes.ver`). */
export function verComprobante(
  d: DependenciasDeFacturacionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<DetalleParaLaPantalla>> {
  return accion(
    d,
    crudo,
    entradaDeVerComprobante,
    (entrada) => d.consultas().verComprobante(contexto, entrada),
    presentarDetalle,
  );
}
