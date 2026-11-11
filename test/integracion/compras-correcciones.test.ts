import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { codigoDe } from "./concurrencia-apoyo";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";

/**
 * E9-T11: corregir el PRECIO de una línea de una compra ya hecha, con un ajuste y un motivo (D143). La corrección es una fila nueva (la línea no se edita) y el
 * costo de stock se corrige por la diferencia sobre lo que queda (fórmula A, P-2): lo ya consumido conserva su costo congelado. C4 (dos correcciones a la vez),
 * C5 (corregir y anular a la vez), I6 (la misma corrección dos veces), A3 (una falla en el ajuste de costo no deja nada) y R8 (anular una compra consumida; corregirla).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras: corrección del precio de una compra", () => {
  let c: MontajeDeCompras;
  let e: EscenarioDeCompras;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    e = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const armar = async () => {
    const deposito = await c.deposito(e);
    const { producto, articulo } = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador);
    return { deposito, producto, articulo, proveedor };
  };
  type Montaje = Awaited<ReturnType<typeof armar>>;
  /** 2 kg a 1000 el kilo: entran 2000 g a 1,000000 por gramo. */
  const compra = (m: Montaje, renglon: Record<string, unknown> = {}) => ({
    clave: nuevoId(),
    sucursalId: e.sucursal,
    proveedorId: m.proveedor,
    depositoId: m.deposito,
    renglones: [
      {
        productoId: m.producto,
        unidadDeCompraId: "KILOGRAMO",
        cantidad: "2",
        precioPor: "UNIDAD",
        unidadDePrecioId: "KILOGRAMO",
        precio: "1000",
        ...renglon,
      },
    ],
  });
  const comprar = async (m: Montaje, renglon: Record<string, unknown> = {}) =>
    valorDe(await c.casos.registrarCompra(e.operador, compra(m, renglon)));
  const corregir = (recepcionId: string, extra: Record<string, unknown> = {}) => ({
    clave: nuevoId(),
    recepcionId,
    linea: 1,
    correccionesVistas: 0,
    precio: "1200",
    motivo: "El proveedor cobró 1200 el kilo",
    ...extra,
  });
  const promedio = async (m: Montaje) =>
    (
      await c.filas<{ costo: string; valorizada: string }>(
        "select costo_unitario::text as costo, cantidad_valorizada::text as valorizada from costo_de_articulo where deposito_id = $1 and articulo_id = $2",
        [m.deposito, m.articulo],
      )
    )[0];
  const filasDeCorreccion = (recepcionId: string) =>
    c.contar("select count(*) as n from correccion_de_compra where recepcion_id = $1", [
      recepcionId,
    ]);
  const ajustes = (articulo: string) =>
    c.filas("select * from auditoria_empresa where accion = 'COSTO_AJUSTADO' and entidad_id = $1", [
      articulo,
    ]);

  it("el gerente corrige el precio: queda la corrección con su motivo, el promedio sube por la diferencia y la línea original no se toca", async () => {
    const m = await armar();
    const r = await comprar(m);
    expect(await promedio(m)).toEqual({ costo: "1.000000", valorizada: "2000.0000" });
    const salida = valorDe(await c.casos.corregirCompra(e.gerente, corregir(r.recepcionId)));
    expect(salida).toEqual({
      recepcionId: r.recepcionId,
      linea: 1,
      numero: 1,
      yaExistia: false,
      ajuste: {
        costoPorUnidadAntes: "1.000000",
        costoPorUnidadDespues: "1.200000",
        promedioAntes: "1.000000",
        promedioDespues: "1.200000",
        consumidoAlCorregir: "0.0000",
      },
    });
    expect(await promedio(m)).toEqual({ costo: "1.200000", valorizada: "2000.0000" });
    const [corr] = await c.filas<Record<string, unknown>>(
      "select numero, precio_anterior::text as anterior, precio_nuevo::text as nuevo, motivo, registrado_por, cantidad_nueva from correccion_de_compra where recepcion_id = $1",
      [r.recepcionId],
    );
    expect(corr).toEqual({
      numero: 1,
      anterior: "1000.000000",
      nuevo: "1200.000000",
      motivo: "El proveedor cobró 1200 el kilo",
      registrado_por: e.gerente.personaId,
      cantidad_nueva: null,
    });
    const [linea] = await c.filas<Record<string, unknown>>(
      "select precio::text as precio, importe::text as importe, costo_por_unidad_de_stock::text as costo from linea_de_recepcion where recepcion_id = $1",
      [r.recepcionId],
    );
    expect(linea).toEqual({ precio: "1000.000000", importe: "2000.00", costo: "1.000000" });
    expect((await c.auditoria(e.empresa, "COMPRA_CORREGIDA")).at(-1)).toMatchObject({
      entidad_id: r.recepcionId,
      actor_persona_id: e.gerente.personaId,
    });
    expect(await ajustes(m.articulo)).toHaveLength(1);
    // La ficha de la compra muestra la corrección: la línea sigue con su precio original.
    const ficha = valorDe(
      await c.consultas.fichaDeCompra(e.gerente, { recepcionId: r.recepcionId }),
    );
    expect(ficha?.correcciones).toEqual([
      {
        linea: 1,
        numero: 1,
        precioAnterior: "1000.000000",
        precioNuevo: "1200.000000",
        motivo: "El proveedor cobró 1200 el kilo",
        registradoPor: e.gerente.personaId,
        registradoEn: expect.any(String) as unknown,
      },
    ]);
    expect(ficha?.lineas[0]?.precio).toBe("1000.000000");
  });

  it("lo ya consumido conserva su costo: la salida anterior queda con 1,000000 y solo lo que queda se corrige (R8)", async () => {
    const m = await armar();
    const r = await comprar(m);
    valorDe(
      await c.stockCasos.registrarSalida(e.gerente, {
        clave: nuevoId(),
        depositoId: m.deposito,
        motivo: "MERMA",
        detalle: "se tiró",
        renglones: [{ productoId: m.producto, cantidad: "1500", unidadId: "GRAMO" }],
      }),
    );
    // Anular no se puede (consumida) pero corregir sí.
    expect(
      await c.casos.anularCompra(e.gerente, {
        recepcionId: r.recepcionId,
        motivo: "Quiero anular",
      }),
    ).toEqual({ ok: false, error: "COMPRA_CONSUMIDA" });
    const salida = valorDe(await c.casos.corregirCompra(e.gerente, corregir(r.recepcionId)));
    expect(salida.ajuste).toMatchObject({
      promedioAntes: "1.000000",
      promedioDespues: "1.200000",
      consumidoAlCorregir: "1500.0000",
    });
    expect(await promedio(m)).toEqual({ costo: "1.200000", valorizada: "500.0000" });
    const congelados = await c.filas<{ costo: string }>(
      `select r.costo_unitario::text as costo from costo_de_renglon r join movimiento_de_stock mv on mv.id = r.movimiento_id and mv.empresa_id = r.empresa_id
        where mv.deposito_id = $1 and mv.clase = 'SALIDA'`,
      [m.deposito],
    );
    expect(congelados).toEqual([{ costo: "1.000000" }]);
  });

  it("si ya se consumió todo, se corrige igual: queda la corrección, el promedio no cambia y todo figura como consumido", async () => {
    const m = await armar();
    const r = await comprar(m);
    valorDe(
      await c.stockCasos.registrarSalida(e.gerente, {
        clave: nuevoId(),
        depositoId: m.deposito,
        motivo: "MERMA",
        detalle: "se tiró todo",
        renglones: [{ productoId: m.producto, cantidad: "2000", unidadId: "GRAMO" }],
      }),
    );
    const salida = valorDe(await c.casos.corregirCompra(e.gerente, corregir(r.recepcionId)));
    expect(salida.ajuste).toMatchObject({
      promedioAntes: "1.000000",
      promedioDespues: "1.000000",
      consumidoAlCorregir: "2000.0000",
    });
    expect(await filasDeCorreccion(r.recepcionId)).toBe(1);
  });

  it("con otra compra en el mismo depósito, solo se corrige la parte que es de esta: 1,5 → 1,6", async () => {
    const m = await armar();
    const a = await comprar(m);
    await comprar(m, { precio: "2000" });
    expect(await promedio(m)).toEqual({ costo: "1.500000", valorizada: "4000.0000" });
    valorDe(await c.casos.corregirCompra(e.gerente, corregir(a.recepcionId)));
    expect(await promedio(m)).toEqual({ costo: "1.600000", valorizada: "4000.0000" });
  });

  it("SIN_CAMBIOS con el mismo precio (aunque se escriba distinto); PRECIO_INVALIDO, MOTIVO_REQUERIDO, LINEA_NO_ENCONTRADA e IDENTIFICADOR_INVALIDO no escriben", async () => {
    const m = await armar();
    const r = await comprar(m);
    const intentos: [Record<string, unknown>, string][] = [
      [{ precio: "1000" }, "SIN_CAMBIOS"],
      [{ precio: "1000.000000" }, "SIN_CAMBIOS"],
      [{ precio: "0" }, "PRECIO_INVALIDO"],
      [{ precio: "-5" }, "PRECIO_INVALIDO"],
      [{ precio: "abc" }, "PRECIO_INVALIDO"],
      [{ precio: 1200 }, "PRECIO_INVALIDO"],
      [{ motivo: "" }, "MOTIVO_REQUERIDO"],
      [{ motivo: 7 }, "MOTIVO_REQUERIDO"],
      [{ linea: 2 }, "LINEA_NO_ENCONTRADA"],
      [{ linea: 0 }, "LINEA_NO_ENCONTRADA"],
      [{ linea: 1.5 }, "LINEA_NO_ENCONTRADA"],
      [{ clave: "no" }, "IDENTIFICADOR_INVALIDO"],
      [{ recepcionId: "no" }, "IDENTIFICADOR_INVALIDO"],
      [{ correccionesVistas: -1 }, "CORRECCION_DESACTUALIZADA"],
      [{ correccionesVistas: 3 }, "CORRECCION_DESACTUALIZADA"],
    ];
    for (const [cambio, codigoEsperado] of intentos) {
      const r2 = await c.casos.corregirCompra(e.gerente, corregir(r.recepcionId, cambio));
      expect(codigoDe(r2), JSON.stringify(cambio)).toBe(codigoEsperado);
    }
    expect(await filasDeCorreccion(r.recepcionId)).toBe(0);
    expect(await promedio(m)).toEqual({ costo: "1.000000", valorizada: "2000.0000" });
  });

  it("una corrección sobre otra: la versión optimista (vistas) numera 1, 2 y la vigente es la última; una desactualizada se rechaza", async () => {
    const m = await armar();
    const r = await comprar(m);
    valorDe(await c.casos.corregirCompra(e.gerente, corregir(r.recepcionId)));
    // Quien miró antes de la primera corrección (vistas 0) ya no puede corregir.
    expect(
      await c.casos.corregirCompra(e.gerente, corregir(r.recepcionId, { precio: "1500" })),
    ).toEqual({
      ok: false,
      error: "CORRECCION_DESACTUALIZADA",
    });
    // El precio vigente es el corregido (1200): corregirlo a 1200 no cambia nada.
    expect(
      codigoDe(
        await c.casos.corregirCompra(e.gerente, corregir(r.recepcionId, { correccionesVistas: 1 })),
      ),
    ).toBe("SIN_CAMBIOS");
    const segunda = valorDe(
      await c.casos.corregirCompra(
        e.administrador,
        corregir(r.recepcionId, { correccionesVistas: 1, precio: "1500" }),
      ),
    );
    expect(segunda).toMatchObject({
      numero: 2,
      ajuste: { costoPorUnidadAntes: "1.200000", costoPorUnidadDespues: "1.500000" },
    });
    expect(await promedio(m)).toEqual({ costo: "1.500000", valorizada: "2000.0000" });
    const filas = await c.filas<Record<string, unknown>>(
      "select numero, precio_anterior::text as anterior, precio_nuevo::text as nuevo from correccion_de_compra where recepcion_id = $1 order by numero",
      [r.recepcionId],
    );
    expect(filas).toEqual([
      { numero: 1, anterior: "1000.000000", nuevo: "1200.000000" },
      { numero: 2, anterior: "1200.000000", nuevo: "1500.000000" },
    ]);
  });

  it("I6: la misma corrección dos veces (misma clave) deja una sola fila, un solo ajuste de costo y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA", async () => {
    const m = await armar();
    const r = await comprar(m);
    const pedido = corregir(r.recepcionId);
    const primero = valorDe(await c.casos.corregirCompra(e.gerente, pedido));
    const auditorias = (await c.auditoria(e.empresa, "COMPRA_CORREGIDA")).length;
    expect(valorDe(await c.casos.corregirCompra(e.administrador, pedido))).toEqual({
      recepcionId: r.recepcionId,
      linea: 1,
      numero: primero.numero,
      yaExistia: true,
      ajuste: null,
    });
    expect(await filasDeCorreccion(r.recepcionId)).toBe(1);
    expect(await ajustes(m.articulo)).toHaveLength(1);
    expect(await promedio(m)).toEqual({ costo: "1.200000", valorizada: "2000.0000" });
    expect((await c.auditoria(e.empresa, "COMPRA_CORREGIDA")).length).toBe(auditorias);
    expect(await c.casos.corregirCompra(e.gerente, { ...pedido, precio: "1300" })).toEqual({
      ok: false,
      error: "CLAVE_REUTILIZADA",
    });
    expect(await c.casos.corregirCompra(e.gerente, { ...pedido, motivo: "Otro motivo" })).toEqual({
      ok: false,
      error: "CLAVE_REUTILIZADA",
    });
    // El mismo precio escrito de otra forma es el mismo pedido.
    expect(
      valorDe(await c.casos.corregirCompra(e.gerente, { ...pedido, precio: "1200.000000" }))
        .yaExistia,
    ).toBe(true);
  });

  it("C4: dos correcciones a la vez de la misma línea con las mismas correccionesVistas: una gana, la otra CORRECCION_DESACTUALIZADA, un solo ajuste", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const r = await comprar(m);
      c.armarBarrera(2);
      try {
        const resultados = await Promise.all([
          c.casos.corregirCompra(e.gerente, corregir(r.recepcionId, { precio: "1200" })),
          c.casos.corregirCompra(e.administrador, corregir(r.recepcionId, { precio: "1500" })),
        ]);
        expect(resultados.filter((x) => x.ok)).toHaveLength(1);
        for (const x of resultados.filter((y) => !y.ok)) {
          expect(["CORRECCION_DESACTUALIZADA", "ConcurrenciaAgotada"]).toContain(codigoDe(x));
        }
      } finally {
        c.soltarBarrera();
      }
      expect(await filasDeCorreccion(r.recepcionId)).toBe(1);
      expect(await ajustes(m.articulo)).toHaveLength(1);
    }
  });

  it("C5: corregir y anular la compra a la vez se serializan: la anulación siempre sale y la corrección o queda entera o no queda", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const r = await comprar(m);
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([
          c.casos.corregirCompra(e.gerente, corregir(r.recepcionId)),
          c.casos.anularCompra(e.administrador, { recepcionId: r.recepcionId, motivo: "Anular" }),
        ]);
      } finally {
        c.soltarBarrera();
      }
      const [correccion, anulacion] = resultados;
      expect(anulacion.ok, JSON.stringify(anulacion)).toBe(true);
      if (!correccion.ok) {
        expect(["RECEPCION_YA_ANULADA", "ConcurrenciaAgotada"]).toContain(codigoDe(correccion));
        expect(await filasDeCorreccion(r.recepcionId)).toBe(0);
      } else {
        // La corrección ganó el bloqueo de la recepción: quedó su fila y la anulación vino después.
        expect(await filasDeCorreccion(r.recepcionId)).toBe(1);
      }
    }
  });

  it("A3: si el ajuste de costo falla (stock apagado) no queda la corrección ni el ajuste", async () => {
    const m = await armar();
    const r = await comprar(m);
    c.apagarModulo("stock");
    try {
      const resultado = await c.casos.corregirCompra(e.gerente, corregir(r.recepcionId));
      expect(resultado.ok).toBe(false);
    } finally {
      c.encenderModulo("stock");
    }
    expect(await filasDeCorreccion(r.recepcionId)).toBe(0);
    expect(await ajustes(m.articulo)).toHaveLength(0);
    expect(await promedio(m)).toEqual({ costo: "1.000000", valorizada: "2000.0000" });
    expect(
      (await c.auditoria(e.empresa, "COMPRA_CORREGIDA")).filter(
        (a) => a.entidad_id === r.recepcionId,
      ),
    ).toHaveLength(0);
  });

  it("una compra anulada no se corrige (RECEPCION_YA_ANULADA); una que no existe, RECEPCION_NO_ENCONTRADA", async () => {
    const m = await armar();
    const r = await comprar(m);
    valorDe(
      await c.casos.anularCompra(e.gerente, { recepcionId: r.recepcionId, motivo: "Anular" }),
    );
    expect(await c.casos.corregirCompra(e.gerente, corregir(r.recepcionId))).toEqual({
      ok: false,
      error: "RECEPCION_YA_ANULADA",
    });
    expect(await c.casos.corregirCompra(e.gerente, corregir(nuevoId()))).toEqual({
      ok: false,
      error: "RECEPCION_NO_ENCONTRADA",
    });
  });

  it("el operador no corrige (SIN_PERMISO) y el sistema (sin persona) tampoco; una corrección de otra sucursal fuera de alcance se rechaza", async () => {
    const m = await armar();
    const r = await comprar(m);
    expect(await c.casos.corregirCompra(e.operador, corregir(r.recepcionId))).toEqual({
      ok: false,
      error: "SIN_PERMISO",
    });
    expect(
      await c.casos.corregirCompra({ ...e.gerente, personaId: null }, corregir(r.recepcionId)),
    ).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(await filasDeCorreccion(r.recepcionId)).toBe(0);
  });

  it("una compra que no entró a stock (producto sin artículo) se corrige igual: queda la fila y no hay ajuste de costo", async () => {
    const deposito = await c.deposito(e);
    const producto = await c.producto(e.empresa, {
      clase: "MATERIA_PRIMA",
      unidadBase: "GRAMO",
      dimension: "MASA",
    });
    const proveedor = await c.proveedor(e.operador);
    const r = valorDe(
      await c.casos.registrarCompra(e.operador, {
        ...compra({ deposito, producto, articulo: "", proveedor }),
      }),
    );
    const salida = valorDe(await c.casos.corregirCompra(e.gerente, corregir(r.recepcionId)));
    expect(salida.ajuste).toMatchObject({
      costoPorUnidadAntes: "1.000000",
      costoPorUnidadDespues: "1.200000",
      promedioAntes: null,
      promedioDespues: null,
      consumidoAlCorregir: null,
    });
    expect(await filasDeCorreccion(r.recepcionId)).toBe(1);
  });
});
