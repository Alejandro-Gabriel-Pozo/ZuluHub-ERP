import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearCobroACuenta } from "../../src/composicion/cobro-a-cuenta";
import {
  cobrarUnTicketACuenta,
  ticketACobrarDelCliente,
  type DependenciasDeCobrarACuentaWeb,
} from "../../src/composicion/cobrar-a-cuenta-web";
import type { TxDeApp } from "../../src/composicion/conexiones";
import { crearCuentaCorrienteDeVentas } from "../../src/composicion/cuenta-corriente-de-ventas";
import { crearCasosDeUsoDeVentas } from "../../src/modulos/ventas/publico";
import type { Transacciones } from "../../src/puertos/transacciones";
import { HUELLA, claveNueva } from "./caja-apoyo";
import { cuitUnico, sufijoUnico } from "./unicos";
import {
  REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
  cuentaConLinea,
  montarVentas,
  nuevaClave,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * «Cobrar un ticket a cuenta» de punta a punta por la composición web (CC-5 B2a), con una base real y los roles reales: la hoja (el cargo pendiente más antiguo, su ticket, su total y las cajas) y el cobro
 * (caja + cobranza imputada del libro, todo o nada). Previene: cobrar con un total que no es el del ticket, cobrar dos veces el mismo ticket (por la misma o por otra vía, a la vez), un cobro de caja sin su
 * cobranza del libro, un ticket de otra empresa o de una sucursal fuera del alcance, y un error de caja crudo.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const GENERICO = { ok: false, error: { codigo: "CAJA_ACCION_NO_PERMITIDA" } };

describe.skipIf(base === null)("composición web: cobrar un ticket a cuenta (CC-5 B2a)", () => {
  let m: MundoDeVentas;
  let e: EscenarioDeVentas;
  let otra: EscenarioDeVentas;
  let d: DependenciasDeCobrarACuentaWeb;
  const registrados: string[] = [];

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, { conexiones: 16, cuentaCorriente: true });
    e = await m.escenario();
    otra = await m.escenario();
    d = {
      cobro: () =>
        crearCobroACuenta({
          transacciones: m.entorno as unknown as Transacciones<TxDeApp>,
          reglas: REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
        }),
      casosDeUso: () => m.casos,
      consultas: () => m.consultas,
      respuesta: { registrar: (x) => registrados.push(x) },
    };
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  /** Un cliente con ficha (30 días de plazo). */
  const cliente = async (de: EscenarioDeVentas = e): Promise<string> => {
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
    await m.dueno.query(
      `insert into cuenta_del_cliente (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por)
       values ($1, $2, 30, '100000.00', $3, $4, $5)`,
      [de.empresa, id, claveNueva(), HUELLA, de.gerente.personaId],
    );
    return id;
  };
  /** Un ticket de $1000 cargado a la cuenta del cliente, SIN cobrar. */
  const aCuenta = async (clienteId: string, de: EscenarioDeVentas = e) => {
    const { cuenta } = await cuentaConLinea(m, de, de.gerente);
    return valorDe(
      await m.casos.cerrarCuenta(de.gerente, {
        cuentaId: cuenta,
        ejemplarId: nuevoId(),
        clienteId,
      }),
    );
  };
  const nombreDelCliente = async (id: string): Promise<string> =>
    (await m.filas<{ nombre: string }>("select nombre from parte where id = $1", [id]))[0]
      ?.nombre as string;

  /** El pedido de cobro que arma la pantalla: UN medio, sin importe. */
  const pedido = async (
    t: Readonly<{ ticketId: string; ejemplarId: string }>,
    o: Partial<{ clave: string; medio: string; de: EscenarioDeVentas; extra: object }> = {},
  ) => {
    const de = o.de ?? e;
    const caja = await m.cajaAbierta(de);
    return {
      claveIdempotencia: o.clave ?? nuevaClave(),
      ticketId: t.ticketId,
      ejemplarId: t.ejemplarId,
      cajaId: caja.cajaId,
      medioDePagoId: caja.medios[o.medio ?? "EFECTIVO"] as string,
      cuentaDeCobroId: null,
      ...(o.extra ?? {}),
    };
  };
  const cobrar = (pedidoDeCobro: unknown, contexto = e.gerente) =>
    cobrarUnTicketACuenta(d, contexto, pedidoDeCobro);
  const cobranzasDe = async (ticketId: string): Promise<number> =>
    m.contar("select count(*) as n from cobranza_de_ticket where ticket_id = $1", [ticketId]);
  const cobrosDeCajaDe = async (ticketId: string): Promise<number> =>
    m.contar(
      `select count(*) as n from cobro c join cobranza_de_ticket k on k.id = c.origen_id and k.empresa_id = c.empresa_id
       where k.ticket_id = $1`,
      [ticketId],
    );
  const estadoDe = async (ticketId: string): Promise<string> =>
    (await m.filas<{ estado: string }>("select estado from ticket where id = $1", [ticketId]))[0]
      ?.estado as string;
  const saldoDelLibro = async (clienteId: string): Promise<string> =>
    (
      await m.filas<{ s: string }>(
        "select coalesce(sum(importe), 0)::text as s from asiento_de_saldo where parte_id = $1 and sentido = 'A_COBRAR'",
        [clienteId],
      )
    )[0]?.s as string;

  it("la hoja trae el cargo pendiente MÁS ANTIGUO con su ticket, su total, su vencimiento y las cajas; con un ticket pedido, ese", async () => {
    const c = await cliente();
    const primero = await aCuenta(c);
    const segundo = await aCuenta(c);
    await m.cajaAbierta(e);
    const hoja = await ticketACobrarDelCliente(d, e.gerente, { clienteId: c });
    expect(hoja.ok).toBe(true);
    if (!hoja.ok || hoja.dato === null) throw new Error(`debía haber una hoja: ${JSON.stringify(hoja)}`);
    expect(hoja.dato.ticket).toMatchObject({
      ticketId: primero.ticketId,
      canal: "MOSTRADOR",
      sucursalId: e.sucursal,
      ejemplarId: primero.ejemplarId,
      total: { moneda: "ARS", monto: "1000.00" },
      fechaNegocio: "2026-11-09",
      venceEl: "2026-12-09",
      vencida: false,
    });
    expect(hoja.dato.cliente).toEqual({ id: c, nombre: await nombreDelCliente(c) });
    expect(hoja.dato.cajas.some((x) => x.estado === "ABIERTA")).toBe(true);
    expect(hoja.dato.jornadaActual.estado).toBe("ABIERTA");
    const pedida = await ticketACobrarDelCliente(d, e.gerente, {
      clienteId: c,
      ticketId: segundo.ticketId,
    });
    expect(pedida.ok && pedida.dato?.ticket.ticketId).toBe(segundo.ticketId);
  });

  it("sin nada para cobrar, o con un cliente que no es de la empresa o no existe, la hoja es vacía", async () => {
    const sinCargos = await cliente();
    expect(await ticketACobrarDelCliente(d, e.gerente, { clienteId: sinCargos })).toEqual({
      ok: true,
      dato: null,
    });
    const ajeno = await cliente(otra);
    await aCuenta(ajeno, otra);
    expect(await ticketACobrarDelCliente(d, e.gerente, { clienteId: ajeno })).toEqual({
      ok: true,
      dato: null,
    });
    expect(await ticketACobrarDelCliente(d, e.gerente, { clienteId: randomUUID() })).toEqual({
      ok: true,
      dato: null,
    });
    // Un ticket pedido que no es de este cliente no sale.
    const c = await cliente();
    const otro = await cliente();
    const delOtro = await aCuenta(otro);
    await aCuenta(c);
    expect(
      await ticketACobrarDelCliente(d, e.gerente, { clienteId: c, ticketId: delOtro.ticketId }),
    ).toEqual({ ok: true, dato: null });
  });

  it("cobra el ticket: caja y cobranza del libro juntas, el saldo del cliente baja y la respuesta trae lo hecho", async () => {
    const c = await cliente();
    const t1 = await aCuenta(c);
    await aCuenta(c);
    const r = await cobrar(await pedido(t1, { medio: "TRANSFERENCIA" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dato).toMatchObject({
      ticketId: t1.ticketId,
      total: { moneda: "ARS", monto: "1000.00" },
      fechaDeCobro: "2026-11-09",
      jornadaVencida: false,
      saldoDelCliente: { moneda: "ARS", monto: "1000.00" },
      yaExistia: false,
      cliente: { id: c },
    });
    expect(await estadoDe(t1.ticketId)).toBe("COBRADO");
    expect(await cobranzasDe(t1.ticketId)).toBe(1);
    expect(await cobrosDeCajaDe(t1.ticketId)).toBe(1);
    expect(await saldoDelLibro(c)).toBe("1000.00");
    // Cobrado, ya no es el «más antiguo»: la hoja trae el siguiente («Cobrar otro ticket»).
    const siguiente = await ticketACobrarDelCliente(d, e.gerente, { clienteId: c });
    expect(siguiente.ok && siguiente.dato?.ticket.ticketId).not.toBe(t1.ticketId);
    expect(registrados).toEqual([]);
  });

  it("el importe sale del ticket: un pedido con importe, sucursal o cliente de más se rechaza entero y no cobra nada", async () => {
    const c = await cliente();
    const t = await aCuenta(c);
    for (const extra of [
      { importe: { moneda: "ARS", monto: "1.00" } },
      { cobros: [] },
      { sucursalId: e.sucursal },
      { clienteId: c },
    ]) {
      expect(await cobrar(await pedido(t, { extra }))).toMatchObject(GENERICO);
    }
    expect(await estadoDe(t.ticketId)).toBe("EMITIDO");
    expect(await cobranzasDe(t.ticketId)).toBe(0);
  });

  it("repetir la misma acción (clic doble, reintento) cobra UNA vez y devuelve lo hecho; la misma clave con otro pedido se rechaza", async () => {
    const c = await cliente();
    const t = await aCuenta(c);
    const p = await pedido(t, { clave: nuevaClave() });
    const primera = await cobrar(p);
    const repetida = await cobrar(p);
    expect(primera.ok && !primera.dato.yaExistia).toBe(true);
    expect(repetida.ok && repetida.dato.yaExistia).toBe(true);
    expect(repetida.ok && primera.ok && repetida.dato.cobranzaId).toBe(
      primera.ok ? primera.dato.cobranzaId : "",
    );
    expect(await cobranzasDe(t.ticketId)).toBe(1);
    expect(await cobrosDeCajaDe(t.ticketId)).toBe(1);
    // Otro medio con la misma clave: no es un reuso silencioso.
    const otroMedio = await pedido(t, { clave: p.claveIdempotencia, medio: "QR" });
    expect(await cobrar(otroMedio)).toMatchObject(GENERICO);
    expect(await cobranzasDe(t.ticketId)).toBe(1);
  });

  it("dos cobros a la vez del mismo ticket: gana uno, el otro se rechaza y el libro queda con UNA cobranza", async () => {
    const c = await cliente();
    const t = await aCuenta(c);
    const [a, b] = await Promise.all([
      cobrar(await pedido(t)),
      cobrar(await pedido(t, { medio: "TRANSFERENCIA" })),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a, b].filter((r) => !r.ok)[0]).toMatchObject(GENERICO);
    expect(await cobranzasDe(t.ticketId)).toBe(1);
    expect(await cobrosDeCajaDe(t.ticketId)).toBe(1);
    expect(await saldoDelLibro(c)).toBe("0.00");
  });

  it("cobrar a cuenta a la vez que se cobra el mismo ticket por otra vía: una sola cobranza", async () => {
    const c = await cliente();
    const t = await aCuenta(c);
    const caja = await m.cajaAbierta(e);
    const [web, directa] = await Promise.all([
      cobrar(await pedido(t)),
      m.casos.cobrar(e.gerente, {
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
      }),
    ]);
    expect([web.ok, directa.ok].filter(Boolean)).toHaveLength(1);
    expect(await cobranzasDe(t.ticketId)).toBe(1);
    expect(await cobrosDeCajaDe(t.ticketId)).toBe(1);
    expect(await saldoDelLibro(c)).toBe("0.00");
  });

  it("cobrar a la vez que se anula el ticket: o queda cobrado con su cobranza o queda anulado sin cobro, nunca a medias", async () => {
    const c = await cliente();
    const t = await aCuenta(c);
    await Promise.all([
      cobrar(await pedido(t)),
      m.casos.anularTicket(e.gerente, {
        claveIdempotencia: nuevaClave(),
        ticketId: t.ticketId,
        ejemplarBaseId: t.ejemplarId,
        ejemplarNuevoId: nuevoId(),
        motivo: "Error del cajero",
        sucursalDeTrabajo: e.sucursal,
      }),
    ]);
    const estado = await estadoDe(t.ticketId);
    const cobranzas = await cobranzasDe(t.ticketId);
    const cobros = await cobrosDeCajaDe(t.ticketId);
    expect(cobranzas).toBe(cobros);
    if (estado === "COBRADO") expect(cobranzas).toBe(1);
    else expect(["ANULADO", "EMITIDO"]).toContain(estado);
    // El libro del cliente siempre cierra: el cargo, su cobranza y los espejos suman cero.
    expect(await saldoDelLibro(c)).toBe("0.00");
  });

  it("si la cobranza del libro falla no queda nada: ni cobro de caja, ni ticket cobrado, ni cobranza", async () => {
    const c = await cliente();
    const t = await aCuenta(c);
    const real = crearCuentaCorrienteDeVentas(REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE);
    const casosConLibroRoto = crearCasosDeUsoDeVentas({
      transacciones: m.entorno,
      reglas: REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
      cuentaCorriente: {
        ...real,
        cobrarEnTx: () => Promise.resolve({ ok: false, error: "CARGO_A_CUENTA_RECHAZADO" }),
      },
    });
    const roto: DependenciasDeCobrarACuentaWeb = { ...d, casosDeUso: () => casosConLibroRoto };
    const cobrosAntes = await cobrosDeCajaDe(t.ticketId);
    expect(await cobrarUnTicketACuenta(roto, e.gerente, await pedido(t))).toMatchObject(GENERICO);
    expect(await estadoDe(t.ticketId)).toBe("EMITIDO");
    expect(await cobranzasDe(t.ticketId)).toBe(0);
    expect(await cobrosDeCajaDe(t.ticketId)).toBe(cobrosAntes);
    expect(await saldoDelLibro(c)).toBe("1000.00");
  });

  it("otra empresa no ve ni cobra el ticket: la hoja sale vacía y el cobro se rechaza sin tocar nada", async () => {
    const c = await cliente();
    const t = await aCuenta(c);
    expect(await ticketACobrarDelCliente(d, otra.gerente, { clienteId: c })).toEqual({
      ok: true,
      dato: null,
    });
    expect(await cobrar(await pedido(t, { de: otra }), otra.gerente)).toMatchObject(GENERICO);
    expect(await estadoDe(t.ticketId)).toBe("EMITIDO");
    expect(await cobranzasDe(t.ticketId)).toBe(0);
  });

  it("permisos: el operador cobra (tickets.cobrar) pero no ve la cuenta (sin saldo en la respuesta) ni la hoja; un ticket de una sucursal fuera de su alcance se rechaza", async () => {
    const c = await cliente();
    const t = await aCuenta(c);
    expect(await ticketACobrarDelCliente(d, e.operador, { clienteId: c })).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    const r = await cobrar(await pedido(t), e.operador);
    expect(r.ok).toBe(true);
    expect(r.ok && r.dato.saldoDelCliente).toBeNull();
    expect(await estadoDe(t.ticketId)).toBe("COBRADO");
    // Un ticket de la otra sucursal (el operador solo está asignado a la suya).
    const cuenta = nuevoId();
    valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: e.otraSucursal }));
    valorDe(
      await m.casos.agregarLinea(e.gerente, {
        cuentaId: cuenta,
        lineaId: nuevoId(),
        productoId: e.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    );
    const fuera = valorDe(
      await m.casos.cerrarCuenta(e.gerente, {
        cuentaId: cuenta,
        ejemplarId: nuevoId(),
        clienteId: c,
      }),
    );
    expect(await cobrar(await pedido(fuera), e.operador)).toMatchObject(GENERICO);
    expect(await estadoDe(fuera.ticketId)).toBe("EMITIDO");
  });

  it("una caja que no existe o sin sesión se rechaza sin escribir; un ticket común (no cargado a un cliente) no se cobra por esta vía", async () => {
    const c = await cliente();
    const t = await aCuenta(c);
    const p = await pedido(t);
    expect(await cobrar({ ...p, cajaId: randomUUID() })).toMatchObject(GENERICO);
    expect(await estadoDe(t.ticketId)).toBe("EMITIDO");
    // Un ticket del salón sin cliente: cerrado sin cobro, pero no es de cuenta.
    const { cuenta } = await cuentaConLinea(m, e, e.gerente);
    const comun = valorDe(
      await m.casos.cerrarCuenta(e.gerente, { cuentaId: cuenta, ejemplarId: nuevoId() }),
    );
    expect(await cobrar(await pedido(comun))).toMatchObject(GENERICO);
    expect(await estadoDe(comun.ticketId)).toBe("EMITIDO");
  });

  it("un ejemplar que no es el vigente (el ticket cambió) se rechaza y no cobra", async () => {
    const c = await cliente();
    const t = await aCuenta(c);
    expect(
      await cobrar(await pedido({ ticketId: t.ticketId, ejemplarId: randomUUID() })),
    ).toMatchObject(GENERICO);
    expect(await estadoDe(t.ticketId)).toBe("EMITIDO");
    expect(await cobranzasDe(t.ticketId)).toBe(0);
  });
});
