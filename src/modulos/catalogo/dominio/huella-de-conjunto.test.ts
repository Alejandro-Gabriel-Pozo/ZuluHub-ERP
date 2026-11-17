import { describe, expect, it } from "vitest";
import { huellaDeLineaDeConjunto, type PedidoDeConjunto } from "./huella-de-conjunto";

const pedido = (cambios: Partial<PedidoDeConjunto> = {}): PedidoDeConjunto => ({
  cuentaId: "cuenta-1",
  productoId: "combo-funghi",
  componentes: [
    { posicion: 1, unidad: 1, productoId: null, opcionIds: ["o-b", "o-a"], cambios: [] },
    {
      posicion: 2,
      unidad: 1,
      productoId: "gaseosa-cola",
      opcionIds: [],
      cambios: [
        { ingredienteId: "i-2", accion: "SACAR", reemplazoId: null },
        { ingredienteId: "i-1", accion: "CAMBIAR", reemplazoId: "r-1" },
      ],
    },
  ],
  ...cambios,
});

describe("huellaDeLineaDeConjunto", () => {
  it("es un sha256 en hexadecimal y es la misma para el mismo pedido", () => {
    const huella = huellaDeLineaDeConjunto(pedido());
    expect(huella).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaDeLineaDeConjunto(pedido())).toBe(huella);
  });

  it("no depende del orden de las elecciones, de las opciones ni de los cambios", () => {
    const base = pedido();
    const [primera, segunda] = base.componentes as [
      PedidoDeConjunto["componentes"][number],
      PedidoDeConjunto["componentes"][number],
    ];
    const barajado = pedido({
      componentes: [
        { ...segunda, cambios: [...segunda.cambios].reverse() },
        { ...primera, opcionIds: [...primera.opcionIds].reverse() },
      ],
    });
    expect(huellaDeLineaDeConjunto(barajado)).toBe(huellaDeLineaDeConjunto(base));
  });

  it("ordena las elecciones por posición y, a igual posición, por unidad", () => {
    const dos = (a: number, b: number) =>
      pedido({
        componentes: [
          { posicion: 1, unidad: a, productoId: "x", opcionIds: [], cambios: [] },
          { posicion: 1, unidad: b, productoId: "y", opcionIds: [], cambios: [] },
        ],
      });
    expect(huellaDeLineaDeConjunto(dos(1, 2))).not.toBe(huellaDeLineaDeConjunto(dos(2, 1)));
    const desordenado = pedido({
      componentes: [
        { posicion: 1, unidad: 2, productoId: "y", opcionIds: [], cambios: [] },
        { posicion: 1, unidad: 1, productoId: "x", opcionIds: [], cambios: [] },
      ],
    });
    const ordenado = pedido({
      componentes: [
        { posicion: 1, unidad: 1, productoId: "x", opcionIds: [], cambios: [] },
        { posicion: 1, unidad: 2, productoId: "y", opcionIds: [], cambios: [] },
      ],
    });
    expect(huellaDeLineaDeConjunto(desordenado)).toBe(huellaDeLineaDeConjunto(ordenado));
    const dosPosiciones = pedido({
      componentes: [
        { posicion: 2, unidad: 1, productoId: "x", opcionIds: [], cambios: [] },
        { posicion: 1, unidad: 1, productoId: "x", opcionIds: [], cambios: [] },
      ],
    });
    const enOrden = pedido({
      componentes: [
        { posicion: 1, unidad: 1, productoId: "x", opcionIds: [], cambios: [] },
        { posicion: 2, unidad: 1, productoId: "x", opcionIds: [], cambios: [] },
      ],
    });
    expect(huellaDeLineaDeConjunto(dosPosiciones)).toBe(huellaDeLineaDeConjunto(enOrden));
  });

  it("cualquier campo distinto da otra huella", () => {
    const base = huellaDeLineaDeConjunto(pedido());
    const [c1, c2] = pedido().componentes as [
      PedidoDeConjunto["componentes"][number],
      PedidoDeConjunto["componentes"][number],
    ];
    const otros: PedidoDeConjunto[] = [
      pedido({ cuentaId: "cuenta-2" }),
      pedido({ productoId: "combo-otro" }),
      pedido({ componentes: [c1] }),
      pedido({ componentes: [{ ...c1, posicion: 3 }, c2] }),
      pedido({ componentes: [{ ...c1, unidad: 2 }, c2] }),
      pedido({ componentes: [{ ...c1, productoId: "x" }, c2] }),
      pedido({ componentes: [{ ...c1, opcionIds: ["o-a"] }, c2] }),
      pedido({ componentes: [c1, { ...c2, cambios: [] }] }),
      pedido({
        componentes: [
          c1,
          {
            ...c2,
            cambios: [
              { ingredienteId: "i-2", accion: "CAMBIAR", reemplazoId: null },
              { ingredienteId: "i-1", accion: "CAMBIAR", reemplazoId: "r-1" },
            ],
          },
        ],
      }),
      pedido({
        componentes: [
          c1,
          {
            ...c2,
            cambios: [
              { ingredienteId: "i-2", accion: "SACAR", reemplazoId: null },
              { ingredienteId: "i-1", accion: "CAMBIAR", reemplazoId: "r-2" },
            ],
          },
        ],
      }),
    ];
    for (const otro of otros) {
      expect(huellaDeLineaDeConjunto(otro)).not.toBe(base);
    }
  });
});
