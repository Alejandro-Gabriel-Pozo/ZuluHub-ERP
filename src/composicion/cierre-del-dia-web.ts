import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import {
  cuentaAdmitidaPorMedio,
  TIPOS_DE_CUENTA,
  TIPOS_DE_MEDIO,
  type TipoDeCuenta,
  type TipoDeMedio,
} from "../modulos/caja/publico";
import type { EstadoConsultado, Severidad } from "../modulos/cierre/publico";
import { ARS } from "../primitivas/dinero/moneda";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import { FECHA_CIVIL_MINIMA } from "../primitivas/tiempo/fecha-civil-hasta-hoy";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import {
  entradaDeCerrarElDia,
  entradaDeCorregirElMedio,
  entradaDeDarElConforme,
  entradaDeDeclararElTotal,
  entradaDeJornadaDelCierre,
} from "./entradas-de-cierre";
import { accionDeCierre, correrYTraducir } from "./errores-de-cierre";
import type { Web } from "./web";

/**
 * La pantalla «Cierre del día» en la composición (X5; maqueta aceptada `cierre-del-dia.html`, tres pasos; `Pedernal-docs/11-especificaciones/conceptos/pantalla-cierre-del-dia.md`): LEER la
 * jornada con todo lo que muestra y las seis acciones (empezar el cierre, cancelarlo, corregir el medio de un cobro, declarar un total, dar el conforme general y cerrar el día).
 * Vive acá (no en `apps/web`) para probarse con la base real sin levantar Next: la acción del servidor resuelve el CONTEXTO (persona, empresa) y la SUCURSAL (la elegida en el
 * dispositivo y validada; llega como argumento, nunca del pedido del navegador), y esta capa une `cierre`, `caja`, `ventas` e `identidad` sin que se importen entre sí. Cada caso de uso
 * y cada consulta exige SU acción al guard dentro de su transacción: acá no se decide ningún permiso, y cada error sale por `errores-de-cierre.ts` (ADR-016).
 *
 * QUÉ JORNADA SE OPERA (decisión del orquestador, DDD:183, P1): la MÁS VIEJA que no está cerrada, con su fecha; si no hay ninguna, la de hoy (`jornadaDeHoy`). Entre las últimas 100
 * jornadas de la sucursal (el tope de `listarJornadas`): una anterior a esas 100 sin cerrar no se ve desde acá (SUPUESTO DEC-0512; costo de cambiarlo: pedir otro rango).
 *
 * TODO O NADA al leer: cualquier lectura que falle (el guard, un aporte que no respondió, un medio que no existe) hace fallar la pantalla entera con el error ya traducido; nunca se
 * muestra un día a medias. Las acciones que cambian datos con clave de idempotencia (corregir, declarar, conforme) reciben la clave del navegador y el caso de uso la hace valer;
 * empezar, cancelar y cerrar se repiten sin duplicar por el estado de la jornada y por el contenido del cierre (`repiteElCierre`).
 *
 * «QUIÉN» ES EL CORREO de la persona (DDD:186, 26A): se pide una vez, con `personasParaMostrar`, para quien cerró, reconoció, corrigió o registró un cobro. Una persona que la consulta
 * no devuelve queda sin nombre (la pantalla no muestra esa línea): nunca se inventa uno.
 */

export type DependenciasDeCierreWeb = Readonly<{
  casosDeCierre: () => Pick<
    ReturnType<Web["casosDeUsoDeCierre"]>,
    "iniciarAuditoria" | "cancelarAuditoria" | "cerrarJornada"
  >;
  consultasDeCierre: () => Pick<
    ReturnType<Web["consultasDeCierre"]>,
    "jornadaDeHoy" | "listarJornadas" | "estadoDeJornada" | "controlesDeLaJornada"
  >;
  casosDeCaja: () => Pick<
    ReturnType<Web["casosDeUsoDeCaja"]>,
    "corregirMedioDeCobro" | "declararTotal" | "darConformeGeneral"
  >;
  consultasDeCaja: () => Pick<
    ReturnType<Web["consultasDeCaja"]>,
    "cobrosDeLaJornada" | "conciliacionDeLaJornada" | "listarMediosDePago" | "listarCuentasDeCobro"
  >;
  consultasDeVentas: () => Pick<ReturnType<Web["consultasDeVentas"]>, "listarTickets">;
  consultasDeIdentidad: () => Pick<ReturnType<Web["consultasDeIdentidad"]>, "personasParaMostrar">;
  respuesta: DependenciasDeRespuesta;
}>;

