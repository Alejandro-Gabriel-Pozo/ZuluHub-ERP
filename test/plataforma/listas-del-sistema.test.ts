import { describe, expect, it } from "vitest";
import {
  LISTAS_DE_LA_CONSOLA,
  NOMBRES_DE_LISTAS,
  listaDeLaConsola,
} from "../../apps/plataforma/logica/listas-del-sistema";
import { LISTAS_DEL_SISTEMA } from "../../src/modulos/listas/publico";

describe("listas de la consola", () => {
  it("cada lista de la consola es una lista que existe en el dominio, sin repetirse", () => {
    const delDominio: readonly string[] = LISTAS_DEL_SISTEMA;
    const usadas = Object.values(LISTAS_DE_LA_CONSOLA).map((l) => l.lista);
    for (const lista of usadas) expect(delDominio).toContain(lista);
    expect(new Set(usadas).size).toBe(usadas.length);
    expect([...NOMBRES_DE_LISTAS]).toEqual(Object.keys(LISTAS_DE_LA_CONSOLA));
  });

  it("las marcas de tarjeta están, con el título aprobado", () => {
    expect(listaDeLaConsola("marcas")).toEqual({
      nombre: "marcas",
      lista: "MARCAS_DE_TARJETA",
      titulo: "Marcas de tarjeta",
    });
  });

  it.each(["", "Marcas", "MARCAS", "motivos", "constructor", "toString", "__proto__", 1, null, {}])(
    "un nombre %j que no está en la tabla no es una lista",
    (nombre) => {
      expect(listaDeLaConsola(nombre)).toBeNull();
    },
  );

  it("un objeto que se convierte en «marcas» no es el nombre de una lista (tiene que ser texto)", () => {
    expect(listaDeLaConsola({ toString: () => "marcas" })).toBeNull();
  });
});
