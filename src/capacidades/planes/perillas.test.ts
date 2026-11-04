import { describe, expect, expectTypeOf, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import {
  CATALOGO_DE_PERILLAS,
  type AmbitoDePerilla,
  type ClavePerilla,
  type DefinicionDePerilla,
} from "./perillas";

/**
 * El catálogo de perillas (marcas y planes, §B.5.1). Trae `empresas_por_tenant` y las seis de catálogo y stock. Las
 * reglas de forma se fijan acá y valen para las que sume cada módulo: son las mismas que la base repite
 * en `ajuste_de_perilla` (clave y valor).
 */

const FORMATO_DE_CLAVE = /^[a-z][a-z0-9_.]{1,63}$/;
const AMBITOS: readonly AmbitoDePerilla[] = ["TENANT", "EMPRESA", "SUCURSAL"];
/** El mayor límite que admite la base: `^(0|[1-9][0-9]{0,8}|ILIMITADO)$`. */
const LIMITE_MAXIMO = 999_999_999;

/** Los problemas de una definición, o una lista vacía si está bien. */
function problemasDe(
  clave: string,
  d: DefinicionDePerilla,
  catalogo: Readonly<Record<string, DefinicionDePerilla>>,
): string[] {
  const p: string[] = [];
  if (!FORMATO_DE_CLAVE.test(clave)) p.push("clave mal formada");
  if (!AMBITOS.includes(d.ambito)) p.push("ámbito desconocido");
  if (!Object.hasOwn(CATALOGO_DE_MODULOS, d.modulo)) p.push("módulo inexistente");
  if (d.tipo === "INTERRUPTOR") {
    if (typeof d.base.encendida !== "boolean") p.push("base de interruptor inválida");
  } else {
    const l = d.base.limite;
    const entero = typeof l === "number" && Number.isInteger(l) && l >= 0 && l <= LIMITE_MAXIMO;
    if (l !== "ILIMITADO" && !entero) p.push("base de límite inválida");
  }
  if (d.requiere !== undefined) {
    if (d.requiere === clave) p.push("se requiere a sí misma");
    else if (!Object.hasOwn(catalogo, d.requiere)) p.push("requiere una perilla inexistente");
  }
  return p;
}

/** ¿Hay un ciclo en los `requiere`? (Cada perilla requiere a lo sumo una.) */
function tieneCiclo(catalogo: Readonly<Record<string, DefinicionDePerilla>>): boolean {
  for (const inicio of Object.keys(catalogo)) {
    const visto = new Set<string>();
    let actual: string | undefined = inicio;
    while (actual !== undefined) {
      if (visto.has(actual)) return true;
      visto.add(actual);
      actual = catalogo[actual]?.requiere;
    }
  }
  return false;
}

const entradas = Object.entries(CATALOGO_DE_PERILLAS) as [string, DefinicionDePerilla][];
const catalogoComoTabla: Readonly<Record<string, DefinicionDePerilla>> = CATALOGO_DE_PERILLAS;

describe("el catálogo de perillas real", () => {
  it("trae siete perillas: empresas_por_tenant (de administración) y seis de catálogo y stock, todas interruptores de empresa apagados", () => {
    expect(CATALOGO_DE_PERILLAS).toEqual({
      empresas_por_tenant: {
        ambito: "TENANT",
        tipo: "LIMITE",
        base: { limite: 1 },
        modulo: "administracion",
      },
      composiciones_con_perdida: {
        ambito: "EMPRESA",
        tipo: "INTERRUPTOR",
        base: { encendida: false },
        modulo: "stock",
      },
      subcomposiciones: {
        ambito: "EMPRESA",
        tipo: "INTERRUPTOR",
        base: { encendida: false },
        modulo: "stock",
      },
      variantes_y_grupos_de_precio: {
        ambito: "EMPRESA",
        tipo: "INTERRUPTOR",
        base: { encendida: false },
        modulo: "catalogo",
      },
      conjuntos: {
        ambito: "EMPRESA",
        tipo: "INTERRUPTOR",
        base: { encendida: false },
        modulo: "catalogo",
      },
      elecciones_reutilizables: {
        ambito: "EMPRESA",
        tipo: "INTERRUPTOR",
        base: { encendida: false },
        modulo: "catalogo",
      },
      composiciones_por_tamano: {
        ambito: "EMPRESA",
        tipo: "INTERRUPTOR",
        base: { encendida: false },
        modulo: "stock",
      },
    });
  });

  it("la clave es un tipo cerrado: una perilla mal escrita no compila", () => {
    expectTypeOf<ClavePerilla>().toEqualTypeOf<
      | "empresas_por_tenant"
      | "composiciones_con_perdida"
      | "subcomposiciones"
      | "variantes_y_grupos_de_precio"
      | "conjuntos"
      | "elecciones_reutilizables"
      | "composiciones_por_tamano"
    >();
    // @ts-expect-error esa perilla no está declarada (la registra el módulo que la verifica)
    const inventada: ClavePerilla = "cajas_por_sucursal";
    expect(inventada in CATALOGO_DE_PERILLAS).toBe(false);
  });

  it("las de la carta no se declaran hasta construir la carta: ni vidriera_por_qr ni las de fotos, modelos y estadísticas", () => {
    for (const clave of [
      "vidriera_por_qr",
      "productos_con_foto",
      "fotos_alojadas",
      "vidriera_modelo_cuadricula",
      "vidriera_modelo_libro",
      "vidriera_modelo_tablero",
      "vidriera_estadisticas",
    ]) {
      expect(Object.hasOwn(CATALOGO_DE_PERILLAS, clave), clave).toBe(false);
    }
  });

  it("cada perilla la verifica el módulo que la nombra: las de recetas, stock; las de elecciones, catálogo", () => {
    const duenos = Object.fromEntries(
      Object.entries(catalogoComoTabla).map(([clave, d]) => [clave, d.modulo]),
    );
    expect(duenos).toEqual({
      empresas_por_tenant: "administracion",
      composiciones_con_perdida: "stock",
      subcomposiciones: "stock",
      variantes_y_grupos_de_precio: "catalogo",
      conjuntos: "catalogo",
      elecciones_reutilizables: "catalogo",
      composiciones_por_tamano: "stock",
    });
  });

  it.each(entradas)("%s: definición bien formada", (clave, definicion) => {
    expect(problemasDe(clave, definicion, catalogoComoTabla)).toEqual([]);
  });

  it("no hay ciclos entre los `requiere`", () => {
    expect(tieneCiclo(catalogoComoTabla)).toBe(false);
  });
});

describe("las reglas del catálogo de perillas (con la violación inyectada)", () => {
  const sana: DefinicionDePerilla = {
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: false },
    modulo: "administracion",
  };
  const conOtras = (extra: Record<string, DefinicionDePerilla> = {}) => ({
    sana,
    ...extra,
  });

  it("una definición sana no tiene problemas", () => {
    expect(problemasDe("sana", sana, conOtras())).toEqual([]);
    expect(
      problemasDe("tope", { ...sana, tipo: "LIMITE", base: { limite: "ILIMITADO" } }, conOtras()),
    ).toEqual([]);
    expect(
      problemasDe("tope", { ...sana, tipo: "LIMITE", base: { limite: 0 } }, conOtras()),
    ).toEqual([]);
    expect(
      problemasDe("tope", { ...sana, tipo: "LIMITE", base: { limite: LIMITE_MAXIMO } }, conOtras()),
    ).toEqual([]);
  });

  it.each([["Mayuscula"], ["con espacio"], ["a"], ["1numero"], ["x".repeat(65)], [""]])(
    "clave mal formada: %j",
    (clave) => {
      expect(problemasDe(clave, sana, conOtras())).toEqual(["clave mal formada"]);
    },
  );

  it("ámbito desconocido, módulo inexistente", () => {
    expect(problemasDe("x_x", { ...sana, ambito: "PLANETA" } as never, conOtras())).toEqual([
      "ámbito desconocido",
    ]);
    expect(problemasDe("x_x", { ...sana, modulo: "ventas" } as never, conOtras())).toEqual([
      "módulo inexistente",
    ]);
  });

  it.each([[-1], [1.5], [LIMITE_MAXIMO + 1], [Number.NaN], ["muchos"]])(
    "base de límite inválida: %j",
    (limite) => {
      const d = { ...sana, tipo: "LIMITE", base: { limite } } as never;
      expect(problemasDe("x_x", d, conOtras())).toEqual(["base de límite inválida"]);
    },
  );

  it("base de interruptor inválida", () => {
    const d = { ...sana, base: { encendida: 1 } } as never;
    expect(problemasDe("x_x", d, conOtras())).toEqual(["base de interruptor inválida"]);
  });

  it("requiere: otra perilla que existe pasa; a sí misma o inexistente, no", () => {
    expect(problemasDe("x_x", { ...sana, requiere: "sana" }, conOtras())).toEqual([]);
    expect(problemasDe("x_x", { ...sana, requiere: "x_x" }, conOtras())).toEqual([
      "se requiere a sí misma",
    ]);
    expect(problemasDe("x_x", { ...sana, requiere: "fantasma" }, conOtras())).toEqual([
      "requiere una perilla inexistente",
    ]);
  });

  it("un ciclo entre perillas se detecta", () => {
    const a: DefinicionDePerilla = { ...sana, requiere: "b" };
    const b: DefinicionDePerilla = { ...sana, requiere: "a" };
    expect(tieneCiclo({ a, b })).toBe(true);
    expect(tieneCiclo({ a: { ...sana }, b: { ...sana, requiere: "a" } })).toBe(false);
    expect(tieneCiclo({ a: { ...sana, requiere: "a" } })).toBe(true);
  });
});
