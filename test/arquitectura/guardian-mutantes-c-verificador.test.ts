import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { CODIGOS_DE_FALLA } from "./guardian-apoyo";

/**
 * Pruebas DIRECTAS de los verificadores del mecanismo (`verificar-mecanismo.cjs`) con textos y resultados
 * sintéticos: la matriz los ejerce sobre el repositorio real y con pocas alteraciones, y esta prueba
 * afirma el comportamiento exacto (código, línea y texto del mensaje) de cada rama, regla y borde.
 * No leen el repositorio real ni `.git`: corren igual en la copia que usa Stryker.
 *
 * Esta prueba también la escanea M4 (`guardian-*.test.ts`): las líneas de salto se arman con piezas.
 */

type Problema = {
  codigo: string;
  archivo: string;
  linea: number;
  motivo: string;
  correccion: string;
};

const require = createRequire(import.meta.url);
const {
  verificarScriptsDeArquitectura,
  verificarWorkflowDeCi,
  verificarVitestConfig,
  escanearPruebasDelGuardian,
  verificarInformeDeEvidencia,
  evaluarCanario,
  PRUEBAS_DEL_GUARDIAN,
  SALTOS_PERMITIDOS,
} = require("../../arquitectura/contratos/verificar-mecanismo.cjs") as {
  verificarScriptsDeArquitectura: (texto: string) => Problema[];
  verificarWorkflowDeCi: (texto: string) => Problema[];
  verificarVitestConfig: (texto: string) => Problema[];
  escanearPruebasDelGuardian: (archivos: Record<string, string>) => Problema[];
  verificarInformeDeEvidencia: (informe: unknown) => Problema[];
  evaluarCanario: (
    corrida: { estado: number | null; salidaDeError: string },
    esperadas: { archivo: string; linea: number }[],
    archivoDelGuardian: string,
  ) => Problema[];
  PRUEBAS_DEL_GUARDIAN: string[];
  SALTOS_PERMITIDOS: { archivo: string; linea: string; requiere: string | null }[];
};

const CI = ".github/workflows/ci.yml";
const codigos = (problemas: Problema[]): string[] => problemas.map((p) => p.codigo);
const lineas = (problemas: Problema[]): number[] => problemas.map((p) => p.linea);

/** El número de línea (desde 1) de la única línea que contiene el fragmento. */
function numeroDe(texto: string, fragmento: string): number {
  const posiciones = texto
    .split("\n")
    .flatMap((linea, i) => (linea.includes(fragmento) ? [i + 1] : []));
  expect(posiciones, `«${fragmento}» tiene que estar en una sola línea`).toHaveLength(1);
  return posiciones[0] as number;
}

/** Cambia `de` por `a` exigiendo que `de` esté exactamente una vez (que la alteración no sea un no-op). */
function cambiar(texto: string, de: string, a: string): string {
  expect(texto.split(de), `«${de}» tiene que estar una sola vez`).toHaveLength(2);
  return texto.replace(de, () => a);
}

// --- package.json --------------------------------------------------------------------------------------

describe("verificarScriptsDeArquitectura", () => {
  const SCRIPTS = {
    arquitectura: "depcruise src && npm run guardian",
    guardian: "node arquitectura/contratos/guardian.cjs",
    gate: "npm run typecheck && npm run arquitectura && npm test",
    test: "vitest run --project node",
  };
  const paquete = (cambios: Record<string, unknown>): string =>
    JSON.stringify({ name: "x", scripts: { ...SCRIPTS, ...cambios } }, null, 2);

  it("un package.json sano no tiene problemas", () => {
    expect(verificarScriptsDeArquitectura(paquete({}))).toEqual([]);
  });

  it("un JSON que no es un objeto (null, lista, texto) se trata como sin scripts, sin romper", () => {
    const todos = [
      "script-arquitectura-sin-guardian",
      "script-guardian-debilitado",
      "script-gate-sin-arquitectura",
      "script-test-sin-proyecto-node",
    ];
    for (const texto of ["null", "[]", '"arquitectura"', '{"scripts": null}']) {
      expect(codigos(verificarScriptsDeArquitectura(texto)), texto).toEqual(todos);
    }
  });

  it("el problema del script `arquitectura` trae su archivo, su línea y su texto completos", () => {
    const texto = paquete({ arquitectura: "depcruise src" });
    expect(verificarScriptsDeArquitectura(texto)).toEqual([
      {
        codigo: "script-arquitectura-sin-guardian",
        archivo: "package.json",
        linea: numeroDe(texto, '"arquitectura"'),
        motivo:
          "El script «arquitectura» no encadena «&& npm run guardian» (o lo encadena con «||», «;» o «|»): el guardián no bloquearía.",
        correccion: "Dejá el script como «depcruise … && npm run guardian».",
      },
    ]);
  });

  it("el script `arquitectura` no vale si algún otro comando suyo es tolerante (`;`, `|`, `||`)", () => {
    for (const tolerante of [
      "depcruise src ; echo",
      "depcruise src | tee",
      "depcruise src || true",
    ]) {
      const texto = paquete({ arquitectura: `${tolerante} && npm run guardian` });
      expect(codigos(verificarScriptsDeArquitectura(texto)), tolerante).toEqual([
        "script-arquitectura-sin-guardian",
      ]);
    }
    const sano = paquete({ arquitectura: "depcruise --config a.json src  &&  npm run guardian " });
    expect(verificarScriptsDeArquitectura(sano)).toEqual([]);
  });

  it("el script `arquitectura` tiene que ser texto con `npm run guardian` como comando entero", () => {
    for (const valor of [
      undefined,
      5,
      ["npm run guardian"],
      "npm run guardian2",
      "xnpm run guardian",
    ]) {
      const texto = paquete({ arquitectura: valor });
      expect(codigos(verificarScriptsDeArquitectura(texto)), String(valor)).toEqual([
        "script-arquitectura-sin-guardian",
      ]);
    }
  });

  it("el script `gate` tiene que encadenar `npm run arquitectura` y `npm test` y ser texto", () => {
    for (const valor of [
      "npm test",
      "npm run arquitectura",
      ["npm run arquitectura && npm test"],
      "npm run arquitectura && npm tests",
    ]) {
      expect(
        codigos(verificarScriptsDeArquitectura(paquete({ gate: valor }))),
        String(valor),
      ).toEqual(["script-gate-sin-arquitectura"]);
    }
    expect(
      verificarScriptsDeArquitectura(paquete({ gate: "npm test && npm run arquitectura" })),
    ).toEqual([]);
  });

  it("el script `test` tiene que ser texto y correr `vitest run … --project node` con cualquier opción en medio", () => {
    for (const valor of [
      "vitest run --silent --project node",
      "vitest run --project node --bail",
    ]) {
      expect(verificarScriptsDeArquitectura(paquete({ test: valor })), valor).toEqual([]);
    }
    for (const valor of [
      ["vitest run --project node"],
      7,
      "vitest run --project nodes",
      "vitest --project node",
    ]) {
      expect(
        codigos(verificarScriptsDeArquitectura(paquete({ test: valor }))),
        String(valor),
      ).toEqual(["script-test-sin-proyecto-node"]);
    }
  });

  it("la línea del problema es la de la clave (la última si está repetida) y 1 si no está", () => {
    const repetido =
      '{\n  "scripts": {\n    "guardian": "x",\n    "arquitectura": "depcruise && npm run guardian",\n    "guardian": "y",\n    "gate": "npm run arquitectura && npm test",\n    "test": "vitest run --project node"\n  }\n}';
    const [problema] = verificarScriptsDeArquitectura(repetido);
    expect(problema?.codigo).toBe("script-guardian-debilitado");
    expect(problema?.linea).toBe(5);
    expect(lineas(verificarScriptsDeArquitectura("{}"))).toEqual([1, 1, 1, 1]);
    const sinGate = JSON.stringify({ scripts: { ...SCRIPTS, gate: undefined } }, null, 2);
    expect(lineas(verificarScriptsDeArquitectura(sinGate))).toEqual([1]);
  });
});

