import { describe, expect, it } from "vitest";
import { CLASES_DE_USO } from "../modulos/catalogo/publico";
import {
  ESTADOS_DE_PRODUCTO,
  codificarLaPagina,
  leerLaEntradaDeLaLista,
  leerLaPagina,
  type EntradaDeLaLista,
} from "./entradas-de-productos";

/**
 * La entrada de la lista de productos (A1, T1): lo que dice la dirección contra lo que acepta la consulta. Cada filtro pasa solo lo que declara permitido y lo demás devuelve
 * `null` («nada puede coincidir»), nunca un filtro ensanchado.
 */
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const vacia: EntradaDeLaLista = { texto: "", clase: "", estado: "", despues: "" };
const con = (cambios: Partial<EntradaDeLaLista>): EntradaDeLaLista => ({ ...vacia, ...cambios });

describe("leerLaEntradaDeLaLista", () => {
  it("sin nada pedido, la consulta va sin filtros", () => {
    expect(leerLaEntradaDeLaLista(vacia)).toStrictEqual({});
  });

  it("el texto de búsqueda pasa por la primitiva: se recorta y un texto en blanco es «sin filtro»", () => {
    expect(leerLaEntradaDeLaLista(con({ texto: "  mila  " }))).toStrictEqual({ texto: "mila" });
    expect(leerLaEntradaDeLaLista(con({ texto: "   " }))).toStrictEqual({});
  });

  it("un texto que la primitiva rechaza (largo de más, control, signo no permitido) no puede coincidir con ningún nombre", () => {
    expect(leerLaEntradaDeLaLista(con({ texto: "a".repeat(121) }))).toBeNull();
    expect(leerLaEntradaDeLaLista(con({ texto: "mila\u0000" }))).toBeNull();
    expect(leerLaEntradaDeLaLista(con({ texto: "<b>" }))).toBeNull();
    expect(leerLaEntradaDeLaLista(con({ texto: "a".repeat(120) }))).toStrictEqual({
      texto: "a".repeat(120),
    });
  });

  it.each(CLASES_DE_USO)("la clase %s pasa tal cual", (clase) => {
    expect(leerLaEntradaDeLaLista(con({ clase }))).toStrictEqual({ claseDeUso: clase });
  });

  it("una clase que no es una de las cinco (otra, en minúscula, con espacios) no pasa", () => {
    for (const clase of [
      "SERVICIO",
      "vendible",
      " VENDIBLE",
      "VENDIBLE ",
      "__proto__",
      "toString",
    ]) {
      expect(leerLaEntradaDeLaLista(con({ clase }))).toBeNull();
    }
  });

  it("cada estado se pide con sus dos marcas: desactivado manda sobre «falta completar»", () => {
    expect(leerLaEntradaDeLaLista(con({ estado: "ACTIVO" }))).toStrictEqual({
      activo: true,
      faltaCompletar: false,
    });
    expect(leerLaEntradaDeLaLista(con({ estado: "FALTA_COMPLETAR" }))).toStrictEqual({
      activo: true,
      faltaCompletar: true,
    });
    expect(leerLaEntradaDeLaLista(con({ estado: "DESACTIVADO" }))).toStrictEqual({ activo: false });
  });

  it("un estado desconocido no pasa", () => {
    for (const estado of ["activo", "BORRADO", "ACTIVO ", "constructor"]) {
      expect(leerLaEntradaDeLaLista(con({ estado }))).toBeNull();
    }
  });

  it("los filtros se combinan y la página se lleva como `despuesDe`", () => {
    expect(
      leerLaEntradaDeLaLista({
        texto: "pi",
        clase: "VENDIBLE",
        estado: "ACTIVO",
        despues: `${ID}:pizza muzzarella`,
      }),
    ).toStrictEqual({
      texto: "pi",
      claseDeUso: "VENDIBLE",
      activo: true,
      faltaCompletar: false,
      despuesDe: { id: ID, nombreClave: "pizza muzzarella" },
    });
  });

  it("una página que la consulta no pudo dar hace que nada coincida", () => {
    expect(leerLaEntradaDeLaLista(con({ despues: "cualquier cosa" }))).toBeNull();
  });

  it("un solo filtro inválido anula el pedido aunque los demás estén bien", () => {
    expect(leerLaEntradaDeLaLista(con({ texto: "pi", clase: "NADA" }))).toBeNull();
    expect(leerLaEntradaDeLaLista(con({ clase: "VENDIBLE", estado: "NADA" }))).toBeNull();
    expect(leerLaEntradaDeLaLista(con({ estado: "ACTIVO", despues: "x" }))).toBeNull();
  });
});

describe("la clave de la página", () => {
  it("va y vuelve: el id, dos puntos y la clave del nombre (que puede traer dos puntos)", () => {
    const pagina = { id: ID, nombreClave: "salsa: de la casa" };
    expect(codificarLaPagina(pagina)).toBe(`${ID}:salsa: de la casa`);
    expect(leerLaPagina(codificarLaPagina(pagina))).toEqual(pagina);
  });

  it("el id tiene que tener la forma de un uuid (la consulta lo castea en la base)", () => {
    expect(leerLaPagina(`${ID.replace("0", "g")}:harina`)).toBeNull();
    expect(leerLaPagina(`${ID.slice(1)}:harina`)).toBeNull();
    expect(leerLaPagina(`${ID.toUpperCase()}:harina`)).toBeNull();
    // El id va al principio: un id en el medio o con algo antes no vale.
    expect(leerLaPagina(`x${ID}:harina`)).toBeNull();
    expect(leerLaPagina(`${ID}x:harina`)).toBeNull();
  });

  it("después del id va exactamente un `:` y una clave no vacía", () => {
    expect(leerLaPagina(ID)).toBeNull();
    expect(leerLaPagina(`${ID}:`)).toBeNull();
    expect(leerLaPagina(`${ID}-harina`)).toBeNull();
    expect(leerLaPagina(`${ID}:harina`)).toEqual({ id: ID, nombreClave: "harina" });
  });

  it("la clave del nombre pasa por la lista de permitidos y vuelve idéntica: con blancos de más, controles o de largo imposible no", () => {
    expect(leerLaPagina(`${ID}: harina`)).toBeNull();
    expect(leerLaPagina(`${ID}:harina `)).toBeNull();
    expect(leerLaPagina(`${ID}:har\u0000ina`)).toBeNull();
    expect(leerLaPagina(`${ID}:${"a".repeat(121)}`)).toBeNull();
    expect(leerLaPagina(`${ID}:café con leche`)).toEqual({ id: ID, nombreClave: "café con leche" });
  });
});

describe("los estados del filtro", () => {
  it("son los tres del módulo, en el orden de la lista", () => {
    expect([...ESTADOS_DE_PRODUCTO]).toEqual(["ACTIVO", "FALTA_COMPLETAR", "DESACTIVADO"]);
  });
});
