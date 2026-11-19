import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `cargar-entorno-consola.yml` (excepción aprobada por el dueño el 2026-11-19: único flujo, además de `migrar.yml`, `cargar-entorno.yml` y
 * `preparar-empresa-de-pruebas.yml`, que usa la cadena DIRECTA del dueño de la base y escribe en Vercel con un token con alcance a los
 * dos proyectos). Lo que se fija acá, con una violación inyectada por cada propiedad: solo `preview`; solo manual desde `main` y con
 * frase; nada de `NEON_API_KEY` ni de secretos fuera de la lista exacta; los secretos solo por `env:` (nunca dentro de un `run:`); nada
 * que imprima el entorno ni escriba `GITHUB_ENV`/`GITHUB_OUTPUT`; acciones fijadas por hash; mismo grupo de concurrencia que los
 * demás flujos de preview. Previene: un flujo que escriba en producción, que filtre una cadena o un token, o que pise otra corrida.
 */

const ARCHIVO = join(import.meta.dirname, "../../.github/workflows/cargar-entorno-consola.yml");
const REAL = readFileSync(ARCHIVO, "utf8");

const SECRETOS_PERMITIDOS = ["PEDERNAL_DB_DUENO_DIRECTA", "PEDERNAL_VERCEL_TOKEN_CONSOLA"];

const sinComentarios = (texto: string) =>
  texto
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

function pasosDe(texto: string): { nombre: string; texto: string }[] {
  return texto
    .split(/\n {6}- /)
    .slice(1)
    .map((bloque) => ({
      nombre: /name: (.+)/.exec(bloque)?.[1] ?? /uses: (\S+)/.exec(bloque)?.[1] ?? "",
      texto: bloque,
    }));
}

/** Las líneas dentro de los bloques `run: |` y `run: <una línea>` (lo que el shell ve). */
function cuerposDeRun(texto: string): string[] {
  const lineas = texto.split("\n");
  const cuerpos: string[] = [];
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i] ?? "";
    const m = /^(\s*)run:\s*(.*)$/.exec(linea);
    if (m === null) continue;
    if (m[2] !== "|" && m[2] !== "") {
      cuerpos.push(m[2] ?? "");
      continue;
    }
    const sangria = (m[1] ?? "").length;
    for (let j = i + 1; j < lineas.length; j++) {
      const l = lineas[j] ?? "";
      if (l.trim() !== "" && l.length - l.trimStart().length <= sangria) break;
      cuerpos.push(l);
    }
  }
  return cuerpos;
}