export type ControlDelCierre = Readonly<{
  modulo: string;
  /** La clave del control del servidor (`caja.sesiones_sin_cerrar`): la pantalla la usa para elegir el texto aprobado. */
  clave: string;
  severidad: Severidad;
  cantidad: number;
  /** Solo en una jornada cerrada. */
  reconocido: boolean;
  /** El correo de quien lo reconoció (solo cerrada). */
  reconocidoPor: string | null;
  /** ISO UTC. */
  reconocidoEn: string | null;
  texto: string | null;
}>;

export type EstadoDeConteoDelCierre = "CONTADO" | "DECLARADO" | "CONFORME" | "SIN_DATO";

export type LineaDeConciliacionDelCierre = Readonly<{
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  medioTipo: string;
  medioNombre: string | null;
  cuentaNombre: string | null;
  /** Importes en ARS como texto decimal (ADR-006). */
  registrado: string;
  correcciones: string;
  declarado: string | null;
  estadoDeConteo: EstadoDeConteoDelCierre;
  diferencia: string | null;
}>;

export type CobradoContraTicketDelCierre = Readonly<{
  /** El número del ticket; `null` si ventas no lo devuelve para esta jornada (el cobro es de un ticket de otro día). */
  ticketNumero: number | null;
  diferencia: string;
}>;

export type CobroDelCierre = Readonly<{
  cobroId: string;
  importe: string;
  /** Medio y cuenta VIGENTES (tras las correcciones). */
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  medioTipo: string;
  medioNombre: string | null;
  cuentaNombre: string | null;
  registradoPor: string | null;
  /** La jornada está en cierre y quien mira puede corregir: la misma regla del caso de uso (la pantalla no decide). */
  correccionPosible: boolean;
  ultimaCorreccion: Readonly<{ por: string | null; en: string; motivo: string }> | null;
}>;

/** Un medio activo y las cuentas de cobro activas de la sucursal que admite: las opciones del diálogo «Corregir medio». */
export type MedioParaCorregir = Readonly<{
  medioDePagoId: string;
  tipo: string;
  nombre: string | null;
  cuentas: readonly Readonly<{ cuentaDeCobroId: string; nombre: string }>[];
}>;

export type CierreParaLaPantalla = Readonly<{
  /** `AAAA-MM-DD`: la jornada que se opera. */
  fechaDeNegocio: string;
  estado: EstadoConsultado;
  cerradaPor: string | null;
  cerradaEn: string | null;
  /** Lo que `cerrarJornada` vuelve a comparar: nada se cierra con algo que nadie vio. */
  huella: string;
  controles: readonly ControlDelCierre[];
  /** Solo con la jornada en cierre o cerrada. */
  conciliacion: Readonly<{
    enVivo: boolean;
    lineas: readonly LineaDeConciliacionDelCierre[];
    cobradoContraTicket: readonly CobradoContraTicketDelCierre[];
  }> | null;
  /** Solo con la jornada en cierre o cerrada: la primera página (hasta 100). */
  cobros: Readonly<{ cobros: readonly CobroDelCierre[]; hayMas: boolean }> | null;
  /** Solo con la jornada en cierre y algún cobro corregible. */
  medios: readonly MedioParaCorregir[];
}>;

/** Un rechazo de una lectura: corta la carga entera y sale traducido, nunca un día a medias. */
class Rechazo extends Error {
  constructor(readonly causa: unknown) {
    super("rechazo de una lectura del cierre");
  }
}

const exigir = <T>(resultado: Resultado<T, unknown>): T => {
  if (!resultado.ok) throw new Rechazo(resultado.error);
  return resultado.valor;
};

/** Un importe en ARS como texto decimal; otra moneda es un defecto (v1 solo pesos): lanza y sale como inesperado. */
const monto = (importe: Readonly<{ moneda: string; monto: string }>): string => {
  if (importe.moneda !== ARS) throw new RangeError("el cierre del día solo muestra pesos");
  return importe.monto;
};

