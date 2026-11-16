import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import {
  cuentaAdmitidaPorMedio,
  TIPOS_DE_CUENTA,
  TIPOS_DE_MEDIO,
  type TipoDeCuenta,
  type TipoDeMedio,
} from "../modulos/caja/publico";
import type {
  CierreParaLaPantalla,
  MedioParaCorregir,
} from "../capacidades/experiencia/vista-del-cierre";
import { ARS } from "../primitivas/dinero/moneda";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import { FECHA_CIVIL_MINIMA } from "../primitivas/tiempo/fecha-civil-hasta-hoy";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { correrYTraducir } from "./errores-de-cierre";
import type { Web } from "./web";

/**
 * LEER «Cierre del día» (X5; maqueta aceptada `cierre-del-dia.html`, tres pasos; `Pedernal-docs/11-especificaciones/conceptos/pantalla-cierre-del-dia.md`): la jornada con todo lo que muestra
 * la pantalla. Vive acá (no en `apps/web`) para probarse con la base real sin levantar Next: la página resuelve el CONTEXTO (persona, empresa) y la SUCURSAL (la elegida en el dispositivo y
 * validada; llega como argumento, nunca del pedido del navegador), y esta capa une `cierre`, `caja`, `ventas` e `identidad` sin que se importen entre sí. Cada consulta exige SU acción al guard
 * dentro de su transacción: acá no se decide ningún permiso, y cada error sale por `errores-de-cierre.ts` (ADR-016). Las acciones del cierre están en `cierre-del-dia-web.ts`.
 *
 * QUÉ JORNADA SE OPERA (decisión del orquestador, DDD:183, P1): la MÁS VIEJA que no está cerrada, con su fecha; si no hay ninguna, la de hoy (`jornadaDeHoy`). Entre las últimas 100
 * jornadas de la sucursal (el tope de `listarJornadas`): una anterior a esas 100 sin cerrar no se ve desde acá (SUPUESTO DEC-0512; costo de cambiarlo: pedir otro rango).
 *
 * TODO O NADA al leer: cualquier lectura que falle (el guard, un aporte que no respondió, un medio que no existe) hace fallar la pantalla entera con el error ya traducido; nunca se
 * muestra un día a medias.
 *
 * «QUIÉN» ES EL CORREO de la persona (DDD:186, 26A): se pide una vez, con `personasParaMostrar`, para quien cerró, reconoció, corrigió o registró un cobro. Una persona que la consulta
 * no devuelve queda sin nombre (la pantalla no muestra esa línea): nunca se inventa uno.
 */

export type DependenciasDeLaLecturaDelCierre = Readonly<{
  consultasDeCierre: () => Pick<
    ReturnType<Web["consultasDeCierre"]>,
    "jornadaDeHoy" | "listarJornadas" | "estadoDeJornada" | "controlesDeLaJornada"
  >;
  consultasDeCaja: () => Pick<
    ReturnType<Web["consultasDeCaja"]>,
    "cobrosDeLaJornada" | "conciliacionDeLaJornada" | "listarMediosDePago" | "listarCuentasDeCobro"
  >;
  consultasDeVentas: () => Pick<ReturnType<Web["consultasDeVentas"]>, "listarTickets">;
  consultasDeIdentidad: () => Pick<ReturnType<Web["consultasDeIdentidad"]>, "personasParaMostrar">;
  respuesta: DependenciasDeRespuesta;
}>;

/** Un rechazo de una lectura: corta la carga entera y sale traducido, nunca un día a medias. */
class Rechazo extends Error {
  constructor(readonly causa: unknown) {
    // Stryker disable next-line StringLiteral: el mensaje solo sirve para depurar; nadie lo lee (la causa viaja en `causa`).
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
  d: DependenciasDeLaLecturaDelCierre,
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
  d: DependenciasDeLaLecturaDelCierre,
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
  if (abiertas.length === 0) return hoy.fechaDeNegocio;
  // Stryker disable next-line EqualityOperator: no hay dos jornadas con la misma fecha (clave única), así que con `<=` o `<` se elige la misma.
  return abiertas.reduce((a, b) => (b < a ? b : a));
}

async function medios(
  d: DependenciasDeLaLecturaDelCierre,
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
  d: DependenciasDeLaLecturaDelCierre,
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
    // Stryker disable next-line ConditionalExpression: con la jornada en cierre los cobros siempre se leen (`conDetalle`); la comprobación solo estrecha el tipo.
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
    // Stryker disable next-line ConditionalExpression: sin persona no hay clave en el mapa, así que preguntarle igual da `null` (solo estrecha el tipo para `get`).
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
  d: DependenciasDeLaLecturaDelCierre,
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
