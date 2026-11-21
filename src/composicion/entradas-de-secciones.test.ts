import { describe, expect, it } from "vitest";
import {
  entradaDeReordenar,
  leerElPedidoDeCrearSeccion,
  leerElPedidoDeMover,
  leerElPedidoDeRenombrarSeccion,
  leerElPedidoDeUnaSeccion,
  ordenDeLaSeccionNueva,
  type PedidoDeMover,
} from "./entradas-de-secciones";

/**
 * La entrada de la pantalla «Secciones de la carta» (A8, parte 1): lo que mandan los formularios y las flechas contra lo que aceptan los casos de uso. Cada regla con su prueba: los pedidos solo
 * leen las claves declaradas, el orden de una sección nueva sale de la lista (y repetir la creación no lo cambia) y un toque de flecha intercambia a la sección con su vecina.
 */
const A = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const B = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const C = "7d2e1f00-1111-4222-8333-944455556666";

describe("los pedidos: solo la forma", () => {
  it("crear lee la clave de creación y el nombre, y descarta lo demás (la empresa, el orden, el estado)", () => {
    expect(
      leerElPedidoDeCrearSeccion({
        claveDeCreacion: A,
        nombre: "Cafés",
        empresaId: "otra",
        orden: 9,
        activa: false,
      }),
    ).toEqual({ ok: true, valor: { claveDeCreacion: A, nombre: "Cafés" } });
  });

  it.each([
    null,
    {},
    { claveDeCreacion: "x", nombre: "Cafés" },
    { claveDeCreacion: A },
    { claveDeCreacion: A, nombre: 3 },
    { claveDeCreacion: A, nombre: "x".repeat(1001) },
  ])("crear: %j no tiene la forma pedida", (crudo) => {
    expect(leerElPedidoDeCrearSeccion(crudo)).toEqual({ ok: false, error: "PEDIDO_INVALIDO" });
  });

  it("renombrar lee la sección, la versión y el nombre (la versión llega como número o como texto de dígitos)", () => {
    expect(
      leerElPedidoDeRenombrarSeccion({ seccionId: A, versionEsperada: 3, nombre: "Cafés", x: 1 }),
    ).toEqual({ ok: true, valor: { seccionId: A, versionEsperada: 3, nombre: "Cafés" } });
    expect(
      leerElPedidoDeRenombrarSeccion({ seccionId: A, versionEsperada: "3", nombre: "Cafés" }),
    ).toEqual({ ok: true, valor: { seccionId: A, versionEsperada: 3, nombre: "Cafés" } });
  });

  it.each([
    null,
    { seccionId: A, nombre: "Cafés" },
    { seccionId: "x", versionEsperada: 1, nombre: "Cafés" },
    { seccionId: A, versionEsperada: -1, nombre: "Cafés" },
    { seccionId: A, versionEsperada: "1.5", nombre: "Cafés" },
    { seccionId: A, versionEsperada: 1 },
  ])("renombrar: %j no tiene la forma pedida", (crudo) => {
    expect(leerElPedidoDeRenombrarSeccion(crudo)).toEqual({ ok: false, error: "PEDIDO_INVALIDO" });
  });

  it("una sección lee solo su id", () => {
    expect(leerElPedidoDeUnaSeccion({ seccionId: A, nombre: "Cafés" })).toEqual({
      ok: true,
      valor: { seccionId: A },
    });
    expect(leerElPedidoDeUnaSeccion({ seccionId: "x" })).toEqual({
      ok: false,
      error: "PEDIDO_INVALIDO",
    });
    expect(leerElPedidoDeUnaSeccion(null)).toEqual({ ok: false, error: "PEDIDO_INVALIDO" });
  });

  it("mover lee las secciones vistas, la tocada y el sentido", () => {
    const pedido = {
      vistas: [{ seccionId: A, versionEsperada: 1, extra: true }],
      seccionId: A,
      sentido: "ABAJO",
      empresaId: "otra",
    };
    expect(leerElPedidoDeMover(pedido)).toEqual({
      ok: true,
      valor: { vistas: [{ seccionId: A, versionEsperada: 1 }], seccionId: A, sentido: "ABAJO" },
    });
  });

  it.each([
    null,
    { vistas: [], seccionId: A },
    { vistas: [], seccionId: A, sentido: "ARRIBA O ABAJO" },
    { vistas: [], seccionId: A, sentido: "arriba" },
    { vistas: [], seccionId: "x", sentido: "ARRIBA" },
    { vistas: [{ seccionId: "x", versionEsperada: 1 }], seccionId: A, sentido: "ARRIBA" },
    { vistas: [{ seccionId: A, versionEsperada: -1 }], seccionId: A, sentido: "ARRIBA" },
    { vistas: [{ seccionId: A }], seccionId: A, sentido: "ARRIBA" },
    { seccionId: A, sentido: "ARRIBA" },
  ])("mover: %j no tiene la forma pedida", (crudo) => {
    expect(leerElPedidoDeMover(crudo)).toEqual({ ok: false, error: "PEDIDO_INVALIDO" });
  });

  it("mover acepta una lista larga pero no enorme", () => {
    const vistas = (n: number) =>
      Array.from({ length: n }, () => ({ seccionId: A, versionEsperada: 1 }));
    expect(leerElPedidoDeMover({ vistas: vistas(500), seccionId: A, sentido: "ARRIBA" }).ok).toBe(
      true,
    );
    expect(leerElPedidoDeMover({ vistas: vistas(501), seccionId: A, sentido: "ARRIBA" }).ok).toBe(
      false,
    );
  });
});

