import { describe, expect, it } from "vitest";
import { CATALOGO_DE_PERILLAS, type DefinicionDePerilla } from "./perillas";
import {
  LIMITE_MAXIMO_DE_PERILLA,
  apagado,
  esValorDeLaPerilla,
  estaEncendida,
  valorBaseDe,
  valorDeAjuste,
} from "./valores";

const interruptor: DefinicionDePerilla = {
  ambito: "EMPRESA",
  tipo: "INTERRUPTOR",
  base: { encendida: true },
  modulo: "administracion",
};
const tope: DefinicionDePerilla = {
  ambito: "EMPRESA",
  tipo: "LIMITE",
  base: { limite: 3 },
  modulo: "administracion",
};

describe("valorBaseDe: el estándar con su etiqueta", () => {
  it("un interruptor trae su estado; un límite, su tope", () => {
    expect(valorBaseDe(interruptor)).toEqual({ tipo: "INTERRUPTOR", encendida: true });
    expect(valorBaseDe({ ...interruptor, base: { encendida: false } })).toEqual({
      tipo: "INTERRUPTOR",
      encendida: false,
    });
    expect(valorBaseDe(tope)).toEqual({ tipo: "LIMITE", limite: 3 });
    expect(valorBaseDe({ ...tope, base: { limite: "ILIMITADO" } })).toEqual({
      tipo: "LIMITE",
      limite: "ILIMITADO",
    });
  });

  it("la perilla real: empresas_por_tenant vale 1", () => {
    expect(valorBaseDe(CATALOGO_DE_PERILLAS.empresas_por_tenant)).toEqual({
      tipo: "LIMITE",
      limite: 1,
    });
  });
});

describe("esValorDeLaPerilla: forma y tipo", () => {
  it("el máximo es el de la base (nueve cifras)", () => {
    expect(LIMITE_MAXIMO_DE_PERILLA).toBe(999_999_999);
  });

  it("un interruptor acepta un booleano; un límite, un entero 0..máximo o ILIMITADO", () => {
    expect(esValorDeLaPerilla(interruptor, { tipo: "INTERRUPTOR", encendida: true })).toBe(true);
    expect(esValorDeLaPerilla(interruptor, { tipo: "INTERRUPTOR", encendida: false })).toBe(true);
    for (const l of [0, 1, 42, LIMITE_MAXIMO_DE_PERILLA, "ILIMITADO"]) {
      expect(esValorDeLaPerilla(tope, { tipo: "LIMITE", limite: l })).toBe(true);
    }
  });

  it("rechaza lo que no es objeto", () => {
    for (const valor of [null, undefined, 1, "INTERRUPTOR", true, []]) {
      expect(esValorDeLaPerilla(interruptor, valor)).toBe(false);
      expect(esValorDeLaPerilla(tope, valor)).toBe(false);
    }
  });

  it("rechaza el tipo equivocado y la etiqueta ausente", () => {
    expect(esValorDeLaPerilla(interruptor, { tipo: "LIMITE", limite: 1 })).toBe(false);
    expect(esValorDeLaPerilla(tope, { tipo: "INTERRUPTOR", encendida: true })).toBe(false);
    expect(esValorDeLaPerilla(interruptor, { encendida: true })).toBe(false);
    expect(esValorDeLaPerilla(tope, { limite: 1 })).toBe(false);
  });

  it("el interruptor exige un booleano de verdad (no 1, no texto)", () => {
    for (const encendida of [1, 0, "true", null, undefined]) {
      expect(esValorDeLaPerilla(interruptor, { tipo: "INTERRUPTOR", encendida })).toBe(false);
    }
    expect(esValorDeLaPerilla(interruptor, { tipo: "INTERRUPTOR" })).toBe(false);
  });

  it("el límite rechaza negativos, decimales, NaN, infinitos, pasarse del máximo y texto", () => {
    for (const l of [
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      LIMITE_MAXIMO_DE_PERILLA + 1,
      "5",
      "ilimitado",
      null,
      undefined,
    ]) {
      expect(esValorDeLaPerilla(tope, { tipo: "LIMITE", limite: l })).toBe(false);
    }
    expect(esValorDeLaPerilla(tope, { tipo: "LIMITE" })).toBe(false);
  });
});