// --- ci.yml --------------------------------------------------------------------------------------------

const unir = (...bloques: string[][]): string => bloques.flat().join("\n") + "\n";
const CABECERA = ["name: CI", ""];
const ON = ["on:", "  push:", "    branches: [main]", "  pull_request:", ""];
const JOBS = ["jobs:"];
const GUARDIAN = [
  "  guardian:",
  "    timeout-minutes: 10",
  "    steps:",
  "      - run: npm run guardian",
];
const PRUEBAS = ["  pruebas:", "    timeout-minutes: 10", "    steps:", "      - run: npm test"];
const GATE = [
  "  gate:",
  "    needs: [guardian, pruebas]",
  "    if: always()",
  "    steps:",
  "      - run: echo listo",
];
const SANO = unir(CABECERA, ON, JOBS, GUARDIAN, PRUEBAS, GATE);
const conGate = (gate: string[]): string => unir(CABECERA, ON, JOBS, GUARDIAN, PRUEBAS, gate);
const conPruebas = (...resto: string[]): string =>
  unir(CABECERA, ON, JOBS, GUARDIAN, ["  pruebas:", "    timeout-minutes: 10", ...resto], GATE);
const conPasos = (...pasos: string[]): string => conPruebas("    steps:", ...pasos);
const conLineaEnGuardian = (linea: string): string =>
  cambiar(
    SANO,
    "    timeout-minutes: 10\n    steps:\n      - run: npm run guardian",
    `    timeout-minutes: 10\n${linea}\n    steps:\n      - run: npm run guardian`,
  );
const soloCodigo = (texto: string, codigo: string): Problema[] =>
  verificarWorkflowDeCi(texto).filter((p) => p.codigo === codigo);

describe("verificarWorkflowDeCi: la estructura de los trabajos", () => {
  it("un ci.yml sano no tiene problemas", () => {
    expect(verificarWorkflowDeCi(SANO)).toEqual([]);
  });

  it("sin `jobs:` no hay trabajos, aunque haya claves a dos espacios: falta el Gate (línea 1)", () => {
    const texto = unir(CABECERA, ON, ["  gate:", "    if: always()"]);
    expect(verificarWorkflowDeCi(texto)).toEqual([
      {
        codigo: "ci-sin-job-gate",
        archivo: CI,
        linea: 1,
        motivo:
          "El workflow no tiene un trabajo «gate»: nada exige que el guardián y las pruebas hayan pasado.",
        correccion: "Restituí el trabajo «gate» con `needs` de todos los trabajos obligatorios.",
      },
    ]);
  });

  it("sin `jobs:` no hay trabajos ni siquiera si el archivo empieza con claves sangradas", () => {
    const problemas = verificarWorkflowDeCi("  gate:\n    if: always()\n");
    expect(codigos(problemas)).toEqual(["ci-sin-job-gate"]);
    expect(lineas(problemas)).toEqual([1]);
  });

  it("`jobs:` con algo más en la línea no es el encabezado: falta el Gate (línea 1)", () => {
    const problemas = verificarWorkflowDeCi(unir(CABECERA, ["jobs: {}"]));
    expect(codigos(problemas)).toEqual(["ci-sin-job-gate"]);
    expect(lineas(problemas)).toEqual([1]);
  });

  it("el encabezado `jobs:` puede llevar un comentario o espacios al final", () => {
    expect(verificarWorkflowDeCi(cambiar(SANO, "jobs:", "jobs: # los trabajos"))).toEqual([]);
    expect(verificarWorkflowDeCi(cambiar(SANO, "jobs:", "jobs:   "))).toEqual([]);
  });

  it("solo vale `jobs:` a la izquierda de todo: la línea de los avisos es la del `jobs:` real", () => {
    const texto = unir(["name: CI", "env:", "  jobs:"], ON, JOBS, [
      "  gate:",
      "    needs: []",
      "    if: always()",
    ]);
    const problemas = verificarWorkflowDeCi(texto);
    expect(codigos(problemas)).toEqual(["ci-guardian-no-corre", "ci-pruebas-no-corren"]);
    expect(texto.split("\n")[8]).toBe("jobs:");
    expect(lineas(problemas)).toEqual([9, 9]);
  });

  it("los encabezados de trabajo pueden llevar comentario y los nombres, guiones, guiones bajos y dígitos", () => {
    expect(verificarWorkflowDeCi(cambiar(SANO, "  gate:", "  gate:   # el gate"))).toEqual([]);
    expect(verificarWorkflowDeCi(cambiar(SANO, "  guardian:", "  guardian: # con tope"))).toEqual(
      [],
    );
    const raro = cambiar(
      cambiar(SANO, "  guardian:", "  Guardian_2-x9:"),
      "[guardian, pruebas]",
      "[Guardian_2-x9, pruebas]",
    );
    expect(verificarWorkflowDeCi(raro)).toEqual([]);
  });

  it("lo que viene después de `jobs:` en otra clave de primer nivel no es parte del último trabajo", () => {
    const texto = unir(CABECERA, ON, JOBS, GUARDIAN, PRUEBAS, GATE, [
      "",
      "otro:",
      "  continue-on-error: true",
      "  trabajo:",
      "    steps:",
      "      - run: npm test",
    ]);
    expect(verificarWorkflowDeCi(texto)).toEqual([]);
  });

  it("un comentario sin sangría entre trabajos no corta la sección `jobs:`", () => {
    const texto = unir(CABECERA, ON, JOBS, GUARDIAN, ["# comentario sin sangría"], PRUEBAS, GATE);
    expect(verificarWorkflowDeCi(texto)).toEqual([]);
  });

  it("lo que hay antes del primer trabajo no es un trabajo", () => {
    const texto = unir(
      ["name: CI", "run-name: npm run guardian", ""],
      ON,
      JOBS,
      GUARDIAN,
      PRUEBAS,
      GATE,
    );
    expect(verificarWorkflowDeCi(texto)).toEqual([]);
  });

  it("una clave a dos espacios con valor no es un trabajo: el trabajo sigue hasta el próximo encabezado", () => {
    const texto = cambiar(
      SANO,
      "    timeout-minutes: 10\n    steps:\n      - run: npm run guardian",
      "    timeout-minutes: 10\n  marca: algo\n    continue-on-error: true\n    steps:\n      - run: npm run guardian",
    );
    expect(verificarWorkflowDeCi(texto)).toEqual([
      {
        codigo: "ci-continue-on-error",
        archivo: CI,
        linea: numeroDe(texto, "continue-on-error: true"),
        motivo: "El trabajo «guardian» usa `continue-on-error`: una falla no bloquearía.",
        correccion: "Sacá `continue-on-error`.",
      },
    ]);
  });
});

