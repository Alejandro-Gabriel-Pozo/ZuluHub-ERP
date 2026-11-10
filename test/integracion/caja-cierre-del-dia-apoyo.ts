import { randomUUID } from "node:crypto";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { importeDesdeTexto } from "../../src/primitivas/dinero/importe";
import { ARS } from "../../src/primitivas/dinero/moneda";
import {
  DENOMINACIONES_DE_BILLETES,
  crearAporteDeCaja,
  type ConteoDeEfectivo,
  type TicketsPorCobranza,
  type TicketDeVentas,
} from "../../src/modulos/caja/publico";
import {
  crearCasosDeUsoDeCierre,
  crearConsultasDeCierre,
  type EntradaDeJornada,
} from "../../src/modulos/cierre/publico";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import {
  cobrarComoVentas,
  entradaDeCobro,
  origenNuevo,
  type MundoDeCobro,
} from "./caja-cobrar-apoyo";
import {
  REGLAS_DE_CAJA,
  SIN_TICKETS,
  type armarCaja,
  type TxDeCajaDePrueba,
} from "./caja-configuracion-apoyo";
import { claveNueva, conAhora, fechaLocal, instanteLocal, pesos } from "./caja-operacion-apoyo";

/**
 * Apoyo de las pruebas de la contribución de caja al cierre del día (E3, tramo 8; e3b §4 y §5). Todo por los casos de uso reales, con la base
 * y los roles limitados: abrir la sesión, cobrar con el puerto de ventas, cerrarla con su conteo, empezar la auditoría con `cierre`, y
 * corregir, declarar y cerrar el día. El «ticket» lo informa un `TicketsPorCobranza` falso que la prueba controla (ventas todavía no existe).
 */

/** Un `TicketsPorCobranza` que responde con lo que la prueba le fija y recuerda a qué cobranzas se le preguntó. */
export type TicketsFalsos = TicketsPorCobranza &
  Readonly<{
    /** cobranzaId → el ticket que informa (total vigente; 0 = anulado). */
    tickets: Map<string, { ticketId: string; total: string }>;
    preguntas: string[][];
    modo: { falla: "NINGUNA" | "LANZA" | "DEVUELVE_VACIO" };
  }>;

export function ticketsFalsos(): TicketsFalsos {
  const tickets = new Map<string, { ticketId: string; total: string }>();
  const preguntas: string[][] = [];
  const modo: TicketsFalsos["modo"] = { falla: "NINGUNA" };
  return {
    tickets,
    preguntas,
    modo,
    ticketsPorCobranza(_tx, cobranzaIds) {
      preguntas.push([...cobranzaIds]);
      if (modo.falla === "LANZA") return Promise.reject(new Error("ventas no responde"));
      if (modo.falla === "DEVUELVE_VACIO") return Promise.resolve([]);
      const respuesta: TicketDeVentas[] = [];
      for (const id of cobranzaIds) {
        const t = tickets.get(id);
        if (t !== undefined) {
          respuesta.push({
            cobranzaId: id,
            ticketId: t.ticketId,
            totalVigente: importeDesdeTexto(ARS, t.total),
          });
        }
      }
      return Promise.resolve(respuesta);
    },
  };
}

/** Los casos de uso y las consultas del cierre del día CON el aporte de caja registrado, sobre las mismas transacciones. */
export function armarCierreConCaja(
  entorno: TransaccionesDePostgres<TxDeCajaDePrueba>,
  tickets: TicketsPorCobranza = SIN_TICKETS,
) {
  const dependencias = {
    transacciones: entorno,
    reglas: REGLAS_DE_CAJA,
    aportes: [crearAporteDeCaja({ tickets })],
  };
  return {
    casos: crearCasosDeUsoDeCierre<TxDeCajaDePrueba>(dependencias),
    consultas: crearConsultasDeCierre<TxDeCajaDePrueba>(dependencias),
  };
}

