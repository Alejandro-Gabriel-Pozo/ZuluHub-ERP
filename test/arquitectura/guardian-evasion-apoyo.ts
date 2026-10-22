import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { cpus, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BASE, EXCLUSIONES_BASE, RAIZ_ORIGINAL } from "./guardian-apoyo";

/**
 * Apoyo de la batería de evasión (`guardian-evasion.test.ts`, contratos-arquitectonicos.md §11): arma, para
 * cada caso del catálogo (`arquitectura/contratos/evasiones.json`), un repositorio git SINTÉTICO y sano,
 * le aplica las operaciones declarativas del caso, hace el commit y corre lo que corre la CI en el job
 * `guardian`: los pasos `run:` de ese job tal como los deja el `ci.yml` del cambio (el guardián del cambio
 * y la vigilancia de la versión anterior, `no-debilitar.cjs` de la base, contra el árbol del cambio).
 *
 * No es GitHub Actions: no evalúa expresiones ni ejecuta `uses:` (salvo sacar la rama base en `./base`).
 * Lo que sí hace es lo que importa para la evasión: un paso con `if: false` se saltea, un `shell`, un
 * `env` o un `$GITHUB_ENV` cambian cómo corre el guardián, y un paso que falta no corre. Todo se copia de
 * `RAIZ_ORIGINAL`, nunca del sandbox de Stryker (sin `.git`, con los `.cjs` instrumentados).
 */

const require = createRequire(import.meta.url);

// --- El catálogo ----------------------------------------------------------------------------------------

type Operacion = { op: string } & Record<string, unknown>;
type Esperado = { tipo: string; codigo?: string; archivo?: string; linea?: number };
export type Caso = {
  id: string;
  via: string;
  titulo: string;
  construccion: Operacion[];
  construccionBase?: Operacion[];
  plantilla?: string;
  reloj?: number;
  sinGit?: boolean;
  controlEsperado: string;
  esperado: Esperado;
  estado: string;
  [campo: string]: unknown;
};
type Falla = {
  codigo: string;
  archivo: string;
  linea?: number | undefined;
  herramienta: "guardian" | "vigilancia";
};
type PasoCorrido = {
  nombre: string;
  rol: "guardian" | "vigilancia" | "otro";
  estado: number | null;
  salida: string;
};
export type Observado = { resultado: "pasa" | "bloquea"; fallas: Falla[]; pasos: PasoCorrido[] };

export const ARCHIVO_DEL_CATALOGO = "arquitectura/contratos/evasiones.json";
export const ARCHIVO_DE_LOS_EXTERNOS = "arquitectura/contratos/evasiones-github.json";

export const { VIAS, validarCatalogo, evaluarResultado } =
  require("../../arquitectura/contratos/evasiones.cjs") as {
    VIAS: readonly string[];
    validarCatalogo: (
      catalogo: unknown,
      contexto: { ahora: Date },
    ) => {
      fallas: { codigo: string; archivo: string; motivo: string }[];
      avisos: { codigo: string; archivo: string; motivo: string }[];
    };
    evaluarResultado: (
      caso: Caso,
      indice: number,
      observado: {
        resultado: string;
        fallas: { codigo: string; archivo: string; linea?: number | undefined }[];
      },
    ) => { codigo: string; archivo: string; motivo: string; donde: unknown } | null;
  };

/** El catálogo real (el texto y los casos): se lee del proyecto original. */
export function leerCatalogo(archivo: string = ARCHIVO_DEL_CATALOGO): {
  texto: string;
  casos: Caso[];
} {
  const texto = readFileSync(join(RAIZ_ORIGINAL, archivo), "utf8");
  return { texto, casos: JSON.parse(texto) as Caso[] };
}

/** Las vías del catálogo que no tienen ningún caso (E1). */
export const viasSinCasos = (casos: readonly { via: string }[]): string[] =>
  VIAS.filter((via) => !casos.some((caso) => caso.via === via));

/** Los casos del catálogo que la corrida no ejecutó o ejecutó sin resultado (E5: ninguno se omite en silencio). */
export const casosSinResultado = (
  casos: readonly { id: string }[],
  resultados: ReadonlyMap<string, unknown>,
): string[] => casos.map((caso) => caso.id).filter((id) => !resultados.has(id));

// --- Procesos --------------------------------------------------------------------------------------------

type Salida = { estado: number | null; stdout: string; stderr: string };
/** Variables de entorno de un proceso hijo. */
type Entorno = Record<string, string | undefined>;

