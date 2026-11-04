import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { RAIZ, carpetaTemporal } from "./guardian-apoyo";

/**
 * Apoyo de las pruebas del control de deuda técnica (`arquitectura/deuda/*.cjs`): tipos de lo que devuelve,
 * árboles en memoria (rutas y lectura) para evaluar sin git, fábricas de entradas del registro y repositorios
 * git SINTÉTICOS en carpetas temporales para el CLI (nunca el repositorio real ni su `.git`, que el sandbox de
 * la mutación no tiene).
 */

const require = createRequire(import.meta.url);

export type Arbol = { rutas: string[]; leer: (ruta: string) => Buffer | string | null };
export type Hallazgo = {
  codigo: string;
  archivo: string;
  linea: number;
  contrato: string | null;
  motivo: string;
  correccion: string;
  donde?: unknown;
};
type Marcador = { tipo: string; linea: number; tamano?: number };
type Grupo = { tipo: string; archivo: string; lineas: number[]; tamano?: number };
type Medicion = {
  lista: Grupo[];
  porClave: Map<string, Grupo>;
  ilegibles: { archivo: string; linea: number; motivo: string }[];
  analizados: number;
};
export type Configuracion = {
  topeDeExcepciones: number;
  bloqueaDeudaEnArchivoTocado: boolean;
  topeDeLineasPorArchivo: number;
  excluidosDelTope: { ruta: string; motivo: string }[];
};
type EntradaNormalizada = {
  indice: number;
  id: string;
  tipo: string;
  archivos: string[];
  excepcion: boolean;
  vigente: boolean;
  verificacion: string | null;
  tamano: number | null;
  creada: string;
  vence: string | null;
};
type Totales = {
  marcadores: number;
  hallazgos: number;
  total: number;
  archivosConDeuda: number;
  porTipo: Record<string, number>;
};
export type Evaluado = {
  fallas: Hallazgo[];
  avisos: Hallazgo[];
  medicion: Medicion;
  entradas: EntradaNormalizada[];
  configuracion: Configuracion;
};
export type Informe = {
  version: number;
  generadoEn: string;
  resultado: "pasa" | "falla";
  conBase: boolean;
  configuracion: Configuracion;
  total: Totales;
  antiguedad: {
    entradas: number;
    promedioEnDias: number;
    masVieja: { id: string; dias: number } | null;
  };
  excepciones: {
    abiertas: number;
    tope: number;
    lista: { id: string; tipo: string; archivos: string[]; vence: string; diasQueFaltan: number }[];
  };
  tendencia: { base: Totales; pr: Totales; diferencia: number } | null;
  marcadores: Grupo[];
  archivosAnalizados: number;
  fallas: Hallazgo[];
  avisos: Hallazgo[];
};

