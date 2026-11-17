import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  registrarMovimientoEnTx,
  type PedidoDeMovimiento,
} from "../../src/modulos/stock/casos-de-uso/movimiento-en-tx";
import { huellaDeComando } from "../../src/modulos/stock/dominio/huella";
import { cantidadConSignoDesdeTexto } from "../../src/primitivas/cantidad/con-signo";
import {
  montarStock,
  nuevoId,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * E5-T5, idempotencia (P7, P8, P11 y el origen como identidad, P9 y P12 en el núcleo que reutilizarán ventas y compras): repetir un comando con
 * la misma clave y el mismo contenido da lo hecho sin escribir ni auditar; con otro contenido, CLAVE_REUTILIZADA. Los comandos de conteo
 * (P12: aplicar dos veces) están en `stock-conteos.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("stock: idempotencia de los movimientos", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const renglon = (producto: string, cantidad: string, unidadId = "UNIDAD") => ({
    productoId: producto,
    cantidad,
    unidadId,
  });
  const nuevo = async () => ({ dep: await c.deposito(e), ...(await c.articulo(e)) });
  const cuantos = (clase?: string) =>
    c.contar(
      "select count(*) as n from movimiento_de_stock where empresa_id = $1 and ($2::text is null or clase = $2)",
      [e.empresa, clase ?? null],
    );

  it("P7: la misma entrada dos veces (clic doble, misma clave) deja una sola entrada, devuelve yaExistia y el saldo sube una vez", async () => {
    const n = await nuevo();
    const clave = nuevoId();
    const pedido = {
      clave,
      depositoId: n.dep,
      motivo: "COMPRA",
      detalle: "Factura 7",
      renglones: [renglon(n.producto, "4")],
    };
    const antes = await cuantos();
    const primera = valorDe(await c.casos.registrarEntrada(e.gerente, pedido));
    const segunda = valorDe(await c.casos.registrarEntrada(e.gerente, pedido));
    expect(primera.yaExistia).toBe(false);
    expect(segunda).toEqual({ movimientoId: primera.movimientoId, yaExistia: true });
    expect(await cuantos()).toBe(antes + 1);
    expect(await c.existencia(n.dep, n.articulo)).toBe("4.0000");
    // La misma clave la repite también otra persona del mismo alcance (el pedido es el mismo).
    expect(valorDe(await c.casos.registrarEntrada(e.operador, pedido)).yaExistia).toBe(true);
    expect(await c.existencia(n.dep, n.articulo)).toBe("4.0000");
  });

  it("P7: el mismo pedido escrito de otra forma (renglones en otro orden, `1` y `1.00`, otro `ahora`) es el mismo pedido", async () => {
    const n = await nuevo();
    const otro = await c.articulo(e);
    const clave = nuevoId();
    const hecho = (renglones: ReturnType<typeof renglon>[], quien = e.gerente) =>
      c.casos.registrarEntrada(quien, { clave, depositoId: n.dep, motivo: "COMPRA", renglones });
    const primera = valorDe(await hecho([renglon(n.producto, "1"), renglon(otro.producto, "2")]));
    const segunda = valorDe(
      await hecho([renglon(otro.producto, "2.00"), renglon(n.producto, "1.0")]),
    );
    expect(segunda).toEqual({ movimientoId: primera.movimientoId, yaExistia: true });
    // El `ahora` del contexto no es parte del pedido: reintentar un minuto después no es una clave reutilizada.
    const masTarde = { ...e.gerente, ahora: new Date(e.gerente.ahora.getTime() + 60_000) };
    expect(
      valorDe(await hecho([renglon(n.producto, "1"), renglon(otro.producto, "2")], masTarde))
        .yaExistia,
    ).toBe(true);
    expect(await c.existencia(n.dep, n.articulo)).toBe("1.0000");
  });

  it("P8: la misma clave con otro contenido es CLAVE_REUTILIZADA y no escribe nada", async () => {
    const n = await nuevo();
    const otroDeposito = await c.deposito(e);
    const clave = nuevoId();
    const base = {
      clave,
      depositoId: n.dep,
      motivo: "COMPRA",
      renglones: [renglon(n.producto, "4")],
    };
    valorDe(await c.casos.registrarEntrada(e.gerente, base));
    const antes = await cuantos();
    const distintos: Record<string, unknown>[] = [
      { renglones: [renglon(n.producto, "5")] },
      { renglones: [renglon(n.producto, "4"), renglon((await c.articulo(e)).producto, "1")] },
      { depositoId: otroDeposito },
      { motivo: "CARGA_INICIAL" },
      { detalle: "Otro detalle" },
      { hechoEn: new Date(e.gerente.ahora.getTime() - 1000) },
    ];
    for (const cambio of distintos) {
      expect(
        await c.casos.registrarEntrada(e.gerente, { ...base, ...cambio }),
        JSON.stringify(cambio),
      ).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });
    }
    // Otra operación con la misma clave tampoco es la misma.
    expect(await c.casos.registrarSalida(e.gerente, { ...base, motivo: "MERMA" })).toEqual({
      ok: false,
      error: "CLAVE_REUTILIZADA",
    });
    expect(
      await c.casos.ajustar(e.gerente, {
        clave,
        depositoId: n.dep,
        detalle: "Corrección",
        renglones: [{ ...renglon(n.producto, "4"), sentido: "SUMA" }],
      }),
    ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
    expect(await cuantos()).toBe(antes);
    expect(await c.existencia(n.dep, n.articulo)).toBe("4.0000");
  });

  it("P8: una clave es de una empresa: la misma clave en otra empresa no choca (se prueba en stock-aislamiento)", async () => {
    // La clave de una empresa no impide usarla en otra; aquí solo se fija que dentro de la empresa sí se respeta.
    const n = await nuevo();
    const clave = nuevoId();
    valorDe(
      await c.casos.registrarEntrada(e.gerente, {
        clave,
        depositoId: n.dep,
        motivo: "COMPRA",
        renglones: [renglon(n.producto, "1")],
      }),
    );
    expect(
      await c.casos.registrarEntrada(e.administrador, {
        clave,
        depositoId: n.dep,
        motivo: "COMPRA",
        renglones: [renglon(n.producto, "2")],
      }),
    ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
  });

  it("I5: repetir registrarSalida con la misma clave devuelve yaExistia sin escribir ni volver a auditar la excepción", async () => {
    const emp = await c.escenario();
    const dep = await c.deposito(emp);
    const a = await c.articulo(emp);
    const pedido = {
      clave: nuevoId(),
      depositoId: dep,
      motivo: "MERMA",
      renglones: [renglon(a.producto, "2")],
    };
    const primera = valorDe(await c.casos.registrarSalida(emp.gerente, pedido));
    expect(primera.excepciones).toHaveLength(1);
    const auditoriasAntes = (await c.auditoria(emp.empresa, "CONTROL_EXCEPCION")).length;
    const segunda = valorDe(await c.casos.registrarSalida(emp.gerente, pedido));
    expect(segunda).toEqual({
      movimientoId: primera.movimientoId,
      yaExistia: true,
      excepciones: [],
    });
    expect((await c.auditoria(emp.empresa, "CONTROL_EXCEPCION")).length).toBe(auditoriasAntes);
    expect(
      await c.contar("select count(*) as n from movimiento_de_stock where empresa_id = $1", [
        emp.empresa,
      ]),
    ).toBe(1);
    expect(await c.existencia(dep, a.articulo)).toBe("-2.0000");
  });

  it("I5: repetir una salida que el control bloqueó vuelve a bloquear (no escribió nada la primera vez)", async () => {
    const emp = await c.escenario();
    await c.fijarNivel(emp.empresa, "BLOQUEAR");
    const dep = await c.deposito(emp);
    const a = await c.articulo(emp);
    const pedido = {
      clave: nuevoId(),
      depositoId: dep,
      motivo: "MERMA",
      renglones: [renglon(a.producto, "1")],
    };
    for (let i = 0; i < 2; i += 1) {
      expect(await c.casos.registrarSalida(emp.gerente, pedido)).toMatchObject({
        ok: false,
        error: { error: "CONTROL_BLOQUEA" },
      });
    }
    expect(
      await c.contar("select count(*) as n from movimiento_de_stock where empresa_id = $1", [
        emp.empresa,
      ]),
    ).toBe(0);
  });

  it("I6: repetir transferir con la misma clave mueve una sola vez", async () => {
    const n = await nuevo();
    valorDe(
      await c.casos.registrarEntrada(e.gerente, {
        clave: nuevoId(),
        depositoId: n.dep,
        motivo: "COMPRA",
        renglones: [renglon(n.producto, "10")],
      }),
    );
    const destino = await c.deposito(e);
    const pedido = {
      clave: nuevoId(),
      origenId: n.dep,
      destinoId: destino,
      renglones: [renglon(n.producto, "3")],
    };
    const primera = valorDe(await c.casos.transferir(e.gerente, pedido));
    const segunda = valorDe(await c.casos.transferir(e.gerente, pedido));
    expect(segunda).toEqual({
      movimientoId: primera.movimientoId,
      yaExistia: true,
      excepciones: [],
    });
    expect(await c.existencia(n.dep, n.articulo)).toBe("7.0000");
    expect(await c.existencia(destino, n.articulo)).toBe("3.0000");
    // Con otro destino es otro pedido.
    expect(
      await c.casos.transferir(e.gerente, { ...pedido, destinoId: await c.deposito(e) }),
    ).toEqual({
      ok: false,
      error: "CLAVE_REUTILIZADA",
    });
  });

  it("I7: repetir ajustar con la misma clave ajusta una sola vez", async () => {
    const n = await nuevo();
    valorDe(
      await c.casos.registrarEntrada(e.gerente, {
        clave: nuevoId(),
        depositoId: n.dep,
        motivo: "COMPRA",
        renglones: [renglon(n.producto, "10")],
      }),
    );
    const pedido = {
      clave: nuevoId(),
      depositoId: n.dep,
      detalle: "Conté de más",
      renglones: [{ ...renglon(n.producto, "4"), sentido: "RESTA" as const }],
    };
    const primera = valorDe(await c.casos.ajustar(e.gerente, pedido));
    expect(valorDe(await c.casos.ajustar(e.gerente, pedido))).toEqual({
      movimientoId: primera.movimientoId,
      yaExistia: true,
    });
    expect(await c.existencia(n.dep, n.articulo)).toBe("6.0000");
    // El mismo renglón pero con el sentido opuesto es otro pedido.
    expect(
      await c.casos.ajustar(e.gerente, {
        ...pedido,
        renglones: [{ ...renglon(n.producto, "4"), sentido: "SUMA" as const }],
      }),
    ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
  });

  it("P11: anular dos veces el mismo movimiento deja un solo espejo, y anular una anulación se rechaza", async () => {
    const n = await nuevo();
    const m = valorDe(
      await c.casos.registrarEntrada(e.gerente, {
        clave: nuevoId(),
        depositoId: n.dep,
        motivo: "COMPRA",
        renglones: [renglon(n.producto, "5")],
      }),
    );
    const clave = nuevoId();
    const pedido = { clave, movimientoId: m.movimientoId, detalle: "Error de carga" };
    const primera = valorDe(await c.casos.anularMovimiento(e.gerente, pedido));
    expect(primera.yaExistia).toBe(false);
    // La misma clave: es la misma anulación.
    expect(valorDe(await c.casos.anularMovimiento(e.gerente, pedido))).toEqual({
      anulacionId: primera.anulacionId,
      yaExistia: true,
    });
    // Otra clave sobre lo ya anulado: MOVIMIENTO_YA_ANULADO, nunca un segundo espejo.
    expect(await c.casos.anularMovimiento(e.gerente, { ...pedido, clave: nuevoId() })).toEqual({
      ok: false,
      error: "MOVIMIENTO_YA_ANULADO",
    });
    expect(
      await c.casos.anularMovimiento(e.gerente, { ...pedido, detalle: "Otro motivo" }),
    ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
    expect(
      await c.contar("select count(*) as n from movimiento_de_stock where anula_a = $1", [
        m.movimientoId,
      ]),
    ).toBe(1);
    expect(await c.existencia(n.dep, n.articulo)).toBe("0.0000");
    // Una anulación no se anula.
    expect(
      await c.casos.anularMovimiento(e.gerente, {
        clave: nuevoId(),
        movimientoId: primera.anulacionId,
        detalle: "Volver atrás",
      }),
    ).toEqual({
      ok: false,
      error: "MOVIMIENTO_NO_ANULABLE",
    });
    expect(await c.existencia(n.dep, n.articulo)).toBe("0.0000");
  });

  describe("el origen es la identidad del movimiento (el núcleo que reutilizan ventas y compras)", () => {
    const pedidoDeVenta = (
      depositoId: string,
      articuloId: string,
      ejemplarId: string,
      clave: string,
      cantidad: string,
    ): PedidoDeMovimiento => ({
      clase: "SALIDA",
      motivo: "VENTA",
      detalle: null,
      origen: { tipo: "EJEMPLAR_DE_TICKET", id: ejemplarId },
      depositoId,
      accion: "cuentas.cerrar",
      anulaA: null,
      conteoId: null,
      clave,
      huella: huellaDeComando("venta", [ejemplarId], [[articuloId, cantidad]]),
      hechoEn: e.gerente.ahora,
      fechaDeNegocio: "2026-10-11",
      renglones: [
        {
          depositoId,
          articuloId,
          composicionId: null,
          cantidad: valorDe(cantidadConSignoDesdeTexto(`-${cantidad}`)),
        },
      ],
      confirmaciones: [],
    });

    it("P9: la salida del MISMO ejemplar dos veces, también con otra clave y otro contenido, es una sola: el primer hecho manda", async () => {
      const n = await nuevo();
      const ejemplar = nuevoId();
      const registrar = (clave: string, cantidad: string) =>
        c.entorno.ejecutar({ contexto: e.gerente }, (tx) =>
          registrarMovimientoEnTx(
            tx,
            e.gerente,
            pedidoDeVenta(n.dep, n.articulo, ejemplar, clave, cantidad),
          ),
        );
      const primera = valorDe(await registrar(`venta-${nuevoId()}`, "1"));
      expect(primera.yaExistia).toBe(false);
      expect(primera.movimiento).toMatchObject({
        motivo: "VENTA",
        origenTipo: "EJEMPLAR_DE_TICKET",
        origenId: ejemplar,
        fechaDeNegocio: "2026-10-11",
        accion: "cuentas.cerrar",
      });
      const otraClave = valorDe(await registrar(`venta-${nuevoId()}`, "1"));
      const otroContenido = valorDe(await registrar(`venta-${nuevoId()}`, "2"));
      expect(otraClave.yaExistia).toBe(true);
      expect(otroContenido.yaExistia).toBe(true);
      expect(otraClave.movimiento.id).toBe(primera.movimiento.id);
      expect(otroContenido.movimiento.id).toBe(primera.movimiento.id);
      expect(
        await c.contar("select count(*) as n from movimiento_de_stock where origen_id = $1", [
          ejemplar,
        ]),
      ).toBe(1);
      expect(await c.existencia(n.dep, n.articulo)).toBe("-1.0000");
    });

    it("P12: la entrada de la misma recepción con otra clave es una sola entrada", async () => {
      const n = await nuevo();
      const recepcion = nuevoId();
      const registrar = (clave: string, cantidad: string) =>
        c.entorno.ejecutar({ contexto: e.gerente }, (tx) =>
          registrarMovimientoEnTx(tx, e.gerente, {
            clase: "ENTRADA",
            motivo: "COMPRA",
            detalle: null,
            origen: { tipo: "RECEPCION", id: recepcion },
            depositoId: n.dep,
            accion: "stock.registrar_entrada",
            anulaA: null,
            conteoId: null,
            clave,
            huella: huellaDeComando("recepcion", [recepcion], [[n.articulo, cantidad]]),
            hechoEn: e.gerente.ahora,
            fechaDeNegocio: null,
            renglones: [
              {
                depositoId: n.dep,
                articuloId: n.articulo,
                composicionId: null,
                cantidad: valorDe(cantidadConSignoDesdeTexto(cantidad)),
              },
            ],
            confirmaciones: [],
          }),
        );
      const primera = valorDe(await registrar(`recepcion-${nuevoId()}`, "5"));
      const segunda = valorDe(await registrar(`recepcion-${nuevoId()}`, "5"));
      expect([primera.yaExistia, segunda.yaExistia]).toEqual([false, true]);
      expect(segunda.movimiento.id).toBe(primera.movimiento.id);
      expect(await c.existencia(n.dep, n.articulo)).toBe("5.0000");
    });

    it("un origen que no es de la lista (o sin UUID) y un motivo que no cuadra con el origen se rechazan", async () => {
      const n = await nuevo();
      const registrar = (cambio: Partial<PedidoDeMovimiento>) =>
        c.entorno.ejecutar({ contexto: e.gerente }, (tx) =>
          registrarMovimientoEnTx(tx, e.gerente, {
            ...pedidoDeVenta(n.dep, n.articulo, nuevoId(), `venta-${nuevoId()}`, "1"),
            ...cambio,
          }),
        );
      expect(await registrar({ origen: { tipo: "OTRO_MODULO", id: nuevoId() } })).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
      expect(await registrar({ origen: { tipo: "EJEMPLAR_DE_TICKET", id: "x" } })).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
      expect(await registrar({ origen: null })).toEqual({
        ok: false,
        error: "MOTIVO_NO_PERMITIDO",
      });
      expect(await registrar({ motivo: "MERMA" })).toEqual({
        ok: false,
        error: "MOTIVO_NO_PERMITIDO",
      });
      expect(await registrar({ motivo: "NO_EXISTE" })).toEqual({
        ok: false,
        error: "MOTIVO_NO_PERMITIDO",
      });
      expect(await registrar({ renglones: [] })).toEqual({
        ok: false,
        error: "RENGLONES_INVALIDOS",
      });
      expect(await c.existencia(n.dep, n.articulo)).toBe("0");
    });

    it("sin persona (el sistema) el núcleo no escribe: el libro siempre dice quién fue", async () => {
      const n = await nuevo();
      const sistema = { ...e.gerente, personaId: null };
      const r = await c.entorno.ejecutar({ contexto: sistema }, (tx) =>
        registrarMovimientoEnTx(
          tx,
          sistema,
          pedidoDeVenta(n.dep, n.articulo, nuevoId(), `venta-${nuevoId()}`, "1"),
        ),
      );
      expect(r).toEqual({ ok: false, error: "SIN_PERMISO" });
    });
  });
});