describe("verificarWorkflowDeCi: el Gate y su `needs`", () => {
  const fuera = (texto: string): string[] =>
    soloCodigo(texto, "ci-job-fuera-del-gate").map((p) => /«([^»]+)»/.exec(p.motivo)?.[1] ?? "");

  it("el `needs` se lee en línea, con guiones (a 4 o a 6 espacios), en varias líneas y con comentarios", () => {
    const variantes: Record<string, string[]> = {
      "guiones a 4": [
        "  gate:",
        "    needs:",
        "    - guardian",
        "    - pruebas",
        "    if: always()",
      ],
      "guiones a 6": [
        "  gate:",
        "    needs:",
        "      - guardian",
        "      - pruebas",
        "    if: always()",
      ],
      "con vacías en medio": [
        "  gate:",
        "    needs:",
        "      - guardian",
        "",
        "  ",
        "      - pruebas",
        "    if: always()",
      ],
      "lista partida": [
        "  gate:",
        "    needs: [",
        "      guardian,",
        "      pruebas,",
        "    ]",
        "    if: always()",
      ],
      "comentario en línea": [
        "  gate:",
        "    needs: [guardian, pruebas] # exigidos",
        "    if: always()",
      ],
      "comentario y guiones": [
        "  gate:",
        "    needs: # exigidos",
        "      - guardian",
        "      - pruebas",
        "    if: always()",
      ],
    };
    for (const [nombre, gate] of Object.entries(variantes)) {
      expect(verificarWorkflowDeCi(conGate(gate)), nombre).toEqual([]);
    }
  });

  it("un `needs` que llega hasta la última línea del archivo se lee entero", () => {
    const gate = [
      "  gate:",
      "    if: always()",
      "    needs:",
      "      - guardian",
      "      - pruebas",
    ];
    for (const final of ["", "\n"]) {
      const texto = unir(CABECERA, ON, JOBS, GUARDIAN, PRUEBAS, gate).trimEnd() + final;
      expect(verificarWorkflowDeCi(texto), JSON.stringify(final)).toEqual([]);
    }
  });

  it("el `needs` termina en la primera línea que no es parte de la lista", () => {
    // Otra clave a 4 espacios, aunque nombre un trabajo, no es parte de `needs`.
    const conClave = conGate(["  gate:", "    needs: [guardian]", "    if: always() && pruebas"]);
    expect(fuera(conClave)).toEqual(["pruebas"]);
    // La sangría no cambia por los espacios que sobren al final de la línea.
    const conEspacios = conGate([
      "  gate:",
      "    needs: [guardian]",
      "    if: always() && pruebas   ",
    ]);
    expect(fuera(conEspacios)).toEqual(["pruebas"]);
    // Ni lo que viene después de esa otra clave, aunque esté más adentro: son los pasos, no el `needs`.
    const conPaso = conGate([
      "  gate:",
      "    needs: [guardian]",
      "    if: always()",
      "    steps:",
      "      - run: echo pruebas",
    ]);
    expect(fuera(conPaso)).toEqual(["pruebas"]);
    // Un guion a otra sangría (3 espacios) tampoco.
    const conGuionTorcido = conGate([
      "  gate:",
      "    needs: [guardian]",
      "   - pruebas",
      "    if: always()",
    ]);
    expect(fuera(conGuionTorcido)).toEqual(["pruebas"]);
  });

  it("solo cuenta `needs:` a cuatro espacios exactos, no uno más adentro", () => {
    const texto = conGate([
      "  gate:",
      "    env:",
      "      needs: pruebas",
      "    needs: [guardian]",
      "    if: always()",
    ]);
    const problemas = soloCodigo(texto, "ci-job-fuera-del-gate");
    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.linea).toBe(numeroDe(texto, "needs: [guardian]"));
    expect(fuera(texto)).toEqual(["pruebas"]);
  });

  it("sin `needs`, cada trabajo obligatorio queda fuera y la línea es la del encabezado del Gate", () => {
    const texto = conGate(["  gate:", "    if: always()", "    steps:", "      - run: echo listo"]);
    expect(soloCodigo(texto, "ci-job-fuera-del-gate")).toEqual([
      {
        codigo: "ci-job-fuera-del-gate",
        archivo: CI,
        linea: numeroDe(texto, "  gate:"),
        motivo:
          "El trabajo «guardian» corre el guardián o las pruebas y no está en `needs` del Gate: puede fallar sin bloquear.",
        correccion: "Agregá «guardian» a `needs` del trabajo «gate».",
      },
      {
        codigo: "ci-job-fuera-del-gate",
        archivo: CI,
        linea: numeroDe(texto, "  gate:"),
        motivo:
          "El trabajo «pruebas» corre el guardián o las pruebas y no está en `needs` del Gate: puede fallar sin bloquear.",
        correccion: "Agregá «pruebas» a `needs` del trabajo «gate».",
      },
    ]);
  });

  it("con `needs`, la línea de un trabajo que falta es la de `needs`", () => {
    const texto = conGate(["  gate:", "    needs: [guardian]", "    if: always()"]);
    expect(lineas(soloCodigo(texto, "ci-job-fuera-del-gate"))).toEqual([
      numeroDe(texto, "needs: [guardian]"),
    ]);
  });

  it("el Gate necesita `if: always()` a nivel del trabajo, en cualquier forma de expresión", () => {
    for (const siempre of ["    if: ${{ always() }}", "    if: success() || always()"]) {
      expect(verificarWorkflowDeCi(cambiar(SANO, "    if: always()", siempre)), siempre).toEqual(
        [],
      );
    }
    for (const paso of ["      - if: always()", "        if: always()"]) {
      const texto = cambiar(
        SANO,
        "    if: always()\n    steps:\n      - run: echo listo",
        `    steps:\n${paso}\n        run: echo listo`,
      );
      expect(verificarWorkflowDeCi(texto), paso).toEqual([
        {
          codigo: "ci-gate-sin-always",
          archivo: CI,
          linea: numeroDe(texto, "  gate:"),
          motivo:
            "El trabajo «gate» no tiene `if: always()`: si un trabajo falla, el Gate se saltea y GitHub lo cuenta como aprobado.",
          correccion: "Volvé a poner `if: always()` en el trabajo «gate».",
        },
      ]);
    }
  });

  it("lo que corre el Gate no cuenta como guardián ni como pruebas de ningún trabajo", () => {
    const texto = unir(
      CABECERA,
      ON,
      JOBS,
      ["  guardian:", "    timeout-minutes: 10", "    steps:", "      - run: echo nada"],
      [
        "  gate:",
        "    needs: [guardian]",
        "    if: always()",
        "    steps:",
        "      - run: npm run guardian",
        "      - run: npm test",
      ],
    );
    const problemas = verificarWorkflowDeCi(texto);
    expect(problemas).toEqual([
      {
        codigo: "ci-guardian-no-corre",
        archivo: CI,
        linea: numeroDe(texto, "jobs:"),
        motivo:
          "Ningún trabajo del workflow corre el guardián (`npm run arquitectura`, `npm run guardian` o `guardian.cjs`).",
        correccion: "Volvé a correr el guardián en un trabajo que el Gate exija.",
      },
      {
        codigo: "ci-pruebas-no-corren",
        archivo: CI,
        linea: numeroDe(texto, "jobs:"),
        motivo:
          "Ningún trabajo del workflow corre `npm test`: la matriz y las pruebas del guardián no se ejecutan.",
        correccion: "Volvé a correr `npm test` en un trabajo que el Gate exija.",
      },
    ]);
  });

  it("un trabajo que no corre el guardián ni las pruebas no tiene que estar en `needs`, tener tope ni ser incondicional", () => {
    const texto = unir(
      CABECERA,
      ON,
      JOBS,
      GUARDIAN,
      PRUEBAS,
      ["  lint:", "    if: github.event_name == 'push'", "    steps:", "      - run: npm run lint"],
      GATE,
    );
    expect(verificarWorkflowDeCi(texto)).toEqual([]);
  });

  it("los pasos del Gate pueden ser condicionales: la regla es para los trabajos obligatorios", () => {
    const gate = [
      "  gate:",
      "    needs: [guardian, pruebas]",
      "    if: always()",
      "    steps:",
      "      - if: github.event_name == 'push'",
      "        run: npm test",
    ];
    expect(verificarWorkflowDeCi(conGate(gate))).toEqual([]);
  });

  it("un trabajo obligatorio sin tope propio no lo salva el tope de un paso", () => {
    const texto = unir(
      CABECERA,
      ON,
      JOBS,
      GUARDIAN,
      ["  pruebas:", "    steps:", "      - run: npm test", "        timeout-minutes: 5"],
      GATE,
    );
    expect(verificarWorkflowDeCi(texto)).toEqual([
      {
        codigo: "ci-job-sin-tope",
        archivo: CI,
        linea: numeroDe(texto, "  pruebas:"),
        motivo:
          "El trabajo «pruebas» no tiene `timeout-minutes`: un cuelgue lo dejaría corriendo sin límite.",
        correccion: "Agregá `timeout-minutes` al trabajo.",
      },
    ]);
  });
});

