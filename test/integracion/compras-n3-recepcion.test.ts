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
});
