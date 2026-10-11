import { describe, expect, it } from "vitest";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { err, ok } from "../../../primitivas/resultado/resultado";
import { ERRORES_DE_IDENTIDAD_POR_RESTRICCION } from "../persistencia/esquema";
import { errorDeNegocioDeRestriccion, esErrorDePersistencia, traducirErrores } from "./traducir";

const unicidad = (restriccion: string | null): ErrorDePersistencia => ({
  tipo: "Unicidad",
  restriccion,
});

describe("esErrorDePersistencia", () => {
  it("reconoce los errores de la base y no los de negocio", () => {
    expect(esErrorDePersistencia({ tipo: "AccesoDenegado" })).toBe(true);
    expect(esErrorDePersistencia(unicidad("x"))).toBe(true);
    expect(esErrorDePersistencia("SIN_PERMISO")).toBe(false);
    expect(esErrorDePersistencia({ codigo: "EMPRESA_NO_OPERA", empresaId: "e" })).toBe(false);
    expect(esErrorDePersistencia(null)).toBe(false);
    expect(esErrorDePersistencia(undefined)).toBe(false);
  });
});

describe("errorDeNegocioDeRestriccion: TODA restricción del mapa tiene su traducción", () => {
  const tipos = ["Unicidad", "Superposicion", "Referencia", "Check"] as const;

  for (const [restriccion, codigo] of Object.entries(ERRORES_DE_IDENTIDAD_POR_RESTRICCION)) {
    it(`${restriccion} → ${codigo}`, () => {
      for (const tipo of tipos) {
        expect(errorDeNegocioDeRestriccion({ tipo, restriccion })).toBe(
          codigo === "NO_TRADUCIDA" ? null : codigo,
        );
      }
    });
  }

  it("sin nombre de restricción, con una desconocida o con otro tipo de error no hay traducción", () => {
    expect(errorDeNegocioDeRestriccion(unicidad(null))).toBeNull();
    expect(errorDeNegocioDeRestriccion(unicidad("restriccion_que_no_existe"))).toBeNull();
    expect(errorDeNegocioDeRestriccion(unicidad("constructor"))).toBeNull();
    expect(errorDeNegocioDeRestriccion({ tipo: "AccesoDenegado" })).toBeNull();
    expect(errorDeNegocioDeRestriccion({ tipo: "ConcurrenciaAgotada" })).toBeNull();
    expect(
      errorDeNegocioDeRestriccion({
        tipo: "Inesperado",
        sqlstate: "XX000",
        mensaje: "membresia_pkey",
      }),
    ).toBeNull();
  });
});

describe("traducirErrores", () => {
  const admitidos = ["YA_ES_MIEMBRO", "INVITACION_VENCIDA"] as const;

  it("un éxito pasa sin cambios", () => {
    const exito = ok(3);
    expect(traducirErrores(exito, admitidos)).toBe(exito);
  });

  it("un error de negocio (texto u objeto) pasa sin cambios", () => {
    const texto = err("SIN_PERMISO" as const);
    expect(traducirErrores(texto, admitidos)).toBe(texto);
    const objeto = err({ codigo: "EMPRESA_NO_OPERA" as const, empresaId: "e" });
    expect(traducirErrores(objeto, admitidos)).toBe(objeto);
  });

  it("una restricción admitida se vuelve el error de negocio", () => {
    expect(traducirErrores(err(unicidad("membresia_pkey")), admitidos)).toEqual(
      err("YA_ES_MIEMBRO"),
    );
    expect(
      traducirErrores(
        err({ tipo: "Check", restriccion: "invitacion_aceptada_a_tiempo_ck" } as const),
        admitidos,
      ),
    ).toEqual(err("INVITACION_VENCIDA"));
  });

  it("una restricción con traducción pero no admitida por el caso de uso sale tal cual (tipada)", () => {
    const original = err(unicidad("membresia_gerente_uk"));
    expect(traducirErrores(original, admitidos)).toBe(original);
    const sinTraduccion = err(unicidad("invitacion_pkey"));
    expect(traducirErrores(sinTraduccion, admitidos)).toBe(sinTraduccion);
  });

  it("los errores de la base que no son restricciones salen tal cual", () => {
    for (const error of [
      { tipo: "AccesoDenegado" },
      { tipo: "ConcurrenciaAgotada" },
      { tipo: "Inesperado", sqlstate: "XX000", mensaje: "x" },
    ] as const) {
      const original = err(error);
      expect(traducirErrores(original, admitidos)).toBe(original);
    }
  });

  it("sin códigos admitidos nunca traduce", () => {
    const original = err(unicidad("membresia_pkey"));
    expect(traducirErrores(original, [])).toBe(original);
  });
});