describe("verificarWorkflowDeCi: tolerancia a fallas y condiciones", () => {
  it("`continue-on-error` solo se tolera con valor `false`, con o sin espacios y comentario", () => {
    for (const linea of [
      "    continue-on-error: false",
      "    continue-on-error: false   ",
      "    continue-on-error: false # no tolera",
      "    continue-on-error:false",
      "      - run: echo continue-on-error: true",
    ]) {
      const texto = linea.startsWith("      - ")
        ? cambiar(SANO, "      - run: npm run guardian", `${linea}\n      - run: npm run guardian`)
        : conLineaEnGuardian(linea);
      expect(verificarWorkflowDeCi(texto), linea).toEqual([]);
    }
    for (const linea of [
      "    continue-on-error: true",
      "    continue-on-error:true",
      "    continue-on-error: ${{ matrix.x }}",
      "    continue-on-error: true # tolerado",
    ]) {
      const texto = conLineaEnGuardian(linea);
      expect(verificarWorkflowDeCi(texto), linea).toEqual([
        {
          codigo: "ci-continue-on-error",
          archivo: CI,
          linea: numeroDe(texto, "continue-on-error"),
          motivo: "El trabajo «guardian» usa `continue-on-error`: una falla no bloquearía.",
          correccion: "Sacá `continue-on-error`.",
        },
      ]);
    }
  });

  it("una condición siempre falsa desactiva el trabajo, escrita como se escriba", () => {
    const casos: [string, string][] = [
      ["    if: false", "false"],
      ["    if: 0", "0"],
      ["    if: ''", "''"],
      ['    if: ""', '""'],
      ["    if: ${{ false }}", "${{ false }}"],
      ["    if: ${{false}}", "${{false}}"],
      ["    if: ${{ false}}", "${{ false}}"],
      ["    if: ${{false }}", "${{false }}"],
      ["    if: false   ", "false"],
      ["    if: false # nunca corre", "false"],
      ["    if:false", "false"],
    ];
    for (const [linea, valor] of casos) {
      const texto = conLineaEnGuardian(linea);
      expect(verificarWorkflowDeCi(texto), linea).toEqual([
        {
          codigo: "ci-job-desactivado",
          archivo: CI,
          linea: numeroDe(texto, linea),
          motivo: `El trabajo «guardian» tiene una condición siempre falsa (\`if: ${valor}\`): nunca corre.`,
          correccion: "Sacá la condición o ponela en una expresión que dependa del evento.",
        },
      ]);
    }
  });

  it("una condición que solo contiene `false` o `0` entre otras cosas condiciona, no desactiva", () => {
    const casos: [string, string][] = [
      ["    if: github.event_name == 'push'", "github.event_name == 'push'"],
      ["    if: inputs.n != 0", "inputs.n != 0"],
      ["    if: 0 < github.run_number", "0 < github.run_number"],
      ["    if: false || github.ref == 'x'", "false || github.ref == 'x'"],
      ["    if: always() && false", "always() && false"],
      ["    if: ${{ false }} == x", "${{ false }} == x"],
      ["    if: github.x   ", "github.x"],
      ["    if: github.x # solo en main", "github.x"],
    ];
    for (const [linea, valor] of casos) {
      const texto = conLineaEnGuardian(linea);
      expect(verificarWorkflowDeCi(texto), linea).toEqual([
        {
          codigo: "ci-job-condicionado",
          archivo: CI,
          linea: numeroDe(texto, linea),
          motivo: `El trabajo «guardian» corre el guardián o las pruebas solo bajo una condición (\`if: ${valor}\`): tiene que correr en todo evento relevante.`,
          correccion:
            "Sacá la condición del trabajo (si algo no aplica, que lo decida el paso, no el trabajo entero).",
        },
      ]);
    }
  });

  it("un `if` de un paso que corre algo se rechaza solo si es siempre falso; las demás condiciones las ve otra regla", () => {
    const texto = cambiar(
      SANO,
      "      - run: npm run guardian",
      "      - if: false\n        run: npm run guardian",
    );
    expect(codigos(verificarWorkflowDeCi(texto))).toEqual(["ci-job-desactivado"]);
  });

  it("ni un comentario sin sangría ni un `run` que nombra la clave cuentan como configuración", () => {
    const comentario = cambiar(
      SANO,
      "      - run: npm run guardian",
      "# npm run guardian || true\n      - run: npm run guardian",
    );
    expect(verificarWorkflowDeCi(comentario)).toEqual([]);
    const nombra = cambiar(
      SANO,
      "      - run: npm run guardian",
      "      - run: echo if: false\n      - run: npm run guardian",
    );
    expect(verificarWorkflowDeCi(nombra)).toEqual([]);
  });

  it("un comando que termina en `|| true`, `|| exit 0`, `|| :` o `; true` nunca falla: se rechaza", () => {
    const tolerantes = [
      "npm run guardian || true",
      "npm run guardian ||true",
      "npm run guardian ||  true",
      "npm run guardian || exit 0",
      "npm run guardian || exit  0",
      "npm test --silent || true",
      "npm test; true",
      "npm test;true",
      "npm test ;  true",
      "node arquitectura/contratos/guardian.cjs || :",
      "node arquitectura/contratos/guardian.cjs ||:",
      "npm run gate || : # por ahora",
    ];
    for (const comando of tolerantes) {
      const texto = cambiar(
        SANO,
        "      - run: npm run guardian",
        `      - run: npm run guardian\n      - run: ${comando}`,
      );
      expect(verificarWorkflowDeCi(texto), comando).toEqual([
        {
          codigo: "ci-comando-tolerante",
          archivo: CI,
          linea: numeroDe(texto, comando),
          motivo:
            "El trabajo «guardian» corre el guardián o las pruebas con `|| true` (o similar): el comando nunca falla.",
          correccion: "Sacá el `|| true`: el comando tiene que propagar su salida.",
        },
      ]);
    }
  });

  it("un comando que propaga su salida, aunque tenga opciones o comentarios, se acepta", () => {
    for (const comando of [
      "npm test -- --reporter=dot",
      "npm run guardian # || true",
      "npm run guardian || echo falló",
      "npm run guardian || true_story",
      "npm run guardian || :x",
      "echo listo || true",
    ]) {
      const texto = cambiar(
        SANO,
        "      - run: npm run guardian",
        `      - run: npm run guardian\n      - run: ${comando}`,
      );
      expect(verificarWorkflowDeCi(texto), comando).toEqual([]);
    }
  });
});

