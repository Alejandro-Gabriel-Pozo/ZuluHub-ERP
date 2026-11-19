import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { personaId } from "../primitivas/identificadores/marca";
import { err, ok } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { entradaDeFichaDelTicket } from "./entradas-de-cobrar";
import { accionDeCobrar } from "./errores-de-cobrar";
import type { Web } from "./web";

/**
 * Las dos lecturas de «Tickets del día» y «Ficha del ticket» para la pantalla (DDD:293). Son LECTURAS: no escriben ni auditan, y repetirlas da lo mismo. La
 * sucursal de la lista la pone el servidor (nunca el pedido); la de la ficha es la del propio ticket y se valida contra el alcance de quien pide.
 * Todo sale campo por campo (lista de permitidos), con los importes como texto decimal con moneda (ADR-006) y los instantes en ISO UTC: la pantalla
 * los muestra en hora de Argentina. Los ids de persona NO salen: en su lugar va el correo (`personasParaMostrar`, una sola vez por ficha); si
 * identidad no deja ver las personas (permiso), la ficha sale igual con el correo en `null` y no se inventa un nombre. Los errores de negocio salen
 * como el genérico (`errores-de-cobrar.ts`).
 */

export type DependenciasDeTicketsDelDiaWeb = Readonly<{
  consultas: () => Pick<
    ReturnType<Web["consultasDeVentas"]>,
    "ticketsDelDia" | "fichaDelTicketDelDia"
  >;
  consultasDeIdentidad: () => Pick<ReturnType<Web["consultasDeIdentidad"]>, "personasParaMostrar">;
  respuesta: DependenciasDeRespuesta;
}>;

type Importe = Readonly<{ moneda: string; monto: string }>;
const importe = (i: Importe): Importe => ({ moneda: i.moneda, monto: i.monto });

export type TicketsDelDiaParaLaPantalla = Readonly<{
  fechaNegocio: string;
  tickets: readonly Readonly<{
    ticketId: string;
    numero: number;
    numeroDeCorreccion: number;
    estado: string;
    totalOriginal: Importe;
    totalVigente: Importe;
    emitidoEn: string;
    facturado: boolean;
  }>[];
}>;

/** La lista de la jornada (la de la caja abierta o, sin caja abierta, la de hoy) de la sucursal que fija el servidor. */
export function ticketsDelDiaParaLaPantalla(
  d: DependenciasDeTicketsDelDiaWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
): Promise<Respuesta<TicketsDelDiaParaLaPantalla>> {
  return accionDeCobrar(
    d.respuesta,
    {},
    () => ok({}),
    () => d.consultas().ticketsDelDia(contexto, { sucursalId }),
    (lista) => ({
      fechaNegocio: lista.fechaNegocio,
      tickets: lista.tickets.map((t) => ({
        ticketId: t.ticketId,
        numero: t.numero,
        numeroDeCorreccion: t.numeroDeCorreccion,
        estado: t.estado,
        totalOriginal: importe(t.totalOriginal),
        totalVigente: importe(t.totalVigente),
        emitidoEn: t.emitidoEn,
        facturado: t.facturado,
      })),
    }),
  );
}

export type FichaDelTicketParaLaPantalla = Readonly<{
  ticketId: string;
  numero: number;
  numeroDeCorreccion: number;
  estado: string;
  fechaNegocio: string;
  ejemplarVigenteId: string;
  totalOriginal: Importe;
  totalVigente: Importe;
  /** El correo de quien emitió; `null` si no se puede mostrar. */
  emitidoPor: string | null;
  emitidoEn: string;
  facturado: boolean;
  renglones: readonly Readonly<{
    lineaCuentaId: string;
    descripcion: string;
    varianteNombre: string | null;
    opciones: readonly Readonly<{ grupo: string; nombre: string; recargo: string }>[];
    cantidad: string;
    unidadDeVenta: string;
    unidadSimbolo: string;
    precioUnitario: string;
    alicuota: string;
    importe: string;
  }>[];
  caja: Readonly<{ id: string; nombre: string }> | null;
  cobros: readonly Readonly<{
    orden: number;
    medioTipo: string;
    cuentaDeCobro: Readonly<{ id: string; nombre: string }> | null;
    importe: Importe;
  }>[];
  anulacion: Readonly<{ motivo: string; hechaPor: string | null; hechaEn: string }> | null;
}>;

