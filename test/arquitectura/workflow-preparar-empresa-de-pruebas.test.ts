import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `.github/workflows/preparar-empresa-de-pruebas.yml`: siembra datos en la base `preview` con la cadena del dueño y la
 * del rol de plataforma, y maneja datos personales (CUIT, emails). Si alguien quita una de estas propiedades, esta
 * prueba se pone roja. Lee el texto del archivo (no hay un lector de YAML entre las dependencias); `zizmor` (job
 * «flujos» del CI) revisa el resto. Cada propiedad trae su VIOLACIÓN INYECTADA: una versión rota del archivo que
 * `problemasDelWorkflow` tiene que marcar con ese código.
 */

const TEXTO = readFileSync(
  join(import.meta.dirname, "../../.github/workflows/preparar-empresa-de-pruebas.yml"),
  "utf8",
);
const MIGRAR = readFileSync(
  join(import.meta.dirname, "../../.github/workflows/migrar.yml"),
  "utf8",
);

const SECRETOS_PERMITIDOS = [
  "CRON_SECRET",
  "PEDERNAL_DB_DUENO_DIRECTA",
  "PEDERNAL_PREPARAR_PREVIEW",
  "PEDERNAL_SECRETO_INVITACIONES",
];

const sinComentarios = (texto: string) =>
  texto
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

