import { describe, expect, it } from "vitest";
import { err, ok } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  ERRORES_DE_PLANES_POR_RESTRICCION,
  RESTRICCIONES_DE_DISPARADORES_DE_PLANES,
} from "./esquema";
import { errorDePlanesDeRestriccion, traducirErroresDePlanes } from "./traducir";

const check = (restriccion: string | null): ErrorDePersistencia => ({ tipo: "Check", restriccion });
const unicidad = (restriccion: string | null): ErrorDePersistencia => ({
  tipo: "Unicidad",
  restriccion,
});

describe("el mapa de restricciones de planes", () => {
  it("los nombres de los disparadores son distintos y están en el mapa", () => {
    const lista: readonly string[] = RESTRICCIONES_DE_DISPARADORES_DE_PLANES;
    expect(new Set(lista).size).toBe(lista.length);
    for (const nombre of lista)
      expect(Object.hasOwn(ERRORES_DE_PLANES_POR_RESTRICCION, nombre)).toBe(true);
  });

  it("todo motivo del mapa es MAYÚSCULAS_CON_GUION_BAJO o NO_TRADUCIDA", () => {
    for (const [restriccion, codigo] of Object.entries(ERRORES_DE_PLANES_POR_RESTRICCION)) {
      expect(codigo, restriccion).toMatch(/^[A-Z][A-Z_]*[A-Z]$/);
    }
  });

  it("los números consecutivos son el numeroEsperado hecho restricción: VERSION_DESACTUALIZADA", () => {
    const m = ERRORES_DE_PLANES_POR_RESTRICCION;
    expect(m.plan_de_tenant_numero_uk).toBe("VERSION_DESACTUALIZADA");
    expect(m.plan_de_tenant_numero_invalido).toBe("VERSION_DESACTUALIZADA");
    expect(m.ajuste_de_perilla_numero_uk).toBe("VERSION_DESACTUALIZADA");
    expect(m.ajuste_de_perilla_numero_invalido).toBe("VERSION_DESACTUALIZADA");
    expect(m.version_de_plan_borrador_uk).toBe("VERSION_DESACTUALIZADA");
  });

  it("los motivos con datos que la base no tiene no se traducen (el dominio puro los decide antes)", () => {
    const m = ERRORES_DE_PLANES_POR_RESTRICCION;
    expect(m.ajuste_de_perilla_valor_ck).toBe("NO_TRADUCIDA"); // VALOR_DE_PERILLA_INVALIDO { perilla }
    expect(m.version_de_plan_perillas_ck).toBe("NO_TRADUCIDA");
    expect(m.version_de_plan_modulos_ck).toBe("NO_TRADUCIDA"); // MODULO_DESCONOCIDO { modulo }
    expect(m.modulo_de_empresa_modulo_ck).toBe("NO_TRADUCIDA");
  });

  it("publicar mientras se asigna: la base rechaza la asignación de una versión que no está publicada", () => {
    expect(ERRORES_DE_PLANES_POR_RESTRICCION.plan_de_tenant_version_no_publicada).toBe(
      "VERSION_DE_PLAN_NO_PUBLICADA",
    );
  });
});

describe("errorDePlanesDeRestriccion", () => {
  for (const [restriccion, codigo] of Object.entries(ERRORES_DE_PLANES_POR_RESTRICCION)) {
    it(`${restriccion} → ${codigo}`, () => {
      for (const tipo of ["Unicidad", "Superposicion", "Referencia", "Check"] as const) {
        expect(errorDePlanesDeRestriccion({ tipo, restriccion })).toBe(
          codigo === "NO_TRADUCIDA" ? null : codigo,
        );
      }
    });
  }

  it("sin nombre, con uno desconocido, del prototipo o con otro tipo de error no hay traducción", () => {
    expect(errorDePlanesDeRestriccion(check(null))).toBeNull();
    expect(errorDePlanesDeRestriccion(check("no_existe"))).toBeNull();
    expect(errorDePlanesDeRestriccion(check("constructor"))).toBeNull();
    expect(errorDePlanesDeRestriccion(check("__proto__"))).toBeNull();
    expect(errorDePlanesDeRestriccion(unicidad("dominio_host_uk"))).toBeNull();
    expect(errorDePlanesDeRestriccion({ tipo: "AccesoDenegado" })).toBeNull();
    expect(errorDePlanesDeRestriccion({ tipo: "ConcurrenciaAgotada" })).toBeNull();
    expect(
      errorDePlanesDeRestriccion({
        tipo: "Inesperado",
        sqlstate: "XX000",
        mensaje: "plan_de_tenant_numero_uk",
      }),
    ).toBeNull();
  });
});

describe("traducirErroresDePlanes", () => {
  const admitidos = ["VERSION_DESACTUALIZADA", "VIGENCIA_RETROACTIVA"] as const;

  it("un éxito y un error de negocio pasan sin cambios", () => {
    const exito = ok(3);
    expect(traducirErroresDePlanes(exito, admitidos)).toBe(exito);
    const negocio = err("SIN_PERMISO" as const);
    expect(traducirErroresDePlanes(negocio, admitidos)).toBe(negocio);
    const objeto = err({ codigo: "OTRO" as const, tipo: "Otro" as const });
    expect(traducirErroresDePlanes(objeto, admitidos)).toBe(objeto);
  });

  it("una restricción admitida se vuelve el motivo", () => {
    expect(traducirErroresDePlanes(err(unicidad("plan_de_tenant_numero_uk")), admitidos)).toEqual(
      err("VERSION_DESACTUALIZADA"),
    );
    expect(traducirErroresDePlanes(err(check("ajuste_de_perilla_vigencia_ck")), admitidos)).toEqual(
      err("VIGENCIA_RETROACTIVA"),
    );
  });

  it("la que tiene motivo pero el caso de uso no admite, la que no tiene motivo y el resto salen tal cual", () => {
    const noAdmitida = err(check("plan_de_tenant_motivo_ck"));
    expect(traducirErroresDePlanes(noAdmitida, admitidos)).toBe(noAdmitida);
    const sinMotivo = err(unicidad("plan_pkey"));
    expect(traducirErroresDePlanes(sinMotivo, admitidos)).toBe(sinMotivo);
    for (const error of [
      { tipo: "AccesoDenegado" },
      { tipo: "ConcurrenciaAgotada" },
      { tipo: "Inesperado", sqlstate: "XX000", mensaje: "x" },
    ] as const) {
      const original = err(error);
      expect(traducirErroresDePlanes(original, admitidos)).toBe(original);
    }
    const original = err(unicidad("plan_de_tenant_numero_uk"));
    expect(traducirErroresDePlanes(original, [])).toBe(original);
  });
});