const MOTIVOS_DE_RECHAZO: ReadonlySet<string> = new Set([
  "MODULO_EN_DESARROLLO",
  "MODULO_NO_ACTIVO",
  "MODULO_EN_SOLO_LECTURA",
  "SIN_CAPACIDAD",
  "SIN_PERMISO",
]);

/** La ficha de un ticket de la sucursal de quien pide: renglones, cobros con su medio, caja, quién y cuándo, y el motivo si está anulado. */
export function fichaDelTicketParaLaPantalla(
  d: DependenciasDeTicketsDelDiaWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<FichaDelTicketParaLaPantalla>> {
  return accionDeCobrar(
    d.respuesta,
    crudo,
    entradaDeFichaDelTicket,
    async (entrada) => {
      const ficha = await d.consultas().fichaDelTicketDelDia(contexto, entrada);
      if (!ficha.ok) return ficha;
      const ids = [
        ...new Set([
          ficha.valor.emitidoPor,
          ...(ficha.valor.anulacion ? [ficha.valor.anulacion.hechaPor] : []),
        ]),
      ];
      const personas = await d.consultasDeIdentidad().personasParaMostrar(contexto, { ids });
      // Sin permiso para ver personas, la ficha sale con el correo en `null`; cualquier otro fallo (base, entrada) no se esconde.
      if (
        !personas.ok &&
        !(typeof personas.error === "string" && MOTIVOS_DE_RECHAZO.has(personas.error))
      )
        return err(personas.error);
      const correos = personas.ok ? personas.valor : new Map<string, string>();
      return ok({
        ficha: ficha.valor,
        correoDe: (id: string) => correos.get(personaId(id)) ?? null,
      });
    },
    ({ ficha: f, correoDe }) => ({
      ticketId: f.ticketId,
      numero: f.numero,
      numeroDeCorreccion: f.numeroDeCorreccion,
      estado: f.estado,
      fechaNegocio: f.fechaNegocio,
      ejemplarVigenteId: f.ejemplarVigenteId,
      totalOriginal: importe(f.totalOriginal),
      totalVigente: importe(f.totalVigente),
      emitidoPor: correoDe(f.emitidoPor),
      emitidoEn: f.emitidoEn,
      facturado: f.facturado,
      renglones: f.renglones.map((r) => ({
        lineaCuentaId: r.lineaCuentaId,
        descripcion: r.descripcion,
        varianteNombre: r.varianteNombre,
        opciones: r.opciones.map((o) => ({ grupo: o.grupo, nombre: o.nombre, recargo: o.recargo })),
        cantidad: r.cantidad,
        unidadDeVenta: r.unidadDeVenta,
        unidadSimbolo: r.unidadSimbolo,
        precioUnitario: r.precioUnitario,
        alicuota: r.alicuota,
        importe: r.importe,
      })),
      caja: f.caja === null ? null : { id: f.caja.id, nombre: f.caja.nombre },
      cobros: f.cobros.map((c) => ({
        orden: c.orden,
        medioTipo: c.medioTipo,
        cuentaDeCobro:
          c.cuentaDeCobro === null
            ? null
            : { id: c.cuentaDeCobro.id, nombre: c.cuentaDeCobro.nombre },
        importe: importe(c.importe),
      })),
      anulacion:
        f.anulacion === null
          ? null
          : {
              motivo: f.anulacion.motivo,
              hechaPor: correoDe(f.anulacion.hechaPor),
              hechaEn: f.anulacion.hechaEn,
            },
    }),
  );
}
