import { describe, expect, it, vi } from "vitest";
import type { PermisosParaOfrecer } from "../../src/capacidades/integracion/ofrecer";
import type { OperacionContextual } from "../../src/capacidades/integracion/tipos";
import {
  armarLaHoja,
  armarOferta,
  type RegistrosDeIntegracion,
} from "../../apps/web/servidor/integracion";

/**
 * Qué dibuja una pantalla según las operaciones que se ofrecen (escalabilidad X-1): ninguna → nada; una → directa; varias → «Más».
 * Versión pura, con registros de mentira. Ante permisos ilegibles, referencia inválida o `volver` ajeno, nada, con una línea en el
 * registro del servidor SIN el id. Previene: dibujar algo que el servidor va a rechazar y filtrar el id al registro.
 */
vi.mock("server-only", () => ({}));
// `integracion.ts` lee permisos con la composición real: la prueba solo usa las versiones puras.
vi.mock("../../apps/web/servidor/permisos-de-la-persona", () => ({
  permisosDeLaPersona: () => null,
}));

const ID = "3f2a9c1e-4b5d-4e6f-8a7b-0c1d2e3f4a5b";
const PERMISOS: PermisosParaOfrecer = {
  acciones: ["ventas.ver"],
  modulos: { activos: ["ventas"], enSoloLectura: [] },
};
const op = (id: string, orden: number) =>
  ({
    id,
    modulo: "ventas",
    contexto: "ventas.cuenta",
    accion: "ventas.ver",
    perilla: null,
    etiqueta: "x",
    orden,
    seAbreEn: `/v/${id}`,
    alTerminar: "VUELVE",
  }) as unknown as OperacionContextual<string>;
const registros = (
  operaciones: OperacionContextual<string>[],
  lineas: string[] = [],
): RegistrosDeIntegracion => ({
  catalogo: { ventas: { estado: "disponible" } },
  contextos: { "ventas.cuenta": {} },
  operaciones,
  etiquetaDe: (clave) => `texto:${clave}`,
  registrar: (l) => lineas.push(l),
});
const REF = { tipo: "ventas.cuenta", id: ID };

describe("armarOferta", () => {
  it("ninguna ofrecida → NINGUNA", () => {
    expect(armarOferta(registros([]), PERMISOS, REF, "/ventas")).toEqual({ modo: "NINGUNA" });
  });
  it("una → DIRECTA con su dirección y el sobre", () => {
    const o = armarOferta(registros([op("a", 1)]), PERMISOS, REF, "/ventas");
    expect(o).toEqual({
      modo: "DIRECTA",
      operacion: {
        id: "a",
        etiqueta: "texto:x",
        href: `/v/a?contexto=ventas.cuenta&id=${ID}&volver=%2Fventas`,
      },
    });
  });
  it("dos o más → MAS con la cantidad y la hoja", () => {
    const o = armarOferta(registros([op("a", 1), op("b", 2)]), PERMISOS, REF, "/ventas");
    expect(o).toEqual({
      modo: "MAS",
      href: `/mas?contexto=ventas.cuenta&id=${ID}&volver=%2Fventas`,
      cantidad: 2,
    });
  });
  it("sin permiso para una de dos → directa", () => {
    const o = armarOferta(
      registros([
        op("a", 1),
        { ...op("b", 2), accion: "ventas.anular" } as unknown as OperacionContextual<string>,
      ]),
      PERMISOS,
      REF,
      "/ventas",
    );
    expect(o.modo).toBe("DIRECTA");
  });
  it("permisos ilegibles, referencia inválida o volver ajeno → NINGUNA y una línea sin el id", () => {
    const lineas: string[] = [];
    const r = registros([op("a", 1)], lineas);
    expect(armarOferta(r, null, REF, "/ventas")).toEqual({ modo: "NINGUNA" });
    expect(armarOferta(r, PERMISOS, { ...REF, id: "1" }, "/ventas")).toEqual({ modo: "NINGUNA" });
    expect(armarOferta(r, PERMISOS, { ...REF, tipo: "otro.cosa" }, "/ventas")).toEqual({
      modo: "NINGUNA",
    });
    expect(armarOferta(r, PERMISOS, REF, "https://evil.com")).toEqual({ modo: "NINGUNA" });
    expect(lineas).toHaveLength(4);
    expect(lineas.join("\n")).not.toContain(ID);
    expect(lineas[0]).toContain("ventas.cuenta");
  });
});

describe("armarLaHoja", () => {
  const sobre = { referencia: REF, volver: "/ventas?x=1" };
  it("lista en orden y cada dirección conserva el volver de origen", () => {
    const hoja = armarLaHoja(registros([op("b", 2), op("a", 1)]), PERMISOS, sobre);
    expect(hoja.map((h) => h.id)).toEqual(["a", "b"]);
    for (const h of hoja)
      expect(new URL(h.href, "http://x").searchParams.get("volver")).toBe("/ventas?x=1");
  });
  it("permisos ilegibles → vacía", () => {
    expect(armarLaHoja(registros([op("a", 1)]), null, sobre)).toEqual([]);
  });
});
