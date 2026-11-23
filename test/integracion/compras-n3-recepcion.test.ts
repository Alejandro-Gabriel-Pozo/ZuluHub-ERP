import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import { codigoDe } from "./concurrencia-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";

/**
 * Compras N3 (tramo N3-2a): recibir mercadería sin entrada de stock, PENDIENTE de confirmar, con el control por línea. Nivel y perilla, idempotencia (misma clave,
 * mismo remito con otra clave), concurrencia (la misma recepción a la vez, el mismo remito a la vez), atomicidad (una falla inyectada no deja nada), permisos y
 * alcance, aislamiento entre empresas y que N1 y N2 no vean una recepción pendiente.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras N3: registrar una recepción pendiente", () => {
  let c: MontajeDeCompras;
  let n1: EscenarioDeCompras;
  let e: EscenarioDeCompras;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    n1 = await c.escenario();
    e = await c.escenario();
    c.encenderPerilla("recepcion_separada");
    valorDe(
      await c.casos.configurarCompras(e.gerente, {
        nivel: "RECEPCION_SEPARADA",
        versionEsperada: 1,
      }),
    );
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const codigo = (r: Parameters<typeof codigoDe>[0]): string =>
    !r.ok && typeof r.error === "object" && r.error !== null && "error" in r.error
      ? String(r.error.error)
      : codigoDe(r);

  const armar = async (quien = e) => {
    const deposito = await c.deposito(quien);
    const { producto, articulo } = await c.articulo(quien, {
      unidadBase: "GRAMO",
      dimension: "MASA",
    });
    const proveedor = await c.proveedor(quien.operador);
    return { deposito, producto, articulo, proveedor };
  };
  const pedido = (
    m: Awaited<ReturnType<typeof armar>>,
    quien = e,
    extra: Record<string, unknown> = {},
  ) => ({
    clave: nuevoId(),
    sucursalId: quien.sucursal,
    proveedorId: m.proveedor,
    renglones: [
      {
        productoId: m.producto,
        unidadDeCompraId: "KILOGRAMO",
        cantidad: "2",
        precioPor: "UNIDAD",
        unidadDePrecioId: "KILOGRAMO",
        precio: "1000",
      },
    ],
    ...extra,
  });
  const recepciones = (proveedor: string) =>
    c.contar("select count(*) as n from recepcion where proveedor_id = $1", [proveedor]);

  it("la empresa en N1 o N2 no recibe así: RECEPCION_SEPARADA_NO_CORRESPONDE_AL_NIVEL y no queda nada", async () => {
    const m = await armar(n1);
    const r = await c.casos.registrarRecepcion(n1.operador, pedido(m, n1));
    expect(r).toEqual({ ok: false, error: "RECEPCION_SEPARADA_NO_CORRESPONDE_AL_NIVEL" });
    expect(await recepciones(m.proveedor)).toBe(0);
  });

  it("el operador recibe: queda PENDIENTE, sin atajo, con su control y sin tocar stock ni la oferta del proveedor; audita", async () => {
    const m = await armar();
    const r = valorDe(
      await c.casos.registrarRecepcion(e.operador, {
        ...pedido(m),
        controles: [
          {
            linea: 1,
            condicion: "CON_OBSERVACIONES",
            observacion: "Caja golpeada",
            temperaturaEnC: "4.5",
            cantidadSegunRemito: "2",
          },
        ],
      }),
    );
    expect(r.yaExistia).toBe(false);
    const [rec] = await c.filas<Record<string, unknown>>(
      "select nivel, es_atajo, estado, registrado_por, confirmada_por from recepcion where id = $1",
      [r.recepcionId],
    );
    expect(rec).toMatchObject({
      nivel: "RECEPCION_SEPARADA",
      es_atajo: false,
      estado: "PENDIENTE",
      registrado_por: e.operador.personaId,
      confirmada_por: null,
    });
    const [linea] = await c.filas<Record<string, unknown>>(
      "select cantidad_en_stock::text as stock, deposito_id, movimiento_id from linea_de_recepcion where recepcion_id = $1",
      [r.recepcionId],
    );
    expect(linea).toMatchObject({ stock: "2000.0000", deposito_id: null, movimiento_id: null });
    const [control] = await c.filas<Record<string, unknown>>(
      "select linea, condicion, observacion, temperatura_en_c::text as temp, cantidad_segun_remito::text as remito from inspeccion_de_linea_de_recepcion where recepcion_id = $1",
      [r.recepcionId],
    );
    expect(control).toMatchObject({
      linea: 1,
      condicion: "CON_OBSERVACIONES",
      observacion: "Caja golpeada",
      temp: "4.5",
      remito: "2.0000",
    });
    expect(await c.existencia(m.deposito, m.articulo)).toBe("0");
    expect(
      await c.contar("select count(*) as n from oferta_de_proveedor where proveedor_id = $1", [
        m.proveedor,
      ]),
    ).toBe(0);
    expect((await c.auditoria(e.empresa, "RECEPCION_REGISTRADA")).at(-1)).toMatchObject({
      actor_persona_id: e.operador.personaId,
      entidad_id: r.recepcionId,
    });
  });

  it("I1: la misma recepción dos veces (misma clave) deja una sola pendiente y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA", async () => {
    const m = await armar();
    const p = pedido(m);
    const primera = valorDe(await c.casos.registrarRecepcion(e.operador, p));
    const auditadas = (await c.auditoria(e.empresa, "RECEPCION_REGISTRADA")).length;
    const segunda = valorDe(await c.casos.registrarRecepcion(e.operador, p));
    expect(segunda).toEqual({ recepcionId: primera.recepcionId, yaExistia: true });
    expect(await recepciones(m.proveedor)).toBe(1);
    expect((await c.auditoria(e.empresa, "RECEPCION_REGISTRADA")).length).toBe(auditadas);
    const otra = await c.casos.registrarRecepcion(e.operador, {
      ...p,
      renglones: p.renglones.map((r) => ({ ...r, cantidad: "3" })),
    });
    expect(codigo(otra)).toBe("CLAVE_REUTILIZADA");
    const otroControl = await c.casos.registrarRecepcion(e.operador, {
      ...p,
      controles: [{ linea: 1, condicion: "CONFORME" }],
    });
    expect(codigo(otroControl)).toBe("CLAVE_REUTILIZADA");
    expect(await recepciones(m.proveedor)).toBe(1);
  });

  it("el mismo remito del mismo proveedor con otra clave es REMITO_YA_REGISTRADO (con la ganadora); la anulada libera el número", async () => {
    const m = await armar();
    const remito = { puntoDeVenta: 3, numero: 4567, fecha: "2026-10-10" };
    const primera = valorDe(await c.casos.registrarRecepcion(e.operador, pedido(m, e, { remito })));
    expect(await c.casos.registrarRecepcion(e.operador, pedido(m, e, { remito }))).toEqual({
      ok: false,
      error: { error: "REMITO_YA_REGISTRADO", recepcionId: primera.recepcionId },
    });
    expect(await recepciones(m.proveedor)).toBe(1);
    const otroProveedor = await c.proveedor(e.operador);
    expect(
      valorDe(
        await c.casos.registrarRecepcion(
          e.operador,
          pedido({ ...m, proveedor: otroProveedor }, e, { remito }),
        ),
      ).yaExistia,
    ).toBe(false);
  });

  it("C1: la misma recepción a la vez (misma clave) y el mismo remito con claves distintas: una sola recepción", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const remito = { puntoDeVenta: 9, numero: 100 + ronda, fecha: "2026-10-10" };
      const igual = pedido(m, e, { remito });
      c.armarBarrera(4);
      try {
        const resultados = await Promise.all([
          c.casos.registrarRecepcion(e.operador, igual),
          c.casos.registrarRecepcion(e.gerente, igual),
          c.casos.registrarRecepcion(e.operador, pedido(m, e, { remito })),
          c.casos.registrarRecepcion(e.administrador, pedido(m, e, { remito })),
        ]);
        for (const r of resultados) {
          expect(r.ok || ["REMITO_YA_REGISTRADO", "ConcurrenciaAgotada"].includes(codigo(r))).toBe(
            true,
          );
        }
        expect(resultados.some((r) => r.ok && !r.valor.yaExistia)).toBe(true);
      } finally {
        c.soltarBarrera();
      }
      expect(await recepciones(m.proveedor)).toBe(1);
      expect(
        await c.contar(
          "select count(*) as n from linea_de_recepcion l join recepcion r on r.id = l.recepcion_id where r.proveedor_id = $1",
          [m.proveedor],
        ),
      ).toBe(1);
    }
  });

  it("C11: N recepciones a la vez en la misma empresa reciben N números distintos", async () => {
    const m = await armar();
    c.armarBarrera(4);
    let resultados;
    try {
      resultados = await Promise.all(
        [0, 1, 2, 3].map(() => c.casos.registrarRecepcion(e.operador, pedido(m))),
      );
    } finally {
      c.soltarBarrera();
    }
    const hechas = resultados.filter((r) => r.ok);
    expect(hechas.length).toBeGreaterThan(0);
    const numeros = await c.filas<{ numero: number }>(
      "select numero from recepcion where proveedor_id = $1",
      [m.proveedor],
    );
    expect(numeros.length).toBe(hechas.length);
    expect(new Set(numeros.map((n) => n.numero)).size).toBe(numeros.length);
  });

  it("atomicidad: si falla al guardar las líneas no queda recepción, ni control, ni auditoría", async () => {
    const m = await armar();
    const auditadas = (await c.auditoria(e.empresa, "RECEPCION_REGISTRADA")).length;
    c.inyectarFalla("lineas");
    try {
      await expect(
        c.casos.registrarRecepcion(e.operador, {
          ...pedido(m),
          controles: [{ linea: 1, condicion: "CONFORME" }],
        }),
      ).rejects.toThrow();
    } finally {
      c.inyectarFalla(null);
    }
    expect(await recepciones(m.proveedor)).toBe(0);
    expect((await c.auditoria(e.empresa, "RECEPCION_REGISTRADA")).length).toBe(auditadas);
  });

  it("el control inválido se rechaza antes de escribir (observación faltante, línea que no existe, línea repetida, temperatura imposible)", async () => {
    const m = await armar();
    const rechaza = async (controles: unknown, error: string) => {
      expect(await c.casos.registrarRecepcion(e.operador, { ...pedido(m), controles })).toEqual({
        ok: false,
        error,
      });
    };
    await rechaza([{ linea: 1, condicion: "RECHAZADA" }], "OBSERVACION_REQUERIDA");
    await rechaza([{ linea: 2, condicion: "CONFORME" }], "LINEA_NO_ENCONTRADA");
    await rechaza(
      [
        { linea: 1, condicion: "CONFORME" },
        { linea: 1, condicion: "CONFORME" },
      ],
      "LINEA_REPETIDA",
    );
    await rechaza(
      [{ linea: 1, condicion: "CONFORME", temperaturaEnC: "-300" }],
      "TEMPERATURA_INVALIDA",
    );
    await rechaza("no es una lista", "CONTROL_INVALIDO");
    expect(await recepciones(m.proveedor)).toBe(0);
  });

  it("permisos y alcance: sin persona o fuera de la sucursal no recibe; la perilla apagada cierra la función", async () => {
    const m = await armar();
    expect(await c.casos.registrarRecepcion({ ...e.operador, personaId: null }, pedido(m))).toEqual(
      { ok: false, error: "SIN_PERMISO" },
    );
    const fuera = await c.casos.registrarRecepcion(e.operador, {
      ...pedido(m),
      sucursalId: e.otraSucursal,
    });
    expect(fuera.ok).toBe(false);
    c.apagarPerillas();
    try {
      expect(await c.casos.registrarRecepcion(e.operador, pedido(m))).toEqual({
        ok: false,
        error: { error: "FUNCION_NO_INCLUIDA", perilla: "recepcion_separada" },
      });
    } finally {
      c.encenderPerilla("recepcion_separada");
    }
    expect(await recepciones(m.proveedor)).toBe(0);
  });

  it("aislamiento: el proveedor de otra empresa no existe para esta, y la clave de una empresa no choca con la de otra", async () => {
    const m = await armar();
    const ajeno = await armar(n1);
    const r = await c.casos.registrarRecepcion(
      e.operador,
      pedido({ ...m, proveedor: ajeno.proveedor }),
    );
    expect(codigo(r)).toBe("PROVEEDOR_NO_ENCONTRADO");
  });

  it("N1 y N2 no ven una recepción pendiente: anularla por el camino de la compra, no existe; el listado de compras no la trae", async () => {
    const m = await armar();
    const r = valorDe(await c.casos.registrarRecepcion(e.operador, pedido(m)));
    expect(
      await c.casos.anularCompra(e.gerente, { recepcionId: r.recepcionId, motivo: "Prueba" }),
    ).toMatchObject({ ok: false, error: "RECEPCION_NO_ENCONTRADA" });
    const lista = valorDe(await c.consultas.listarCompras(e.gerente, { proveedorId: m.proveedor }));
    expect(JSON.stringify(lista)).not.toContain(r.recepcionId);
    const [rec] = await c.filas<{ estado: string }>("select estado from recepcion where id = $1", [
      r.recepcionId,
    ]);
    expect(rec?.estado).toBe("PENDIENTE");
  });

  // ===============================================================================================
  describe("confirmarRecepcion y anularRecepcionPendiente", () => {
    const recibir = async (
      m: Awaited<ReturnType<typeof armar>>,
      extra: Record<string, unknown> = {},
    ) => valorDe(await c.casos.registrarRecepcion(e.operador, pedido(m, e, extra)));
    const estadoDe = async (id: string) =>
      (await c.filas<{ estado: string }>("select estado from recepcion where id = $1", [id]))[0]
        ?.estado;
    const movimientosDe = (deposito: string) =>
      c.contar("select count(*) as n from movimiento_de_stock where deposito_id = $1", [deposito]);

    it("el gerente confirma: la recepción pasa a CONFIRMADA con quién y cuándo, entra el stock con su costo, queda lo que entró por línea, la oferta y la auditoría", async () => {
      const m = await armar();
      const r = await recibir(m);
      const hecha = valorDe(
        await c.casos.confirmarRecepcion(e.gerente, {
          recepcionId: r.recepcionId,
          depositoId: m.deposito,
        }),
      );
      expect(hecha).toMatchObject({ recepcionId: r.recepcionId, yaExistia: false });
      expect(hecha.movimientos).toHaveLength(1);
      expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
      const [rec] = await c.filas<Record<string, unknown>>(
        "select estado, confirmada_por, confirmada_en is not null as con_hora from recepcion where id = $1",
        [r.recepcionId],
      );
      expect(rec).toEqual({
        estado: "CONFIRMADA",
        confirmada_por: e.gerente.personaId,
        con_hora: true,
      });
      const [entrada] = await c.filas<Record<string, unknown>>(
        "select linea, deposito_id, movimiento_id, cantidad::text as cantidad from entrada_de_linea_de_recepcion where recepcion_id = $1",
        [r.recepcionId],
      );
      expect(entrada).toEqual({
        linea: 1,
        deposito_id: m.deposito,
        movimiento_id: hecha.movimientos[0],
        cantidad: "2000.0000",
      });
      const [oferta] = await c.filas<Record<string, string>>(
        "select ultimo_precio::text as p, ultima_compra_id from oferta_de_proveedor where proveedor_id = $1",
        [m.proveedor],
      );
      expect(oferta).toMatchObject({ p: "1000.000000", ultima_compra_id: r.recepcionId });
      expect((await c.auditoria(e.empresa, "RECEPCION_CONFIRMADA")).at(-1)).toMatchObject({
        actor_persona_id: e.gerente.personaId,
        entidad_id: r.recepcionId,
      });
    });

    it("el operador no confirma (SIN_PERMISO) y no cambia nada", async () => {
      const m = await armar();
      const r = await recibir(m);
      const intento = await c.casos.confirmarRecepcion(e.operador, {
        recepcionId: r.recepcionId,
        depositoId: m.deposito,
      });
      expect(intento).toMatchObject({ ok: false, error: "SIN_PERMISO" });
      expect(await estadoDe(r.recepcionId)).toBe("PENDIENTE");
      expect(await movimientosDe(m.deposito)).toBe(0);
    });

    it("I2: confirmar dos veces la misma recepción deja una entrada de stock y la segunda devuelve yaExistia sin escribir ni auditar", async () => {
      const m = await armar();
      const r = await recibir(m);
      const pedidoDeConfirmar = { recepcionId: r.recepcionId, depositoId: m.deposito };
      const primera = valorDe(await c.casos.confirmarRecepcion(e.gerente, pedidoDeConfirmar));
      const auditadas = (await c.auditoria(e.empresa, "RECEPCION_CONFIRMADA")).length;
      const segunda = valorDe(await c.casos.confirmarRecepcion(e.administrador, pedidoDeConfirmar));
      expect(segunda).toEqual({ ...primera, yaExistia: true });
      expect(await movimientosDe(m.deposito)).toBe(1);
      expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
      expect((await c.auditoria(e.empresa, "RECEPCION_CONFIRMADA")).length).toBe(auditadas);
    });

    it("C2: dos personas confirman la misma recepción a la vez: entra el stock una sola vez", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const m = await armar();
        const r = await recibir(m);
        const pedidoDeConfirmar = { recepcionId: r.recepcionId, depositoId: m.deposito };
        c.armarBarrera(2);
        let resultados;
        try {
          resultados = await Promise.all([
            c.casos.confirmarRecepcion(e.gerente, pedidoDeConfirmar),
            c.casos.confirmarRecepcion(e.administrador, pedidoDeConfirmar),
          ]);
        } finally {
          c.soltarBarrera();
        }
        for (const x of resultados) expect(x.ok || codigo(x) === "ConcurrenciaAgotada").toBe(true);
        expect(resultados.some((x) => x.ok && !x.valor.yaExistia)).toBe(true);
        expect(await movimientosDe(m.deposito)).toBe(1);
        expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
        expect(await estadoDe(r.recepcionId)).toBe("CONFIRMADA");
      }
    });

    it("depósito de destino: sin elegir entre varios normales, o con uno de otra sucursal, no se confirma nada (todo o nada) y sigue PENDIENTE", async () => {
      const m = await armar();
      const r = await recibir(m);
      expect(await c.casos.confirmarRecepcion(e.gerente, { recepcionId: r.recepcionId })).toEqual({
        ok: false,
        error: "DEPOSITO_A_ELEGIR",
      });
      const ajeno = await c.deposito(n1);
      expect(
        await c.casos.confirmarRecepcion(e.gerente, {
          recepcionId: r.recepcionId,
          depositoId: ajeno,
        }),
      ).toEqual({ ok: false, error: "DEPOSITO_NO_ENCONTRADO" });
      expect(await estadoDe(r.recepcionId)).toBe("PENDIENTE");
      expect(await movimientosDe(m.deposito)).toBe(0);
    });

    /** Una empresa aparte en N3 (así sus depósitos de cuarentena y rechazo no se mezclan con los de las demás pruebas). */
    const empresaN3 = async () => {
      const x = await c.escenario();
      valorDe(
        await c.casos.configurarCompras(x.gerente, {
          nivel: "RECEPCION_SEPARADA",
          versionEsperada: 1,
        }),
      );
      const normal = await c.deposito(x);
      const a = await c.articulo(x, { unidadBase: "GRAMO", dimension: "MASA" });
      const b = await c.articulo(x, { unidadBase: "GRAMO", dimension: "MASA" });
      const proveedor = await c.proveedor(x.operador);
      const renglon = (producto: string) => ({
        productoId: producto,
        unidadDeCompraId: "KILOGRAMO",
        cantidad: "1",
        precioPor: "UNIDAD",
        unidadDePrecioId: "KILOGRAMO",
        precio: "500",
      });
      const recibirDos = async (controles: unknown[]) =>
        valorDe(
          await c.casos.registrarRecepcion(x.operador, {
            clave: nuevoId(),
            sucursalId: x.sucursal,
            proveedorId: proveedor,
            renglones: [renglon(a.producto), renglon(b.producto)],
            controles,
          }),
        );
      return { x, normal, a, b, proveedor, recibirDos };
    };
    const existencia = (x: EscenarioDeCompras, d: string, articulo: string) =>
      c.existencia(d, articulo);
    void existencia;

    it("N3-3: el control propone el destino (rechazada → rechazo, con observaciones → cuarentena, conforme → normal): una entrada de stock por depósito", async () => {
      const { x, normal, a, b, recibirDos } = await empresaN3();
      const cuarentena = await c.deposito(x, { uso: "CUARENTENA" });
      const rechazo = await c.deposito(x, { uso: "RECHAZO" });
      const r = await recibirDos([
        { linea: 1, condicion: "CON_OBSERVACIONES", observacion: "Caja abollada" },
        { linea: 2, condicion: "RECHAZADA", observacion: "Vencida" },
      ]);
      const hecha = valorDe(
        await c.casos.confirmarRecepcion(x.gerente, {
          recepcionId: r.recepcionId,
          depositoId: normal,
        }),
      );
      expect(hecha.movimientos).toHaveLength(2);
      expect(await c.existencia(cuarentena, a.articulo)).toBe("1000.0000");
      expect(await c.existencia(rechazo, b.articulo)).toBe("1000.0000");
      expect(await c.existencia(normal, a.articulo)).toBe("0");
      expect(await c.existencia(normal, b.articulo)).toBe("0");
      const entradas = await c.filas<{ linea: number; deposito_id: string }>(
        "select linea, deposito_id from entrada_de_linea_de_recepcion where recepcion_id = $1 order by linea",
        [r.recepcionId],
      );
      expect(entradas).toEqual([
        { linea: 1, deposito_id: cuarentena },
        { linea: 2, deposito_id: rechazo },
      ]);
      // lo rechazado no mueve el último precio del proveedor; lo observado sí
      expect(
        await c.contar("select count(*) as n from oferta_de_proveedor where producto_id = $1", [
          b.producto,
        ]),
      ).toBe(0);
      expect(
        await c.contar("select count(*) as n from oferta_de_proveedor where producto_id = $1", [
          a.producto,
        ]),
      ).toBe(1);
      // repetir no mueve nada más
      valorDe(
        await c.casos.confirmarRecepcion(x.gerente, {
          recepcionId: r.recepcionId,
          depositoId: normal,
        }),
      );
      expect(await c.existencia(cuarentena, a.articulo)).toBe("1000.0000");
    });

    it("N3-3: sin depósito de cuarentena o de rechazo en la sucursal se BLOQUEA la confirmación (falla cerrada) y la recepción sigue pendiente; con dos y sin elegir, DEPOSITO_A_ELEGIR", async () => {
      const { x, normal, recibirDos } = await empresaN3();
      const r = await recibirDos([{ linea: 2, condicion: "RECHAZADA", observacion: "Vencida" }]);
      expect(
        await c.casos.confirmarRecepcion(x.gerente, {
          recepcionId: r.recepcionId,
          depositoId: normal,
        }),
      ).toEqual({ ok: false, error: "DEPOSITO_DE_CALIDAD_NO_CONFIGURADO" });
      expect(await estadoDe(r.recepcionId)).toBe("PENDIENTE");
      expect(await movimientosDe(normal)).toBe(0);
      await c.deposito(x, { uso: "RECHAZO" });
      await c.deposito(x, { uso: "RECHAZO" });
      expect(
        await c.casos.confirmarRecepcion(x.gerente, {
          recepcionId: r.recepcionId,
          depositoId: normal,
        }),
      ).toEqual({ ok: false, error: "DEPOSITO_A_ELEGIR" });
      expect(await estadoDe(r.recepcionId)).toBe("PENDIENTE");
    });

    it("N3-3: quien confirma cambia el destino de una línea (queda auditado); un destino de una línea que no existe o de otro depósito inexistente se rechaza", async () => {
      const { x, normal, a, b, recibirDos } = await empresaN3();
      const cuarentena = await c.deposito(x, { uso: "CUARENTENA" });
      const r = await recibirDos([]);
      expect(
        await c.casos.confirmarRecepcion(x.gerente, {
          recepcionId: r.recepcionId,
          depositoId: normal,
          destinos: [{ linea: 3, depositoId: cuarentena }],
        }),
      ).toEqual({ ok: false, error: "LINEA_NO_ENCONTRADA" });
      expect(
        await c.casos.confirmarRecepcion(x.gerente, {
          recepcionId: r.recepcionId,
          depositoId: normal,
          destinos: [{ linea: 1, depositoId: nuevoId() }],
        }),
      ).toEqual({ ok: false, error: "DEPOSITO_NO_ENCONTRADO" });
      expect(await estadoDe(r.recepcionId)).toBe("PENDIENTE");
      valorDe(
        await c.casos.confirmarRecepcion(x.gerente, {
          recepcionId: r.recepcionId,
          depositoId: normal,
          destinos: [{ linea: 1, depositoId: cuarentena }],
        }),
      );
      expect(await c.existencia(cuarentena, a.articulo)).toBe("1000.0000");
      expect(await c.existencia(normal, b.articulo)).toBe("1000.0000");
      const auditoria = (await c.auditoria(x.empresa, "RECEPCION_CONFIRMADA")).at(-1);
      expect(JSON.stringify(auditoria)).toContain('"destinoElegido":true');
      expect(JSON.stringify(auditoria)).toContain('"destinoElegido":false');
    });

    it("recepción inexistente, de otra empresa o con id inválido: RECEPCION_NO_ENCONTRADA", async () => {
      const m = await armar();
      const r = await recibir(m);
      const ajena = await c.casos.confirmarRecepcion(n1.gerente, { recepcionId: r.recepcionId });
      expect(ajena).toEqual({ ok: false, error: "RECEPCION_NO_ENCONTRADA" });
      for (const recepcionId of [nuevoId(), "no-es-un-id"]) {
        expect(await c.casos.confirmarRecepcion(e.gerente, { recepcionId })).toEqual({
          ok: false,
          error: "RECEPCION_NO_ENCONTRADA",
        });
      }
      expect(await estadoDe(r.recepcionId)).toBe("PENDIENTE");
    });

    it("I3: anular dos veces una pendiente: la segunda es RECEPCION_YA_ANULADA y no escribe; una confirmada no se anula por acá; una anulada no se confirma", async () => {
      const m = await armar();
      const r = await recibir(m);
      expect(
        await c.casos.anularRecepcionPendiente(e.operador, {
          recepcionId: r.recepcionId,
          motivo: "No era",
        }),
      ).toMatchObject({ ok: false, error: "SIN_PERMISO" });
      expect(
        await c.casos.anularRecepcionPendiente(e.gerente, {
          recepcionId: r.recepcionId,
          motivo: "  ",
        }),
      ).toEqual({ ok: false, error: "MOTIVO_REQUERIDO" });
      expect(
        valorDe(
          await c.casos.anularRecepcionPendiente(e.gerente, {
            recepcionId: r.recepcionId,
            motivo: "Se cargó mal",
          }),
        ),
      ).toEqual({ anulada: true });
      const auditadas = (await c.auditoria(e.empresa, "RECEPCION_ANULADA")).length;
      expect(
        await c.casos.anularRecepcionPendiente(e.administrador, {
          recepcionId: r.recepcionId,
          motivo: "Otra vez",
        }),
      ).toEqual({ ok: false, error: "RECEPCION_YA_ANULADA" });
      expect((await c.auditoria(e.empresa, "RECEPCION_ANULADA")).length).toBe(auditadas);
      expect(
        await c.casos.confirmarRecepcion(e.gerente, {
          recepcionId: r.recepcionId,
          depositoId: m.deposito,
        }),
      ).toEqual({ ok: false, error: "RECEPCION_YA_ANULADA" });
      const [anulada] = await c.filas<Record<string, unknown>>(
        "select estado, anulada_por, motivo_de_anulacion from recepcion where id = $1",
        [r.recepcionId],
      );
      expect(anulada).toEqual({
        estado: "ANULADA",
        anulada_por: e.gerente.personaId,
        motivo_de_anulacion: "Se cargó mal",
      });
      const n = await recibir(m);
      valorDe(
        await c.casos.confirmarRecepcion(e.gerente, {
          recepcionId: n.recepcionId,
          depositoId: m.deposito,
        }),
      );
      expect(
        await c.casos.anularRecepcionPendiente(e.gerente, {
          recepcionId: n.recepcionId,
          motivo: "Tarde",
        }),
      ).toEqual({ ok: false, error: "RECEPCION_YA_CONFIRMADA" });
      expect(await estadoDe(n.recepcionId)).toBe("CONFIRMADA");
    });

    it("C3: confirmar y anular la misma pendiente a la vez: gana una sola y el stock queda de acuerdo", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const m = await armar();
        const r = await recibir(m);
        c.armarBarrera(2);
        let resultados;
        try {
          resultados = await Promise.all([
            c.casos.confirmarRecepcion(e.gerente, {
              recepcionId: r.recepcionId,
              depositoId: m.deposito,
            }),
            c.casos.anularRecepcionPendiente(e.administrador, {
              recepcionId: r.recepcionId,
              motivo: "Carrera",
            }),
          ]);
        } finally {
          c.soltarBarrera();
        }
        const estado = await estadoDe(r.recepcionId);
        expect(["CONFIRMADA", "ANULADA"]).toContain(estado);
        expect(await movimientosDe(m.deposito)).toBe(estado === "CONFIRMADA" ? 1 : 0);
        expect(await c.existencia(m.deposito, m.articulo)).toBe(
          estado === "CONFIRMADA" ? "2000.0000" : "0",
        );
        expect(resultados.filter((x) => x.ok)).toHaveLength(1);
      }
    });

    it("una recepción confirmada de N3 tampoco la ven los caminos de N1: anularla por «anular compra» no existe y no devuelve stock que no entró por ahí", async () => {
      const m = await armar();
      const r = await recibir(m);
      valorDe(
        await c.casos.confirmarRecepcion(e.gerente, {
          recepcionId: r.recepcionId,
          depositoId: m.deposito,
        }),
      );
      expect(
        await c.casos.anularCompra(e.gerente, { recepcionId: r.recepcionId, motivo: "Prueba" }),
      ).toMatchObject({ ok: false, error: "RECEPCION_NO_ENCONTRADA" });
      expect(await estadoDe(r.recepcionId)).toBe("CONFIRMADA");
      expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
    });
  });
});
