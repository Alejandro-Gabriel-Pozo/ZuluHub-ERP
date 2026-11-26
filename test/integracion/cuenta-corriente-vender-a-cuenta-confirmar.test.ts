import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  cerrarLaMesaACuenta,
  venderLaVentaACuenta,
  type DependenciasDeCerrarLaMesaACuenta,
  type DependenciasDeVenderACuentaEnElMostrador,
} from "../../src/composicion/vender-a-cuenta-web";
import { HUELLA, claveNueva } from "./caja-apoyo";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { cuitUnico, sufijoUnico } from "./unicos";
import { ayudantesDeCuentaCorriente } from "./ventas-a-cuenta-apoyo";
import {
  montarVentas,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * «Confirmar venta a cuenta» y «cerrar la mesa a cuenta» por la composición de la web (CC-5 B1b) con una base real: el pedido de la hoja entra por una lista de permitidos estricta (sin aprobación del exceso, sin
 * sucursal, sin caja ni cobros), la sucursal la fija el servidor y todo rechazo de negocio sale como el genérico sin escribir nada. Previene: una venta que se carga dos veces por un doble clic, un reintento o dos pestañas
 * (la misma cuenta y el mismo ejemplar devuelven el mismo ticket y UN cargo); dos ventas a la vez al mismo cliente que juntas pasan el límite; una aprobación del exceso colada por el pedido; un cliente de otra empresa; y
 * una venta a medias (cuenta, ticket, stock y cargo, todo o nada).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const GENERICO = {
  ok: false,
  error: expect.objectContaining({ codigo: "CAJA_ACCION_NO_PERMITIDA" }) as unknown,
};
const monto = (v: string) => ({ moneda: "ARS", monto: v });
const respuesta = { registrar: () => undefined };

describe.skipIf(base === null)(
  "cuenta corriente: confirmar la venta a cuenta en la web (B1b)",
  () => {
    let m: MundoDeVentas;
    let e: EscenarioDeVentas;
    let otra: EscenarioDeVentas;
    let a: ReturnType<typeof ayudantesDeCuentaCorriente>;
    let d: DependenciasDeVenderACuentaEnElMostrador;

    beforeAll(async () => {
      if (base === null) return;
      m = await montarVentas(base, { conexiones: 16, cuentaCorriente: true });
      a = ayudantesDeCuentaCorriente(m);
      e = await m.escenario();
      otra = await m.escenario();
      d = { casosDeUso: () => m.casos, respuesta };
    });
    afterAll(async () => {
      if (base !== null) await m.cerrar();
    });

    /** El pedido de la hoja: un producto de $ 1000; cada cambio pisa un campo. La `claveIdempotencia` la agrega el envío de la hoja a todo pedido. */
    const pedido = (clienteId: string, cambios: Record<string, unknown> = {}) => ({
      claveIdempotencia: claveNueva(),
      cuentaId: nuevoId(),
      ejemplarId: nuevoId(),
      clienteId,
      lineas: [{ lineaId: nuevoId(), productoId: e.producto, opcionIds: [], cantidad: "1" }],
      totalEsperado: monto("1000.00"),
      ...cambios,
    });
    const tickets = (cuenta: string) =>
      m.contar("select count(*) as n from ticket where cuenta_id = $1", [cuenta]);
    const cuentas = (cuenta: string) =>
      m.contar("select count(*) as n from cuenta_consumo where id = $1", [cuenta]);

    it("confirma: ticket cargado al cliente sin caja ni cobros, UN cargo por el total del catálogo", async () => {
      const c = await a.cliente(e);
      const p = pedido(c);
      const r = await venderLaVentaACuenta(d, e.operador, e.sucursal, p);
      expect(r).toMatchObject({
        ok: true,
        dato: {
          estado: "EMITIDO",
          total: monto("1000.00"),
          yaExistia: false,
          ejemplarId: p.ejemplarId,
        },
      });
      expect(Object.keys(r.ok ? r.dato : {}).sort()).toEqual([
        "ejemplarId",
        "estado",
        "fechaNegocio",
        "numero",
        "ticketId",
        "total",
        "yaExistia",
      ]);
      expect(await a.saldo(e, c)).toBe("1000.00");
      expect(await a.asientos(e, c)).toHaveLength(1);
    });

    it("IDEMPOTENCIA: repetir el mismo pedido (doble clic, reintento tras perder la respuesta) devuelve el MISMO ticket y no vuelve a cargar", async () => {
      const c = await a.cliente(e);
      const p = pedido(c);
      const primera = await venderLaVentaACuenta(d, e.operador, e.sucursal, p);
      // El reintento lleva otra clave de envío: la identidad de la venta es la cuenta con el ejemplar.
      const segunda = await venderLaVentaACuenta(d, e.operador, e.sucursal, {
        ...p,
        claveIdempotencia: claveNueva(),
      });
      expect(primera.ok && segunda.ok).toBe(true);
      if (!primera.ok || !segunda.ok) return;
      expect(segunda.dato.ticketId).toBe(primera.dato.ticketId);
      expect(segunda.dato.numero).toBe(primera.dato.numero);
      expect(segunda.dato.yaExistia).toBe(true);
      expect(await tickets(p.cuentaId)).toBe(1);
      expect(await a.saldo(e, c)).toBe("1000.00");
      expect(await a.asientos(e, c)).toHaveLength(1);
    });

    it("CONCURRENCIA: el mismo pedido desde dos pestañas a la vez deja UN ticket y UN cargo", async () => {
      const c = await a.cliente(e);
      const p = pedido(c);
      const resultados = await Promise.all([
        venderLaVentaACuenta(d, e.operador, e.sucursal, p),
        venderLaVentaACuenta(d, e.operador, e.sucursal, { ...p, claveIdempotencia: claveNueva() }),
      ]);
      const buenos = resultados.filter((r) => r.ok);
      expect(buenos.length).toBeGreaterThanOrEqual(1);
      expect(new Set(buenos.map((r) => (r.ok ? r.dato.ticketId : ""))).size).toBe(1);
      expect(await tickets(p.cuentaId)).toBe(1);
      expect(await a.asientos(e, c)).toHaveLength(1);
      expect(await a.saldo(e, c)).toBe("1000.00");
    });

    it("CONCURRENCIA: dos ventas distintas al mismo cliente con límite para UNA: una se carga y la otra es el genérico, sin pasar el límite", async () => {
      const c = await a.cliente(e, { limite: "1500.00" });
      const [uno, dos] = [pedido(c), pedido(c)];
      const r = await Promise.all([
        venderLaVentaACuenta(d, e.operador, e.sucursal, uno),
        venderLaVentaACuenta(d, e.gerente, e.sucursal, dos),
      ]);
      expect(r.filter((x) => x.ok)).toHaveLength(1);
      expect(r.filter((x) => !x.ok)).toEqual([GENERICO]);
      expect(await a.saldo(e, c)).toBe("1000.00");
      expect((await tickets(uno.cuentaId)) + (await tickets(dos.cuentaId))).toBe(1);
    });

    it("con el límite pasado todo es el genérico y no escribe nada (en la primera etapa nadie aprueba el exceso)", async () => {
      const c = await a.cliente(e, { limite: "500.00" });
      for (const quien of [e.operador, e.gerente, e.administrador]) {
        const p = pedido(c);
        expect(await venderLaVentaACuenta(d, quien, e.sucursal, p)).toEqual(GENERICO);
        expect(await cuentas(p.cuentaId)).toBe(0);
        expect(await tickets(p.cuentaId)).toBe(0);
      }
      expect(await a.asientos(e, c)).toHaveLength(0);
    });

    it("el pedido NO admite aprobar el exceso, ni sucursal, ni caja, ni cobros: un campo de más rechaza el pedido entero", async () => {
      const c = await a.cliente(e, { limite: "500.00" });
      const extras: Record<string, unknown>[] = [
        { aprobacionDelExceso: { motivo: "Lo autoriza el gerente" } },
        { sucursalId: otra.sucursal },
        { cajaId: nuevoId() },
        { cobros: [] },
        { propina: "10.00" },
      ];
      for (const extra of extras) {
        const p = pedido(c, extra);
        expect(await venderLaVentaACuenta(d, e.gerente, e.sucursal, p)).toEqual(GENERICO);
        expect(await cuentas(p.cuentaId)).toBe(0);
      }
      expect(await a.asientos(e, c)).toHaveLength(0);
    });

    it("la sucursal la pone el servidor: sin sucursal de trabajo no se vende; un cliente de otra empresa, un total que cambió y un pedido mal formado son el genérico sin escribir", async () => {
      const c = await a.cliente(e);
      const sinSucursal = pedido(c);
      expect(await venderLaVentaACuenta(d, e.operador, "", sinSucursal)).toEqual(GENERICO);
      expect(await cuentas(sinSucursal.cuentaId)).toBe(0);

      const ajeno = await a.cliente(otra);
      const deOtra = pedido(ajeno);
      expect(await venderLaVentaACuenta(d, e.gerente, e.sucursal, deOtra)).toEqual(GENERICO);
      expect(await cuentas(deOtra.cuentaId)).toBe(0);

      const cambio = pedido(c, { totalEsperado: monto("999.00") });
      expect(await venderLaVentaACuenta(d, e.operador, e.sucursal, cambio)).toEqual(GENERICO);
      expect(await cuentas(cambio.cuentaId)).toBe(0);

      for (const roto of [null, "texto", {}, pedido(c, { clienteId: "no-es-un-id" })]) {
        expect(await venderLaVentaACuenta(d, e.operador, e.sucursal, roto)).toEqual(GENERICO);
      }
      expect(await a.asientos(e, c)).toHaveLength(0);
    });

    it("un cliente suspendido o sin cuenta es el genérico y no escribe", async () => {
      for (const o of [{ suspendida: true }, { sinFicha: true }]) {
        const c = await a.cliente(e, o);
        const p = pedido(c);
        expect(await venderLaVentaACuenta(d, e.operador, e.sucursal, p)).toEqual(GENERICO);
        expect(await cuentas(p.cuentaId)).toBe(0);
      }
    });
  },
);

describe.skipIf(base === null)("cuenta corriente: cerrar la mesa a cuenta en la web (B1b)", () => {
  let m: MundoDeSalon;
  let e: EscenarioDeVentas;
  let otra: EscenarioDeVentas;
  let d: DependenciasDeCerrarLaMesaACuenta;
  let proxima = 0;

  beforeAll(async () => {
    if (base === null) return;
    m = await montarSalon(base, { conexiones: 16, cuentaCorriente: true });
    e = await m.escenario();
    otra = await m.escenario();
    d = { casosDeUso: () => m.salon, respuesta };
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  const mesaConPlato = async (escenario = e) => {
    const n = ++proxima;
    const mesaId = nuevoId();
    valorDe(
      await m.salon.crearMesa(escenario.gerente, {
        mesaId,
        sucursalId: escenario.sucursal,
        numero: n,
        forma: "CUADRADA",
        tamano: "CHICA",
        columna: 1 + ((n - 1) % 7) * 2,
        fila: 1 + Math.floor((n - 1) / 7) * 2,
      }),
    );
    const cuenta = valorDe(
      await m.salon.tomarPedido(escenario.gerente, { cuentaId: nuevoId(), mesaId }),
    ).cuentaId;
    valorDe(
      await m.salon.agregarAlPedido(escenario.gerente, {
        cuentaId: cuenta,
        lineaId: nuevoId(),
        productoId: escenario.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    );
    valorDe(
      await m.salon.enviarACocina(escenario.gerente, {
        envioId: nuevoId(),
        cuentaId: cuenta,
        claveIdempotencia: claveNueva(),
      }),
    );
    return cuenta;
  };
  const cliente = async (de: EscenarioDeVentas = e, limite = "100000.00"): Promise<string> => {
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
       values ($1, $2, 30, $3, $4, $5, $6)`,
      [de.empresa, id, limite, claveNueva(), HUELLA, de.gerente.personaId],
    );
    return id;
  };
  const pedido = (cuenta: string, clienteId: string, cambios: Record<string, unknown> = {}) => ({
    claveIdempotencia: claveNueva(),
    cuentaId: cuenta,
    ejemplarId: nuevoId(),
    clienteId,
    totalEsperado: monto("1000.00"),
    ...cambios,
  });
  const tickets = (cuenta: string) =>
    m.contar("select count(*) as n from ticket where cuenta_id = $1", [cuenta]);
  const cargos = (clienteId: string) =>
    m.contar("select count(*) as n from asiento_de_saldo where empresa_id = $1 and parte_id = $2", [
      e.empresa,
      clienteId,
    ]);

  it("cierra la mesa a cuenta: ticket cargado al cliente y UN cargo", async () => {
    const cuenta = await mesaConPlato();
    const c = await cliente();
    const r = await cerrarLaMesaACuenta(d, e.operador, e.sucursal, pedido(cuenta, c));
    expect(r).toMatchObject({ ok: true, dato: { estado: "EMITIDO", yaExistia: false } });
    expect(await tickets(cuenta)).toBe(1);
    expect(await cargos(c)).toBe(1);
  });

  it("IDEMPOTENCIA Y CONCURRENCIA: repetir, o mandar a la vez desde dos pestañas, deja UN ticket y UN cargo", async () => {
    const cuenta = await mesaConPlato();
    const c = await cliente();
    const p = pedido(cuenta, c);
    const r = await Promise.all([
      cerrarLaMesaACuenta(d, e.operador, e.sucursal, p),
      cerrarLaMesaACuenta(d, e.operador, e.sucursal, { ...p, claveIdempotencia: claveNueva() }),
    ]);
    expect(r.filter((x) => x.ok).length).toBeGreaterThanOrEqual(1);
    const otraVez = await cerrarLaMesaACuenta(d, e.operador, e.sucursal, {
      ...p,
      claveIdempotencia: claveNueva(),
    });
    expect(otraVez).toMatchObject({ ok: true, dato: { yaExistia: true } });
    expect(await tickets(cuenta)).toBe(1);
    expect(await cargos(c)).toBe(1);
  });

  it("con el límite pasado es el genérico y la mesa sigue abierta, sin ticket ni cargo; el pedido no admite aprobación del exceso ni líneas", async () => {
    const cuenta = await mesaConPlato();
    const c = await cliente(e, "500.00");
    expect(await cerrarLaMesaACuenta(d, e.gerente, e.sucursal, pedido(cuenta, c))).toEqual(
      GENERICO,
    );
    for (const extra of [
      { aprobacionDelExceso: { motivo: "Autorizado" } },
      { lineas: [] },
      { sucursalId: otra.sucursal },
    ]) {
      expect(await cerrarLaMesaACuenta(d, e.gerente, e.sucursal, pedido(cuenta, c, extra))).toEqual(
        GENERICO,
      );
    }
    expect(await tickets(cuenta)).toBe(0);
    expect(await cargos(c)).toBe(0);
  });

  it("la sucursal la fija el servidor: una cuenta de otra sucursal, sin sucursal de trabajo o un cliente de otra empresa son el genérico", async () => {
    const cuenta = await mesaConPlato();
    const c = await cliente();
    expect(await cerrarLaMesaACuenta(d, e.operador, "", pedido(cuenta, c))).toEqual(GENERICO);
    expect(await cerrarLaMesaACuenta(d, e.gerente, e.otraSucursal, pedido(cuenta, c))).toEqual(
      GENERICO,
    );
    const ajeno = await cliente(otra);
    expect(await cerrarLaMesaACuenta(d, e.gerente, e.sucursal, pedido(cuenta, ajeno))).toEqual(
      GENERICO,
    );
    expect(await tickets(cuenta)).toBe(0);
    expect(await cargos(c)).toBe(0);
  });
});
