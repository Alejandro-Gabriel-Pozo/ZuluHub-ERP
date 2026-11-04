import { describe, expect, it } from "vitest";
import { huellaDe } from "./guardian-apoyo";
import {
  comparar,
  type ContratoDePrueba,
  type DetectorDePrueba,
  type SalidaDeComparar,
} from "./guardian-mutantes-a-apoyo";

/**
 * Comportamiento exacto de `comparacion.cjs` (declaración contra uso real): qué archivos se leen, cómo se
 * recorta el texto de un hallazgo, qué devuelve un detector válido y qué mensaje da uno inválido, y en qué
 * orden salen las cosas. Los contratos y los detectores son sintéticos: devuelven lo que la prueba necesita.
 */

const FUENTE = "src/u/f.ts";
const REGISTRO = "arquitectura/contratos/contratos.cjs";
const ARCHIVO = "src/u/a.ts";
const CORRECCION_INVALIDO =
  "Corregí el detector: tiene que devolver [{linea, texto}] con líneas reales (desde 1).";

const detector = (
  tipo: string,
  clases: string[],
  reconoce: (texto: string, ruta: string) => unknown,
  nombre?: string,
): DetectorDePrueba => ({ tipo, clases, reconoce, ...(nombre === undefined ? {} : { nombre }) });

/** Un detector de uso que marca TODAS las líneas del archivo. */
const todasLasLineas = (clases: string[] = ["frontend"], nombre?: string): DetectorDePrueba =>
  detector(
    "uso",
    clases,
    (texto) => texto.split(/\r\n|\n/).map((_, indice) => ({ linea: indice + 1 })),
    nombre,
  );

const contrato = (
  deteccion: DetectorDePrueba[],
  cambios: Partial<ContratoDePrueba> = {},
): ContratoDePrueba => ({
  id: "c1",
  fuenteDeVerdad: { archivo: FUENTE, exportacion: "fuente" },
  deteccion,
  bloqueaDeclaracionFalsa: true,
  ...cambios,
});

type Entrada = {
  contratos: ContratoDePrueba[];
  /** Ruta → clase, en el orden en que entran al mapa de rutas clasificadas. */
  clases: Record<string, string>;
  /** Ruta → contenido. La fuente de verdad (`FUENTE`) ya está. */
  archivos?: Record<string, string>;
  declaraciones?: Record<string, { usa: string[]; noUsa: string | null }>;
  clasesExcluidas?: string[];
  rutasExcluidas?: string[];
};

function correr(entrada: Entrada): SalidaDeComparar & { leidas: string[] } {
  const archivos: Record<string, string> = {
    [FUENTE]: "export const fuente = 1;",
    ...entrada.archivos,
  };
  const leidas: string[] = [];
  const registro = {
    contratos: entrada.contratos,
    porId: new Map(entrada.contratos.map((c) => [c.id, c])),
  };
  const salida = comparar({
    registro,
    porRuta: new Map(Object.entries(entrada.clases)),
    rutas: new Set(Object.keys(archivos)),
    leer: (ruta) => {
      leidas.push(ruta);
      return archivos[ruta] ?? null;
    },
    declaraciones: new Map(
      Object.entries(entrada.declaraciones ?? { "src/u": { usa: ["z"], noUsa: null } }),
    ),
    clasesExcluidas: new Set(entrada.clasesExcluidas ?? []),
    rutasExcluidas: new Set(entrada.rutasExcluidas ?? []),
  });
  return { ...salida, leidas };
}