const MAXIMO_DE_PERSONAS = 200;

const esTipoDeMedio = (tipo: string): tipo is TipoDeMedio =>
  (TIPOS_DE_MEDIO as readonly string[]).includes(tipo);
const esTipoDeCuenta = (tipo: string): tipo is TipoDeCuenta =>
  (TIPOS_DE_CUENTA as readonly string[]).includes(tipo);

/** Los correos de las personas pedidas, de a `MAXIMO_DE_PERSONAS` por consulta (el tope de la consulta). */
async function correosDe(
  d: DependenciasDeCierreWeb,
  contexto: ContextoOperativo,
  ids: ReadonlySet<string>,
): Promise<ReadonlyMap<string, string>> {
  const todos = [...ids];
  const correos = new Map<string, string>();
  for (let desde = 0; desde < todos.length; desde += MAXIMO_DE_PERSONAS) {
    const pagina = exigir(
      await d
        .consultasDeIdentidad()
        .personasParaMostrar(contexto, { ids: todos.slice(desde, desde + MAXIMO_DE_PERSONAS) }),
    );
    for (const [id, correo] of pagina) correos.set(String(id), correo);
  }
  return correos;
}

/** La jornada más vieja que no está cerrada entre las últimas 100, o la de hoy si no hay ninguna. */
async function jornadaAOperar(
  d: DependenciasDeCierreWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
): Promise<string> {
  const hoy = exigir(await d.consultasDeCierre().jornadaDeHoy(contexto, { sucursalId }));
  const lista = exigir(
    await d.consultasDeCierre().listarJornadas(contexto, {
      sucursalId,
      desde: FECHA_CIVIL_MINIMA,
      hasta: hoy.fechaDeNegocio,
    }),
  );
  // `AAAA-MM-DD` de ancho fijo: el orden del texto es el del calendario.
  const abiertas = lista.filter((j) => j.estado !== "CERRADA").map((j) => j.fechaDeNegocio);
  return abiertas.length === 0 ? hoy.fechaDeNegocio : abiertas.reduce((a, b) => (b < a ? b : a));
}

async function medios(
  d: DependenciasDeCierreWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
): Promise<readonly MedioParaCorregir[]> {
  const listaDeMedios = exigir(await d.consultasDeCaja().listarMediosDePago(contexto, {}));
  const listaDeCuentas = exigir(
    await d.consultasDeCaja().listarCuentasDeCobro(contexto, { sucursalId }),
  );
  return listaDeMedios.medios.flatMap((medio) => {
    // Lo que se PERMITE: un tipo de medio que el cierre conoce y que está activo; otro no se ofrece.
    if (!medio.activo || !esTipoDeMedio(medio.tipo)) return [];
    const tipoDeMedio = medio.tipo;
    return [
      {
        medioDePagoId: medio.id,
        tipo: medio.tipo,
        nombre: medio.nombre,
        cuentas: listaDeCuentas.cuentas
          .filter(
            (cuenta) =>
              cuenta.activa &&
              esTipoDeCuenta(cuenta.tipo) &&
              cuentaAdmitidaPorMedio(tipoDeMedio, cuenta.tipo),
          )
          .map((cuenta) => ({ cuentaDeCobroId: cuenta.id, nombre: cuenta.nombre })),
      },
    ];
  });
}

