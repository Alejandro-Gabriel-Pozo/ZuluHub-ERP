import { describe, expect, it } from "vitest";
import {
  NIVEL_POR_DEFECTO,
  NIVELES_DE_CONTROL,
  esNivelDeControl,
  leerNivelGuardado,
  resolverNivel,
  type NivelDeControl,
} from "./nivel";

const guardado = [null, ...NIVELES_DE_CONTROL] as const;

describe("NIVELES_DE_CONTROL", () => {
  it("son solo permitir y avisar (ADR-008 opción b), en orden de menos a más exigente", () => {
    expect(NIVELES_DE_CONTROL).toEqual(["PERMITIR", "AVISAR"]);
  });

  it("por defecto se permite (el negocio no se frena sin que el gerente lo pida)", () => {
    expect(NIVEL_POR_DEFECTO).toBe("PERMITIR");
  });
});

describe("esNivelDeControl", () => {
  it.each(NIVELES_DE_CONTROL)("acepta %s", (nivel) => {
    expect(esNivelDeControl(nivel)).toBe(true);
  });

  it.each(["", "permitir", "Avisar", "BLOQUEAR", "NINGUNO", "constructor", "toString"])(
    "rechaza %j",
    (texto) => {
      expect(esNivelDeControl(texto)).toBe(false);
    },
  );
});

describe("resolverNivel", () => {
  const regido = (
    disponibleEnElPlan: boolean,
    nivelDeLaEmpresa: NivelDeControl | null,
    nivelDeLaSucursal: NivelDeControl | null,
  ) => resolverNivel({ disponibleEnElPlan, nivelDeLaEmpresa, nivelDeLaSucursal });

  it("sin nada guardado rige PERMITIR", () => {
    expect(regido(true, null, null)).toBe("PERMITIR");
  });

  it("el nivel de la empresa rige cuando la sucursal no dice nada", () => {
    expect(regido(true, "AVISAR", null)).toBe("AVISAR");
    expect(regido(true, "PERMITIR", null)).toBe("PERMITIR");
  });

  it("la sucursal puede endurecer el nivel de la empresa", () => {
    expect(regido(true, "PERMITIR", "AVISAR")).toBe("AVISAR");
    expect(regido(true, null, "AVISAR")).toBe("AVISAR");
  });

  it("la sucursal no puede aflojar el nivel de la empresa: empresa AVISAR + sucursal PERMITIR → AVISAR", () => {
    expect(regido(true, "AVISAR", "PERMITIR")).toBe("AVISAR");
  });

  it("el mismo nivel en los dos es ese nivel", () => {
    for (const nivel of NIVELES_DE_CONTROL) expect(regido(true, nivel, nivel)).toBe(nivel);
  });

  it("matriz completa: disponibilidad × empresa × sucursal", () => {
    const rigor = { PERMITIR: 0, AVISAR: 1 } as const;
    for (const empresa of guardado) {
      for (const sucursal of guardado) {
        // No disponible en el plan: PERMITIR, diga lo que diga lo guardado.
        expect(regido(false, empresa, sucursal), `plan sin control ${empresa} ${sucursal}`).toBe(
          "PERMITIR",
        );
        const esperado = Math.max(rigor[empresa ?? "PERMITIR"], rigor[sucursal ?? "PERMITIR"]);
        expect(rigor[regido(true, empresa, sucursal)], `${empresa} ${sucursal}`).toBe(esperado);
      }
    }
  });
});

describe("leerNivelGuardado", () => {
  it("sin valor es PERMITIR y los dos niveles se leen tal cual", () => {
    expect(leerNivelGuardado(null)).toBe("PERMITIR");
    expect(leerNivelGuardado("PERMITIR")).toBe("PERMITIR");
    expect(leerNivelGuardado("AVISAR")).toBe("AVISAR");
  });

  it.each(["BLOQUEAR", "", "permitir", "constructor", "NINGUNO"])(
    "un valor desconocido (%j) se lee como AVISAR: ni se habilita en silencio ni se bloquea",
    (texto) => {
      expect(leerNivelGuardado(texto)).toBe("AVISAR");
    },
  );
});