describe("ordenDeLaSeccionNueva", () => {
  it("sin secciones, la primera lleva el orden 0", () => {
    expect(ordenDeLaSeccionNueva([], A)).toBe(0);
  });

  it("es el mayor de la lista más uno, sin importar el orden en que viene ni si hay desactivadas", () => {
    expect(
      ordenDeLaSeccionNueva(
        [
          { id: B, orden: 4 },
          { id: C, orden: 7 },
          { id: "otra", orden: 2 },
        ],
        A,
      ),
    ).toBe(8);
  });

  it("una lista con un solo orden 0 da 1", () => {
    expect(ordenDeLaSeccionNueva([{ id: B, orden: 0 }], A)).toBe(1);
  });

  it("repetir la creación (el id ya está en la lista) devuelve el orden que ya tiene, aunque no sea el último", () => {
    expect(
      ordenDeLaSeccionNueva(
        [
          { id: A, orden: 3 },
          { id: B, orden: 9 },
        ],
        A,
      ),
    ).toBe(3);
  });
});

describe("entradaDeReordenar", () => {
  const vistas = [
    { seccionId: A, versionEsperada: 1 },
    { seccionId: B, versionEsperada: 2 },
    { seccionId: C, versionEsperada: 3 },
  ];
  const pedido = (seccionId: string, sentido: "ARRIBA" | "ABAJO"): PedidoDeMover => ({
    vistas,
    seccionId,
    sentido,
  });
  const ids = (r: ReturnType<typeof entradaDeReordenar>) => r?.secciones.map((s) => s.seccionId);

  it("subir intercambia a la sección con la de arriba y cada una conserva su versión", () => {
    const r = entradaDeReordenar(pedido(B, "ARRIBA"));
    expect(r).toEqual({
      secciones: [
        { seccionId: B, versionEsperada: 2 },
        { seccionId: A, versionEsperada: 1 },
        { seccionId: C, versionEsperada: 3 },
      ],
    });
  });

  it("bajar intercambia a la sección con la de abajo", () => {
    expect(ids(entradaDeReordenar(pedido(B, "ABAJO")))).toEqual([A, C, B]);
    expect(ids(entradaDeReordenar(pedido(A, "ABAJO")))).toEqual([B, A, C]);
    expect(ids(entradaDeReordenar(pedido(C, "ARRIBA")))).toEqual([A, C, B]);
  });

  it("la primera no sube y la última no baja: queda el mismo orden (el caso de uso lo ve como ya aplicado)", () => {
    expect(ids(entradaDeReordenar(pedido(A, "ARRIBA")))).toEqual([A, B, C]);
    expect(ids(entradaDeReordenar(pedido(C, "ABAJO")))).toEqual([A, B, C]);
  });

  it("una sola sección no se mueve", () => {
    const sola = { vistas: [{ seccionId: A, versionEsperada: 1 }], seccionId: A };
    expect(ids(entradaDeReordenar({ ...sola, sentido: "ARRIBA" }))).toEqual([A]);
    expect(ids(entradaDeReordenar({ ...sola, sentido: "ABAJO" }))).toEqual([A]);
  });

  it("una sección que la persona no vio es null", () => {
    expect(entradaDeReordenar(pedido("0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a99", "ARRIBA"))).toBeNull();
    expect(entradaDeReordenar({ vistas: [], seccionId: A, sentido: "ARRIBA" })).toBeNull();
  });

  it("no cambia la lista que recibió", () => {
    const original = vistas.map((v) => ({ ...v }));
    entradaDeReordenar(pedido(B, "ARRIBA"));
    expect(vistas).toEqual(original);
  });
});
