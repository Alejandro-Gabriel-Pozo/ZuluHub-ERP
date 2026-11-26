import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { anularElTicket, type DependenciasDeCobrarWeb } from "../../src/composicion/cobrar-web";
import { cobrarLaMesa } from "../../src/composicion/cobrar-mesa-web";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * Anular el cobro de una mesa (SAL-C2): el ticket de una mesa es un ticket de ventas y se anula con la MISMA puerta que el del mostrador (`anularElTicket`, `tickets.corregir`). Anula con motivo y deja registro (quién, cuándo,
 * por qué) y la auditoría; NO toca la caja (el efectivo cobrado sigue en el cajón y el cierre muestra la diferencia) ni reabre la mesa (queda libre); repetir con la misma clave no duplica; dos anulaciones a la vez dejan UNA; sin
 * persona, con un ejemplar equivocado o de otra empresa no se escribe nada. Todo rechazo sale como el genérico aprobado.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const monto = (v: string) => ({ moneda: "ARS", monto: v });
const GENERICO = { ok: false, error: { codigo: "CAJA_ACCION_NO_PERMITIDA" } };

describe.skipIf(base === null)("composición web: anular el cobro de una mesa", () => {
  let m: MundoDeSalon;
  let d: DependenciasDeCobrarWeb;
  let proxima = 0;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarSalon(base);
    d = {
      casosDeUso: () => m.casos,
      consultas: () => m.consultas,
      respuesta: { registrar: () => undefined },
    };
  });
  afterAll(async () => {
    await m.cerrar();
  });

  /** Una mesa con 2 unidades del producto de $ 1000, enviada y cobrada en efectivo; devuelve lo que la pantalla ve. */
  const mesaCobrada = async (e: EscenarioDeVentas) => {
    const caja = await m.cajaAbierta(e);
    const n = ++proxima;
    const mesaId = nuevoId();
    valorDe(
      await m.salon.crearMesa(e.gerente, {
        mesaId,
        sucursalId: e.sucursal,
        numero: n,
        forma: "CUADRADA",
        tamano: "CHICA",
        columna: 1 + ((n - 1) % 7) * 2,
        fila: 1 + Math.floor((n - 1) / 7) * 2,
      }),
    );
    const cuentaId = valorDe(
      await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId }),
    ).cuentaId;
    valorDe(
      await m.salon.agregarAlPedido(e.gerente, {
        cuentaId,
        lineaId: nuevoId(),
        productoId: e.producto,
        opcionIds: [],
        cantidad: "2",
      }),
    );
    valorDe(
      await m.salon.enviarACocina(e.gerente, {
        envioId: nuevoId(),
        cuentaId,
        claveIdempotencia: nuevaClave(),
      }),
    );
    const cobrada = await cobrarLaMesa(
      { casosDeUso: () => m.salon, respuesta: { registrar: () => undefined } },
      e.gerente,
      e.sucursal,
      {
        claveIdempotencia: nuevaClave(),
        cuentaId,
        ejemplarId: nuevoId(),
        totalEsperado: monto("2000.00"),
        cajaId: caja.cajaId,
        cobros: [
          {
            medioDePagoId: caja.medios["EFECTIVO"],
            cuentaDeCobroId: null,
            importe: monto("2000.00"),
          },
        ],
      },
    );
    if (!cobrada.ok) throw new Error("no cobró");
    return {
      mesaId,
      cuentaId,
      ticketId: cobrada.dato.ticketId,
      ejemplarId: cobrada.dato.ejemplarId,
    };
  };
  const anulacion = (c: { ticketId: string; ejemplarId: string }, cambios = {}) => ({
    claveIdempotencia: nuevaClave(),
    ticketId: c.ticketId,
    ejemplarBaseId: c.ejemplarId,
    ejemplarNuevoId: nuevoId(),
    motivo: "Se cobró de más",
    ...cambios,
  });
  const contar = (tabla: string, e: EscenarioDeVentas) =>
    m.contar(`select count(*) as n from ${tabla} where empresa_id = $1`, [e.empresa]);
  const estadoDelTicket = async (ticketId: string) =>
    (await m.filas<{ estado: string }>("select estado from ticket where id = $1", [ticketId]))[0]
      ?.estado;
  const cuentasAbiertas = async (mesaId: string) =>
    m.contar(
      "select count(*) as n from cuenta_consumo where ancla_id = $1 and estado = 'ABIERTA'",
      [mesaId],
    );

  it("anula con motivo: el ticket queda ANULADO con su registro y auditoría, la caja NO se toca y la mesa sigue libre", async () => {
    const e = await m.escenario();
    const c = await mesaCobrada(e);
    const cajaAntes = await contar("movimiento_caja", e);
    const cobranzasAntes = await contar("cobranza_de_ticket", e);
    const r = await anularElTicket(d, e.gerente, anulacion(c));
    expect(r).toMatchObject({ ok: true, dato: { estado: "ANULADO", yaExistia: false } });
    expect(await estadoDelTicket(c.ticketId)).toBe("ANULADO");
    expect(await contar("ticket_correccion", e)).toBe(1);
    expect(await contar("movimiento_caja", e)).toBe(cajaAntes);
    expect(await contar("cobranza_de_ticket", e)).toBe(cobranzasAntes);
    expect(await cuentasAbiertas(c.mesaId)).toBe(0);
    expect(
      await m.contar(
        "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'TICKET_ANULADO'",
        [e.empresa],
      ),
    ).toBe(1);
  });

  it("IDEMPOTENCIA: repetir con la misma clave devuelve lo hecho sin duplicar; la misma clave con otro motivo o sin motivo no anula ni pisa nada", async () => {
    const e = await m.escenario();
    const c = await mesaCobrada(e);
    const pedido = anulacion(c);
    expect((await anularElTicket(d, e.gerente, pedido)).ok).toBe(true);
    expect(await anularElTicket(d, e.gerente, pedido)).toMatchObject({
      ok: true,
      dato: { estado: "ANULADO", yaExistia: true },
    });
    expect(await anularElTicket(d, e.gerente, { ...pedido, motivo: "Otro motivo" })).toMatchObject(
      GENERICO,
    );
    expect(await anularElTicket(d, e.gerente, anulacion(c, { motivo: "" }))).toMatchObject(
      GENERICO,
    );
    expect(await contar("ticket_correccion", e)).toBe(1);
  });

  it("DOS ACTORES: dos anulaciones a la vez del mismo ticket de mesa con claves distintas dejan UNA anulación; la otra sale genérica", async () => {
    const e = await m.escenario();
    const c = await mesaCobrada(e);
    const [x, y] = await Promise.all([
      anularElTicket(d, e.gerente, anulacion(c)),
      anularElTicket(d, e.gerente, anulacion(c)),
    ]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    for (const r of [x, y]) if (!r.ok) expect(r).toMatchObject(GENERICO);
    expect(await contar("ticket_correccion", e)).toBe(1);
    expect(await estadoDelTicket(c.ticketId)).toBe("ANULADO");
  });

  it("AISLAMIENTO, PERMISOS Y EJEMPLAR: otra empresa, sin persona o con un ejemplar que no es el vigente no anulan ni escriben nada", async () => {
    const e = await m.escenario();
    const otra = await m.escenario();
    const c = await mesaCobrada(e);
    expect(await anularElTicket(d, otra.gerente, anulacion(c))).toMatchObject(GENERICO);
    expect((await anularElTicket(d, { ...e.gerente, personaId: null }, anulacion(c))).ok).toBe(
      false,
    );
    expect(
      await anularElTicket(d, e.gerente, anulacion(c, { ejemplarBaseId: nuevoId() })),
    ).toMatchObject(GENERICO);
    expect(await estadoDelTicket(c.ticketId)).toBe("COBRADO");
    expect(await contar("ticket_correccion", e)).toBe(0);
    expect(await contar("ticket_correccion", otra)).toBe(0);
  });
});
