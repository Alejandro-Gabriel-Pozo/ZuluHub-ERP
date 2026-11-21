import { describe, expect, it } from "vitest";
import { direccionConSobre, leerElSobre, parametrosDelSobre, type SobreDeContexto } from "./sobre";

const ID = "3f2a9c1e-4b5d-4e6f-8a7b-0c1d2e3f4a5b";
const CONTEXTOS = { "ventas.cuenta": {} };
const SOBRE: SobreDeContexto = {
  referencia: { tipo: "ventas.cuenta", id: ID },
  volver: "/ventas/mesas?zona=a+b",
};
const leer = (p: Record<string, string | readonly string[] | undefined>) =>
  leerElSobre(p, CONTEXTOS);
const base = (): Record<string, string | readonly string[] | undefined> =>
  Object.fromEntries(parametrosDelSobre(SOBRE));

describe("el sobre de contexto", () => {
  it("ida y vuelta", () => {
    expect(leer(base())).toEqual(SOBRE);
  });
  it("lleva solo contexto, id y volver", () => {
    expect([...parametrosDelSobre(SOBRE).keys()]).toEqual(["contexto", "id", "volver"]);
    expect(direccionConSobre("/x", SOBRE).startsWith("/x?contexto=ventas.cuenta&id=")).toBe(true);
  });
  it("contexto fuera del registro (también heredado de Object), no", () => {
    expect(leer({ ...base(), contexto: "otro.cosa" })).toBeNull();
    expect(leer({ ...base(), contexto: "constructor" })).toBeNull();
  });
  it("id que no es uuid, no", () => {
    for (const id of ["1", "", ID.toUpperCase(), `${ID}x`])
      expect(leer({ ...base(), id })).toBeNull();
  });
  it("volver ajeno o inválido, no", () => {
    for (const volver of [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/a\r\nb",
      "",
      "ventas",
      "/ingreso",
    ])
      expect(leer({ ...base(), volver })).toBeNull();
  });
  it("parámetro repetido, de más, ausente o vacío, no", () => {
    expect(leer({ ...base(), id: [ID, ID] })).toBeNull();
    expect(leer({ ...base(), extra: "1" })).toBeNull();
    expect(leer({ ...base(), id: undefined })).toBeNull();
    expect(leer({ contexto: "ventas.cuenta", id: ID })).toBeNull();
  });
});
