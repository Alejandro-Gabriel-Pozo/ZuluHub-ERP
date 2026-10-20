import { describe, expect, it } from "vitest";
import { marcaComercialId } from "../../../primitivas/identificadores/marca";
import {
  NIVEL_MAXIMO_DE_LA_BASE,
  campoInmutableModificado,
  decidirAltaDeMarca,
  nivelDeMarca,
  validarCodigoDeMarca,
  type PadreDeMarca,
} from "./jerarquia";

const PRINCIPAL = marcaComercialId("m-principal");
const HIJA = marcaComercialId("m-hija");
const OTRA = marcaComercialId("m-otra");

const principal: PadreDeMarca = { id: PRINCIPAL, nivel: 0, esPrincipal: true, estado: "ACTIVA" };
const hija: PadreDeMarca = { id: HIJA, nivel: 1, esPrincipal: false, estado: "ACTIVA" };

describe("validarCodigoDeMarca", () => {
  it.each(["pedernal", "mi-calendario", "ab", "a1", "a-1-b", "a".repeat(40), "z9"])(
    "acepta %s",
    (c) => {
      expect(validarCodigoDeMarca(c)).toEqual({ ok: true, valor: c });
    },
  );

  it.each([
    ["vacío", ""],
    ["una sola letra", "a"],
    ["41 caracteres", "a".repeat(41)],
    ["empieza con número", "1abc"],
    ["empieza con guion", "-abc"],
    ["mayúsculas", "Mi-Calendario"],
    ["guion bajo", "mi_calendario"],
    ["punto", "mi.calendario"],
    ["espacio", "mi calendario"],
    ["eñe", "ñandu"],
    ["con salto de línea al final", "abc\n"],
    ["barra", "a/b"],
  ])("rechaza %s", (_nombre, codigo) => {
    expect(validarCodigoDeMarca(codigo)).toEqual({ ok: false, error: "CODIGO_DE_MARCA_INVALIDO" });
  });
});

describe("nivelDeMarca", () => {
  it("sin padre es el nivel 0; con padre, el del padre más uno", () => {
    expect(nivelDeMarca(null)).toEqual({ ok: true, valor: 0 });
    expect(nivelDeMarca(0)).toEqual({ ok: true, valor: 1 });
    expect(nivelDeMarca(1)).toEqual({ ok: true, valor: 2 });
  });

  it("el nivel 3 no existe: la base admite hasta el 2", () => {
    expect(NIVEL_MAXIMO_DE_LA_BASE).toBe(2);
    expect(nivelDeMarca(2)).toEqual({ ok: false, error: "NIVEL_DE_MARCA_EXCEDIDO" });
    expect(nivelDeMarca(5)).toEqual({ ok: false, error: "NIVEL_DE_MARCA_EXCEDIDO" });
  });
});

describe("decidirAltaDeMarca", () => {
  it("un producto directo de la principal nace en el nivel 1", () => {
    expect(decidirAltaDeMarca("mi-calendario", principal)).toEqual({
      ok: true,
      valor: { codigo: "mi-calendario", marcaPadreId: PRINCIPAL, nivel: 1 },
    });
  });

  it("una marca sin padre nace en el nivel 0 y nunca principal", () => {
    expect(decidirAltaDeMarca("independiente", null)).toEqual({
      ok: true,
      valor: { codigo: "independiente", marcaPadreId: null, nivel: 0 },
    });
  });

  it("un hijo de un producto (nivel 2) no está habilitado en v1", () => {
    expect(decidirAltaDeMarca("microsegmento", hija)).toEqual({
      ok: false,
      error: "NIVEL_DE_MARCA_NO_HABILITADO",
    });
  });

  it("tampoco es hijo válido el de una marca independiente que no es la principal", () => {
    const independiente: PadreDeMarca = {
      id: OTRA,
      nivel: 0,
      esPrincipal: false,
      estado: "ACTIVA",
    };
    expect(decidirAltaDeMarca("x-hijo", independiente)).toEqual({
      ok: false,
      error: "NIVEL_DE_MARCA_NO_HABILITADO",
    });
  });

  it("el hijo de una marca en el nivel 2 pasaría de lo que admite la base", () => {
    // Una principal con nivel 2 no existe; el dato inconsistente prueba que la regla de la base se aplica igual.
    expect(decidirAltaDeMarca("x-hijo", { ...principal, nivel: 2 })).toEqual({
      ok: false,
      error: "NIVEL_DE_MARCA_EXCEDIDO",
    });
  });

  it("el padre retirado no sirve", () => {
    expect(decidirAltaDeMarca("x-hijo", { ...principal, estado: "RETIRADA" })).toEqual({
      ok: false,
      error: "MARCA_PADRE_RETIRADA",
    });
  });

  it("el código inválido se informa primero, antes de mirar al padre", () => {
    expect(decidirAltaDeMarca("Mal Codigo", { ...hija, estado: "RETIRADA" })).toEqual({
      ok: false,
      error: "CODIGO_DE_MARCA_INVALIDO",
    });
  });

  it("un padre retirado se informa antes que un nivel no habilitado", () => {
    expect(decidirAltaDeMarca("x-hijo", { ...hija, estado: "RETIRADA" })).toEqual({
      ok: false,
      error: "MARCA_PADRE_RETIRADA",
    });
  });
});

describe("campoInmutableModificado", () => {
  const base = { codigo: "pedernal", marcaPadreId: null, esPrincipal: true };

  it("sin cambios no toca nada", () => {
    expect(campoInmutableModificado(base, { ...base })).toBeNull();
  });

  it("detecta el código, la marca padre y la condición de principal", () => {
    expect(campoInmutableModificado(base, { ...base, codigo: "otro" })).toBe("codigo");
    expect(campoInmutableModificado(base, { ...base, marcaPadreId: OTRA })).toBe("marcaPadreId");
    expect(campoInmutableModificado(base, { ...base, esPrincipal: false })).toBe("esPrincipal");
    expect(
      campoInmutableModificado(
        { ...base, marcaPadreId: PRINCIPAL },
        { ...base, marcaPadreId: null },
      ),
    ).toBe("marcaPadreId");
  });

  it("si cambian varios, informa el primero: código, padre, principal", () => {
    expect(
      campoInmutableModificado(base, { codigo: "otro", marcaPadreId: OTRA, esPrincipal: false }),
    ).toBe("codigo");
    expect(
      campoInmutableModificado(base, { ...base, marcaPadreId: OTRA, esPrincipal: false }),
    ).toBe("marcaPadreId");
  });
});