/** El conteo por billetes (de mayor a menor denominación) y monedas de un monto en pesos con centavos. */
export function conteoDe(monto: string): ConteoDeEfectivo {
  let centavos = importeDesdeTexto(ARS, monto).unidades;
  const billetes = [];
  for (const denominacion of DENOMINACIONES_DE_BILLETES) {
    const valor = BigInt(denominacion) * 100n;
    const cantidad = centavos / valor;
    if (cantidad > 0n) billetes.push({ denominacion, cantidad: Number(cantidad) });
    centavos -= cantidad * valor;
  }
  const pesosEnteros = centavos / 100n;
  const resto = centavos % 100n;
  return { billetes, monedas: pesos(`${pesosEnteros}.${resto.toString().padStart(2, "0")}`) };
}

export type CobroDePrueba = Readonly<{
  medio: keyof MundoDeCobro["medios"];
  cuenta?: keyof MundoDeCobro["cuentas"] | null;
  importe: string;
  /** Por omisión, un origen de ventas nuevo. Con otro tipo (`origenNuevo("otro.tipo")`) caja no lo compara con ningún ticket. */
  origen?: Readonly<{ tipo: string; id: string }>;
  /** La posición del cobro dentro de su origen (1 a 50); por omisión, 1. Dos cobros de un mismo origen son el 1 y el 2. */
  orden?: number;
  /** El total vigente que informa el ticket de este cobro; por omisión, el importe del cobro (sin diferencia). */
  totalDelTicket?: string;
}>;

export type JornadaLista = Readonly<{
  sesionId: string;
  fecha: string;
  entrada: EntradaDeJornada;
  /** Los ids de los cobros, en el orden de `cobros`. */
  cobroIds: readonly string[];
  /** Los orígenes de los cobros, en el mismo orden. */
  origenes: readonly Readonly<{ tipo: string; id: string }>[];
  ctx: (minutos?: number) => ContextoOperativo;
}>;

export type OpcionesDeJornada = Readonly<{
  fondo?: string;
  /** Días a partir de hoy (en Buenos Aires): fija la jornada. Por omisión, 1. */
  dias?: number;
  /** Cierra la caja con «conforme general» en lugar de declarar lo registrado de cada medio. */
  conforme?: boolean;
  /** No cierra la sesión (queda abierta). */
  sinCerrar?: boolean;
  /** Efectivo contado distinto del esperado. */
  efectivoContado?: string;
  /** Lo que se declara para CADA medio no efectivo al cerrar la sesión (por omisión, lo registrado). */
  noEfectivoContado?: string;
  /** Los tickets falsos a los que se registra el ticket de cada cobro con origen de ventas. */
  tickets?: TicketsFalsos;
}>;

const centavosATexto = (c: bigint): string =>
  `${c / 100n}.${(c % 100n).toString().padStart(2, "0")}`;

/**
 * Una jornada con una sesión abierta, sus cobros por el puerto de ventas y la sesión cerrada: el efectivo contado es lo esperado (fondo +
 * cobros en efectivo) salvo que se pida otra cosa, y cada medio no efectivo se declara por lo registrado (o se da el conforme general).
 */
