import { describe, expect, it } from "vitest";
import {
  direccionDeEmpresas,
  ESTADOS_EFECTIVOS,
  filtrosDeLaDireccion,
  ROTULO_DE_ESTADO,
  rotuloDeEstado,
} from "../../apps/plataforma/logica/filtros-de-empresas";

const A = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const B = "11111111-2222-3333-4444-555555555555";
const C = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";

describe("filtrosDeLaDireccion", () => {
  it("sin filtros devuelve vacío y la dirección es /empresas", () => {
    expect(filtrosDeLaDireccion({})).toEqual({});
    expect(direccionDeEmpresas({})).toBe("/empresas");
  });

  it("toma todos los filtros válidos", () => {
    expect(
      filtrosDeLaDireccion({ estado: "OPERA", submarca: A, plan: B, buscar: " Pan ", despues: C }),
    ).toEqual({
      estadoEfectivo: "OPERA",
      marcaId: A,
      planId: B,
      buscar: "Pan",
      despuesDeId: C,
    });
  });

  it("descarta en silencio lo inválido", () => {
    expect(
      filtrosDeLaDireccion({
        estado: "inventado",
        submarca: "no-es-uuid",
        plan: "123",
        buscar: "   ",
        despues: "xyz",
      }),
    ).toEqual({});
    expect(filtrosDeLaDireccion({ estado: "opera" })).toEqual({});
  });

  it("con un parámetro repetido toma el primero", () => {
    expect(filtrosDeLaDireccion({ estado: ["EMPRESA_EN_ALTA", "OPERA"] })).toEqual({
      estadoEfectivo: "EMPRESA_EN_ALTA",
    });
    expect(filtrosDeLaDireccion({ estado: ["malo", "OPERA"] })).toEqual({});
    expect(filtrosDeLaDireccion({ estado: [] })).toEqual({});
  });

  it("recorta `buscar` a 200 caracteres", () => {
    const f = filtrosDeLaDireccion({ buscar: "a".repeat(500) });
    expect(f.buscar).toBe("a".repeat(200));
    const g = filtrosDeLaDireccion({ buscar: "  " + "b".repeat(300) });
    expect(g.buscar).toBe("b".repeat(200));
  });

  it("no lanza con claves raras", () => {
    expect(filtrosDeLaDireccion({ __proto__: undefined, constructor: "x" })).toEqual({});
  });
});

describe("direccionDeEmpresas", () => {
  it("usa el orden fijo estado, submarca, plan, buscar, despues", () => {
    expect(
      direccionDeEmpresas({
        despuesDeId: C,
        buscar: "x",
        planId: B,
        marcaId: A,
        estadoEfectivo: "OPERA",
      }),
    ).toBe(`/empresas?estado=OPERA&submarca=${A}&plan=${B}&buscar=x&despues=${C}`);
  });

  it("escapa los caracteres especiales de la búsqueda", () => {
    const url = direccionDeEmpresas({ buscar: `a&b=c#d "e" 'f'` });
    expect(url).not.toMatch(/[#"' ]/);
    expect(url.split("?")[1]?.match(/&/g)).toBeNull();
    const vuelta = new URL(url, "http://x").searchParams.get("buscar");
    expect(vuelta).toBe(`a&b=c#d "e" 'f'`);
  });

  it("ida y vuelta: normaliza", () => {
    const entrada = { buscar: `  S&A = "x" #1  `, plan: B, estado: ["OPERA", "otro"], malo: "1" };
    const dir = direccionDeEmpresas(filtrosDeLaDireccion(entrada));
    expect(dir).toBe(`/empresas?estado=OPERA&plan=${B}&buscar=S%26A+%3D+%22x%22+%231`);
    const params = Object.fromEntries(new URL(dir, "http://x").searchParams);
    expect(direccionDeEmpresas(filtrosDeLaDireccion(params))).toBe(dir);
  });

  it("una búsqueda larga y con espacios queda recortada a 200", () => {
    const dir = direccionDeEmpresas(filtrosDeLaDireccion({ buscar: `  ${"é".repeat(250)}  ` }));
    const buscar = new URL(dir, "http://x").searchParams.get("buscar");
    expect(buscar).toBe("é".repeat(200));
  });
});

describe("rótulos de estado", () => {
  it("cubren todos los estados efectivos con texto", () => {
    for (const estado of ESTADOS_EFECTIVOS) {
      expect(ROTULO_DE_ESTADO[estado].texto.length).toBeGreaterThan(0);
      expect(rotuloDeEstado(estado)).toEqual(ROTULO_DE_ESTADO[estado]);
    }
  });

  it("textos y tonos acordados", () => {
    expect(rotuloDeEstado("OPERA")).toEqual({ texto: "Activa", tono: "exito" });
    expect(rotuloDeEstado("EMPRESA_EN_ALTA")).toEqual({ texto: "En alta", tono: "aviso" });
    expect(rotuloDeEstado("EMPRESA_SUSPENDIDA")).toEqual({ texto: "Suspendida", tono: "peligro" });
    expect(rotuloDeEstado("TENANT_SUSPENDIDO")).toEqual({
      texto: "Cliente suspendido",
      tono: "peligro",
    });
    expect(rotuloDeEstado("EMPRESA_CANCELADA")).toEqual({ texto: "Cancelada", tono: "info" });
    expect(rotuloDeEstado("EMPRESA_EN_BAJA")).toEqual({ texto: "En baja", tono: "info" });
  });

  it("un estado desconocido no se muestra literal", () => {
    expect(rotuloDeEstado("ALGO_NUEVO")).toEqual({ texto: "Estado desconocido", tono: "info" });
    expect(rotuloDeEstado("toString")).toEqual({ texto: "Estado desconocido", tono: "info" });
  });
});
