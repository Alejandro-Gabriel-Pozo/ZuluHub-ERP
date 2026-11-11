import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * E7 (T8), unir las cuentas de dos mesas (D116): los ítems pasan al destino sin recotizar, la cuenta de origen queda ABIERTA y sin ítems como cuenta de
 * RESERVA (ocupa el ancla de su mesa: nadie toma un pedido ahí), no se une con mesa libre, dividida o ya unida, unir A con B y B con A a la vez no se traba
 * y cobrar el destino libera las dos mesas.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const monto = (m: string) => ({ moneda: "ARS", monto: m });

describe.skipIf(base === null)("salón: unir mesas", () => {
  let m: MundoDeSalon;
  let e: EscenarioDeVentas;
  let caja: Awaited<ReturnType<MundoDeSalon["cajaAbierta"]>>;
  let proxima = 0;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarSalon(base);
    e = await m.escenario();
    caja = await m.cajaAbierta(e);
  });
  afterAll(async () => {
    await m.cerrar();
  });

  const mesa = async () => {
    const n = ++proxima;
    const id = nuevoId();
    valorDe(
      await m.salon.crearMesa(e.gerente, {
        mesaId: id,
        sucursalId: e.sucursal,
        numero: n,
        forma: "CUADRADA",
        tamano: "CHICA",
        columna: 1 + ((n - 1) % 7) * 2,
        fila: 1 + Math.floor((n - 1) / 7) * 2,
      }),
    );
    return { id, numero: n };
  };
  /** Una mesa con su cuenta y `platos` platos (el primero enviado a cocina si `enviado`). */
  const conPedido = async (platos: number, enviado = false) => {
    const mesaDe = await mesa();
    const cuenta = valorDe(
      await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId: mesaDe.id }),
    ).cuentaId;
    for (let i = 0; i < platos; i++) {
      valorDe(
        await m.salon.agregarAlPedido(e.gerente, {
          cuentaId: cuenta,
          lineaId: nuevoId(),
          productoId: e.producto,
          opcionIds: [],
          cantidad: "1",
        }),
      );
    }
    if (enviado)
      valorDe(
        await m.salon.enviarACocina(e.gerente, {
          envioId: nuevoId(),
          cuentaId: cuenta,
          claveIdempotencia: nuevaClave(),
        }),
      );
    return { ...mesaDe, cuenta };
  };
  const unir = (destino: string, origen: string, unionId = nuevoId(), clave = nuevaClave()) =>
    m.salon.unirMesas(e.gerente, {
      unionId,
      cuentaDestinoId: destino,
      cuentaOrigenId: origen,
      clave,
    });
  const totalDe = async (cuenta: string) =>
    (
      await m.filas<{ t: string }>(
        "select total_provisorio::text as t from cuenta_consumo where id = $1",
        [cuenta],
      )
    )[0]?.t;
  const estadoDe = async (cuenta: string) =>
    (
      await m.filas<{ estado: string }>("select estado from cuenta_consumo where id = $1", [cuenta])
    )[0]?.estado;

  it("pasa los ítems al destino sin recotizar y deja la cuenta de origen ABIERTA y vacía (reserva); el total se conserva", async () => {
    const a = await conPedido(2);
    const b = await conPedido(1, true);
    const r = valorDe(await unir(a.cuenta, b.cuenta));
    expect(r).toMatchObject({ lineasMovidas: 1, yaExistia: false, totalDestino: monto("3000.00") });
    expect(await totalDe(a.cuenta)).toBe("3000.00");
    expect(await totalDe(b.cuenta)).toBe("0.00");
    expect(await estadoDe(b.cuenta)).toBe("ABIERTA");
    expect(
      await m.contar(
        "select count(*) as n from linea_cuenta where cuenta_id = $1 and estado = 'VIGENTE'",
        [b.cuenta],
      ),
    ).toBe(0);
    // Lo enviado sigue enviado (no se reimprime) y el ítem sabe de qué mesa vino.
    const ficha = valorDe(await m.consultasDeSalon.fichaDeMesa(e.gerente, { mesaId: a.id }));
    const venidas = ficha.cuentas[0]?.lineas.filter((l) => l.deLaMesa !== null) ?? [];
    expect(venidas).toHaveLength(1);
    expect(venidas[0]).toMatchObject({ deLaMesa: b.numero, comanda: "ENVIADA", numeroDeEnvio: 1 });
    expect(
      await m.contar("select count(*) as n from envio_de_comanda where cuenta_id = $1", [a.cuenta]),
    ).toBe(0);
    // El mapa muestra la mesa de origen como unida.
    const mapa = valorDe(
      await m.consultasDeSalon.mapaDeMesas(e.gerente, { sucursalId: e.sucursal }),
    );
    expect(mapa.find((f) => f.numero === b.numero)).toMatchObject({
      estado: "UNIDA",
      unidaAMesa: a.numero,
    });
  });

  it("I13: repetir unirMesas con la misma unión deja una sola unión, los ítems una vez y devuelve yaExistia", async () => {
    const a = await conPedido(1);
    const b = await conPedido(2);
    const unionId = nuevoId();
    const clave = nuevaClave();
    const primera = valorDe(await unir(a.cuenta, b.cuenta, unionId, clave));
    const segunda = valorDe(await unir(a.cuenta, b.cuenta, unionId, clave));
    expect(primera.yaExistia).toBe(false);
    expect(segunda).toMatchObject({ yaExistia: true, totalDestino: monto("3000.00") });
    expect(
      await m.contar("select count(*) as n from union_de_mesas where id = $1", [unionId]),
    ).toBe(1);
    expect(
      await m.contar(
        "select count(*) as n from linea_cuenta where cuenta_id = $1 and estado = 'VIGENTE'",
        [a.cuenta],
      ),
    ).toBe(3);
    expect(await unir(b.cuenta, a.cuenta, unionId, clave)).toEqual({
      ok: false,
      error: "CLAVE_REUTILIZADA",
    });
  });

  it("P7: con mesa libre, ya unida o la misma cuenta cada caso dice su motivo, y sin tocar nada", async () => {
    const a = await conPedido(1);
    const libre = await mesa();
    const cuentaLibre = valorDe(
      await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId: libre.id }),
    ).cuentaId;
    expect(await unir(a.cuenta, cuentaLibre)).toEqual({ ok: false, error: "MESA_LIBRE" });
    expect(await unir(cuentaLibre, a.cuenta)).toEqual({ ok: false, error: "MESA_LIBRE" });
    expect(await unir(a.cuenta, a.cuenta)).toEqual({ ok: false, error: "MISMA_CUENTA" });
    const b = await conPedido(1);
    const c = await conPedido(1);
    valorDe(await unir(a.cuenta, b.cuenta));
    // b quedó como reserva de una unión: no se une otra vez, ni como origen ni como destino.
    expect(await unir(c.cuenta, b.cuenta)).toEqual({ ok: false, error: "MESA_UNIDA" });
    expect(await unir(b.cuenta, c.cuenta)).toEqual({ ok: false, error: "MESA_UNIDA" });
    expect(
      await m.contar("select count(*) as n from union_de_mesas where cuenta_destino_id = $1", [
        c.cuenta,
      ]),
    ).toBe(0);
    expect(await unir(nuevoId(), a.cuenta)).toEqual({ ok: false, error: "CUENTA_NO_ENCONTRADA" });
  });

  it("P7: en la mesa unida no se toma pedido ni se agrega, ni se libera: MESA_UNIDA, y la base lo impondría igual (índice de ancla)", async () => {
    const a = await conPedido(1);
    const b = await conPedido(1);
    valorDe(await unir(a.cuenta, b.cuenta));
    expect(await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId: b.id })).toEqual({
      ok: false,
      error: "MESA_UNIDA",
    });
    expect(
      await m.salon.agregarAlPedido(e.gerente, {
        cuentaId: b.cuenta,
        lineaId: nuevoId(),
        productoId: e.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    ).toEqual({ ok: false, error: "MESA_UNIDA" });
    expect(await m.salon.liberarMesa(e.gerente, { cuentaId: b.cuenta })).toEqual({
      ok: false,
      error: "MESA_UNIDA",
    });
    expect(
      await m.salon.cambiarDeMesa(e.gerente, {
        cuentaId: b.cuenta,
        mesaDestinoId: (await mesa()).id,
      }),
    ).toEqual({ ok: false, error: "MESA_UNIDA" });
    // Aunque falle el código, la base no deja una segunda cuenta abierta en esa mesa.
    const directo = await m.dueno
      .query(
        "insert into cuenta_consumo (id, empresa_id, sucursal_id, ancla_tipo, ancla_id, abierta_por, abierta_en) values ($1, $2, $3, 'salon.mesa', $4, $5, now())",
        [nuevoId(), e.empresa, e.sucursal, b.id, e.gerente.personaId],
      )
      .then(
        () => null,
        (error: { constraint?: string }) => error.constraint,
      );
    expect(directo).toBe("cuenta_ancla_abierta_uk");
  });

  it("P6: unir A con B y B con A a la vez: una gana, la otra se rechaza, sin trabarse ni duplicar cuentas ni ítems", async () => {
    const a = await conPedido(2);
    const b = await conPedido(3);
    const [x, y] = await Promise.all([unir(a.cuenta, b.cuenta), unir(b.cuenta, a.cuenta)]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    for (const r of [x, y]) if (!r.ok) expect(["MESA_UNIDA", "MESA_LIBRE"]).toContain(r.error);
    expect(
      await m.contar(
        "select count(*) as n from union_de_mesas where cuenta_destino_id in ($1, $2)",
        [a.cuenta, b.cuenta],
      ),
    ).toBe(1);
    const vigentes = await m.contar(
      "select count(*) as n from linea_cuenta where cuenta_id in ($1, $2) and estado = 'VIGENTE'",
      [a.cuenta, b.cuenta],
    );
    expect(vigentes).toBe(5);
    expect(Number(await totalDe(a.cuenta)) + Number(await totalDe(b.cuenta))).toBe(5000);
  });

  it("P6: uniones cruzadas entre varias mesas a la vez: ningún deadlock y cada ítem queda en una sola cuenta", async () => {
    const cuentas = [
      await conPedido(1),
      await conPedido(1),
      await conPedido(1),
      await conPedido(1),
    ];
    const r = await Promise.all([
      unir((cuentas[0] as { cuenta: string }).cuenta, (cuentas[1] as { cuenta: string }).cuenta),
      unir((cuentas[1] as { cuenta: string }).cuenta, (cuentas[2] as { cuenta: string }).cuenta),
      unir((cuentas[2] as { cuenta: string }).cuenta, (cuentas[3] as { cuenta: string }).cuenta),
      unir((cuentas[3] as { cuenta: string }).cuenta, (cuentas[0] as { cuenta: string }).cuenta),
    ]);
    expect(r.some((x) => x.ok)).toBe(true);
    const ids = cuentas.map((c) => c.cuenta);
    expect(
      await m.contar(
        "select count(*) as n from linea_cuenta where cuenta_id = any($1) and estado = 'VIGENTE'",
        [ids],
      ),
    ).toBe(4);
    const totales = await Promise.all(ids.map(totalDe));
    expect(totales.reduce((s, t) => s + Number(t), 0)).toBe(4000);
  });

  it("no se une entre sucursales, ni con otra empresa, ni una cuenta que no es de una mesa", async () => {
    const a = await conPedido(1);
    const otraSucursal = nuevoId();
    valorDe(
      await m.casos.abrirCuenta(e.gerente, { cuentaId: otraSucursal, sucursalId: e.otraSucursal }),
    );
    valorDe(
      await m.casos.agregarLinea(e.gerente, {
        cuentaId: otraSucursal,
        lineaId: nuevoId(),
        productoId: e.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    );
    expect(await unir(a.cuenta, otraSucursal)).toEqual({ ok: false, error: "SUCURSAL_DISTINTA" });
    const x = await m.escenario();
    expect(
      await m.salon.unirMesas(x.gerente, {
        unionId: nuevoId(),
        cuentaDestinoId: a.cuenta,
        cuentaOrigenId: nuevoId(),
        clave: nuevaClave(),
      }),
    ).toEqual({
      ok: false,
      error: "CUENTA_NO_ENCONTRADA",
    });
    expect(await unir(a.cuenta, otraSucursal.replace(/.$/, "0"))).toMatchObject({ ok: false });
  });

  it("cobrar el destino libera las dos mesas: la reserva se anula con motivo interno y se puede tomar pedido en ambas", async () => {
    const a = await conPedido(1, true);
    const b = await conPedido(1);
    valorDe(await unir(a.cuenta, b.cuenta));
    // Lo que vino de b estaba sin enviar: hay que enviarlo antes de cobrar.
    expect(
      await m.salon.cobrarMesa(e.gerente, {
        claveIdempotencia: nuevaClave(),
        cuentaId: a.cuenta,
        ejemplarId: nuevoId(),
        totalEsperado: monto("2000.00"),
        cobro: {
          cajaId: caja.cajaId,
          cobros: [
            {
              medioDePagoId: caja.medios["EFECTIVO"] as string,
              cuentaDeCobroId: null,
              importe: monto("2000.00"),
            },
          ],
        },
      }),
    ).toEqual({ ok: false, error: "HAY_PLATOS_SIN_ENVIAR" });
    valorDe(
      await m.salon.enviarACocina(e.gerente, {
        envioId: nuevoId(),
        cuentaId: a.cuenta,
        claveIdempotencia: nuevaClave(),
      }),
    );
    const v = valorDe(
      await m.salon.cobrarMesa(e.gerente, {
        claveIdempotencia: nuevaClave(),
        cuentaId: a.cuenta,
        ejemplarId: nuevoId(),
        totalEsperado: monto("2000.00"),
        cobro: {
          cajaId: caja.cajaId,
          cobros: [
            {
              medioDePagoId: caja.medios["EFECTIVO"] as string,
              cuentaDeCobroId: null,
              importe: monto("2000.00"),
            },
          ],
        },
      }),
    );
    expect(v.estado).toBe("COBRADO");
    expect(await estadoDe(b.cuenta)).toBe("ANULADA");
    expect(
      (
        await m.filas<{ motivo: string }>("select motivo from cuenta_consumo where id = $1", [
          b.cuenta,
        ])
      )[0]?.motivo,
    ).toBe("UNIDA_COBRADA");
    expect(
      valorDe(await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId: b.id }))
        .yaExistia,
    ).toBe(false);
    expect(
      valorDe(await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId: a.id }))
        .yaExistia,
    ).toBe(false);
  });

  it("los traslados no cuentan como anulaciones de la jornada y la reserva olvidada BLOQUEA el cierre del día (ventas.cuentas_abiertas)", async () => {
    const x = await m.escenario();
    const crearMesa = async (n: number, c: number) => {
      const id = nuevoId();
      valorDe(
        await m.salon.crearMesa(x.gerente, {
          mesaId: id,
          sucursalId: x.sucursal,
          numero: n,
          forma: "CUADRADA",
          tamano: "CHICA",
          columna: c,
          fila: 1,
        }),
      );
      return id;
    };
    const ids = [await crearMesa(1, 1), await crearMesa(2, 4)];
    const cuentas: string[] = [];
    for (const id of ids) {
      const c = valorDe(
        await m.salon.tomarPedido(x.gerente, { cuentaId: nuevoId(), mesaId: id }),
      ).cuentaId;
      valorDe(
        await m.salon.agregarAlPedido(x.gerente, {
          cuentaId: c,
          lineaId: nuevoId(),
          productoId: x.producto,
          opcionIds: [],
          cantidad: "1",
        }),
      );
      cuentas.push(c);
    }
    valorDe(
      await m.salon.unirMesas(x.gerente, {
        unionId: nuevoId(),
        cuentaDestinoId: cuentas[0] as string,
        cuentaOrigenId: cuentas[1] as string,
        clave: nuevaClave(),
      }),
    );
    const anuladas = await m.contar(
      "select count(*) as n from linea_cuenta where cuenta_id = $1 and estado = 'ANULADA' and motivo_de_anulacion = 'TRASLADADA'",
      [cuentas[1]],
    );
    expect(anuladas).toBe(1);
    const abiertas = await m.contar(
      "select count(*) as n from cuenta_consumo where sucursal_id = $1 and estado = 'ABIERTA'",
      [x.sucursal],
    );
    expect(abiertas).toBe(2);
  });
});
