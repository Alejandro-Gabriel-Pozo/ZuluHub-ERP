import { describe, expect, it } from "vitest";
import { err, ok } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  ERRORES_DE_DOMINIO_POR_RESTRICCION,
  ERRORES_DE_MARCAS_POR_RESTRICCION,
  RESTRICCIONES_DE_DISPARADORES_DE_DOMINIO,
  RESTRICCIONES_DE_DISPARADORES_DE_MARCAS,
} from "./esquema";
import {
  errorDeDominioDeRestriccion,
  errorDeMarcaDeRestriccion,
  traducirErroresDeDominio,
  traducirErroresDeMarca,
} from "./traducir";

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

describe("el mapa de restricciones de marca y de versión de marca", () => {
  it("los nombres de los disparadores son distintos y están en el mapa", () => {
    const lista: readonly string[] = RESTRICCIONES_DE_DISPARADORES_DE_MARCAS;
    expect(new Set(lista).size).toBe(lista.length);
    for (const nombre of lista)
      expect(Object.hasOwn(ERRORES_DE_MARCAS_POR_RESTRICCION, nombre)).toBe(true);
  });

  it("todo motivo del mapa es MAYÚSCULAS_CON_GUION_BAJO o NO_TRADUCIDA", () => {
    for (const [restriccion, codigo] of Object.entries(ERRORES_DE_MARCAS_POR_RESTRICCION)) {
      expect(codigo, restriccion).toMatch(/^[A-Z][A-Z_]*[A-Z]$/);
    }
  });

  it("los motivos con datos que la base no tiene no se traducen (el dominio puro los decide antes)", () => {
    const m = ERRORES_DE_MARCAS_POR_RESTRICCION;
    expect(m.version_de_marca_tema_ck).toBe("NO_TRADUCIDA"); // TEMA_INVALIDO { token }
    expect(m.version_de_marca_aspecto_ck).toBe("NO_TRADUCIDA"); // ASPECTO_INVALIDO { token }
    expect(m.version_de_marca_vocabulario_ck).toBe("NO_TRADUCIDA"); // TEXTO_INVALIDO { texto, motivo }
    expect(m.version_de_marca_modulos_ck).toBe("NO_TRADUCIDA"); // MODULO_DESCONOCIDO { modulo }
  });

  it("los motivos que el usuario puede provocar con una carrera o una acción fuera de turno", () => {
    const m = ERRORES_DE_MARCAS_POR_RESTRICCION;
    expect(m.marca_codigo_uk).toBe("CODIGO_DE_MARCA_OCUPADO");
    expect(m.marca_padre_retirada).toBe("MARCA_PADRE_RETIRADA");
    expect(m.marca_marca_padre_id_fkey).toBe("MARCA_PADRE_NO_ENCONTRADA");
    expect(m.version_de_marca_borrador_uk).toBe("VERSION_DESACTUALIZADA");
    expect(m.version_de_marca_marca_retirada).toBe("MARCA_RETIRADA");
    expect(m.version_de_marca_vigencia_ck).toBe("VIGENCIA_RETROACTIVA");
  });
});

describe("errorDeMarcaDeRestriccion y traducirErroresDeMarca", () => {
  for (const [restriccion, codigo] of Object.entries(ERRORES_DE_MARCAS_POR_RESTRICCION)) {
    it(`${restriccion} → ${codigo}`, () => {
      for (const tipo of ["Unicidad", "Superposicion", "Referencia", "Check"] as const) {
        expect(errorDeMarcaDeRestriccion({ tipo, restriccion })).toBe(
          codigo === "NO_TRADUCIDA" ? null : codigo,
        );
      }
    });
  }

  it("sin nombre, con uno desconocido, del prototipo, de otro mapa o con otro tipo de error no hay traducción", () => {
    expect(errorDeMarcaDeRestriccion(check(null))).toBeNull();
    expect(errorDeMarcaDeRestriccion(check("no_existe"))).toBeNull();
    expect(errorDeMarcaDeRestriccion(check("constructor"))).toBeNull();
    expect(errorDeMarcaDeRestriccion(check("__proto__"))).toBeNull();
    // una de dominio no se traduce con el mapa de marcas, y a la inversa
    expect(errorDeMarcaDeRestriccion(unicidad("dominio_host_uk"))).toBeNull();
    expect(errorDeDominioDeRestriccion(unicidad("marca_codigo_uk"))).toBeNull();
    expect(errorDeMarcaDeRestriccion({ tipo: "AccesoDenegado" })).toBeNull();
    expect(errorDeMarcaDeRestriccion({ tipo: "ConcurrenciaAgotada" })).toBeNull();
    expect(
      errorDeMarcaDeRestriccion({
        tipo: "Inesperado",
        sqlstate: "XX000",
        mensaje: "marca_codigo_uk",
      }),
    ).toBeNull();
  });

  const admitidos = ["CODIGO_DE_MARCA_OCUPADO", "MARCA_RETIRADA"] as const;

  it("una restricción admitida se vuelve el motivo; la no admitida, la que no tiene motivo y el resto salen tal cual", () => {
    expect(traducirErroresDeMarca(err(unicidad("marca_codigo_uk")), admitidos)).toEqual(
      err("CODIGO_DE_MARCA_OCUPADO"),
    );
    expect(
      traducirErroresDeMarca(err(check("version_de_marca_marca_retirada")), admitidos),
    ).toEqual(err("MARCA_RETIRADA"));
    const noAdmitida = err(check("marca_codigo_ck"));
    expect(traducirErroresDeMarca(noAdmitida, admitidos)).toBe(noAdmitida);
    const sinMotivo = err(check("marca_inmutable"));
    expect(traducirErroresDeMarca(sinMotivo, admitidos)).toBe(sinMotivo);
    const exito = ok(1);
    expect(traducirErroresDeMarca(exito, admitidos)).toBe(exito);
    const negocio = err("SIN_PERMISO" as const);
    expect(traducirErroresDeMarca(negocio, admitidos)).toBe(negocio);
    const otro = err({ tipo: "ConcurrenciaAgotada" } as const);
    expect(traducirErroresDeMarca(otro, admitidos)).toBe(otro);
    expect(traducirErroresDeMarca(err(unicidad("marca_codigo_uk")), [])).toEqual(
      err(unicidad("marca_codigo_uk")),
    );
  });
});
