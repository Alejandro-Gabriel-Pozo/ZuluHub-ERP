import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { MAXIMO_DE_CUENTAS_POR_ITEMS } from "../../src/primitivas/cuentas/limites-de-division";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * E7 (T9), dividir la cuenta por ítems (D90, D117): entero, por unidades y compartido entre cuentas; el centavo que sobra va a la Cuenta 1; cada hija tiene
 * SU ticket y SU cobro; la madre queda como reserva de la mesa hasta cobrar la última hija; nada se escribe si la asignación está incompleta.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const monto = (m: string) => ({ moneda: "ARS", monto: m });

describe.skipIf(base === null)("salón: dividir la cuenta", () => {
  let m: MundoDeSalon;
  let e: EscenarioDeVentas;
  let caja: Awaited<ReturnType<MundoDeSalon["cajaAbierta"]>>;
  let barato: string;
  let proxima = 0;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarSalon(base);
    e = await m.escenario();
    caja = await m.cajaAbierta(e);
    barato = await m.productoVendible(e.empresa, "100");
  });
  afterAll(async () => {
    await m.cerrar();
  });

  /** Una mesa con su cuenta y estas líneas (producto y cantidad); `enviar` manda a cocina lo cargado. */
  const mesaConLineas = async (
    lineas: readonly Readonly<{ producto?: string; cantidad: string }>[],
    enviar = true,
  ) => {
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
    const cuenta = valorDe(
      await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId }),
    ).cuentaId;
    const ids: string[] = [];
    for (const l of lineas) {
      const lineaId = nuevoId();
      ids.push(lineaId);
      valorDe(
        await m.salon.agregarAlPedido(e.gerente, {
          cuentaId: cuenta,
          lineaId,
          productoId: l.producto ?? e.producto,
          opcionIds: [],
          cantidad: l.cantidad,
        }),
      );
    }
    if (enviar)
      valorDe(
        await m.salon.enviarACocina(e.gerente, {
          envioId: nuevoId(),
          cuentaId: cuenta,
          claveIdempotencia: nuevaClave(),
        }),
      );
    return { mesaId, numero: n, cuenta, ids };
  };
  const dividir = (
    cuenta: string,
    partes: number,
    asignaciones: Parameters<MundoDeSalon["salon"]["dividirCuenta"]>[1]["asignaciones"],
    divisionId = nuevoId(),
  ) => m.salon.dividirCuenta(e.gerente, { divisionId, cuentaId: cuenta, partes, asignaciones });
  const estado = async (cuenta: string) =>
    (
      await m.filas<{ estado: string }>("select estado from cuenta_consumo where id = $1", [cuenta])
    )[0]?.estado;
  const cobrarHija = (cuenta: string, total: string) =>
    m.salon.cobrarMesa(e.gerente, {
      claveIdempotencia: nuevaClave(),
      cuentaId: cuenta,
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

  it("entero y por unidades: cada cuenta recibe lo suyo sin recotizar y la suma de las hijas es el total de la mesa", async () => {
    const p = await mesaConLineas([{ cantidad: "1" }, { producto: barato, cantidad: "3" }]);
    const r = valorDe(
      await dividir(p.cuenta, 2, [
        { lineaId: p.ids[0] as string, forma: "ENTERO", parte: 1 },
        { lineaId: p.ids[1] as string, forma: "POR_UNIDADES", cantidades: ["1", "2"] },
      ]),
    );
    expect(r.yaExistia).toBe(false);
    expect(r.cuentas.map((c) => [c.numero, c.total.monto])).toEqual([
      [1, "1100.00"],
      [2, "200.00"],
    ]);
    expect(await estado(p.cuenta)).toBe("ABIERTA");
    expect(
      await m.contar(
        "select count(*) as n from linea_cuenta where cuenta_id = $1 and estado = 'VIGENTE'",
        [p.cuenta],
      ),
    ).toBe(0);
    // Lo enviado sigue enviado: ninguna hija vuelve a mandar a cocina lo ya enviado.
    for (const c of r.cuentas) {
      expect(
        await m.contar(
          "select count(*) as n from linea_de_comanda where cuenta_id = $1 and envio_id is not null",
          [c.cuentaId],
        ),
      ).toBeGreaterThan(0);
      expect(
        await m.contar(
          "select count(*) as n from linea_de_comanda where cuenta_id = $1 and envio_id is null",
          [c.cuentaId],
        ),
      ).toBe(0);
    }
    const ficha = valorDe(await m.consultasDeSalon.fichaDeMesa(e.gerente, { mesaId: p.mesaId }));
    expect(ficha.cuentas.map((c) => c.parte)).toEqual([1, 2]);
    const mapa = valorDe(
      await m.consultasDeSalon.mapaDeMesas(e.gerente, { sucursalId: e.sucursal }),
    );
    expect(mapa.find((f) => f.numero === p.numero)).toMatchObject({ estado: "OCUPADA" });
  });

  it("P8: tres gaseosas y un plato entre tres: el plato compartido deja el centavo que sobra en la Cuenta 1", async () => {
    const p = await mesaConLineas([{ producto: barato, cantidad: "1" }]);
    const r = valorDe(
      await dividir(p.cuenta, 3, [
        { lineaId: p.ids[0] as string, forma: "COMPARTIDO", partes: [1, 2, 3] },
      ]),
    );
    expect(r.cuentas.map((c) => c.total.monto)).toEqual(["33.34", "33.33", "33.33"]);
    const suma = r.cuentas.reduce((s, c) => s + Math.round(Number(c.total.monto) * 100), 0);
    expect(suma).toBe(10000);
    // Solo una hija descuenta el stock del ítem compartido.
    expect(
      await m.contar(
        "select count(*) as n from linea_cuenta l join parte_de_division p on p.cuenta_id = l.cuenta_id where p.division_id = (select division_id from parte_de_division where cuenta_id = $1) and l.controla_stock",
        [r.cuentas[0]?.cuentaId],
      ),
    ).toBeLessThanOrEqual(1);
    const ficha = valorDe(await m.consultasDeSalon.fichaDeMesa(e.gerente, { mesaId: p.mesaId }));
    expect(ficha.cuentas[0]?.lineas[0]).toMatchObject({ compartida: true });
  });

  it("P8: ítems de distinta forma a la vez (entero, por unidades y compartido) y el total de la mesa se conserva al centavo", async () => {
    const p = await mesaConLineas([
      { cantidad: "1" },
      { producto: barato, cantidad: "3" },
      { producto: barato, cantidad: "1" },
    ]);
    const r = valorDe(
      await dividir(p.cuenta, 3, [
        { lineaId: p.ids[0] as string, forma: "ENTERO", parte: 3 },
        { lineaId: p.ids[1] as string, forma: "POR_UNIDADES", cantidades: ["1", "1", "1"] },
        { lineaId: p.ids[2] as string, forma: "COMPARTIDO", partes: [1, 2, 3] },
      ]),
    );
    const suma = r.cuentas.reduce((s, c) => s + Math.round(Number(c.total.monto) * 100), 0);
    expect(suma).toBe(1000_00 + 300_00 + 100_00);
    expect(r.cuentas.map((c) => c.total.monto)).toEqual(["133.34", "133.33", "1133.33"]);
  });

  it("D117: sin asignar, unidades que no suman o una cuenta vacía se rechazan ANTES de escribir nada", async () => {
    const p = await mesaConLineas([{ cantidad: "1" }, { producto: barato, cantidad: "2" }]);
    const antes = await m.contar("select count(*) as n from cuenta_consumo", []);
    expect(
      await dividir(p.cuenta, 2, [{ lineaId: p.ids[0] as string, forma: "ENTERO", parte: 1 }]),
    ).toEqual({ ok: false, error: "DIVISION_INCOMPLETA" });
    expect(
      await dividir(p.cuenta, 2, [
        { lineaId: p.ids[0] as string, forma: "ENTERO", parte: 1 },
        { lineaId: p.ids[1] as string, forma: "POR_UNIDADES", cantidades: ["1", "2"] },
      ]),
    ).toEqual({ ok: false, error: "UNIDADES_NO_SUMAN" });
    expect(
      await dividir(p.cuenta, 2, [
        { lineaId: p.ids[0] as string, forma: "ENTERO", parte: 1 },
        { lineaId: p.ids[1] as string, forma: "ENTERO", parte: 1 },
      ]),
    ).toEqual({ ok: false, error: "PARTE_VACIA" });
    expect(await dividir(p.cuenta, MAXIMO_DE_CUENTAS_POR_ITEMS + 1, [])).toEqual({
      ok: false,
      error: "PARTES_INVALIDAS",
    });
    expect(await m.contar("select count(*) as n from cuenta_consumo", [])).toBe(antes);
    expect(
      await m.contar(
        "select count(*) as n from linea_cuenta where cuenta_id = $1 and estado = 'VIGENTE'",
        [p.cuenta],
      ),
    ).toBe(2);
  });

  it("el máximo de cuentas por ítems se divide entero y una más se rechaza sin escribir nada", async () => {
    const hacer = async (n: number) => {
      const p = await mesaConLineas(Array.from({ length: n }, () => ({ cantidad: "1" })));
      return {
        p,
        asignaciones: p.ids.map((lineaId, i) => ({
          lineaId,
          forma: "ENTERO" as const,
          parte: i + 1,
        })),
      };
    };
    const pasado = await hacer(MAXIMO_DE_CUENTAS_POR_ITEMS + 1);
    const antes = await m.contar("select count(*) as n from cuenta_consumo", []);
    expect(
      await dividir(pasado.p.cuenta, MAXIMO_DE_CUENTAS_POR_ITEMS + 1, pasado.asignaciones),
    ).toEqual({ ok: false, error: "PARTES_INVALIDAS" });
    expect(await m.contar("select count(*) as n from cuenta_consumo", [])).toBe(antes);
    expect(
      await m.contar("select count(*) as n from division_de_cuenta where cuenta_madre_id = $1", [
        pasado.p.cuenta,
      ]),
    ).toBe(0);

    const justo = await hacer(MAXIMO_DE_CUENTAS_POR_ITEMS);
    const r = valorDe(
      await dividir(justo.p.cuenta, MAXIMO_DE_CUENTAS_POR_ITEMS, justo.asignaciones),
    );
    expect(r.cuentas.map((c) => c.numero)).toEqual(
      Array.from({ length: MAXIMO_DE_CUENTAS_POR_ITEMS }, (_, i) => i + 1),
    );
    expect(
      await m.contar("select count(*) as n from parte_de_division where division_id = $1", [
        r.divisionId,
      ]),
    ).toBe(MAXIMO_DE_CUENTAS_POR_ITEMS);
  });

  it("I14: doble clic en «Confirmar división» deja una sola división, las cuentas hijas una vez y devuelve yaExistia", async () => {
    const p = await mesaConLineas([{ cantidad: "1" }, { cantidad: "1" }]);
    const divisionId = nuevoId();
    const asig = [
      { lineaId: p.ids[0] as string, forma: "ENTERO" as const, parte: 1 },
      { lineaId: p.ids[1] as string, forma: "ENTERO" as const, parte: 2 },
    ];
    const [a, b] = await Promise.all([
      dividir(p.cuenta, 2, asig, divisionId),
      dividir(p.cuenta, 2, asig, divisionId),
    ]);
    expect([a.ok, b.ok].every(Boolean)).toBe(true);
    const c = valorDe(await dividir(p.cuenta, 2, asig, divisionId));
    expect(c.yaExistia).toBe(true);
    expect(
      await m.contar("select count(*) as n from division_de_cuenta where cuenta_madre_id = $1", [
        p.cuenta,
      ]),
    ).toBe(1);
    expect(
      await m.contar("select count(*) as n from parte_de_division where division_id = $1", [
        divisionId,
      ]),
    ).toBe(2);
    expect(
      await m.contar(
        "select count(*) as n from linea_cuenta where cuenta_id in (select cuenta_id from parte_de_division where division_id = $1) and estado = 'VIGENTE'",
        [divisionId],
      ),
    ).toBe(2);
    // El mismo id con otro reparto no se pisa.
    expect(
      await dividir(
        p.cuenta,
        2,
        [
          { lineaId: p.ids[0] as string, forma: "ENTERO", parte: 2 },
          { lineaId: p.ids[1] as string, forma: "ENTERO", parte: 1 },
        ],
        divisionId,
      ),
    ).toEqual({
      ok: false,
      error: "DIVISION_ID_EN_USO",
    });
  });

  it("P8: dos pedidos distintos de dividir la misma cuenta a la vez: queda una sola división", async () => {
    const p = await mesaConLineas([{ cantidad: "1" }, { cantidad: "1" }]);
    const asig = [
      { lineaId: p.ids[0] as string, forma: "ENTERO" as const, parte: 1 },
      { lineaId: p.ids[1] as string, forma: "ENTERO" as const, parte: 2 },
    ];
    const [a, b] = await Promise.all([dividir(p.cuenta, 2, asig), dividir(p.cuenta, 2, asig)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(
      await m.contar("select count(*) as n from division_de_cuenta where cuenta_madre_id = $1", [
        p.cuenta,
      ]),
    ).toBe(1);
  });

  it("una mesa dividida no se divide, no se une, no se libera, no recibe pedidos ni cambia de mesa", async () => {
    const p = await mesaConLineas([{ cantidad: "1" }, { cantidad: "1" }]);
    const r = valorDe(
      await dividir(p.cuenta, 2, [
        { lineaId: p.ids[0] as string, forma: "ENTERO", parte: 1 },
        { lineaId: p.ids[1] as string, forma: "ENTERO", parte: 2 },
      ]),
    );
    expect(await dividir(p.cuenta, 2, [])).toEqual({ ok: false, error: "MESA_DIVIDIDA" });
    expect(await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId: p.mesaId })).toEqual(
      { ok: false, error: "MESA_DIVIDIDA" },
    );
    expect(await m.salon.liberarMesa(e.gerente, { cuentaId: p.cuenta })).toEqual({
      ok: false,
      error: "MESA_DIVIDIDA",
    });
    const hija = r.cuentas[0]?.cuentaId as string;
    expect(await m.salon.liberarMesa(e.gerente, { cuentaId: hija })).toEqual({
      ok: false,
      error: "MESA_DIVIDIDA",
    });
    const otra = await mesaConLineas([{ cantidad: "1" }]);
    expect(
      await m.salon.unirMesas(e.gerente, {
        unionId: nuevoId(),
        cuentaDestinoId: otra.cuenta,
        cuentaOrigenId: hija,
        clave: nuevaClave(),
      }),
    ).toEqual({ ok: false, error: "MESA_DIVIDIDA" });
  });

  it("P9: cada hija se cobra por separado con su propio ticket; la mesa queda libre recién al cobrarse todas y la madre se anula al final", async () => {
    const p = await mesaConLineas([{ cantidad: "1" }, { producto: barato, cantidad: "1" }]);
    const r = valorDe(
      await dividir(p.cuenta, 2, [
        { lineaId: p.ids[0] as string, forma: "ENTERO", parte: 1 },
        { lineaId: p.ids[1] as string, forma: "ENTERO", parte: 2 },
      ]),
    );
    const [h1, h2] = [r.cuentas[0], r.cuentas[1]] as [
      (typeof r.cuentas)[number],
      (typeof r.cuentas)[number],
    ];
    const v1 = valorDe(await cobrarHija(h1.cuentaId, "1000.00"));
    expect(v1.estado).toBe("COBRADO");
    // Cobrar una no libera la mesa: la otra sigue abierta y la madre también.
    expect(await estado(p.cuenta)).toBe("ABIERTA");
    expect(await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId: p.mesaId })).toEqual(
      { ok: false, error: "MESA_DIVIDIDA" },
    );
    const v2 = valorDe(await cobrarHija(h2.cuentaId, "100.00"));
    expect(v2.numero).not.toBe(v1.numero);
    expect(await estado(p.cuenta)).toBe("ANULADA");
    expect(
      (
        await m.filas<{ motivo: string }>("select motivo from cuenta_consumo where id = $1", [
          p.cuenta,
        ])
      )[0]?.motivo,
    ).toBe("DIVISION_COBRADA");
    expect(
      await m.contar("select count(*) as n from ticket where cuenta_id in ($1, $2)", [
        h1.cuentaId,
        h2.cuentaId,
      ]),
    ).toBe(2);
    expect(
      valorDe(await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId: p.mesaId }))
        .yaExistia,
    ).toBe(false);
  });

  it("dividir a la vez que otro agrega a la cuenta: el ítem agregado queda en la madre rechazada o la división falla, nunca un ítem perdido", async () => {
    const p = await mesaConLineas([{ cantidad: "1" }, { cantidad: "1" }]);
    const [d, a] = await Promise.all([
      dividir(p.cuenta, 2, [
        { lineaId: p.ids[0] as string, forma: "ENTERO", parte: 1 },
        { lineaId: p.ids[1] as string, forma: "ENTERO", parte: 2 },
      ]),
      m.salon.agregarAlPedido(e.administrador, {
        cuentaId: p.cuenta,
        lineaId: nuevoId(),
        productoId: e.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    ]);
    const vigentesEnHijas = await m.contar(
      "select count(*) as n from linea_cuenta where estado = 'VIGENTE' and cuenta_id in (select cuenta_id from parte_de_division where division_id in (select id from division_de_cuenta where cuenta_madre_id = $1))",
      [p.cuenta],
    );
    const vigentesEnMadre = await m.contar(
      "select count(*) as n from linea_cuenta where estado = 'VIGENTE' and cuenta_id = $1",
      [p.cuenta],
    );
    if (d.ok) {
      // Dividió primero: el agregado llegó a una cuenta de reserva y se rechazó; o entró antes y se repartió (DIVISION_INCOMPLETA).
      expect(vigentesEnMadre).toBe(0);
      expect(vigentesEnHijas).toBe(a.ok ? 3 : 2);
    } else {
      expect(vigentesEnHijas).toBe(0);
      expect(vigentesEnMadre).toBe(a.ok ? 3 : 2);
    }
  });
});
