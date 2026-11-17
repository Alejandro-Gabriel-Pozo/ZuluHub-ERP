import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { nuevoId, valorDe, type EscenarioDeStock } from "./stock-casos-apoyo";
import { montarProduccion, type MontajeDeProduccion } from "./produccion-apoyo";

/**
 * E6-T9, D10 (apagado, D146: la cafetería no usa producción): una empresa sin las perillas `produccion`, `lotes` ni `subcomposiciones` sigue con el stock
 * de E5 igual que antes; lo nuevo se rechaza con `FUNCION_NO_INCLUIDA`, no escribe ninguna fila de lote, y lo ya guardado se sigue aplicando (cerrar una
 * orden ya abierta no depende del plan de hoy).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("producción: la empresa sin las perillas (D10, E6-T9)", () => {
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

  it("sin produccion, lotes ni subcomposiciones: se rechaza lo nuevo, el stock de siempre funciona y no se escribe ningún lote", async () => {
    const p = await c.panaderia(e);
    await c.comprar(e, p.origen, p.harina.producto, "50", "1000");
    await c.comprar(e, p.origen, p.manteca.producto, "20", "9000");
    // Una orden abierta ANTES de apagar: lo ya guardado se sigue aplicando.
    const orden = valorDe(
      await c.produccion.abrirOrden(e.gerente, {
        id: nuevoId(),
        productoId: p.masa.producto,
        cantidad: "16",
        unidadId: "KILOGRAMO",
        depositoId: p.origen,
        depositoDestinoId: p.destino,
      }),
    );

    c.apagarPerillas();
    try {
      // 1) Lo nuevo, rechazado con la perilla que falta.
      expect(
        await c.produccion.abrirOrden(e.gerente, {
          id: nuevoId(),
          productoId: p.masa.producto,
          cantidad: "8",
          unidadId: "KILOGRAMO",
          depositoId: p.origen,
          depositoDestinoId: p.destino,
        }),
      ).toEqual({ ok: false, error: { error: "FUNCION_NO_INCLUIDA", perilla: "produccion" } });
      expect(
        await c.casos.controlarLote(e.gerente, {
          productoId: p.masa.producto,
          modo: "LOTE",
          conCalidad: false,
        }),
      ).toEqual({ ok: false, error: { error: "FUNCION_NO_INCLUIDA", perilla: "lotes" } });
      const otraMasa = await c.articulo(e, {
        clase: "ELABORADO",
        unidadBase: "KILOGRAMO",
        dimension: "MASA",
      });
      expect(
        await c.casos.guardarComposicion(e.gerente, {
          productoId: p.masa.producto,
          versionEsperada: 1,
          rinde: "8",
          componentes: [{ productoId: otraMasa.producto, cantidad: "6", unidadId: "KILOGRAMO" }],
        }),
      ).toEqual({
        ok: false,
        error: { error: "FUNCION_NO_INCLUIDA", perilla: "subcomposiciones" },
      });

      // 2) El stock de E5 funciona igual: entrada, salida y existencia.
      await c.comprar(e, p.origen, p.harina.producto, "5", "1000");
      valorDe(
        await c.casos.registrarSalida(e.gerente, {
          clave: nuevoId(),
          depositoId: p.origen,
          motivo: "CONSUMO_INTERNO",
          renglones: [{ productoId: p.harina.producto, cantidad: "5", unidadId: "KILOGRAMO" }],
        }),
      );
      expect(await c.existencia(p.origen, p.harina.articulo)).toBe("50.0000");

      // 3) La orden ya abierta se cierra igual, sin lote (el producto no lleva control).
      const cierre = valorDe(
        await c.produccion.cerrarOrden(e.gerente, {
          ordenId: orden.ordenId,
          clave: nuevoId(),
          obtenido: "15",
          unidadId: "KILOGRAMO",
          consumos: [
            { productoId: p.harina.producto, cantidadReal: "12", unidadId: "KILOGRAMO" },
            { productoId: p.manteca.producto, cantidadReal: "4", unidadId: "KILOGRAMO" },
          ],
        }),
      );
      expect(cierre.lote).toBeNull();
      expect(await c.existencia(p.destino, p.masa.articulo)).toBe("15.0000");
    } finally {
      c.encenderPerilla("produccion");
      c.encenderPerilla("lotes");
      c.encenderPerilla("calidad_de_lote");
      c.encenderPerilla("subcomposiciones");
    }

    // Ninguna fila de lote ni de control: sin control no se escribe nada de lotes.
    for (const tabla of ["lote", "control_de_lote", "saldo_de_lote"]) {
      expect(
        await c.contar(`select count(*) as n from ${tabla} where empresa_id = $1`, [e.empresa]),
        tabla,
      ).toBe(0);
    }
  });
});
