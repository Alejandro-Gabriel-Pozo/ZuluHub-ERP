import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import { tenantId } from "../../primitivas/identificadores/marca";
import { derechosDeUso, type AjusteDePerilla } from "./derechos";
import { funcionesEncendidasDe, modulosConInterruptores } from "./funciones-encendidas";
import type { ValorEfectivo } from "./valores";
import { CATALOGO_DE_PERILLAS, type DefinicionDePerilla } from "./perillas";

const CATALOGO_DE_MENTIRA = {
  zeta: { ambito: "EMPRESA", tipo: "INTERRUPTOR", base: { encendida: false }, modulo: "salon" },
  alfa: { ambito: "EMPRESA", tipo: "INTERRUPTOR", base: { encendida: true }, modulo: "stock" },
  tope: { ambito: "EMPRESA", tipo: "LIMITE", base: { limite: 5 }, modulo: "caja" },
} as const satisfies Readonly<Record<string, DefinicionDePerilla>>;

function derechosDe(ajustes: readonly AjusteDePerilla[] = []) {
  return derechosDeUso({
    catalogoDeModulos: CATALOGO_DE_MODULOS,
    catalogoDePerillas: CATALOGO_DE_MENTIRA,
    tenantId: tenantId("t-1"),
    empresaId: null,
    versionDePlan: null,
    ajustes,
    ahora: new Date(0),
  });
}

describe("modulosConInterruptores", () => {
  it("son los módulos dueños de un interruptor; un límite no cuenta", () => {
    expect([...modulosConInterruptores(CATALOGO_DE_MENTIRA)].sort()).toEqual(["salon", "stock"]);
  });
  it("con el catálogo real, salón figura y administración (solo límite) no", () => {
    const modulos = modulosConInterruptores(CATALOGO_DE_PERILLAS);
    expect(modulos.has("salon")).toBe(true);
    expect(modulos.has("administracion")).toBe(false);
  });
});

describe("funcionesEncendidasDe", () => {
  it("devuelve solo los interruptores encendidos, ordenados, sin los límites", () => {
    expect(funcionesEncendidasDe(CATALOGO_DE_MENTIRA, derechosDe())).toEqual(["alfa"]);
  });
  it("un ajuste que enciende o apaga cambia el resultado", () => {
    const ajuste = (perilla: string, encendida: boolean): AjusteDePerilla => ({
      perilla,
      empresaId: null,
      numero: 1,
      vigenteDesde: new Date(0),
      valor: { tipo: "INTERRUPTOR", encendida },
    });
    expect(funcionesEncendidasDe(CATALOGO_DE_MENTIRA, derechosDe([ajuste("zeta", true)]))).toEqual([
      "alfa",
      "zeta",
    ]);
    expect(funcionesEncendidasDe(CATALOGO_DE_MENTIRA, derechosDe([ajuste("alfa", false)]))).toEqual(
      [],
    );
  });
  it("con una perilla que los derechos no traen es un defecto: lanza, no inventa", () => {
    const sinPerillas: ReadonlyMap<keyof typeof CATALOGO_DE_MENTIRA, ValorEfectivo> = new Map();
    expect(() => funcionesEncendidasDe(CATALOGO_DE_MENTIRA, { perillas: sinPerillas })).toThrow(
      RangeError,
    );
  });
});
