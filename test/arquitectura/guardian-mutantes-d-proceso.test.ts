import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { limpiarTemporales, lineaEn } from "./guardian-apoyo";
import {
  A,
  ARBOL_SANO,
  arbol,
  baseConVerificador,
  lineas,
  nd,
  verificadorDe,
} from "./guardian-mutantes-d-apoyo";

/**
 * Vigilancia de la versión anterior, parte de PROCESOS (`no-debilitar.cjs`): leer un árbol (`capturar`), el
 * proceso hijo que carga el código del PR y devuelve solo datos, y el CLI con su salida y su código. Todo
 * sobre árboles temporales y repositorios sintéticos (no hace falta `.git`): el verificador que se corre es
 * una copia del instrumentado, así que si Stryker lo muta, lo que se prueba acá es lo mutado.
 */

afterAll(limpiarTemporales);

const SIN_NADA: Record<string, null> = Object.fromEntries(
  Object.keys(ARBOL_SANO).map((ruta) => [ruta, null]),
);
const MARCA = "@@NO-DEBILITAR@@";
const LISTA_DE_ERRORES = ["registro", "codigos", "clases", "invariantes", "gate"];

/** Lo que el hijo devolvió para las cinco secciones de código, como `{ error }` de cada una. */
const errorEnTodas = (error: string) =>
  Object.fromEntries(LISTA_DE_ERRORES.map((nombre) => [nombre, { error }]));
const solo = (instantanea: Record<string, unknown>, nombres: string[]) =>
  Object.fromEntries(nombres.map((nombre) => [nombre, instantanea[nombre]]));

// ---------------------------------------------------------------------------------------------
// capturar: la instantánea de un árbol
// ---------------------------------------------------------------------------------------------

