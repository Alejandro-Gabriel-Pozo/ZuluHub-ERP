import { sql, type Kysely } from "kysely";
import {
  personaId,
  sucursalId,
  type EmpresaId,
  type PersonaId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { EstadoDeTicket } from "../dominio/estados";
import {
  cuentaId,
  ejemplarId,
  esUuid,
  ticketId,
  type CuentaId,
  type EjemplarId,
  type TicketId,
} from "../dominio/identificadores";
import type { VentasDb } from "./esquema";

/** Un ticket tal como está guardado. `fechaNegocio` es `YYYY-MM-DD`; los importes, texto decimal exacto. */
export type Ticket = Readonly<{
  id: TicketId;
  sucursalId: SucursalId;
  cuentaId: CuentaId;
  numero: number;
  fechaNegocio: FechaCivil;
  estado: EstadoDeTicket;
  total: string;
  sesionDeCajaId: string | null;
  ejemplarVigente: number;
  emitidoPor: PersonaId;
  emitidoEn: Date;
  version: number;
}>;

export type TipoDeEjemplar = "ORIGINAL" | "CORRECCION" | "ANULACION";

export type Ejemplar = Readonly<{
  id: EjemplarId;
  ticketId: TicketId;
  numeroDeEjemplar: number;
  tipo: TipoDeEjemplar;
  total: string;
  ejemplarBaseId: EjemplarId | null;
  creadoPor: PersonaId;
  creadoEn: Date;
}>;

export type RenglonDeEjemplar = Readonly<{
  lineaCuentaId: string;
  cantidad: string;
  importe: string;
}>;

export type AltaDeTicket = Readonly<{
  sucursalId: SucursalId;
  cuentaId: CuentaId;
  numero: number;
  estado: "EMITIDO" | "CORTESIA";
  total: string;
  emitidoPor: PersonaId;
  emitidoEn: Date;
}>;

export type AltaDeEjemplar = Readonly<{
  id: EjemplarId;
  ticketId: TicketId;
  numeroDeEjemplar: number;
  tipo: TipoDeEjemplar;
  total: string;
  ejemplarBaseId: EjemplarId | null;
  creadoPor: PersonaId;
  creadoEn: Date;
  /** Los renglones del ejemplar (uno solo grupo en E4); vacío en una anulación. */
  renglones: readonly RenglonDeEjemplar[];
}>;

export type AltaDeCorreccion = Readonly<{
  id: string;
  ticketId: TicketId;
  ejemplarBaseId: EjemplarId;
  ejemplarNuevoId: EjemplarId;
  tipo: "ANULACION" | "CORRECCION";
  motivo: string;
  clave: string;
  huella: string;
  resultado: Readonly<Record<string, unknown>>;
  hechaPor: PersonaId;
  hechaEn: Date;
}>;

export type CorreccionGuardada = Readonly<{
  ticketId: TicketId;
  ejemplarBaseId: EjemplarId;
  ejemplarNuevoId: EjemplarId;
  huella: string;
  resultado: Readonly<Record<string, unknown>>;
}>;

/**
 * Persistencia del numerador, el ticket, sus ejemplares y el registro de correcciones (E4 §3.3, §3.5 y §3.8). Todo corre dentro de la
 * transacción del caso de uso, filtra SIEMPRE por la empresa (y la RLS lo repite) y no usa caché.
 */
export interface RepositorioDeTickets {
  /**
   * El próximo número de la sucursal, sin huecos: `INSERT ... ON CONFLICT DO NOTHING` de la fila del numerador y `UPDATE ... SET ultimo =
   * ultimo + 1 RETURNING`. El `UPDATE` bloquea la fila hasta el fin de la transacción: N cierres en la sucursal se serializan. Si la
   * transacción se revierte, el numerador vuelve atrás y el número no se consume.
   */
  siguienteNumero(empresa: EmpresaId, sucursal: SucursalId): Promise<number>;
  /** Inserta el ticket; la base fija `fecha_negocio` (por reloj) y la devuelve. */
  insertar(
    empresa: EmpresaId,
    alta: AltaDeTicket,
  ): Promise<Readonly<{ id: TicketId; fechaNegocio: FechaCivil }>>;
  obtener(empresa: EmpresaId, id: TicketId): Promise<Ticket | null>;
  obtenerPorCuenta(empresa: EmpresaId, cuenta: CuentaId): Promise<Ticket | null>;
  /** Inserta el ejemplar con su grupo y sus renglones. */
  insertarEjemplar(empresa: EmpresaId, alta: AltaDeEjemplar): Promise<void>;
  /** El ejemplar de ese número del ticket (el 1 es el original; el de número `ejemplar_vigente` es el vigente). */
  ejemplarDeNumero(
    empresa: EmpresaId,
    ticket: TicketId,
    numeroDeEjemplar: number,
  ): Promise<Ejemplar | null>;
  /**
   * `estado → ANULADO` y `ejemplar_vigente + 1`, solo si el ejemplar vigente sigue siendo el visto y el ticket no estaba anulado (árbitro
   * contra otra anulación, una corrección y un cobro). `false` si no cambió nada: el caso de uso relee y dice por qué.
   */
  anular(empresa: EmpresaId, id: TicketId, ejemplarVigenteVisto: number): Promise<boolean>;
  insertarCorreccion(empresa: EmpresaId, alta: AltaDeCorreccion): Promise<void>;
  correccionPorClave(empresa: EmpresaId, clave: string): Promise<CorreccionGuardada | null>;
}

type FilaDeTicket = Readonly<{
  id: string;
  sucursal_id: string;
  cuenta_id: string;
  numero: number;
  fecha_negocio: string;
  estado: EstadoDeTicket;
  total: string;
  sesion_de_caja_id: string | null;
  ejemplar_vigente: number;
  emitido_por: string;
  emitido_en: Date;
  version: number;
}>;

function aTicket(f: FilaDeTicket): Ticket {
  return {
    id: ticketId(f.id),
    sucursalId: sucursalId(f.sucursal_id),
    cuentaId: cuentaId(f.cuenta_id),
    numero: f.numero,
    fechaNegocio: f.fecha_negocio as FechaCivil,
    estado: f.estado,
    total: f.total,
    sesionDeCajaId: f.sesion_de_caja_id,
    ejemplarVigente: f.ejemplar_vigente,
    emitidoPor: personaId(f.emitido_por),
    emitidoEn: f.emitido_en,
    version: f.version,
  };
}

export function crearRepositorioDeTickets(db: Kysely<VentasDb>): RepositorioDeTickets {
  const seleccionarTicket = () =>
    db
      .selectFrom("ticket")
      .select([
        "id",
        "sucursal_id",
        "cuenta_id",
        "numero",
        sql<string>`fecha_negocio::text`.as("fecha_negocio"),
        "estado",
        "total",
        "sesion_de_caja_id",
        "ejemplar_vigente",
        "emitido_por",
        "emitido_en",
        "version",
      ]);

  return {
    async siguienteNumero(empresa, sucursal) {
      await db
        .insertInto("numerador_ticket")
        .values({ empresa_id: empresa, sucursal_id: sucursal })
        .onConflict((oc) => oc.doNothing())
        .execute();
      const fila = await db
        .updateTable("numerador_ticket")
        .set({ ultimo: sql<number>`ultimo + 1` })
        .where("empresa_id", "=", empresa)
        .where("sucursal_id", "=", sucursal)
        .returning("ultimo")
        .executeTakeFirst();
      // Recién creada o ya existente, la fila tiene que verse: si no, la política de la base la ocultó (empresa que no opera).
      if (fila === undefined)
        throw new Error("el numerador del ticket no es visible para el contexto");
      return fila.ultimo;
    },

    async insertar(empresa, alta) {
      const fila = await db
        .insertInto("ticket")
        .values({
          empresa_id: empresa,
          sucursal_id: alta.sucursalId,
          cuenta_id: alta.cuentaId,
          numero: alta.numero,
          estado: alta.estado,
          total: alta.total,
          emitido_por: alta.emitidoPor,
          emitido_en: alta.emitidoEn,
        })
        .returning(["id", sql<string>`fecha_negocio::text`.as("fecha_negocio")])
        .executeTakeFirstOrThrow();
      return { id: ticketId(fila.id), fechaNegocio: fila.fecha_negocio as FechaCivil };
    },

    async obtener(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await seleccionarTicket()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aTicket(fila);
    },

    async obtenerPorCuenta(empresa, cuenta) {
      if (!esUuid(cuenta)) return null;
      const fila = await seleccionarTicket()
        .where("empresa_id", "=", empresa)
        .where("cuenta_id", "=", cuenta)
        .executeTakeFirst();
      return fila === undefined ? null : aTicket(fila);
    },

    async insertarEjemplar(empresa, alta) {
      await db
        .insertInto("ticket_ejemplar")
        .values({
          id: alta.id,
          empresa_id: empresa,
          ticket_id: alta.ticketId,
          numero_de_ejemplar: alta.numeroDeEjemplar,
          tipo: alta.tipo,
          total: alta.total,
          ejemplar_base_id: alta.ejemplarBaseId,
          creado_por: alta.creadoPor,
          creado_en: alta.creadoEn,
        })
        .execute();
      if (alta.renglones.length === 0) return;
      await db
        .insertInto("ejemplar_grupo")
        .values({ empresa_id: empresa, ejemplar_id: alta.id, orden: 1, total: alta.total })
        .execute();
      await db
        .insertInto("ejemplar_linea")
        .values(
          alta.renglones.map((r) => ({
            empresa_id: empresa,
            ejemplar_id: alta.id,
            grupo_orden: 1,
            linea_cuenta_id: r.lineaCuentaId,
            cantidad: r.cantidad,
            importe: r.importe,
          })),
        )
        .execute();
    },

    async ejemplarDeNumero(empresa, ticket, numeroDeEjemplar) {
      const fila = await db
        .selectFrom("ticket_ejemplar")
        .select([
          "id",
          "ticket_id",
          "numero_de_ejemplar",
          "tipo",
          "total",
          "ejemplar_base_id",
          "creado_por",
          "creado_en",
        ])
        .where("empresa_id", "=", empresa)
        .where("ticket_id", "=", ticket)
        .where("numero_de_ejemplar", "=", numeroDeEjemplar)
        .executeTakeFirst();
      if (fila === undefined) return null;
      return {
        id: ejemplarId(fila.id),
        ticketId: ticketId(fila.ticket_id),
        numeroDeEjemplar: fila.numero_de_ejemplar,
        tipo: fila.tipo as TipoDeEjemplar,
        total: fila.total,
        ejemplarBaseId: fila.ejemplar_base_id === null ? null : ejemplarId(fila.ejemplar_base_id),
        creadoPor: personaId(fila.creado_por),
        creadoEn: fila.creado_en,
      };
    },

    async anular(empresa, id, ejemplarVigenteVisto) {
      const r = await db
        .updateTable("ticket")
        .set({ estado: "ANULADO", ejemplar_vigente: ejemplarVigenteVisto + 1 })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("ejemplar_vigente", "=", ejemplarVigenteVisto)
        .where("estado", "<>", "ANULADO")
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async insertarCorreccion(empresa, alta) {
      await db
        .insertInto("ticket_correccion")
        .values({
          id: alta.id,
          empresa_id: empresa,
          ticket_id: alta.ticketId,
          ejemplar_base_id: alta.ejemplarBaseId,
          ejemplar_nuevo_id: alta.ejemplarNuevoId,
          tipo: alta.tipo,
          motivo: alta.motivo,
          clave: alta.clave,
          huella: alta.huella,
          resultado: alta.resultado,
          hecha_por: alta.hechaPor,
          hecha_en: alta.hechaEn,
        })
        .execute();
    },

    async correccionPorClave(empresa, clave) {
      const fila = await db
        .selectFrom("ticket_correccion")
        .select(["ticket_id", "ejemplar_base_id", "ejemplar_nuevo_id", "huella", "resultado"])
        .where("empresa_id", "=", empresa)
        .where("clave", "=", clave)
        .executeTakeFirst();
      if (fila === undefined) return null;
      return {
        ticketId: ticketId(fila.ticket_id),
        ejemplarBaseId: ejemplarId(fila.ejemplar_base_id),
        ejemplarNuevoId: ejemplarId(fila.ejemplar_nuevo_id),
        huella: fila.huella,
        resultado: fila.resultado,
      };
    },
  };
}