const {
  DESCRIPCION_DE_MARCADORES,
  TIPOS_DE_MARCADOR,
  detectar,
  familiaDe,
  lexico,
  tipoDeComentario,
} = require("../../arquitectura/deuda/marcadores.cjs") as {
  DESCRIPCION_DE_MARCADORES: Record<string, string>;
  TIPOS_DE_MARCADOR: readonly string[];
  detectar: (
    ruta: string,
    texto: string,
    opciones?: { topeDeLineas: number; excluidos: ReadonlySet<string> },
  ) => { marcadores: Marcador[]; ilegible: { linea: number; motivo: string } | null };
  familiaDe: (ruta: string) => string | null;
  lexico: (
    texto: string,
    familia: string,
  ) => {
    comentarios: { linea: number; texto: string }[];
    codigo: string;
    visible: string;
  };
  tipoDeComentario: (texto: string) => string | null;
};
export const marcadores = {
  DESCRIPCION_DE_MARCADORES,
  TIPOS_DE_MARCADOR,
  detectar,
  familiaDe,
  lexico,
  tipoDeComentario,
};
const {
  ARCHIVO_DE_LA_CONFIGURACION,
  ARCHIVO_DEL_REGISTRO,
  CONTRATO,
  TIPOS,
  TIPOS_DE_HALLAZGO,
  claveDe,
  delRegistro,
  evaluarArbol,
  leerConfiguracion,
  lineaCon,
  medir,
  opcionesDeMedicion,
  textoDe,
  totales,
} = require("../../arquitectura/deuda/libro.cjs") as {
  ARCHIVO_DE_LA_CONFIGURACION: string;
  ARCHIVO_DEL_REGISTRO: string;
  CONTRATO: string;
  TIPOS: readonly string[];
  TIPOS_DE_HALLAZGO: readonly string[];
  claveDe: (tipo: string, archivo: string) => string;
  delRegistro: (codigo: string, motivo: string, correccion: string, donde: unknown) => Hallazgo;
  evaluarArbol: (datos: { arbol: Arbol; ahora: Date }) => Evaluado;
  leerConfiguracion: (leer: Arbol["leer"]) => {
    configuracion: Configuracion;
    fallas: Hallazgo[];
  };
  lineaCon: (texto: string, buscado: string) => number | null;
  medir: (
    arbol: Arbol,
    opciones?: { topeDeLineas: number; excluidos: ReadonlySet<string> },
  ) => Medicion;
  opcionesDeMedicion: (configuracion: Configuracion) => {
    topeDeLineas: number;
    excluidos: Set<string>;
  };
  textoDe: (leer: Arbol["leer"], archivo: string) => string | null;
  totales: (datos: { medicion: Medicion; entradas: EntradaNormalizada[] }) => Totales;
};
export const libro = {
  ARCHIVO_DE_LA_CONFIGURACION,
  ARCHIVO_DEL_REGISTRO,
  CONTRATO,
  TIPOS,
  TIPOS_DE_HALLAZGO,
  claveDe,
  delRegistro,
  evaluarArbol,
  leerConfiguracion,
  lineaCon,
  medir,
  opcionesDeMedicion,
  textoDe,
  totales,
};
const { OPCIONES_POR_DEFECTO, TOPE_DE_LINEAS, lineasDe, tamanoExcedido } =
  require("../../arquitectura/deuda/tamano.cjs") as {
    OPCIONES_POR_DEFECTO: { topeDeLineas: number; excluidos: ReadonlySet<string> };
    TOPE_DE_LINEAS: number;
    lineasDe: (texto: string) => number;
    tamanoExcedido: (
      ruta: string,
      texto: string,
      opciones: { topeDeLineas: number; excluidos: ReadonlySet<string> },
    ) => { linea: number; tamano: number } | null;
  };
export const tamano = { OPCIONES_POR_DEFECTO, TOPE_DE_LINEAS, lineasDe, tamanoExcedido };
export const deuda = require("../../arquitectura/deuda/deuda.cjs") as {
  ejecutar: (datos: { pr: Arbol; base?: Arbol | null; ahora?: Date }) => {
    fallas: Hallazgo[];
    avisos: Hallazgo[];
    informe: Informe;
  };
  cargarArbol: (raiz: string, excluida?: string | null) => Arbol;
  dentroDeLaRaiz: (raiz: string, carpeta: string) => string | null;
  comprobarUbicaciones: (
    fallas: object[],
    avisos: object[],
  ) => { fallas: Hallazgo[]; avisos: Hallazgo[] };
  formatear: (hallazgo: Partial<Hallazgo>) => string;
  resumir: (informe: Informe) => string;
  valorDeOpcion: (argumentos: string[], nombre: string) => string | undefined;
};
export const codigos = require("../../arquitectura/deuda/codigos.cjs") as {
  CODIGOS_DE_FALLA: readonly string[];
  CODIGOS_DE_AVISO: readonly string[];
};

/** «Hoy» de las pruebas: fijo, para que ninguna dependa del reloj real. */
export const AHORA = new Date("2026-10-22T12:00:00Z");
const HOY = "2026-10-22";
export const REGISTRO = "arquitectura/deuda/registro.json";
export const CONFIGURACION = "arquitectura/deuda/configuracion.json";
export const INFORME = "arquitectura/deuda/informe.json";
export const CONFIGURACION_SANA: Configuracion = {
  topeDeExcepciones: 10,
  bloqueaDeudaEnArchivoTocado: true,
  topeDeLineasPorArchivo: 400,
  excluidosDelTope: [],
};

/** JSON de dos espacios con salto final: cada clave en su línea, para que las líneas esperadas sean fijas. */
export const json = (valor: unknown): string => `${JSON.stringify(valor, null, 2)}\n`;

/** Junta líneas con salto final (un archivo de texto). */
export const lineas = (...l: string[]): string => `${l.join("\n")}\n`;

/** Un árbol en memoria con esos archivos (las rutas salen de las claves). */
export function arbolDe(archivos: Record<string, string | Buffer>): Arbol {
  return {
    rutas: Object.keys(archivos),
    leer: (ruta) => archivos[ruta] ?? null,
  };
}

/** Una entrada plana (sin excepción) del registro: un marcador `ts-expect-error` en `a.ts`. */
export function entrada(cambios: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "ts-expect-error--a-ts",
    archivos: ["a.ts"],
    descripcion: "Pruebas negativas de tipos.",
    tipo: "ts-expect-error",
    responsable: "agente (a pedido del dueño)",
    creada: "2026-10-01",
    ...cambios,
  };
}