describe("verificarWorkflowDeCi: los pasos que corren el guardián o las pruebas no llevan `if`", () => {
  const condicionados = (texto: string): Problema[] => soloCodigo(texto, "ci-job-condicionado");
  const motivoDe = (valor: string): string =>
    `Un paso del trabajo «pruebas» que corre el guardián o las pruebas solo corre bajo una condición (\`if: ${valor}\`): saltado, el trabajo quedaría en verde sin analizar nada.`;

  it("el `if` de un paso se ve con o sin guion, con o sin espacios, comentarios y líneas vacías en medio", () => {
    const casos: [string, string[], string][] = [
      ["a 8 espacios", ["      - run: npm test", "        if: github.x == 1"], "github.x == 1"],
      ["junto al guion", ["      - if: github.x == 2", "        run: npm test"], "github.x == 2"],
      [
        "dos espacios tras el guion",
        ["      -  if: github.x", "        run: npm test"],
        "github.x",
      ],
      [
        "con comentario y espacios",
        ["      - if: github.x  # solo main  ", "        run: npm test"],
        "github.x",
      ],
      [
        "sin espacio tras los dos puntos",
        ["      - if:github.x == 3", "        run: npm test"],
        "github.x == 3",
      ],
      ["a 8 sin espacio", ["      - run: npm test", "        if:github.x == 4"], "github.x == 4"],
      ["con línea vacía", ["      - run: npm test", "", "  ", "        if: github.x"], "github.x"],
    ];
    for (const [nombre, pasos, valor] of casos) {
      const texto = conPasos(...pasos);
      expect(condicionados(texto), nombre).toEqual([
        {
          codigo: "ci-job-condicionado",
          archivo: CI,
          linea: numeroDe(texto, pasos.find((p) => p.includes("if:")) ?? ""),
          motivo: motivoDe(valor),
          correccion:
            "Sacá la condición del paso que corre el guardián o las pruebas (los pasos que preparan o vigilan sí pueden ser condicionales).",
        },
      ]);
    }
  });

  it("un `if` siempre falso en un paso lo dice `ci-job-desactivado`, no esta regla", () => {
    const texto = conPasos("      - if: false", "        run: npm test");
    expect(condicionados(texto)).toEqual([]);
    expect(codigos(verificarWorkflowDeCi(texto))).toEqual(["ci-job-desactivado"]);
  });

  it("un paso que no corre ni el guardián ni las pruebas sí puede ser condicional", () => {
    expect(
      condicionados(conPasos("      - if: github.x", "        uses: actions/checkout")),
    ).toEqual([]);
  });

  it("un comentario que nombra las pruebas no hace que el paso las corra", () => {
    const texto = conPasos(
      "      - if: github.x",
      "        uses: actions/checkout",
      "        # después corre npm test aparte",
    );
    expect(condicionados(texto)).toEqual([]);
  });

  it("solo cuenta el `if` del propio paso: ni uno más adentro ni uno con otra sangría", () => {
    expect(
      condicionados(
        conPasos(
          "      - run: npm test",
          "        with:",
          "          lista:",
          "          - if: github.x",
        ),
      ),
    ).toEqual([]);
    expect(
      condicionados(conPasos("      - run: npm test", "        with:", "            if: github.x")),
    ).toEqual([]);
    expect(condicionados(conPasos("      - run: npm test", " - if: github.x"))).toEqual([]);
  });

  it("una lista más adentro de un paso no lo parte: el `if` y el comando siguen siendo del mismo paso", () => {
    const texto = conPasos(
      "      - name: Pruebas",
      "        if: github.x",
      "        with:",
      "          lista:",
      "          - a",
      "        run: npm test",
    );
    expect(lineas(condicionados(texto))).toEqual([numeroDe(texto, "if: github.x")]);
  });

  it("un paso que es solo un guion empieza un paso nuevo", () => {
    const texto = conPasos(
      "      - if: github.x",
      "        uses: actions/checkout",
      "      -",
      "        run: npm test",
    );
    expect(condicionados(texto)).toEqual([]);
  });

  it("una lista que viene antes de cualquier clave del trabajo no es de `steps:`", () => {
    const texto = unir(
      CABECERA,
      ON,
      JOBS,
      GUARDIAN,
      ["  pruebas:", "      - run: npm test", "        if: github.x"],
      GATE,
    );
    expect(condicionados(texto)).toEqual([]);
  });

  it("solo son pasos las listas de `steps:` (a 4 espacios, sola en su línea, con o sin comentario)", () => {
    const paso = ["      - run: npm test", "        if: github.x"];
    expect(condicionados(conPruebas(...paso))).toEqual([]);
    expect(condicionados(conPruebas("    steps: []", ...paso))).toEqual([]);
    expect(condicionados(conPruebas("    nota:     steps:", ...paso))).toEqual([]);
    expect(
      condicionados(conPruebas("    steps:", "      - run: echo", "    otra:", ...paso)),
    ).toEqual([]);
    expect(condicionados(conPruebas("    steps: # los pasos", ...paso))).toHaveLength(1);
    expect(condicionados(conPruebas("    steps:   ", ...paso))).toHaveLength(1);
  });

  it("una línea suelta antes del primer paso no rompe el análisis, y un comentario a 4 espacios no cierra `steps:`", () => {
    expect(
      condicionados(conPruebas("    steps:", "      nota: x", "      - run: npm test")),
    ).toEqual([]);
    const conComentario = conPasos(
      "    # comentario a la altura de steps",
      "      - run: npm test",
      "        if: github.x",
    );
    expect(condicionados(conComentario)).toHaveLength(1);
  });
});

describe("verificarWorkflowDeCi: los disparadores", () => {
  const disparadores = (texto: string): Problema[] => soloCodigo(texto, "ci-disparador-incompleto");
  const sinOn = (...on: string[]): string => unir(CABECERA, on, JOBS, GUARDIAN, PRUEBAS, GATE);
  const CORRECCION =
    "El workflow tiene que correr en todo pull request, sin filtros de rutas ni de ramas.";

  it("sin `on:` el Gate no correría: se señala la línea 1", () => {
    expect(disparadores(unir(CABECERA, JOBS, GUARDIAN, PRUEBAS, GATE))).toEqual([
      {
        codigo: "ci-disparador-incompleto",
        archivo: CI,
        linea: 1,
        motivo: "El workflow no declara sus disparadores (`on:`): el Gate no correría.",
        correccion: CORRECCION,
      },
    ]);
  });

  it("`on:` con valor en la misma línea no es el bloque de disparadores", () => {
    const texto = unir(CABECERA, ["on: [pull_request]"], JOBS, GUARDIAN, PRUEBAS, GATE);
    expect(lineas(disparadores(texto))).toEqual([1]);
    expect(disparadores(texto)[0]?.motivo).toContain("no declara sus disparadores");
  });

  it("`on:` tiene que estar a la izquierda de todo, y puede llevar un comentario", () => {
    const texto = unir(
      ["name: CI", "concurrency:", "  group: on:"],
      ["on:", "  push:", ""],
      JOBS,
      GUARDIAN,
      PRUEBAS,
      GATE,
    );
    expect(texto.split("\n")[3]).toBe("on:");
    expect(disparadores(texto)).toEqual([
      {
        codigo: "ci-disparador-incompleto",
        archivo: CI,
        linea: 4,
        motivo:
          "El workflow no corre en `pull_request`: un cambio podría integrarse sin pasar por el Gate.",
        correccion: CORRECCION,
      },
    ]);
    expect(disparadores(cambiar(SANO, "on:\n", "on: # cuándo corre\n"))).toEqual([]);
    expect(disparadores(cambiar(SANO, "on:\n", "on:   \n"))).toEqual([]);
  });

  it("sin `pull_request` entre los disparadores se rechaza, también si el bloque llega al final del archivo", () => {
    const alFinal = (...on: string[]): string =>
      unir(["name: CI"], JOBS, GUARDIAN, PRUEBAS, GATE, on);
    for (const sufijo of ["", "\n"]) {
      const texto = alFinal("on:", "  push:").trimEnd() + sufijo;
      expect(lineas(disparadores(texto)), JSON.stringify(sufijo)).toEqual([numeroDe(texto, "on:")]);
      expect(disparadores(texto)[0]?.motivo).toContain("no corre en `pull_request`");
    }
    const conFiltro = alFinal("on:", "  pull_request:", "    branches: [main]").trimEnd();
    const problemas = disparadores(conFiltro);
    expect(lineas(problemas)).toEqual([numeroDe(conFiltro, "branches: [main]")]);
    expect(problemas[0]?.motivo).toBe(
      "El disparador `pull_request` filtra con «branches: [main]»: hay cambios que no pasarían por el Gate.",
    );
  });

  it("el bloque `on:` termina en la próxima clave de primer nivel, no en un comentario sin sangría", () => {
    const deOtraClave = sinOn("on:", "  push:", "otra:", "  pull_request:", "    branches: [main]");
    expect(disparadores(deOtraClave).map((p) => p.motivo)).toEqual([
      "El workflow no corre en `pull_request`: un cambio podría integrarse sin pasar por el Gate.",
    ]);
    const conComentario = sinOn("on:", "  push:", "# comentario sin sangría", "  pull_request:");
    expect(disparadores(conComentario)).toEqual([]);
  });

  it("`pull_request` tiene que ser un disparador (dos espacios), aunque se escriba con espacio antes de los dos puntos", () => {
    expect(disparadores(sinOn("on:", "  push:", "  pull_request :"))).toEqual([]);
    expect(codigos(disparadores(sinOn("on:", "  workflow_run:", "    pull_request:")))).toEqual([
      "ci-disparador-incompleto",
    ]);
  });

  it("filtrar `pull_request` por rutas o ramas se rechaza, con la línea y el texto del filtro", () => {
    for (const filtro of [
      "paths: [src]",
      "paths-ignore: [docs]",
      "branches: [main]",
      "branches-ignore: [x]",
      "branches : [main]",
    ]) {
      const texto = sinOn("on:", "  pull_request:", "    types: [opened]", `    ${filtro}`);
      expect(disparadores(texto), filtro).toEqual([
        {
          codigo: "ci-disparador-incompleto",
          archivo: CI,
          linea: numeroDe(texto, filtro),
          motivo: `El disparador \`pull_request\` filtra con «${filtro}»: hay cambios que no pasarían por el Gate.`,
          correccion: CORRECCION,
        },
      ]);
    }
  });

  it("solo filtran las claves a cuatro espacios dentro de `pull_request`, no las de antes ni las de después", () => {
    const texto = sinOn(
      "on:",
      "  push:",
      "    branches: [main]",
      "  pull_request:",
      "    types: [opened]",
      "      branches: [main]",
      "  schedule:",
      "    paths: [x]",
    );
    expect(disparadores(texto)).toEqual([]);
  });
});