/** Corre un comando sin bloquear el proceso de la prueba; con tope de tiempo (muere por señal: `estado` nulo). */
function correr(
  comando: string,
  argumentos: string[],
  opciones: { cwd: string; env: Entorno; limiteMs?: number },
): Promise<Salida> {
  return new Promise((resolver) => {
    const hijo = spawn(comando, argumentos, {
      cwd: opciones.cwd,
      env: opciones.env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const salida: Buffer[] = [];
    const errores: Buffer[] = [];
    hijo.stdout.on("data", (trozo: Buffer) => salida.push(trozo));
    hijo.stderr.on("data", (trozo: Buffer) => errores.push(trozo));
    const reloj = setTimeout(() => hijo.kill("SIGKILL"), opciones.limiteMs ?? 120_000);
    const terminar = (estado: number | null): void => {
      clearTimeout(reloj);
      resolver({
        estado,
        stdout: Buffer.concat(salida).toString(),
        stderr: Buffer.concat(errores).toString(),
      });
    };
    hijo.on("error", () => terminar(null));
    hijo.on("close", (estado) => terminar(estado));
  });
}

/** El entorno de las herramientas: lo mínimo (Node, git y un git sin configuración del usuario). */
function entornoBase(): Entorno {
  return {
    PATH: `${dirname(process.execPath)}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
    HOME: tmpdir(),
    LANG: "C.UTF-8",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "evasion",
    GIT_AUTHOR_EMAIL: "evasion@example.invalid",
    GIT_COMMITTER_NAME: "evasion",
    GIT_COMMITTER_EMAIL: "evasion@example.invalid",
  };
}

async function git(cwd: string, ...argumentos: string[]): Promise<void> {
  const r = await correr("git", ["-c", "commit.gpgsign=false", ...argumentos], {
    cwd,
    env: entornoBase(),
    limiteMs: 60_000,
  });
  if (r.estado !== 0) throw new Error(`git ${argumentos.join(" ")} falló: ${r.stderr}`);
}
const commitear = async (cwd: string, mensaje: string): Promise<void> => {
  await git(cwd, "add", "-A");
  await git(cwd, "commit", "-q", "--allow-empty", "-m", mensaje);
};

// --- Un lector del YAML que usa el job del guardián -------------------------------------------------------

export type Valor = string | number | boolean | null | Valor[] | { [clave: string]: Valor };

/** El valor de un campo del YAML como texto; un mapa o una lista no son un texto: quedan como el valor por omisión. */
const comoTexto = (valor: Valor | undefined, porOmision = ""): string =>
  typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean"
    ? String(valor)
    : porOmision;
type Mapa = { [clave: string]: Valor };

const CLAVE = /^(?:"([^"]+)"|'([^']+)'|([^\s"'#:][^:]*?))\s*:(?:\s+(.*))?$/;

/** Saca el comentario del final de un valor (` # …`), respetando las comillas. */
function sinComentario(texto: string): string {
  if (texto.startsWith('"') || texto.startsWith("'")) {
    const cierre = texto.indexOf(texto.charAt(0), 1);
    return cierre === -1 ? texto : texto.slice(0, cierre + 1);
  }
  const marca = / #/.exec(texto);
  return marca === null ? texto : texto.slice(0, marca.index).trimEnd();
}

function escalar(crudo: string): Valor {
  const texto = sinComentario(crudo.trim());
  if (/^".*"$/.test(texto) || /^'.*'$/.test(texto)) return texto.slice(1, -1);
  if (texto === "true") return true;
  if (texto === "false") return false;
  if (texto === "") return null;
  return texto;
}

/**
 * Lee el subconjunto de YAML del `ci.yml` (estilo de Prettier): mapas, listas de guiones, escalares con o sin
 * comillas, claves con comillas o con espacio antes de los dos puntos, y bloques `|` y `>`. Lo que no entiende
 * LANZA (el caso se vuelve un error de la prueba: nunca se supone que «pasa»).
 */
export function leerYaml(texto: string): Valor {
  const lineas = texto.split(/\r?\n/);
  let i = 0;
  const linea = (n: number): string => lineas[n] ?? "";
  const sangria = (n: number): number => linea(n).length - linea(n).trimStart().length;
  const saltar = (): void => {
    while (i < lineas.length && (linea(i).trim() === "" || linea(i).trimStart().startsWith("#"))) {
      i += 1;
    }
  };
  const esItem = (n: number): boolean => /^-(?:\s|$)/.test(linea(n).trimStart());

  function bloqueDeTexto(cabecera: string, base: number): string {
    const cuerpo: string[] = [];
    while (i < lineas.length && (linea(i).trim() === "" || sangria(i) > base)) {
      cuerpo.push(linea(i));
      i += 1;
    }
    const sangrias = cuerpo
      .filter((l) => l.trim() !== "")
      .map((l) => l.length - l.trimStart().length);
    const quitar = Math.min(...sangrias);
    const limpias = cuerpo.map((l) => l.slice(quitar).trimEnd());
    while (limpias.at(-1) === "") limpias.pop();
    return cabecera.startsWith("|") ? `${limpias.join("\n")}\n` : limpias.join(" ");
  }
  function valorDe(resto: string, base: number): Valor {
    const limpio = sinComentario(resto.trim());
    if (/^[|>][-+]?$/.test(limpio)) return bloqueDeTexto(limpio, base);
    if (limpio !== "") return escalar(limpio);
    saltar();
    if (i < lineas.length && sangria(i) > base) return bloque();
    if (i < lineas.length && sangria(i) === base && esItem(i)) return secuencia(base);
    return null;
  }
  function mapa(base: number): Mapa {
    const resultado: Mapa = {};
    for (;;) {
      saltar();
      if (i >= lineas.length || sangria(i) !== base) break;
      const encontrada = CLAVE.exec(linea(i).trim());
      if (encontrada === null) {
        throw new Error(`YAML no soportado en la línea ${i + 1}: ${linea(i).trim()}`);
      }
      const clave = encontrada[1] ?? encontrada[2] ?? encontrada[3] ?? "";
      i += 1;
      resultado[clave] = valorDe(encontrada[4] ?? "", base);
    }
    return resultado;
  }
  function secuencia(base: number): Valor[] {
    const elementos: Valor[] = [];
    for (;;) {
      saltar();
      if (i >= lineas.length || sangria(i) !== base || !esItem(i)) break;
      const original = linea(i);
      const resto = original.slice(base + 1).trimStart();
      const columna = original.length - resto.length;
      if (resto === "") {
        i += 1;
        elementos.push(bloque());
      } else if (CLAVE.test(resto)) {
        // `- clave: valor`: la línea pasa a ser la primera clave de un mapa con la sangria del contenido.
        lineas[i] = " ".repeat(columna) + resto;
        elementos.push(mapa(columna));
      } else {
        i += 1;
        elementos.push(escalar(resto));
      }
    }
    return elementos;
  }
  function bloque(): Valor {
    saltar();
    return esItem(i) ? secuencia(sangria(i)) : mapa(sangria(i));
  }
  const resultado = bloque();
  saltar();
  if (i < lineas.length) throw new Error(`YAML no soportado: sobra texto en la línea ${i + 1}`);
  return resultado;
}

const esMapa = (valor: Valor | undefined): valor is Mapa =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

/** El job `id` de un `ci.yml`, leído como mapa; lanza si el job no está o si el YAML no se entiende. */
export function leerJob(textoCi: string, id: string): Valor {
  return leerYaml(lineasDelJob(textoCi, id));
}

/** Las líneas del job `id` de un `ci.yml` (sin su cabecera), o lanza si no está. */
function lineasDelJob(texto: string, id: string): string {
  const lineas = texto.split(/\r?\n/);
  const inicio = lineas.findIndex((l) => new RegExp(`^ {2}${id}:\\s*$`).test(l));
  if (inicio === -1) throw new Error(`el ci.yml no tiene el job «${id}»`);
  let fin = lineas.length;
  for (let n = inicio + 1; n < lineas.length; n += 1) {
    const l = lineas[n] ?? "";
    if (l.trim() !== "" && !l.trimStart().startsWith("#") && l.length - l.trimStart().length <= 2) {
      fin = n;
      break;
    }
  }
  return lineas.slice(inicio + 1, fin).join("\n");
}

// --- El job del guardián, emulado -------------------------------------------------------------------------

/** ¿El `if` de un paso lo saltea? Solo el `false` literal; `github.event_name == 'pull_request'` se cumple. */
const seSaltea = (condicion: Valor | undefined): boolean =>
  condicion === false || /^(?:\$\{\{\s*)?false(?:\s*\}\})?$/.test(comoTexto(condicion).trim());

const sinExpresiones = (variables: Valor | undefined): Record<string, string> =>
  esMapa(variables)
    ? Object.fromEntries(
        Object.entries(variables)
          .filter(([, valor]) => !comoTexto(valor).includes("${{"))
          .map(([clave, valor]) => [clave, comoTexto(valor)]),
      )
    : {};

function rolDe(guion: string): PasoCorrido["rol"] {
  if (guion.includes("no-debilitar.cjs")) return "vigilancia";
  if (guion.includes("guardian.cjs")) return "guardian";
  return "otro";
}

/** Copia un árbol sin su `.git` (la base que saca el segundo `checkout`, o la plantilla de un caso). */
function copiarSinGit(origen: string, destino: string): void {
  cpSync(origen, destino, {
    recursive: true,
    filter: (ruta) => !ruta.endsWith("/.git") && !ruta.includes("/.git/"),
  });
}

/**
 * Corre, en orden, los pasos del job `guardian` del `ci.yml` del cambio (`pr`), como lo haría el runner con
 * bash: respeta `if: false`, `shell` (del job o del paso), `env`, `working-directory` y `$GITHUB_ENV`, y se
 * detiene en el primer paso que falla. El paso de `actions/checkout` con `path: base` deja la base en `./base`.
 */
async function correrElJobDelGuardian(
  pr: string,
  base: string,
  entorno: Entorno,
): Promise<PasoCorrido[]> {
  const ci = readFileSync(join(pr, ".github/workflows/ci.yml"), "utf8");
  const job = leerJob(ci, "guardian");
  if (!esMapa(job) || !Array.isArray(job["steps"]))
    throw new Error("el job guardian no tiene pasos");
  const valorPorDefecto = esMapa(job["defaults"]) ? job["defaults"]["run"] : undefined;
  const shellDelJob = esMapa(valorPorDefecto) ? valorPorDefecto["shell"] : undefined;
  const carpetaDeTrabajo = mkdtempSync(join(tmpdir(), "evasion-job-"));
  const pasos: PasoCorrido[] = [];
  let acumulado: Record<string, string> = {};
  try {
    for (const [numero, paso] of job["steps"].entries()) {
      if (!esMapa(paso)) throw new Error("un paso del job guardian no es un mapa");
      const nombre = comoTexto(paso["name"] ?? paso["uses"], "(paso sin nombre)");
      if (seSaltea(paso["if"])) continue;
      if (paso["uses"] !== undefined) {
        const con = paso["with"];
        if (esMapa(con) && con["path"] === "base") copiarSinGit(base, join(pr, "base"));
        continue;
      }
      const guion = comoTexto(paso["run"]);
      const archivoDelGuion = join(carpetaDeTrabajo, `paso-${numero}.sh`);
      const archivoDeEntorno = join(carpetaDeTrabajo, `entorno-${numero}`);
      writeFileSync(archivoDelGuion, guion);
      writeFileSync(archivoDeEntorno, "");
      const shell = comoTexto(paso["shell"] ?? shellDelJob, "bash");
      const comando =
        shell === "bash"
          ? ["bash", "--noprofile", "--norc", "-eo", "pipefail", archivoDelGuion]
          : shell.includes("{0}")
            ? shell.split(/\s+/).map((trozo) => trozo.replace("{0}", archivoDelGuion))
            : [...shell.split(/\s+/), archivoDelGuion];
      const r = await correr(comando[0] ?? "bash", comando.slice(1), {
        cwd: join(pr, comoTexto(paso["working-directory"], ".")),
        env: {
          ...entorno,
          CI: "true",
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_ENV: archivoDeEntorno,
          ...sinExpresiones(job["env"]),
          ...acumulado,
          ...sinExpresiones(paso["env"]),
        },
      });
      for (const linea of readFileSync(archivoDeEntorno, "utf8").split("\n")) {
        const asignacion = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(linea);
        if (asignacion !== null)
          acumulado = { ...acumulado, [asignacion[1] ?? ""]: asignacion[2] ?? "" };
      }
      pasos.push({
        nombre,
        rol: rolDe(guion),
        estado: r.estado,
        salida: `${r.stdout}${r.stderr}`.slice(-2000),
      });
      if (r.estado !== 0) break;
    }
  } finally {
    rmSync(carpetaDeTrabajo, { recursive: true, force: true });
  }
  return pasos;
}

// --- Qué dijeron las herramientas ---------------------------------------------------------------------------

const GUION_DE_VIGILANCIA = `
const path = require("node:path");
const fs = require("node:fs");
const [base, pr] = process.argv.slice(1);
const nd = require(path.join(base, "arquitectura/contratos/no-debilitar.cjs"));
const leerPr = (ruta) => { try { return fs.readFileSync(path.join(pr, ruta)); } catch { return null; } };
const r = nd.verificar({ base: nd.capturar(base), pr: nd.capturar(pr), ahora: new Date(), leerPr });
process.stdout.write("\\n@@" + JSON.stringify(r.fallas.map((f) => ({ codigo: f.codigo, archivo: f.archivo, linea: f.linea }))) + "\\n");
`;

/** Las fallas (con su código) que la vigilancia de la base dice sobre el cambio: el CLI no imprime el código. */
async function fallasDeLaVigilancia(base: string, pr: string, entorno: Entorno): Promise<Falla[]> {
  const r = await correr(process.execPath, ["-e", GUION_DE_VIGILANCIA, base, pr], {
    cwd: pr,
    env: entorno,
  });
  const marcada = r.stdout.split("\n").find((l) => l.startsWith("@@"));
  if (marcada === undefined) return [];
  const lista = JSON.parse(marcada.slice(2)) as Omit<Falla, "herramienta">[];
  return lista.map((f) => ({ ...f, herramienta: "vigilancia" as const }));
}

/** Las fallas (con su código) del informe que escribió el guardián del cambio; vacío si no hay informe. */
function fallasDelGuardian(pr: string): Falla[] {
  try {
    const informe = JSON.parse(
      readFileSync(join(pr, "arquitectura/contratos/informe.json"), "utf8"),
    ) as { fallas: Omit<Falla, "herramienta">[] };
    return informe.fallas.map((f) => ({
      codigo: f.codigo,
      archivo: f.archivo,
      linea: f.linea,
      herramienta: "guardian" as const,
    }));
  } catch {
    return [];
  }
}

// --- El repositorio sintético --------------------------------------------------------------------------------

const hoyMas = (ahora: Date, dias: number): string =>
  new Date(ahora.getTime() + dias * 86_400_000).toISOString().slice(0, 10);
const sha256 = (contenido: string | Buffer): string =>
  createHash("sha256").update(contenido).digest("hex");

const ESCRIBIR = (ruta: string, contenido: string | Buffer): void => {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, contenido);
};

/** El contrato sintético de las plantillas «con-contrato»: el color de ejemplo, con su fuente y su uso. */
function registroDeEjemplo(clasesDeUso: string[]): string {
  return `"use strict";
// REGISTRO SINTÉTICO de la batería de evasión (no es el registro real).
const { porPatron } = require("./detectores.cjs");

module.exports = [
  {
    id: "color-de-prueba",
    protege: "Contrato sintético: el color de ejemplo sale de una única fuente de verdad.",
    alcance: "Código de producción.",
    fuenteDeVerdad: { archivo: "src/primitivas/color-de-prueba.cjs", exportacion: "COLOR_DE_PRUEBA" },
    incumplimiento: "Usar el color sin declararlo, o copiar su valor en otro archivo.",
    deteccion: [
      porPatron({ tipo: "uso", clases: ${JSON.stringify(clasesDeUso)}, patron: /^(?!\\s*exports\\.COLOR_DE_PRUEBA\\s*=).*\\bCOLOR_DE_PRUEBA\\b/, nombre: "uso del identificador" }),
      porPatron({ tipo: "definicion", clases: ${JSON.stringify(clasesDeUso)}, patron: /#a1b2c3/, nombre: "valor copiado" }),
    ],
    limites: "Detector de texto por línea: no sigue alias, claves calculadas ni otras codificaciones.",
    version: "1.0.0",
    politicaDeCambio: "Compatible: se agrega. Incompatible: fuente, consumidores y pruebas en el mismo PR.",
    bloqueaDeclaracionFalsa: true,
  },
];
`;
}

/** Arma la plantilla `nombre` en `destino` (carpeta nueva), con su `.git` y un commit. */
function construirPlantilla(nombre: string, destino: string, ahora: Date): void {
  for (const [ruta, contenido] of Object.entries(BASE)) ESCRIBIR(join(destino, ruta), contenido);
  ESCRIBIR(join(destino, "scripts/baja-de-admin.ts"), "export {};\n");
  // Lo real que los casos de la maquinaria alteran: se copia del proyecto original, nunca del sandbox.
  cpSync(join(RAIZ_ORIGINAL, "arquitectura"), join(destino, "arquitectura"), {
    recursive: true,
    filter: (ruta) => !ruta.endsWith("informe.json"),
  });
  for (const archivo of [
    ".github/workflows/ci.yml",
    "package.json",
    "vitest.config.ts",
    "stryker.config.json",
    "knip.json",
    ".gitignore",
  ]) {
    ESCRIBIR(join(destino, archivo), readFileSync(join(RAIZ_ORIGINAL, archivo)));
  }
  // Lo que depende de la fecha: las exclusiones vigentes, y un catálogo de evasión vacío.
  const exclusiones = EXCLUSIONES_BASE.map((e) => ({
    ...e,
    creada: hoyMas(ahora, 0),
    vence: hoyMas(ahora, 30),
  }));
  ESCRIBIR(
    join(destino, "arquitectura/contratos/exclusiones.json"),
    `${JSON.stringify(exclusiones, null, 2)}\n`,
  );
  ESCRIBIR(join(destino, ARCHIVO_DEL_CATALOGO), "[]\n");
  if (nombre !== "sano") {
    const clases = ["frontend", "backend", "scripts", "migraciones"];
    ESCRIBIR(
      join(destino, "arquitectura/contratos/contratos.cjs"),
      registroDeEjemplo(nombre === "con-contrato" ? clases : [...clases, "pruebas"]),
    );
    ESCRIBIR(
      join(destino, "src/primitivas/color-de-prueba.cjs"),
      `"use strict";\nexports.COLOR_DE_PRUEBA = "#a1b2c3";\n`,
    );
    ESCRIBIR(
      join(destino, "src/primitivas/contratos.json"),
      JSON.stringify({ usa: [], noUsa: "Fuente de verdad del contrato de ejemplo." }),
    );
    ESCRIBIR(
      join(destino, "src/modulos/fiscal/usa-color.cjs"),
      `"use strict";\nconst { COLOR_DE_PRUEBA } = require("../../primitivas/color-de-prueba.cjs");\nmodule.exports = () => COLOR_DE_PRUEBA;\n`,
    );
    ESCRIBIR(
      join(destino, "src/modulos/fiscal/contratos.json"),
      JSON.stringify({ usa: ["color-de-prueba"] }),
    );
  }
  for (const orden of [
    ["init", "-q", "-b", "main"],
    ["add", "-A"],
    ["-c", "commit.gpgsign=false", "commit", "-q", "-m", `plantilla ${nombre}`],
  ]) {
    const r = spawnSync("git", orden, {
      cwd: destino,
      env: entornoBase() as NodeJS.ProcessEnv,
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`git ${orden.join(" ")} falló: ${r.stderr}`);
  }
}

// --- Las operaciones declarativas ----------------------------------------------------------------------------

const texto = (operacion: Operacion, campo: string): string => {
  const valor = operacion[campo];
  if (typeof valor !== "string") {
    throw new Error(`la operación «${operacion.op}» necesita «${campo}» (texto)`);
  }
  return valor;
};
const rutaDe = (carpeta: string, operacion: Operacion, campo = "ruta"): string | Buffer => {
  const nombreEnBase64 = operacion[`${campo}Base64`];
  return typeof nombreEnBase64 === "string"
    ? Buffer.concat([Buffer.from(`${carpeta}/`), Buffer.from(nombreEnBase64, "base64")])
    : join(carpeta, texto(operacion, campo));
};
const repetido = (contenido: string, veces: unknown): string =>
  contenido.repeat(typeof veces === "number" ? veces : 1);

/** Los marcadores `{{hoy}}`, `{{hoy+N}}`, `{{huella-archivo:ruta}}` y `{{huella-texto:línea}}` de un texto. */
function expandir(entrada: string, carpeta: string, ahora: Date): string {
  return entrada.replace(
    /\{\{(hoy(?:[+-]\d+)?|huella-archivo:[^}]+|huella-texto:[^}]+)\}\}/g,
    (_todo, marca: string) => {
      if (marca.startsWith("huella-archivo:")) {
        return sha256(readFileSync(join(carpeta, marca.slice("huella-archivo:".length))));
      }
      if (marca.startsWith("huella-texto:"))
        return sha256(marca.slice("huella-texto:".length).trim());
      return hoyMas(ahora, marca === "hoy" ? 0 : Number(marca.slice(3)));
    },
  );
}
const expandirValor = (valor: unknown, carpeta: string, ahora: Date): unknown => {
  if (typeof valor === "string") return expandir(valor, carpeta, ahora);
  if (Array.isArray(valor)) return valor.map((v) => expandirValor(v, carpeta, ahora));
  if (typeof valor === "object" && valor !== null) {
    return Object.fromEntries(
      Object.entries(valor).map(([clave, v]) => [clave, expandirValor(v, carpeta, ahora)]),
    );
  }
  return valor;
};

/** Sigue `camino` dentro de un valor JSON y devuelve el contenedor del último tramo y la clave. */
function alFinalDe(raiz: unknown, camino: (string | number)[]): [Record<string, unknown>, string] {
  let actual = raiz as Record<string, unknown>;
  for (const tramo of camino.slice(0, -1))
    actual = actual[String(tramo)] as Record<string, unknown>;
  return [actual, String(camino.at(-1))];
}

/**
 * Aplica las operaciones sobre `carpeta`. `commit` y `checkout` son marcas: `commit` hace un commit en ese
 * punto; `checkout` separa lo que va en el commit del cambio de lo que se deja en el disco después del
 * `checkout` del runner (sin versionar). Devuelve las operaciones posteriores al `checkout`.
 */
async function aplicar(
  carpeta: string,
  operaciones: Operacion[],
  ahora: Date,
  conGit: boolean,
): Promise<Operacion[]> {
  for (const [numero, operacion] of operaciones.entries()) {
    const ruta = (): string | Buffer => rutaDe(carpeta, operacion);
    switch (operacion.op) {
      case "checkout":
        return operaciones.slice(numero + 1);
      case "commit":
        if (conGit) await commitear(carpeta, `cambio ${numero}`);
        break;
      case "escribir": {
        const contenido =
          typeof operacion["contenidoBase64"] === "string"
            ? Buffer.from(operacion["contenidoBase64"], "base64")
            : repetido(
                expandir(texto(operacion, "contenido"), carpeta, ahora),
                operacion["repetir"],
              );
        mkdirSync(dirname(ruta().toString()), { recursive: true });
        writeFileSync(ruta(), contenido);
        if (typeof operacion["modo"] === "string")
          chmodSync(ruta(), parseInt(operacion["modo"], 8));
        break;
      }
      case "anexar":
        appendFileSync(
          ruta(),
          repetido(expandir(texto(operacion, "contenido"), carpeta, ahora), operacion["repetir"]),
        );
        break;
      case "reemplazar": {
        const actual = readFileSync(ruta(), "utf8");
        const de = expandir(texto(operacion, "de"), carpeta, ahora);
        const veces = actual.split(de).length - 1;
        if (veces !== 1) {
          throw new Error(
            `${comoTexto(operacion["ruta"] as Valor)}: «${de.slice(0, 70)}» aparece ${veces} veces (se esperaba 1)`,
          );
        }
        const a = expandir(texto(operacion, "a"), carpeta, ahora);
        writeFileSync(
          ruta(),
          actual.replace(de, () => a),
        );
        break;
      }
      case "borrar":
        rmSync(ruta(), { recursive: true, force: true });
        break;
      case "renombrar":
        mkdirSync(dirname(join(carpeta, texto(operacion, "a"))), { recursive: true });
        renameSync(join(carpeta, texto(operacion, "de")), join(carpeta, texto(operacion, "a")));
        break;
      case "symlink":
        mkdirSync(dirname(ruta().toString()), { recursive: true });
        symlinkSync(texto(operacion, "destino"), ruta().toString());
        break;
      case "json-poner":
      case "json-agregar": {
        const archivo = join(carpeta, texto(operacion, "ruta"));
        const datos = JSON.parse(readFileSync(archivo, "utf8")) as unknown;
        const camino = (operacion["camino"] ?? []) as (string | number)[];
        const valor = expandirValor(operacion["valor"], carpeta, ahora);
        if (operacion.op === "json-agregar") {
          const lista = camino.reduce<unknown>(
            (nodo, tramo) => (nodo as Record<string, unknown>)[String(tramo)],
            datos,
          );
          (lista as unknown[]).push(valor);
        } else {
          const [contenedor, clave] = alFinalDe(datos, camino);
          contenedor[clave] = valor;
        }
        writeFileSync(archivo, `${JSON.stringify(datos, null, 2)}\n`);
        break;
      }
      default:
        throw new Error(`operación desconocida: ${operacion.op}`);
    }
  }
  return [];
}

// --- Correr un caso -------------------------------------------------------------------------------------------

/** Preload que adelanta el reloj de Node `PEDERNAL_EVASION_DIAS` días (lo heredan los procesos hijos). */
const RELOJ_FALSO = `
const dias = Number(process.env.PEDERNAL_EVASION_DIAS || 0);
if (dias !== 0) {
  const Real = Date;
  const desvio = dias * 86400000;
  globalThis.Date = class extends Real {
    constructor(...argumentos) { if (argumentos.length === 0) super(Real.now() + desvio); else super(...argumentos); }
    static now() { return Real.now() + desvio; }
  };
}
`;

export type Contexto = {
  /** Carpeta de trabajo (temporal) de la corrida entera. */
  raiz: string;
  ahora: Date;
  plantillas: Map<string, string>;
  relojFalso: string;
};

/** Arma las plantillas que usan los casos (una vez) y el preload del reloj. */
export function prepararContexto(plantillasUsadas: Iterable<string>): Contexto {
  const raiz = mkdtempSync(join(tmpdir(), "guardian-evasion-"));
  const ahora = new Date();
  const plantillas = new Map<string, string>();
  for (const nombre of new Set(plantillasUsadas)) {
    const destino = join(raiz, `plantilla-${nombre}`);
    construirPlantilla(nombre, destino, ahora);
    plantillas.set(nombre, destino);
  }
  const relojFalso = join(raiz, "reloj-falso.cjs");
  writeFileSync(relojFalso, RELOJ_FALSO);
  return { raiz, ahora, plantillas, relojFalso };
}
export const limpiarContexto = (contexto: Contexto): void =>
  rmSync(contexto.raiz, { recursive: true, force: true });

/** Arma el repositorio del caso, corre el job del guardián y dice qué pasó. */
async function correrCaso(caso: Caso, contexto: Contexto): Promise<Observado> {
  const nombre = caso.plantilla ?? "sano";
  const plantilla = contexto.plantillas.get(nombre);
  if (plantilla === undefined) throw new Error(`no hay plantilla «${nombre}»`);
  const trabajo = mkdtempSync(join(contexto.raiz, `${caso.id}-`));
  try {
    const pr = join(trabajo, "pr");
    cpSync(plantilla, pr, { recursive: true });
    let base = plantilla;
    if (caso.construccionBase !== undefined) {
      base = join(trabajo, "base-propia");
      copiarSinGit(plantilla, base);
      await aplicar(base, caso.construccionBase, contexto.ahora, false);
    }
    const despues = await aplicar(pr, caso.construccion, contexto.ahora, true);
    await commitear(pr, `cambio de ${caso.id}`);
    await aplicar(pr, despues, contexto.ahora, true);
    if (caso.sinGit === true) rmSync(join(pr, ".git"), { recursive: true, force: true });

    const entorno: Entorno = { ...entornoBase() };
    if (caso.reloj !== undefined && caso.reloj > 0) {
      entorno["NODE_OPTIONS"] = `--require=${contexto.relojFalso}`;
      entorno["PEDERNAL_EVASION_DIAS"] = String(caso.reloj);
    }
    const pasos = await correrElJobDelGuardian(pr, base, entorno);
    const fallo = pasos.some((p) => p.estado !== 0);
    const fallas: Falla[] = [];
    if (pasos.some((p) => p.rol === "guardian" && p.estado !== 0))
      fallas.push(...fallasDelGuardian(pr));
    if (pasos.some((p) => p.rol === "vigilancia" && p.estado === 1)) {
      const baseCopiada = existsSync(join(pr, "base")) ? join(pr, "base") : base;
      fallas.push(...(await fallasDeLaVigilancia(baseCopiada, pr, entorno)));
    }
    return { resultado: fallo ? "bloquea" : "pasa", fallas, pasos };
  } finally {
    rmSync(trabajo, { recursive: true, force: true });
  }
}

/** Corre todos los casos con a lo sumo `concurrencia` a la vez; el resultado de cada uno (o su error). */
export async function correrLaBateria(
  casos: Caso[],
  contexto: Contexto,
  concurrencia = Math.max(2, Math.min(4, cpus().length)),
): Promise<Map<string, Observado | Error>> {
  const resultados = new Map<string, Observado | Error>();
  const pendientes = [...casos];
  const trabajador = async (): Promise<void> => {
    for (let caso = pendientes.shift(); caso !== undefined; caso = pendientes.shift()) {
      try {
        resultados.set(caso.id, await correrCaso(caso, contexto));
      } catch (error) {
        resultados.set(caso.id, error instanceof Error ? error : new Error(String(error)));
      }
    }
  };
  await Promise.all(Array.from({ length: concurrencia }, trabajador));
  return resultados;
}
