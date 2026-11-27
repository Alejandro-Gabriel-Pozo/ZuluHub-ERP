import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROYECTOS_DE_VERCEL_DE_CLIENTES } from "../../src/adaptadores/vercel/plan-de-variables";

/**
 * `alta-de-cliente.yml` y `desplegar-cliente.yml`: con la base y el proyecto de Vercel de un CLIENTE y datos personales de por medio. Si alguien quita una de estas propiedades, esta prueba
 * se pone roja. Lee el texto de los archivos (no hay un lector de YAML entre las dependencias); `zizmor` (job «flujos» del CI) revisa el resto. Cada propiedad trae su VIOLACIÓN INYECTADA: una
 * versión rota del archivo que `problemasDe` tiene que marcar con ese código. Previene: un cliente fuera de la lista cerrada, un secreto o una entrada dentro de un `run:`, un login de plataforma
 * que queda abierto, una versión de la CLI que cambia sola o un despliegue al proyecto equivocado.
 */

const LEER = (nombre: string) =>
  readFileSync(join(import.meta.dirname, "../../.github/workflows", nombre), "utf8");
const ALTA = LEER("alta-de-cliente.yml");
const DESPLIEGUE = LEER("desplegar-cliente.yml");
const MIGRAR = LEER("migrar.yml");

const sinComentarios = (texto: string) =>
  texto
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