async function cargar(
  d: DependenciasDeCierreWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
): Promise<CierreParaLaPantalla> {
  const fechaDeNegocio = await jornadaAOperar(d, contexto, sucursalId);
  const entrada = { sucursalId, fechaDeNegocio };
  const [estadoLeido, controlesLeidos] = await Promise.all([
    d.consultasDeCierre().estadoDeJornada(contexto, entrada),
    d.consultasDeCierre().controlesDeLaJornada(contexto, entrada),
  ]);
  const jornada = exigir(estadoLeido);
  const controles = exigir(controlesLeidos);
  const conDetalle = jornada.estado === "EN_AUDITORIA" || jornada.estado === "CERRADA";

  const [conciliacionLeida, cobrosLeidos] = conDetalle
    ? await Promise.all([
        d.consultasDeCaja().conciliacionDeLaJornada(contexto, entrada),
        d.consultasDeCaja().cobrosDeLaJornada(contexto, entrada),
      ])
    : [null, null];
  const conciliacion = conciliacionLeida === null ? null : exigir(conciliacionLeida);
  const cobros = cobrosLeidos === null ? null : exigir(cobrosLeidos);

  // El número de cada ticket de «Cobrado contra el ticket»: se une con la lista de tickets de la jornada de ventas; sin esa fila, no hay nada que unir ni que pedir.
  const numerosDeTicket = new Map<string, number>();
  if (conciliacion !== null && conciliacion.cobradoContraTicket.length > 0) {
    const tickets = exigir(
      await d
        .consultasDeVentas()
        .listarTickets(contexto, { sucursalId, fechaNegocio: fechaDeNegocio }),
    );
    for (const ticket of tickets) numerosDeTicket.set(ticket.ticketId, ticket.numero);
  }

  const paraCorregir =
    jornada.estado === "EN_AUDITORIA" &&
    cobros !== null &&
    cobros.cobros.some((c) => c.correccionPosible)
      ? await medios(d, contexto, sucursalId)
      : [];

  const personas = new Set<string>();
  const sumar = (id: string | null): void => {
    if (id !== null) personas.add(id);
  };
  sumar(jornada.cerradaPor);
  for (const control of controles.controles) sumar(control.reconocidoPor ?? null);
  for (const cobro of cobros?.cobros ?? []) {
    sumar(cobro.registradoPor);
    for (const correccion of cobro.correcciones) sumar(correccion.corregidaPor);
  }
  const correos = await correosDe(d, contexto, personas);
  const quien = (id: string | null): string | null =>
    id === null ? null : (correos.get(id) ?? null);

  return {
    fechaDeNegocio,
    estado: jornada.estado,
    cerradaPor: quien(jornada.cerradaPor),
    cerradaEn: jornada.cerradaEn === null ? null : jornada.cerradaEn.toISOString(),
    huella: controles.huella,
    controles: controles.controles.map((c) => ({
      modulo: c.modulo,
      clave: c.clave,
      severidad: c.severidad,
      cantidad: c.cantidad,
      reconocido: c.reconocido === true,
      reconocidoPor: quien(c.reconocidoPor ?? null),
      reconocidoEn:
        c.reconocidoEn === undefined || c.reconocidoEn === null
          ? null
          : c.reconocidoEn.toISOString(),
      texto: c.texto ?? null,
    })),
    conciliacion:
      conciliacion === null
        ? null
        : {
            enVivo: conciliacion.enVivo,
            lineas: conciliacion.lineas.map((l) => ({
              medioDePagoId: l.medioDePagoId,
              cuentaDeCobroId: l.cuentaDeCobroId,
              medioTipo: l.medioTipo,
              medioNombre: l.medioNombre,
              cuentaNombre: l.cuentaNombre,
              registrado: monto(l.registrado),
              correcciones: monto(l.correcciones),
              declarado: l.declarado === null ? null : monto(l.declarado),
              estadoDeConteo: l.estadoDeConteo,
              diferencia: l.diferencia === null ? null : monto(l.diferencia),
            })),
            cobradoContraTicket: conciliacion.cobradoContraTicket.map((t) => ({
              ticketNumero: numerosDeTicket.get(t.ticketId) ?? null,
              diferencia: monto(t.diferencia),
            })),
          },
    cobros:
      cobros === null
        ? null
        : {
            cobros: cobros.cobros.map((c) => {
              const ultima = c.correcciones[c.correcciones.length - 1];
              return {
                cobroId: c.cobroId,
                importe: monto(c.importe),
                medioDePagoId: c.vigente.medioDePagoId,
                cuentaDeCobroId: c.vigente.cuentaDeCobroId,
                medioTipo: c.vigente.medioTipo,
                medioNombre: c.vigente.medioNombre,
                cuentaNombre: c.vigente.cuentaNombre,
                registradoPor: quien(c.registradoPor),
                correccionPosible: c.correccionPosible,
                ultimaCorreccion:
                  ultima === undefined
                    ? null
                    : {
                        por: quien(ultima.corregidaPor),
                        en: ultima.corregidaEn,
                        motivo: ultima.motivo,
                      },
              };
            }),
            hayMas: cobros.siguiente !== null,
          },
    medios: paraCorregir,
  };
}

