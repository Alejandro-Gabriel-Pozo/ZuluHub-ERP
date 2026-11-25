import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Los workflows y Neon, mirados TODOS juntos (dueño, 16/11/2026, «respaldos A»; ver `CLAUDE.md`, «Ninguna sesión escribe en la base
 * `production`»). Las pruebas `workflow-*.test.ts` fijan los secretos de SU archivo; ninguna miraba el conjunto, así que un workflow nuevo
 * con `NEON_API_KEY` o una llamada de borrado a la API de Neon pasaba el CI. Esta lo cierra.
 *
 * Qué falla:
 *  1. un workflow fuera de `CON_CADENA_DEL_DUENO` que nombre `PEDERNAL_DB_DUENO_DIRECTA` (la cadena de la base con la que se escribe);
 *  2. un workflow fuera de `CON_CLAVE_DE_NEON` que nombre `NEON_API_KEY` o `NEON_PROJECT_ID`;
 *  3. un workflow que hable con Neon fuera de `CON_CLAVE_DE_NEON`: la API (`console.neon.tech`), su línea de comandos (`neonctl`) o una
 *     acción de `neondatabase/`;
 *  4. en un workflow que hable con Neon: un método que escribe distinto de GET y POST (`DELETE`, `PUT`, `PATCH`), o las palabras de
 *     restaurar, resetear, snapshots, proyectos o borrar una rama. Lo único permitido es listar ramas y crear una (`/branches`).
 *
 * Previene: que un workflow nuevo, que nadie revisó como los de la lista, borre, resetee o restaure la base de producción o cree
 * proyectos. Es una lectura del TEXTO de los archivos (como `workflow-migrar.test.ts`: no hay un lector de YAML entre las
 * dependencias). Los comentarios no cuentan.
 *
 * Límites que NO ve: el MCP de Neon usado por una sesión (es proceso, no un archivo); un workflow que arme la llamada a Neon con texto
 * partido o venido de otro lado; SQL de escritura contra `production` hecho con una cadena que no sea la del dueño.
 */

/** Los únicos workflows con la cadena DIRECTA del dueño de la base (cada uno con su prueba propia `workflow-<nombre>.test.ts`). */
const CON_CADENA_DEL_DUENO: readonly string[] = [
  "cargar-entorno-consola.yml",
  "cargar-entorno.yml",
  "migrar.yml",
  "preparar-empresa-de-pruebas.yml",
];

/** Los únicos workflows con la clave de la API de Neon y el identificador del proyecto: crean la rama de respaldo antes de migrar. */
const CON_CLAVE_DE_NEON: readonly string[] = ["migrar.yml"];

const CARPETA = join(import.meta.dirname, "../../.github/workflows");

type Archivos = Readonly<Record<string, string>>;

function leerTodos(): Archivos {
  const archivos: Record<string, string> = {};
  for (const nombre of readdirSync(CARPETA).filter((n) => /\.ya?ml$/.test(n))) {
    archivos[nombre] = readFileSync(join(CARPETA, nombre), "utf8");
  }
  return archivos;
}

const sinComentarios = (texto: string) =>
  texto
    .split("\n")
    .filter((linea) => !linea.trim().startsWith("#"))
    .join("\n");

// Lo que habla con Neon por fuera de la clave: su API, su línea de comandos y sus acciones de GitHub.
const HABLA_CON_NEON =
  /console\.neon\.tech|api\.neon\.tech|neonctl|\bneon\s+(branches|projects)\b|uses:\s*neondatabase\//i;
