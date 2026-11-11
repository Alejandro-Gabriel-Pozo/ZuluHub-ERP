import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * E7 (T6), el pedido de una mesa, el envío a cocina desde la mesa, el cambio de mesa y el cobro de la mesa con los casos de uso reales, el puerto real
 * de caja y el rol de la aplicación: idempotencia (I5 a I12), dos mozos a la vez sobre lo mismo (misma cuenta, números de envío sin huecos, una sola
 * mesa libre), «Cobrar» con platos sin enviar (P4), atomicidad contra una caja que rechaza (P5), aislamiento y permisos (P13).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const monto = (m: string) => ({ moneda: "ARS", monto: m });

describe.skipIf(base === null)("salón: pedido, envío, cambio de mesa y cobro", () => {
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

  /** Una mesa nueva en un lugar libre del plano (la grilla da para 28 de 2 × 2). */
  const mesa = async (escenario = e) => {
    const n = ++proxima;
    const id = nuevoId();
    valorDe(
      await m.salon.crearMesa(escenario.gerente, {
        mesaId: id,
        sucursalId: escenario.sucursal,
        numero: n,
        forma: "CUADRADA",
        tamano: "CHICA",
        columna: 1 + ((n - 1) % 7) * 2,
        fila: 1 + Math.floor((n - 1) / 7) * 2,
      }),
    );
    return { id, numero: n };
  };
  const pedido = async (mesaId: string, escenario = e) => {
    const r = valorDe(
      await m.salon.tomarPedido(escenario.gerente, { cuentaId: nuevoId(), mesaId }),
    );
    return r.cuentaId;
  };
  const plato = async (
    cuenta: string,
    extra: { salida?: "AHORA" | "DESPUES"; cantidad?: string } = {},
    escenario = e,
  ) => {
    const lineaId = nuevoId();
    valorDe(
      await m.salon.agregarAlPedido(escenario.gerente, {
        cuentaId: cuenta,
        lineaId,
        productoId: escenario.producto,
        opcionIds: [],
        cantidad: extra.cantidad ?? "1",
        ...(extra.salida === undefined ? {} : { salida: extra.salida }),
      }),
    );
    return lineaId;
  };
  const enviar = (
    cuenta: string,
    envioId = nuevoId(),
    clave = nuevaClave(),
    contexto = e.gerente,
  ) => m.salon.enviarACocina(contexto, { envioId, cuentaId: cuenta, claveIdempotencia: clave });
  const cobro = (cuenta: string, total: string, cambios = {}) => ({
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
    ...cambios,
  });
  const cuentaDeLaMesa = async (mesaId: string) =>
    (
      await m.filas<{ id: string }>(
        "select id from cuenta_consumo where ancla_id = $1 and estado = 'ABIERTA'",
        [mesaId],
      )
    )[0]?.id;

  it("I5: dos mozos que tocan «Tomar pedido» a la vez reciben la misma cuenta (yaExistia); repetir no abre otra", async () => {
    const { id } = await mesa();
    const [a, b] = await Promise.all([
      m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId: id }),
      m.salon.tomarPedido(e.administrador, { cuentaId: nuevoId(), mesaId: id }),
    ]);
    const [x, y] = [valorDe(a), valorDe(b)];
    expect(x.cuentaId).toBe(y.cuentaId);
    expect([x.yaExistia, y.yaExistia].filter((v) => !v)).toHaveLength(1);
    const otra = valorDe(
      await m.salon.tomarPedido(e.gerente, { cuentaId: x.cuentaId, mesaId: id }),
    );
    expect(otra).toEqual({ cuentaId: x.cuentaId, yaExistia: true });
    expect(
      await m.contar(
        "select count(*) as n from cuenta_consumo where ancla_id = $1 and estado = 'ABIERTA'",
        [id],
      ),
    ).toBe(1);
    expect(
      (
        await m.filas<{ etiqueta: string }>("select etiqueta from cuenta_consumo where id = $1", [
          x.cuentaId,
        ])
      )[0]?.etiqueta,
    ).toMatch(/^Mesa \d+$/);
  });

  it("tomar pedido en una mesa desactivada o de otra empresa: MESA_INACTIVA / MESA_NO_ENCONTRADA", async () => {
    const { id } = await mesa();
    valorDe(await m.salon.desactivarMesa(e.gerente, { mesaId: id }));
    expect(await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId: id })).toEqual({
      ok: false,
      error: "MESA_INACTIVA",
    });
    const otra = await m.escenario();
    const { id: viva } = await mesa();
    expect(await m.salon.tomarPedido(otra.gerente, { cuentaId: nuevoId(), mesaId: viva })).toEqual({
      ok: false,
      error: "MESA_NO_ENCONTRADA",
    });
  });

  it("I6: repetir agregarAlPedido con el mismo id deja una línea y un estado de comanda, y devuelve yaExistia", async () => {
    const { id } = await mesa();
    const cuenta = await pedido(id);
    const lineaId = nuevoId();
    const entrada = {
      cuentaId: cuenta,
      lineaId,
      productoId: e.producto,
      opcionIds: [],
      cantidad: "2",
    };
    expect(valorDe(await m.salon.agregarAlPedido(e.gerente, entrada)).yaExistia).toBe(false);
    expect(valorDe(await m.salon.agregarAlPedido(e.gerente, entrada)).yaExistia).toBe(true);
    expect(
      await m.contar("select count(*) as n from linea_cuenta where cuenta_id = $1", [cuenta]),
    ).toBe(1);
    expect(
      await m.contar("select count(*) as n from linea_de_comanda where cuenta_id = $1", [cuenta]),
    ).toBe(1);
  });

  it("el precio sale del catálogo y no se pisa; una cuenta que no es de mesa no entra por acá", async () => {
    const { id } = await mesa();
    const cuenta = await pedido(id);
    const r = valorDe(
      await m.salon.agregarAlPedido(e.gerente, {
        cuentaId: cuenta,
        lineaId: nuevoId(),
        productoId: e.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    );
    expect(r.precioUnitario).toEqual(monto("1000.000000"));
    const ajena = nuevoId();
    valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: ajena, sucursalId: e.sucursal }));
    expect(
      await m.salon.agregarAlPedido(e.gerente, {
        cuentaId: ajena,
        lineaId: nuevoId(),
        productoId: e.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    ).toEqual({ ok: false, error: "CUENTA_NO_ES_DE_MESA" });
  });

  it("I7: liberar dos veces la misma mesa es ok y no audita la segunda; con un ítem vigente, MESA_CON_PEDIDO", async () => {
    const { id } = await mesa();
    const cuenta = await pedido(id);
    const linea = await plato(cuenta);
    expect(await m.salon.liberarMesa(e.gerente, { cuentaId: cuenta })).toEqual({
      ok: false,
      error: "MESA_CON_PEDIDO",
    });
    valorDe(
      await m.casos.anularLinea(e.gerente, {
        cuentaId: cuenta,
        lineaId: linea,
        motivo: "Se equivocó el mozo",
      }),
    );
    expect(valorDe(await m.salon.liberarMesa(e.gerente, { cuentaId: cuenta }))).toEqual({
      yaEstabaLibre: false,
    });
    const antes = (await m.auditoria(e.empresa, "CUENTA_ANULADA")).length;
    expect(valorDe(await m.salon.liberarMesa(e.gerente, { cuentaId: cuenta }))).toEqual({
      yaEstabaLibre: true,
    });
    expect((await m.auditoria(e.empresa, "CUENTA_ANULADA")).length).toBe(antes);
    expect(await cuentaDeLaMesa(id)).toBeUndefined();
  });

  it("I10: doble toque en «Enviar a cocina» con el mismo envío deja un envío y un trabajo, y devuelve yaExistia; sin nada pendiente, NADA_PARA_ENVIAR", async () => {
    const { id, numero } = await mesa();
    const cuenta = await pedido(id);
    await plato(cuenta);
    const envioId = nuevoId();
    const clave = nuevaClave();
    const a = valorDe(await enviar(cuenta, envioId, clave));
    const b = valorDe(await enviar(cuenta, envioId, clave));
    expect(a).toMatchObject({ numero: 1, yaExistia: false });
    expect(b).toMatchObject({ numero: 1, yaExistia: true });
    expect(
      await m.contar("select count(*) as n from envio_de_comanda where cuenta_id = $1", [cuenta]),
    ).toBe(1);
    expect(
      await m.contar("select count(*) as n from trabajo_de_impresion where documento_id = $1", [
        envioId,
      ]),
    ).toBe(1);
    // El rótulo lo armó el servidor desde la mesa.
    expect(
      (
        await m.filas<{ rotulo: string }>("select rotulo from envio_de_comanda where id = $1", [
          envioId,
        ])
      )[0]?.rotulo,
    ).toBe(`Mesa ${numero}`);
    expect(await enviar(cuenta)).toEqual({ ok: false, error: "NADA_PARA_ENVIAR" });
  });

  it("dos mozos envían a la vez en la misma mesa: números de envío 1 a N sin huecos y cada línea en un solo envío", async () => {
    const { id } = await mesa();
    const cuenta = await pedido(id);
    for (let i = 0; i < 4; i++) await plato(cuenta);
    const r = await Promise.all([
      enviar(cuenta, nuevoId(), nuevaClave(), e.gerente),
      enviar(cuenta, nuevoId(), nuevaClave(), e.administrador),
      enviar(cuenta, nuevoId(), nuevaClave(), e.gerente),
    ]);
    const hechos = r.filter((x) => x.ok);
    expect(hechos.length).toBeGreaterThanOrEqual(1);
    for (const x of r) if (!x.ok) expect(x.error).toBe("NADA_PARA_ENVIAR");
    const numeros = (
      await m.filas<{ numero: number }>(
        "select numero from envio_de_comanda where cuenta_id = $1 order by numero",
        [cuenta],
      )
    ).map((f) => f.numero);
    expect(numeros).toEqual(Array.from({ length: numeros.length }, (_, i) => i + 1));
    const salidas = await m.filas<{ n: string }>(
      "select count(*)::text as n from linea_de_comanda where cuenta_id = $1 and envio_id is not null",
      [cuenta],
    );
    expect(salidas[0]?.n).toBe("4");
  });

  it("I11: repetir «Pedir que salga» con el mismo envío no crea otro; lo que esperaba sale en ese envío", async () => {
    const { id } = await mesa();
    const cuenta = await pedido(id);
    await plato(cuenta);
    const espera = await plato(cuenta, { salida: "DESPUES" });
    valorDe(await enviar(cuenta));
    const envioId = nuevoId();
    const clave = nuevaClave();
    const a = valorDe(
      await m.salon.pedirQueSalga(e.gerente, {
        envioId,
        cuentaId: cuenta,
        lineaIds: "TODAS",
        claveIdempotencia: clave,
      }),
    );
    const b = valorDe(
      await m.salon.pedirQueSalga(e.gerente, {
        envioId,
        cuentaId: cuenta,
        lineaIds: "TODAS",
        claveIdempotencia: clave,
      }),
    );
    expect(a).toMatchObject({ numero: 2, tipo: "SALIDA_PEDIDA", yaExistia: false });
    expect(b).toMatchObject({ numero: 2, yaExistia: true });
    expect(
      await m.contar(
        "select count(*) as n from linea_de_comanda where linea_id = $1 and envio_id = $2",
        [espera, envioId],
      ),
    ).toBe(1);
  });

  it("I12: doble clic en anular un ítem enviado deja una anulación y un aviso; el total cierra", async () => {
    const { id } = await mesa();
    const cuenta = await pedido(id);
    const linea = await plato(cuenta, { cantidad: "3" });
    valorDe(await enviar(cuenta));
    const avisoId = nuevoId();
    const entrada = {
      cuentaId: cuenta,
      lineaId: linea,
      cantidad: "1",
      motivo: "Cambió de idea",
      avisoId,
    };
    const a = valorDe(await m.salon.anularItemEnviado(e.gerente, entrada));
    const b = valorDe(await m.salon.anularItemEnviado(e.gerente, entrada));
    expect(a.yaExistia).toBe(false);
    expect(b.yaExistia).toBe(true);
    expect(
      await m.contar("select count(*) as n from aviso_de_anulacion where cuenta_id = $1", [cuenta]),
    ).toBe(1);
    expect(
      (
        await m.filas<{ t: string }>(
          "select total_provisorio::text as t from cuenta_consumo where id = $1",
          [cuenta],
        )
      )[0]?.t,
    ).toBe("2000.00");
  });

  it("I8: cambiar dos veces a la misma mesa es ok (yaExistia) y no audita la segunda; los envíos viejos conservan su rótulo", async () => {
    const origen = await mesa();
    const destino = await mesa();
    const cuenta = await pedido(origen.id);
    await plato(cuenta);
    const envioId = nuevoId();
    valorDe(await enviar(cuenta, envioId));
    expect(
      valorDe(
        await m.salon.cambiarDeMesa(e.gerente, { cuentaId: cuenta, mesaDestinoId: destino.id }),
      ),
    ).toEqual({ yaExistia: false });
    const antes = (await m.auditoria(e.empresa, "MESA_CAMBIADA")).length;
    expect(
      valorDe(
        await m.salon.cambiarDeMesa(e.gerente, { cuentaId: cuenta, mesaDestinoId: destino.id }),
      ),
    ).toEqual({ yaExistia: true });
    expect((await m.auditoria(e.empresa, "MESA_CAMBIADA")).length).toBe(antes);
    expect(await cuentaDeLaMesa(origen.id)).toBeUndefined();
    expect(await cuentaDeLaMesa(destino.id)).toBe(cuenta);
    expect(
      (
        await m.filas<{ rotulo: string }>("select rotulo from envio_de_comanda where id = $1", [
          envioId,
        ])
      )[0]?.rotulo,
    ).toBe(`Mesa ${origen.numero}`);
    // Un envío nuevo lleva el rótulo de la mesa de ahora.
    await plato(cuenta);
    const nuevo = nuevoId();
    valorDe(await enviar(cuenta, nuevo));
    expect(
      (
        await m.filas<{ rotulo: string }>("select rotulo from envio_de_comanda where id = $1", [
          nuevo,
        ])
      )[0]?.rotulo,
    ).toBe(`Mesa ${destino.numero}`);
  });

  it("P10: dos cuentas que van a la misma mesa libre a la vez: gana una y la otra recibe MESA_NO_LIBRE; a una mesa ocupada, también", async () => {
    const [m1, m2, libre, ocupada] = [await mesa(), await mesa(), await mesa(), await mesa()];
    const c1 = await pedido(m1.id);
    const c2 = await pedido(m2.id);
    await pedido(ocupada.id);
    const [a, b] = await Promise.all([
      m.salon.cambiarDeMesa(e.gerente, { cuentaId: c1, mesaDestinoId: libre.id }),
      m.salon.cambiarDeMesa(e.administrador, { cuentaId: c2, mesaDestinoId: libre.id }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    for (const x of [a, b]) if (!x.ok) expect(x.error).toBe("MESA_NO_LIBRE");
    expect(
      await m.salon.cambiarDeMesa(e.gerente, {
        cuentaId: a.ok ? c2 : c1,
        mesaDestinoId: ocupada.id,
      }),
    ).toEqual({ ok: false, error: "MESA_NO_LIBRE" });
  });

  it("P4: cobrar con platos sin enviar o en espera da HAY_PLATOS_SIN_ENVIAR y no escribe nada; enviado todo, cobra", async () => {
    const { id } = await mesa();
    const cuenta = await pedido(id);
    await plato(cuenta);
    await plato(cuenta, { salida: "DESPUES" });
    const antes = await m.contar("select count(*) as n from ticket", []);
    expect(await m.salon.cobrarMesa(e.gerente, cobro(cuenta, "2000.00"))).toEqual({
      ok: false,
      error: "HAY_PLATOS_SIN_ENVIAR",
    });
    valorDe(await enviar(cuenta));
    // Lo que esperaba sigue sin enviar.
    expect(await m.salon.cobrarMesa(e.gerente, cobro(cuenta, "2000.00"))).toEqual({
      ok: false,
      error: "HAY_PLATOS_SIN_ENVIAR",
    });
    valorDe(
      await m.salon.pedirQueSalga(e.gerente, {
        envioId: nuevoId(),
        cuentaId: cuenta,
        lineaIds: "TODAS",
        claveIdempotencia: nuevaClave(),
      }),
    );
    expect(await m.contar("select count(*) as n from ticket", [])).toBe(antes);
    const vendida = valorDe(await m.salon.cobrarMesa(e.gerente, cobro(cuenta, "2000.00")));
    expect(vendida).toMatchObject({ estado: "COBRADO", yaExistia: false });
  });

  it("P4: cobrar a la vez que otro agrega un plato: TOTAL_CAMBIO o HAY_PLATOS_SIN_ENVIAR, nunca un ticket que deje afuera un ítem cargado", async () => {
    const { id } = await mesa();
    const cuenta = await pedido(id);
    await plato(cuenta);
    valorDe(await enviar(cuenta));
    const [c, a] = await Promise.all([
      m.salon.cobrarMesa(e.gerente, cobro(cuenta, "1000.00")),
      m.salon.agregarAlPedido(e.administrador, {
        cuentaId: cuenta,
        lineaId: nuevoId(),
        productoId: e.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    ]);
    if (c.ok) {
      // Cobró primero: el agregado llegó tarde y se rechazó (la cuenta ya no estaba abierta).
      expect(a.ok).toBe(false);
      expect(
        await m.contar(
          "select count(*) as n from ejemplar_linea l join ticket_ejemplar e on e.id = l.ejemplar_id join ticket t on t.id = e.ticket_id where t.cuenta_id = $1",
          [cuenta],
        ),
      ).toBe(1);
    } else {
      expect(["TOTAL_CAMBIO", "HAY_PLATOS_SIN_ENVIAR"]).toContain(
        typeof c.error === "string" ? c.error : (c.error as { error: string }).error,
      );
      expect(
        await m.contar("select count(*) as n from ticket where cuenta_id = $1", [cuenta]),
      ).toBe(0);
    }
  });

  it("I9: doble clic en cobrar la mesa deja un ticket, un cobro y la mesa libre, y devuelve yaExistia", async () => {
    const { id } = await mesa();
    const cuenta = await pedido(id);
    await plato(cuenta);
    valorDe(await enviar(cuenta));
    const pedidoDeCobro = cobro(cuenta, "1000.00");
    const [a, b] = await Promise.all([
      m.salon.cobrarMesa(e.gerente, pedidoDeCobro),
      m.salon.cobrarMesa(e.gerente, pedidoDeCobro),
    ]);
    expect([a.ok, b.ok].every(Boolean)).toBe(true);
    expect(await m.contar("select count(*) as n from ticket where cuenta_id = $1", [cuenta])).toBe(
      1,
    );
    expect(
      await m.contar(
        "select count(*) as n from cobranza_de_ticket c join ticket t on t.id = c.ticket_id where t.cuenta_id = $1",
        [cuenta],
      ),
    ).toBe(1);
    const otra = valorDe(await m.salon.cobrarMesa(e.gerente, pedidoDeCobro));
    expect(otra.yaExistia).toBe(true);
    expect(await cuentaDeLaMesa(id)).toBeUndefined();
    // La mesa quedó libre: se puede tomar un pedido nuevo.
    expect(
      valorDe(await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId: id })).yaExistia,
    ).toBe(false);
  });

  it("P5: cobrar sin caja con sesión no deja ticket, ni número consumido, ni cobro: la mesa sigue ocupada", async () => {
    const x = await m.escenario();
    const n = ++proxima;
    const mesaId = nuevoId();
    valorDe(
      await m.salon.crearMesa(x.gerente, {
        mesaId,
        sucursalId: x.sucursal,
        numero: n,
        forma: "CUADRADA",
        tamano: "CHICA",
        columna: 1,
        fila: 1,
      }),
    );
    const cuenta = valorDe(
      await m.salon.tomarPedido(x.gerente, { cuentaId: nuevoId(), mesaId }),
    ).cuentaId;
    await plato(cuenta, {}, x);
    valorDe(await enviar(cuenta, nuevoId(), nuevaClave(), x.gerente));
    const otraCaja = await m.cajaAbierta(x);
    const r = await m.salon.cobrarMesa(x.gerente, {
      claveIdempotencia: nuevaClave(),
      cuentaId: cuenta,
      ejemplarId: nuevoId(),
      totalEsperado: monto("1000.00"),
      cobro: {
        cajaId: nuevoId(),
        cobros: [
          {
            medioDePagoId: otraCaja.medios["EFECTIVO"] as string,
            cuentaDeCobroId: null,
            importe: monto("1000.00"),
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    expect(await m.contar("select count(*) as n from ticket where cuenta_id = $1", [cuenta])).toBe(
      0,
    );
    expect(
      await m.contar(
        "select coalesce(max(ultimo), 0) as n from numerador_ticket where empresa_id = $1",
        [x.empresa],
      ),
    ).toBe(0);
    expect(await cuentaDeLaMesa(mesaId)).toBe(cuenta);
  });

  it("el mapa de mesas deriva el estado (libre, en pedido, ocupada) y la ficha muestra el estado de comanda de cada ítem", async () => {
    const x = await m.escenario();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const mesaId = nuevoId();
      ids.push(mesaId);
      valorDe(
        await m.salon.crearMesa(x.gerente, {
          mesaId,
          sucursalId: x.sucursal,
          numero: i + 1,
          forma: "CUADRADA",
          tamano: "CHICA",
          columna: 1 + i * 2,
          fila: 1,
        }),
      );
    }
    const c1 = valorDe(
      await m.salon.tomarPedido(x.gerente, { cuentaId: nuevoId(), mesaId: ids[1] as string }),
    ).cuentaId;
    const c2 = valorDe(
      await m.salon.tomarPedido(x.gerente, { cuentaId: nuevoId(), mesaId: ids[2] as string }),
    ).cuentaId;
    await plato(c1, {}, x);
    await plato(c2, {}, x);
    valorDe(await enviar(c2, nuevoId(), nuevaClave(), x.gerente));
    const mapa = valorDe(
      await m.consultasDeSalon.mapaDeMesas(x.operador, { sucursalId: x.sucursal }),
    );
    expect(mapa.map((f) => [f.numero, f.estado])).toEqual([
      [1, "LIBRE"],
      [2, "EN_PEDIDO"],
      [3, "OCUPADA"],
    ]);
    expect(mapa[1]).toMatchObject({ cuentaId: c1, total: monto("1000.00") });
    const libres = valorDe(
      await m.consultasDeSalon.mapaDeMesas(x.operador, {
        sucursalId: x.sucursal,
        filtro: "LIBRES",
      }),
    );
    expect(libres.map((f) => f.numero)).toEqual([1]);
    const ficha = valorDe(
      await m.consultasDeSalon.fichaDeMesa(x.operador, { mesaId: ids[2] as string }),
    );
    expect(ficha).toMatchObject({ numero: 3, estado: "OCUPADA" });
    expect(ficha.cuentas[0]?.lineas[0]).toMatchObject({
      comanda: "ENVIADA",
      numeroDeEnvio: 1,
    });
  });

  it("P13: otra empresa y sucursal fuera de alcance son inexistentes o rechazadas; el mapa solo muestra lo propio", async () => {
    const x = await m.escenario();
    const { id } = await mesa();
    const cuenta = await pedido(id);
    expect(
      await m.salon.agregarAlPedido(x.gerente, {
        cuentaId: cuenta,
        lineaId: nuevoId(),
        productoId: x.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    ).toEqual({
      ok: false,
      error: "CUENTA_NO_ENCONTRADA",
    });
    expect(await m.salon.cobrarMesa(x.gerente, cobro(cuenta, "1000.00"))).toEqual({
      ok: false,
      error: "CUENTA_NO_ENCONTRADA",
    });
    expect(await enviar(cuenta, nuevoId(), nuevaClave(), x.gerente)).toEqual({
      ok: false,
      error: "CUENTA_NO_ENCONTRADA",
    });
    expect(
      await m.consultasDeSalon.mapaDeMesas(e.operador, { sucursalId: e.otraSucursal }),
    ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
    expect(
      valorDe(await m.consultasDeSalon.mapaDeMesas(x.gerente, { sucursalId: x.sucursal })),
    ).toEqual([]);
  });
});