// --- vitest.config.ts ----------------------------------------------------------------------------------

describe("verificarVitestConfig", () => {
  const VITEST = [
    "export default defineConfig({",
    "  test: {",
    "    projects: [",
    "      {",
    "        test: {",
    '          name: "node",',
    '          include: ["src/**/*.test.ts", "test/**/*.test.ts"],',
    "        },",
    "      },",
    "    ],",
    "  },",
    "});",
  ].join("\n");
  const ARCHIVO = "vitest.config.ts";
  const SACAR = "Sacá el filtro: las pruebas de test/arquitectura/guardian-* corren siempre.";
  const conLinea = (linea: string): string =>
    cambiar(VITEST, "    projects: [", `${linea}\n    projects: [`);

  it("una configuración sana no tiene problemas, con o sin espacios y con más entradas en `include`", () => {
    expect(verificarVitestConfig(VITEST)).toEqual([]);
    expect(
      verificarVitestConfig(cambiar(VITEST, '          name: "node",', '          name:"node",')),
    ).toEqual([]);
    expect(
      verificarVitestConfig(
        cambiar(
          VITEST,
          '["src/**/*.test.ts", "test/**/*.test.ts"]',
          '["test/**/*.test.ts", "apps/**/*.test.ts"]',
        ),
      ),
    ).toEqual([]);
    expect(
      verificarVitestConfig(cambiar(VITEST, '          include: ["src', '          include:["src')),
    ).toEqual([]);
  });

  it("`exclude`, `testNamePattern`, `dir` y `root` se rechazan con su línea y su texto sin sangría ni comentario", () => {
    for (const clave of ["exclude", "testNamePattern", "dir", "root"]) {
      const texto = conLinea(`    ${clave}: ["x"], // por qué se saca esto`);
      expect(verificarVitestConfig(texto), clave).toEqual([
        {
          codigo: "vitest-excluye-pruebas",
          archivo: ARCHIVO,
          linea: numeroDe(texto, clave),
          motivo: `La configuración de Vitest usa «${clave}: ["x"],»: puede sacar de la corrida a las pruebas del guardián o a la matriz.`,
          correccion: SACAR,
        },
      ]);
    }
    const conEspacio = conLinea('    exclude : ["x"]');
    expect(codigos(verificarVitestConfig(conEspacio))).toEqual(["vitest-excluye-pruebas"]);
  });

  it("un filtro comentado, o dentro de otra clave, no cuenta", () => {
    expect(verificarVitestConfig(conLinea('    // exclude: ["x"]'))).toEqual([]);
    expect(verificarVitestConfig(conLinea('    coverage: { exclude: ["x"] },'))).toEqual([]);
    expect(verificarVitestConfig(conLinea("    // passWithNoTests: true"))).toEqual([]);
    expect(verificarVitestConfig(conLinea("    otra: { passWithNoTests: true },"))).toEqual([]);
    expect(verificarVitestConfig(conLinea("    passWithNoTests: false,"))).toEqual([]);
  });

  it("`passWithNoTests: true` deja pasar una corrida sin pruebas: se rechaza, escrito como se escriba", () => {
    for (const linea of [
      "    passWithNoTests: true,",
      "    passWithNoTests : true,",
      "    passWithNoTests:true,",
      "    passWithNoTests:   true, // por ahora",
    ]) {
      const texto = conLinea(linea);
      expect(verificarVitestConfig(texto), linea).toEqual([
        {
          codigo: "vitest-excluye-pruebas",
          archivo: ARCHIVO,
          linea: numeroDe(texto, "passWithNoTests"),
          motivo:
            "`passWithNoTests: true` deja pasar una corrida sin pruebas: «pasó» no significaría que se probó algo.",
          correccion: "Sacá `passWithNoTests`.",
        },
      ]);
    }
  });

  it("sin proyecto «node» ni `include` de las pruebas, la línea es la de `projects:` y la de `include:` (1 si no están)", () => {
    expect(verificarVitestConfig("export default {};")).toEqual([
      {
        codigo: "vitest-sin-proyecto-node",
        archivo: ARCHIVO,
        linea: 1,
        motivo:
          'Vitest ya no tiene un proyecto llamado "node": `npm test` (`--project node`) no correría las pruebas del guardián.',
        correccion: 'Dejá el proyecto de Node con `name: "node"`.',
      },
      {
        codigo: "vitest-sin-pruebas-del-guardian",
        archivo: ARCHIVO,
        linea: 1,
        motivo:
          'El proyecto de Node de Vitest ya no incluye "test/**/*.test.ts": las pruebas del guardián y la matriz no correrían.',
        correccion: 'Volvé a incluir "test/**/*.test.ts" en el proyecto «node».',
      },
    ]);
    const texto = [
      "export default {",
      "  projects: [",
      '    { name: "otro",',
      '      include: ["src/**/*.test.ts"] },',
      "  ],",
      "};",
    ].join("\n");
    const problemas = verificarVitestConfig(texto);
    expect(codigos(problemas)).toEqual([
      "vitest-sin-proyecto-node",
      "vitest-sin-pruebas-del-guardian",
    ]);
    expect(lineas(problemas)).toEqual([2, 4]);
  });
});

// --- pruebas del guardián ------------------------------------------------------------------------------