// Métodos que escriben, salvo POST (crear la rama de respaldo) y GET (listar).
const METODO_QUE_ESCRIBE =
  /(?:-X|--request|-XDELETE)\s*['"]?(?:DELETE|PUT|PATCH)\b|--method[ =]['"]?(?:DELETE|PUT|PATCH)\b/i;
// Restaurar, resetear, snapshots, proyectos y borrar una rama.
const VERBOS_PROHIBIDOS =
  /\/restore\b|restore_branch|reset_from_parent|\/reset\b|\/snapshots?\b|\bsnapshots?\b|delete[_-]?branch|branches\s+delete|delete[_-]?project|projects\s+delete/i;
// Toda llamada a la API de Neon va a `.../projects/$NEON_PROJECT_ID/branches`: listar o crear una rama de ESE proyecto.
const RUTA_DE_LA_API = /api\/v2\/[^\s"']*/g;
const RUTA_PERMITIDA = "api/v2/projects/$NEON_PROJECT_ID/branches";

/** Los problemas de un conjunto de workflows (`[]` si cumple). Cada texto es «código: archivo». */
function problemasDeLosWorkflows(archivos: Archivos): string[] {
  const problemas: string[] = [];
  for (const [nombre, original] of Object.entries(archivos)) {
    const texto = sinComentarios(original);
    if (texto.includes("PEDERNAL_DB_DUENO_DIRECTA") && !CON_CADENA_DEL_DUENO.includes(nombre)) {
      problemas.push(`cadena-del-dueno-fuera-de-la-lista: ${nombre}`);
    }
    const conClave = /NEON_API_KEY|NEON_PROJECT_ID/.test(texto);
    if (conClave && !CON_CLAVE_DE_NEON.includes(nombre)) {
      problemas.push(`clave-de-neon-fuera-de-la-lista: ${nombre}`);
    }
    const hablaConNeon = HABLA_CON_NEON.test(texto);
    if (hablaConNeon && !CON_CLAVE_DE_NEON.includes(nombre)) {
      problemas.push(`llamada-a-neon-fuera-de-la-lista: ${nombre}`);
    }
    if (hablaConNeon || conClave) {
      if (METODO_QUE_ESCRIBE.test(texto)) problemas.push(`metodo-que-escribe-en-neon: ${nombre}`);
      if (VERBOS_PROHIBIDOS.test(texto))
        problemas.push(`restaurar-resetear-o-borrar-en-neon: ${nombre}`);
      for (const [ruta] of texto.matchAll(RUTA_DE_LA_API)) {
        if (ruta !== RUTA_PERMITIDA)
          problemas.push(`ruta-de-neon-no-permitida: ${nombre} (${ruta})`);
      }
    }
  }
  return problemas;
}

describe("workflows y Neon: el conjunto", () => {
  const TODOS = leerTodos();

  it("hay workflows que mirar y las listas apuntan a archivos que existen (un renombre no las vacía en silencio)", () => {
    expect(Object.keys(TODOS).length).toBeGreaterThanOrEqual(7);
    for (const nombre of [...CON_CADENA_DEL_DUENO, ...CON_CLAVE_DE_NEON]) {
      expect(Object.keys(TODOS), nombre).toContain(nombre);
    }
    // La lista de la clave de Neon es un subconjunto de la de la cadena del dueño: quien crea el respaldo es quien migra.
    for (const nombre of CON_CLAVE_DE_NEON) expect(CON_CADENA_DEL_DUENO).toContain(nombre);
  });

  it("cumplen todas las propiedades", () => {
    expect(problemasDeLosWorkflows(TODOS)).toEqual([]);
  });

  it("la lista exacta de quién usa cada credencial es la que declaran las listas", () => {
    const conCadena = Object.entries(TODOS)
      .filter(([, t]) => sinComentarios(t).includes("PEDERNAL_DB_DUENO_DIRECTA"))
      .map(([n]) => n)
      .sort();
    expect(conCadena).toEqual([...CON_CADENA_DEL_DUENO].sort());
    const conClave = Object.entries(TODOS)
      .filter(([, t]) => /NEON_API_KEY|NEON_PROJECT_ID/.test(sinComentarios(t)))
      .map(([n]) => n)
      .sort();
    expect(conClave).toEqual([...CON_CLAVE_DE_NEON].sort());
  });

  describe("violaciones inyectadas: cada una se detecta", () => {
    const reemplazar = (de: string, a: string) => (archivos: Archivos) => {
      const texto = archivos["migrar.yml"] ?? "";
      if (!texto.includes(de)) throw new Error(`la violación inyectada no encuentra «${de}»`);
      return { ...archivos, "migrar.yml": texto.replace(de, a) };
    };
    const conArchivoNuevo = (nombre: string, texto: string) => (archivos: Archivos) => ({
      ...archivos,
      [nombre]: texto,
    });
    const BASE_NUEVO =
      "name: Nuevo\non:\n  workflow_dispatch:\njobs:\n  uno:\n    runs-on: ubuntu-latest\n    steps:\n";

    const casos: [string, string, (archivos: Archivos) => Archivos][] = [
      [
        "cadena-del-dueno-fuera-de-la-lista",
        "un workflow nuevo con la cadena del dueño",
        conArchivoNuevo(
          "nuevo.yml",
          `${BASE_NUEVO}      - run: echo\n        env:\n          X: \${{ secrets.PEDERNAL_DB_DUENO_DIRECTA }}\n`,
        ),
      ],
      [
        "clave-de-neon-fuera-de-la-lista",
        "un workflow nuevo con la clave de la API de Neon",
        conArchivoNuevo(
          "nuevo.yml",
          `${BASE_NUEVO}      - run: echo\n        env:\n          X: \${{ secrets.NEON_API_KEY }}\n`,
        ),
      ],
      [
        "clave-de-neon-fuera-de-la-lista",
        "un workflow existente (el de cargar entorno) con el identificador del proyecto de Neon",
        (archivos) => ({
          ...archivos,
          "cargar-entorno.yml": `${archivos["cargar-entorno.yml"] ?? ""}\n          P: \${{ secrets.NEON_PROJECT_ID }}\n`,
        }),
      ],
      [
        "llamada-a-neon-fuera-de-la-lista",
        "un workflow nuevo que llama a la API de Neon sin la clave en su texto",
        conArchivoNuevo(
          "nuevo.yml",
          `${BASE_NUEVO}      - run: curl -s https://console.neon.tech/api/v2/projects/p/branches\n`,
        ),
      ],
      [
        "llamada-a-neon-fuera-de-la-lista",
        "un workflow nuevo con la línea de comandos de Neon",
        conArchivoNuevo("nuevo.yml", `${BASE_NUEVO}      - run: neonctl branches list\n`),
      ],
      [
        "llamada-a-neon-fuera-de-la-lista",
        "un workflow nuevo con una acción de Neon",
        conArchivoNuevo(
          "nuevo.yml",
          `${BASE_NUEVO}      - uses: neondatabase/delete-branch-action@1111111111111111111111111111111111111111\n`,
        ),
      ],
      [
        "metodo-que-escribe-en-neon",
        "un DELETE a la API de Neon desde migrar.yml",
        reemplazar(
          `codigo=$(curl -sS -o /dev/null -w '%{http_code}' -X POST`,
          `codigo=$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE`,
        ),
      ],
      [
        "metodo-que-escribe-en-neon",
        "un PATCH a la API de Neon desde migrar.yml",
        reemplazar(
          `codigo=$(curl -sS -o /dev/null -w '%{http_code}' -X POST`,
          `codigo=$(curl -sS -o /dev/null -w '%{http_code}' --request PATCH`,
        ),
      ],
      [
        "restaurar-resetear-o-borrar-en-neon",
        "restaurar una rama desde migrar.yml",
        reemplazar(
          'api="https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches"',
          'api="https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches/restore"',
        ),
      ],
      [
        "restaurar-resetear-o-borrar-en-neon",
        "resetear una rama desde su padre",
        reemplazar(
          'echo "Rama de respaldo «$nombre» creada en Neon."',
          'echo "Rama de respaldo «$nombre» creada en Neon."; echo reset_from_parent',
        ),
      ],
      [
        "restaurar-resetear-o-borrar-en-neon",
        "crear un snapshot",
        reemplazar(
          'echo "Rama de respaldo «$nombre» creada en Neon."',
          'echo "Rama de respaldo «$nombre» creada en Neon."; echo snapshots',
        ),
      ],
      [
        "ruta-de-neon-no-permitida",
        "crear un proyecto de Neon (POST a /projects)",
        reemplazar(
          'api="https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches"',
          'api="https://console.neon.tech/api/v2/projects"',
        ),
      ],
      [
        "ruta-de-neon-no-permitida",
        "tocar la rama de OTRO proyecto (id fijo en vez de la variable validada)",
        reemplazar(
          'api="https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches"',
          'api="https://console.neon.tech/api/v2/projects/flat-flower-36030007/branches"',
        ),
      ],
    ];

    it.each(casos)("«%s»: %s", (codigo, _descripcion, inyectar) => {
      const problemas = problemasDeLosWorkflows(inyectar(TODOS));
      expect(
        problemas.some((p) => p.startsWith(`${codigo}:`)),
        problemas.join(" | "),
      ).toBe(true);
    });

    it("un comentario que nombra la credencial no cuenta (solo el texto activo)", () => {
      const archivos = conArchivoNuevo(
        "nuevo.yml",
        `# usa NEON_API_KEY y PEDERNAL_DB_DUENO_DIRECTA, console.neon.tech y -X DELETE\n${BASE_NUEVO}      - run: echo hola\n`,
      )(TODOS);
      expect(problemasDeLosWorkflows(archivos)).toEqual([]);
    });
  });
});