describe("comparación: archivos binarios", () => {
  it("se omiten si de verdad son binarios (por su contenido); el resto se escanea aunque el nombre se les parezca", () => {
    const binarios = [
      "png",
      "jpg",
      "jpeg",
      "webp",
      "gif",
      "ico",
      "heic",
      "woff",
      "woff2",
      "ttf",
      "otf",
      "pdf",
      "zip",
    ].map((extension) => `src/u/b.${extension}`);
    const escaneados = ["src/u/archivo-png", "src/u/c.png.txt", "src/u/d.pngx"];
    const salida = correr({
      contratos: [contrato([todasLasLineas()])],
      clases: Object.fromEntries(
        [...binarios, "src/u/MAYUS.PNG", ...escaneados].map((ruta) => [ruta, "frontend"]),
      ),
      archivos: {
        // Un binario de verdad tiene bytes nulos: la extensión conocida lo deja afuera del análisis.
        ...Object.fromEntries([...binarios, "src/u/MAYUS.PNG"].map((ruta) => [ruta, "\u0000PNG"])),
        ...Object.fromEntries(escaneados.map((ruta) => [ruta, "texto"])),
      },
    });
    expect(salida.omitidasPorClase).toEqual({ frontend: 14 });
    expect(salida.escaneadasPorClase).toEqual({ frontend: 3 });
    expect(salida.noAnalizablesPorClase).toEqual({});
    // Se leen todos (la extensión sola no alcanza para saltear un archivo), en orden de ruta.
    expect(salida.leidas.filter((ruta) => ruta !== FUENTE)).toEqual(
      [...binarios, "src/u/MAYUS.PNG", ...escaneados].sort(),
    );
    expect(salida.fallas).toEqual([]);
  });

  it("una clase sin detectores, o excluida, no se lee", () => {
    const salida = correr({
      contratos: [contrato([todasLasLineas(["backend"])])],
      clases: { "src/u/a.css": "frontend", "src/u/b.ts": "backend", "src/u/c.ts": "backend" },
      archivos: { "src/u/a.css": "x", "src/u/b.ts": "x", "src/u/c.ts": "x" },
      rutasExcluidas: ["src/u/c.ts"],
    });
    expect(salida.leidas.filter((ruta) => ruta !== FUENTE)).toEqual(["src/u/b.ts"]);
    expect(salida.escaneadasPorClase).toEqual({ backend: 1 });
  });
});

describe("comparación: el texto de un hallazgo", () => {
  it("se recorta a 120 caracteres con «…» y se le sacan los espacios de los extremos", () => {
    const lineas = [
      "  hola  ",
      "x".repeat(120),
      "y".repeat(121),
      `  ${"z".repeat(118)}  `,
      `${"w".repeat(130)}`,
    ];
    const salida = correr({
      contratos: [contrato([todasLasLineas()])],
      clases: { [ARCHIVO]: "frontend" },
      archivos: { [ARCHIVO]: lineas.join("\n") },
    });
    expect(salida.fallas).toEqual([]);
    expect(salida.hallazgos.map((h) => [h.linea, h.texto])).toEqual([
      [1, "hola"],
      [2, "x".repeat(120)],
      [3, `${"y".repeat(120)}…`],
      [4, "z".repeat(118)],
      [5, `${"w".repeat(120)}…`],
    ]);
    expect(salida.hallazgos.map((h) => h.huella)).toEqual(lineas.map(huellaDe));
  });

  it("el hallazgo lleva contrato, archivo, unidad y el motivo con su texto", () => {
    const salida = correr({
      contratos: [contrato([todasLasLineas()])],
      clases: { [ARCHIVO]: "frontend" },
      archivos: { [ARCHIVO]: "  uso real  " },
    });
    expect(salida.hallazgos).toEqual([
      {
        contrato: "c1",
        archivo: ARCHIVO,
        linea: 1,
        huella: huellaDe("uso real"),
        texto: "uso real",
        unidad: "src/u",
        codigo: "uso-sin-declarar",
        motivo: "La unidad «src/u» usa el contrato «c1» (uso real) y no lo declara.",
        correccion: `Agregá «c1» a "usa" en src/u/contratos.json, o eliminá el uso. Si fuera una excepción aprobada y con vencimiento: contrato «c1», huella ${huellaDe("uso real")}.`,
      },
    ]);
  });
});

describe("comparación: la fuente de verdad", () => {
  it.each([
    ["export const ab = 1;", false],
    ["const x = a.b;", true],
    ["xa.b", false],
    ["a.bx", false],
    ["$a.b", false],
    ["a.b_", false],
    ["(a.b)", true],
  ])("la exportación «a.b» en «%s»: %s", (contenido, menciona) => {
    const salida = correr({
      contratos: [
        contrato([todasLasLineas()], { fuenteDeVerdad: { archivo: FUENTE, exportacion: "a.b" } }),
      ],
      clases: {},
      archivos: { [FUENTE]: contenido },
    });
    expect(salida.fallas).toEqual(
      menciona
        ? []
        : [
            {
              codigo: "contrato-sin-fuente",
              archivo: FUENTE,
              contrato: "c1",
              motivo:
                "El archivo existe pero no contiene «a.b», la fuente de verdad que declara el contrato «c1».",
              correccion: `Definí «a.b» en ${FUENTE} o corregí la fuente en el registro.`,
              donde: { tipo: "archivo" },
            },
          ],
    );
  });

  it("la exportación con otros metacaracteres también se busca literal", () => {
    const registro = (exportacion: string, contenido: string) =>
      correr({
        contratos: [
          contrato([todasLasLineas()], { fuenteDeVerdad: { archivo: FUENTE, exportacion } }),
        ],
        clases: {},
        archivos: { [FUENTE]: contenido },
      }).fallas.length;
    expect(registro("f(x)", "f(x)")).toBe(0);
    expect(registro("f(x)", "fx")).toBe(1);
    expect(registro("a*b", "a*b")).toBe(0);
    expect(registro("a*b", "aab")).toBe(1);
  });
});

