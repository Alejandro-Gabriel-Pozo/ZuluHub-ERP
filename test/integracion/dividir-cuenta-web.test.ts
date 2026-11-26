import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  dividirLaCuenta,
  type DependenciasDeDividirCuentaWeb,
} from "../../src/composicion/dividir-cuenta-web";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * «Dividir la cuenta» por ítems de la web (`dividir-cuenta-web.ts`, SAL-E2) contra una base real: el reparto es exacto al centavo (el que sobra va a la Cuenta 1), repetir no duplica cuentas, la sucursal
 * la fija el servidor, los motivos de «unir» no salen como «No se pueden unir» y dos hijas cobradas a la vez anulan la madre UNA sola vez y liberan la mesa al cobrar la última.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const GENERICO = { ok: false, error: { codigo: "CATALOGO_ACCION_NO_PERMITIDA" } };
const monto = (m: string) => ({ moneda: "ARS", monto: m });

describe.skipIf(base === null)("composición web: dividir la cuenta", () => {
  let m: MundoDeSalon;
  let d: DependenciasDeDividirCuentaWeb;
  const proxima = new Map<string, number>();
  beforeAll(async () => {
    if (base === null) return;
    m = await montarSalon(base);
    d = { casosDeUso: () => m.salon, respuesta: { registrar: () => undefined } };
  });
  afterAll(async () => {
    await m.cerrar();
  });

  /** Una mesa con 3 gaseosas de $ 1000 y un plato de $ 3001, todo enviado a cocina (así cada hija se puede cobrar). */
  const mesaConLaCuenta = async (e: EscenarioDeVentas) => {
    const n = (proxima.get(e.empresa) ?? 0) + 1;
    proxima.set(e.empresa, n);
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
    const plato = await m.productoVendible(e.empresa, "3001.00");
    const agregar = async (productoId: string, cantidad: string) => {
      const lineaId = nuevoId();
      valorDe(
        await m.salon.agregarAlPedido(e.gerente, {
          cuentaId,
          lineaId,
          productoId,
          opcionIds: [],
          cantidad,
        }),
      );
      return lineaId;
    };
    const gaseosas = await agregar(e.producto, "3");
    const platoId = await agregar(plato, "1");
    valorDe(
      await m.salon.enviarACocina(e.gerente, {
        envioId: nuevoId(),
        cuentaId,
        claveIdempotencia: nuevaClave(),
      }),
    );
    return { mesaId, cuentaId, gaseosas, platoId };
  };
  const asignaciones = (x: { gaseosas: string; platoId: string }) => [
    { lineaId: x.gaseosas, forma: "POR_UNIDADES", cantidades: ["1", "1", "1"] },
    { lineaId: x.platoId, forma: "COMPARTIDO", partes: [1, 2, 3] },
  ];
  const dividir = (
    e: EscenarioDeVentas,
    x: { cuentaId: string; gaseosas: string; platoId: string },
    extra: Record<string, unknown> = {},
    sucursal: string = e.sucursal,
  ) =>
    dividirLaCuenta(d, e.gerente, sucursal, {
      divisionId: nuevoId(),
      cuentaId: x.cuentaId,
      partes: 3,
      asignaciones: asignaciones(x),
      ...extra,
    });
  const divisiones = (cuentaId: string) =>
    m.contar("select count(*) as n from division_de_cuenta where cuenta_madre_id = $1", [cuentaId]);
  const estadoDe = async (cuentaId: string) =>
    (
      await m.filas<{ estado: string }>("select estado from cuenta_consumo where id = $1", [
        cuentaId,
      ])
    )[0]?.estado;
  const cobrar = (
    e: EscenarioDeVentas,
    caja: Awaited<ReturnType<MundoDeSalon["cajaAbierta"]>>,
    cuentaId: string,
    total: string,
  ) =>
    m.salon.cobrarMesa(e.gerente, {
      sucursalDeTrabajo: e.sucursal,
      claveIdempotencia: nuevaClave(),
      cuentaId,
      ejemplarId: nuevoId(),
      totalEsperado: monto(total),
      cobro: {
        cajaId: caja.cajaId,
        cobros: [
          {
            medioDePagoId: caja.medios["EFECTIVO"] as string,
            cuentaDeCobroId: null,
            importe: monto(total),
          },
        ],
      },
    });

  it("DINERO: el plato de $ 3001,00 entre tres deja $ 1000,34 en la Cuenta 1 y $ 1000,33 en las otras; las tres cuentas suman $ 6001,00 al centavo", async () => {
    const e = await m.escenario();
    const x = await mesaConLaCuenta(e);
    const r = await dividir(e, x);
    expect(r).toMatchObject({ ok: true, dato: { yaExistia: false } });
    const totales = (r.ok ? r.dato.cuentas : []).map((c) => c.total.monto);
    expect(totales).toEqual(["2000.34", "2000.33", "2000.33"]);
    expect(await estadoDe(x.cuentaId)).toBe("ABIERTA");
  });

  it("IDEMPOTENCIA: repetir la misma división devuelve las mismas tres cuentas (no seis); el mismo divisionId con otra asignación no se pisa", async () => {
    const e = await m.escenario();
    const x = await mesaConLaCuenta(e);
    const pedido = { divisionId: nuevoId() };
    const primera = await dividir(e, x, pedido);
    const segunda = await dividir(e, x, pedido);
    expect(segunda).toMatchObject({ ok: true, dato: { yaExistia: true } });
    expect(segunda.ok && segunda.dato.cuentas).toEqual(primera.ok && primera.dato.cuentas);
    expect(await divisiones(x.cuentaId)).toBe(1);
    const otra = [
      { lineaId: x.gaseosas, forma: "ENTERO", parte: 1 },
      { lineaId: x.platoId, forma: "ENTERO", parte: 2 },
    ];
    expect(await dividir(e, x, { ...pedido, partes: 2, asignaciones: otra })).toMatchObject(
      GENERICO,
    );
    expect(await divisiones(x.cuentaId)).toBe(1);
  });

  it("DOS ACTORES: cobrar dos hijas a la vez anula la madre una sola vez y la mesa queda libre al cobrar la tercera", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const x = await mesaConLaCuenta(e);
    const hecho = await dividir(e, x);
    if (!hecho.ok) throw new Error("la división no se hizo");
    const hijas = hecho.dato.cuentas;
    const [a, b, c] = hijas as [(typeof hijas)[0], (typeof hijas)[0], (typeof hijas)[0]];
    const [r1, r2] = await Promise.all([
      cobrar(e, caja, a.cuentaId, a.total.monto),
      cobrar(e, caja, b.cuentaId, b.total.monto),
    ]);
    expect([r1.ok, r2.ok]).toEqual([true, true]);
    expect(await estadoDe(x.cuentaId)).toBe("ABIERTA");
    valorDe(await cobrar(e, caja, c.cuentaId, c.total.monto));
    expect(await estadoDe(x.cuentaId)).toBe("ANULADA");
    const mapa = valorDe(
      await m.consultasDeSalon.mapaDeMesas(e.gerente, { sucursalId: e.sucursal, filtro: "TODAS" }),
    );
    expect(mapa.find((z) => z.mesaId === x.mesaId)?.estado).toBe("LIBRE");
  });

  it("AISLAMIENTO: una cuenta de otra sucursal o de otra empresa, o sin sucursal de trabajo, es el genérico y no divide nada", async () => {
    const e = await m.escenario();
    const otra = await m.escenario();
    const x = await mesaConLaCuenta(e);
    const ajena = await mesaConLaCuenta(otra);
    expect(await dividir(e, x, {}, e.otraSucursal)).toMatchObject(GENERICO);
    expect(await dividir(e, x, {}, "")).toMatchObject(GENERICO);
    expect(await dividir(e, ajena)).toMatchObject(GENERICO);
    expect(await divisiones(x.cuentaId)).toBe(0);
    expect(await divisiones(ajena.cuentaId)).toBe(0);
  });

  it("PERMISOS, FORMA Y MOTIVOS: sin persona o con más cuentas que el tope no se escribe nada; una cuenta que ya recibió una unión sale como el genérico, no como «No se pueden unir»", async () => {
    const e = await m.escenario();
    const x = await mesaConLaCuenta(e);
    const y = await mesaConLaCuenta(e);
    expect(
      (
        await dividirLaCuenta(d, { ...e.gerente, personaId: null }, e.sucursal, {
          divisionId: nuevoId(),
          cuentaId: x.cuentaId,
          partes: 3,
          asignaciones: asignaciones(x),
        })
      ).ok,
    ).toBe(false);
    expect(await dividir(e, x, { partes: 11 })).toMatchObject(GENERICO);
    expect(await dividir(e, x, { asignaciones: [] })).toMatchObject(GENERICO);
    expect(await dividir(e, x, { cuentaId: "no-es-un-id" })).toMatchObject(GENERICO);
    valorDe(
      await m.salon.unirMesas(e.gerente, {
        sucursalDeTrabajo: e.sucursal,
        unionId: nuevoId(),
        cuentaDestinoId: x.cuentaId,
        cuentaOrigenId: y.cuentaId,
        clave: nuevaClave(),
      }),
    );
    expect(await dividir(e, x, { asignaciones: [] })).toMatchObject(GENERICO);
    expect(await divisiones(x.cuentaId)).toBe(0);
  });
  it("LA FICHA de la mesa dividida trae cada cuenta con sus platos como se enviaron; al cobrar una queda cobrada y la otra sigue pendiente", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const x = await mesaConLaCuenta(e);
    const hecho = await dividir(e, x);
    if (!hecho.ok) throw new Error("la división no se hizo");
    const [a, b, c] = hecho.dato.cuentas as [
      (typeof hecho.dato.cuentas)[0],
      (typeof hecho.dato.cuentas)[0],
      (typeof hecho.dato.cuentas)[0],
    ];
    const ficha = async () =>
      valorDe(await m.consultasDeSalon.fichaDeMesa(e.gerente, { mesaId: x.mesaId }));
    const antes = await ficha();
    expect(antes.cuentas.map((h) => [h.parte, h.cobrada, h.total.monto])).toEqual([
      [1, false, "2000.34"],
      [2, false, "2000.33"],
      [3, false, "2000.33"],
    ]);
    for (const h of antes.cuentas) {
      expect(h.lineas.length).toBeGreaterThan(0);
      expect(h.lineas.every((l) => l.comanda === "ENVIADA")).toBe(true);
      expect(h.lineas.every((l) => l.pasoDeCantidad !== "")).toBe(true);
    }
    valorDe(await cobrar(e, caja, b.cuentaId, b.total.monto));
    const despues = await ficha();
    expect(despues.cuentas.map((h) => [h.parte, h.cobrada])).toEqual([
      [1, false],
      [2, true],
      [3, false],
    ]);
    expect(despues.estado).not.toBe("LIBRE");
    valorDe(await cobrar(e, caja, a.cuentaId, a.total.monto));
    valorDe(await cobrar(e, caja, c.cuentaId, c.total.monto));
  });
});
