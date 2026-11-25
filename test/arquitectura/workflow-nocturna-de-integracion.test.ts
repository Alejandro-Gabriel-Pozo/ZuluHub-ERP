import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { BASE_DE_INTEGRACION } = require("../../arquitectura/planificar-mutacion.cjs") as {
  BASE_DE_INTEGRACION: string;
};
const RAIZ = join(import.meta.dirname, "../..");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

/**
 * `nocturna-de-integracion.yml` dispara la corrida COMPLETA (`ci.yml` y `codeql.yml`) sobre la rama de integración (dueño, 25/11/2026: los pull requests hacia ella corren el CI
 * liviano y esta es la red que lo respalda; el `schedule` de GitHub solo corre desde `main`, por eso el workflow vive aparte y dispara con `workflow_dispatch` sobre una rama fija).
 * Previene: que el CI liviano deje sin mirar la mutación y las intermitencias para siempre (nadie la dispara), o que el disparador gane permisos de más o ejecute algo que viene
 * de afuera. LÍMITES (como los demás tests de workflows: no hay lector de YAML): es un análisis de TEXTO del estilo que Prettier impone; `zizmor` (job `flujos`) audita el resto.
 */
const DISPAROS = [
  "gh workflow run ci.yml --ref integracion/modulos-v2",
  "gh workflow run codeql.yml --ref integracion/modulos-v2",
];