/** Los códigos de las propiedades que el texto NO cumple (vacío = todo bien). */
function problemasDelWorkflow(texto: string): string[] {
  const limpio = sinComentarios(texto);
  const pasos = pasosDe(limpio);
  const runs = cuerposDeRun(limpio).join("\n");
  const problemas: string[] = [];
  const exigir = (codigo: string, cumple: boolean) => {
    if (!cumple) problemas.push(codigo);
  };

  // Solo manual, desde main y con frase; el job con secretos depende de esa validación.
  exigir(
    "solo-manual",
    /\non:\n {2}workflow_dispatch:/.test(limpio) &&
      !/pull_request|push:|schedule:|workflow_run/.test(limpio),
  );
  exigir(
    "desde-main",
    limpio.includes('"$REF" != "refs/heads/main"') &&
      limpio.includes("CONFIRMACION: ${{ inputs.confirmacion }}"),
  );
  exigir("frase", limpio.includes('"$CONFIRMACION" != "CARGAR CONSOLA PREVIEW"'));
  exigir("validar-antes", /\n {4}needs: validar\n/.test(limpio));

  // Solo preview: Environment fijo, destino literal, ningún ambiente elegible ni producción.
  exigir(
    "environment-preview",
    /\n {4}environment: preview\n/.test(limpio) && !/environment:\s*\$\{\{/.test(limpio),
  );
  exigir(
    "destino-literal",
    /\n {10}DESTINO: preview\n/.test(limpio) && !/DESTINO:\s*\$\{\{/.test(limpio),
  );
  exigir(
    "sin-produccion",
    !/produccion|production/i.test(limpio) && !/inputs\.(ambiente|destino|entorno)/.test(limpio),
  );

  // Secretos: lista exacta, solo por `env:`, nunca dentro de un `run:`; sin Neon ni otros.
  const usados = [...limpio.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1] ?? "");
  exigir(
    "secretos-lista-exacta",
    usados.length > 0 && usados.every((s) => SECRETOS_PERMITIDOS.includes(s)),
  );
  exigir("sin-neon", !/NEON_/.test(limpio));
  exigir("secretos-solo-por-env", !/\$\{\{\s*(secrets|inputs|github)\./.test(runs));
  exigir(
    "sin-secrets-inherit",
    !/secrets:\s*inherit/.test(limpio) && !/toJSON\(secrets\)/.test(limpio),
  );

  // Nada que imprima o pase valores a otros pasos.
  exigir(
    "sin-imprimir-entorno",
    !/\b(printenv|set -x|set -o xtrace)\b|(^|\s)env\s*($|\||>)|echo\s+["']?\$\{?(PEDERNAL|SECRET|TOKEN)/m.test(
      runs,
    ),
  );
  exigir(
    "sin-escribir-entorno-ni-salidas",
    !/GITHUB_ENV|GITHUB_OUTPUT|GITHUB_STEP_SUMMARY|set-output|upload-artifact/.test(limpio),
  );

  // Permisos, concurrencia y acciones.
  exigir(
    "permisos-minimos",
    /\npermissions:\n {2}contents: read\n/.test(limpio) &&
      /permissions: \{\}/.test(limpio) &&
      !/write/.test(limpio.replace(/Escribir/g, "")),
  );
  exigir("concurrencia", /group: migrar-preview\n\s+cancel-in-progress: false/.test(limpio));
  const acciones = [...limpio.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1] ?? "");
  exigir(
    "acciones-fijadas",
    acciones.length === 2 && acciones.every((a) => /@[0-9a-f]{40}$/.test(a)),
  );
  exigir("sin-credenciales-persistentes", limpio.includes("persist-credentials: false"));
  exigir("sin-cache", !/cache:/.test(limpio));
  exigir("dependencias-de-produccion", limpio.includes("npm ci --omit=dev --ignore-scripts"));

  // El orden de los pasos con secretos: comprobar el Environment, base al día, cargar (una sola vez).
  const nombres = pasos.map((p) => p.nombre);
  exigir(
    "base-al-dia-antes-de-cargar",
    nombres.findIndex((n) => n.includes("al día")) >= 0 &&
      nombres.findIndex((n) => n.includes("al día")) <
        nombres.findIndex((n) => n.includes("Cargar la consola")),
  );
  exigir(
    "un-solo-paso-que-carga",
    (limpio.match(/npm run consola:cargar-entorno/g) ?? []).length === 1,
  );
  exigir("rotar-por-env", /ROTAR: \$\{\{ inputs\.rotar \}\}/.test(limpio));
  return problemas;
}

describe("workflow cargar-entorno-consola.yml", () => {
  it("el archivo real cumple todas las propiedades", () => {
    expect(problemasDelWorkflow(REAL)).toEqual([]);
  });

  const violaciones: Array<[string, string, (t: string) => string]> = [
    [
      "solo-manual",
      "se dispara con un push",
      (t) => t.replace("on:\n  workflow_dispatch:", "on:\n  push:\n  workflow_dispatch:"),
    ],
    [
      "desde-main",
      "acepta cualquier rama",
      (t) => t.replace('"$REF" != "refs/heads/main"', '"$REF" != ""'),
    ],
    [
      "frase",
      "sin frase de confirmación",
      (t) => t.replace('"$CONFIRMACION" != "CARGAR CONSOLA PREVIEW"', '"$CONFIRMACION" != ""'),
    ],
    [
      "validar-antes",
      "el job con secretos no espera a validar",
      (t) => t.replace("    needs: validar\n", ""),
    ],
    [
      "environment-preview",
      "Environment elegible",
      (t) => t.replace("    environment: preview\n", "    environment: ${{ inputs.ambiente }}\n"),
    ],
    [
      "destino-literal",
      "destino elegible",
      (t) =>
        t.replace("          DESTINO: preview\n", "          DESTINO: ${{ inputs.destino }}\n"),
    ],
    [
      "sin-produccion",
      "nombra producción",
      (t) =>
        t.replace(
          "          DESTINO: preview\n",
          "          DESTINO: preview\n          OTRO: production\n",
        ),
    ],
    [
      "secretos-lista-exacta",
      "un secreto de más",
      (t) =>
        t.replace(
          "          DESTINO: preview\n",
          "          DESTINO: preview\n          OTRO: ${{ secrets.CRON_SECRET }}\n",
        ),
    ],
    [
      "sin-neon",
      "usa la API de Neon",
      (t) =>
        t.replace(
          "          DESTINO: preview\n",
          "          DESTINO: preview\n          NEON_API_KEY: ${{ secrets.PEDERNAL_DB_DUENO_DIRECTA }}\n",
        ),
    ],
    [
      "secretos-solo-por-env",
      "un secreto dentro de un run",
      (t) =>
        t.replace(
          "run: npm run consola:cargar-entorno",
          "run: echo ${{ secrets.PEDERNAL_VERCEL_TOKEN_CONSOLA }} && npm run consola:cargar-entorno",
        ),
    ],
    [
      "sin-secrets-inherit",
      "hereda todos los secretos",
      (t) =>
        t.replace("    environment: preview\n", "    environment: preview\n    secrets: inherit\n"),
    ],
    [
      "sin-imprimir-entorno",
      "imprime el entorno",
      (t) =>
        t.replace(
          "run: npm run consola:cargar-entorno",
          "run: printenv && npm run consola:cargar-entorno",
        ),
    ],
    [
      "sin-escribir-entorno-ni-salidas",
      "escribe GITHUB_ENV",
      (t) =>
        t.replace(
          "run: npm run consola:cargar-entorno",
          'run: echo "X=1" >> "$GITHUB_ENV" && npm run consola:cargar-entorno',
        ),
    ],
    [
      "permisos-minimos",
      "permiso de escritura",
      (t) => t.replace("permissions:\n  contents: read\n", "permissions:\n  contents: write\n"),
    ],
    [
      "concurrencia",
      "cancela lo que ya corre",
      (t) => t.replace("cancel-in-progress: false", "cancel-in-progress: true"),
    ],
    [
      "acciones-fijadas",
      "acción sin hash",
      (t) => t.replace(/actions\/checkout@[0-9a-f]{40}/, "actions/checkout@v4"),
    ],
    [
      "sin-credenciales-persistentes",
      "credenciales persistentes",
      (t) => t.replace("persist-credentials: false", "persist-credentials: true"),
    ],
    [
      "sin-cache",
      "caché de npm",
      (t) => t.replace("node-version: 24\n", "node-version: 24\n          cache: npm\n"),
    ],
    [
      "dependencias-de-produccion",
      "instala todo con scripts",
      (t) => t.replace("npm ci --omit=dev --ignore-scripts", "npm ci"),
    ],
    [
      "un-solo-paso-que-carga",
      "carga dos veces",
      (t) =>
        t.replace(
          "      - name: Cargar la consola",
          "      - run: npm run consola:cargar-entorno\n      - name: Cargar la consola",
        ),
    ],
    [
      "rotar-por-env",
      "rotar interpolado en el shell",
      (t) => t.replace("ROTAR: ${{ inputs.rotar }}", "ROTAR: ${{ github.event.inputs.rotar }}"),
    ],
  ];

  for (const [codigo, descripcion, mutar] of violaciones) {
    it(`falla con «${codigo}» si ${descripcion}`, () => {
      const mutado = mutar(REAL);
      expect(mutado).not.toBe(REAL);
      expect(problemasDelWorkflow(mutado)).toContain(codigo);
    });
  }
});