describe("escanearPruebasDelGuardian", () => {
  const completas = (cambios: Record<string, string> = {}): Record<string, string> => ({
    ...Object.fromEntries(PRUEBAS_DEL_GUARDIAN.map((nombre) => [nombre, "it('x', () => {});\n"])),
    ...cambios,
  });
  // Las líneas de salto se arman con piezas: este archivo también lo escanea M4.
  const salto = (inicio: string, fin: string): string => inicio + fin;
  const NUCLEO = "guardian-nucleo.test.ts";

  it("las pruebas del guardián sin saltos no tienen problemas", () => {
    expect(escanearPruebasDelGuardian(completas())).toEqual([]);
  });

  it("los saltos permitidos son los de «sin .git», cada uno con su constante, tal cual (con o sin sangría)", () => {
    const si = "skip" + "If";
    const permitidos = SALTOS_PERMITIDOS.map((s) => [s.archivo, s.linea, s.requiere]);
    expect(permitidos).toEqual([
      [NUCLEO, `const describeConGit = describe.${si}(SIN_GIT);`, "const SIN_GIT = !HAY_GIT;"],
      [NUCLEO, `const itConGit = it.${si}(SIN_GIT);`, "const SIN_GIT = !HAY_GIT;"],
      ["guardian-clasificacion.test.ts", `const describeConGit = describe.${si}(!HAY_GIT);`, null],
    ]);
    for (const { archivo, linea, requiere } of SALTOS_PERMITIDOS) {
      const exacto = `${linea}\n${requiere ?? ""}\n`;
      expect(escanearPruebasDelGuardian(completas({ [archivo]: exacto })), linea).toEqual([]);
      const conSangria = `  ${linea}\n\t${requiere ?? ""}\n`;
      expect(escanearPruebasDelGuardian(completas({ [archivo]: conSangria })), linea).toEqual([]);
    }
  });

  it("un salto que depende de una constante solo se admite si la constante está definida, no con una línea vacía", () => {
    for (const { archivo, linea } of SALTOS_PERMITIDOS.filter((s) => s.requiere !== null)) {
      for (const sinConstante of [`${linea}\n`, `${linea}\n\n   \nconst SIN_GIT = false;\n`]) {
        const problemas = escanearPruebasDelGuardian(completas({ [archivo]: sinConstante }));
        expect(codigos(problemas), sinConstante).toEqual(["prueba-saltada"]);
        expect(problemas[0]?.linea).toBe(1);
        expect(problemas[0]?.archivo).toBe(`test/arquitectura/${archivo}`);
      }
    }
  });

  it("en el archivo del salto permitido, otro salto distinto tampoco vale, aunque la constante esté", () => {
    for (const { archivo, requiere } of SALTOS_PERMITIDOS) {
      const otro = salto("it.sk", 'ip("otra", () => {});');
      const problemas = escanearPruebasDelGuardian(
        completas({ [archivo]: `${requiere ?? ""}\n${otro}\n` }),
      );
      expect(
        problemas.map((p) => [p.codigo, p.linea]),
        archivo,
      ).toEqual([["prueba-saltada", 2]]);
    }
  });

  it("un salto permitido en otro archivo no vale", () => {
    const [primero] = SALTOS_PERMITIDOS;
    const problemas = escanearPruebasDelGuardian(
      completas({
        "guardian-registro.test.ts": `${primero?.requiere ?? ""}\n${primero?.linea ?? ""}\n`,
      }),
    );
    expect(problemas).toEqual([
      {
        codigo: "prueba-saltada",
        archivo: "test/arquitectura/guardian-registro.test.ts",
        linea: 2,
        motivo: `La línea «${primero?.linea}» salta, deja pendiente, filtra o condiciona pruebas del guardián y no está entre los saltos permitidos.`,
        correccion:
          "Sacá el salto: las pruebas del guardián y la matriz corren siempre (el único salto admitido es por falta de .git).",
      },
    ]);
  });

  it("el mensaje de un salto trae la línea sin la sangría, y los archivos se recorren en orden alfabético", () => {
    const problemas = escanearPruebasDelGuardian({
      ...completas(),
      "guardian-zeta.test.ts": `\n    ${salto("it.sk", 'ip("z", () => {});')}\n`,
      "guardian-alfa.test.ts": `${salto("describe.o", 'nly("a", () => {});')}\n`,
    });
    expect(problemas.map((p) => [p.archivo, p.linea, p.motivo])).toEqual([
      [
        "test/arquitectura/guardian-alfa.test.ts",
        1,
        `La línea «${salto("describe.o", 'nly("a", () => {});')}» salta, deja pendiente, filtra o condiciona pruebas del guardián y no está entre los saltos permitidos.`,
      ],
      [
        "test/arquitectura/guardian-zeta.test.ts",
        2,
        `La línea «${salto("it.sk", 'ip("z", () => {});')}» salta, deja pendiente, filtra o condiciona pruebas del guardián y no está entre los saltos permitidos.`,
      ],
    ]);
  });

  it("reconoce cada forma de saltar, dejar pendiente, filtrar o condicionar una prueba", () => {
    const formas: [string, string][] = [
      ["describe.sk", 'ip("x", f)'],
      ["it.to", 'do("x")'],
      ["test.on", 'ly("x", f)'],
      ["suite.run", "If(c)('x', f)"],
      ["it.concurrent.sk", 'ip("x", f)'],
      ["describe.sequential.sk", "ipIf(c)('x', f)"],
      ["it.fai", 'ls("x", f)'],
      ["x", 'it("x", f)'],
      ["x", 'it ("x", f)'],
      ["x", 'test("x", f)'],
      ["x", 'describe("x", f)'],
      ["f", 'it("x", f)'],
      ["f", 'it  ("x", f)'],
      ["f", 'describe("x", f)'],
      ["ctx.sk", "ip()"],
      ["context.sk", "ip ()"],
      ["task.sk", "ip(  )"],
    ];
    for (const [inicio, fin] of formas) {
      const linea = salto(inicio, fin);
      const problemas = escanearPruebasDelGuardian(
        completas({ "guardian-x.test.ts": `${linea}\n` }),
      );
      expect(codigos(problemas), linea).toEqual(["prueba-saltada"]);
    }
  });

  it("no confunde con saltos las pruebas comunes ni los nombres parecidos", () => {
    const comunes = [
      'it("x", () => {});',
      'describe("saltar", () => {});',
      "it.each([1])('x', f);",
      "const exito = 1;",
      "fit_for_work(1);",
      "limit.skip(1);",
      "ctx.skipped();",
      "ctx.skip;",
      "xits(1);",
      "it.skipping();",
      "it.onlyOne();",
      "mi.it.todo2();",
      "// la prueba corre siempre",
    ];
    expect(
      escanearPruebasDelGuardian(completas({ "guardian-x.test.ts": comunes.join("\n") })),
    ).toEqual([]);
  });

  it("falta una de las pruebas que el mecanismo exige: se rechaza con su archivo", () => {
    const archivos = completas();
    delete archivos["guardian-nucleo.test.ts"];
    expect(escanearPruebasDelGuardian(archivos)).toEqual([
      {
        codigo: "pruebas-del-guardian-borradas",
        archivo: "test/arquitectura/guardian-nucleo.test.ts",
        linea: 1,
        motivo:
          "Falta test/arquitectura/guardian-nucleo.test.ts: una prueba del guardián se borró o se renombró.",
        correccion: "Restituí el archivo de prueba: el guardián se protege con ellas.",
      },
    ]);
  });
});

// --- informe de evidencia y canario --------------------------------------------------------------------