describe("capturar: lee el árbol y arma una sección por archivo", () => {
  it("un árbol completo: cada sección con su valor y su línea", () => {
    const raiz = arbol({
      "arquitectura/contratos/contratos.cjs": lineas(
        "module.exports = [",
        "  {",
        '    id: "c1",',
        '    version: "1.2.0",',
        '    fuenteDeVerdad: { archivo: "a.css", variable: "--x" },',
        '    deteccion: [{ tipo: "uso", clases: ["frontend", 7] }, "raro", null],',
        '    sinDetectorDeDefinicion: "motivo",',
        "  },",
        '  { id: "  ", version: 3 },',
        "  null,",
        "  5,",
        "];",
      ),
      "arquitectura/contratos/codigos.cjs": 'exports.CODIGOS_DE_FALLA = ["a", 2];\n',
      "arquitectura/contratos/clasificacion.cjs": lineas(
        'exports.CLASES_ESPERADAS = ["x"];',
        'exports.CLASES_EXCLUIBLES = ["docs"];',
        "exports.PERMITIDO_EN_CLASE_EXCLUIDA = {",
        '  docs: { extensiones: [".md"], rutas: ["LICENSE", 3] },',
        "  generado: {},",
        "};",
      ),
      "arquitectura/contratos/invariantes.cjs":
        'module.exports = [{ id: "I1", mutaciones: [{ id: "m1" }, { tipo: "t" }] }];\n',
      "arquitectura/evaluar-gate.cjs":
        "exports.evaluarGate = (needs) => [JSON.stringify(needs)];\n",
      ".github/workflows/ci.yml": lineas(
        "jobs:",
        "  estatico:",
        "    steps: []",
        "  mutacion-plan:",
        "    steps: []",
        "  guardian:",
        "    needs: [estatico]",
        "    steps: []",
        "  gate:",
        "    needs: [guardian]",
      ),
      "arquitectura/contratos/retiros.json": '[{"id":"x"}]\n',
      "arquitectura/contratos/excepciones.cjs": lineas(
        "// tope",
        "const PLAZO_MAXIMO_DIAS = 60; // días",
        "const DIAS_DE_AVISO = 14;",
      ),
      "package.json": '{"scripts":{"arquitectura":"a","guardian":"g","otro":"z"}}\n',
    });
    const instantanea = nd.capturar(raiz) as Record<string, Record<string, unknown>>;
    expect(Object.keys(instantanea).sort()).toEqual([
      "aviso",
      "ci",
      "clases",
      "codigos",
      "evasiones",
      "gate",
      "invariantes",
      "paquete",
      "plazo",
      "registro",
      "retiros",
    ]);

    const vacio = { id: null, version: null, fuente: {}, detectores: [], sinDefinicion: null };
    expect(instantanea["registro"]).toStrictEqual({
      valor: [
        {
          id: "c1",
          version: "1.2.0",
          fuente: { archivo: "a.css", variable: "--x" },
          detectores: [{ tipo: "uso", clases: ["frontend", "7"] }, { clases: [] }, { clases: [] }],
          sinDefinicion: "motivo",
        },
        vacio,
        vacio,
        vacio,
      ],
    });
    expect(instantanea["codigos"]).toStrictEqual({ valor: ["a", "2"] });
    expect(instantanea["clases"]).toStrictEqual({
      valor: {
        esperadas: ["x"],
        excluibles: ["docs"],
        permitidas: { docs: ["extension:.md", "ruta:LICENSE", "ruta:3"], generado: [] },
      },
    });
    expect(instantanea["invariantes"]).toStrictEqual({
      valor: {
        ids: ["I1"],
        mutaciones: [
          { invariante: "I1", id: "m1" },
          { invariante: "I1", id: "t#1" },
        ],
      },
    });
    expect(instantanea["retiros"]).toStrictEqual({ valor: [{ id: "x" }] });
    expect(instantanea["plazo"]).toStrictEqual({ valor: 60, linea: 2 });
    expect(instantanea["aviso"]).toStrictEqual({ valor: 14, linea: 3 });
    expect(instantanea["paquete"]).toStrictEqual({ valor: { arquitectura: "a", guardian: "g" } });
    const ci = instantanea["ci"] as { valor: Map<string, unknown>; lineaDeJobs: number };
    expect([...ci.valor.keys()]).toEqual(["estatico", "mutacion-plan", "guardian", "gate"]);
    expect(ci.lineaDeJobs).toBe(1);
  });

  it("al gate se le pasa el needs de los jobs del ci.yml (todos en verde menos el guardián caído)", () => {
    const raiz = arbol({
      "arquitectura/evaluar-gate.cjs":
        "exports.evaluarGate = (needs) => [JSON.stringify(needs)];\n",
      ".github/workflows/ci.yml": lineas(
        "jobs:",
        "  estatico:",
        "    steps: []",
        "  mutacion-plan:",
        "    steps: []",
        "  guardian:",
        "    steps: []",
        "  gate:",
        "    needs: [guardian]",
      ),
    });
    const { gate } = nd.capturar(raiz) as { gate: { valor: { conGuardianCaido: unknown } } };
    const recibido = Object.fromEntries(
      Object.entries(gate.valor.conGuardianCaido as Record<string, string[]>).map(
        ([r, [texto]]) => [r, JSON.parse(texto ?? "null")],
      ),
    );
    const verde = {
      estatico: { result: "success", outputs: {} },
      "mutacion-plan": { result: "success", outputs: { hay: "true" } },
    };
    expect(recibido).toStrictEqual({
      failure: { ...verde, guardian: { result: "failure" } },
      skipped: { ...verde, guardian: { result: "skipped" } },
      cancelled: { ...verde, guardian: { result: "cancelled" } },
    });
  });

  it("sin ci.yml al gate solo se le pasa el guardián", () => {
    const raiz = arbol({
      ...SIN_NADA,
      "arquitectura/evaluar-gate.cjs":
        "exports.evaluarGate = (needs) => [JSON.stringify(needs)];\n",
    });
    const { gate } = nd.capturar(raiz) as { gate: { valor: { conGuardianCaido: unknown } } };
    expect(gate.valor.conGuardianCaido).toStrictEqual({
      failure: ['{"guardian":{"result":"failure"}}'],
      skipped: ['{"guardian":{"result":"skipped"}}'],
      cancelled: ['{"guardian":{"result":"cancelled"}}'],
    });
  });

  it("un árbol sin archivos: todo ausente, y los retiros son una lista vacía", () => {
    const instantanea = nd.capturar(arbol(SIN_NADA)) as Record<string, unknown>;
    expect(instantanea).toStrictEqual({
      registro: { ausente: true },
      codigos: { ausente: true },
      clases: { ausente: true },
      invariantes: { ausente: true },
      gate: { ausente: true },
      retiros: { valor: [] },
      evasiones: { ausente: true },
      plazo: { ausente: true },
      aviso: { ausente: true },
      ci: { ausente: true },
      paquete: { ausente: true },
    });
  });
});

