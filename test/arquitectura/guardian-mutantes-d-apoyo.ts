import { copyFileSync, mkdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { RAIZ, carpetaTemporal, escribirEn } from "./guardian-apoyo";

/**
 * Apoyo de las pruebas que matan a los mutantes de `no-debilitar.cjs` (la vigilancia de la versión
 * anterior): sus tipos, instantáneas sintéticas ya armadas y árboles temporales sobre los que se corre el
 * verificador instrumentado (el del sandbox de Stryker), sin tocar nunca el repositorio real ni `.git`.
 */

const require = createRequire(import.meta.url);

export interface Hallazgo {
  codigo: string;
  archivo: string;
  linea: number;
  contrato: string | null;
  motivo: string;
  correccion: string;
  donde?: unknown;
}
export type Seccion = Record<string, unknown>;
export type Instantanea = Record<string, Seccion | undefined>;
export interface Paso {
  desde: number;
  hasta: number;
  ejecutaGuardian: boolean;
  si: { valor: string; linea: number } | undefined;
}
export interface Job {
  id: string;
  linea: number;
  needs: string[];
  lineaNeeds: number | undefined;
  si: string | undefined;
  lineaSi: number | undefined;
  continuaConError: number[];
  pasos: Paso[];
}
export type ResultadoDeCi = { valor: Map<string, Job>; lineaDeJobs: number } | { error: string };

export const nd = require("../../arquitectura/contratos/no-debilitar.cjs") as {
  ARCHIVOS: Record<string, string>;
  CHEQUEOS: readonly unknown[];
  capturar: (raiz: string) => Instantanea;
  chequearRetiros: (b: Instantanea, p: Instantanea, c: { ahora: Date }) => Hallazgo[];
  chequearContratos: (b: Instantanea, p: Instantanea) => Hallazgo[];
  chequearCodigos: (b: Instantanea, p: Instantanea) => Hallazgo[];
  chequearRigor: (b: Instantanea, p: Instantanea) => Hallazgo[];
  chequearClases: (b: Instantanea, p: Instantanea) => Hallazgo[];
  chequearCi: (b: Instantanea, p: Instantanea) => Hallazgo[];
  chequearGate: (b: Instantanea, p: Instantanea) => Hallazgo[];
  chequearPaquete: (b: Instantanea, p: Instantanea) => Hallazgo[];
  chequearInvariantes: (b: Instantanea, p: Instantanea) => Hallazgo[];
  chequearEvasiones: (b: Instantanea, p: Instantanea) => Hallazgo[];
  chequearLectura: (b: Instantanea, p: Instantanea) => Hallazgo[];
  ejecutaElGuardian: (linea: string) => boolean;
  extraerInvariantes: (modulo: unknown) => {
    ids: string[];
    mutaciones: { invariante: string; id: string }[];
  };
  formatear: (h: Partial<Hallazgo>) => string;
  leerCi: (texto: string) => ResultadoDeCi;
  leerConstante: (texto: string | null, nombre: string) => Seccion;
  leerEvasiones: (catalogo: string | null, externos: string | null) => Seccion;
  leerPaquete: (texto: string | null) => Seccion;
  leerRetiros: (texto: string | null) => Seccion;
  limites: readonly string[];
  versionMayor: (nueva: unknown, vieja: unknown) => boolean;
  verificar: (datos: {
    base: Instantanea;
    pr: Instantanea;
    ahora?: Date;
    leerPr: (ruta: string) => string | null;
  }) => { fallas: Hallazgo[]; avisos: Hallazgo[] };
};
export const ubicacion = require("../../arquitectura/contratos/ubicacion.cjs") as {
  enArchivo: () => unknown;
  enTexto: (texto: string) => unknown;
  enJson: (...camino: (string | number)[]) => unknown;
};

export const A = nd.ARCHIVOS as Record<string, string> & {
  registro: string;
  codigos: string;
  clasificacion: string;
  excepciones: string;
  retiros: string;
  invariantes: string;
  evasiones: string;
  evasionesExternas: string;
  evaluarGate: string;
  ci: string;
  paquete: string;
};

/** Junta líneas con salto final (un archivo de texto). */
export const lineas = (...l: string[]): string => `${l.join("\n")}\n`;

/** El `ci.yml` leído: falla la prueba si el texto no se entiende (para no comparar dos errores iguales). */
export function ciLeido(texto: string): { valor: Map<string, Job>; lineaDeJobs: number } {
  const leido = nd.leerCi(texto);
  if (!("valor" in leido)) throw new Error(`el ci.yml de la prueba no se entiende: ${leido.error}`);
  return leido;
}
export function job(texto: string, id: string): Job {
  const encontrado = ciLeido(texto).valor.get(id);
  if (encontrado === undefined) throw new Error(`no hay job ${id}`);
  return encontrado;
}

/** Una instantánea completa y sana (todas las secciones con valor) sobre la que cada prueba cambia lo suyo. */
export function instantanea(cambios: Instantanea = {}): Instantanea {
  return {
    registro: { valor: [] },
    codigos: { valor: [] },
    clases: { valor: { esperadas: [], excluibles: [], permitidas: {} } },
    retiros: { valor: [] },
    plazo: { valor: 60, linea: 4 },
    aviso: { valor: 14, linea: 6 },
    gate: {
      valor: {
        conGuardianCaido: {
          failure: ["guardian: failure"],
          skipped: ["guardian: skipped"],
          cancelled: ["guardian: cancelled"],
        },
      },
    },
    ci: ciLeido(
      lineas(
        "jobs:",
        "  guardian:",
        "    steps:",
        "      - run: node arquitectura/contratos/guardian.cjs",
        "",
        "  gate:",
        "    needs: [guardian]",
      ),
    ),
    paquete: {
      valor: {
        arquitectura: "depcruise src && npm run guardian",
        guardian: "node arquitectura/contratos/guardian.cjs",
      },
    },
    invariantes: { valor: { ids: [], mutaciones: [] } },
    evasiones: { valor: [] },
    ...cambios,
  };
}

/** Un contrato resumido, como lo deja el proceso hijo. */
export const contratoResumido = (
  id: string | null,
  cambios: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  version: "1.0.0",
  fuente: { archivo: "a.css", exportacion: undefined, variable: "--x" },
  detectores: [],
  sinDefinicion: null,
  ...cambios,
});

