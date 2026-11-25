import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROYECTO_DE_VERCEL,
  PROYECTOS_DE_VERCEL_DE_CLIENTES,
  leerPedidoDeVercel,
} from "../../src/adaptadores/vercel/plan-de-variables";

/**
 * `.github/workflows/cargar-entorno.yml`: carga en Vercel las variables que se generan solas. Corre con el token de
 * Vercel y la cadena del dueño de la base, y genera secretos en el runner: si alguien quita una de estas
 * propiedades, esta prueba se pone roja. Es una lectura del texto del archivo (no hay un lector de YAML entre las
 * dependencias); `zizmor` (job «flujos» del CI) revisa el resto. Cada propiedad trae su VIOLACIÓN INYECTADA al final:
 * una versión rota del archivo que `problemasDelWorkflow` tiene que marcar con ese código.
 */

const RUTA = join(import.meta.dirname, "../../.github/workflows/cargar-entorno.yml");
const TEXTO = readFileSync(RUTA, "utf8");
const MIGRAR = readFileSync(
  join(import.meta.dirname, "../../.github/workflows/migrar.yml"),
  "utf8",
);

const SECRETOS_PERMITIDOS = ["PEDERNAL_DB_DUENO_DIRECTA", "PEDERNAL_VERCEL_TOKEN"];

const sinComentarios = (texto: string) =>
  texto
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

