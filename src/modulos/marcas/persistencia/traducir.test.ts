import { describe, expect, it } from "vitest";
import { err, ok } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  ERRORES_DE_DOMINIO_POR_RESTRICCION,
  RESTRICCIONES_DE_DISPARADORES_DE_DOMINIO,
} from "./esquema";
import { errorDeDominioDeRestriccion, traducirErroresDeDominio } from "./traducir";

const check = (restriccion: string | null): ErrorDePersistencia => ({ tipo: "Check", restriccion });
const unicidad = (restriccion: string | null): ErrorDePersistencia => ({
  tipo: "Unicidad",
  restriccion,
});

describe("el mapa de restricciones de dominio", () => {
  it("los nombres de los disparadores son distintos, están en el mapa y los que traducen un motivo del usuario no son NO_TRADUCIDA", () => {
    const lista: readonly string[] = RESTRICCIONES_DE_DISPARADORES_DE_DOMINIO;
    expect(new Set(lista).size).toBe(lista.length);
    for (const nombre of lista)
      expect(Object.hasOwn(ERRORES_DE_DOMINIO_POR_RESTRICCION, nombre)).toBe(true);
    // Las siete que el usuario puede provocar con una carrera o una acción fuera de turno.
    const m = ERRORES_DE_DOMINIO_POR_RESTRICCION;
    expect(m.dominio_host_uk).toBe("HOST_DUPLICADO");
    expect(m.dominio_canonico_uk).toBe("YA_TIENE_CANONICO");
    expect(m.dominio_transicion_invalida).toBe("TRANSICION_DE_DOMINIO_INVALIDA");
    expect(m.dominio_verificacion_inmutable).toBe("FECHA_DE_VERIFICACION_INMUTABLE");
    expect(m.dominio_retirado_inmutable).toBe("DOMINIO_RETIRADO");
    expect(m.dominio_canonico_no_se_retira).toBe("DOMINIO_CANONICO");
    expect(m.dominio_marca_retirada).toBe("MARCA_RETIRADA");
  });

  it("todo motivo del mapa es MAYÚSCULAS_CON_GUION_BAJO o NO_TRADUCIDA", () => {
    for (const [restriccion, codigo] of Object.entries(ERRORES_DE_DOMINIO_POR_RESTRICCION)) {
      expect(codigo, restriccion).toMatch(/^[A-Z][A-Z_]*[A-Z]$/);
    }
  });
});

describe("errorDeDominioDeRestriccion", () => {
  for (const [restriccion, codigo] of Object.entries(ERRORES_DE_DOMINIO_POR_RESTRICCION)) {
    it(`${restriccion} → ${codigo}`, () => {
      for (const tipo of ["Unicidad", "Superposicion", "Referencia", "Check"] as const) {
        expect(errorDeDominioDeRestriccion({ tipo, restriccion })).toBe(
          codigo === "NO_TRADUCIDA" ? null : codigo,
        );
      }
    });
  }

  it("sin nombre de restricción, con una desconocida o con otro tipo de error no hay traducción", () => {
    expect(errorDeDominioDeRestriccion(check(null))).toBeNull();
    expect(errorDeDominioDeRestriccion(check("restriccion_que_no_existe"))).toBeNull();
    // Nombres que existen en el prototipo de cualquier objeto no son restricciones.
    expect(errorDeDominioDeRestriccion(check("constructor"))).toBeNull();
    expect(errorDeDominioDeRestriccion(check("toString"))).toBeNull();
    expect(errorDeDominioDeRestriccion(check("__proto__"))).toBeNull();
    expect(errorDeDominioDeRestriccion({ tipo: "AccesoDenegado" })).toBeNull();
    expect(errorDeDominioDeRestriccion({ tipo: "ConcurrenciaAgotada" })).toBeNull();
    expect(
      errorDeDominioDeRestriccion({
        tipo: "Inesperado",
        sqlstate: "XX000",
        mensaje: "dominio_host_uk",
      }),
    ).toBeNull();
  });
});

describe("traducirErroresDeDominio", () => {
  const admitidos = ["HOST_DUPLICADO", "DOMINIO_CANONICO"] as const;

  it("un éxito pasa sin cambios", () => {
    const exito = ok(3);
    expect(traducirErroresDeDominio(exito, admitidos)).toBe(exito);
  });

  it("un error de negocio (texto u objeto) pasa sin cambios", () => {
    const texto = err("SIN_PERMISO" as const);
    expect(traducirErroresDeDominio(texto, admitidos)).toBe(texto);
    const objeto = err({ codigo: "OTRO" as const, tipo: "Otro" as const });
    expect(traducirErroresDeDominio(objeto, admitidos)).toBe(objeto);
  });

  it("una restricción admitida se vuelve el motivo", () => {
    expect(traducirErroresDeDominio(err(unicidad("dominio_host_uk")), admitidos)).toEqual(
      err("HOST_DUPLICADO"),
    );
    expect(
      traducirErroresDeDominio(err(check("dominio_canonico_no_se_retira")), admitidos),
    ).toEqual(err("DOMINIO_CANONICO"));
  });

  it("una restricción con traducción pero no admitida por el caso de uso sale tal cual (tipada)", () => {
    const original = err(unicidad("dominio_canonico_uk"));
    expect(traducirErroresDeDominio(original, admitidos)).toBe(original);
    const sinTraduccion = err(unicidad("dominio_pkey"));
    expect(traducirErroresDeDominio(sinTraduccion, admitidos)).toBe(sinTraduccion);
  });

  it("los errores de la base que no son restricciones salen tal cual", () => {
    for (const error of [
      { tipo: "AccesoDenegado" },
      { tipo: "ConcurrenciaAgotada" },
      { tipo: "Inesperado", sqlstate: "XX000", mensaje: "x" },
    ] as const) {
      const original = err(error);
      expect(traducirErroresDeDominio(original, admitidos)).toBe(original);
    }
  });

  it("sin códigos admitidos nunca traduce", () => {
    const original = err(unicidad("dominio_host_uk"));
    expect(traducirErroresDeDominio(original, [])).toBe(original);
  });
});
