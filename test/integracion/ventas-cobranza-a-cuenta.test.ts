import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearCuentaCorrienteDeVentas } from "../../src/composicion/cuenta-corriente-de-ventas";
import { err } from "../../src/primitivas/resultado/resultado";
import { crearCasosDeUsoDeVentas } from "../../src/modulos/ventas/publico";
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
 * CC-3: cobrar un ticket cargado a la cuenta de un cliente: el MISMO cobro de caja de hoy suma, en la misma transacción, el asiento COBRANZA imputado al cargo de ese ticket; anular el ticket cobrado
 * anula primero la cobranza y después el cargo. Casos de uso reales y una base real. Previene: cobro sin asiento (o asiento sin cobro), cobranza o espejo duplicados, dos cobros del mismo ticket a la
 * vez, anular y cobrar a la vez que dejan un cobro sin venta, un cobro bloqueado por suspender al cliente y un cobro que se hace sin el puerto de la cuenta corriente.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("ventas: cobranza a cuenta corriente (CC-3)", () => {
  let m: MundoDeVentas;
  let e: EscenarioDeVentas;

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, { conexiones: 16, cuentaCorriente: true });
    e = await m.escenario();
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  const cliente = async (): Promise<string> => {
    const id = randomUUID();
    await m.dueno.query(
      `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, documento_tipo, documento_numero, creado_por)
       values ($1, $2, gen_random_uuid(), 'JURIDICA', $3, 'CUIT', $4, $5)`,
      [id, e.empresa, `Cliente ${sufijoUnico()}`, cuitUnico(), e.gerente.personaId],
    );
    await m.dueno.query(
      "insert into parte_rol (empresa_id, parte_id, rol, activo) values ($1, $2, 'CUSTOMER', true)",
      [e.empresa, id],
    );
    await m.dueno.query(
      `insert into cuenta_del_cliente (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por)
       values ($1, $2, 30, '100000.00', $3, $4, $5)`,
      [e.empresa, id, claveNueva(), HUELLA, e.gerente.personaId],
    );
    return id;
  };
  /** Un ticket cargado a la cuenta del cliente (EMITIDO sin cobrar). */
  const aCuenta = async (clienteId: string) => {
    const { cuenta } = await cuentaConLinea(m, e);
    return valorDe(
      await m.casos.cerrarCuenta(e.gerente, {
        cuentaId: cuenta,
        ejemplarId: nuevoId(),
        clienteId,
        totalEsperado: { moneda: "ARS", monto: "1000.00" },
      }),
    );
  };
  const cobrar = (
    caja: Awaited<ReturnType<MundoDeVentas["cajaAbierta"]>>,
    t: Readonly<{ ticketId: string; ejemplarId: string }>,
    casos: MundoDeVentas["casos"] = m.casos,
    clave = nuevaClave(),
  ) =>
    casos.cobrar(e.gerente, {
      claveIdempotencia: clave,
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
  const anular = (t: Readonly<{ ticketId: string; ejemplarId: string }>, clave = nuevaClave()) =>
    m.casos.anularTicket(e.gerente, {
      claveIdempotencia: clave,
      ticketId: t.ticketId,
      ejemplarBaseId: t.ejemplarId,
      ejemplarNuevoId: nuevoId(),
      motivo: "Error del cajero",
      sucursalDeTrabajo: e.sucursal,
    });
  const asientos = (clienteId: string) =>
    m.filas<{ id: string; importe: string; clase: string; naturaleza: string }>(
      `select id, importe::text, clase, naturaleza from asiento_de_saldo where empresa_id = $1 and parte_id = $2 order by registrado_en, id`,
      [e.empresa, clienteId],
    );
  const saldo = async (clienteId: string) =>
    (
      await m.filas<{ s: string }>(
        "select coalesce(sum(saldo), 0)::text as s from saldo_de_parte where empresa_id = $1 and parte_id = $2 and sentido = 'A_COBRAR'",
        [e.empresa, clienteId],
      )
    )[0]?.s;
  const imputaciones = (ticketId: string) =>
    m.contar(
      `select count(*) as n from imputacion_de_saldo where empresa_id = $1 and saldado_id in
         (select id from asiento_de_saldo where origen_id = $2)`,
      [e.empresa, ticketId],
    );
  const estadoDelTicket = async (ticketId: string) =>
    (await m.filas<{ estado: string }>("select estado from ticket where id = $1", [ticketId]))[0]
      ?.estado;
  const cobranzas = (ticketId: string) =>
    m.contar("select count(*) as n from cobranza_de_ticket where ticket_id = $1", [ticketId]);

  it("cobrar un ticket a cuenta: cobro de caja, ticket COBRADO y un asiento COBRANZA por el total imputado a su cargo (saldo en cero); el cliente suspendido también se cobra", async () => {
    // El cliente suspendido no puede cargar: el cargo se hace con la ficha habilitada y se suspende después (suspender no impide cobrar).
    const habilitado = await cliente();
    const t = await aCuenta(habilitado);
    await m.dueno.query(
      "update cuenta_del_cliente set estado = 'SUSPENDIDA', motivo_de_suspension = 'Prueba' where parte_id = $1",
      [habilitado],
    );
    const caja = await m.cajaAbierta(e);
    const r = valorDe(await cobrar(caja, t));
    expect(r.yaExistia).toBe(false);
    expect(await estadoDelTicket(t.ticketId)).toBe("COBRADO");
    expect((await asientos(habilitado)).map((a) => [a.clase, a.importe])).toEqual([
      ["CARGO_DE_VENTA_A_CUENTA", "1000.00"],
      ["COBRANZA", "-1000.00"],
    ]);
    expect(await saldo(habilitado)).toBe("0.00");
    expect(await imputaciones(t.ticketId)).toBe(1);
  });

  it("idempotencia: cobrar dos veces el mismo ticket a cuenta deja una cobranza, un asiento y una imputación", async () => {
    const c = await cliente();
    const t = await aCuenta(c);
    const caja = await m.cajaAbierta(e);
    const clave = nuevaClave();
    const a = valorDe(await cobrar(caja, t, m.casos, clave));
    const b = valorDe(await cobrar(caja, t, m.casos, clave));
    expect(b).toMatchObject({ cobranzaId: a.cobranzaId, yaExistia: true });
    expect(await cobranzas(t.ticketId)).toBe(1);
    expect((await asientos(c)).filter((x) => x.clase === "COBRANZA")).toHaveLength(1);
    expect(await imputaciones(t.ticketId)).toBe(1);
    expect(await saldo(c)).toBe("0.00");
  });

  it("concurrencia: dos cobros a la vez del mismo ticket (dos claves): uno cobra y el otro ve TICKET_YA_COBRADO; un asiento y un cobro de caja", async () => {
    for (let ronda = 0; ronda < 3; ronda++) {
      const c = await cliente();
      const t = await aCuenta(c);
      const caja = await m.cajaAbierta(e);
      m.armarBarrera(2);
      const rs = await Promise.all([cobrar(caja, t), cobrar(caja, t)]).finally(m.soltarBarrera);
      expect(
        rs.filter((r) => r.ok),
        `ronda ${ronda}`,
      ).toHaveLength(1);
      expect(rs.filter((r) => !r.ok).map((r) => (!r.ok ? r.error : null))).toEqual([
        expect.objectContaining({ error: "TICKET_YA_COBRADO" }),
      ]);
      expect(await cobranzas(t.ticketId)).toBe(1);
      expect((await asientos(c)).filter((x) => x.clase === "COBRANZA")).toHaveLength(1);
      expect(await saldo(c)).toBe("0.00");
    }
  });

  it("anular un ticket cobrado a cuenta anula primero la cobranza y después el cargo (saldo en cero) y repetir la anulación no duplica nada", async () => {
    const c = await cliente();
    const t = await aCuenta(c);
    const caja = await m.cajaAbierta(e);
    valorDe(await cobrar(caja, t));
    const clave = nuevaClave();
    const pedido = {
      claveIdempotencia: clave,
      ticketId: t.ticketId,
      ejemplarBaseId: t.ejemplarId,
      ejemplarNuevoId: nuevoId(),
      motivo: "Error del cajero",
      sucursalDeTrabajo: e.sucursal,
    };
    valorDe(await m.casos.anularTicket(e.gerente, pedido));
    valorDe(await m.casos.anularTicket(e.gerente, pedido));
    expect(await estadoDelTicket(t.ticketId)).toBe("ANULADO");
    const libro = await asientos(c);
    // Los espejos se escriben en la misma transacción (mismo instante): el orden entre ellos no se compara, solo qué hay.
    expect(libro.map((a) => `${a.clase}:${a.naturaleza}`).sort()).toEqual([
      "CARGO_DE_VENTA_A_CUENTA:ANULACION",
      "CARGO_DE_VENTA_A_CUENTA:ORIGINAL",
      "COBRANZA:ANULACION",
      "COBRANZA:ORIGINAL",
    ]);
    expect(await saldo(c)).toBe("0.00");
  });

  it("concurrencia: anular y cobrar el ticket a la vez, en las dos órdenes: nunca queda un cobro sin su venta ni un asiento sin su espejo", async () => {
    for (let ronda = 0; ronda < 4; ronda++) {
      const c = await cliente();
      const t = await aCuenta(c);
      const caja = await m.cajaAbierta(e);
      m.armarBarrera(2);
      const pedidos = [() => cobrar(caja, t), () => anular(t)];
      if (ronda % 2 === 1) pedidos.reverse();
      await Promise.all(pedidos.map((p) => p())).finally(m.soltarBarrera);
      // Quien pierde por agotamiento repite el mismo pedido: ya no hay nada que hacer o lo hace en el otro orden.
      await anular(t);
      expect(await estadoDelTicket(t.ticketId), `ronda ${ronda}`).toBe("ANULADO");
      expect(await saldo(c)).toBe("0.00");
      const libro = await asientos(c);
      const cobros = libro.filter((a) => a.clase === "COBRANZA");
      expect(cobros.map((a) => a.naturaleza).sort()).toEqual(
        cobros.length === 0 ? [] : ["ANULACION", "ORIGINAL"],
      );
      expect(libro.filter((a) => a.clase !== "COBRANZA").map((a) => a.naturaleza)).toEqual([
        "ORIGINAL",
        "ANULACION",
      ]);
    }
  });

  it("concurrencia: dos anulaciones a la vez del mismo ticket cobrado (dos claves): una anula y la otra ve el ticket anulado; un solo espejo de cada asiento", async () => {
    const c = await cliente();
    const t = await aCuenta(c);
    valorDe(await cobrar(await m.cajaAbierta(e), t));
    m.armarBarrera(2);
    const rs = await Promise.all([anular(t), anular(t)]).finally(m.soltarBarrera);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect((await asientos(c)).map((a) => a.naturaleza).sort()).toEqual([
      "ANULACION",
      "ANULACION",
      "ORIGINAL",
      "ORIGINAL",
    ]);
    expect(await saldo(c)).toBe("0.00");
  });

  it("atomicidad: si la cuenta corriente rechaza la cobranza no queda cobro ni ingreso de caja ni asiento, y sin el puerto un ticket a cuenta no se cobra", async () => {
    const c = await cliente();
    const t = await aCuenta(c);
    const caja = await m.cajaAbierta(e);
    const antes = await m.contar("select count(*) as n from cobro where empresa_id = $1", [
      e.empresa,
    ]);
    const que = crearCuentaCorrienteDeVentas(REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE);
    const falla = crearCasosDeUsoDeVentas({
      transacciones: m.entorno,
      reglas: REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
      cuentaCorriente: {
        ...que,
        cobrarEnTx: () => Promise.resolve(err("CARGO_A_CUENTA_RECHAZADO")),
      },
    });
    const sinPuerto = crearCasosDeUsoDeVentas({
      transacciones: m.entorno,
      reglas: REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
    });
    expect((await cobrar(caja, t, falla)).ok).toBe(false);
    expect(await cobrar(caja, t, sinPuerto)).toEqual({
      ok: false,
      error: "CUENTA_CORRIENTE_NO_DISPONIBLE",
    });
    expect(await estadoDelTicket(t.ticketId)).toBe("EMITIDO");
    expect(await cobranzas(t.ticketId)).toBe(0);
    expect(
      await m.contar("select count(*) as n from cobro where empresa_id = $1", [e.empresa]),
    ).toBe(antes);
    expect((await asientos(c)).map((a) => a.clase)).toEqual(["CARGO_DE_VENTA_A_CUENTA"]);
  });
});
