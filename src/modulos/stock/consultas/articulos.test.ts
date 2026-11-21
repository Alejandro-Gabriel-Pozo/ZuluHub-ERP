import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok } from "../../../primitivas/resultado/resultado";
import { armarConsultasDeArticulos } from "./articulos";
import type { Lector } from "./comun";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/**
 * `controlDeStockDelProducto` con el lector simulado: pide la acción `stock.ver`, no toca la base con un id que no es UUID y responde «controlado» solo con un artículo ACTIVO de la empresa del
 * contexto. Contra la base real y los roles reales: `test/integracion/control-de-stock-web.test.ts`.
 */
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const contexto = { empresaId: "e1" } as unknown as ContextoOperativo;

const montar = (articulo: { activo: boolean } | null) => {
  const m = { acciones: [] as string[], buscados: [] as unknown[] };
  const leer = ((_c: unknown, accion: string, trabajo: (tx: unknown) => Promise<unknown>) => {
    m.acciones.push(accion);
    return trabajo({
      articulosDeStock: {
        porProducto: (empresa: unknown, productoId: unknown) => {
          m.buscados.push([empresa, productoId]);
          return Promise.resolve(articulo);
        },
      },
    }).then((valor) => ok(valor));
  }) as unknown as Lector;
  return { m, consulta: armarConsultasDeArticulos(leer).controlDeStockDelProducto };
};

describe("controlDeStockDelProducto", () => {
  it("la acción que pide es stock.ver", () => {
    expect(DECLARACIONES_DE_CONSULTAS.controlDeStockDelProducto).toEqual({ accion: "stock.ver" });
  });

  it("con un artículo activo está controlado; la lectura va con la empresa del contexto", async () => {
    const { m, consulta } = montar({ activo: true });
    expect(await consulta(contexto, { productoId: ID })).toEqual(ok({ controlado: true }));
    expect(m.acciones).toEqual(["stock.ver"]);
    expect(m.buscados).toEqual([["e1", ID]]);
  });

  it("con un artículo inactivo o sin artículo no está controlado", async () => {
    expect(await montar({ activo: false }).consulta(contexto, { productoId: ID })).toEqual(
      ok({ controlado: false }),
    );
    expect(await montar(null).consulta(contexto, { productoId: ID })).toEqual(
      ok({ controlado: false }),
    );
  });

  it("un id que no es UUID (o que no es texto) responde «no controlado» sin leer la base", async () => {
    for (const productoId of ["no-es-un-uuid", "", 7 as unknown as string]) {
      const { m, consulta } = montar({ activo: true });
      expect(await consulta(contexto, { productoId })).toEqual(ok({ controlado: false }));
      expect(m.buscados).toEqual([]);
    }
  });
});