/** Los pasos del job `cargar`, en orden: nombre y texto. */
function pasosDe(texto: string): { nombre: string; texto: string }[] {
  const desde = texto.indexOf("\n  cargar:\n");
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

/** Cada propiedad que `problemasDelWorkflow` mira: la prueba exige que todas tengan su violación inyectada. */
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

  // Solo a mano.
  const dentroDeOn = texto.slice(texto.indexOf("on:\n"), texto.indexOf("\npermissions:"));
  exigir(
    "solo-a-mano",
    JSON.stringify(dentroDeOn.match(/^ {2}[a-z_]+:/gm)) === '["  workflow_dispatch:"]',
  );

  // Dos ambientes y dos jobs, el de los secretos detrás del que valida.
  const opciones = texto.slice(
    texto.indexOf("      ambiente:"),
    texto.indexOf("      confirmacion:"),
  );
  exigir(
    "ambientes",
    JSON.stringify(opciones.match(/^ {10}- (\w+)$/gm)) ===
      '["          - preview","          - produccion"]',
  );
  exigir(
    "dos-jobs",
    JSON.stringify(texto.match(/^ {2}[a-z]+:$/gm)) === '["  validar:","  cargar:"]',
  );
  exigir("espera-a-validar", /\n {2}cargar:\n(?:.*\n)*? {4}needs: validar\n/.test(texto));

  // Solo main y la frase exacta, ANTES de entregar los secretos.
  exigir(
    "solo-main",
    texto.includes('[ "$REF" != "refs/heads/main" ]') && texto.includes("REF: ${{ github.ref }}"),
  );
  exigir(
    "frase",
    texto.includes('preview) esperado="CARGAR PREVIEW"; destino="preview" ;;') &&
      texto.includes('produccion) esperado="CARGAR PRODUCCION"; destino="production" ;;') &&
      texto.includes('[ "$CONFIRMACION" != "$esperado" ]'),
  );
  exigir(
    "confirmacion-obligatoria",
    /confirmacion:\n(?: {8}.+\n)*? {8}required: true\n/.test(texto),
  );

  // El Environment sale de la salida ya validada; las entradas del usuario solo se leen en `validar`.
  exigir(
    "environment-validado",
    texto.includes("environment: ${{ needs.validar.outputs.ambiente }}"),
  );
  const conInputs = lineas
    .filter((l) => l.includes("inputs.") && !l.trim().startsWith("#"))
    .map((l) => l.trim());
  exigir(
    "inputs-solo-en-validar",
    JSON.stringify(conInputs) ===
      JSON.stringify([
        "group: migrar-${{ inputs.ambiente }}",
        "AMBIENTE: ${{ inputs.ambiente }}",
        "CONFIRMACION: ${{ inputs.confirmacion }}",
        "ROLES: ${{ inputs.dar_login_a_los_roles }}",
      ]),
  );

  // Ningún comando recibe una expresión interpolada.
  const permitida =
    /^\s*(- )?([A-Z_]+|name|group|environment|ambiente|destino|roles|outputs?|node-version|if):/;
  const conExpresion = lineas.filter((l) => l.includes("${{") && !l.trim().startsWith("#"));
  exigir(
    "sin-interpolar",
    conExpresion.length > 0 &&
      conExpresion.every((l) => permitida.test(l)) &&
      !/run:[^\n]*\$\{\{/.test(texto),
  );
  exigir(
    "sin-interpolar-en-bloques",
    pasos.every((p) => {
      const run = p.texto.includes("run: |")
        ? p.texto.slice(p.texto.indexOf("run: |"), p.texto.indexOf("\n        env:"))
        : "";
      return !run.includes("${{");
    }),
  );

  // Permisos mínimos.
  exigir(
    "permisos-minimos",
    /^permissions:\n {2}contents: read\n/m.test(texto) && !/:\s*write\b/.test(texto),
  );
  exigir("validar-sin-permisos", /validar:(?:.*\n)*? {4}permissions: \{\}\n/.test(texto));

  // Secretos: los dos declarados, del Environment, solo en `env` y nunca en claro.
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
      !/Bearer [A-Za-z0-9_-]{16,}/.test(limpio) &&
      !/\bvcp_[A-Za-z0-9]{10,}/.test(limpio),
  );

  // Nada imprime valores del entorno ni activa trazas.
  exigir(
    "sin-eco-de-secretos",
    !/echo[^\n]*\$\{?PEDERNAL_/.test(limpio) &&
      !/\b(printenv|env\s*\||set -x|set -o xtrace|--debug|-v\b)/.test(limpio) &&
      !/cat [^\n]*(token|secreto|clave)/i.test(limpio),
  );

  // Qué paso ve qué secreto.
  const alDia = paso("La base tiene que estar al día");
  const roles = paso("Dar LOGIN a los roles");
  const generar = paso("Generar y cargar");
  const comprobar = paso("Comprobar que el Environment");
  exigir(
    "pasos-presentes",
    [alDia, roles, generar, comprobar].every((p) => p !== undefined),
  );
  exigir(
    "token-solo-donde-escribe-en-vercel",
    comprobar?.texto.includes("secrets.PEDERNAL_VERCEL_TOKEN") === true &&
      roles?.texto.includes("secrets.PEDERNAL_VERCEL_TOKEN") === true &&
      generar?.texto.includes("secrets.PEDERNAL_VERCEL_TOKEN") === true &&
      alDia?.texto.includes("PEDERNAL_VERCEL_TOKEN") === false,
  );
  exigir(
    "base-con-la-cadena-directa",
    [alDia, roles, generar].every(
      (p) =>
        p?.texto.includes("PEDERNAL_DB_MIGRACIONES: ${{ secrets.PEDERNAL_DB_DUENO_DIRECTA }}") ===
        true,
    ) && comprobar?.texto.includes("PEDERNAL_DB_DUENO_DIRECTA") === false,
  );
  exigir("sin-pooler", !/pooler|PEDERNAL_DB_APP\b|PEDERNAL_DB_TRABAJOS/i.test(limpio));

  // Qué comandos corre y con qué banderas.
  exigir(
    "comando-de-carga",
    generar?.texto.includes(
      "npm run cargar-entorno -- --vercel production --confirmo production",
    ) === true &&
      generar.texto.includes("npm run cargar-entorno -- --vercel preview") &&
      generar.texto.includes('[ "$DESTINO" = "production" ]') &&
      generar.texto.includes("DESTINO: ${{ needs.validar.outputs.destino }}"),
  );
  exigir(
    "roles-solo-lo-pedido",
    roles?.texto.includes(
      "npm run migrar -- --preparar-roles --con-autenticacion --vercel production --confirmo production",
    ) === true &&
      roles.texto.includes(
        "npm run migrar -- --preparar-roles --con-autenticacion --vercel preview",
      ) &&
      !/--rotar|--secretos|--con-respaldo|--directa|--diagnostico/.test(limpio),
  );
  exigir("nunca-migra", !/--aplicar/.test(limpio));
  exigir(
    "roles-solo-con-la-opcion",
    [alDia, roles].every(
      (p) => p?.texto.includes("if: needs.validar.outputs.roles == 'true'") === true,
    ) && generar?.texto.includes("if:") === false,
  );
  exigir(
    "base-al-dia-antes-de-los-roles",
    alDia?.texto.includes('grep -q "faltan aplicar"') === true &&
      alDia.texto.includes("npm run migrar -- --ver") &&
      alDia.texto.includes("shell: bash") &&
      alDia.texto.includes("exit 1"),
  );

  // Orden: comprobar, dependencias, base al día, roles, generar.
  const nombres = pasos.map((p) => p.nombre);
  const pos = (parte: string) => nombres.findIndex((n) => n.includes(parte));
  const orden = [
    "Comprobar que",
    "Dependencias",
    "La base tiene que estar al día",
    "Dar LOGIN",
    "Generar y cargar",
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

  // Una carga y una migración del mismo entorno no corren a la vez: el MISMO grupo que `migrar.yml`; nunca se cancela la que corre.
  const grupoDeMigrar = /^ {2}group: (migrar-\$\{\{ inputs\.ambiente \}\})$/m.exec(MIGRAR)?.[1];
  exigir(
    "grupo-compartido-con-migrar",
    grupoDeMigrar !== undefined &&
      texto.includes(`group: ${grupoDeMigrar}`) &&
      texto.includes("cancel-in-progress: false"),
  );

  // Dice sin rodeos que la casilla de los roles BORRA y que el comando aplica migraciones pendientes (el dueño avisa
  // antes de cualquier cambio destructivo): en el encabezado, en la descripción de la entrada y en el nombre del paso.
  const descripcionDeRoles =
    /dar_login_a_los_roles:\n\s+description: "([^"]+)"/.exec(texto)?.[1] ?? "";
  exigir(
    "avisa-lo-que-borra",
    texto.includes("ESTA CASILLA CAMBIA Y BORRA") &&
      texto.includes("BORRA de Vercel, en ese entorno, lo que la aplicación prohíbe") &&
      texto.includes("el comando APLICA las migraciones pendientes") &&
      !texto.includes("no se borra nada\n") &&
      /BORRAR de Vercel/.test(descripcionDeRoles) &&
      /DATABASE_URL\*, POSTGRES_\*, BETTER_AUTH_\*, AUTH_\*, PEDERNAL_DB_MIGRACIONES/.test(
        descripcionDeRoles,
      ) &&
      /Aplica migraciones pendientes/.test(descripcionDeRoles) &&
      roles?.nombre.includes("BORRAR") === true,
  );
  return problemas;
}

const reemplazar = (de: string, a: string) => (texto: string) => {
  if (!texto.includes(de)) throw new Error(`la violación inyectada no encuentra «${de}»`);
  return texto.replace(de, a);
};

describe("workflow cargar-entorno.yml", () => {
  it("cumple todas las propiedades", () => {
    expect(problemasDelWorkflow(TEXTO)).toEqual([]);
  });

  it("los pasos son los esperados y los secretos, solo los dos declarados", () => {
    expect(pasosDe(TEXTO).map((p) => p.nombre)).toEqual([
      "Comprobar que el Environment tiene el token de Vercel",
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1",
      "Dependencias (solo las de producción, sin scripts de instalación)",
      "La base tiene que estar al día (solo con los roles)",
      "Dar LOGIN a los roles, cargar sus cadenas y BORRAR lo prohibido en Vercel (sin mostrar contraseñas)",
      "Generar y cargar en Vercel lo que se puede generar (sin sobrescribir nada)",
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
        "ambientes",
        "un tercer ambiente",
        reemplazar("          - produccion\n", "          - produccion\n          - desarrollo\n"),
      ],
      ["dos-jobs", "un job extra", (t) => `${t}\n  extra:\n    runs-on: ubuntu-latest\n`],
      [
        "espera-a-validar",
        "el job de los secretos sin esperar a validar",
        reemplazar("    needs: validar\n", ""),
      ],
      [
        "solo-main",
        "sin mirar la rama",
        reemplazar('[ "$REF" != "refs/heads/main" ]', '[ "$REF" != "refs/heads/otra" ]'),
      ],
      [
        "frase",
        "sin la frase de producción",
        reemplazar('[ "$CONFIRMACION" != "$esperado" ]', "false"),
      ],
      [
        "confirmacion-obligatoria",
        "la confirmación opcional",
        reemplazar(
          "        type: string\n        required: true\n",
          "        type: string\n        required: false\n",
        ),
      ],
      [
        "environment-validado",
        "el Environment tomado de la entrada",
        reemplazar(
          "environment: ${{ needs.validar.outputs.ambiente }}",
          "environment: ${{ inputs.ambiente }}",
        ),
      ],
      [
        "inputs-solo-en-validar",
        "una entrada leída fuera de validar",
        reemplazar(
          "DESTINO: ${{ needs.validar.outputs.destino }}\n",
          "DESTINO: ${{ inputs.ambiente }}\n",
        ),
      ],
      [
        "sin-interpolar",
        "una expresión dentro del comando",
        reemplazar(
          'if [ "$DESTINO" = "production" ]; then\n            npm run cargar-entorno',
          'if [ "${{ inputs.ambiente }}" = "production" ]; then\n            npm run cargar-entorno',
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
        "el job de validación con permisos",
        reemplazar("    permissions: {}\n", "    permissions:\n      contents: read\n"),
      ],
      [
        "secretos-declarados",
        "un secreto de más",
        reemplazar(
          "          DESTINO: ${{ needs.validar.outputs.destino }}\n\n",
          "          DESTINO: ${{ needs.validar.outputs.destino }}\n          OTRO: ${{ secrets.NEON_API_KEY }}\n\n",
        ),
      ],
      [
        "secretos-solo-en-env",
        "todos los secretos heredados",
        reemplazar(
          "    permissions:\n      contents: read\n    steps:\n      - name: Comprobar",
          "    permissions:\n      contents: read\n    secrets: inherit\n    steps:\n      - name: Comprobar",
        ),
      ],
      [
        "sin-valores-en-claro",
        "una cadena de conexión pegada",
        reemplazar(
          'echo "::error::Falta el secreto',
          'echo "postgresql://dueno:clavesecreta@host/db" "::error::Falta el secreto',
        ),
      ],
      [
        "sin-eco-de-secretos",
        "un eco del token",
        reemplazar(
          'if [ "$DESTINO" = "production" ]; then\n            npm run cargar-entorno',
          'echo "$PEDERNAL_VERCEL_TOKEN"\n          if [ "$DESTINO" = "production" ]; then\n            npm run cargar-entorno',
        ),
      ],
      [
        "token-solo-donde-escribe-en-vercel",
        "el token en el paso que mira la base",
        reemplazar(
          "          PEDERNAL_DB_MIGRACIONES: ${{ secrets.PEDERNAL_DB_DUENO_DIRECTA }}\n\n      - name: Dar LOGIN",
          "          PEDERNAL_DB_MIGRACIONES: ${{ secrets.PEDERNAL_DB_DUENO_DIRECTA }}\n          PEDERNAL_VERCEL_TOKEN: ${{ secrets.PEDERNAL_VERCEL_TOKEN }}\n\n      - name: Dar LOGIN",
        ),
      ],
      [
        "base-con-la-cadena-directa",
        "el paso de carga sin la cadena de la base",
        reemplazar(
          'npm run cargar-entorno -- --vercel "$DESTINO" --confirmo "$DESTINO"\n          fi\n        env:\n          PEDERNAL_DB_MIGRACIONES: ${{ secrets.PEDERNAL_DB_DUENO_DIRECTA }}\n',
          'npm run cargar-entorno -- --vercel "$DESTINO" --confirmo "$DESTINO"\n          fi\n        env:\n',
        ),
      ],
      ["sin-pooler", "la cadena del pooler", (t) => `${t}\n# nada\n          POOLER: pooler\n`],
      [
        "comando-de-carga",
        "producción sin la confirmación del script",
        reemplazar(
          "npm run cargar-entorno -- --vercel production --confirmo production",
          "npm run cargar-entorno -- --vercel production",
        ),
      ],
      [
        "roles-solo-lo-pedido",
        "rotar contraseñas desde el workflow",
        reemplazar(
          '--vercel "$DESTINO" --confirmo "$DESTINO"\n          fi\n        env:\n          PEDERNAL_DB_MIGRACIONES: ${{ secrets.PEDERNAL_DB_DUENO_DIRECTA }}\n          PEDERNAL_VERCEL_TOKEN: ${{ secrets.PEDERNAL_VERCEL_TOKEN }}\n          DESTINO: ${{ needs.validar.outputs.destino }}\n\n      - name: Generar',
          '--vercel "$DESTINO" --confirmo "$DESTINO" --rotar\n          fi\n        env:\n          PEDERNAL_DB_MIGRACIONES: ${{ secrets.PEDERNAL_DB_DUENO_DIRECTA }}\n          PEDERNAL_VERCEL_TOKEN: ${{ secrets.PEDERNAL_VERCEL_TOKEN }}\n          DESTINO: ${{ needs.validar.outputs.destino }}\n\n      - name: Generar',
        ),
      ],
      [
        "nunca-migra",
        "aplicar migraciones desde acá",
        (t) => `${t}          APLICAR: npm run migrar -- --aplicar\n`,
      ],
      [
        "roles-solo-con-la-opcion",
        "los roles siempre",
        reemplazar(
          "        if: needs.validar.outputs.roles == 'true'\n        run: |\n          set -eu\n          if [ \"$DESTINO\"",
          '        run: |\n          set -eu\n          if [ "$DESTINO"',
        ),
      ],
      [
        "base-al-dia-antes-de-los-roles",
        "sin mirar las migraciones pendientes",
        reemplazar('grep -q "faltan aplicar"', 'grep -q "otra cosa"'),
      ],
      [
        "orden",
        "los roles después de generar",
        (t) => {
          const generar = t.indexOf("      - name: Generar y cargar");
          const roles = t.indexOf("      - name: Dar LOGIN");
          return t.slice(0, roles) + t.slice(generar) + "\n" + t.slice(roles, generar);
        },
      ],
      [
        "acciones-por-sha",
        "una acción por etiqueta",
        reemplazar(
          "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0",
          "actions/setup-node@v7",
        ),
      ],
      [
        "sin-credenciales-persistentes",
        "credenciales persistentes",
        reemplazar("persist-credentials: false", "persist-credentials: true"),
      ],
      [
        "instala-lo-minimo",
        "instalación con scripts",
        reemplazar("npm ci --omit=dev --ignore-scripts", "npm ci"),
      ],
      [
        "sin-interpolar-en-bloques",
        "una entrada del usuario dentro de un bloque de comandos",
        reemplazar(
          'set -eu\n          if [ "$DESTINO" = "production" ]; then\n            npm run cargar-entorno',
          'set -eu\n          echo ${{ inputs.ambiente }}\n          if [ "$DESTINO" = "production" ]; then\n            npm run cargar-entorno',
        ),
      ],
      [
        "pasos-presentes",
        "un paso que cambia de nombre",
        reemplazar("name: Generar y cargar en Vercel", "name: Otra cosa en Vercel"),
      ],
      [
        "grupo-compartido-con-migrar",
        "un grupo propio, aparte del de migrar.yml",
        reemplazar(
          "group: migrar-${{ inputs.ambiente }}",
          "group: cargar-entorno-${{ inputs.ambiente }}",
        ),
      ],
      [
        "grupo-compartido-con-migrar",
        "cancelar la carga en curso",
        reemplazar("cancel-in-progress: false", "cancel-in-progress: true"),
      ],
      [
        "avisa-lo-que-borra",
        "el encabezado vuelve a decir que no se borra nada",
        reemplazar("ESTA CASILLA CAMBIA Y BORRA", "esta casilla no borra nada"),
      ],
      [
        "avisa-lo-que-borra",
        "la descripción de la casilla sin el aviso de lo que borra",
        reemplazar("y BORRAR de Vercel lo que la aplicación prohíbe", "y cargar sus cadenas"),
      ],
      [
        "avisa-lo-que-borra",
        "la descripción de la casilla sin el aviso de las migraciones",
        reemplazar(
          "Aplica migraciones pendientes: se corta si hay",
          "La base tiene que estar al día",
        ),
      ],
      [
        "avisa-lo-que-borra",
        "el paso de los roles sin decir que borra",
        reemplazar(
          "cargar sus cadenas y BORRAR lo prohibido en Vercel",
          "cargar sus cadenas en Vercel",
        ),
      ],
    ];

    it.each(casos)("%s: %s", (codigo, _descripcion, romper) => {
      const roto = romper(TEXTO);
      expect(roto).not.toBe(TEXTO);
      expect(problemasDelWorkflow(roto)).toContain(codigo);
    });

    it("hay una violación inyectada por cada propiedad que se mira (y ninguna de más)", () => {
      problemasDelWorkflow(TEXTO);
      expect([...CODIGOS_EVALUADOS].sort()).toEqual(
        [...new Set(casos.map(([codigo]) => codigo))].sort(),
      );
    });
  });
});

/**
 * Los clientes con base propia (extra de plan; dueño, 25/11/2026): tres listas que tienen que decir lo mismo, hoy las tres VACÍAS —
 * las opciones de `cargar-entorno.yml`, las de `migrar.yml` y `PROYECTOS_DE_VERCEL_DE_CLIENTES` (código → proyecto de Vercel). `[]` si
 * coinciden y cada cliente tiene su caso con su frase, su proyecto válido y su destino.
 * Previene: un cliente que se puede migrar pero no cargar (o al revés), o que apunte al proyecto de Vercel de OTRO (la web, la consola u otro
 * cliente) por un código o un id mal copiado.
 */
const opcionesDeAmbiente = (texto: string, hasta: string) =>
  [
    ...texto
      .slice(texto.indexOf("      ambiente:"), texto.indexOf(hasta))
      .matchAll(/^ {10}- (\S+)$/gm),
  ].map((m) => m[1] as string);

function problemasDeClientes(
  cargar: string,
  migrar: string,
  lista: Readonly<Record<string, string>>,
): string[] {
  const problemas: string[] = [];
  const claves = Object.keys(lista).sort();
  const igual = (a: readonly string[]) => JSON.stringify([...a].sort()) === JSON.stringify(claves);
  if (!igual(opcionesDeAmbiente(cargar, "      confirmacion:").slice(2))) {
    problemas.push("cargar-distinto-de-la-lista");
  }
  if (!igual(opcionesDeAmbiente(migrar, "      accion:").slice(2))) {
    problemas.push("migrar-distinto-de-la-lista");
  }
  for (const c of claves) {
    if (leerPedidoDeVercel(c, lista)?.destino !== "production") {
      problemas.push(`cliente-sin-proyecto-valido: ${c}`);
    }
    const frase = c.slice("cliente-".length).toUpperCase();
    if (!cargar.includes(`${c}) esperado="CARGAR CLIENTE-${frase}"; destino="${c}" ;;`)) {
      problemas.push(`cargar-sin-caso: ${c}`);
    }
    if (!migrar.includes(`${c}) esperado="MIGRAR CLIENTE-${frase}"; con_respaldo=true ;;`)) {
      problemas.push(`migrar-sin-caso: ${c}`);
    }
  }
  return problemas;
}

describe("clientes con base propia: las tres listas dicen lo mismo", () => {
  const ID_EJEMPLO = "prj_EjemploEjemploEjemploEjemplo1";
  const OPCION = "          - produccion\n";
  const CIERRE = '            *) echo "::error::Ambiente no permitido."; exit 1 ;;';
  const conClienteEn = (texto: string, codigo: string, caso: string) =>
    texto
      .replace(OPCION, `${OPCION}          - ${codigo}\n`)
      .replace(CIERRE, `            ${codigo}) ${caso} ;;\n${CIERRE}`);
  const frase = (c: string) => c.slice("cliente-".length).toUpperCase();
  const casoDeCargar = (c: string) => `esperado="CARGAR CLIENTE-${frase(c)}"; destino="${c}"`;
  const casoDeMigrar = (c: string) => `esperado="MIGRAR CLIENTE-${frase(c)}"; con_respaldo=true`;

  it("hoy: las tres vacías y de acuerdo", () => {
    expect(Object.keys(PROYECTOS_DE_VERCEL_DE_CLIENTES)).toEqual([]);
    expect(problemasDeClientes(TEXTO, MIGRAR, PROYECTOS_DE_VERCEL_DE_CLIENTES)).toEqual([]);
  });

  it("un cliente de ejemplo bien sumado en las tres listas cumple", () => {
    const c = "cliente-ejemplo";
    const cargar = conClienteEn(TEXTO, c, casoDeCargar(c));
    const migrar = conClienteEn(MIGRAR, c, casoDeMigrar(c));
    expect(problemasDeClientes(cargar, migrar, { [c]: ID_EJEMPLO })).toEqual([]);
  });

  describe("violaciones inyectadas: cada una se detecta", () => {
    const c = "cliente-ejemplo";
    const cargarBien = conClienteEn(TEXTO, c, casoDeCargar(c));
    const migrarBien = conClienteEn(MIGRAR, c, casoDeMigrar(c));
    const lista = { [c]: ID_EJEMPLO };
    const casos: [string, string, () => string[]][] = [
      [
        "cargar-distinto-de-la-lista",
        "una opción en cargar-entorno que no está en la lista de proyectos",
        () => problemasDeClientes(cargarBien, MIGRAR, {}),
      ],
      [
        "migrar-distinto-de-la-lista",
        "una opción en migrar que no está en la lista de proyectos",
        () => problemasDeClientes(TEXTO, migrarBien, {}),
      ],
      [
        "cargar-distinto-de-la-lista",
        "un cliente en la lista de proyectos sin su ambiente en cargar-entorno",
        () => problemasDeClientes(TEXTO, migrarBien, lista),
      ],
      [
        "migrar-distinto-de-la-lista",
        "un cliente en la lista de proyectos sin su ambiente en migrar",
        () => problemasDeClientes(cargarBien, MIGRAR, lista),
      ],
      [
        `cliente-sin-proyecto-valido: ${c}`,
        "un cliente que apunta al proyecto de la web (pedernal-erp)",
        () => problemasDeClientes(cargarBien, migrarBien, { [c]: PROYECTO_DE_VERCEL }),
      ],
      [
        `cliente-sin-proyecto-valido: ${c}`,
        "un cliente con un id que no tiene la forma de un proyecto",
        () => problemasDeClientes(cargarBien, migrarBien, { [c]: "otro" }),
      ],
      [
        `cargar-sin-caso: ${c}`,
        "un cliente cuyo caso de cargar-entorno apunta a otro destino",
        () =>
          problemasDeClientes(
            conClienteEn(TEXTO, c, `esperado="CARGAR CLIENTE-EJEMPLO"; destino="production"`),
            migrarBien,
            lista,
          ),
      ],
      [
        `migrar-sin-caso: ${c}`,
        "un cliente cuyo caso de migrar no exige respaldo",
        () =>
          problemasDeClientes(
            cargarBien,
            conClienteEn(MIGRAR, c, `esperado="MIGRAR CLIENTE-EJEMPLO"; con_respaldo=false`),
            lista,
          ),
      ],
    ];
    it.each(casos)("«%s»: %s", (codigo, _descripcion, correr) => {
      expect(correr()).toContain(codigo);
    });
  });
});
