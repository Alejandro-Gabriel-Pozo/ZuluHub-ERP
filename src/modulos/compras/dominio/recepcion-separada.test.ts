import { describe, expect, it } from "vitest";
import {
  esNivelDeRecepcionSeparada,
  huellaDeLaRecepcion,
  type PedidoDeRecepcion,
} from "./recepcion-separada";
import { NIVELES_DE_COMPRA } from "./niveles";

const renglon = {
  productoId: "00000000-0000-4000-8000-000000000001",
  presentacionId: null,
  unidadDeCompraId: "KILOGRAMO",
  cantidad: "10.0000",
  pesoReal: null,
  precioPor: "UNIDAD",
  unidadDePrecioId: "KILOGRAMO",
  precio: "100.000000",
} as const;
const base: PedidoDeRecepcion = {
  sucursalId: "00000000-0000-4000-8000-0000000000a1",
  proveedorId: "00000000-0000-4000-8000-0000000000b1",
  hechoEn: null,
  remito: null,
  renglones: [renglon],
  controles: [],
};

describe("esNivelDeRecepcionSeparada", () => {
  it("solo N3 y N4", () => {
    expect(NIVELES_DE_COMPRA.filter(esNivelDeRecepcionSeparada)).toEqual([
      "RECEPCION_SEPARADA",
      "TRES_VIAS",
    ]);
  });
});

describe("huellaDeLaRecepcion", () => {
  it("es de 64 hex y el mismo pedido da la misma", () => {
    expect(huellaDeLaRecepcion(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaDeLaRecepcion({ ...base })).toBe(huellaDeLaRecepcion(base));
  });

  it("cada campo cuenta: otro dato, otra huella", () => {
    const h = huellaDeLaRecepcion(base);
    const distintos: PedidoDeRecepcion[] = [
      { ...base, sucursalId: "00000000-0000-4000-8000-0000000000a2" },
      { ...base, proveedorId: "00000000-0000-4000-8000-0000000000b2" },
      { ...base, hechoEn: "2026-11-10T15:00:00.000Z" },
      { ...base, remito: { puntoDeVenta: 1, numero: 2, fecha: "2026-11-10" } },
      { ...base, renglones: [{ ...renglon, cantidad: "11.0000" }] },
      {
        ...base,
        controles: [
          {
            linea: 1,
            condicion: "CONFORME",
            cantidadSegunRemito: null,
            observacion: null,
            temperaturaEnC: null,
          },
        ],
      },
    ];
    for (const d of distintos) expect(huellaDeLaRecepcion(d)).not.toBe(h);
    const con = (
      obs: string | null,
      temp: string | null,
      remito: string | null,
      condicion: "CONFORME" | "RECHAZADA",
    ) => ({
      ...base,
      controles: [
        {
          linea: 1,
          condicion,
          cantidadSegunRemito: remito,
          observacion: obs,
          temperaturaEnC: temp,
        },
      ],
    });
    const c = huellaDeLaRecepcion(con(null, null, null, "CONFORME"));
    expect(huellaDeLaRecepcion(con("x", null, null, "CONFORME"))).not.toBe(c);
    expect(huellaDeLaRecepcion(con(null, "4", null, "CONFORME"))).not.toBe(c);
    expect(huellaDeLaRecepcion(con(null, null, "2.0000", "CONFORME"))).not.toBe(c);
    expect(huellaDeLaRecepcion(con("x", null, null, "RECHAZADA"))).not.toBe(
      huellaDeLaRecepcion(con("x", null, null, "CONFORME")),
    );
  });

  it("el orden de los renglones y el de los controles no cambian el pedido", () => {
    const otro = { ...renglon, productoId: "00000000-0000-4000-8000-000000000002" };
    const ctl = (linea: number) => ({
      linea,
      condicion: "CONFORME" as const,
      cantidadSegunRemito: null,
      observacion: null,
      temperaturaEnC: null,
    });
    expect(
      huellaDeLaRecepcion({ ...base, renglones: [renglon, otro], controles: [ctl(1), ctl(2)] }),
    ).toBe(
      huellaDeLaRecepcion({ ...base, renglones: [otro, renglon], controles: [ctl(2), ctl(1)] }),
    );
  });

  it("no se confunde con la huella de una compra común", () => {
    expect(huellaDeLaRecepcion(base)).not.toBe(huellaDeLaRecepcion({ ...base, hechoEn: "" }));
  });
});