/** La jornada que se opera y todo lo que la pantalla muestra. Es una LECTURA: no escribe ni audita. Todo o nada. */
export function cargarElCierre(
  d: DependenciasDeCierreWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
): Promise<Respuesta<CierreParaLaPantalla>> {
  return correrYTraducir(
    d.respuesta,
    async () => {
      try {
        return ok(await cargar(d, contexto, sucursalId));
      } catch (excepcion) {
        if (excepcion instanceof Rechazo) return err(excepcion.causa);
        throw excepcion;
      }
    },
    (cierre) => cierre,
  );
}

/** «Empezar el cierre»: con impedimentos el caso de uso lo rechaza y la pantalla vuelve a leer para mostrar lo que impide. */
export function empezarElCierre(
  d: DependenciasDeCierreWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaEstabaEnAuditoria: boolean }>>> {
  return accionDeCierre(
    d.respuesta,
    crudo,
    entradaDeJornadaDelCierre,
    (entrada) =>
      d
        .casosDeCierre()
        .iniciarAuditoria(contexto, { sucursalId, fechaDeNegocio: entrada.fechaDeNegocio }),
    (salida) => ({ yaEstabaEnAuditoria: salida.yaEstabaEnAuditoria }),
  );
}

export function cancelarElCierre(
  d: DependenciasDeCierreWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaEstabaAbierta: boolean }>>> {
  return accionDeCierre(
    d.respuesta,
    crudo,
    entradaDeJornadaDelCierre,
    (entrada) =>
      d
        .casosDeCierre()
        .cancelarAuditoria(contexto, { sucursalId, fechaDeNegocio: entrada.fechaDeNegocio }),
    (salida) => ({ yaEstabaAbierta: salida.yaEstabaAbierta }),
  );
}

/**
 * «Cerrar el día»: lo reconocido viaja con lo que se vio (`huellaVista`); si cambió algo, `CIERRE_CONTROLES_CAMBIARON` y la pantalla vuelve a leer. La observación general del
 * día no tiene campo en la maqueta: se manda `null` (pregunta pendiente al dueño). Se repite sin duplicar: el mismo pedido sobre una jornada ya cerrada es el mismo cierre.
 */
export function cerrarElDia(
  d: DependenciasDeCierreWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaEstabaCerrada: boolean }>>> {
  return accionDeCierre(
    d.respuesta,
    crudo,
    entradaDeCerrarElDia,
    (entrada) =>
      d.casosDeCierre().cerrarJornada(contexto, {
        sucursalId,
        fechaDeNegocio: entrada.fechaDeNegocio,
        huellaVista: entrada.huellaVista,
        reconocimientos: entrada.reconocimientos,
        observacion: null,
      }),
    (salida) => ({ yaEstabaCerrada: salida.yaEstabaCerrada }),
  );
}

/** «Corregir medio» de un cobro: la sucursal sale del cobro (el caso de uso la valida contra el alcance), no de la pantalla. */
export function corregirElMedio(
  d: DependenciasDeCierreWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaExistia: boolean }>>> {
  return accionDeCierre(
    d.respuesta,
    crudo,
    entradaDeCorregirElMedio,
    (entrada) => d.casosDeCaja().corregirMedioDeCobro(contexto, entrada),
    (salida) => ({ yaExistia: salida.yaExistia }),
  );
}

/** Declarar el total de un medio y cuenta distintos del efectivo (el efectivo sale de los billetes). */
export function declararElTotal(
  d: DependenciasDeCierreWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaExistia: boolean }>>> {
  return accionDeCierre(
    d.respuesta,
    crudo,
    entradaDeDeclararElTotal,
    (entrada) => d.casosDeCaja().declararTotal(contexto, { ...entrada, sucursalId }),
    (salida) => ({ yaExistia: salida.yaExistia }),
  );
}

/** El «Conforme general» de la jornada (uno solo por jornada). */
export function darElConforme(
  d: DependenciasDeCierreWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaExistia: boolean }>>> {
  return accionDeCierre(
    d.respuesta,
    crudo,
    entradaDeDarElConforme,
    (entrada) => d.casosDeCaja().darConformeGeneral(contexto, { ...entrada, sucursalId }),
    (salida) => ({ yaExistia: salida.yaExistia }),
  );
}