// ---------------------------------------------------------------------------------------------
// El proceso hijo: lo que el código del PR no puede hacerle al verificador
// ---------------------------------------------------------------------------------------------

describe("capturar: el código del PR se carga aparte y sus fallas se explican", () => {
  const codigoDe = (extra: Record<string, string>) =>
    solo(nd.capturar(arbol(extra)), LISTA_DE_ERRORES);

  it("un módulo que sale con código 0 sin devolver nada no hace «pasar» al PR", () => {
    expect(
      codigoDe({ "arquitectura/contratos/contratos.cjs": "process.exit(0);\n" }),
    ).toStrictEqual(errorEnTodas("no se pudo cargar el código: el proceso no devolvió resultado"));
  });

  it("un módulo que falla: cuenta la primera línea no vacía de su stderr", () => {
    const resultado = codigoDe({
      "arquitectura/contratos/contratos.cjs":
        'process.stderr.write("\\n\\n  primera linea\\nsegunda\\n");\nprocess.exit(3);\n',
    });
    expect(resultado).toStrictEqual(errorEnTodas("no se pudo cargar el código: primera linea"));
  });

  it("un módulo que sale con error y no escribe nada: cuenta el mensaje del proceso", () => {
    const resultado = codigoDe({ "arquitectura/contratos/contratos.cjs": "process.exit(3);\n" });
    for (const nombre of LISTA_DE_ERRORES) {
      const { error } = resultado[nombre] as { error: string };
      expect(error.startsWith("no se pudo cargar el código: Command failed: ")).toBe(true);
      expect(error).not.toContain("\n");
    }
  });

  it("el código del PR corre sin entrada estándar (no puede quedarse esperando que le escriban)", () => {
    const resultado = codigoDe({
      "arquitectura/contratos/contratos.cjs": lineas(
        'const fs = require("node:fs");',
        'module.exports = [{ id: fs.fstatSync(0).isCharacterDevice() ? "sin-entrada" : "con-entrada" }];',
      ),
    });
    expect(resultado["registro"]).toStrictEqual({
      valor: [
        { id: "sin-entrada", version: null, fuente: {}, detectores: [], sinDefinicion: null },
      ],
    });
  });

  it("lo que un módulo lanza se dice como texto: un Error, un texto suelto o null", () => {
    const resultado = codigoDe({
      "arquitectura/contratos/contratos.cjs": 'throw new Error("boom");\n',
      "arquitectura/contratos/codigos.cjs": 'throw "texto";\n',
      "arquitectura/contratos/clasificacion.cjs": "throw null;\n",
    });
    expect(resultado["registro"]).toStrictEqual({ error: "boom" });
    expect(resultado["codigos"]).toStrictEqual({ error: "texto" });
    expect(resultado["clases"]).toStrictEqual({ error: "null" });
  });

  it("lo que exporta mal cada módulo se explica con el nombre de lo que falta", () => {
    const resultado = codigoDe({
      "arquitectura/contratos/contratos.cjs": "module.exports = {};\n",
      "arquitectura/contratos/codigos.cjs": 'exports.CODIGOS_DE_FALLA = "x";\n',
      "arquitectura/contratos/clasificacion.cjs": 'exports.CLASES_ESPERADAS = "x";\n',
      "arquitectura/contratos/invariantes.cjs": "module.exports = {};\n",
      "arquitectura/evaluar-gate.cjs": 'exports.evaluarGate = () => "x";\n',
    });
    expect(resultado).toStrictEqual({
      registro: { error: "el registro no es una lista de contratos" },
      codigos: { error: "«CODIGOS_DE_FALLA» no es una lista" },
      clases: { error: "«CLASES_ESPERADAS» no es una lista" },
      invariantes: { error: "no encuentro la lista de invariantes en la exportación" },
      gate: { error: "«el resultado de evaluarGate» no es una lista" },
    });
    expect(
      codigoDe({ "arquitectura/evaluar-gate.cjs": "exports.otra = 1;\n" })["gate"],
    ).toStrictEqual({
      error: "no exporta «evaluarGate»",
    });
  });

  it.each([
    [
      "las clases excluibles no son una lista",
      "exports.CLASES_ESPERADAS = [];\nexports.CLASES_EXCLUIBLES = {};\n",
      "«CLASES_EXCLUIBLES» no es una lista",
    ],
    [
      "lo permitido no es un objeto",
      "exports.CLASES_ESPERADAS = [];\nexports.CLASES_EXCLUIBLES = [];\nexports.PERMITIDO_EN_CLASE_EXCLUIDA = 5;\n",
      "«PERMITIDO_EN_CLASE_EXCLUIDA» no es un objeto",
    ],
    [
      "lo permitido en una clase no es un objeto",
      'exports.CLASES_ESPERADAS = [];\nexports.CLASES_EXCLUIBLES = [];\nexports.PERMITIDO_EN_CLASE_EXCLUIDA = { docs: "x" };\n',
      "lo permitido en «docs» no es un objeto",
    ],
  ])("clasificación: %s", (_caso, texto, error) => {
    expect(codigoDe({ "arquitectura/contratos/clasificacion.cjs": texto })["clases"]).toStrictEqual(
      {
        error,
      },
    );
  });

  it("clasificación sin la lista de lo permitido (una base anterior): permitidas es null", () => {
    const texto = "exports.CLASES_ESPERADAS = [];\nexports.CLASES_EXCLUIBLES = [];\n";
    expect(codigoDe({ "arquitectura/contratos/clasificacion.cjs": texto })["clases"]).toStrictEqual(
      {
        valor: { esperadas: [], excluibles: [], permitidas: null },
      },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// El CLI
// ---------------------------------------------------------------------------------------------

function vigilar(base: string, ...argumentos: string[]) {
  const r = spawnSync(process.execPath, [verificadorDe(base), ...argumentos], {
    encoding: "utf8",
    timeout: 120_000,
  });
  return { estado: r.status, salida: r.stdout, error: r.stderr };
}
const USO =
  "Uso: node <base>/arquitectura/contratos/no-debilitar.cjs --arbol <carpeta del árbol del PR>\n";
const OK = "Vigilancia de la versión anterior: OK · nada de lo que exigía la base se debilitó · ";
const EXCEPCIONES_CON_90 = lineas(
  "/** Excepciones. */",
  "const PLAZO_MAXIMO_DIAS = 90;",
  "const DIAS_DE_AVISO = 14;",
);

describe("el CLI: salida, avisos, fallas y código de salida", () => {
  it("sin debilitamientos: dice OK en la salida estándar y sale 0", () => {
    const r = vigilar(baseConVerificador(), "--arbol", arbol());
    expect(r).toStrictEqual({ estado: 0, salida: `${OK}0 avisos.\n`, error: "" });
  });

  it("acepta --arbol=<carpeta> igual que --arbol <carpeta>", () => {
    const r = vigilar(baseConVerificador(), `--arbol=${arbol()}`);
    expect(r).toStrictEqual({ estado: 0, salida: `${OK}0 avisos.\n`, error: "" });
    // También detrás de otras opciones: se busca la que empieza con «--arbol=», no la primera.
    const conOtra = vigilar(baseConVerificador(), "--otra", `--arbol=${arbol()}`);
    expect(conOtra).toStrictEqual({ estado: 0, salida: `${OK}0 avisos.\n`, error: "" });
  });

  it("un debilitamiento: la falla con archivo y línea reales en stderr, el resumen con la base, y sale 1", () => {
    const base = baseConVerificador();
    const pr = arbol({ "arquitectura/contratos/excepciones.cjs": EXCEPCIONES_CON_90 });
    const r = vigilar(base, "--arbol", pr);
    const linea = lineaEn(pr, A.excepciones, (l) => l.startsWith("const PLAZO_MAXIMO_DIAS"));
    expect(r.salida).toBe("");
    expect(r.error).toBe(
      `FALLA ${A.excepciones}:${linea} · - · El tope de las excepciones subió de 60 a 90 días: las excepciones durarían más que lo que decidió el dueño. · Dejá el tope como estaba (puede bajar, no subir).\n` +
        `Vigilancia de la versión anterior: 1 debilitamientos, 0 avisos (base: ${base}).\n`,
    );
    expect(r.estado).toBe(1);
  });

  it("un aviso va a la salida estándar y no bloquea; con una falla se cuentan los dos", () => {
    const base = baseConVerificador({ "arquitectura/contratos/invariantes.cjs": null });
    const aviso =
      `AVISO ${A.invariantes}:1 · - · La base no trae la matriz de invariantes (invariantes.cjs): se saltea el chequeo (h). ` +
      "Es esperable solo hasta que la matriz entre a la rama principal. · " +
      "Nada por ahora; cuando la base la tenga, el chequeo (h) se activa solo.\n";
    const sano = vigilar(base, "--arbol", arbol());
    expect(sano).toStrictEqual({ estado: 0, salida: `${aviso}${OK}1 avisos.\n`, error: "" });

    const roto = vigilar(
      base,
      "--arbol",
      arbol({ "arquitectura/contratos/excepciones.cjs": EXCEPCIONES_CON_90 }),
    );
    expect(roto.estado).toBe(1);
    expect(roto.salida).toBe(aviso);
    expect(roto.error).toContain(
      `Vigilancia de la versión anterior: 1 debilitamientos, 1 avisos (base: ${base}).\n`,
    );
  });

  it("si el PR ya no tiene un archivo, lo dice en la línea 1 en vez de caerse", () => {
    const base = baseConVerificador();
    const r = vigilar(base, "--arbol", arbol({ "arquitectura/contratos/excepciones.cjs": null }));
    const motivo = (nombre: string): string =>
      `FALLA ${A.excepciones}:1 · - · No se pudo leer «${nombre}» del árbol del PR: el archivo no existe. ` +
      "Sin eso no se puede comprobar que no se debilitó nada. · " +
      "Dejá el archivo legible y con la forma de siempre, o corregí el error que muestra el motivo.\n";
    expect(r.error).toBe(
      `${motivo("aviso")}${motivo("plazo")}Vigilancia de la versión anterior: 2 debilitamientos, 0 avisos (base: ${base}).\n`,
    );
    expect(r.estado).toBe(1);
  });

  it.each([
    ["sin --arbol", [], USO],
    ["con --arbol vacío", ["--arbol", ""], USO],
    ["con --arbol seguido de otra opción", ["--arbol", "--otra"], USO],
    [
      "con una carpeta que no existe",
      ["--arbol", "/no/existe/nunca"],
      "--arbol: «/no/existe/nunca» no es una carpeta.\n",
    ],
  ])("un uso incorrecto (%s) sale 2 y explica", (_caso, argumentos, esperado) => {
    const r = vigilar(baseConVerificador(), ...argumentos);
    expect(r).toStrictEqual({ estado: 2, salida: "", error: esperado });
  });

  it("--extraer imprime una línea marcada con los datos; sin la lista de jobs, solo hay guardián", () => {
    const raiz = arbol({
      "arquitectura/evaluar-gate.cjs":
        "exports.evaluarGate = (needs) => [JSON.stringify(needs)];\n",
    });
    const base = baseConVerificador();
    const sinLista = vigilar(base, "--extraer", raiz);
    expect(sinLista.estado).toBe(0);
    expect(sinLista.salida.startsWith(`\n${MARCA}`)).toBe(true);
    expect(sinLista.salida.endsWith("\n")).toBe(true);
    const datos = JSON.parse(sinLista.salida.slice(MARCA.length + 1)) as {
      gate: { valor: { conGuardianCaido: { failure: string[] } } };
    };
    expect(JSON.parse(datos.gate.valor.conGuardianCaido.failure[0] ?? "null")).toStrictEqual({
      guardian: { result: "failure" },
    });

    const conLista = vigilar(base, "--extraer", raiz, '["a","gate"]');
    const otros = JSON.parse(conLista.salida.slice(MARCA.length + 1)) as typeof datos;
    expect(JSON.parse(otros.gate.valor.conGuardianCaido.failure[0] ?? "null")).toStrictEqual({
      a: { result: "success", outputs: {} },
      guardian: { result: "failure" },
    });
  });

  it("cargado como módulo no ejecuta nada: ni escribe ni cambia el código de salida", () => {
    const r = spawnSync(
      process.execPath,
      ["-e", "require(process.argv[1])", verificadorDe(baseConVerificador())],
      { encoding: "utf8", timeout: 120_000 },
    );
    expect({ estado: r.status, salida: r.stdout, error: r.stderr }).toStrictEqual({
      estado: 0,
      salida: "",
      error: "",
    });
  });
});