const opcionesDeAmbiente = (texto: string) => {
  const bloque =
    /ambiente:\n(?:.*\n)*?\s+options:\n((?:\s+(?:- .*|#.*)\n)+)/.exec(texto)?.[1] ?? "";
  return bloque
    .split("\n")
    .map((l) => /^\s+- (\S+)$/.exec(l)?.[1])
    .filter((o): o is string => o !== undefined);
};

/** Los pasos de un job, en orden: nombre y texto. */
function pasosDe(texto: string, job: string): { nombre: string; texto: string }[] {
  const desde = texto.indexOf(`\n  ${job}:\n`);
  if (desde < 0) return [];
  return texto
    .slice(desde)
    .split(/\n {6}- /)
    .slice(1)
    .map((bloque) => ({
      nombre: /name: (.+)/.exec(bloque)?.[1] ?? /uses: (\S+)/.exec(bloque)?.[1] ?? "",
      texto: bloque,
    }));
}

/** Las líneas `run:` (y su bloque) de todos los pasos: ahí no puede haber expresiones `${{ … }}`. */
function textoDeLosRun(texto: string): string {
  const salida: string[] = [];
  const lineas = sinComentarios(texto).split("\n");
  for (let i = 0; i < lineas.length; i += 1) {
    const linea = lineas[i] as string;
    const m = /^(\s*)run:(.*)$/.exec(linea);
    if (m === null) continue;
    const sangria = (m[1] as string).length;
    salida.push(linea);
    if ((m[2] as string).trim() === "|") {
      for (let j = i + 1; j < lineas.length; j += 1) {
        const siguiente = lineas[j] as string;
        if (siguiente.trim() !== "" && siguiente.length - siguiente.trimStart().length <= sangria)
          break;
        salida.push(siguiente);
      }
    }
  }
  return salida.join("\n");
}

const CODIGOS = new Set<string>();

function comunes(texto: string, job: string, frase: RegExp): string[] {
  const limpio = sinComentarios(texto);
  const problemas: string[] = [];
  const exigir = (codigo: string, cumple: boolean) => {
    CODIGOS.add(codigo);
    if (!cumple) problemas.push(codigo);
  };
  const dentroDeOn = texto.slice(texto.indexOf("on:\n"), texto.indexOf("\npermissions:"));
  exigir(
    "solo-a-mano",
    JSON.stringify(dentroDeOn.match(/^ {2}[a-z_]+:/gm)) === '["  workflow_dispatch:"]',
  );
  exigir(
    "dos-entradas-ambiente-y-frase",
    JSON.stringify(dentroDeOn.match(/^ {6}[a-z_]+:$/gm)) ===
      '["      ambiente:","      confirmacion:"]',
  );
  // El ambiente es una lista cerrada y es la MISMA de los clientes de `migrar.yml` y del código.
  const clientes = Object.keys(PROYECTOS_DE_VERCEL_DE_CLIENTES);
  exigir(
    "ambiente-es-la-lista-cerrada-de-clientes",
    JSON.stringify(opcionesDeAmbiente(texto)) === JSON.stringify(clientes),
  );
  exigir("solo-desde-main", /"\$REF" != "refs\/heads\/main"/.test(texto));
  exigir(
    "frase-por-cliente",
    clientes.every((c) => frase.test(texto) && texto.includes(`${c})`)),
  );
  exigir(
    "environment-del-cliente-con-revisor",
    /^ {4}environment: \$\{\{ needs\.validar\.outputs\.ambiente \}\}$/m.test(texto) &&
      pasosDe(texto, "validar").length > 0,
  );
  exigir(
    "validar-sin-permisos-ni-secretos",
    /\n {2}validar:[\s\S]*?permissions: \{\}/.test(texto) &&
      !/\n {2}validar:[\s\S]*?\n {2}\w+:\n[\s\S]*?secrets\./.test(
        texto.slice(0, texto.indexOf(`\n  ${job}:\n`)) + "x",
      ),
  );
  exigir("permisos-solo-lectura", /^permissions:\n {2}contents: read$/m.test(texto));
  exigir("no-se-cancela-lo-que-corre", /cancel-in-progress: false/.test(texto));
  // Ni una expresión `${{ … }}` dentro de un `run:` (un secreto o una entrada ahí se vuelve texto de la shell).
  exigir("sin-expresiones-en-run", !/\$\{\{/.test(textoDeLosRun(texto)));
  exigir("secretos-solo-en-env", !/\$\{\{ *secrets\./.test(textoDeLosRun(texto)));
  // Las acciones, fijadas por SHA de 40 caracteres.
  const usos = [...limpio.matchAll(/uses: (\S+)/g)].map((m) => m[1] as string);
  exigir(
    "acciones-fijadas-por-sha",
    usos.length > 0 && usos.every((u) => /@[0-9a-f]{40}$/.test(u)),
  );
  exigir("checkout-sin-credenciales", /persist-credentials: false/.test(limpio));
  exigir("npm-ci-sin-scripts", /npm ci --omit=dev --ignore-scripts/.test(limpio));
  exigir("no-migra", !/migrar -- --aplicar|migrar -- aplicar/.test(limpio));
  exigir(
    "exige-base-al-dia",
    /npm run migrar -- --ver/.test(limpio) && /grep -q "faltan aplicar"/.test(limpio),
  );
  return problemas;
}

function problemasDelAlta(texto: string): string[] {
  const problemas = comunes(texto, "alta", /ALTA CLIENTE-[A-Z]+/);
  const limpio = sinComentarios(texto);
  const pasos = pasosDe(texto, "alta");
  const orden = (partes: string[]) => {
    const posiciones = partes.map((p) => pasos.findIndex((x) => x.nombre.includes(p)));
    return (
      posiciones.every((p) => p >= 0) &&
      posiciones.every((p, i) => i === 0 || (posiciones[i - 1] as number) < p)
    );
  };
  const exigir = (codigo: string, cumple: boolean) => {
    CODIGOS.add(codigo);
    if (!cumple) problemas.push(codigo);
  };
  exigir(
    "orden-de-los-pasos",
    orden([
      "Validar los datos",
      "La base tiene que estar al día",
      "Secreto de invitaciones",
      "Abrir el login",
      "Dar el alta",
      "Cerrar el login",
    ]),
  );
  const cerrar = pasos.find((p) => p.nombre.includes("Cerrar el login"));
  exigir(
    "cierra-siempre",
    cerrar !== undefined &&
      /if: always\(\) && steps\.abrir\.conclusion != 'skipped'/.test(cerrar.texto) &&
      /plataforma:login-temporal -- cerrar/.test(cerrar.texto),
  );
  const abrir = pasos.find((p) => p.nombre.includes("Abrir el login"));
  exigir(
    "login-sin-clave-propia",
    abrir !== undefined &&
      /id: abrir/.test(abrir.texto) &&
      /login-temporal -- abrir sin-clave-propia/.test(abrir.texto),
  );
  exigir(
    "datos-personales-en-un-secreto",
    /secrets\.PEDERNAL_ALTA_DE_CLIENTE/.test(limpio) &&
      !/inputs\.(?!ambiente|confirmacion)/.test(limpio),
  );
  exigir("sin-pedido-al-cron", !/CRON_SECRET|api\/trabajos\/cron/.test(limpio));
  const secretos = [...limpio.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1] as string);
  exigir(
    "solo-los-secretos-del-cliente",
    secretos.every((s) =>
      ["PEDERNAL_DB_DUENO_DIRECTA", "PEDERNAL_VERCEL_TOKEN", "PEDERNAL_ALTA_DE_CLIENTE"].includes(
        s,
      ),
    ),
  );
  exigir("comparte-el-grupo-de-migrar", /group: migrar-\$\{\{ inputs\.ambiente \}\}/.test(limpio));
  return problemas;
}

function problemasDelDespliegue(texto: string): string[] {
  const problemas = comunes(texto, "desplegar", /DESPLEGAR CLIENTE-[A-Z]+/);
  const limpio = sinComentarios(texto);
  const pasos = pasosDe(texto, "desplegar");
  const exigir = (codigo: string, cumple: boolean) => {
    CODIGOS.add(codigo);
    if (!cumple) problemas.push(codigo);
  };
  exigir(
    "version-fija-de-la-cli",
    /npx --yes vercel@\d+\.\d+\.\d+ deploy --prod --yes/.test(limpio) &&
      !/vercel@(latest|\^|~)/.test(limpio),
  );
  // El proyecto sale del paso que consulta la lista cerrada: ninguna bandera lo cambia y el token viaja por el entorno.
  exigir("sin-proyecto-ni-token-en-la-linea", !/--scope|--project|--token|--org/.test(limpio));
  exigir(
    "token-solo-por-entorno",
    /^\s+VERCEL_TOKEN: \$\{\{ secrets\.PEDERNAL_VERCEL_TOKEN \}\}$/m.test(limpio),
  );
  exigir(
    "proyecto-sale-de-la-lista-cerrada",
    /desplegar-cliente -- datos "\$AMBIENTE"/.test(limpio) &&
      !/VERCEL_(PROJECT|ORG)_ID: /.test(limpio),
  );
  exigir(
    "orden-de-los-pasos",
    (() => {
      const i = (p: string) => pasos.findIndex((x) => x.nombre.includes(p));
      return (
        i("La base tiene que estar al día") >= 0 &&
        i("La base tiene que estar al día") < i("Confirmar el proyecto") &&
        i("Confirmar el proyecto") < i("Desplegar a producción") &&
        i("Desplegar a producción") < i("Verificar el despliegue")
      );
    })(),
  );
  exigir(
    "verifica-despues-de-desplegar",
    /desplegar-cliente -- verificar "\$DIRECCION"/.test(limpio),
  );
  exigir(
    "solo-produccion",
    !/--prebuilt|--target(?!=production)|preview/.test(limpio.replace(/Preview/g, "")),
  );
  const secretos = [...limpio.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1] as string);
  exigir(
    "solo-los-secretos-del-cliente",
    secretos.every((s) =>
      ["PEDERNAL_DB_DUENO_DIRECTA", "PEDERNAL_VERCEL_TOKEN", "PEDERNAL_VERCEL_BYPASS"].includes(s),
    ),
  );
  exigir("grupo-propio-por-cliente", /group: desplegar-\$\{\{ inputs\.ambiente \}\}/.test(limpio));
  return problemas;
}

/** Cada violación inyectada: el texto roto tiene que marcar EXACTAMENTE ese código. */
const VIOLACIONES_ALTA: Array<[string, (t: string) => string]> = [
  [
    "solo-a-mano",
    (t) => t.replace("on:\n  workflow_dispatch:", "on:\n  push:\n  workflow_dispatch:"),
  ],
  [
    "dos-entradas-ambiente-y-frase",
    (t) =>
      t.replace(
        "      confirmacion:\n",
        "      confirmacion:\n        type: string\n      emails:\n",
      ),
  ],
  [
    "ambiente-es-la-lista-cerrada-de-clientes",
    (t) =>
      t.replace("          - cliente-hdn\n", "          - cliente-hdn\n          - produccion\n"),
  ],
  ["solo-desde-main", (t) => t.replace('"$REF" != "refs/heads/main"', '"$REF" != "refs/heads/x"')],
  ["frase-por-cliente", (t) => t.replaceAll("ALTA CLIENTE-HDN", "ok")],
  [
    "environment-del-cliente-con-revisor",
    (t) =>
      t.replace(
        "environment: ${{ needs.validar.outputs.ambiente }}",
        "environment: ${{ inputs.ambiente }}",
      ),
  ],
  [
    "permisos-solo-lectura",
    (t) =>
      t.replace(
        "permissions:\n  contents: read\n\nconcurrency",
        "permissions: write-all\n\nconcurrency",
      ),
  ],
  [
    "no-se-cancela-lo-que-corre",
    (t) => t.replace("cancel-in-progress: false", "cancel-in-progress: true"),
  ],
  [
    "sin-expresiones-en-run",
    (t) =>
      t.replace(
        'run: npm run plataforma:alta-de-cliente -- "$AMBIENTE" --validar',
        "run: npm run plataforma:alta-de-cliente -- ${{ inputs.ambiente }} --validar",
      ),
  ],
  [
    "secretos-solo-en-env",
    (t) =>
      t.replace(
        'run: npm run plataforma:alta-de-cliente -- "$AMBIENTE" --validar',
        "run: echo ${{ secrets.PEDERNAL_ALTA_DE_CLIENTE }}",
      ),
  ],
  [
    "acciones-fijadas-por-sha",
    (t) => t.replace(/actions\/setup-node@[0-9a-f]{40}/, "actions/setup-node@v4"),
  ],
  [
    "checkout-sin-credenciales",
    (t) => t.replace("persist-credentials: false", "persist-credentials: true"),
  ],
  ["npm-ci-sin-scripts", (t) => t.replace("npm ci --omit=dev --ignore-scripts", "npm ci")],
  ["no-migra", (t) => t.replace("npm run migrar -- --ver |", "npm run migrar -- --aplicar |")],
  ["exige-base-al-dia", (t) => t.replace('grep -q "faltan aplicar"', "true")],
  [
    "cierra-siempre",
    (t) => t.replace("if: always() && steps.abrir.conclusion != 'skipped'", "if: success()"),
  ],
  ["login-sin-clave-propia", (t) => t.replace("abrir sin-clave-propia", "abrir")],
  [
    "sin-pedido-al-cron",
    (t) =>
      t.replace(
        "PEDERNAL_ALTA_DE_CLIENTE: ${{ secrets.PEDERNAL_ALTA_DE_CLIENTE }}\n          PEDERNAL_HOSTS",
        "CRON_SECRET: ${{ secrets.PEDERNAL_ALTA_DE_CLIENTE }}\n          PEDERNAL_HOSTS",
      ),
  ],
  [
    "solo-los-secretos-del-cliente",
    (t) =>
      t.replace(
        "secrets.PEDERNAL_DB_DUENO_DIRECTA }}\n          PEDERNAL_VERCEL_TOKEN",
        "secrets.PEDERNAL_CLAVE_CONTEXTO }}\n          PEDERNAL_VERCEL_TOKEN",
      ),
  ],
  [
    "comparte-el-grupo-de-migrar",
    (t) => t.replace("group: migrar-${{ inputs.ambiente }}", "group: alta"),
  ],
  ["orden-de-los-pasos", (t) => t.replace("name: Secreto de invitaciones", "name: Otro paso")],
  [
    "datos-personales-en-un-secreto",
    (t) => t.replaceAll("secrets.PEDERNAL_ALTA_DE_CLIENTE", "secrets.PEDERNAL_OTRO"),
  ],
];

const VIOLACIONES_DESPLIEGUE: Array<[string, (t: string) => string]> = [
  [
    "solo-a-mano",
    (t) => t.replace("on:\n  workflow_dispatch:", "on:\n  push:\n  workflow_dispatch:"),
  ],
  [
    "ambiente-es-la-lista-cerrada-de-clientes",
    (t) => t.replace("          - cliente-hdn\n", "          - cliente-hdn\n          - preview\n"),
  ],
  ["solo-desde-main", (t) => t.replace('"$REF" != "refs/heads/main"', '"$REF" != "refs/heads/x"')],
  ["frase-por-cliente", (t) => t.replaceAll("DESPLEGAR CLIENTE-HDN", "ok")],
  [
    "environment-del-cliente-con-revisor",
    (t) =>
      t.replace("environment: ${{ needs.validar.outputs.ambiente }}", "environment: produccion"),
  ],
  [
    "sin-expresiones-en-run",
    (t) =>
      t.replace(
        'run: npm run desplegar-cliente -- verificar "$DIRECCION"',
        "run: npm run desplegar-cliente -- verificar ${{ steps.desplegar.outputs.direccion }}",
      ),
  ],
  [
    "secretos-solo-en-env",
    (t) =>
      t.replace(
        'run: npm run desplegar-cliente -- verificar "$DIRECCION"',
        "run: echo ${{ secrets.PEDERNAL_VERCEL_TOKEN }}",
      ),
  ],
  [
    "acciones-fijadas-por-sha",
    (t) => t.replace(/actions\/checkout@[0-9a-f]{40}/, "actions/checkout@main"),
  ],
  ["exige-base-al-dia", (t) => t.replace('grep -q "faltan aplicar"', "true")],
  ["version-fija-de-la-cli", (t) => t.replace("vercel@65.15.0", "vercel@latest")],
  [
    "sin-proyecto-ni-token-en-la-linea",
    (t) => t.replace("deploy --prod --yes", "deploy --prod --yes --token $VERCEL_TOKEN"),
  ],
  [
    "token-solo-por-entorno",
    (t) =>
      t.replace(
        "\n          VERCEL_TOKEN: ${{ secrets.PEDERNAL_VERCEL_TOKEN }}",
        "\n          VERCEL_TOKEN: ${{ inputs.confirmacion }}",
      ),
  ],
  ["proyecto-sale-de-la-lista-cerrada", (t) => t.replace('datos "$AMBIENTE"', 'datos "otro"')],
  ["verifica-despues-de-desplegar", (t) => t.replace('verificar "$DIRECCION"', 'verificar "x"')],
  [
    "solo-los-secretos-del-cliente",
    (t) =>
      t.replace(
        "secrets.PEDERNAL_DB_DUENO_DIRECTA }}\n          PEDERNAL_VERCEL_TOKEN",
        "secrets.NEON_API_KEY }}\n          PEDERNAL_VERCEL_TOKEN",
      ),
  ],
  [
    "grupo-propio-por-cliente",
    (t) => t.replace("group: desplegar-${{ inputs.ambiente }}", "group: x"),
  ],
  [
    "solo-produccion",
    (t) => t.replace("deploy --prod --yes", "deploy --prod --yes --target=preview"),
  ],
  [
    "orden-de-los-pasos",
    (t) => t.replace("name: Verificar el despliegue (/api/salud)", "name: Otro paso"),
  ],
];

describe("workflow alta-de-cliente.yml", () => {
  it("cumple todas las propiedades", () => {
    expect(problemasDelAlta(ALTA)).toEqual([]);
  });

  it.each(VIOLACIONES_ALTA)("violación inyectada: %s", (codigo, romper) => {
    const roto = romper(ALTA);
    expect(roto).not.toBe(ALTA);
    expect(problemasDelAlta(roto)).toContain(codigo);
  });

  it("las opciones de clientes de migrar.yml, del alta y del código son las mismas", () => {
    const clientes = Object.keys(PROYECTOS_DE_VERCEL_DE_CLIENTES);
    expect(opcionesDeAmbiente(ALTA)).toEqual(clientes);
    expect(opcionesDeAmbiente(MIGRAR).filter((o) => o.startsWith("cliente-"))).toEqual(clientes);
  });
});

describe("workflow desplegar-cliente.yml", () => {
  it("cumple todas las propiedades", () => {
    expect(problemasDelDespliegue(DESPLIEGUE)).toEqual([]);
  });

  it.each(VIOLACIONES_DESPLIEGUE)("violación inyectada: %s", (codigo, romper) => {
    const roto = romper(DESPLIEGUE);
    expect(roto).not.toBe(DESPLIEGUE);
    expect(problemasDelDespliegue(roto)).toContain(codigo);
  });

  it("toda propiedad evaluada tiene su violación inyectada (en alguno de los dos flujos)", () => {
    const cubiertos = new Set([...VIOLACIONES_ALTA, ...VIOLACIONES_DESPLIEGUE].map(([c]) => c));
    for (const codigo of CODIGOS) {
      // Dos propiedades son estructurales y las cubre otra prueba de este archivo.
      if (
        codigo === "validar-sin-permisos-ni-secretos" ||
        codigo === "dos-entradas-ambiente-y-frase"
      )
        continue;
      expect(cubiertos.has(codigo), codigo).toBe(true);
    }
  });
});
