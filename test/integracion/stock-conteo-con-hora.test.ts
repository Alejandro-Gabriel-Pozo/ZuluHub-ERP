import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  AHORA,
  abrirConteoDe,
  conReloj,
  conStock,
  conteoDiferencia,
  contarEn,
  hace,
  movimientoEn,
} from "./stock-conteo-hora-apoyo";
import {
  montarStock,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * E5, conteo con hora (spec `e5-conteo-con-hora-y-filtros-especificacion.md` §5, casos CF1 a CF10): cada cantidad contada lleva la hora a la que se
 * contó; el sistema compara contra lo que creía a esa hora, lo movido DESPUÉS ya está en lo que hay y no se toca, y solo lo que queda de diferencia
 * pide motivo. Base real y casos de uso reales. Reloj: `AHORA` = «10:10» (la carga y la aplicación); la hora del conteo es `AHORA − 10 min` («10:00»)
 * y la venta, `AHORA − 5 min` («10:05»). Cada prueba usa su propio depósito.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("stock: conteo con hora", () => {
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

  const movimientosDelConteo = (conteoId: string) =>
    c.contar("select count(*) as n from movimiento_de_stock where conteo_id = $1", [conteoId]);
  const marcasDe = (conteoId: string) =>
    c.contar("select count(*) as n from conteo_marca where conteo_id = $1", [conteoId]);
  const estadoDe = async (conteoId: string) =>
    (
      await c.filas<{ estado: string }>("select estado from conteo_fisico where id = $1", [
        conteoId,
      ])
    )[0]?.estado;
  /** La venta de un ticket: una salida con origen de otro módulo, a la hora dada. */
  const vender = (dep: string, articulo: string, cantidad: string, hechoEn: Date) =>
    movimientoEn(c, e, {
      dep,
      articulo,
      cantidad: `-${cantidad}`,
      hechoEn,
      motivo: "VENTA",
      ejemplarId: randomUUID(),
    });

  it("CF1 (el caso del dueño): contó 20 a las 10:00, a las 10:05 se vendieron 3 y se carga a las 10:10: NO hay ajuste y quedan 17, no 20", async () => {
    const s = await conStock(c, e, "20");
    const id = await abrirConteoDe(c, e, s.dep, conReloj(e.gerente, hace(-15)));
    await vender(s.dep, s.articulo, "3", hace(-5));
    valorDe(await contarEn(c, e.gerente, id, s.producto, "20", { contadoEn: hace(-10) }));
    const r = valorDe(await c.aplicarConteo(e.gerente, id));
    expect(r).toEqual({ movimientoId: null, yaAplicado: false });
    expect(await c.existencia(s.dep, s.articulo)).toBe("17.0000");
    expect(await movimientosDelConteo(id)).toBe(0);
    expect(await estadoDe(id)).toBe("APLICADO");
    // Queda anotado que se evaluó: con las dos horas (la del conteo y la de la carga) y sin motivo.
    expect(await conteoDiferencia(c, id)).toEqual([
      expect.objectContaining({
        articulo_id: s.articulo,
        contada: "20.0000",
        existencia_a_la_hora: "20.0000",
        diferencia_bruta: "0.0000",
        marcado: "0.0000",
        diferencia_final: "0.0000",
        motivo: null,
        detalle: null,
        explicada_por: e.personaDelGerente,
      }),
    ]);
    const registro = (
      await c.filas<{ contado_en: Date; registrado_en: Date }>(
        "select contado_en, registrado_en from conteo_registro where conteo_id = $1",
        [id],
      )
    )[0];
    expect(registro?.contado_en.getTime()).toBe(hace(-10).getTime());
    expect(registro?.registrado_en.getTime()).toBe(AHORA.getTime());
    expect(valorDe(await c.consultas.verificarSaldos(e.gerente))).toEqual([]);
  });

  it("CF2: contado «en vivo» (sin hora declarada, vale la de la carga) después de la venta: 17 contra 17, sin diferencia", async () => {
    const s = await conStock(c, e, "20");
    const id = await abrirConteoDe(c, e, s.dep);
    await vender(s.dep, s.articulo, "3", hace(-5));
    valorDe(await contarEn(c, e.gerente, id, s.producto, "17"));
    expect(valorDe(await c.aplicarConteo(e.gerente, id))).toEqual({
      movimientoId: null,
      yaAplicado: false,
    });
    expect(await c.existencia(s.dep, s.articulo)).toBe("17.0000");
    // La hora no declarada queda sin declarar (NULL) y se lee como la de la carga.
    expect(
      await c.filas("select contado_en from conteo_registro where conteo_id = $1", [id]),
    ).toEqual([{ contado_en: null }]);
    expect(await conteoDiferencia(c, id)).toEqual([
      expect.objectContaining({ existencia_a_la_hora: "17.0000", diferencia_final: "0.0000" }),
    ]);
  });

  it("CF3: hora declarada de antes de lo real: la venta de las 9:30 figura como candidata y, marcada «ya había salido», no deja diferencia ni ajuste", async () => {
    const s = await conStock(c, e, "20");
    const id = await abrirConteoDe(c, e, s.dep);
    const venta = await vender(s.dep, s.articulo, "3", hace(-30));
    valorDe(await contarEn(c, e.gerente, id, s.producto, "17", { contadoEn: hace(-60) }));
    const ficha = valorDe(await c.consultas.fichaDeConteo(e.gerente, { conteoId: id }));
    expect(ficha?.registros[0]).toMatchObject({
      existenciaALaHora: "20.0000",
      movidoDesdeLaHora: "-3.0000",
      diferenciaBruta: "-3.0000",
    });
    const candidatos = valorDe(
      await c.consultas.candidatosDeConteo(e.gerente, { conteoId: id, productoId: s.producto }),
    );
    expect(candidatos?.siguiente).toBeNull();
    expect(candidatos?.candidatos).toEqual([
      expect.objectContaining({
        movimientoId: venta,
        numero: 1,
        clase: "SALIDA",
        motivo: "VENTA",
        cantidad: "-3.0000",
      }),
    ]);
    const r = valorDe(
      await c.aplicarConteo(e.gerente, id, [
        { productoId: s.producto, marcas: [{ movimientoId: venta, numero: 1 }] },
      ]),
    );
    expect(r.movimientoId).toBeNull();
    expect(await c.existencia(s.dep, s.articulo)).toBe("17.0000");
    expect(await marcasDe(id)).toBe(1);
    expect(await conteoDiferencia(c, id)).toEqual([
      expect.objectContaining({
        diferencia_bruta: "-3.0000",
        marcado: "-3.0000",
        diferencia_final: "0.0000",
        motivo: null,
      }),
    ]);
  });

  it("CF3 (sin marcar): la misma carga, sin marcar la venta, deja −3 y exige motivo", async () => {
    const s = await conStock(c, e, "20");
    const id = await abrirConteoDe(c, e, s.dep);
    await vender(s.dep, s.articulo, "3", hace(-30));
    valorDe(await contarEn(c, e.gerente, id, s.producto, "17", { contadoEn: hace(-60) }));
    expect(await c.aplicarConteo(e.gerente, id)).toEqual({ ok: false, error: "MOTIVO_REQUERIDO" });
    expect(await estadoDe(id)).toBe("ABIERTO");
    const r = valorDe(
      await c.aplicarConteo(e.gerente, id, [{ productoId: s.producto, motivo: "ROTURA" }]),
    );
    expect(r.movimientoId).not.toBeNull();
    expect(await c.existencia(s.dep, s.articulo)).toBe("14.0000");
  });

  it("CF4: faltante real con motivo «Rotura»: un ajuste de −2, saldo 18, con quién y cuándo lo explicó", async () => {
    const s = await conStock(c, e, "20");
    const id = await abrirConteoDe(c, e, s.dep);
    valorDe(await contarEn(c, e.gerente, id, s.producto, "18", { contadoEn: hace(-10) }));
    const r = valorDe(
      await c.aplicarConteo(e.gerente, id, [{ productoId: s.producto, motivo: "ROTURA" }]),
    );
    expect(
      await c.filas(
        "select articulo_id, cantidad::text from renglon_de_movimiento where movimiento_id = $1",
        [r.movimientoId],
      ),
    ).toEqual([{ articulo_id: s.articulo, cantidad: "-2.0000" }]);
    expect(await c.existencia(s.dep, s.articulo)).toBe("18.0000");
    const filas = await conteoDiferencia(c, id);
    expect(filas).toEqual([
      expect.objectContaining({
        diferencia_bruta: "-2.0000",
        diferencia_final: "-2.0000",
        motivo: "ROTURA",
        explicada_por: e.personaDelGerente,
      }),
    ]);
    const explicada = await c.filas<{ explicada_en: Date }>(
      "select explicada_en from conteo_diferencia where conteo_id = $1",
      [id],
    );
    expect(explicada[0]?.explicada_en.getTime()).toBe(AHORA.getTime());
  });

  it("CF5 (venta no registrada): solo mueve stock: −2 y saldo 18, sin ticket, ejemplar, cobro ni movimiento de caja, y el ajuste no nace de un ticket", async () => {
    const s = await conStock(c, e, "20");
    const id = await abrirConteoDe(c, e, s.dep);
    valorDe(await contarEn(c, e.gerente, id, s.producto, "18", { contadoEn: hace(-10) }));
    const tablas = ["ticket", "ticket_ejemplar", "cobro", "movimiento_caja", "cuenta_consumo"];
    const contar = async () =>
      Promise.all(tablas.map((t) => c.contar(`select count(*) as n from ${t}`)));
    const antes = await contar();
    const r = valorDe(
      await c.aplicarConteo(e.gerente, id, [
        { productoId: s.producto, motivo: "VENTA_NO_REGISTRADA" },
      ]),
    );
    expect(await contar()).toEqual(antes);
    expect(await c.existencia(s.dep, s.articulo)).toBe("18.0000");
    expect(
      (await c.filas("select * from movimiento_de_stock where id = $1", [r.movimientoId]))[0],
    ).toMatchObject({
      clase: "AJUSTE_POR_CONTEO",
      motivo: "CONTEO",
      origen_tipo: "MANUAL",
      origen_id: null,
    });
    expect(await conteoDiferencia(c, id)).toEqual([
      expect.objectContaining({ motivo: "VENTA_NO_REGISTRADA" }),
    ]);
  });

  it("CF6: sobrante con una entrada cargada tarde (recibida antes de contar, con hora posterior): marcada, no hay ajuste y el saldo queda en 25", async () => {
    const s = await conStock(c, e, "20");
    const id = await abrirConteoDe(c, e, s.dep);
    const compra = await movimientoEn(c, e, {
      dep: s.dep,
      articulo: s.articulo,
      cantidad: "5",
      hechoEn: hace(-5),
    });
    valorDe(await contarEn(c, e.gerente, id, s.producto, "25", { contadoEn: hace(-10) }));
    expect(
      valorDe(
        await c.consultas.candidatosDeConteo(e.gerente, { conteoId: id, productoId: s.producto }),
      )?.candidatos,
    ).toEqual([expect.objectContaining({ movimientoId: compra, cantidad: "5.0000" })]);
    const r = valorDe(
      await c.aplicarConteo(e.gerente, id, [
        { productoId: s.producto, marcas: [{ movimientoId: compra, numero: 1 }] },
      ]),
    );
    expect(r.movimientoId).toBeNull();
    expect(await c.existencia(s.dep, s.articulo)).toBe("25.0000");
    expect(await conteoDiferencia(c, id)).toEqual([
      expect.objectContaining({
        existencia_a_la_hora: "20.0000",
        diferencia_bruta: "5.0000",
        marcado: "5.0000",
      }),
    ]);
  });

  it("CF7: sobrante sin explicación en el sistema: «Devolución de cliente» suma 3 y el saldo queda en 23", async () => {
    const s = await conStock(c, e, "20");
    const id = await abrirConteoDe(c, e, s.dep);
    valorDe(await contarEn(c, e.gerente, id, s.producto, "23", { contadoEn: hace(-10) }));
    const r = valorDe(
      await c.aplicarConteo(e.gerente, id, [
        { productoId: s.producto, motivo: "DEVOLUCION_DE_CLIENTE" },
      ]),
    );
    expect(
      await c.filas("select cantidad::text from renglon_de_movimiento where movimiento_id = $1", [
        r.movimientoId,
      ]),
    ).toEqual([{ cantidad: "3.0000" }]);
    expect(await c.existencia(s.dep, s.articulo)).toBe("23.0000");
  });

  it("CF8: tope: lo marcado no puede invertir la diferencia (EXPLICACION_SUPERA_LA_DIFERENCIA) y no se escribe nada; sin marcar, −2 pide motivo", async () => {
    const s = await conStock(c, e, "20");
    const id = await abrirConteoDe(c, e, s.dep);
    const venta = await vender(s.dep, s.articulo, "3", hace(-5));
    valorDe(await contarEn(c, e.gerente, id, s.producto, "18", { contadoEn: hace(-10) }));
    const marcar = { productoId: s.producto, marcas: [{ movimientoId: venta, numero: 1 }] };
    expect(await c.aplicarConteo(e.gerente, id, [marcar])).toEqual({
      ok: false,
      error: "EXPLICACION_SUPERA_LA_DIFERENCIA",
    });
    expect(await estadoDe(id)).toBe("ABIERTO");
    expect(await marcasDe(id)).toBe(0);
    expect(await conteoDiferencia(c, id)).toEqual([]);
    expect(await c.aplicarConteo(e.gerente, id)).toEqual({ ok: false, error: "MOTIVO_REQUERIDO" });
    expect(await c.existencia(s.dep, s.articulo)).toBe("17.0000");
  });

  it("CF9: sentido: una entrada posterior no explica un faltante (no aparece como candidata y marcarla a mano es MOVIMIENTO_NO_EXPLICA)", async () => {
    const s = await conStock(c, e, "20");
    const id = await abrirConteoDe(c, e, s.dep);
    const entrada = await movimientoEn(c, e, {
      dep: s.dep,
      articulo: s.articulo,
      cantidad: "5",
      hechoEn: hace(-5),
    });
    valorDe(await contarEn(c, e.gerente, id, s.producto, "18", { contadoEn: hace(-10) }));
    expect(
      valorDe(
        await c.consultas.candidatosDeConteo(e.gerente, { conteoId: id, productoId: s.producto }),
      )?.candidatos,
    ).toEqual([]);
    expect(
      await c.aplicarConteo(e.gerente, id, [
        { productoId: s.producto, marcas: [{ movimientoId: entrada, numero: 1 }] },
      ]),
    ).toEqual({ ok: false, error: "MOVIMIENTO_NO_EXPLICA" });
    expect(await estadoDe(id)).toBe("ABIERTO");
  });

  it("CF9 (lo que no existe): marcar un movimiento anterior a la hora, inexistente, de otro artículo o repetido se rechaza", async () => {
    const s = await conStock(c, e, "20");
    const otro = await c.articulo(e);
    const id = await abrirConteoDe(c, e, s.dep);
    const antes = await movimientoEn(c, e, {
      dep: s.dep,
      articulo: s.articulo,
      cantidad: "-1",
      hechoEn: hace(-20),
    });
    const despues = await vender(s.dep, s.articulo, "1", hace(-5));
    const deOtro = await movimientoEn(c, e, {
      dep: s.dep,
      articulo: otro.articulo,
      cantidad: "-1",
      hechoEn: hace(-5),
    });
    valorDe(await contarEn(c, e.gerente, id, s.producto, "15", { contadoEn: hace(-10) }));
    const con = (marcas: { movimientoId: string; numero: number }[]) =>
      c.aplicarConteo(e.gerente, id, [{ productoId: s.producto, marcas }]);
    const noExplica = { ok: false, error: "MOVIMIENTO_NO_EXPLICA" };
    expect(await con([{ movimientoId: antes, numero: 1 }])).toEqual(noExplica);
    expect(await con([{ movimientoId: randomUUID(), numero: 1 }])).toEqual(noExplica);
    expect(await con([{ movimientoId: deOtro, numero: 1 }])).toEqual(noExplica);
    expect(await con([{ movimientoId: despues, numero: 2 }])).toEqual(noExplica);
    expect(
      await con([
        { movimientoId: despues, numero: 1 },
        { movimientoId: despues, numero: 1 },
      ]),
    ).toEqual({
      ok: false,
      error: "RENGLON_REPETIDO",
    });
    expect(await estadoDe(id)).toBe("ABIERTO");
  });

  it("CF10: motivos: del sentido que corresponde, obligatorio, y «otra» pide detalle; nada se escribe si falla", async () => {
    const s = await conStock(c, e, "20");
    const id = await abrirConteoDe(c, e, s.dep);
    valorDe(await contarEn(c, e.gerente, id, s.producto, "18", { contadoEn: hace(-10) }));
    const con = (motivo?: string, detalle?: string) =>
      c.aplicarConteo(e.gerente, id, [{ productoId: s.producto, motivo, detalle }]);
    expect(await con("DEVOLUCION_DE_CLIENTE")).toEqual({
      ok: false,
      error: "MOTIVO_NO_CORRESPONDE",
    });
    expect(await con()).toEqual({ ok: false, error: "MOTIVO_REQUERIDO" });
    expect(await con("OTRA_SALIDA")).toEqual({ ok: false, error: "DETALLE_REQUERIDO" });
    expect(await con("COMPRA")).toEqual({ ok: false, error: "MOTIVO_NO_CORRESPONDE" });
    expect(await estadoDe(id)).toBe("ABIERTO");
    expect(await movimientosDelConteo(id)).toBe(0);
    expect(await conteoDiferencia(c, id)).toEqual([]);
    expect(await c.existencia(s.dep, s.articulo)).toBe("20.0000");
    // Un sobrante con un motivo de salida.
    const otro = await conStock(c, e, "20");
    const id2 = await abrirConteoDe(c, e, otro.dep);
    valorDe(await contarEn(c, e.gerente, id2, otro.producto, "23", { contadoEn: hace(-10) }));
    expect(
      await c.aplicarConteo(e.gerente, id2, [{ productoId: otro.producto, motivo: "MERMA" }]),
    ).toEqual({ ok: false, error: "MOTIVO_NO_CORRESPONDE" });
    // Con detalle, «otra salida» pasa.
    expect(valorDe(await con("OTRA_SALIDA", "Se cayó una caja")).yaAplicado).toBe(false);
  });
});
