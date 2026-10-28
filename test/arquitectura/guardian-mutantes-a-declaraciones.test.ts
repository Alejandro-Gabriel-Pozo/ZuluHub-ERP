import { describe, expect, it } from "vitest";
import { descubrirUnidades, leerDeclaraciones, unidadDe } from "./guardian-mutantes-a-apoyo";

/**
 * Comportamiento exacto de `declaraciones.cjs`: a qué unidad pertenece cada ruta (incluidos los bordes de
 * profundidad), cómo se ordenan las unidades y qué dice cada falla de una declaración mal armada.
 */

const EJEMPLO =
  '{ "usa": [], "noUsa": "Motivo por el que la unidad no depende de ningún contrato." }';
const UNIDAD = "apps/web";
const ARCHIVO = "apps/web/contratos.json";

describe("unidadDe: los bordes de profundidad", () => {
  it.each([
    ["src/modulos/fiscal/x.ts", "src/modulos/fiscal"],
    ["src/modulos/fiscal/dominio/x.ts", "src/modulos/fiscal"],
    ["src/modulos/fiscal", null],
    ["src/modulos/x.ts", null],
    ["src/modulos", null],
    ["src/primitivas/x.ts", "src/primitivas"],
    ["src/primitivas", null],
    ["src/suelto.ts", null],
    ["src", null],
    ["apps/web/x.ts", "apps/web"],
    ["apps/web", null],
    ["apps", null],
    ["scripts/x.ts", "scripts"],
    ["migraciones/0001.sql", "migraciones"],
    ["workers/x.ts", "workers"],
    ["scripts", null],
    ["migraciones", null],
    ["workers", null],
    ["otra/carpeta/x.ts", null],
  ])("«%s» pertenece a %j", (ruta, unidad) => {
    expect(unidadDe(ruta)).toBe(unidad);
  });
});

describe("descubrirUnidades: orden y contenido", () => {
  it("las unidades salen ordenadas por texto y las rutas de cada una también", () => {
    const unidades = descubrirUnidades([
      "src/capacidades-b/y.ts",
      "src/capacidades/z.ts",
      "scripts/b.ts",
      "src/capacidades/a.ts",
      "apps/web/x.ts",
      "package.json",
      "src/capacidades/m.ts",
      "scripts/a.ts",
      "src/modulos/fiscal/c.ts",
      "src/modulos/fiscal/b.ts",
      "src/suelto.ts",
    ]);
    expect([...unidades.entries()]).toEqual([
      ["apps/web", ["apps/web/x.ts"]],
      ["scripts", ["scripts/a.ts", "scripts/b.ts"]],
      ["src/capacidades", ["src/capacidades/a.ts", "src/capacidades/m.ts", "src/capacidades/z.ts"]],
      ["src/capacidades-b", ["src/capacidades-b/y.ts"]],
      ["src/modulos/fiscal", ["src/modulos/fiscal/b.ts", "src/modulos/fiscal/c.ts"]],
    ]);
  });

  it("sin rutas de unidades no hay unidades", () => {
    expect([...descubrirUnidades(["package.json", "test/a.test.ts"]).entries()]).toEqual([]);
  });
});

/** Lee la declaración de `apps/web` con el texto dado; `idsDeContratos` por omisión es `{a, b}`. */
function leer(contenido: string | null, idsDeContratos: Set<string> | null = new Set(["a", "b"])) {
  return leerDeclaraciones(new Map([[UNIDAD, ["apps/web/x.ts"]]]), {
    rutas: new Set(contenido === null ? [] : [ARCHIVO]),
    leer: () => contenido,
    idsDeContratos,
  });
}

const invalida = (motivo: string, camino: (string | number)[]) => ({
  codigo: "declaracion-invalida",
  archivo: ARCHIVO,
  contrato: null,
  motivo: `La declaración de «${UNIDAD}» es inválida: ${motivo}.`,
  correccion: `Dejala con la forma ${EJEMPLO}`,
  donde: { tipo: "json", camino },
});