// --- Árboles en disco -------------------------------------------------------------------------------

const CI_DEL_ARBOL = lineas(
  "name: CI",
  "jobs:",
  "  estatico:",
  "    steps:",
  "      - run: npm run lint",
  "",
  "  guardian:",
  "    steps:",
  "      - run: node arquitectura/contratos/guardian.cjs",
  "",
  "  gate:",
  "    needs: [estatico, guardian]",
  "    steps:",
  "      - run: node arquitectura/evaluar-gate.cjs",
);
const GATE_DEL_ARBOL = lineas(
  "exports.evaluarGate = (needs) =>",
  '  needs.guardian.result !== "success" ? [`guardian: ${needs.guardian.result}`] : [];',
);

/** Los archivos de un árbol (base o PR) que se lee sin problema; cada prueba pisa o borra los suyos. */
export const ARBOL_SANO: Record<string, string> = {
  "arquitectura/contratos/contratos.cjs": "module.exports = [];\n",
  "arquitectura/contratos/codigos.cjs": 'exports.CODIGOS_DE_FALLA = ["uno", "dos"];\n',
  "arquitectura/contratos/clasificacion.cjs": lineas(
    'exports.CLASES_ESPERADAS = ["frontend"];',
    'exports.CLASES_EXCLUIBLES = ["docs"];',
    'exports.PERMITIDO_EN_CLASE_EXCLUIDA = { docs: { extensiones: [".md"] } };',
  ),
  "arquitectura/contratos/excepciones.cjs": lineas(
    "/** Excepciones. */",
    "const PLAZO_MAXIMO_DIAS = 60;",
    "const DIAS_DE_AVISO = 14;",
  ),
  "arquitectura/evaluar-gate.cjs": GATE_DEL_ARBOL,
  ".github/workflows/ci.yml": CI_DEL_ARBOL,
  "package.json": `${JSON.stringify({
    scripts: {
      arquitectura: "depcruise src && npm run guardian",
      guardian: "node arquitectura/contratos/guardian.cjs",
    },
  })}\n`,
  "arquitectura/contratos/invariantes.cjs": 'module.exports = [{ id: "I1", mutaciones: [] }];\n',
  "arquitectura/contratos/evasiones.json": "[]\n",
};

/** Un árbol temporal con `ARBOL_SANO` pisado por `archivos` (`null` borra el archivo). */
export function arbol(archivos: Record<string, string | null> = {}, prefijo = "mutd-"): string {
  const raiz = realpathSync(carpetaTemporal(prefijo));
  for (const [ruta, texto] of Object.entries({ ...ARBOL_SANO, ...archivos })) {
    if (texto !== null) escribirEn(raiz, ruta, texto);
  }
  return raiz;
}

const VERIFICADOR = "arquitectura/contratos/no-debilitar.cjs";
const UBICACION = "arquitectura/contratos/ubicacion.cjs";

/**
 * Un árbol que sirve de BASE: el verificador instrumentado (el del sandbox, copiado tal cual junto con su
 * `ubicacion.cjs`) y los archivos sanos. Se corre desde ahí, que es como lo corre la CI.
 */
export function baseConVerificador(archivos: Record<string, string | null> = {}): string {
  const raiz = arbol(archivos, "mutd-base-");
  mkdirSync(join(raiz, dirname(VERIFICADOR)), { recursive: true });
  for (const ruta of [VERIFICADOR, UBICACION]) copyFileSync(join(RAIZ, ruta), join(raiz, ruta));
  return raiz;
}
export const verificadorDe = (base: string): string => join(base, VERIFICADOR);
