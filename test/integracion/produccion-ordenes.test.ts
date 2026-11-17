import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { montarProduccion, type MontajeDeProduccion } from "./produccion-apoyo";
import { nuevoId, valorDe, type EscenarioDeStock } from "./stock-casos-apoyo";

/**
 * E6-T8, órdenes de producción con los casos de uso reales y la base real: abrir (esperados escalados de la receta, sin mover nada, número de la base),
 * cerrar (consumo, producto, costo congelado y renglones reales en una transacción), cancelar, anular, la receta que cambia entre abrir y cerrar (D6),
 * el control de faltantes (D12), las consultas (con `recetaCambiada`, D6) y los permisos, el módulo apagado y la perilla.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("producción: órdenes (E6-T8)", () => {
  let c: MontajeDeProduccion;
  let e: EscenarioDeStock;
  let otra: EscenarioDeStock;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarProduccion(base);
    e = await c.escenario();
    otra = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  type P = Awaited<ReturnType<MontajeDeProduccion["panaderia"]>>;
  /** Una panadería con stock suficiente: 20 kg de harina a $ 1.000 y 10 kg de manteca a $ 9.000 en el depósito de origen. */
  const lista = async (escenario = e, abundante = false) => {
    const p = await c.panaderia(escenario);
    await c.comprar(escenario, p.origen, p.harina.producto, abundante ? "100" : "20", "1000");
    await c.comprar(escenario, p.origen, p.manteca.producto, abundante ? "50" : "10", "9000");
    return p;
  };
  const abrir = (p: P, extra: Record<string, unknown> = {}, quien = e.gerente) =>
    c.produccion.abrirOrden(quien, {
      id: nuevoId(),
      productoId: p.masa.producto,
      cantidad: "16",
      unidadId: "KILOGRAMO",
      depositoId: p.origen,
      depositoDestinoId: p.destino,
      ...extra,
    });
  const consumos = (p: P, harina = "12", manteca = "4") => [
    { productoId: p.harina.producto, cantidadReal: harina, unidadId: "KILOGRAMO" },
    { productoId: p.manteca.producto, cantidadReal: manteca, unidadId: "KILOGRAMO" },
  ];
  const cerrar = (ordenId: string, p: P, extra: Record<string, unknown> = {}, quien = e.gerente) =>
    c.produccion.cerrarOrden(quien, {
      ordenId,
      clave: nuevoId(),
      obtenido: "15",
      unidadId: "KILOGRAMO",
      consumos: consumos(p),
      ...extra,
    });
  const existencia = (deposito: string, articulo: { articulo: string }) =>
    c.existencia(deposito, articulo.articulo);
  const orden = async (id: string) =>
    (
      await c.filas<Record<string, unknown>>("select * from orden_de_produccion where id = $1", [
        id,
      ])
    )[0] as Record<string, unknown>;

  describe("abrirOrden", () => {
    it("lo esperado sale de la receta escalada (16 kg de masa con rinde 8: 12 de harina y 4 de manteca), con número de la base, la versión sellada y sin mover stock; queda auditada", async () => {
      const p = await lista();
      const r = valorDe(await abrir(p));
      expect(r.yaExistia).toBe(false);
      expect(r.numero).toBeGreaterThan(0);
      expect([...r.esperados].map((x) => [x.productoId, x.cantidad, x.unidadId]).sort()).toEqual(
        [
          [p.harina.producto, "12.0000", "KILOGRAMO"],
          [p.manteca.producto, "4.0000", "KILOGRAMO"],
        ].sort(),
      );
      expect(r.faltantes).toEqual([]);
      const fila = await orden(r.ordenId);
      expect(fila).toMatchObject({
        estado: "ABIERTA",
        numero: r.numero,
        cantidad_esperada: "16.0000",
      });
      const receta = await c.filas<{ id: string }>(
        "select id from composicion where producto_id = $1",
        [p.masa.producto],
      );
      expect(fila["composicion_id"]).toBe(receta[0]?.id);
      expect(await existencia(p.origen, p.harina)).toBe("20.0000");
      expect(
        await c.contar("select count(*) as n from movimiento_de_stock where origen_id = $1", [
          r.ordenId,
        ]),
      ).toBe(0);
      expect(
        await c.filas(
          "select numero, cantidad_esperada::text as esperada, cantidad_real from renglon_de_orden where orden_id = $1 order by cantidad_esperada desc",
          [r.ordenId],
        ),
      ).toEqual([
        { numero: expect.any(Number) as number, esperada: "12.0000", cantidad_real: null },
        { numero: expect.any(Number) as number, esperada: "4.0000", cantidad_real: null },
      ]);
      expect(
        (await c.auditoria(e.empresa, "ORDEN_DE_PRODUCCION_ABIERTA")).filter(
          (a) => a["entidad_id"] === r.ordenId,
        ),
      ).toHaveLength(1);
    });

    it("el número es correlativo por empresa; el operador también abre (DEC-0101); con la perilla apagada, FUNCION_NO_INCLUIDA; con el módulo apagado nadie", async () => {
      const p = await lista();
      const a = valorDe(await abrir(p));
      const b = valorDe(await abrir(p, {}, e.operador));
      expect(b.numero).toBe(a.numero + 1);
      c.apagarPerillas();
      try {
        expect(await abrir(p)).toEqual({
          ok: false,
          error: { error: "FUNCION_NO_INCLUIDA", perilla: "produccion" },
        });
      } finally {
        c.encenderPerilla("produccion");
      }
      c.apagarModulo("produccion");
      try {
        expect((await abrir(p)).ok).toBe(false);
      } finally {
        c.encenderModulos();
      }
      // Otra empresa tiene su propia numeración y no ve las de esta.
      const deOtra = await lista(otra);
      expect(valorDe(await abrir(deOtra, {}, otra.gerente)).numero).toBe(1);
    });

    it("valida: producto sin receta o sin artículo, depósitos, cantidad y unidad, ids, alcance de sucursal", async () => {
      const p = await lista();
      const sinReceta = await c.articulo(e, { clase: "ELABORADO", ...c.kilos });
      expect(await abrir(p, { productoId: sinReceta.producto })).toEqual({
        ok: false,
        error: "PRODUCTO_SIN_RECETA",
      });
      const sinArticulo = await c.vendible(e);
      await c.casos.guardarComposicion(e.gerente, {
        productoId: sinArticulo,
        versionEsperada: 0,
        rinde: "1",
        componentes: [{ productoId: p.harina.producto, cantidad: "1", unidadId: "KILOGRAMO" }],
      });
      expect(await abrir(p, { productoId: sinArticulo, unidadId: "UNIDAD" })).toEqual({
        ok: false,
        error: "PRODUCTO_NO_SE_PRODUCE",
      });
      expect(await abrir(p, { productoId: nuevoId() })).toEqual({
        ok: false,
        error: "PRODUCTO_NO_ENCONTRADO",
      });
      expect(await abrir(p, { depositoId: nuevoId() })).toEqual({
        ok: false,
        error: "DEPOSITO_NO_ENCONTRADO",
      });
      expect(await abrir(p, { depositoDestinoId: nuevoId() })).toEqual({
        ok: false,
        error: "DEPOSITO_DE_DESTINO_NO_ENCONTRADO",
      });
      const cuarentena = await c.deposito(e, { uso: "CUARENTENA" });
      expect(await abrir(p, { depositoDestinoId: cuarentena })).toEqual({
        ok: false,
        error: "DEPOSITO_DE_DESTINO_NO_NORMAL",
      });
      expect(await abrir(p, { depositoId: cuarentena })).toEqual({
        ok: false,
        error: "USO_INVALIDO",
      });
      for (const cantidad of ["0", "-1", "abc", "", 5]) {
        expect(await abrir(p, { cantidad }), String(cantidad)).toEqual({
          ok: false,
          error: "CANTIDAD_INVALIDA",
        });
      }
      expect(await abrir(p, { unidadId: "LITRO" })).toEqual({
        ok: false,
        error: "DIMENSION_DISTINTA",
      });
      expect(await abrir(p, { unidadId: "NOEXISTE" })).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
      expect(await abrir(p, { id: "x" })).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
      const norte = await c.deposito(e, { sucursal: e.otraSucursal });
      expect(await abrir(p, { depositoDestinoId: norte }, e.administradorDeUnaSucursal)).toEqual({
        ok: false,
        error: "SUCURSAL_FUERA_DE_ALCANCE",
      });
      expect(
        await c.contar("select count(*) as n from orden_de_produccion where producto_id = $1", [
          p.masa.producto,
        ]),
      ).toBe(0);
    });

    it("D12: con faltante, BLOQUEAR rechaza, AVISAR pide «producir igual», AVISAR confirmado y PERMITIR pasan con una excepción auditada", async () => {
      const p = await c.panaderia(e);
      await c.comprar(e, p.origen, p.harina.producto, "5", "1000"); // faltan 7 kg de harina y toda la manteca
      await c.fijarNivel(e.empresa, "BLOQUEAR");
      const bloqueada = await abrir(p);
      expect(bloqueada).toMatchObject({ ok: false, error: { error: "CONTROL_BLOQUEA" } });
      await c.fijarNivel(e.empresa, "AVISAR");
      expect(await abrir(p)).toMatchObject({
        ok: false,
        error: { error: "CONTROL_REQUIERE_CONFIRMACION" },
      });
      const confirmada = valorDe(await abrir(p, { confirmaciones: ["stock.existencia_negativa"] }));
      expect(
        confirmada.faltantes.map((f) => [f.productoId, f.existencia, f.necesario]).sort(),
      ).toEqual(
        [
          [p.harina.producto, "5.0000", "12.0000"],
          [p.manteca.producto, "0.0000", "4.0000"],
        ].sort(),
      );
      await c.fijarNivel(e.empresa, "PERMITIR");
      const permitida = valorDe(await abrir(p));
      expect(permitida.faltantes).toHaveLength(2);
      for (const id of [confirmada.ordenId, permitida.ordenId]) {
        expect(
          (await c.auditoria(e.empresa, "CONTROL_EXCEPCION")).filter((a) => a["entidad_id"] === id),
        ).toHaveLength(2);
      }
      await c.fijarNivel(e.empresa, "BLOQUEAR");
      expect(
        await c.contar("select count(*) as n from orden_de_produccion where producto_id = $1", [
          p.masa.producto,
        ]),
      ).toBe(2);
    });
  });

  describe("cerrarOrden", () => {
    it("consume lo real, entra el producto con el costo congelado y deja la orden cerrada con lo real de cada renglón, la merma de lote y todo auditado", async () => {
      const p = await lista();
      const a = valorDe(await abrir(p));
      const r = valorDe(await cerrar(a.ordenId, p));
      // 12 kg a $ 1.000 + 4 kg a $ 9.000 = $ 48.000 para 15 kg: $ 3.200 el kilo.
      expect(r).toMatchObject({
        lote: null,
        costoUnitario: "3200.000000",
        costoEstado: "DEFINITIVO",
        mermaDeLote: "1.0000",
        excepciones: [],
        yaExistia: false,
      });
      expect(await existencia(p.origen, p.harina)).toBe("8.0000");
      expect(await existencia(p.origen, p.manteca)).toBe("6.0000");
      expect(await existencia(p.destino, p.masa)).toBe("15.0000");
      const fila = await orden(a.ordenId);
      expect(fila).toMatchObject({
        estado: "CERRADA",
        cantidad_obtenida: "15.0000",
        costo_unitario: "3200.000000",
        costo_estado: "DEFINITIVO",
        cerrada_por: e.personaDelGerente,
      });
      expect(fila["movimiento_de_consumo_id"]).not.toBeNull();
      expect(fila["fecha_de_negocio"]).not.toBeNull();
      expect(
        (
          await c.filas<{ real: string }>(
            "select cantidad_real::text as real from renglon_de_orden where orden_id = $1 order by cantidad_real desc",
            [a.ordenId],
          )
        ).map((x) => x.real),
      ).toEqual(["12.0000", "4.0000"]);
      // Los movimientos son el registro: origen de la orden, motivos y costo del producto.
      expect(
        await c.filas(
          "select clase, motivo, origen_tipo, accion from movimiento_de_stock where origen_id = $1 order by clase desc",
          [a.ordenId],
        ),
      ).toEqual([
        {
          clase: "SALIDA",
          motivo: "CONSUMO_DE_TRANSFORMACION",
          origen_tipo: "TRANSFORMACION",
          accion: "transformaciones.cerrar",
        },
        {
          clase: "ENTRADA",
          motivo: "PRODUCTO_DE_TRANSFORMACION",
          origen_tipo: "TRANSFORMACION",
          accion: "transformaciones.cerrar",
        },
      ]);
      expect(
        (await c.auditoria(e.empresa, "ORDEN_DE_PRODUCCION_CERRADA")).filter(
          (x) => x["entidad_id"] === a.ordenId,
        ),
      ).toHaveLength(1);
      // Cambiar el precio de compra después NO mueve el costo de la orden.
      await c.comprar(e, p.origen, p.harina.producto, "5", "5000");
      expect((await orden(a.ordenId))["costo_unitario"]).toBe("3200.000000");
    });

    it("D3: 6 kg de harina a $ 1.000 y 2 kg de manteca a $ 9.000 obteniendo 9,5 kg: $ 24.000 y $ 2.526,315789 el kilo; un ingrediente sin costo deja el producto SIN_COSTO (nunca cero)", async () => {
      const p = await lista();
      const a = valorDe(await abrir(p, { cantidad: "8" }));
      const r = valorDe(
        await cerrar(a.ordenId, p, { obtenido: "9.5", consumos: consumos(p, "6", "2") }),
      );
      expect(r).toMatchObject({
        costoUnitario: "2526.315789",
        costoEstado: "DEFINITIVO",
        mermaDeLote: "-1.5000",
      });
      // Una materia prima que nunca entró con costo.
      const q = await c.panaderia(e);
      await c.comprar(e, q.origen, q.harina.producto, "20", "1000");
      await c.comprar(e, q.origen, q.manteca.producto, "10");
      const b = valorDe(await abrir(q, { cantidad: "8" }));
      const sinCosto = valorDe(
        await cerrar(b.ordenId, q, { obtenido: "8", consumos: consumos(q, "6", "2") }),
      );
      expect(sinCosto).toMatchObject({ costoUnitario: null, costoEstado: "SIN_COSTO" });
      expect(await orden(b.ordenId)).toMatchObject({
        costo_estado: "SIN_COSTO",
        costo_unitario: null,
      });
    });

    it("D6: la receta cambia entre abrir y cerrar: la orden conserva sus esperados y su versión, cierra con lo real y la ficha dice recetaCambiada; el costo sale de lo consumido", async () => {
      const p = await lista();
      const a = valorDe(await abrir(p));
      const nueva = await c.articulo(e, { clase: "MATERIA_PRIMA", ...c.kilos });
      valorDe(
        await c.casos.guardarComposicion(e.gerente, {
          productoId: p.masa.producto,
          versionEsperada: 1,
          rinde: "8",
          componentes: [{ productoId: nueva.producto, cantidad: "8", unidadId: "KILOGRAMO" }],
        }),
      );
      const antes = valorDe(
        await c.consultasDeProduccion.fichaDeOrden(e.gerente, { ordenId: a.ordenId }),
      );
      expect(antes).toMatchObject({ version: 1, recetaCambiada: true, estado: "ABIERTA" });
      expect(antes?.renglones.map((x) => x.esperado).sort()).toEqual(["12.0000", "4.0000"]);
      valorDe(await cerrar(a.ordenId, p));
      const despues = valorDe(
        await c.consultasDeProduccion.fichaDeOrden(e.gerente, { ordenId: a.ordenId }),
      );
      expect(despues).toMatchObject({
        estado: "CERRADA",
        recetaCambiada: true,
        mermaDeLote: "1.0000",
        cantidadObtenida: "15.0000",
      });
      expect(despues?.costo).toEqual({ costoUnitario: "3200.000000", costoEstado: "DEFINITIVO" });
      // Sin cambio de receta no hay aviso.
      const q = await lista();
      const b = valorDe(await abrir(q));
      expect(
        valorDe(await c.consultasDeProduccion.fichaDeOrden(e.gerente, { ordenId: b.ordenId }))
          ?.recetaCambiada,
      ).toBe(false);
    });

    it("valida el cierre: ingredientes de la orden, repetidos, negativos, lo obtenido, el vencimiento, la clave, la orden y los permisos", async () => {
      const p = await lista();
      const a = valorDe(await abrir(p));
      const extra = await c.articulo(e, { clase: "MATERIA_PRIMA", ...c.kilos });
      expect(
        await cerrar(a.ordenId, p, {
          consumos: [
            ...consumos(p),
            { productoId: extra.producto, cantidadReal: "1", unidadId: "KILOGRAMO" },
          ],
        }),
      ).toEqual({ ok: false, error: "CONSUMO_FUERA_DE_LA_ORDEN" });
      expect(await cerrar(a.ordenId, p, { consumos: [...consumos(p), consumos(p)[0]] })).toEqual({
        ok: false,
        error: "CONSUMO_REPETIDO",
      });
      expect(await cerrar(a.ordenId, p, { consumos: consumos(p, "-1", "4") })).toEqual({
        ok: false,
        error: "CANTIDAD_INVALIDA",
      });
      expect(await cerrar(a.ordenId, p, { consumos: consumos(p, "0", "0") })).toEqual({
        ok: false,
        error: "CANTIDAD_INVALIDA",
      });
      for (const obtenido of ["0", "-3", "x", ""]) {
        expect(await cerrar(a.ordenId, p, { obtenido }), obtenido).toEqual({
          ok: false,
          error: "CANTIDAD_INVALIDA",
        });
      }
      expect(await cerrar(a.ordenId, p, { clave: "x" })).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
      expect(await cerrar(a.ordenId, p, { vence: "2026-02-30" })).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
      expect(await cerrar(nuevoId(), p)).toEqual({ ok: false, error: "ORDEN_NO_ENCONTRADA" });
      expect(await cerrar("x", p)).toEqual({ ok: false, error: "ORDEN_NO_ENCONTRADA" });
      expect(await cerrar(a.ordenId, p, {}, otra.gerente)).toEqual({
        ok: false,
        error: "ORDEN_NO_ENCONTRADA",
      });
      // Lo que no viene vale cero: cerrar solo con la harina.
      const solo = valorDe(
        await cerrar(a.ordenId, p, { consumos: [consumos(p)[0]], obtenido: "6" }),
      );
      expect(solo.costoEstado).toBe("DEFINITIVO");
      expect(
        (
          await c.filas<{ real: string }>(
            "select cantidad_real::text as real from renglon_de_orden where orden_id = $1 order by cantidad_real",
            [a.ordenId],
          )
        ).map((x) => x.real),
      ).toEqual(["0.0000", "12.0000"]);
    });

    it("el producto con control de lote lleva el lote OP-<número> y su vencimiento (obligatorio con LOTE_Y_VENCIMIENTO, no pasado); sin control no escribe lotes", async () => {
      const p = await lista();
      c.encenderPerilla("lotes");
      valorDe(
        await c.casos.controlarLote(e.gerente, {
          productoId: p.masa.producto,
          modo: "LOTE_Y_VENCIMIENTO",
          conCalidad: false,
        }),
      );
      const a = valorDe(await abrir(p));
      expect(await cerrar(a.ordenId, p)).toEqual({ ok: false, error: "VENCIMIENTO_REQUERIDO" });
      expect(await cerrar(a.ordenId, p, { vence: "2000-01-02" })).toEqual({
        ok: false,
        error: "VENCIMIENTO_PASADO",
      });
      // Nada quedó de los intentos fallidos.
      expect(await existencia(p.origen, p.harina)).toBe("20.0000");
      expect(await orden(a.ordenId)).toMatchObject({ estado: "ABIERTA" });
      const r = valorDe(await cerrar(a.ordenId, p, { vence: "2099-06-01" }));
      expect(r.lote).toBe(`OP-${a.numero}`);
      const lote = (
        await c.filas<{ codigo: string; fecha_de_vencimiento: Date }>(
          "select l.codigo, l.fecha_de_vencimiento from lote l join orden_de_produccion o on o.lote_id = l.id where o.id = $1",
          [a.ordenId],
        )
      )[0];
      expect(lote?.codigo).toBe(`OP-${a.numero}`);
      const ficha = valorDe(
        await c.consultasDeProduccion.fichaDeOrden(e.gerente, { ordenId: a.ordenId }),
      );
      expect(ficha?.lote?.codigo).toBe(`OP-${a.numero}`);
      expect(ficha?.vence).toBe("2099-06-01");
      expect(
        await c.contar(
          "select count(*) as n from saldo_de_lote where articulo_id = $1 and existencia = 15",
          [p.masa.articulo],
        ),
      ).toBe(1);
    });
  });

  describe("cancelarOrden", () => {
    it("cancelar dos veces es ok, no escribe ni audita la segunda; una cerrada es ORDEN_YA_CERRADA", async () => {
      const p = await lista(e, true);
      const a = valorDe(await abrir(p));
      expect(
        valorDe(
          await c.produccion.cancelarOrden(e.gerente, {
            ordenId: a.ordenId,
            motivo: "Se rompió el horno",
          }),
        ),
      ).toEqual({ yaEstaba: false });
      expect(
        valorDe(
          await c.produccion.cancelarOrden(e.gerente, { ordenId: a.ordenId, motivo: "Otra vez" }),
        ),
      ).toEqual({ yaEstaba: true });
      expect(await orden(a.ordenId)).toMatchObject({
        estado: "CANCELADA",
        motivo: "Se rompió el horno",
        cancelada_por: e.personaDelGerente,
      });
      expect(
        (await c.auditoria(e.empresa, "ORDEN_DE_PRODUCCION_CANCELADA")).filter(
          (x) => x["entidad_id"] === a.ordenId,
        ),
      ).toHaveLength(1);
      expect(
        await c.contar("select count(*) as n from movimiento_de_stock where origen_id = $1", [
          a.ordenId,
        ]),
      ).toBe(0);
      // Una cancelada no se cierra ni se anula.
      expect(await cerrar(a.ordenId, p)).toEqual({ ok: false, error: "ORDEN_CANCELADA" });
      expect(
        await c.produccion.anularOrden(e.gerente, { ordenId: a.ordenId, motivo: "x" }),
      ).toEqual({ ok: false, error: "ORDEN_CANCELADA" });
      const b = valorDe(await abrir(p));
      valorDe(await cerrar(b.ordenId, p));
      expect(
        await c.produccion.cancelarOrden(e.gerente, { ordenId: b.ordenId, motivo: "Tarde" }),
      ).toEqual({ ok: false, error: "ORDEN_YA_CERRADA" });
      // Motivo obligatorio; orden que no existe o ajena; el operador no cancela.
      const d = valorDe(await abrir(p));
      for (const motivo of ["", "  ", undefined, "<b>"]) {
        expect(
          await c.produccion.cancelarOrden(e.gerente, {
            ordenId: d.ordenId,
            motivo: motivo as string,
          }),
          String(motivo),
        ).toEqual({ ok: false, error: "MOTIVO_REQUERIDO" });
      }
      expect(
        await c.produccion.cancelarOrden(e.gerente, { ordenId: nuevoId(), motivo: "x" }),
      ).toEqual({ ok: false, error: "ORDEN_NO_ENCONTRADA" });
      expect(
        await c.produccion.cancelarOrden(otra.gerente, { ordenId: d.ordenId, motivo: "x" }),
      ).toEqual({ ok: false, error: "ORDEN_NO_ENCONTRADA" });
      expect(
        await c.produccion.cancelarOrden(e.operador, { ordenId: d.ordenId, motivo: "x" }),
      ).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect((await orden(d.ordenId))["estado"]).toBe("ABIERTA");
    });
  });

  describe("consultas", () => {
    it("listarOrdenes: de la más nueva a la más vieja, por estado y sucursal; el operador solo ve sus sucursales; ficha ajena o inexistente, null; el costo solo con costos.ver", async () => {
      const p = await lista(e, true);
      const a = valorDe(await abrir(p));
      const b = valorDe(await abrir(p));
      valorDe(await cerrar(a.ordenId, p));
      const todas = valorDe(await c.consultasDeProduccion.listarOrdenes(e.gerente));
      expect(
        todas
          .filter((o) => [a.ordenId, b.ordenId].includes(o.ordenId))
          .map((o) => [o.numero, o.estado]),
      ).toEqual([
        [b.numero, "ABIERTA"],
        [a.numero, "CERRADA"],
      ]);
      expect(
        valorDe(await c.consultasDeProduccion.listarOrdenes(e.gerente, { estado: "CERRADA" })).some(
          (o) => o.ordenId === a.ordenId,
        ),
      ).toBe(true);
      expect(
        valorDe(await c.consultasDeProduccion.listarOrdenes(e.gerente, { estado: "CERRADA" })).some(
          (o) => o.ordenId === b.ordenId,
        ),
      ).toBe(false);
      for (const filtro of [{ estado: "OTRO" }, { sucursalId: "x" }]) {
        expect(valorDe(await c.consultasDeProduccion.listarOrdenes(e.gerente, filtro))).toEqual([]);
      }
      expect(
        valorDe(
          await c.consultasDeProduccion.listarOrdenes(e.gerente, { sucursalId: e.otraSucursal }),
        ).some((o) => o.ordenId === a.ordenId),
      ).toBe(false);
      // Una orden con un depósito de otra sucursal no la ve quien solo tiene la suya.
      const norte = await c.deposito(e, { sucursal: e.otraSucursal });
      const cruzada = valorDe(await abrir(p, { depositoDestinoId: norte }));
      expect(
        valorDe(await c.consultasDeProduccion.listarOrdenes(e.operador)).some(
          (o) => o.ordenId === cruzada.ordenId,
        ),
      ).toBe(false);
      expect(
        valorDe(await c.consultasDeProduccion.listarOrdenes(e.gerente)).some(
          (o) => o.ordenId === cruzada.ordenId,
        ),
      ).toBe(true);
      expect(
        valorDe(
          await c.consultasDeProduccion.fichaDeOrden(e.operador, { ordenId: cruzada.ordenId }),
        ),
      ).toBeNull();
      expect(
        valorDe(await c.consultasDeProduccion.fichaDeOrden(otra.gerente, { ordenId: a.ordenId })),
      ).toBeNull();
      for (const ordenId of [nuevoId(), "x"]) {
        expect(
          valorDe(await c.consultasDeProduccion.fichaDeOrden(e.gerente, { ordenId })),
        ).toBeNull();
      }
      const delOperador = valorDe(
        await c.consultasDeProduccion.fichaDeOrden(e.operador, { ordenId: a.ordenId }),
      );
      expect(delOperador?.estado).toBe("CERRADA");
      expect(delOperador && "costo" in delOperador).toBe(false);
      expect(
        valorDe(await c.consultasDeProduccion.fichaDeOrden(e.gerente, { ordenId: a.ordenId }))
          ?.costo,
      ).toMatchObject({ costoEstado: "DEFINITIVO" });
      c.apagarModulo("produccion");
      try {
        expect((await c.consultasDeProduccion.listarOrdenes(e.gerente)).ok).toBe(false);
      } finally {
        c.encenderModulos();
      }
    });
  });
});