function problemasDeLaNocturna(yaml: string): string[] {
  const problemas: string[] = [];
  const disparadores = /^on:\n((?: {2}.*\n|\n)+)/m.exec(yaml)?.[1] ?? "";
  const claves = [...disparadores.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
  if (JSON.stringify(claves) !== JSON.stringify(["schedule", "workflow_dispatch"])) {
    problemas.push(
      `dispara con [${claves.join(", ")}] y debe ser solo [schedule, workflow_dispatch]`,
    );
  }
  if (!/^ {4}- cron: "[0-9*/ ,-]+"$/m.test(disparadores)) problemas.push("no tiene un cron");
  if (!/^permissions: \{\}$/m.test(yaml))
    problemas.push("el nivel del workflow tiene que ser `permissions: {}`");
  const permisosDelJob = /^ {4}permissions:\n((?: {6}[a-z-]+: [a-z]+\n)+)/m.exec(yaml)?.[1];
  if (permisosDelJob !== "      actions: write\n") {
    problemas.push(
      `los permisos del job tienen que ser solo \`actions: write\` y son «${(permisosDelJob ?? "(ninguno)").trim()}»`,
    );
  }
  if (/^\s*(?:- )?uses:/m.test(yaml))
    problemas.push("usa acciones de terceros (`uses:`); solo corre `gh`");
  if (/secrets\./.test(yaml)) problemas.push("usa secretos");
  if (/pull_request/.test(yaml)) problemas.push("menciona pull_request");
  const comandos = [...yaml.matchAll(/^ {6,8}(?:- )?run: (.*)$/gm)].map((m) => (m[1] ?? "").trim());
  if (JSON.stringify(comandos) !== JSON.stringify(DISPAROS)) {
    problemas.push(`corre [${comandos.join(" · ")}] y debe correr [${DISPAROS.join(" · ")}]`);
  }
  if (/run:.*\$\{\{/.test(yaml))
    problemas.push("interpola una expresión dentro de un `run:` (inyección)");
  if (!/^ {2}group: nocturna-de-integracion\n {2}cancel-in-progress: false$/m.test(yaml)) {
    problemas.push("la concurrencia tiene que ser el grupo propio y sin cancelar");
  }
  if (!/^ {4}timeout-minutes: [1-9]\d*$/m.test(yaml))
    problemas.push("el job no tiene `timeout-minutes`");
  return problemas;
}

describe("nocturna-de-integracion.yml", () => {
  const real = leer(".github/workflows/nocturna-de-integracion.yml");

  it("el workflow real cumple todo", () => {
    expect(problemasDeLaNocturna(real)).toEqual([]);
  });

  it("la rama que dispara es la de integración del planificador (una sola fuente)", () => {
    expect(BASE_DE_INTEGRACION).toBe("integracion/modulos-v2");
    for (const disparo of DISPAROS)
      expect(disparo.endsWith(`--ref ${BASE_DE_INTEGRACION}`)).toBe(true);
    expect(real).toContain(`--ref ${BASE_DE_INTEGRACION}`);
  });

  it("los dos workflows que dispara aceptan `workflow_dispatch`", () => {
    expect(leer(".github/workflows/ci.yml")).toMatch(/^ {2}workflow_dispatch:\s*$/m);
    expect(leer(".github/workflows/codeql.yml")).toMatch(/^ {2}workflow_dispatch:\s*$/m);
  });

  const alterar = (de: string, a: string) => {
    expect(real).toContain(de);
    return problemasDeLaNocturna(real.replace(de, a));
  };

  it("VIOLACIÓN: un disparador de más (pull_request, push) falla", () => {
    expect(
      alterar("  workflow_dispatch:\n", "  workflow_dispatch:\n  push:\n").join("\n"),
    ).toContain("dispara con");
    expect(
      alterar("  workflow_dispatch:\n", "  workflow_dispatch:\n  pull_request:\n").join("\n"),
    ).toContain("menciona pull_request");
  });

  it("VIOLACIÓN: sin cron falla", () => {
    expect(alterar('    - cron: "17 6 * * *"\n', "").join("\n")).toContain("no tiene un cron");
  });

  it("VIOLACIÓN: más permisos (contents: write) o permisos de workflow falla", () => {
    expect(
      alterar("      actions: write\n", "      actions: write\n      contents: write\n").join("\n"),
    ).toContain("los permisos del job");
    expect(alterar("permissions: {}", "permissions:\n  contents: read").join("\n")).toContain(
      "permissions: {}",
    );
  });

  it("VIOLACIÓN: una acción de terceros falla", () => {
    expect(
      alterar("    steps:\n", "    steps:\n      - uses: actions/checkout@abc\n").join("\n"),
    ).toContain("`uses:`");
  });

  it("VIOLACIÓN: otra rama (distinta de la de integración) o un comando de más falla", () => {
    expect(
      alterar(
        "gh workflow run ci.yml --ref integracion/modulos-v2",
        "gh workflow run ci.yml --ref main",
      ).join("\n"),
    ).toContain("debe correr");
    expect(
      alterar(
        "        run: gh workflow run codeql.yml --ref integracion/modulos-v2\n",
        "        run: gh workflow run codeql.yml --ref integracion/modulos-v2\n      - run: gh workflow run mutacion.yml\n",
      ).join("\n"),
    ).toContain("debe correr");
  });

  it("VIOLACIÓN: una expresión interpolada en el comando (inyección) o un secreto falla", () => {
    expect(
      alterar(
        "--ref integracion/modulos-v2\n      - name: CodeQL",
        "--ref ${{ github.head_ref }}\n      - name: CodeQL",
      ).join("\n"),
    ).toContain("interpola");
    expect(
      alterar("GH_TOKEN: ${{ github.token }}", "GH_TOKEN: ${{ secrets.TOKEN }}").join("\n"),
    ).toContain("usa secretos");
  });

  it("VIOLACIÓN: sin concurrencia propia o sin tope de tiempo falla", () => {
    expect(
      alterar("  cancel-in-progress: false\n", "  cancel-in-progress: true\n").join("\n"),
    ).toContain("concurrencia");
    expect(alterar("    timeout-minutes: 5\n", "").join("\n")).toContain("timeout-minutes");
  });
});

describe("codeql.yml en el CI liviano", () => {
  const codeql = leer(".github/workflows/codeql.yml");

  it("los pull requests solo hacia main y la semanal y el disparo a pedido se conservan", () => {
    expect(codeql).toMatch(/^ {2}pull_request:\n {4}branches: \[main\]\n/m);
    expect(codeql).toMatch(/^ {2}schedule:\n {4}- cron: "17 5 \* \* 1"\n/m);
    expect(codeql).toMatch(/^ {2}workflow_dispatch:\s*$/m);
    expect(codeql).toMatch(/^ {2}push:\n {4}branches: \[main\]\n/m);
  });
});