export async function jornadaConCobros(
  entorno: TransaccionesDePostgres<TxDeCajaDePrueba>,
  caja: ReturnType<typeof armarCaja>,
  m: MundoDeCobro,
  cobros: readonly CobroDePrueba[],
  opciones: OpcionesDeJornada = {},
): Promise<JornadaLista> {
  const dias = opciones.dias ?? 1;
  const fondo = opciones.fondo ?? "1000.00";
  const ctx = (minutos = 0) =>
    conAhora(m.ctx(), new Date(instanteLocal(dias, "10:00").getTime() + minutos * 60_000));
  const abierta = await caja.casos.abrirSesion(ctx(0), {
    claveDeIdempotencia: claveNueva(),
    sucursalId: m.sucursal,
    cajaId: m.cajaId,
    fondoInicial: pesos(fondo),
  });
  if (!abierta.ok) throw new Error(`no se pudo abrir: ${JSON.stringify(abierta.error)}`);
  const cobroIds: string[] = [];
  const origenes: { tipo: string; id: string }[] = [];
  let efectivo = importeDesdeTexto(ARS, fondo).unidades;
  const porPar = new Map<string, { medio: string; cuenta: string | null; total: bigint }>();
  for (const [i, cobro] of cobros.entries()) {
    const cuenta =
      cobro.cuenta === undefined || cobro.cuenta === null ? null : m.cuentas[cobro.cuenta];
    const origen = cobro.origen ?? origenNuevo();
    const cobrado = await cobrarComoVentas(
      entorno,
      // Cada cobro un segundo después del anterior: el orden de las páginas (`registrado_en`, id) es el del alta.
      conAhora(ctx(5), new Date(ctx(5).ahora.getTime() + i * 1000)),
      entradaDeCobro(m, {
        origen,
        origenOrden: cobro.orden ?? 1,
        medioDePagoId: m.medios[cobro.medio],
        cuentaDeCobroId: cuenta,
        importe: importeDesdeTexto(ARS, cobro.importe),
      }),
    );
    if (!cobrado.ok) throw new Error(`no se pudo cobrar: ${JSON.stringify(cobrado.error)}`);
    if (opciones.tickets !== undefined && origen.tipo === "ventas.cobranza_de_ticket") {
      opciones.tickets.tickets.set(origen.id, {
        ticketId: randomUUID(),
        total: cobro.totalDelTicket ?? cobro.importe,
      });
    }
    cobroIds.push(cobrado.valor.cobroId);
    origenes.push(origen);
    const centavos = importeDesdeTexto(ARS, cobro.importe).unidades;
    if (cobro.medio === "EFECTIVO") efectivo += centavos;
    else {
      const llave = `${m.medios[cobro.medio]}/${cuenta ?? ""}`;
      const previo = porPar.get(llave);
      porPar.set(llave, {
        medio: m.medios[cobro.medio],
        cuenta,
        total: (previo?.total ?? 0n) + centavos,
      });
    }
  }
  const fecha = fechaLocal(instanteLocal(dias, "10:00"));
  const lista: JornadaLista = {
    sesionId: abierta.valor.sesionId,
    fecha,
    entrada: { sucursalId: m.sucursal, fechaDeNegocio: fecha },
    cobroIds,
    origenes,
    ctx,
  };
  if (opciones.sinCerrar === true) return lista;
  const cerrada = await caja.casos.cerrarSesion(ctx(30), {
    sesionId: abierta.valor.sesionId,
    conteo: conteoDe(opciones.efectivoContado ?? centavosATexto(efectivo)),
    otros:
      opciones.conforme === true
        ? []
        : [...porPar.values()].map((p) => ({
            medioDePagoId: p.medio,
            cuentaDeCobroId: p.cuenta,
            contado: pesos(opciones.noEfectivoContado ?? centavosATexto(p.total)),
          })),
    conformeGeneral: opciones.conforme === true,
    observacion: null,
  });
  if (!cerrada.ok) throw new Error(`no se pudo cerrar la sesión: ${JSON.stringify(cerrada.error)}`);
  return lista;
}

/** Empieza la auditoría de la jornada (el cierre pide que no haya sesiones sin cerrar). */
export async function empezarElCierre(
  cierre: ReturnType<typeof armarCierreConCaja>,
  j: JornadaLista,
  minutos = 40,
) {
  const r = await cierre.casos.iniciarAuditoria(j.ctx(minutos), j.entrada);
  if (!r.ok) throw new Error(`no se pudo empezar el cierre: ${JSON.stringify(r.error)}`);
}

/** Cierra el día con los controles que se ven ahora, reconociendo todo lo reconocible (con el texto dado, o sin texto). */
export async function cerrarElDia(
  cierre: ReturnType<typeof armarCierreConCaja>,
  j: JornadaLista,
  opciones: Readonly<{ texto?: string | null; minutos?: number }> = {},
) {
  const controles = await cierre.consultas.controlesDeLaJornada(
    j.ctx(opciones.minutos ?? 60),
    j.entrada,
  );
  if (!controles.ok)
    throw new Error(`no se pudieron leer los controles: ${JSON.stringify(controles.error)}`);
  return cierre.casos.cerrarJornada(j.ctx(opciones.minutos ?? 60), {
    ...j.entrada,
    huellaVista: controles.valor.huella,
    reconocimientos: controles.valor.controles
      .filter((c) => c.severidad === "RECONOCIBLE" && c.cantidad > 0)
      .map((c) => ({ modulo: c.modulo, clave: c.clave, texto: opciones.texto ?? null })),
    observacion: null,
  });
}