/** Los pasos del job `preparar`, en orden: nombre y texto. */
function pasosDe(texto: string): { nombre: string; texto: string }[] {
  const desde = texto.indexOf("\n  preparar:\n");
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

const CODIGOS_EVALUADOS = new Set<string>();

/** Los códigos de las propiedades que el texto NO cumple (vacío = todo bien). */
function problemasDelWorkflow(texto: string): string[] {
  const limpio = sinComentarios(texto);
  const lineas = texto.split("\n");
  const pasos = pasosDe(texto);
  const paso = (parte: string) => pasos.find((p) => p.nombre.includes(parte));
  const problemas: string[] = [];
  const exigir = (codigo: string, cumple: boolean) => {
    CODIGOS_EVALUADOS.add(codigo);
    if (!cumple) problemas.push(codigo);
  };

  // Solo a mano, con una única entrada (la frase): no hay forma de pedir otro ambiente ni de pasar datos por el formulario.
  const dentroDeOn = texto.slice(texto.indexOf("on:\n"), texto.indexOf("\npermissions:"));
  exigir(
    "solo-a-mano",
    JSON.stringify(dentroDeOn.match(/^ {2}[a-z_]+:/gm)) === '["  workflow_dispatch:"]',
  );
  exigir(
    "una-sola-entrada",
    JSON.stringify(dentroDeOn.match(/^ {6}[a-z_]+:$/gm)) === '["      confirmacion:"]',
  );

  // Solo preview: el Environment es el literal, nunca una expresión; producción no aparece.
  exigir(
    "solo-preview",
    /^ {4}environment: preview$/m.test(texto) && !/produccion|production/i.test(limpio),
  );
  exigir(
    "dos-jobs",
    JSON.stringify(texto.match(/^ {2}[a-z]+:$/gm)) === '["  validar:","  preparar:"]',
  );
  exigir("espera-a-validar", /\n {2}preparar:\n(?:.*\n)*? {4}needs: validar\n/.test(texto));

  // Solo main y la frase exacta, ANTES de entregar los secretos.
  exigir(
    "solo-main",
    texto.includes('[ "$REF" != "refs/heads/main" ]') && texto.includes("REF: ${{ github.ref }}"),
  );
  exigir(
    "frase",
    texto.includes('[ "$CONFIRMACION" != "PREPARAR PREVIEW" ]') &&
      /confirmacion:\n(?: {8}.+\n)*? {8}required: true\n/.test(texto),
  );
  exigir(
    "inputs-solo-en-validar",
    JSON.stringify(
      lineas.filter((l) => l.includes("inputs.") && !l.trim().startsWith("#")).map((l) => l.trim()),
    ) === JSON.stringify(["CONFIRMACION: ${{ inputs.confirmacion }}"]),
  );

  // Ningún comando recibe una expresión interpolada.
  const permitida = /^\s*(- )?([A-Z_]+|name|group|environment|node-version|if):/;
  const conExpresion = lineas.filter((l) => l.includes("${{") && !l.trim().startsWith("#"));
  exigir(
    "sin-interpolar",
    conExpresion.length > 0 &&
      conExpresion.every((l) => permitida.test(l)) &&
      !/run:[^\n]*\$\{\{/.test(texto),
  );

  // Permisos mínimos.
  exigir(
    "permisos-minimos",
    /^permissions:\n {2}contents: read\n/m.test(texto) && !/:\s*write\b/.test(texto),
  );
  exigir("validar-sin-permisos", /validar:(?:.*\n)*? {4}permissions: \{\}\n/.test(texto));

  // Secretos: los cinco declarados, del Environment, solo en `env` y nunca en claro.
  const usados = [...new Set([...limpio.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]))].sort();
  exigir("secretos-declarados", JSON.stringify(usados) === JSON.stringify(SECRETOS_PERMITIDOS));
  exigir(
    "secretos-solo-en-env",
    lineas
      .filter((l) => l.includes("secrets.") && !l.trim().startsWith("#"))
      .every((l) => /^[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}$/.test(l.trim())) &&
      !texto.includes("secrets: inherit") &&
      !texto.includes("toJSON(secrets)"),
  );
  exigir(
    "sin-valores-en-claro",
    !/postgres(ql)?:\/\/[^\s$]*:[^\s$@]+@/.test(limpio) &&
      !/\b[0-9a-fA-F]{40,}\b(?! #)/.test(limpio) &&
      !/Bearer [A-Za-z0-9_-]{16,}/.test(limpio),
  );
  exigir(
    "sin-eco-de-secretos",
    !/echo[^\n]*\$\{?PEDERNAL_(?!DB_MIGRACIONES:-|DB_PLATAFORMA:-|CLAVE_CONTEXTO:-|SECRETO_INVITACIONES:-|PREPARAR_PREVIEW:-)/.test(
      limpio,
    ) &&
      !/echo[^\n]*\$\{PEDERNAL_[A-Z_]+\}/.test(limpio) &&
      !/\b(printenv|env\s*\||set -x|set -o xtrace|--debug|-v\b)/.test(limpio) &&
      !/cat [^\n]*(token|secreto|clave|paquete)/i.test(limpio),
  );

  // Qué paso ve qué secreto y qué comando corre.
  const comprobar = paso("Comprobar que el Environment");
  const validar = paso("Validar los datos y los secretos");
  const alDia = paso("La base tiene que estar al día");
  const abrir = paso("Abrir el login temporal");
  const preparar = paso("Preparar la empresa de pruebas");
  const cerrar = paso("Cerrar el login temporal");
  exigir(
    "pasos-presentes",
    [comprobar, validar, alDia, abrir, preparar, cerrar].every((p) => p !== undefined),
  );
  exigir(
    "paquete-solo-donde-se-usa",
    [comprobar, validar, preparar].every(
      (p) => p?.texto.includes("secrets.PEDERNAL_PREPARAR_PREVIEW") === true,
    ) &&
      [alDia, abrir, cerrar].every((p) => p?.texto.includes("PEDERNAL_PREPARAR_PREVIEW") === false),
  );
  exigir(
    "comando-de-preparacion",
    preparar?.texto.includes("run: npm run plataforma:preparar-prueba\n") === true &&
      validar?.texto.includes("run: npm run plataforma:preparar-prueba -- --validar\n") === true,
  );
  exigir(
    "cadena-directa-del-dueno",
    [comprobar, validar, alDia, abrir, preparar, cerrar].every(
      (p) =>
        p?.texto.includes("PEDERNAL_DB_MIGRACIONES: ${{ secrets.PEDERNAL_DB_DUENO_DIRECTA }}") ===
        true,
    ) && !/pooler/i.test(limpio),
  );
  exigir("nunca-migra", !/--aplicar|--preparar-roles|--vercel/.test(limpio));
  exigir(
    "base-al-dia",
    alDia?.texto.includes('grep -q "faltan aplicar"') === true &&
      alDia.texto.includes("npm run migrar -- --ver") &&
      alDia.texto.includes("shell: bash") &&
      alDia.texto.includes("exit 1"),
  );

  // El login temporal del rol de plataforma: se abre con su comando, solo ve la cadena del dueño, y el cierre corre SIEMPRE,
  // es el último paso, y nada puede esconder su falla.
  exigir(
    "abrir-solo-con-la-cadena-del-dueno",
    abrir?.texto.includes("id: abrir") === true &&
      abrir.texto.includes("run: npm run plataforma:login-temporal -- abrir\n") &&
      !abrir.texto.includes("if:") &&
      [abrir, cerrar].every((p) => (p?.texto.match(/secrets\./g) ?? []).length === 1),
  );
  exigir(
    "cierre-siempre",
    cerrar?.texto.includes("if: always() && steps.abrir.conclusion != 'skipped'") === true &&
      cerrar.texto.includes("run: npm run plataforma:login-temporal -- cerrar\n"),
  );
  exigir("cierre-al-final", pasos.at(-1)?.nombre.includes("Cerrar el login temporal") === true);
  exigir("sin-continue-on-error", !/continue-on-error/.test(limpio));

  const nombres = pasos.map((p) => p.nombre);
  const pos = (parte: string) => nombres.findIndex((n) => n.includes(parte));
  const orden = [
    "Comprobar que",
    "Dependencias",
    "Validar los datos",
    "La base tiene que estar al día",
    "Abrir el login temporal",
    "Preparar la",
    "Cerrar el login temporal",
  ];
  exigir(
    "orden",
    pos("Comprobar que") >= 0 &&
      orden.every((n, i) => i === 0 || pos(n) > pos(orden[i - 1] as string)),
  );

  // Acciones fijadas por SHA, sin credenciales persistentes; instala lo mínimo.
  const usos = lineas.filter((l) => l.includes("uses:") && !l.trim().startsWith("#"));
  exigir(
    "acciones-por-sha",
    usos.length === 2 && usos.every((u) => /uses: [\w./-]+@[0-9a-f]{40} # v\d/.test(u)),
  );
  exigir("sin-credenciales-persistentes", texto.includes("persist-credentials: false"));
  exigir(
    "instala-lo-minimo",
    texto.includes("run: npm ci --omit=dev --ignore-scripts") && !/cache:\s*npm/.test(texto),
  );

  // Uno a la vez sobre la misma base: el MISMO grupo que `migrar.yml` para preview; nunca se cancela el que corre.
  exigir(
    "grupo-compartido-con-migrar",
    /^ {2}group: migrar-\$\{\{ inputs\.ambiente \}\}$/m.test(MIGRAR) &&
      /^ {2}group: migrar-preview$/m.test(texto) &&
      texto.includes("cancel-in-progress: false"),
  );
  return problemas;
}

const reemplazar = (de: string, a: string) => (texto: string) => {
  if (!texto.includes(de)) throw new Error(`la violación inyectada no encuentra «${de}»`);
  return texto.replace(de, a);
};

describe("workflow preparar-empresa-de-pruebas.yml", () => {
  it("cumple todas las propiedades", () => {
    expect(problemasDelWorkflow(TEXTO)).toEqual([]);
  });

  it("los pasos son los esperados", () => {
    expect(pasosDe(TEXTO).map((p) => p.nombre)).toEqual([
      "Comprobar que el Environment tiene todo lo necesario (solo se nombran las que faltan)",
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1",
      "Dependencias (solo las de producción, sin scripts de instalación)",
      "Validar los datos y los secretos (no toca la base)",
      "La base tiene que estar al día",
      "Abrir el login temporal del rol de plataforma (clave al azar de esta corrida)",
      "Preparar la empresa de pruebas (sin mostrar secretos ni datos personales)",
      "Cerrar el login temporal del rol de plataforma (siempre; falla si no queda cerrado)",
    ]);
  });

  describe("violaciones inyectadas: cada una se detecta", () => {
    const casos: [string, string, (texto: string) => string][] = [
      [
        "solo-a-mano",
        "un disparador por push",
        reemplazar("on:\n  workflow_dispatch:", "on:\n  push:\n  workflow_dispatch:"),
      ],
      [
        "una-sola-entrada",
        "los datos pedidos en el formulario",
        reemplazar(
          "        required: true\n\npermissions:",
          "        required: true\n      cuit:\n        type: string\n\npermissions:",
        ),
      ],
      [
        "solo-preview",
        "el Environment elegido por entrada",
        reemplazar("environment: preview", "environment: ${{ inputs.confirmacion }}"),
      ],
      ["dos-jobs", "un job extra", (t) => `${t}\n  extra:\n    runs-on: ubuntu-latest\n`],
      ["espera-a-validar", "sin esperar a validar", reemplazar("    needs: validar\n", "")],
      [
        "solo-main",
        "sin mirar la rama",
        reemplazar('[ "$REF" != "refs/heads/main" ]', '[ "$REF" != "refs/heads/otra" ]'),
      ],
      ["frase", "sin la frase", reemplazar('[ "$CONFIRMACION" != "PREPARAR PREVIEW" ]', "false")],
      [
        "inputs-solo-en-validar",
        "una entrada leída en el job de los secretos",
        reemplazar(
          "          PEDERNAL_PREPARAR_PREVIEW: ${{ secrets.PEDERNAL_PREPARAR_PREVIEW }}\n\n      - uses: actions/checkout",
          "          PEDERNAL_PREPARAR_PREVIEW: ${{ secrets.PEDERNAL_PREPARAR_PREVIEW }}\n          OTRA: ${{ inputs.confirmacion }}\n\n      - uses: actions/checkout",
        ),
      ],
      [
        "sin-interpolar",
        "una expresión dentro del comando",
        reemplazar(
          "run: npm run plataforma:preparar-prueba\n",
          "run: npm run plataforma:preparar-prueba ${{ inputs.confirmacion }}\n",
        ),
      ],
      [
        "permisos-minimos",
        "permiso de escritura",
        reemplazar(
          "permissions:\n  contents: read\n\nconcurrency",
          "permissions:\n  contents: write\n\nconcurrency",
        ),
      ],
      [
        "validar-sin-permisos",
        "validar con permisos",
        reemplazar("    permissions: {}\n", "    permissions:\n      contents: read\n"),
      ],
      [
        "secretos-declarados",
        "un secreto de más",
        reemplazar(
          "          PEDERNAL_PREPARAR_PREVIEW: ${{ secrets.PEDERNAL_PREPARAR_PREVIEW }}\n\n      - uses: actions/checkout",
          "          PEDERNAL_PREPARAR_PREVIEW: ${{ secrets.PEDERNAL_PREPARAR_PREVIEW }}\n          OTRO: ${{ secrets.PEDERNAL_VERCEL_TOKEN }}\n\n      - uses: actions/checkout",
        ),
      ],
      [
        "secretos-solo-en-env",
        "secretos heredados",
        reemplazar(
          "    environment: preview\n",
          "    environment: preview\n    secrets: inherit\n",
        ),
      ],
      [
        "sin-valores-en-claro",
        "una cadena de conexión pegada",
        reemplazar(
          "name: Preparar la empresa de pruebas (preview)\n",
          "name: Preparar la empresa de pruebas (preview)\nenv:\n  X: postgres://usuario:clave@host/base\n",
        ),
      ],
      [
        "sin-eco-de-secretos",
        "imprimir el paquete",
        reemplazar(
          "        run: npm run plataforma:preparar-prueba\n",
          '        run: |\n          echo "$PEDERNAL_PREPARAR_PREVIEW"\n          npm run plataforma:preparar-prueba\n',
        ),
      ],
      [
        "paquete-solo-donde-se-usa",
        "el paquete en el paso de migraciones",
        reemplazar(
          "        env:\n          PEDERNAL_DB_MIGRACIONES: ${{ secrets.PEDERNAL_DB_DUENO_DIRECTA }}\n\n      - name: Preparar",
          "        env:\n          PEDERNAL_DB_MIGRACIONES: ${{ secrets.PEDERNAL_DB_DUENO_DIRECTA }}\n          PEDERNAL_PREPARAR_PREVIEW: ${{ secrets.PEDERNAL_PREPARAR_PREVIEW }}\n\n      - name: Preparar",
        ),
      ],
      [
        "comando-de-preparacion",
        "otro comando",
        reemplazar("run: npm run plataforma:preparar-prueba\n", "run: npm run plataforma:caso\n"),
      ],
      [
        "cadena-directa-del-dueno",
        "la cadena del pooler",
        reemplazar(
          "name: Preparar la empresa de pruebas (preview)\n",
          "name: Preparar la empresa de pruebas (preview)\n# x\nenv:\n  H: host-pooler\n",
        ),
      ],
      [
        "nunca-migra",
        "aplicar migraciones",
        reemplazar("npm run migrar -- --ver |", "npm run migrar -- --aplicar |"),
      ],
      [
        "base-al-dia",
        "sin cortar si hay pendientes",
        reemplazar('grep -q "faltan aplicar"', 'grep -q "nada"'),
      ],
      [
        "orden",
        "preparar antes de comprobar la base",
        (t) => {
          const i = t.indexOf("      - name: La base tiene que estar al día");
          const j = t.indexOf("      - name: Preparar la empresa de pruebas");
          return t.slice(0, i) + t.slice(j) + "\n" + t.slice(i, j);
        },
      ],
      [
        "abrir-solo-con-la-cadena-del-dueno",
        "el paso que abre el login con un secreto de más",
        reemplazar(
          "        id: abrir\n        run: npm run plataforma:login-temporal -- abrir\n        env:\n",
          "        id: abrir\n        run: npm run plataforma:login-temporal -- abrir\n        env:\n          CRON_SECRET: ${{ secrets.CRON_SECRET }}\n",
        ),
      ],
      [
        "cierre-siempre",
        "el cierre sin always()",
        reemplazar("        if: always() && steps.abrir.conclusion != 'skipped'\n", ""),
      ],
      [
        "cierre-al-final",
        "un paso después del cierre",
        (t) => `${t}\n      - name: Otro paso\n        run: echo listo\n`,
      ],
      [
        "sin-continue-on-error",
        "el cierre que ignora su falla",
        reemplazar(
          "        if: always() && steps.abrir.conclusion != 'skipped'\n",
          "        if: always() && steps.abrir.conclusion != 'skipped'\n        continue-on-error: true\n",
        ),
      ],
      [
        "acciones-por-sha",
        "una acción por etiqueta",
        reemplazar(
          "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
          "actions/checkout@v4",
        ),
      ],
      [
        "sin-credenciales-persistentes",
        "credenciales persistentes",
        reemplazar("persist-credentials: false", "persist-credentials: true"),
      ],
      [
        "instala-lo-minimo",
        "instalar con scripts",
        reemplazar("npm ci --omit=dev --ignore-scripts", "npm ci"),
      ],
      [
        "grupo-compartido-con-migrar",
        "otro grupo de concurrencia",
        reemplazar("group: migrar-preview", "group: preparar-preview"),
      ],
    ];

    it.each(casos)("%s: %s", (codigo, _descripcion, romper) => {
      expect(problemasDelWorkflow(romper(TEXTO))).toContain(codigo);
    });

    it("cada propiedad evaluada tiene su violación inyectada", () => {
      const cubiertos = new Set(casos.map(([codigo]) => codigo));
      // `pasos-presentes` se cubre con la prueba de los nombres de los pasos.
      const sinCubrir = [...CODIGOS_EVALUADOS].filter(
        (c) => !cubiertos.has(c) && c !== "pasos-presentes",
      );
      expect(sinCubrir).toEqual([]);
    });
  });
});
