import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import { cuentaId } from "../../src/modulos/ventas/dominio/identificadores";
import { HUELLA, claveNueva } from "./caja-apoyo";
import { crearBaseAparte } from "./entorno";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";
import { cuitUnico, sufijoUnico } from "./unicos";
import {
  cuentaConLinea,
  montarVentas,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * R2 mínimo (0107): el cliente que se carga al ticket al cerrar la cuenta, con los casos de uso reales y una base real. Previene: un cliente de otra empresa,
 * inactivo, anonimizado o que no es cliente en un ticket; dos cierres a la vez con dos clientes; un cierre repetido que cambia el cliente; cambiar el cliente
 * después de emitido; crear cobro o cobranza sin que exista la cuenta corriente; y que un ticket sin cliente cambie su respuesta.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("ventas: cliente en el ticket (0107)", () => {
  let m: MundoDeVentas;
  let e: EscenarioDeVentas;
  let otra: EscenarioDeVentas;

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, { conexiones: 16, cuentaCorriente: true });
    e = await m.escenario();
    otra = await m.escenario();
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  /** Una parte de la empresa (por defecto: cliente activo), armada por el dueño de la base. */
  const parte = async (
    de: EscenarioDeVentas = e,
    o: Partial<{ estado: "INACTIVA" | "ANONIMIZADA"; rol: string | null }> = {},
  ): Promise<string> => {
    const id = randomUUID();
    await m.dueno.query(
      `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, documento_tipo, documento_numero, creado_por)
       values ($1, $2, gen_random_uuid(), 'JURIDICA', $3, 'CUIT', $4, $5)`,
      [id, de.empresa, `Cliente ${sufijoUnico()}`, cuitUnico(), de.gerente.personaId],
    );
    const rol = o.rol === undefined ? "CUSTOMER" : o.rol;
    if (rol !== null) {
      await m.dueno.query(
        "insert into parte_rol (empresa_id, parte_id, rol, activo) values ($1, $2, $3, true)",
        [de.empresa, id, rol],
      );
    }
    // Un cliente que puede deber tiene su ficha habilitada (CC-1): sin ella el cierre a su nombre se rechaza (CC-2).
    if (o.estado === undefined && rol === "CUSTOMER") {
      await m.dueno.query(
        `insert into cuenta_del_cliente (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por)
         values ($1, $2, 30, '1000000.00', $3, $4, $5)`,
        [de.empresa, id, claveNueva(), HUELLA, de.gerente.personaId],
      );
    }
    if (o.estado === "INACTIVA") {
      await m.dueno.query("update parte set estado = 'INACTIVA' where id = $1", [id]);
    } else if (o.estado === "ANONIMIZADA") {
      await m.dueno.query("update parte_rol set activo = false where parte_id = $1", [id]);
      await m.dueno.query(
        "update parte set estado = 'ANONIMIZADA', nombre = null, documento_tipo = null, documento_numero = null, anonimizada_en = now() where id = $1",
        [id],
      );
    }
    return id;
  };
  const cerrar = (cuenta: string, ejemplar: string, clienteId?: string) =>
    m.casos.cerrarCuenta(e.gerente, {
      cuentaId: cuenta,
      ejemplarId: ejemplar,
      ...(clienteId === undefined
        ? {}
        : { clienteId, totalEsperado: { moneda: "ARS", monto: "1000.00" } }),
    });
  const ticketsDe = async (cuenta: string) =>
    (
      await m.filas<{ id: string; cargado_a_parte_id: string | null }>(
        "select id, cargado_a_parte_id from ticket where cuenta_id = $1",
        [cuenta],
      )
    ).map((t) => ({ id: t.id, cliente: t.cargado_a_parte_id }));
  const lista = async (de: EscenarioDeVentas) =>
    valorDe(await m.consultas.ticketsDelDia(de.gerente, { sucursalId: de.sucursal }));
  const ficha = async (ticketId: string) =>
    valorDe(await m.consultas.fichaDelTicketDelDia(e.gerente, { ticketId }));

  it("con cliente: el ticket lo guarda, la lista y la ficha lo muestran con su nombre, la auditoría lo anota y no nace cobranza; otra empresa no lo ve", async () => {
    const cliente = await parte();
    const nombre = (
      await m.filas<{ n: string }>("select nombre as n from parte where id = $1", [cliente])
    )[0]?.n;
    const cobranzas = await m.contar("select count(*) as n from cobranza_de_ticket");
    const { cuenta } = await cuentaConLinea(m, e);
    const r = valorDe(await cerrar(cuenta, nuevoId(), cliente));
    expect(r).toMatchObject({ clienteId: cliente, yaEstabaCerrada: false });
    expect(await ticketsDe(cuenta)).toEqual([{ id: r.ticketId, cliente }]);
    expect(await m.contar("select count(*) as n from cobranza_de_ticket")).toBe(cobranzas);
    expect((await lista(e)).tickets.find((t) => t.ticketId === r.ticketId)?.cliente).toEqual({
      id: cliente,
      nombre,
    });
    expect((await ficha(r.ticketId)).cliente).toEqual({ id: cliente, nombre });
    const auditado = (await m.auditoria(e.empresa, "TICKET_EMITIDO")).find(
      (a) => a.entidad_id === r.ticketId,
    );
    expect(auditado?.despues).toMatchObject({ clienteId: cliente });
    expect(JSON.stringify(await lista(otra))).not.toContain(cliente);
  });

  it("sin cliente todo queda como era: sin `clienteId` en la salida ni `cliente` en las lecturas, y NULL en la base", async () => {
    const { cuenta } = await cuentaConLinea(m, e);
    const r = valorDe(await cerrar(cuenta, nuevoId()));
    expect(Object.keys(r)).not.toContain("clienteId");
    expect(await ticketsDe(cuenta)).toEqual([{ id: r.ticketId, cliente: null }]);
    expect(
      Object.keys((await lista(e)).tickets.find((t) => t.ticketId === r.ticketId) ?? {}),
    ).not.toContain("cliente");
    expect(Object.keys(await ficha(r.ticketId))).not.toContain("cliente");
  });

  it("un cliente que no sirve (otra empresa, inactivo, anonimizado, proveedor, sin rol, inexistente, mal formado) da CLIENTE_NO_VALIDO y no deja nada a medias", async () => {
    const invalidos = [
      await parte(otra),
      await parte(e, { estado: "INACTIVA" }),
      await parte(e, { estado: "ANONIMIZADA" }),
      await parte(e, { rol: "PROVEEDOR" }),
      await parte(e, { rol: null }),
      randomUUID(),
      "no-es-un-id",
    ];
    for (const clienteId of invalidos) {
      const { cuenta } = await cuentaConLinea(m, e);
      expect(await cerrar(cuenta, nuevoId(), clienteId), clienteId).toEqual({
        ok: false,
        error: "CLIENTE_NO_VALIDO",
      });
      expect(await ticketsDe(cuenta)).toEqual([]);
      expect(
        (
          await m.filas("select 1 from cuenta_consumo where id = $1 and estado = 'ABIERTA'", [
            cuenta,
          ])
        ).length,
      ).toBe(1);
    }
    // Una cuenta que no se puede cerrar responde lo de siempre, con o sin cliente.
    const vacia = nuevoId();
    valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: vacia, sucursalId: e.sucursal }));
    const sin = await cerrar(vacia, nuevoId());
    expect(sin.ok).toBe(false);
    expect(await cerrar(vacia, nuevoId(), await parte())).toEqual(sin);
  });

  it("idempotencia: repetir el cierre devuelve el mismo ticket; un cliente distinto es CLAVE_REUTILIZADA y no lo cambia (queda el del primero)", async () => {
    const primero = await parte();
    const { cuenta } = await cuentaConLinea(m, e);
    const ejemplar = nuevoId();
    const a = valorDe(await cerrar(cuenta, ejemplar, primero));
    const repetida = valorDe(await cerrar(cuenta, ejemplar, primero));
    expect(repetida).toMatchObject({
      ticketId: a.ticketId,
      yaEstabaCerrada: true,
      clienteId: primero,
    });
    expect(await cerrar(cuenta, nuevoId(), await parte())).toEqual({
      ok: false,
      error: "CLAVE_REUTILIZADA",
    });
    expect(await ticketsDe(cuenta)).toEqual([{ id: a.ticketId, cliente: primero }]);
    const emisiones =
      "select count(*) as n from auditoria_empresa where accion = 'TICKET_EMITIDO' and entidad_id = $1";
    expect(await m.contar(emisiones, [a.ticketId])).toBe(1);
  });

  it("concurrencia: dos cierres a la vez de la misma cuenta con clientes distintos dejan UN ticket y UN cliente (el del que ganó)", async () => {
    for (let ronda = 0; ronda < 4; ronda++) {
      const clientes = [await parte(), await parte()];
      const { cuenta } = await cuentaConLinea(m, e);
      m.armarBarrera(2);
      const crudos = await Promise.all(clientes.map((c) => cerrar(cuenta, nuevoId(), c))).finally(
        m.soltarBarrera,
      );
      // Quien pierde (la cuenta ya se cerró a nombre del otro) recibe CLAVE_REUTILIZADA; si perdió por agotamiento del motor serializable, repite el MISMO pedido (seguro) y ve el mismo resultado.
      const resultados = await Promise.all(
        crudos.map(async (q, i) =>
          q.ok || (!q.ok && q.error === "CLAVE_REUTILIZADA")
            ? q
            : await cerrar(cuenta, nuevoId(), clientes[i]),
        ),
      );
      const filas = await ticketsDe(cuenta);
      expect(filas, `ronda ${ronda}`).toHaveLength(1);
      expect(clientes).toContain(filas[0]?.cliente);
      const ganadores = resultados.filter((q) => q.ok);
      expect(ganadores, `ronda ${ronda}`).toHaveLength(1);
      expect(ganadores[0]?.ok && ganadores[0].valor.clienteId).toBe(filas[0]?.cliente);
      expect(resultados.filter((q) => !q.ok)).toEqual([{ ok: false, error: "CLAVE_REUTILIZADA" }]);
    }
  });

  it("un ticket con cliente se sigue pudiendo anular (el disparador del cliente no frena los otros cambios) y conserva su cliente", async () => {
    const cliente = await parte();
    const { cuenta } = await cuentaConLinea(m, e);
    const r = valorDe(await cerrar(cuenta, nuevoId(), cliente));
    const anulado = valorDe(
      await m.casos.anularTicket(e.gerente, {
        claveIdempotencia: `clave-${randomUUID()}`,
        ticketId: r.ticketId,
        ejemplarBaseId: r.ejemplarId,
        ejemplarNuevoId: nuevoId(),
        motivo: "Error de carga",
        sucursalDeTrabajo: e.sucursal,
      }),
    );
    expect(anulado.estado).toBe("ANULADO");
    expect(await ticketsDe(cuenta)).toEqual([{ id: r.ticketId, cliente }]);
  });

  it("en la base: el cliente no se cambia ni para el dueño, la aplicación no puede actualizarlo y la clave foránea rechaza un cliente de otra empresa", async () => {
    const cliente = await parte();
    const { cuenta } = await cuentaConLinea(m, e);
    const r = valorDe(await cerrar(cuenta, nuevoId(), cliente));
    const sin = valorDe(await cerrar((await cuentaConLinea(m, e)).cuenta, nuevoId()));
    for (const [ticket, valor] of [
      [r.ticketId, await parte()],
      [r.ticketId, null],
      [sin.ticketId, cliente],
    ] as const) {
      await expect(
        m.dueno.query("update ticket set cargado_a_parte_id = $2 where id = $1", [ticket, valor]),
      ).rejects.toMatchObject({ code: "23514", constraint: "ticket_cargado_a_parte_inmutable" });
    }
    const permisos = await m.filas<{ privilege_type: string }>(
      `select privilege_type from information_schema.column_privileges
        where table_name = 'ticket' and column_name = 'cargado_a_parte_id' and grantee = 'pedernal_app'`,
    );
    expect(permisos.map((p) => p.privilege_type)).toContain("INSERT");
    expect(permisos.map((p) => p.privilege_type)).not.toContain("UPDATE");

    // Sin la validación del servidor (insertando directo por el repositorio) la base igual lo rechaza y no queda ticket.
    const deOtra = await parte(otra);
    const { cuenta: cuenta2 } = await cuentaConLinea(m, e);
    const resultado = await m.entorno.ejecutar({ contexto: e.gerente }, async (tx) => {
      const c = await tx.cuentas.obtener(empresaId(e.empresa), cuentaId(cuenta2));
      if (c === null) throw new Error("falta la cuenta");
      const empresa = empresaId(e.empresa);
      const persona = personaId(e.gerente.personaId as string);
      await tx.cuentas.cerrar(empresa, c.id, persona, e.gerente.ahora);
      const numero = await tx.tickets.siguienteNumero(empresa, c.sucursalId);
      await tx.tickets.insertar(empresa, {
        sucursalId: c.sucursalId,
        cuentaId: c.id,
        numero,
        estado: "EMITIDO",
        total: "1000.00",
        emitidoPor: persona,
        emitidoEn: e.gerente.ahora,
        cargadoAParteId: deOtra,
      });
      return ok(null);
    });
    expect(resultado.ok).toBe(false);
    expect(await ticketsDe(cuenta2)).toEqual([]);
  });

  it("migración: la reversión frena si hay tickets con cliente; sin ellos, revertir y volver a aplicar deja el mismo esquema (y aplicarla dos veces falla claro)", async () => {
    if (base === null) return;
    const leer = (archivo: string) => readFile(join(CARPETA_DE_MIGRACIONES, archivo), "utf8");
    const reversion = await leer("reversiones/0107_revertir_cliente_en_el_ticket.sql");
    const migracion = await leer("0107_cliente_en_el_ticket.sql");
    const correr = async (c: pg.Client, texto: string): Promise<string | null> => {
      try {
        await c.query(`begin; ${texto}; commit;`);
        return null;
      } catch (error) {
        await c.query("rollback");
        return (error as { message: string }).message;
      }
    };
    expect(await correr(m.dueno, reversion)).toMatch(/tickets con cliente/);
    expect(
      await m.contar("select count(*) as n from ticket where cargado_a_parte_id is not null"),
    ).toBeGreaterThan(0);

    // Con un rol que no evade RLS la guarda de la reversión falla claro, sin tocar nada.
    const sinBypass = `sin_bypass_${sufijoUnico()}`;
    await m.dueno.query(`create role ${sinBypass} nologin nosuperuser nobypassrls`);
    try {
      await m.dueno.query(`grant ${sinBypass} to current_user`);
      expect(await correr(m.dueno, `set local role ${sinBypass}; ${reversion}`)).toMatch(
        /evada RLS/,
      );
    } finally {
      await m.dueno.query(`drop owned by ${sinBypass}`);
      await m.dueno.query(`drop role ${sinBypass}`);
    }
    expect(
      await m.contar(
        "select count(*) as n from information_schema.columns where table_name = 'ticket' and column_name = 'cargado_a_parte_id'",
      ),
    ).toBe(1);

    const aparte = await crearBaseAparte(base);
    const c = new pg.Client({ connectionString: aparte.base.dueno });
    await c.connect();
    try {
      const esquema = async () =>
        JSON.stringify(
          (
            await c.query(
              `select 'c' as t, column_name || ':' || is_nullable || ':' || coalesce(column_default, '') as x from information_schema.columns where table_name = 'ticket' and column_name = 'cargado_a_parte_id'
               union all select 'k', conname || ':' || pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.ticket'::regclass and conname like 'ticket_cargado%'
               union all select 'i', indexdef from pg_indexes where indexname = 'ticket_cargado_a_parte_ix'
               union all select 'g', tgname from pg_trigger where not tgisinternal and tgname = 'ticket_cargado_a_parte_inmutable'
               union all select 'p', privilege_type from information_schema.column_privileges where table_name = 'ticket' and column_name = 'cargado_a_parte_id' and grantee = 'pedernal_app'
               order by 1, 2`,
            )
          ).rows,
        );
      const original = await esquema();
      expect(await correr(c, migracion)).toMatch(/already exists|ya existe/);
      expect(await correr(c, reversion)).toBeNull();
      expect(await correr(c, reversion)).toBeNull();
      expect(await esquema()).toBe("[]");
      const registrada = () =>
        c.query("select 1 from migracion where nombre = '0107_cliente_en_el_ticket.sql'");
      expect((await registrada()).rowCount).toBe(0); // la reversión borra su fila del registro
      expect(await correr(c, migracion)).toBeNull();
      expect(await esquema()).toBe(original);
    } finally {
      await c.end();
      await aparte.destruir();
    }
  });
});
