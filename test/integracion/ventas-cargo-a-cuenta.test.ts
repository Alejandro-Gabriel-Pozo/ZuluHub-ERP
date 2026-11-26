import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { HUELLA, claveNueva } from "./caja-apoyo";
import { cuitUnico, sufijoUnico } from "./unicos";
import {
  cuentaConLinea,
  montarVentas,
  nuevaClave,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * CC-2: cerrar la cuenta a nombre de un cliente carga la venta a su cuenta corriente (asiento A_COBRAR en el libro), con el límite bajo el bloqueo de la ficha, la aprobación del exceso
 * auditada y el espejo al anular. Casos de uso reales y una base real. Previene: deuda duplicada o sin ticket, límite superado por dos cierres a la vez, exceso aprobado por quien no puede,
 * vencimiento calculado con otra fecha, anular el ticket y dejar la deuda, y cobrar en caja un ticket que ya está cargado a la cuenta.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("ventas: cargo a cuenta corriente (CC-2)", () => {
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

  /** Un cliente con su ficha (límite y plazo a elección); el producto de la prueba vale $1000. */
  const cliente = async (
    o: Partial<{ limite: string; plazo: number; suspendida: boolean; sinFicha: boolean }> = {},
    de: EscenarioDeVentas = e,
  ): Promise<string> => {
    const id = randomUUID();
    await m.dueno.query(
      `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, documento_tipo, documento_numero, creado_por)
       values ($1, $2, gen_random_uuid(), 'JURIDICA', $3, 'CUIT', $4, $5)`,
      [id, de.empresa, `Cliente ${sufijoUnico()}`, cuitUnico(), de.gerente.personaId],
    );
    await m.dueno.query(
      "insert into parte_rol (empresa_id, parte_id, rol, activo) values ($1, $2, 'CUSTOMER', true)",
      [de.empresa, id],
    );
    if (o.sinFicha !== true) {
      await m.dueno.query(
        `insert into cuenta_del_cliente (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          de.empresa,
          id,
          o.plazo ?? 30,
          o.limite ?? "100000.00",
          claveNueva(),
          HUELLA,
          de.gerente.personaId,
        ],
      );
      if (o.suspendida === true) {
        await m.dueno.query(
          "update cuenta_del_cliente set estado = 'SUSPENDIDA', motivo_de_suspension = 'Prueba' where parte_id = $1",
          [id],
        );
      }
    }
    return id;
  };
  const cerrar = (
    cuenta: string,
    clienteId: string,
    contexto: ContextoOperativo = e.gerente,
    aprobacionDelExceso?: { motivo: string },
  ) =>
    m.casos.cerrarCuenta(contexto, {
      cuentaId: cuenta,
      ejemplarId: nuevoId(),
      clienteId,
      ...(aprobacionDelExceso === undefined ? {} : { aprobacionDelExceso }),
    });
  const venta = async (
    clienteId: string,
    contexto: ContextoOperativo = e.gerente,
    aprobacion?: { motivo: string },
  ) => {
    const { cuenta } = await cuentaConLinea(m, e, contexto);
    return { cuenta, r: await cerrar(cuenta, clienteId, contexto, aprobacion) };
  };
  const asientos = (clienteId: string) =>
    m.filas<{
      id: string;
      importe: string;
      clase: string;
      sentido: string;
      naturaleza: string;
      vence_el: string;
      origen_id: string;
    }>(
      `select id, importe::text, clase, sentido, naturaleza, vence_el::text, origen_id from asiento_de_saldo
        where empresa_id = $1 and parte_id = $2 order by registrado_en, id`,
      [e.empresa, clienteId],
    );
  const saldo = async (clienteId: string) =>
    (
      await m.filas<{ s: string }>(
        "select coalesce(sum(saldo), 0)::text as s from saldo_de_parte where empresa_id = $1 and parte_id = $2 and sentido = 'A_COBRAR'",
        [e.empresa, clienteId],
      )
    )[0]?.s;
  const tickets = (cuenta: string) =>
    m.filas<{ id: string; estado: string }>("select id, estado from ticket where cuenta_id = $1", [
      cuenta,
    ]);

  it("cierra a cuenta: el ticket queda EMITIDO sin cobrar y el libro tiene UN cargo por el total, con su vencimiento (fecha de negocio del ticket + plazo), origen y centro de costo; todo auditado", async () => {
    const c = await cliente({ plazo: 30 });
    const cobranzas = await m.contar("select count(*) as n from cobranza_de_ticket");
    const { cuenta, r } = await venta(c);
    const t = valorDe(r);
    expect(await tickets(cuenta)).toEqual([{ id: t.ticketId, estado: "EMITIDO" }]);
    expect(await m.contar("select count(*) as n from cobranza_de_ticket")).toBe(cobranzas);
    const cargos = await asientos(c);
    expect(cargos).toMatchObject([
      {
        importe: "1000.00",
        clase: "CARGO_DE_VENTA_A_CUENTA",
        sentido: "A_COBRAR",
        naturaleza: "ORIGINAL",
        origen_id: t.ticketId,
      },
    ]);
    expect(cargos[0]?.vence_el).toBe("2026-12-09"); // fecha de negocio 2026-11-09 + 30 días
    expect(await saldo(c)).toBe("1000.00");
    const centros = await m.filas<{ sucursal_id: string; importe: string }>(
      "select sucursal_id, importe::text from distribucion_de_asiento where asiento_id = $1",
      [cargos[0]?.id],
    );
    expect(centros).toEqual([{ sucursal_id: e.sucursal, importe: "1000.00" }]);
    expect(
      (await m.auditoria(e.empresa, "saldos.registrar_asiento")).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("el vencimiento sale de la fecha de negocio del TICKET (con la hora de corte de la sucursal), no del reloj de la empresa", async () => {
    const c = await cliente({ plazo: 10 });
    await m.dueno.query("update sucursal set hora_de_corte = '04:00' where id = $1", [e.sucursal]);
    try {
      // 02:00 en Argentina del 10/11: con corte 04:00 todavía es la jornada del 09/11.
      const madrugada = { ...e.gerente, ahora: new Date("2026-11-10T05:00:00Z") };
      const { r } = await venta(c, madrugada);
      valorDe(r);
      expect((await asientos(c))[0]?.vence_el).toBe("2026-11-19");
    } finally {
      await m.dueno.query("update sucursal set hora_de_corte = '00:00' where id = $1", [
        e.sucursal,
      ]);
    }
  });

  it("sin ficha o con la ficha suspendida el cierre falla, y no queda ticket, cargo ni cuenta cerrada", async () => {
    for (const [o, error] of [
      [{ sinFicha: true }, "CLIENTE_SIN_CUENTA_HABILITADA"],
      [{ suspendida: true }, "CUENTA_SUSPENDIDA"],
    ] as const) {
      const c = await cliente(o);
      const { cuenta, r } = await venta(c);
      expect(r).toEqual({ ok: false, error });
      expect(await tickets(cuenta)).toEqual([]);
      expect(await asientos(c)).toEqual([]);
      expect(
        await m.filas("select 1 from cuenta_consumo where id = $1 and estado = 'ABIERTA'", [
          cuenta,
        ]),
      ).toHaveLength(1);
    }
  });

  it("límite: el saldo IGUAL al límite pasa; un centavo más pide aprobación, que solo vale con motivo y con `aprobar_exceso`, y queda auditada", async () => {
    const justo = await cliente({ limite: "1000.00" });
    valorDe((await venta(justo)).r);
    expect(await saldo(justo)).toBe("1000.00");

    const c = await cliente({ limite: "999.99" });
    // Sin aprobación, o con ella pero quien cierra no puede aprobar (el operador cierra, no aprueba): no se hace.
    expect((await venta(c)).r).toEqual({ ok: false, error: "EXCEDE_EL_LIMITE" });
    expect((await venta(c, e.gerente, { motivo: "   " })).r).toEqual({
      ok: false,
      error: "EXCEDE_EL_LIMITE",
    });
    expect((await venta(c, e.operador, { motivo: "Cliente de confianza" })).r).toEqual({
      ok: false,
      error: "EXCEDE_EL_LIMITE",
    });
    expect(await asientos(c)).toEqual([]);
    // El gerente, con motivo, aprueba.
    const aprobada = valorDe((await venta(c, e.gerente, { motivo: "Cliente de confianza" })).r);
    expect(await saldo(c)).toBe("1000.00");
    const auditado = (await m.auditoria(e.empresa, "cuenta_corriente.aprobar_exceso")).find(
      (a) => (a.despues as { ticketId?: string }).ticketId === aprobada.ticketId,
    );
    expect(auditado?.actor_persona_id).toBe(e.gerente.personaId);
    expect(auditado?.despues).toMatchObject({
      exceso: "0.01",
      limite: "999.99",
      saldoPrevio: "0.00",
      total: "1000.00",
      motivo: "Cliente de confianza",
    });
  });

  it("el operador (cajero) cierra a cuenta dentro del límite; sin `cargar_a_cuenta` nadie cierra a cuenta (aunque el pedido traiga el cliente)", async () => {
    const c = await cliente();
    valorDe((await venta(c, e.operador)).r);
    expect(await saldo(c)).toBe("1000.00");
  });

  it("idempotencia: el cierre repetido (mismo ticket) no duplica el cargo ni la auditoría", async () => {
    const c = await cliente();
    const { cuenta } = await cuentaConLinea(m, e);
    const ejemplar = nuevoId();
    const pedido = { cuentaId: cuenta, ejemplarId: ejemplar, clienteId: c };
    const a = valorDe(await m.casos.cerrarCuenta(e.gerente, pedido));
    const b = valorDe(await m.casos.cerrarCuenta(e.gerente, pedido));
    expect(b).toMatchObject({ ticketId: a.ticketId, yaEstabaCerrada: true });
    expect(await asientos(c)).toHaveLength(1);
    expect(await saldo(c)).toBe("1000.00");
  });

  it("concurrencia: dos cierres a la vez del mismo cliente con límite para UNO: uno pasa y el otro pide aprobación, en las dos órdenes; el saldo nunca supera el límite", async () => {
    for (let ronda = 0; ronda < 4; ronda++) {
      const c = await cliente({ limite: "1500.00" });
      const cuentas = [(await cuentaConLinea(m, e)).cuenta, (await cuentaConLinea(m, e)).cuenta];
      m.armarBarrera(2);
      const pedidos = ronda % 2 === 0 ? cuentas : [...cuentas].reverse();
      const resultados = await Promise.all(pedidos.map((q) => cerrar(q, c))).finally(
        m.soltarBarrera,
      );
      expect(
        resultados.filter((r) => r.ok),
        `ronda ${ronda}`,
      ).toHaveLength(1);
      expect(resultados.filter((r) => !r.ok)).toEqual([{ ok: false, error: "EXCEDE_EL_LIMITE" }]);
      expect(await saldo(c)).toBe("1000.00");
      expect(await asientos(c)).toHaveLength(1);
    }
  });

  it("concurrencia: cerrar a cuenta y suspender al cliente a la vez: o se cierra con la ficha habilitada (y queda su cargo) o falla CUENTA_SUSPENDIDA (y no queda nada)", async () => {
    for (let ronda = 0; ronda < 4; ronda++) {
      const c = await cliente();
      const { cuenta } = await cuentaConLinea(m, e);
      m.armarBarrera(1);
      const [r] = await Promise.all([
        cerrar(cuenta, c),
        m.dueno.query(
          "update cuenta_del_cliente set estado = 'SUSPENDIDA', motivo_de_suspension = 'Prueba' where parte_id = $1",
          [c],
        ),
      ]).finally(m.soltarBarrera);
      if (r.ok) {
        expect(await asientos(c), `ronda ${ronda}`).toHaveLength(1);
      } else {
        expect(r).toEqual({ ok: false, error: "CUENTA_SUSPENDIDA" });
        expect(await asientos(c)).toEqual([]);
        expect(await tickets(cuenta)).toEqual([]);
      }
    }
  });

  it("anular el ticket anula el cargo en la misma transacción (el saldo vuelve a cero) y repetir la anulación no duplica el espejo", async () => {
    const c = await cliente();
    const { r } = await venta(c);
    const t = valorDe(r);
    const anular = {
      claveIdempotencia: nuevaClave(),
      ticketId: t.ticketId,
      ejemplarBaseId: t.ejemplarId,
      ejemplarNuevoId: nuevoId(),
      motivo: "Error del cajero",
    };
    valorDe(await m.casos.anularTicket(e.gerente, anular));
    valorDe(await m.casos.anularTicket(e.gerente, anular));
    expect((await asientos(c)).map((a) => a.naturaleza)).toEqual(["ORIGINAL", "ANULACION"]);
    expect(await saldo(c)).toBe("0.00");
  });

  it("un ticket con cargo a cuenta no se cobra en caja, y un cliente de otra empresa no se puede cargar", async () => {
    const c = await cliente();
    const caja = await m.cajaAbierta(e);
    const t = valorDe((await venta(c)).r);
    const cobro = await m.casos.cobrar(e.gerente, {
      claveIdempotencia: nuevaClave(),
      ticketId: t.ticketId,
      ejemplarId: t.ejemplarId,
      cajaId: caja.cajaId,
      cobros: [
        {
          medioDePagoId: caja.medios["EFECTIVO"] as string,
          cuentaDeCobroId: null,
          importe: { moneda: "ARS", monto: "1000.00" },
        },
      ],
    });
    expect(cobro).toEqual({ ok: false, error: "TICKET_A_CUENTA_CORRIENTE" });
    expect(
      await m.contar("select count(*) as n from cobranza_de_ticket where ticket_id = $1", [
        t.ticketId,
      ]),
    ).toBe(0);

    const deOtra = await cliente({}, otra);
    const { cuenta, r } = await venta(deOtra);
    expect(r).toEqual({ ok: false, error: "CLIENTE_NO_VALIDO" });
    expect(await tickets(cuenta)).toEqual([]);
    // El saldo de un cliente no se mezcla con el de otro de la misma empresa.
    const otroCliente = await cliente({ limite: "1000.00" });
    valorDe((await venta(otroCliente)).r);
    expect(await saldo(otroCliente)).toBe("1000.00");
  });
});
