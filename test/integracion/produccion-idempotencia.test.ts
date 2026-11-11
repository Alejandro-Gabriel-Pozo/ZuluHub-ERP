import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  aLaVez,
  firme,
  nuevoId,
  RONDAS,
  soloOk,
  valorDe,
  type EscenarioDeStock,
} from "./stock-casos-apoyo";
import { montarProduccion, type MontajeDeProduccion } from "./produccion-apoyo";

/**
 * E6-T8, idempotencia (I1 a I4) y anulación (D11, D13): abrir la misma orden dos veces, cerrar con la misma clave y con otra, la clave reutilizada,
 * anular dos veces y anular la anulación; el espejo exacto (mismos lotes y mismo costo) y `PRODUCTO_YA_USADO`. Con la base real.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("producción: idempotencia y anulación (E6-T8)", () => {
  let c: MontajeDeProduccion;
  let e: EscenarioDeStock;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarProduccion(base);
    e = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  type P = Awaited<ReturnType<MontajeDeProduccion["panaderia"]>>;
  const lista = async () => {
    const p = await c.panaderia(e);
    await c.comprar(e, p.origen, p.harina.producto, "100", "1000");
    await c.comprar(e, p.origen, p.manteca.producto, "50", "9000");
    return p;
  };
  const abrir = (p: P, extra: Record<string, unknown> = {}) =>
    c.produccion.abrirOrden(e.gerente, {
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
  const cerrar = (ordenId: string, p: P, extra: Record<string, unknown> = {}) =>
    c.produccion.cerrarOrden(e.gerente, {
      ordenId,
      clave: nuevoId(),
      obtenido: "15",
      unidadId: "KILOGRAMO",
      consumos: consumos(p),
      ...extra,
    });
  const movimientos = (ordenId: string) =>
    c.contar("select count(*) as n from movimiento_de_stock where origen_id = $1", [ordenId]);

  it("I1: abrir la misma orden dos veces (clic doble, mismo id) deja una orden y un número; con otro contenido, ID_REUTILIZADO", async () => {
    const p = await lista();
    const id = nuevoId();
    const primera = valorDe(await abrir(p, { id }));
    const segunda = valorDe(await abrir(p, { id }));
    expect(segunda).toMatchObject({
      ordenId: primera.ordenId,
      numero: primera.numero,
      yaExistia: true,
    });
    expect(segunda.esperados.map((x) => [x.productoId, x.cantidad]).sort()).toEqual(
      primera.esperados.map((x) => [x.productoId, x.cantidad]).sort(),
    );
    expect(
      await c.contar("select count(*) as n from orden_de_produccion where id = $1", [id]),
    ).toBe(1);
    expect(
      (await c.auditoria(e.empresa, "ORDEN_DE_PRODUCCION_ABIERTA")).filter(
        (a) => a["entidad_id"] === id,
      ),
    ).toHaveLength(1);
    expect(await abrir(p, { id, cantidad: "8" })).toEqual({ ok: false, error: "ID_REUTILIZADO" });
    expect(await abrir(p, { id, depositoDestinoId: p.origen })).toEqual({
      ok: false,
      error: "ID_REUTILIZADO",
    });
    // La misma cantidad escrita en otra unidad es la misma orden.
    expect(valorDe(await abrir(p, { id, cantidad: "16000", unidadId: "GRAMO" })).yaExistia).toBe(
      true,
    );
    // La repetición ya no depende de la receta de hoy.
    valorDe(
      await c.casos.retirarComposicion(e.gerente, {
        productoId: p.masa.producto,
        versionEsperada: 1,
      }),
    );
    expect(valorDe(await abrir(p, { id })).yaExistia).toBe(true);
  });

  it("I1 (a la vez): el mismo id dos veces y N altas simultáneas dan números 1..N sin huecos ni repetidos (C10)", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const p = await lista();
      const id = nuevoId();
      const mismas = await aLaVez(
        c,
        [() => firme(() => abrir(p, { id })), () => firme(() => abrir(p, { id }))],
        ronda,
      );
      expect(soloOk(mismas), JSON.stringify(mismas)).toBe(2);
      expect(
        await c.contar("select count(*) as n from orden_de_produccion where id = $1", [id]),
      ).toBe(1);
      const N = 5;
      const q = await lista();
      const antes = await c.contar(
        "select count(*) as n from orden_de_produccion where empresa_id = $1",
        [e.empresa],
      );
      const altas = await aLaVez(
        c,
        Array.from({ length: N }, () => () => firme(() => abrir(q))),
        ronda,
      );
      expect(soloOk(altas), JSON.stringify(altas)).toBe(N);
      const numeros = (
        await c.filas<{ numero: number }>(
          "select numero from orden_de_produccion where empresa_id = $1 order by numero",
          [e.empresa],
        )
      ).map((f) => f.numero);
      expect(numeros).toEqual(Array.from({ length: antes + N }, (_, i) => i + 1));
    }
  });

  it("I2: cerrar con la misma clave dos veces, y con otra clave sobre la misma orden, deja un solo cierre y la segunda devuelve yaExistia", async () => {
    const p = await lista();
    const a = valorDe(await abrir(p));
    const clave = nuevoId();
    const primera = valorDe(await cerrar(a.ordenId, p, { clave }));
    expect(primera.yaExistia).toBe(false);
    const misma = valorDe(await cerrar(a.ordenId, p, { clave }));
    const otraClave = valorDe(await cerrar(a.ordenId, p));
    for (const r of [misma, otraClave]) {
      expect(r).toMatchObject({
        yaExistia: true,
        costoUnitario: primera.costoUnitario,
        costoEstado: "DEFINITIVO",
        mermaDeLote: primera.mermaDeLote,
      });
    }
    expect(await movimientos(a.ordenId)).toBe(2);
    expect(await c.existencia(p.destino, p.masa.articulo)).toBe("15.0000");
    expect(await c.existencia(p.origen, p.harina.articulo)).toBe("88.0000");
    expect(
      (await c.auditoria(e.empresa, "ORDEN_DE_PRODUCCION_CERRADA")).filter(
        (x) => x["entidad_id"] === a.ordenId,
      ),
    ).toHaveLength(1);
  });

  it("I3: la misma clave con otro contenido es CLAVE_REUTILIZADA y no escribe; otro contenido con otra clave, ORDEN_YA_CERRADA", async () => {
    const p = await lista();
    const a = valorDe(await abrir(p));
    const clave = nuevoId();
    valorDe(await cerrar(a.ordenId, p, { clave }));
    expect(await cerrar(a.ordenId, p, { clave, consumos: consumos(p, "11", "4") })).toEqual({
      ok: false,
      error: "CLAVE_REUTILIZADA",
    });
    expect(await cerrar(a.ordenId, p, { clave, obtenido: "14" })).toEqual({
      ok: false,
      error: "CLAVE_REUTILIZADA",
    });
    expect(await cerrar(a.ordenId, p, { obtenido: "14" })).toEqual({
      ok: false,
      error: "ORDEN_YA_CERRADA",
    });
    expect(await movimientos(a.ordenId)).toBe(2);
    expect(await c.existencia(p.origen, p.harina.articulo)).toBe("88.0000");
  });

  describe("anularOrden", () => {
    const anular = (ordenId: string, extra: Record<string, unknown> = {}, quien = e.gerente) =>
      c.produccion.anularOrden(quien, { ordenId, motivo: "Salió mal la tanda", ...extra });

    it("I4: anular dos veces deja un solo par de espejos y la segunda devuelve yaEstaba; anular la anulación se rechaza", async () => {
      const p = await lista();
      const a = valorDe(await abrir(p));
      valorDe(await cerrar(a.ordenId, p));
      expect(valorDe(await anular(a.ordenId))).toEqual({ yaEstaba: false });
      expect(valorDe(await anular(a.ordenId, { motivo: "Otra vez" }))).toEqual({ yaEstaba: true });
      expect(await movimientos(a.ordenId)).toBe(4);
      const fila = (
        await c.filas<Record<string, unknown>>("select * from orden_de_produccion where id = $1", [
          a.ordenId,
        ])
      )[0] as Record<string, unknown>;
      expect(fila).toMatchObject({
        estado: "ANULADA",
        motivo: "Salió mal la tanda",
        anulada_por: e.personaDelGerente,
        cantidad_obtenida: "15.0000",
        costo_unitario: "3200.000000",
      });
      // Todo vuelve como estaba.
      expect(await c.existencia(p.origen, p.harina.articulo)).toBe("100.0000");
      expect(await c.existencia(p.destino, p.masa.articulo)).toBe("0.0000");
      expect(
        (await c.auditoria(e.empresa, "ORDEN_DE_PRODUCCION_ANULADA")).filter(
          (x) => x["entidad_id"] === a.ordenId,
        ),
      ).toHaveLength(1);
      // Anular la anulación: el libro lo rechaza (un movimiento de la producción lo revierte su módulo).
      const espejo = fila["anulacion_de_consumo_id"] as string;
      const rechazo = await c.casos.anularMovimiento(e.gerente, {
        movimientoId: espejo,
        clave: nuevoId(),
        detalle: "x",
      });
      expect(rechazo.ok).toBe(false);
      const original = fila["movimiento_de_consumo_id"] as string;
      expect(
        (
          await c.casos.anularMovimiento(e.gerente, {
            movimientoId: original,
            clave: nuevoId(),
            detalle: "x",
          })
        ).ok,
      ).toBe(false);
      expect(await movimientos(a.ordenId)).toBe(4);
    });

    it("D11: entero, el espejo es exacto (mismo costo congelado y mismos lotes); con una parte ya usada, PRODUCTO_YA_USADO y no se toca nada", async () => {
      const p = await lista();
      const a = valorDe(await abrir(p));
      valorDe(await cerrar(a.ordenId, p));
      const fila = (
        await c.filas<Record<string, string>>(
          "select movimiento_de_consumo_id as m from orden_de_produccion where id = $1",
          [a.ordenId],
        )
      )[0];
      const costosOriginales = await c.filas(
        "select numero, costo_unitario::text as costo from costo_de_renglon where movimiento_id = $1 order by numero",
        [fila?.["m"]],
      );
      // Se usa una parte del producto (consumo interno de 3 kg de masa): ya no está entero.
      valorDe(
        await c.casos.registrarSalida(e.gerente, {
          clave: nuevoId(),
          depositoId: p.destino,
          motivo: "CONSUMO_INTERNO",
          renglones: [{ productoId: p.masa.producto, cantidad: "3", unidadId: "KILOGRAMO" }],
        }),
      );
      expect(await anular(a.ordenId)).toEqual({ ok: false, error: "PRODUCTO_YA_USADO" });
      expect(await movimientos(a.ordenId)).toBe(2);
      expect(
        (
          await c.filas<{ estado: string }>(
            "select estado from orden_de_produccion where id = $1",
            [a.ordenId],
          )
        )[0]?.estado,
      ).toBe("CERRADA");
      // Se repone y se anula: el espejo de la salida lleva el mismo costo.
      await c.comprar(e, p.destino, p.masa.producto, "3", "10");
      expect(valorDe(await anular(a.ordenId))).toEqual({ yaEstaba: false });
      const espejo = (
        await c.filas<Record<string, string>>(
          "select anulacion_de_consumo_id as m from orden_de_produccion where id = $1",
          [a.ordenId],
        )
      )[0];
      expect(
        await c.filas(
          "select numero, costo_unitario::text as costo from costo_de_renglon where movimiento_id = $1 order by numero",
          [espejo?.["m"]],
        ),
      ).toEqual(costosOriginales);
    });

    it("D13: el ingrediente vencido después del cierre vuelve a su lote original al anular (anular no se bloquea por fecha)", async () => {
      const p = await c.panaderia(e);
      c.encenderPerilla("lotes");
      valorDe(
        await c.casos.controlarLote(e.gerente, {
          productoId: p.harina.producto,
          modo: "LOTE_Y_VENCIMIENTO",
          conCalidad: false,
        }),
      );
      await c.entrarConLote(
        e,
        p.origen,
        p.harina.articulo,
        { codigo: "H-1", vence: "2099-01-01" },
        "20",
      );
      await c.comprar(e, p.origen, p.manteca.producto, "10", "9000");
      const a = valorDe(await abrir(p));
      valorDe(await cerrar(a.ordenId, p));
      const saldo = async () =>
        (
          await c.filas<{ codigo: string; existencia: string }>(
            "select l.codigo, s.existencia::text as existencia from saldo_de_lote s join lote l on l.id = s.lote_id where s.articulo_id = $1 order by l.codigo",
            [p.harina.articulo],
          )
        ).map((f) => [f.codigo, f.existencia]);
      expect(await saldo()).toContainEqual(["H-1", "8.0000"]);
      // La fecha del lote se corrige a una pasada (queda vencido) y recién ahí se anula.
      const lote = (
        await c.filas<{ id: string; version: number }>(
          "select id, version from lote where articulo_id = $1 and codigo = 'H-1'",
          [p.harina.articulo],
        )
      )[0] as { id: string; version: number };
      valorDe(
        await c.casos.corregirLote(e.gerente, {
          loteId: lote.id,
          versionEsperada: lote.version,
          fechaDeVencimiento: "2020-01-01",
          detalle: "Vencido",
        }),
      );
      expect(valorDe(await anular(a.ordenId))).toEqual({ yaEstaba: false });
      expect(await saldo()).toContainEqual(["H-1", "20.0000"]);
    });

    it("valida: motivo obligatorio, orden abierta (ORDEN_NO_CERRADA), que no existe o ajena, el operador no anula", async () => {
      const p = await lista();
      const a = valorDe(await abrir(p));
      expect(await anular(a.ordenId)).toEqual({ ok: false, error: "ORDEN_NO_CERRADA" });
      valorDe(await cerrar(a.ordenId, p));
      for (const motivo of ["", "  ", undefined, "<b>"]) {
        expect(await anular(a.ordenId, { motivo }), String(motivo)).toEqual({
          ok: false,
          error: "MOTIVO_REQUERIDO",
        });
      }
      expect(await anular(nuevoId())).toEqual({ ok: false, error: "ORDEN_NO_ENCONTRADA" });
      expect(await anular(a.ordenId, {}, e.operador)).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(
        (
          await c.filas<{ estado: string }>(
            "select estado from orden_de_produccion where id = $1",
            [a.ordenId],
          )
        )[0]?.estado,
      ).toBe("CERRADA");
    });
  });
});