describe("leerDeclaraciones: lo que dice cada falla", () => {
  it("una unidad sin archivo de declaración dice qué crear", () => {
    const { fallas, declaraciones } = leer(null);
    expect(fallas).toEqual([
      {
        codigo: "unidad-sin-declaracion",
        archivo: ARCHIVO,
        contrato: null,
        motivo: "La unidad «apps/web» no tiene declaración de contratos.",
        correccion: `Creá ${ARCHIVO} con ${EJEMPLO} (o listá en "usa" los contratos que usa).`,
        donde: { tipo: "archivo" },
      },
    ]);
    expect(declaraciones.size).toBe(0);
  });

  it("un archivo que no es JSON se rechaza con ese motivo y nada más", () => {
    expect(leer("{ no es json").fallas).toEqual([invalida("no es JSON válido", [])]);
    expect(leer("").fallas).toEqual([invalida("no es JSON válido", [])]);
  });

  it.each(["[]", '["usa"]', "null", "5", '"texto"', "true"])(
    "el JSON %s no es un objeto",
    (contenido) => {
      const { fallas, declaraciones } = leer(contenido);
      expect(fallas).toEqual([invalida("tiene que ser un objeto", [])]);
      expect(declaraciones.size).toBe(0);
    },
  );

  it("un campo de más se señala con su nombre", () => {
    expect(leer('{ "usa": ["a"], "extra": 1 }').fallas).toEqual([
      invalida("«extra» no es un campo permitido (usa, noUsa)", ["extra"]),
    ]);
  });

  it("un objeto vacío pide declarar al menos uno de los dos campos", () => {
    expect(leer("{}").fallas).toEqual([
      invalida("falta «usa» o «noUsa»: hay que declarar al menos uno", []),
    ]);
  });

  it("solo «noUsa» con motivo es una declaración válida", () => {
    const { fallas, declaraciones } = leer('{ "noUsa": "No usa contratos." }');
    expect(fallas).toEqual([]);
    expect([...declaraciones.entries()]).toEqual([
      [UNIDAD, { usa: [], noUsa: "No usa contratos." }],
    ]);
  });

  it.each(['{ "usa": "a" }', '{ "usa": [1] }', '{ "usa": ["a", ""] }', '{ "usa": ["a", " "] }'])(
    "«usa» que no es una lista de ids (%s)",
    (contenido) => {
      expect(leer(contenido).fallas).toEqual([
        invalida("«usa» tiene que ser una lista de ids de contrato", ["usa"]),
      ]);
    },
  );

  it("«usa» con un id repetido se rechaza", () => {
    expect(leer('{ "usa": ["a", "b", "a"] }').fallas).toEqual([
      invalida("«usa» repite un contrato", ["usa"]),
    ]);
  });

  it.each(['{ "noUsa": "" }', '{ "noUsa": "  " }', '{ "noUsa": 5 }'])(
    "«noUsa» que no es un motivo escrito (%s)",
    (contenido) => {
      expect(leer(contenido).fallas).toEqual([
        invalida("«noUsa» tiene que ser un motivo escrito, no vacío", ["noUsa"]),
      ]);
    },
  );

  it("«usa» vacío sin «noUsa» pide el motivo", () => {
    expect(leer('{ "usa": [] }').fallas).toEqual([
      invalida(
        "«usa» está vacío y falta «noUsa»: una unidad sin contratos tiene que explicar por qué",
        ["usa"],
      ),
    ]);
  });

  it("«usa» con ids y «noUsa» a la vez son excluyentes", () => {
    expect(leer('{ "usa": ["a"], "noUsa": "motivo" }').fallas).toEqual([
      invalida("declara contratos en «usa» y también «noUsa»: son excluyentes", ["noUsa"]),
    ]);
  });

  it("varios problemas salen todos, en el orden en que se encuentran", () => {
    expect(leer('{ "usa": [], "noUsa": "", "otro": true }').fallas).toEqual([
      invalida("«otro» no es un campo permitido (usa, noUsa)", ["otro"]),
      invalida("«noUsa» tiene que ser un motivo escrito, no vacío", ["noUsa"]),
    ]);
  });

  it("un id de «usa» que no está en el registro se señala con su posición", () => {
    const { fallas, declaraciones } = leer('{ "usa": ["a", "nada", "b"] }');
    expect(fallas).toEqual([
      {
        codigo: "declara-contrato-inexistente",
        archivo: ARCHIVO,
        contrato: "nada",
        motivo:
          "La unidad «apps/web» declara usar «nada», que no está en el registro de contratos.",
        correccion: "Quitá el id de «usa» o corregí su nombre.",
        donde: { tipo: "json", camino: ["usa", 1] },
      },
    ]);
    expect(declaraciones.get(UNIDAD)).toEqual({ usa: ["a", "nada", "b"], noUsa: null });
  });

  it("sin registro cargado (ids nulos) no se comprueba que los ids existan", () => {
    const { fallas, declaraciones } = leer('{ "usa": ["lo-que-sea"] }', null);
    expect(fallas).toEqual([]);
    expect(declaraciones.get(UNIDAD)).toEqual({ usa: ["lo-que-sea"], noUsa: null });
  });
});