/** Una excepción vigente: la entrada anterior con motivo, aprobación y un vencimiento a 30 días. */
export function excepcion(cambios: Record<string, unknown> = {}): Record<string, unknown> {
  return entrada({
    motivo: "Se paga en la próxima entrega.",
    aprobadoPor: "Dueño del producto",
    creada: HOY,
    vence: "2026-11-21",
    ...cambios,
  });
}

/** Un archivo de código con una cantidad de `@ts-expect-error` (cada uno en su línea, de la 1 en adelante). */
export const conMarcadores = (cuantos: number): string =>
  lineas(...Array.from({ length: cuantos }, () => "// @ts-expect-error motivo"), "export {};");

/** Un archivo de código sin deuda. */
export const SIN_DEUDA = "export const x = 1;\n";

/** Un árbol sano: su registro (lista) y su configuración más esos archivos. */
export function mundo(
  archivos: Record<string, string>,
  entradas: unknown[] = [],
  configuracion: Partial<Configuracion> | null = {},
): Record<string, string> {
  return {
    ...archivos,
    [REGISTRO]: json(entradas),
    ...(configuracion === null
      ? {}
      : { [CONFIGURACION]: json({ ...CONFIGURACION_SANA, ...configuracion }) }),
  };
}

/** Evalúa un árbol en memoria con el reloj de las pruebas. */
export const evaluar = (archivos: Record<string, string | Buffer>): Evaluado =>
  libro.evaluarArbol({ arbol: arbolDe(archivos), ahora: AHORA });

/** Lo que dijo `deuda.ejecutar` sobre un árbol, con una base opcional. */
export const correr = (
  pr: Record<string, string | Buffer>,
  base?: Record<string, string | Buffer> | null,
  ahora: Date = AHORA,
) =>
  deuda.ejecutar({
    pr: arbolDe(pr),
    base: base === undefined || base === null ? null : arbolDe(base),
    ahora,
  });

/** Los códigos de una lista de hallazgos. */
export const codigosDe = (lista: { codigo: string }[]): string[] => lista.map((h) => h.codigo);

/** archivo:línea de cada hallazgo. */
export const lugaresDe = (lista: Hallazgo[]): string[] =>
  lista.map((h) => `${h.archivo}:${String(h.linea)}`);

// --- Repositorios git sintéticos en disco (para el CLI) ---------------------------------------------------------

/** Sin la configuración global del usuario: la salida de git no depende de quién corre las pruebas. */
const ENTORNO = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

export function git(carpeta: string, ...argumentos: string[]): void {
  const corrida = spawnSync("git", argumentos, { cwd: carpeta, env: ENTORNO, encoding: "utf8" });
  if (corrida.status !== 0) throw new Error(`git ${argumentos.join(" ")} falló: ${corrida.stderr}`);
}

function escribir(raiz: string, ruta: string, contenido: string | Buffer): void {
  mkdirSync(dirname(join(raiz, ruta)), { recursive: true });
  writeFileSync(join(raiz, ruta), contenido);
}

/**
 * Un repositorio git (sin commits) con el código real del control de deuda (y lo que carga del guardián, copiado
 * del árbol que se prueba: instrumentado dentro del sandbox de Stryker) más esos archivos, sin agregar ninguno al
 * índice. El CLI usa la raíz del repositorio donde vive, así que corre sobre este y no sobre el real.
 */
export function repoDeDeuda(archivos: Record<string, string | Buffer>): string {
  const raiz = realpathSync(carpetaTemporal("deuda-cli-"));
  git(raiz, "init", "-q");
  const copiadosGrandes: string[] = [];
  for (const carpeta of ["arquitectura/contratos", "arquitectura/deuda"]) {
    for (const nombre of readdirSync(join(RAIZ, carpeta))) {
      if (nombre.endsWith(".cjs")) {
        // Stryker agrega `// @ts-nocheck` a lo que muta: en el repositorio de juguete sería un marcador de deuda.
        const texto = readFileSync(join(RAIZ, carpeta, nombre), "utf8").replace(
          /^\/\/ @ts-nocheck\r?\n/m,
          "",
        );
        escribir(raiz, `${carpeta}/${nombre}`, texto);
        if (texto.split("\n").length > TOPE_DE_LAS_COPIAS)
          copiadosGrandes.push(`${carpeta}/${nombre}`);
      }
    }
  }
  for (const [ruta, contenido] of Object.entries(archivos)) {
    escribir(
      raiz,
      ruta,
      ruta === CONFIGURACION ? sinLaHerramienta(contenido, copiadosGrandes) : contenido,
    );
  }
  return raiz;
}