describe("estaEncendida y apagado", () => {
  it("un interruptor vale lo que dice; un límite está encendido si es mayor que 0 o ILIMITADO", () => {
    expect(estaEncendida({ tipo: "INTERRUPTOR", encendida: true })).toBe(true);
    expect(estaEncendida({ tipo: "INTERRUPTOR", encendida: false })).toBe(false);
    expect(estaEncendida({ tipo: "LIMITE", limite: 0 })).toBe(false);
    expect(estaEncendida({ tipo: "LIMITE", limite: 1 })).toBe(true);
    expect(estaEncendida({ tipo: "LIMITE", limite: "ILIMITADO" })).toBe(true);
  });

  it("apagado deja el interruptor en falso y el límite en 0, y conserva el resto", () => {
    expect(apagado({ tipo: "INTERRUPTOR", encendida: true, origen: "PLAN" })).toEqual({
      tipo: "INTERRUPTOR",
      encendida: false,
      origen: "PLAN",
    });
    expect(apagado({ tipo: "LIMITE", limite: "ILIMITADO", origen: "AJUSTE" })).toEqual({
      tipo: "LIMITE",
      limite: 0,
      origen: "AJUSTE",
    });
    expect(estaEncendida(apagado({ tipo: "LIMITE", limite: 7 }))).toBe(false);
  });

  it("no modifica el valor recibido", () => {
    const original = Object.freeze({ tipo: "INTERRUPTOR", encendida: true } as const);
    expect(apagado(original)).not.toBe(original);
    expect(original.encendida).toBe(true);
  });
});

describe("valorDeAjuste: el texto que guarda la base, como valor de su perilla", () => {
  it("DEL_PLAN vale para cualquier perilla", () => {
    expect(valorDeAjuste(interruptor, "DEL_PLAN")).toBe("DEL_PLAN");
    expect(valorDeAjuste(tope, "DEL_PLAN")).toBe("DEL_PLAN");
  });

  it("un interruptor: 0 apagado, 1 encendido; todo lo demás no es un valor de interruptor", () => {
    expect(valorDeAjuste(interruptor, "0")).toEqual({ tipo: "INTERRUPTOR", encendida: false });
    expect(valorDeAjuste(interruptor, "1")).toEqual({ tipo: "INTERRUPTOR", encendida: true });
    for (const texto of ["2", "10", "01", "-1", "", " 1", "1 ", "true", "ILIMITADO", "dEL_PLAN"]) {
      expect(valorDeAjuste(interruptor, texto), texto).toBeNull();
    }
  });

  it("un límite: ILIMITADO, o un entero de 0 a 999999999 sin ceros a la izquierda", () => {
    expect(valorDeAjuste(tope, "ILIMITADO")).toEqual({ tipo: "LIMITE", limite: "ILIMITADO" });
    expect(valorDeAjuste(tope, "0")).toEqual({ tipo: "LIMITE", limite: 0 });
    expect(valorDeAjuste(tope, "1")).toEqual({ tipo: "LIMITE", limite: 1 });
    expect(valorDeAjuste(tope, "25")).toEqual({ tipo: "LIMITE", limite: 25 });
    expect(valorDeAjuste(tope, "999999999")).toEqual({
      tipo: "LIMITE",
      limite: LIMITE_MAXIMO_DE_PERILLA,
    });
  });

  it("un límite rechaza lo que no es un entero canónico o se pasa del máximo", () => {
    for (const texto of [
      "1000000000",
      "00",
      "01",
      "-1",
      "1.5",
      "1e3",
      "+1",
      "",
      " 1",
      "1 ",
      "1\n",
      "\n1",
      "ilimitado",
      "Ilimitado",
      "x1",
      "1x",
    ]) {
      expect(valorDeAjuste(tope, texto), JSON.stringify(texto)).toBeNull();
    }
  });

  it("lo que devuelve siempre es un valor bien formado de la perilla (o DEL_PLAN)", () => {
    for (const definicion of [interruptor, tope]) {
      for (const texto of ["0", "1", "7", "ILIMITADO", "DEL_PLAN", "999999999", "2"]) {
        const valor = valorDeAjuste(definicion, texto);
        if (valor !== null && valor !== "DEL_PLAN") {
          expect(esValorDeLaPerilla(definicion, valor), `${definicion.tipo} ${texto}`).toBe(true);
        }
      }
    }
  });
});
