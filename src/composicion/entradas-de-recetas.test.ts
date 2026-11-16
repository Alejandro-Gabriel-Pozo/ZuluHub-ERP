import { describe, expect, it } from "vitest";
import { codificarLaPagina } from "./entradas-de-productos";
import {
  leerLaEntradaDeLaListaDeRecetas,
  leerLaEntradaDeLosIngredientes,
} from "./entradas-de-recetas";

const ID = "0d9b7a40-5c1e-4a52-9b6f-3f8d2a1c7e90";
const VACIA = { texto: "", conReceta: "", activo: "", despues: "" };

describe("leerLaEntradaDeLaListaDeRecetas", () => {
  it("todo vacío es «sin filtrar» y primera página", () => {
    expect(leerLaEntradaDeLaListaDeRecetas(VACIA)).toEqual({});
    expect(leerLaEntradaDeLaListaDeRecetas({ ...VACIA, texto: "   " })).toEqual({});
  });

  it("pasa lo permitido: el texto, con receta o sin ella, el estado y la página que dio la consulta", () => {
    const despues = codificarLaPagina({ id: ID, nombreClave: "milanesa" });
    expect(
      leerLaEntradaDeLaListaDeRecetas({ texto: "Mila", conReceta: "con", activo: "si", despues }),
    ).toEqual({
      texto: "Mila",
      conReceta: true,
      activo: true,
      despuesDe: { id: ID, nombreClave: "milanesa" },
    });
    expect(leerLaEntradaDeLaListaDeRecetas({ ...VACIA, conReceta: "sin", activo: "no" })).toEqual({
      conReceta: false,
      activo: false,
    });
  });

  it.each([
    { conReceta: "todas" },
    { conReceta: "true" },
    { conReceta: "toString" },
    { conReceta: "__proto__" },
    { activo: "si " },
    { activo: "SI" },
    { activo: "constructor" },
    { texto: "uno\u0000dos" },
    { texto: "uno‮dos" },
    { despues: "sin-separador" },
    { despues: `${ID}:` },
    { despues: `no-es-un-id:milanesa` },
  ])("%j: nada puede coincidir (null), el filtro nunca se ensancha", (parte) => {
    expect(leerLaEntradaDeLaListaDeRecetas({ ...VACIA, ...parte })).toBeNull();
  });
});

describe("leerLaEntradaDeLosIngredientes", () => {
  it("vacío es «sin filtrar»; con texto y página pasa lo permitido", () => {
    expect(leerLaEntradaDeLosIngredientes({ texto: "", despues: "" })).toEqual({});
    expect(
      leerLaEntradaDeLosIngredientes({
        texto: "ha",
        despues: codificarLaPagina({ id: ID, nombreClave: "harina" }),
      }),
    ).toEqual({ texto: "ha", despuesDe: { id: ID, nombreClave: "harina" } });
  });

  it.each([{ texto: "uno\u0000" }, { despues: "mal" }, { despues: `${ID}:` }])(
    "%j: null",
    (parte) => {
      expect(leerLaEntradaDeLosIngredientes({ texto: "", despues: "", ...parte })).toBeNull();
    },
  );
});
