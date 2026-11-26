import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE as REGLAS } from "./ventas-apoyo";
import {
  crearCasosDeUsoDeCierre,
  huellaDeControles,
  type AporteAlCierreDelDia,
} from "../../src/modulos/cierre/publico";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import type { TxDePrueba } from "./entorno";
import { agotadaEnElResultado, repetirSiAgotada } from "./concurrencia-apoyo";
import { ayudantesDeCuentaCorriente } from "./ventas-a-cuenta-apoyo";
import {
  FECHA_DE_NEGOCIO,
  cuentaConLinea,
  montarVentas,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * CC-5: `venderACuenta`, la venta rápida a cuenta corriente en UN acto (abrir, agregar, cerrar a nombre del cliente y cargar al libro, sin caja ni cobro), con casos de uso reales y una base real
 * (SERIALIZABLE). Previene: una venta a cuenta que deje cuenta abierta, número gastado, stock descontado o auditoría cuando el cargo se rechaza; la misma venta repetida (doble clic, reintento, corte de
 * red) que duplique ticket, número o deuda; otro cliente, otras líneas u otro total con la misma clave devueltos como si fueran la venta original; dos ventas a la vez al mismo cliente que superen el límite;
 * un total que sale del pedido y no del catálogo; y datos de una empresa vistos o movidos desde otra.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type Pedido = Parameters<MundoDeVentas["casos"]["venderACuenta"]>[1];
const monto = (v: string) => ({ moneda: "ARS", monto: v });

describe.skipIf(base === null)("ventas: venta a cuenta corriente (CC-5)", () => {
  let m: MundoDeVentas;
  let e: EscenarioDeVentas;
  let otra: EscenarioDeVentas;
  let a: ReturnType<typeof ayudantesDeCuentaCorriente>;

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, { conexiones: 16, cuentaCorriente: true });
    a = ayudantesDeCuentaCorriente(m);
    e = await m.escenario();
    otra = await m.escenario();
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  /** El pedido de una venta de un producto de $1000; cada cambio pisa un campo. */
  const pedido = (
    de: EscenarioDeVentas,
    clienteId: string,
    cambios: Partial<Pedido> = {},
  ): Pedido => ({
    cuentaId: nuevoId(),
    ejemplarId: nuevoId(),
    sucursalId: de.sucursal,
    lineas: [{ lineaId: nuevoId(), productoId: de.producto, opcionIds: [], cantidad: "1" }],
    totalEsperado: monto("1000.00"),
    clienteId,
    ...cambios,
  });
  const vender = (contexto: ContextoOperativo, p: Pedido) => m.casos.venderACuenta(contexto, p);
  /** Lo que una venta a cuenta deja en la base: cuenta, líneas, ticket, ejemplares, auditoría y movimientos de caja de esa cuenta. */
  const huellaDeBase = async (cuenta: string) => ({
    cuentas: await m.contar("select count(*) as n from cuenta_consumo where id = $1", [cuenta]),
    lineas: await m.contar("select count(*) as n from linea_cuenta where cuenta_id = $1", [cuenta]),
    tickets: await m.contar("select count(*) as n from ticket where cuenta_id = $1", [cuenta]),
    cobranzas: await m.contar(
      "select count(*) as n from cobranza_de_ticket c join ticket t on t.id = c.ticket_id where t.cuenta_id = $1",
      [cuenta],
    ),
  });
  const nada = { cuentas: 0, lineas: 0, tickets: 0, cobranzas: 0 };
  const ticket = async (id: string) =>
    (
      await m.filas<{
        estado: string;
        numero: number;
        total: string;
        sesion_de_caja_id: string | null;
        fecha_negocio: string;
        cargado_a_parte_id: string | null;
      }>(
        "select estado, numero, total::text, sesion_de_caja_id, fecha_negocio::text, cargado_a_parte_id from ticket where id = $1",
        [id],
      )
    )[0];
  const auditado = async (de: EscenarioDeVentas, cuenta: string) =>
    (await m.auditoria(de.empresa)).filter((f) => JSON.stringify(f).includes(cuenta)).length;

  it("vende a cuenta: ticket EMITIDO sin caja ni sesión, UN cargo por el total en el libro (el total sale del catálogo), con fecha de negocio por reloj y todo auditado", async () => {
    const c = await a.cliente(e);
    const p = pedido(e, c);
    const r = valorDe(await vender(e.gerente, p));
    expect(r).toMatchObject({
      estado: "EMITIDO",
      yaEstabaCerrada: false,
      clienteId: c,
      total: monto("1000.00"),
      numeroDeCorreccion: 0,
      fechaNegocio: FECHA_DE_NEGOCIO,
      ejemplarId: p.ejemplarId,
    });
    expect(await ticket(r.ticketId)).toMatchObject({
      estado: "EMITIDO",
      total: "1000.00",
      sesion_de_caja_id: null,
      fecha_negocio: FECHA_DE_NEGOCIO,
      cargado_a_parte_id: c,
    });
    expect(await huellaDeBase(p.cuentaId)).toEqual({ ...nada, cuentas: 1, lineas: 1, tickets: 1 });
    expect(await a.asientos(e, c)).toMatchObject([
      {
        importe: "1000.00",
        clase: "CARGO_DE_VENTA_A_CUENTA",
        sentido: "A_COBRAR",
        origen_id: r.ticketId,
      },
    ]);
    expect(await a.saldo(e, c)).toBe("1000.00");
    expect(await auditado(e, p.cuentaId)).toBeGreaterThanOrEqual(3); // cuenta abierta, cuenta cerrada y ticket emitido
  });

  it("el cajero (operador) vende a cuenta en su sucursal dentro del límite", async () => {
    const c = await a.cliente(e);
    valorDe(await vender(e.operador, pedido(e, c)));
    expect(await a.saldo(e, c)).toBe("1000.00");
  });

  it("el total sale del servidor: un total esperado distinto del catálogo es PRECIO_CAMBIO con el total actual y no se escribe nada (ni cuenta, ni líneas, ni cargo)", async () => {
    const c = await a.cliente(e);
    const p = pedido(e, c, { totalEsperado: monto("999.00") });
    const r = await vender(e.gerente, p);
    expect(r).toMatchObject({
      ok: false,
      error: { error: "PRECIO_CAMBIO", totalActual: monto("1000.00") },
    });
    expect(await huellaDeBase(p.cuentaId)).toEqual(nada);
    expect(await a.asientos(e, c)).toEqual([]);
  });

  it("entrada inválida: sin líneas, líneas repetidas, ids mal formados, moneda o importe inválidos y cliente ausente o mal formado se rechazan sin escribir nada", async () => {
    const c = await a.cliente(e);
    const unaLinea = pedido(e, c).lineas[0] as Pedido["lineas"][number];
    const casos: ReadonlyArray<readonly [Partial<Pedido>, string]> = [
      [{ lineas: [] }, "ENTRADA_INVALIDA"],
      [{ lineas: [unaLinea, unaLinea] }, "ENTRADA_INVALIDA"],
      [{ cuentaId: "no-es-un-uuid" }, "IDENTIFICADOR_INVALIDO"],
      [{ ejemplarId: "no-es-un-uuid" }, "IDENTIFICADOR_INVALIDO"],
      [{ clienteId: "no-es-un-uuid" }, "IDENTIFICADOR_INVALIDO"],
      [{ clienteId: undefined as unknown as string }, "IDENTIFICADOR_INVALIDO"],
      [{ totalEsperado: { moneda: "USD", monto: "1000.00" } }, "MONEDA_NO_SOPORTADA"],
      [{ totalEsperado: monto("1e3") }, "IMPORTE_INVALIDO"],
      [{ totalEsperado: monto("-1000.00") }, "IMPORTE_INVALIDO"],
      [{ totalEsperado: monto("1000.005") }, "IMPORTE_INVALIDO"],
      [{ totalEsperado: monto("") }, "IMPORTE_INVALIDO"],
    ];
    const totales = () =>
      Promise.all([
        m.contar("select count(*) as n from cuenta_consumo where empresa_id = $1", [e.empresa]),
        m.contar("select count(*) as n from ticket where sucursal_id = $1", [e.sucursal]),
      ]);
    const antes = await totales();
    for (const [cambios, error] of casos) {
      const p = pedido(e, c, cambios);
      expect(await vender(e.gerente, p), JSON.stringify(cambios)).toEqual({ ok: false, error });
    }
    // Ninguna entrada inválida dejó una cuenta o un ticket, y el cliente no se movió.
    expect(await totales()).toEqual(antes);
    expect(await a.asientos(e, c)).toEqual([]);
  });

  it("el cliente tiene que ser válido y tener la cuenta habilitada: de otra empresa, inexistente, sin ficha o suspendido dan su error y no queda cuenta, línea, ticket ni cargo", async () => {
    const ajeno = await a.cliente(otra);
    const sinFicha = await a.cliente(e, { sinFicha: true });
    const suspendido = await a.cliente(e, { suspendida: true });
    const casos: ReadonlyArray<readonly [string, string]> = [
      [ajeno, "CLIENTE_NO_VALIDO"],
      [nuevoId(), "CLIENTE_NO_VALIDO"],
      [sinFicha, "CLIENTE_SIN_CUENTA_HABILITADA"],
      [suspendido, "CUENTA_SUSPENDIDA"],
    ];
    for (const [cliente, error] of casos) {
      const p = pedido(e, cliente);
      expect(await vender(e.gerente, p), error).toEqual({ ok: false, error });
      expect(await huellaDeBase(p.cuentaId)).toEqual(nada);
    }
    expect(await a.asientos(otra, ajeno)).toEqual([]);
    expect(await a.asientos(e, sinFicha)).toEqual([]);
    expect(await a.asientos(e, suspendido)).toEqual([]);
  });

  it("límite: el saldo igual al límite pasa; un centavo más pide aprobación, que solo vale con motivo y con `aprobar_exceso` (el gerente), y queda auditada", async () => {
    const justo = await a.cliente(e, { limite: "1000.00" });
    valorDe(await vender(e.gerente, pedido(e, justo)));
    expect(await a.saldo(e, justo)).toBe("1000.00");

    const c = await a.cliente(e, { limite: "999.99" });
    const sinAprobar = pedido(e, c);
    expect(await vender(e.gerente, sinAprobar)).toEqual({ ok: false, error: "EXCEDE_EL_LIMITE" });
    const sinMotivo = pedido(e, c, { aprobacionDelExceso: { motivo: "   " } });
    expect(await vender(e.gerente, sinMotivo)).toEqual({ ok: false, error: "EXCEDE_EL_LIMITE" });
    const operadorAprueba = pedido(e, c, {
      aprobacionDelExceso: { motivo: "Cliente de confianza" },
    });
    expect(await vender(e.operador, operadorAprueba)).toEqual({
      ok: false,
      error: "EXCEDE_EL_LIMITE",
    });
    for (const p of [sinAprobar, sinMotivo, operadorAprueba]) {
      expect(await huellaDeBase(p.cuentaId)).toEqual(nada);
    }
    expect(await a.asientos(e, c)).toEqual([]);
    const aprobada = pedido(e, c, { aprobacionDelExceso: { motivo: "Cliente de confianza" } });
    const r = valorDe(await vender(e.gerente, aprobada));
    expect(await a.saldo(e, c)).toBe("1000.00");
    const auditoria = (await m.auditoria(e.empresa, "cuenta_corriente.aprobar_exceso")).find(
      (f) => (f.despues as { ticketId?: string }).ticketId === r.ticketId,
    );
    expect(auditoria?.actor_persona_id).toBe(e.gerente.personaId);
  });

  it("sin persona o sin membresía en la empresa, no pasa nada y no se escribe nada; el operador de una sucursal ajena recibe SUCURSAL_FUERA_DE_ALCANCE", async () => {
    const c = await a.cliente(e);
    for (const contexto of [{ ...e.gerente, personaId: null }]) {
      const p = pedido(e, c);
      const r = await vender(contexto, p);
      expect(r.ok).toBe(false);
      expect(await huellaDeBase(p.cuentaId)).toEqual(nada);
    }
    const ajena = pedido(e, c, { sucursalId: e.otraSucursal });
    expect(await vender(e.operador, ajena)).toEqual({
      ok: false,
      error: "SUCURSAL_FUERA_DE_ALCANCE",
    });
    expect(await huellaDeBase(ajena.cuentaId)).toEqual(nada);
    expect(await a.asientos(e, c)).toEqual([]);
  });

  it("con la jornada CERRADA no se vende a cuenta (JORNADA_CERRADA) y no se escribe nada", async () => {
    const x = await m.escenario();
    const c = await a.cliente(x);
    await cuentaConLinea(m, x); // abrir una cuenta crea la jornada del día
    const sinAportes: readonly AporteAlCierreDelDia<TxDePrueba>[] = [];
    const cierre = crearCasosDeUsoDeCierre({
      transacciones: m.entorno,
      reglas: REGLAS,
      aportes: sinAportes,
    });
    const entrada = { sucursalId: x.sucursal, fechaDeNegocio: FECHA_DE_NEGOCIO };
    valorDe(await cierre.iniciarAuditoria(x.gerente, entrada));
    valorDe(
      await cierre.cerrarJornada(x.gerente, {
        ...entrada,
        huellaVista: huellaDeControles([]),
        reconocimientos: [],
        observacion: null,
      }),
    );
    const p = pedido(x, c);
    expect(await vender(x.gerente, p)).toEqual({ ok: false, error: "JORNADA_CERRADA" });
    expect(await huellaDeBase(p.cuentaId)).toEqual(nada);
    expect(await a.asientos(x, c)).toEqual([]);
  });

  describe("idempotencia (la clave es la cuenta)", () => {
    it("I9: repetir venderACuenta con la misma cuenta deja una venta, un ticket y un cargo, y devuelve yaEstabaCerrada", async () => {
      const c = await a.cliente(e);
      const p = pedido(e, c);
      const primera = valorDe(await vender(e.gerente, p));
      const auditoriaAntes = await auditado(e, p.cuentaId);
      const segunda = valorDe(await vender(e.gerente, p));
      const tercera = valorDe(await vender(e.gerente, p));
      expect(segunda).toEqual({ ...primera, yaEstabaCerrada: true });
      expect(tercera).toEqual(segunda);
      expect(await huellaDeBase(p.cuentaId)).toEqual({
        ...nada,
        cuentas: 1,
        lineas: 1,
        tickets: 1,
      });
      expect(await a.asientos(e, c)).toHaveLength(1);
      expect(await a.saldo(e, c)).toBe("1000.00");
      expect(await auditado(e, p.cuentaId)).toBe(auditoriaAntes);
    });

    it("la repetición se devuelve aunque el catálogo ya cueste otra cosa (la idempotencia va primero) y aunque la jornada ya esté cerrada", async () => {
      const x = await m.escenario();
      const c = await a.cliente(x);
      const p = pedido(x, c);
      const primera = valorDe(await vender(x.gerente, p));
      await m.precio({
        empresa: x.empresa,
        producto: x.producto,
        precio: "2000",
        desde: "2026-11-09T00:00:00Z",
      });
      expect(valorDe(await vender(x.gerente, p))).toEqual({ ...primera, yaEstabaCerrada: true });
      expect(await a.saldo(x, c)).toBe("1000.00");
    });

    it("el mismo `cuentaId` con otro cliente, otras líneas, otro total esperado u otro ejemplar es CLAVE_REUTILIZADA y no escribe ni carga nada", async () => {
      const c = await a.cliente(e);
      const otroCliente = await a.cliente(e);
      const p = pedido(e, c);
      valorDe(await vender(e.gerente, p));
      const distintos: ReadonlyArray<readonly [string, Partial<Pedido>]> = [
        ["otro cliente", { clienteId: otroCliente }],
        [
          "otra cantidad",
          {
            lineas: [{ ...(p.lineas[0] as Pedido["lineas"][number]), cantidad: "2" }],
          },
        ],
        [
          "otro id de línea",
          {
            lineas: [{ ...(p.lineas[0] as Pedido["lineas"][number]), lineaId: nuevoId() }],
          },
        ],
        [
          "una línea de más",
          {
            lineas: [
              ...p.lineas,
              { lineaId: nuevoId(), productoId: e.producto, opcionIds: [], cantidad: "1" },
            ],
          },
        ],
        ["otro total esperado", { totalEsperado: monto("1001.00") }],
        ["otro ejemplar", { ejemplarId: nuevoId() }],
      ];
      for (const [nombre, cambios] of distintos) {
        expect(await vender(e.gerente, { ...p, ...cambios }), nombre).toEqual({
          ok: false,
          error: "CLAVE_REUTILIZADA",
        });
      }
      expect(await a.asientos(e, c)).toHaveLength(1);
      expect(await a.asientos(e, otroCliente)).toEqual([]);
      expect(await huellaDeBase(p.cuentaId)).toEqual({
        ...nada,
        cuentas: 1,
        lineas: 1,
        tickets: 1,
      });
    });

    it("una cuenta cerrada por otro camino (sin cliente) no se devuelve como venta a cuenta: CLAVE_REUTILIZADA; una cuenta abierta con ese id no se adopta: CUENTA_ID_EN_USO", async () => {
      const c = await a.cliente(e);
      const cerrada = await cuentaConLinea(m, e);
      const ejemplar = nuevoId();
      valorDe(
        await m.casos.cerrarCuenta(e.gerente, { cuentaId: cerrada.cuenta, ejemplarId: ejemplar }),
      );
      const sobreCerrada = pedido(e, c, { cuentaId: cerrada.cuenta, ejemplarId: ejemplar });
      expect(await vender(e.gerente, sobreCerrada)).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });

      const abierta = await cuentaConLinea(m, e);
      const sobreAbierta = pedido(e, c, { cuentaId: abierta.cuenta });
      expect(await vender(e.gerente, sobreAbierta)).toEqual({
        ok: false,
        error: "CUENTA_ID_EN_USO",
      });
      // La cuenta abierta sigue como estaba: una línea, sin ticket.
      expect(await huellaDeBase(abierta.cuenta)).toEqual({ ...nada, cuentas: 1, lineas: 1 });
      expect(await a.asientos(e, c)).toEqual([]);
    });
  });

  describe("atomicidad", () => {
    it("si el cargo se rechaza no queda nada: ni cuenta abierta, ni líneas, ni ticket, ni asiento, ni auditoría, y el número de ticket NO se gasta", async () => {
      const x = await m.escenario();
      const buena = await a.cliente(x);
      const justa = await a.cliente(x, { limite: "999.99" });
      const antes = valorDe(await vender(x.gerente, pedido(x, buena)));
      const rechazada = pedido(x, justa);
      expect(await vender(x.gerente, rechazada)).toEqual({ ok: false, error: "EXCEDE_EL_LIMITE" });
      expect(await huellaDeBase(rechazada.cuentaId)).toEqual(nada);
      expect(await auditado(x, rechazada.cuentaId)).toBe(0);
      expect(await a.asientos(x, justa)).toEqual([]);
      expect(await a.saldo(x, justa)).toBe("0");
      // El número que iba a usar la rechazada lo toma la siguiente venta: sin huecos.
      const despues = valorDe(await vender(x.gerente, pedido(x, buena)));
      expect(despues.numero).toBe(antes.numero + 1);
    });
  });

  describe("concurrencia (dos actores)", () => {
    const firme = <R extends { readonly ok: boolean }>(trabajo: () => Promise<R>) =>
      repetirSiAgotada(trabajo, { esAgotada: (r) => agotadaEnElResultado(r as never) });
    const dosALaVez = async <A, B>(f: () => Promise<A>, g: () => Promise<B>): Promise<[A, B]> => {
      m.armarBarrera(2);
      try {
        return await Promise.all([f(), g()]);
      } finally {
        m.soltarBarrera();
      }
    };

    it("dos venderACuenta de la MISMA cuenta a la vez (doble clic): uno cierra y el otro devuelve lo hecho; un ticket, un número, un cargo", async () => {
      const x = await m.escenario();
      const c = await a.cliente(x);
      const p = pedido(x, c);
      const [r1, r2] = await dosALaVez(
        () => firme(() => vender(x.gerente, p)),
        () => firme(() => vender(x.gerente, p)),
      );
      const v1 = valorDe(r1);
      const v2 = valorDe(r2);
      expect(v2.ticketId).toBe(v1.ticketId);
      expect([v1.yaEstabaCerrada, v2.yaEstabaCerrada].sort()).toEqual([false, true]);
      expect(await huellaDeBase(p.cuentaId)).toEqual({
        ...nada,
        cuentas: 1,
        lineas: 1,
        tickets: 1,
      });
      expect(await a.asientos(x, c)).toHaveLength(1);
      expect(await a.saldo(x, c)).toBe("1000.00");
      expect(
        await m.contar("select count(*) as n from ticket where sucursal_id = $1", [x.sucursal]),
      ).toBe(1);
    });

    it("dos venderACuenta de la MISMA cuenta a la vez con CLIENTES distintos: uno gana y el otro es CLAVE_REUTILIZADA; un solo cargo, al cliente que ganó", async () => {
      const x = await m.escenario();
      const c1 = await a.cliente(x);
      const c2 = await a.cliente(x);
      const p1 = pedido(x, c1);
      const p2 = { ...p1, clienteId: c2 };
      const [r1, r2] = await dosALaVez(
        () => firme(() => vender(x.gerente, p1)),
        () => firme(() => vender(x.gerente, p2)),
      );
      expect([r1.ok, r2.ok].filter(Boolean)).toHaveLength(1);
      expect([r1, r2].filter((r) => !r.ok)).toEqual([{ ok: false, error: "CLAVE_REUTILIZADA" }]);
      const gano = r1.ok ? c1 : c2;
      const perdio = r1.ok ? c2 : c1;
      expect(await a.asientos(x, gano)).toHaveLength(1);
      expect(await a.asientos(x, perdio)).toEqual([]);
      expect(await huellaDeBase(p1.cuentaId)).toEqual({
        ...nada,
        cuentas: 1,
        lineas: 1,
        tickets: 1,
      });
    });

    it("dos ventas a cuenta del MISMO cliente (cuentas distintas) a la vez, con límite para una sola: una pasa y la otra da EXCEDE_EL_LIMITE sin dejar cuenta, línea, ticket ni cargo", async () => {
      const x = await m.escenario();
      const c = await a.cliente(x, { limite: "1500.00" });
      const p1 = pedido(x, c);
      const p2 = pedido(x, c);
      const [r1, r2] = await dosALaVez(
        () => firme(() => vender(x.gerente, p1)),
        () => firme(() => vender(x.operador, p2)),
      );
      const resultados = [r1, r2];
      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      expect(resultados.filter((r) => !r.ok)).toEqual([{ ok: false, error: "EXCEDE_EL_LIMITE" }]);
      const gano = r1.ok ? p1 : p2;
      const perdio = r1.ok ? p2 : p1;
      expect(await huellaDeBase(gano.cuentaId)).toEqual({
        ...nada,
        cuentas: 1,
        lineas: 1,
        tickets: 1,
      });
      expect(await huellaDeBase(perdio.cuentaId)).toEqual(nada);
      expect(await a.asientos(x, c)).toHaveLength(1);
      expect(await a.saldo(x, c)).toBe("1000.00");
    });
  });

  describe("aislamiento entre empresas", () => {
    it("otra empresa no vende en una sucursal ajena ni carga a un cliente ajeno, y el libro de la primera no se mueve", async () => {
      const c = await a.cliente(e);
      const saldoAntes = await a.saldo(e, c);
      const asientosAntes = await a.asientos(e, c);
      // La sucursal de `e` desde `otra`: no existe para ella.
      const enSucursalAjena = pedido(otra, c, { sucursalId: e.sucursal });
      const r1 = await vender(otra.gerente, enSucursalAjena);
      expect(r1.ok).toBe(false);
      expect(await huellaDeBase(enSucursalAjena.cuentaId)).toEqual(nada);
      // Su propia sucursal con un cliente de `e`: CLIENTE_NO_VALIDO y nada escrito.
      const conClienteAjeno = pedido(otra, c);
      expect(await vender(otra.gerente, conClienteAjeno)).toEqual({
        ok: false,
        error: "CLIENTE_NO_VALIDO",
      });
      expect(await huellaDeBase(conClienteAjeno.cuentaId)).toEqual(nada);
      expect(await a.saldo(e, c)).toBe(saldoAntes);
      expect(await a.asientos(e, c)).toEqual(asientosAntes);
    });

    it("la misma venta en dos empresas distintas vive en cada una: cada cliente se carga solo en la suya", async () => {
      const ce = await a.cliente(e);
      const co = await a.cliente(otra);
      const re = valorDe(await vender(e.gerente, pedido(e, ce)));
      const ro = valorDe(await vender(otra.gerente, pedido(otra, co)));
      expect(re.ticketId).not.toBe(ro.ticketId);
      expect(await a.asientos(e, co)).toEqual([]);
      expect(await a.asientos(otra, ce)).toEqual([]);
      expect(await a.saldo(e, ce)).toBe("1000.00");
      expect(await a.saldo(otra, co)).toBe("1000.00");
    });
  });

  it("una venta a $0 a cuenta se rechaza con VENTA_A_CERO_A_CUENTA, con o sin la confirmación de cortesía: no queda cuenta, línea, ticket ni asiento", async () => {
    const x = await m.escenario();
    const gratis = await m.productoVendible(x.empresa, "0");
    const c = await a.cliente(x);
    const linea = () => [{ lineaId: nuevoId(), productoId: gratis, opcionIds: [], cantidad: "1" }];
    for (const confirmaciones of [undefined, [], ["VENTA_A_CERO"]]) {
      const p = pedido(x, c, {
        lineas: linea(),
        totalEsperado: monto("0.00"),
        ...(confirmaciones === undefined ? {} : { confirmaciones }),
      });
      expect(await vender(x.gerente, p), JSON.stringify(confirmaciones)).toEqual({
        ok: false,
        error: "VENTA_A_CERO_A_CUENTA",
      });
      expect(await huellaDeBase(p.cuentaId)).toEqual(nada);
    }
    expect(await a.asientos(x, c)).toEqual([]);
    expect(await a.saldo(x, c)).toBe("0");
  });
});
