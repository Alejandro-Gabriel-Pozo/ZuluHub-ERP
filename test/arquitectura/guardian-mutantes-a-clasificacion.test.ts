import { describe, expect, it } from "vitest";
import {
  ARCHIVO_DE_REGLAS,
  NIVELES,
  clasificar,
  compilar,
  esRutaExacta,
  porPatron,
  revisarClasesExcluidas,
} from "./guardian-mutantes-a-apoyo";

/**
 * Comportamiento exacto de `clasificacion.cjs`, `globs.cjs` y `detectores.cjs`: el texto de cada nivel y de
 * cada mensaje, el conteo de reglas, la extensión de una ruta y los errores de forma. Complementa a
 * `guardian-clasificacion.test.ts`, que prueba la tabla real contra el repositorio.
 */

const CLASES_EXISTENTES =
  "frontend, backend, migraciones, scripts, workers, generado, docs, config, pruebas";

describe("clasificación: la tabla de niveles", () => {
  it("los ocho niveles de la tabla real, en orden y con su nombre", () => {
    expect(NIVELES.map((nivel) => nivel.nombre)).toEqual([
      "Documentación y archivos generados",
      "Declaración de contratos de cada unidad",
      "Pruebas y sus insumos",
      "Migraciones, scripts y workers",
      "Servidor dentro de las apps",
      "Aplicación web",
      "Código fuente de src",
      "Configuración y herramientas del repositorio",
    ]);
  });

  it("el informe numera los niveles desde 1 y repite el nombre en cada una de sus reglas", () => {
    const niveles = [
      { nombre: "Primero", reglas: [{ clase: "docs", glob: "**/*.md" }] },
      {
        nombre: "Segundo",
        reglas: [
          { clase: "backend", glob: "src/**" },
          { clase: "pruebas", glob: "test/**" },
        ],
      },
      { nombre: "Tercero", reglas: [{ clase: "config", glob: "*.json" }] },
    ];
    expect(clasificar([], { niveles }).reglas).toEqual([
      { nivel: 1, nombreDelNivel: "Primero", clase: "docs", glob: "**/*.md", rutas: 0 },
      { nivel: 2, nombreDelNivel: "Segundo", clase: "backend", glob: "src/**", rutas: 0 },
      { nivel: 2, nombreDelNivel: "Segundo", clase: "pruebas", glob: "test/**", rutas: 0 },
      { nivel: 3, nombreDelNivel: "Tercero", clase: "config", glob: "*.json", rutas: 0 },
    ]);
  });

  it("cada regla cuenta las rutas que calzó, y solo las del nivel que decidió", () => {
    const niveles = [
      { nombre: "A", reglas: [{ clase: "docs", glob: "**/*.md" }] },
      {
        nombre: "B",
        reglas: [
          { clase: "backend", glob: "src/**" },
          { clase: "backend", glob: "src/*.ts" },
          { clase: "pruebas", glob: "test/**" },
        ],
      },
      { nombre: "C", reglas: [{ clase: "config", glob: "**/*.md" }] },
    ];
    const { reglas, fallas, porRuta } = clasificar(
      ["src/a.ts", "src/b.ts", "src/c/d.ts", "LEEME.md", "test/x.ts"],
      { niveles },
    );
    expect(fallas).toEqual([]);
    expect(reglas.map((regla) => [regla.glob, regla.rutas])).toEqual([
      ["**/*.md", 1],
      ["src/**", 3],
      ["src/*.ts", 2],
      ["test/**", 1],
      ["**/*.md", 0],
    ]);
    expect(porRuta.get("LEEME.md")).toBe("docs");
  });

  it("las clases con la tabla real: una ruta de cada nivel cae donde dice", () => {
    const { porRuta, fallas, reglas } = clasificar([
      "package-lock.json",
      "src/modulos/fiscal/contratos.json",
      "test/x.ts",
      "scripts/a.ts",
      "apps/web/servidor/a.ts",
      "apps/web/ui/a.css",
      "src/puertos/a.ts",
      "arquitectura/reglas.cjs",
    ]);
    expect(fallas).toEqual([]);
    expect([...porRuta.entries()]).toEqual([
      ["apps/web/servidor/a.ts", "backend"],
      ["apps/web/ui/a.css", "frontend"],
      ["arquitectura/reglas.cjs", "config"],
      ["package-lock.json", "generado"],
      ["scripts/a.ts", "scripts"],
      ["src/modulos/fiscal/contratos.json", "config"],
      ["src/puertos/a.ts", "backend"],
      ["test/x.ts", "pruebas"],
    ]);
    expect(reglas.filter((regla) => regla.rutas > 0).map((regla) => regla.nivel)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });
});

describe("clasificación: mensajes de falla", () => {
  it("una ruta ambigua dice las clases, el nivel y los globs que calzaron, en ese orden", () => {
    const niveles = [
      {
        nombre: "Mezclado",
        reglas: [
          { clase: "backend", glob: "x/**" },
          { clase: "frontend", glob: "x/*.ts" },
          { clase: "backend", glob: "x/a.ts" },
        ],
      },
    ];
    const { fallas, porRuta, porClase } = clasificar(["x/a.ts"], { niveles });
    expect(fallas).toEqual([
      {
        codigo: "clasificacion-ambigua",
        archivo: "x/a.ts",
        contrato: null,
        motivo:
          "La ruta cae en backend y frontend a la vez dentro del nivel «Mezclado» (x/**, x/*.ts, x/a.ts).",
        correccion: `Separá las reglas en niveles distintos o corregí el glob en ${ARCHIVO_DE_REGLAS}.`,
        donde: { tipo: "archivo" },
      },
    ]);
    expect(porRuta.size).toBe(0);
    expect(porClase["backend"]).toEqual([]);
  });

  it("una ruta sin clase dice qué hacer y no se ignora", () => {
    const { fallas } = clasificar(["suelta.ts"], {
      niveles: [{ nombre: "Único", reglas: [{ clase: "backend", glob: "src/**" }] }],
    });
    expect(fallas).toEqual([
      {
        codigo: "ruta-sin-clase",
        archivo: "suelta.ts",
        contrato: null,
        motivo:
          "La ruta versionada no calza con ninguna clase (frontend, backend, migraciones, scripts, workers, generado, docs, config, pruebas).",
        correccion: `Agregá su regla de clasificación en ${ARCHIVO_DE_REGLAS}; una ruta sin clase no se ignora.`,
        donde: { tipo: "archivo" },
      },
    ]);
  });

  it("una clase que no existe en el nivel 2 dice el número de nivel y las clases válidas", () => {
    const resultado = clasificar(["src/a.ts"], {
      niveles: [
        { nombre: "Bien", reglas: [{ clase: "backend", glob: "src/**" }] },
        { nombre: "Mal", reglas: [{ clase: "nada", glob: "otra/**" }] },
      ],
    });
    expect(resultado.fallas).toEqual([
      {
        codigo: "regla-de-clasificacion-invalida",
        archivo: ARCHIVO_DE_REGLAS,
        contrato: null,
        motivo: `La tabla de clasificación es inválida: nivel 2: la clase «nada» no existe (${CLASES_EXISTENTES}).`,
        correccion: "Corregí la regla en la tabla de clasificación.",
        donde: { tipo: "texto", texto: 'clase: "nada"' },
      },
    ]);
    // Con una tabla rota no se clasifica nada, y las reglas igual se describen sin rutas.
    expect(resultado.porRuta.size).toBe(0);
    expect(resultado.reglas.map((regla) => [regla.nivel, regla.glob, regla.rutas])).toEqual([
      [1, "src/**", 0],
      [2, "otra/**", 0],
    ]);
  });

  it("un glob inválido en el nivel 3 dice el número de nivel y el error del glob", () => {
    const { fallas } = clasificar([], {
      niveles: [
        { nombre: "Uno", reglas: [{ clase: "backend", glob: "src/**" }] },
        { nombre: "Dos", reglas: [{ clase: "backend", glob: "lib/**" }] },
        { nombre: "Tres", reglas: [{ clase: "backend", glob: "a/{b}" }] },
      ],
    });
    expect(fallas).toEqual([
      {
        codigo: "regla-de-clasificacion-invalida",
        archivo: ARCHIVO_DE_REGLAS,
        contrato: null,
        motivo:
          "La tabla de clasificación es inválida: nivel 3: el glob «a/{b}» usa llaves, corchetes, paréntesis, «!» o «\\»: no se soportan.",
        correccion: "Corregí la regla en la tabla de clasificación.",
        donde: { tipo: "texto", texto: 'glob: "a/{b}"' },
      },
    ]);
  });

  it("una regla con clase y glob inválidos informa las dos cosas, en ese orden", () => {
    const { fallas } = clasificar([], {
      niveles: [{ nombre: "Uno", reglas: [{ clase: "nada", glob: "" }] }],
    });
    expect(fallas.map((falla) => [falla.motivo, falla.donde])).toEqual([
      [
        `La tabla de clasificación es inválida: nivel 1: la clase «nada» no existe (${CLASES_EXISTENTES}).`,
        { tipo: "texto", texto: 'clase: "nada"' },
      ],
      [
        "La tabla de clasificación es inválida: nivel 1: el glob está vacío.",
        { tipo: "texto", texto: 'glob: ""' },
      ],
    ]);
  });
});

describe("clasificación: la extensión de una ruta en las clases excluidas", () => {
  it("un archivo que empieza con punto no tiene extensión: «.md» solo no es un documento", () => {
    const fallas = revisarClasesExcluidas({ docs: ["docs/.md", "docs/real.md"], generado: [] });
    expect(fallas).toEqual([
      {
        codigo: "codigo-en-clase-excluida",
        archivo: "docs/.md",
        contrato: null,
        motivo:
          "La ruta no es de un tipo permitido en la clase «docs», que no se analiza (solo .md, .txt).",
        correccion: `Clasificala en la clase que le corresponde en ${ARCHIVO_DE_REGLAS} (la lista de lo permitido en una clase excluida no se amplía).`,
        donde: { tipo: "archivo" },
      },
    ]);
  });

  it("la extensión se compara en minúsculas", () => {
    expect(revisarClasesExcluidas({ docs: ["docs/NOTAS.MD"], generado: [] })).toEqual([]);
    expect(
      revisarClasesExcluidas({ docs: ["docs/App.TS"], generado: [] }).map((f) => f.motivo),
    ).toEqual([
      "La ruta es código («.ts») y quedó en la clase «docs», que no se analiza: el código ejecutable no puede salir del análisis por una regla de clasificación.",
    ]);
  });

  it("un archivo sin punto tiene extensión vacía", () => {
    const permitidoPorClase = { docs: { extensiones: [""], rutas: [] } };
    expect(
      revisarClasesExcluidas({ docs: ["docs/LEEME"] }, { excluibles: ["docs"], permitidoPorClase }),
    ).toEqual([]);
    expect(
      revisarClasesExcluidas(
        { docs: ["docs/LEEME.md"] },
        { excluibles: ["docs"], permitidoPorClase },
      ).map((falla) => falla.archivo),
    ).toEqual(["docs/LEEME.md"]);
  });

  it("una clase excluible que no admite nada lo dice con «nada»", () => {
    const fallas = revisarClasesExcluidas(
      { docs: ["docs/a.md"] },
      { excluibles: ["docs"], permitidoPorClase: {} },
    );
    expect(fallas.map((falla) => falla.motivo)).toEqual([
      "La ruta no es de un tipo permitido en la clase «docs», que no se analiza (solo nada).",
    ]);
  });
});

describe("globs: errores de forma", () => {
  it.each([[""], ["   "], [5], [null], [undefined], [["a"]]])(
    "un glob que no es un texto con contenido (%j) dice que está vacío",
    (glob) => {
      expect(() => compilar(glob)).toThrow(new Error("el glob está vacío"));
    },
  );

  it.each(["a/{b}", "a/[b]", "a/(b)", "a/!b", "a\\b"])(
    "el glob «%s» usa un carácter que no se soporta",
    (glob) => {
      expect(() => compilar(glob)).toThrow(
        new Error(
          `el glob «${glob}» usa llaves, corchetes, paréntesis, «!» o «\\»: no se soportan`,
        ),
      );
    },
  );

  it.each(["/a", "a/", "a//b"])("el glob «%s» tiene un segmento vacío", (glob) => {
    expect(() => compilar(glob)).toThrow(
      new Error(`el glob «${glob}» tiene un segmento vacío (barra inicial, final o doble)`),
    );
  });

  it.each(["a/b**/c", "**a/b", "a/**b"])("el glob «%s» usa «**» dentro de un segmento", (glob) => {
    expect(() => compilar(glob)).toThrow(
      new Error(`el glob «${glob}» usa «**» dentro de un segmento: solo vale como segmento entero`),
    );
  });
});

describe("globs: ruta exacta", () => {
  it("un texto vacío, o con espacios en los extremos, no es una ruta exacta", () => {
    expect(esRutaExacta("")).toBe(false);
    expect(esRutaExacta("   ")).toBe(false);
    expect(esRutaExacta(" a.ts")).toBe(false);
    expect(esRutaExacta("a.ts ")).toBe(false);
    expect(esRutaExacta("a.ts")).toBe(true);
  });
});

describe("detectores: porPatron", () => {
  it.each([["abc"], [null], [undefined], [{ source: "a", flags: "" }]])(
    "rechaza un patrón que no es una RegExp (%j)",
    (patron) => {
      expect(() => porPatron({ tipo: "uso", clases: ["backend"], patron })).toThrow(
        new Error("porPatron: «patron» tiene que ser una RegExp"),
      );
    },
  );

  it("sin nombre, el detector se llama «patrón» y la expresión sin las banderas g ni y", () => {
    const detector = porPatron({ tipo: "uso", clases: ["backend"], patron: /ab+c/giy });
    expect(detector.nombre).toBe("patrón /ab+c/i");
  });

  it("con nombre, conserva el nombre", () => {
    const detector = porPatron({
      tipo: "definicion",
      clases: ["config"],
      patron: /x/,
      nombre: "mi detector",
    });
    expect(detector.nombre).toBe("mi detector");
    expect(detector.tipo).toBe("definicion");
    expect(detector.clases).toEqual(["config"]);
  });

  it("reconoce línea por línea, con CRLF y sin saltar coincidencias por el estado de la expresión", () => {
    const detector = porPatron({ tipo: "uso", clases: ["backend"], patron: /x/g });
    expect(detector.reconoce("x\r\nsin\nx\nx")).toEqual([
      { linea: 1, texto: "x" },
      { linea: 3, texto: "x" },
      { linea: 4, texto: "x" },
    ]);
  });
});