describe("comparación: un detector que devuelve algo inválido", () => {
  const CONTENIDO = "a\nb\nc";
  const fuera = (visto: string): string =>
    `devolvió una línea fuera del archivo (tiene 3 líneas): ${visto}`;

  it.each([
    ["un texto", "x", "devolvió algo que no es una lista"],
    ["un objeto", { linea: 1 }, "devolvió algo que no es una lista"],
    ["null", null, "devolvió algo que no es una lista"],
    ["undefined", undefined, "devolvió algo que no es una lista"],
    ["un null en la lista", [null], fuera("null")],
    ["un undefined en la lista", [undefined], fuera("undefined")],
    ["un número en la lista", [3], fuera("3")],
    ["un texto en la lista", ["1"], fuera('"1"')],
    ["una línea que es texto", [{ linea: "1" }], fuera('{"linea":"1"}')],
    ["una línea fraccionaria", [{ linea: 1.5 }], fuera('{"linea":1.5}')],
    ["una coincidencia sin línea", [{}], fuera("{}")],
    ["la línea 0", [{ linea: 0 }], fuera('{"linea":0}')],
    ["una línea negativa", [{ linea: -1 }], fuera('{"linea":-1}')],
    ["una línea después de la última", [{ linea: 4 }], fuera('{"linea":4}')],
    ["una válida y otra fuera", [{ linea: 1 }, { linea: 9 }], fuera('{"linea":9}')],
  ])("%s", (_nombre, devuelve, problema) => {
    const salida = correr({
      contratos: [
        contrato([todasLasLineas(["config"]), detector("uso", ["frontend"], () => devuelve)]),
      ],
      clases: { [ARCHIVO]: "frontend" },
      archivos: { [ARCHIVO]: CONTENIDO },
    });
    expect(salida.fallas).toEqual([
      {
        codigo: "detector-invalido",
        archivo: REGISTRO,
        contrato: "c1",
        motivo: `El detector 2 del contrato «c1» ${problema} (en «${ARCHIVO}»).`,
        correccion: CORRECCION_INVALIDO,
        donde: { tipo: "texto", texto: 'id: "c1"' },
      },
    ]);
    expect(salida.hallazgos).toEqual([]);
  });

  it.each([
    [1, 1],
    [3, 3],
  ])("la línea %i de un archivo de 3 líneas es válida", (linea, esperada) => {
    const salida = correr({
      contratos: [contrato([detector("uso", ["frontend"], () => [{ linea }])])],
      clases: { [ARCHIVO]: "frontend" },
      archivos: { [ARCHIVO]: CONTENIDO },
    });
    expect(salida.fallas).toEqual([]);
    expect(salida.hallazgos.map((h) => [h.linea, h.texto])).toEqual([
      [esperada, CONTENIDO.split("\n")[esperada - 1]],
    ]);
  });

  it("el archivo con CRLF cuenta sus líneas igual", () => {
    const salida = correr({
      contratos: [contrato([detector("uso", ["frontend"], () => [{ linea: 3 }])])],
      clases: { [ARCHIVO]: "frontend" },
      archivos: { [ARCHIVO]: "a\r\nb\r\nc" },
    });
    expect(salida.hallazgos.map((h) => [h.linea, h.texto])).toEqual([[3, "c"]]);
  });
});