/** El tope con el que se miden las copias de la herramienta (el mismo de las configuraciones sanas). */
const TOPE_DE_LAS_COPIAS = 400;

/**
 * La configuración con la herramienta copiada (que pasa del tope) excluida del tope de líneas: el repositorio de
 * juguete mide lo suyo, no el código del control. Una configuración que no es un objeto JSON queda como está.
 */
function sinLaHerramienta(contenido: string | Buffer, copiados: string[]): string | Buffer {
  try {
    const configuracion = JSON.parse(contenido.toString()) as Record<string, unknown>;
    if (
      typeof configuracion !== "object" ||
      configuracion === null ||
      Array.isArray(configuracion)
    ) {
      return contenido;
    }
    const propias: unknown[] = Array.isArray(configuracion["excluidosDelTope"])
      ? (configuracion["excluidosDelTope"] as unknown[])
      : [];
    return json({
      ...configuracion,
      excluidosDelTope: [
        ...propias,
        ...copiados.map((ruta) => ({
          ruta,
          motivo: "Herramienta copiada al repositorio de juguete.",
        })),
      ],
    });
  } catch {
    return contenido;
  }
}

export type Corrida = SpawnSyncReturns<string>;

/** Corre el CLI de la deuda que vive en `repo` (con `repo` de carpeta de trabajo). */
export function correrCli(repo: string, argumentos: string[] = [], cwd: string = repo): Corrida {
  return spawnSync(process.execPath, [join(repo, "arquitectura/deuda/deuda.cjs"), ...argumentos], {
    cwd,
    env: ENTORNO,
    encoding: "utf8",
  });
}

// --- Texto con pruebas saltadas -----------------------------------------------------------------------------------
// Viven acá y no en los `guardian-deuda-*.test.ts` porque el meta-invariante M4 de la matriz escanea esos archivos
// línea por línea buscando saltos de pruebas, y no distingue un salto de un texto de ejemplo.

/** Trece formas de saltar, dejar pendiente o aislar una prueba: cada línea es un marcador `prueba-saltada`. */
export const SALTADAS = [
  "describe.skip('a', () => {});",
  "it.todo('b');",
  "test.only('c', () => {});",
  "describe.concurrent.only('d', () => {});",
  "xit('e', () => {});",
  "xtest('f', () => {});",
  "xdescribe('g', () => {});",
  "fit('h', () => {});",
  "fdescribe('i', () => {});",
  "ctx.skip();",
  "context.skip ();",
  "task.skip();",
  "suite.skip('j', () => {});",
];

/** Líneas que NO son un marcador: pruebas condicionales, textos, comentarios y nombres parecidos. */
export const NO_SALTADAS = [
  "const describeConBase = describe.skipIf(!hayBase);",
  "it.runIf(hayBase)('a', () => {});",
  "it.each([1])('b', () => {});",
  "it('dice it.skip dentro de un texto', () => {});",
  "// it.skip('en un comentario', () => {});",
  "const skip = 1; skip();",
  "obj.it.skipped();",
  "fitness(1);",
  "xit;",
  "myctx.skip();",
  "describe_skip();",
];

/** Una prueba exclusiva con un comentario en la misma línea. */
export const CON_COMENTARIO_Y_SALTADA = (comentario: string): string =>
  `it.only('x', () => {}); ${comentario}\n`;
/** Una línea de código donde la prueba saltada está dentro de un texto. */
export const TEXTO_CON_UN_SALTO = 'const e = "it.skip(x)";';
/** Una prueba saltada en la línea 1 y un TODO en la 2: el comentario se halla antes que el salto, pero va después. */
export const SALTADA_Y_DESPUES_UN_TODO = "it.skip('a');\n// TODO: x\n";
/** Dos TODO, dos pruebas saltadas y un FIXME, cada uno en su línea (de la 1 a la 5). */
export const TODOS_Y_SALTADAS_ENTREVERADOS =
  "// TODO: x\n// TODO: y\nit.skip('a');\nit.skip('b');\n// FIXME z\n";
/** Un salto suelto, para probar que en un .css o un .yml no cuenta. */
export const JSON_Y_YAML_CON_UN_SALTO = "it.skip(x)\n";
/** Un archivo con saltos de línea CRLF: un TODO en la 2 y una prueba saltada en la 3. */
export const SALTADA_CON_CRLF = "a;\r\n// TODO: x\r\nit.skip('y');\r\n";