describe("verificarInformeDeEvidencia", () => {
  const informe = (cambios: Record<string, unknown> = {}): Record<string, unknown> => ({
    resultado: "pasa",
    analisisCompleto: true,
    totales: { rutas: 3, rutasClasificadas: 3, fallas: 0 },
    reglasEjecutadas: {
      chequeos: CODIGOS_DE_FALLA.map((codigo) => ({ codigo })),
      clasificacion: [{ nivel: 1 }],
    },
    ...cambios,
  });
  const evidencia = (motivo: string): Problema => ({
    codigo: "informe-sin-evidencia",
    archivo: "arquitectura/contratos/informe.json",
    linea: 1,
    motivo: `El informe del guardián no sirve como evidencia: ${motivo}.`,
    correccion: "Un «pasó» tiene que venir con qué se analizó: rutas, clases y reglas ejecutadas.",
  });
  const reglas = (cambios: Record<string, unknown>): Record<string, unknown> => ({
    chequeos: CODIGOS_DE_FALLA.map((codigo) => ({ codigo })),
    clasificacion: [{ nivel: 1 }],
    ...cambios,
  });

  it("un informe que pasa y trae toda su evidencia es válido", () => {
    expect(verificarInformeDeEvidencia(informe())).toEqual([]);
  });

  it("un «pasó» sin análisis completo, sin rutas, sin clasificarlas todas o con fallas no sirve", () => {
    expect(verificarInformeDeEvidencia(informe({ analisisCompleto: false }))).toEqual([
      evidencia("el análisis no se completó"),
    ]);
    expect(verificarInformeDeEvidencia(informe({ analisisCompleto: undefined }))).toEqual([
      evidencia("el análisis no se completó"),
    ]);
    expect(
      verificarInformeDeEvidencia(
        informe({ totales: { rutas: 0, rutasClasificadas: 0, fallas: 0 } }),
      ),
    ).toEqual([evidencia("no analizó ninguna ruta")]);
    expect(
      verificarInformeDeEvidencia(
        informe({ totales: { rutas: 3, rutasClasificadas: 2, fallas: 0 } }),
      ),
    ).toEqual([evidencia("no clasificó todas las rutas")]);
    expect(
      verificarInformeDeEvidencia(
        informe({ totales: { rutas: 3, rutasClasificadas: 3, fallas: 2 } }),
      ),
    ).toEqual([evidencia("dice que pasa pero cuenta fallas")]);
  });

  it("sin totales no hay evidencia de rutas ni de fallas, y no se rompe", () => {
    expect(verificarInformeDeEvidencia(informe({ totales: undefined }))).toEqual([
      evidencia("no analizó ninguna ruta"),
      evidencia("dice que pasa pero cuenta fallas"),
    ]);
  });

  it("todos los motivos de un «pasó» sin evidencia se informan juntos y en orden", () => {
    const motivos = verificarInformeDeEvidencia(
      informe({ analisisCompleto: false, totales: { rutas: 0, rutasClasificadas: 1, fallas: 4 } }),
    );
    expect(motivos).toEqual([
      evidencia("el análisis no se completó"),
      evidencia("no analizó ninguna ruta"),
      evidencia("no clasificó todas las rutas"),
      evidencia("dice que pasa pero cuenta fallas"),
    ]);
  });

  it("un informe que dice «falla» no necesita rutas, análisis completo ni cero fallas", () => {
    const falla = informe({
      resultado: "falla",
      analisisCompleto: false,
      totales: { rutas: 0, rutasClasificadas: 1, fallas: 4 },
    });
    expect(verificarInformeDeEvidencia(falla)).toEqual([]);
  });

  it("las reglas ejecutadas tienen que listar todos los chequeos, pase o falle", () => {
    const primeros = CODIGOS_DE_FALLA.slice(0, 4);
    const faltan = CODIGOS_DE_FALLA.length - 4;
    const esperado = evidencia(
      `las reglas ejecutadas no listan ${faltan} chequeos (p. ej. «${CODIGOS_DE_FALLA[4]}»)`,
    );
    for (const resultado of ["pasa", "falla"]) {
      const cambios = {
        resultado,
        reglasEjecutadas: reglas({ chequeos: primeros.map((codigo) => ({ codigo })) }),
      };
      expect(verificarInformeDeEvidencia(informe(cambios)), resultado).toEqual([esperado]);
    }
  });

  it("sin la lista de chequeos, o sin las reglas, faltan todos los códigos y no se rompe", () => {
    const todos = evidencia(
      `las reglas ejecutadas no listan ${CODIGOS_DE_FALLA.length} chequeos (p. ej. «${CODIGOS_DE_FALLA[0]}»)`,
    );
    const sinClasificacion = evidencia("no lista las reglas de clasificación que corrió");
    expect(
      verificarInformeDeEvidencia(informe({ reglasEjecutadas: reglas({ chequeos: undefined }) })),
    ).toEqual([todos]);
    expect(verificarInformeDeEvidencia(informe({ reglasEjecutadas: undefined }))).toEqual([
      todos,
      sinClasificacion,
    ]);
  });

  it("sin reglas de clasificación (ausentes o vacías) el informe no sirve como evidencia", () => {
    for (const clasificacion of [undefined, []]) {
      expect(
        verificarInformeDeEvidencia(informe({ reglasEjecutadas: reglas({ clasificacion }) })),
      ).toEqual([evidencia("no lista las reglas de clasificación que corrió")]);
    }
  });
});

describe("evaluarCanario", () => {
  const ESPERADAS = [
    { archivo: "a.ts", linea: 1 },
    { archivo: "b.ts", linea: 22 },
  ];
  const DIAGNOSTICO = "FALLA a.ts:1 · contrato · motivo\nFALLA b.ts:22 · contrato · motivo\n";

  it("un guardián que sale con 0 sobre el repo roto no está analizando", () => {
    expect(evaluarCanario({ estado: 0, salidaDeError: DIAGNOSTICO }, ESPERADAS, "g.cjs")).toEqual([
      {
        codigo: "canario-pasa-un-repo-roto",
        archivo: "g.cjs",
        linea: 1,
        motivo:
          "El guardián salió con 0 sobre un repositorio roto conocido (el canario): no está analizando.",
        correccion:
          "Restituí el guardián real: tiene que salir distinto de 0 cuando el repositorio está roto.",
      },
    ]);
  });

  it("con estado distinto de 0 y todas las fallas diagnosticadas, el canario pasa", () => {
    expect(evaluarCanario({ estado: 1, salidaDeError: DIAGNOSTICO }, ESPERADAS, "g.cjs")).toEqual(
      [],
    );
  });

  it("si no terminó, lista todo lo que no diagnosticó, separado por comas", () => {
    expect(evaluarCanario({ estado: null, salidaDeError: "" }, ESPERADAS, "g.cjs")).toEqual([
      {
        codigo: "canario-sin-diagnostico",
        archivo: "g.cjs",
        linea: 1,
        motivo:
          "El guardián no terminó sobre el repo roto conocido: no hay diagnóstico de a.ts:1, b.ts:22.",
        correccion:
          "El guardián tiene que imprimir `archivo:línea · contrato · motivo · corrección` por cada falla.",
      },
    ]);
  });

  it("si terminó con error pero no dijo dónde, lo que falta es solo lo no diagnosticado", () => {
    const salida = "FALLA a.ts:1 · contrato · motivo\nFALLA b.ts:2 · otro\n";
    expect(evaluarCanario({ estado: 3, salidaDeError: salida }, ESPERADAS, "g.cjs")).toEqual([
      {
        codigo: "canario-sin-diagnostico",
        archivo: "g.cjs",
        linea: 1,
        motivo:
          "El guardián salió con 3 pero no diagnosticó b.ts:22 (archivo:línea): rechazar sin decir por qué no sirve.",
        correccion:
          "El guardián tiene que imprimir `archivo:línea · contrato · motivo · corrección` por cada falla.",
      },
    ]);
    const nadaDiagnosticado = evaluarCanario({ estado: 2, salidaDeError: "" }, ESPERADAS, "g.cjs");
    expect(nadaDiagnosticado[0]?.motivo).toBe(
      "El guardián salió con 2 pero no diagnosticó a.ts:1, b.ts:22 (archivo:línea): rechazar sin decir por qué no sirve.",
    );
  });
});