describe("comparación: un detector que lanza un error", () => {
  it.each([
    ["un Error", new Error("se rompió"), "se rompió"],
    ["un texto", "texto suelto", "texto suelto"],
    ["null", null, "null"],
    ["undefined", undefined, "undefined"],
    ["un número", 42, "42"],
    ["un objeto con mensaje", { message: "del objeto" }, "del objeto"],
  ])(
    "dice el detector, el contrato, la ruta y el motivo cuando lanza %s",
    (_nombre, lanzado, texto) => {
      const salida = correr({
        contratos: [
          contrato([
            todasLasLineas(["config"]),
            detector("uso", ["frontend"], () => {
              // eslint-disable-next-line @typescript-eslint/only-throw-error -- el detector puede lanzar cualquier cosa
              throw lanzado;
            }),
          ]),
        ],
        clases: { [ARCHIVO]: "frontend" },
        archivos: { [ARCHIVO]: "x" },
      });
      expect(salida.fallas).toEqual([
        {
          codigo: "detector-invalido",
          archivo: REGISTRO,
          contrato: "c1",
          motivo: `El detector 2 del contrato «c1» lanzó un error con «${ARCHIVO}»: ${texto}.`,
          correccion:
            "Corregí el detector: tiene que ser una función pura que no falla con ningún archivo.",
          donde: { tipo: "texto", texto: 'id: "c1"' },
        },
      ]);
    },
  );
});

describe("comparación: las reglas ejecutadas", () => {
  it("un detector sin nombre se llama «detector N» con su posición desde 1", () => {
    const salida = correr({
      contratos: [
        contrato([
          todasLasLineas(["frontend"], "uno"),
          detector("definicion", ["config", "docs"], () => []),
          todasLasLineas(["backend"]),
        ]),
      ],
      clases: {},
    });
    expect(salida.reglas).toEqual([
      { contrato: "c1", detector: "uno", tipo: "uso", clases: ["frontend"] },
      { contrato: "c1", detector: "detector 2", tipo: "definicion", clases: ["config", "docs"] },
      { contrato: "c1", detector: "detector 3", tipo: "uso", clases: ["backend"] },
    ]);
  });
});

describe("comparación: el orden de salida", () => {
  it("las rutas se recorren ordenadas por texto, sin importar el orden de entrada", () => {
    const salida = correr({
      contratos: [contrato([todasLasLineas()])],
      clases: {
        "src/u/z.ts": "frontend",
        "src/u/b.ts": "frontend",
        "src/u/m.ts": "frontend",
        "src/u/a.ts": "frontend",
      },
      archivos: { "src/u/z.ts": "1", "src/u/b.ts": "1", "src/u/m.ts": "1", "src/u/a.ts": "1" },
    });
    expect(salida.hallazgos.map((h) => h.archivo)).toEqual([
      "src/u/a.ts",
      "src/u/b.ts",
      "src/u/m.ts",
      "src/u/z.ts",
    ]);
  });

  it("«-» va antes que «/»: la carpeta «a-b» se recorre antes que «a»", () => {
    const salida = correr({
      contratos: [contrato([todasLasLineas()])],
      clases: { "src/a/x.ts": "frontend", "src/a-b/x.ts": "frontend", "src/A/x.ts": "frontend" },
    });
    expect(salida.fallas.map((f) => [f.codigo, f.archivo, f.motivo])).toEqual([
      ["ruta-ilegible", "src/A/x.ts", "No se pudo leer el archivo para analizarlo."],
      ["ruta-ilegible", "src/a-b/x.ts", "No se pudo leer el archivo para analizarlo."],
      ["ruta-ilegible", "src/a/x.ts", "No se pudo leer el archivo para analizarlo."],
    ]);
  });
});

describe("comparación: hallazgos repetidos", () => {
  it("la misma línea del mismo contrato y tipo cuenta una sola vez, y una definición aparte", () => {
    const salida = correr({
      contratos: [
        contrato([
          detector("uso", ["frontend"], () => [{ linea: 1 }, { linea: 1 }]),
          detector("uso", ["frontend"], () => [{ linea: 1 }]),
          detector("definicion", ["frontend"], () => [{ linea: 1 }]),
        ]),
      ],
      clases: { [ARCHIVO]: "frontend" },
      archivos: { [ARCHIVO]: "x" },
    });
    expect(salida.fallas).toEqual([]);
    expect(salida.hallazgos.map((h) => [h.codigo, h.archivo, h.linea])).toEqual([
      ["definicion-fuera-de-la-fuente", ARCHIVO, 1],
      ["uso-sin-declarar", ARCHIVO, 1],
    ]);
  });
});
