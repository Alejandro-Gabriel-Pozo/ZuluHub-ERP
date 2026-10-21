import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";

/**
 * Apoyo de las pruebas del guardián de contratos: tipos de lo que devuelve, un repositorio sintético
 * en memoria que pasa limpio y fábricas de contratos y excepciones para romperlo de a una cosa.
 */

export type Falla = {
  codigo: string;
  archivo: string;
  linea?: number;
  contrato: string | null;
  motivo: string;
  correccion: string;
  huella?: string;
};
export type Informe = {
  version: number;
  generadoEn: string;
  resultado: "pasa" | "falla";
  analisisCompleto: boolean;
  totales: Record<string, number>;
  reglasEjecutadas: {
    chequeos: { codigo: string; descripcion: string; reglaDeLinea: string }[];
    clasificacion: { nivel: number; clase: string; glob: string; rutas: number }[];
    detectores: { contrato: string; detector: string; tipo: string; clases: string[] }[];
  };
  clases: Record<
    string,
    {
      rutas: number;
      esperada: boolean;
      excluidas: number;
      exclusionPorClase: string | null;
      analizadasPorDetectores: number;
      binariasOmitidas: number;
      sinUnidad: number;
      listaDeRutas: string[];
    }
  >;
  exclusiones: {
    porClase: { id: string; clase: string }[];
    porRuta: { id: string; ruta: string }[];
  };
  unidades: { unidad: string; archivos: number; declaracion: unknown }[];
  excepcionesAplicadas: { id: string }[];
  contratosSinDetectorDeDefinicion: { contrato: string; motivo: string }[];
  usosFueraDeUnidades: { archivo: string; linea: number }[];
  fallas: Falla[];
  avisos: Falla[];
};
export type Resultado = { fallas: Falla[]; avisos: Falla[]; informe: Informe };
export type Detector = {
  tipo: string;
  clases: string[];
  nombre?: string;
  reconoce: (contenido: string, ruta: string) => unknown;
};
export type Contrato = Record<string, unknown>;
export type Entradas = {
  rutas: string[];
  leer: (ruta: string) => Buffer | string | null;
  contratos: unknown;
  excepciones: unknown;
  exclusiones: unknown;
  ahora?: Date;
  niveles?: { nombre: string; reglas: { clase: string; glob: string }[] }[];
  clasesEsperadas?: string[];
  previas?: { fallas?: unknown[]; avisos?: unknown[] };
};

const require = createRequire(import.meta.url);
export const RAIZ = join(import.meta.dirname, "../..");
/**
 * `false` en el sandbox de Stryker (copia del repositorio sin `.git`): ahí `git ls-files` no lista
 * nada y las pruebas que miran «el repositorio real» no tienen qué analizar. En un worktree `.git`
 * es un archivo; `existsSync` sirve igual. La prueba «el salto no esconde un guardián que dejó de
 * analizar» (guardian-nucleo.test.ts) impide que esto se use para saltear fuera de ese sandbox.
 */
export const HAY_GIT = existsSync(join(RAIZ, ".git"));
/**
 * La raíz del proyecto REAL. Dentro del sandbox de Stryker (`<proyecto>/.stryker-tmp/sandbox-*`) los
 * `.cjs` del guardián están instrumentados: su texto ya no es el del repositorio, y las pruebas que lo
 * leen para anclar una alteración o para contar lo que escribe (`codigo: "…"`, `if (!decidida) {`) lo
 * necesitan tal cual. Stryker no toca el proyecto de afuera, así que ahí está el original. Fuera del
 * sandbox es la misma `RAIZ`. Se usa SOLO para leer texto de anclaje, nunca para cargar el código que se
 * prueba: ese tiene que ser el instrumentado, que es el que muta.
 */
export const RAIZ_ORIGINAL = ((): string => {
  const partes = RAIZ.split(sep);
  const sandbox = partes.indexOf(".stryker-tmp");
  return sandbox < 0 ? RAIZ : partes.slice(0, sandbox).join(sep);
})();
export const { ejecutar, cargarDelRepo, formatearFalla } =
  require("../../arquitectura/contratos/guardian.cjs") as {
    ejecutar: (entradas: Entradas) => Resultado;
    cargarDelRepo: (raiz: string) => Required<
      Pick<Entradas, "rutas" | "leer" | "contratos" | "excepciones" | "exclusiones">
    > & {
      previas: { fallas: unknown[]; avisos: unknown[] };
    };
    formatearFalla: (falla: Falla) => string;
  };
export const { CODIGOS_DE_FALLA, CODIGOS_DE_AVISO, DESCRIPCION_DE_CODIGOS } =
  require("../../arquitectura/contratos/codigos.cjs") as {
    CODIGOS_DE_FALLA: readonly string[];
    CODIGOS_DE_AVISO: readonly string[];
    DESCRIPCION_DE_CODIGOS: Record<string, string>;
  };
export const { REGLAS_DE_LINEA } = require("../../arquitectura/contratos/ubicacion.cjs") as {
  REGLAS_DE_LINEA: Record<string, string>;
};
export const { porPatron } = require("../../arquitectura/contratos/detectores.cjs") as {
  porPatron: (datos: {
    tipo: string;
    clases: string[];
    patron: RegExp;
    nombre?: string;
  }) => Detector;
};

/** «Hoy» de las pruebas: fijo, para que ninguna dependa del reloj real. */
export const AHORA = new Date("2026-10-21T12:00:00Z");

/** Huella de una línea (sin espacios en los extremos), calculada acá de forma independiente. */
export const huellaDe = (texto: string): string =>
  createHash("sha256").update(texto.trim()).digest("hex");

/** Huella de un archivo entero, tal cual está. */
export const huellaDelArchivo = (texto: string): string =>
  createHash("sha256").update(texto).digest("hex");

export const SIN_CONTRATOS = JSON.stringify({ usa: [], noUsa: "Sin contratos todavía." });
export const LINEA_DE_USO = ".linea { border-color: var(--color-separador); }";
export const TOKENS = ":root {\n  --color-separador: #cccccc;\n  --radio: 4px;\n}\n";

/** Un repositorio mínimo que cubre todas las clases esperadas y pasa limpio con el registro vacío. */
export const BASE: Record<string, string> = {
  "package.json": "{}",
  "package-lock.json": "{}",
  "README.md": "# Repo",
  "arquitectura/reglas.cjs": "module.exports = [];",
  "test/una.test.ts": "export {};",
  "scripts/migrar.ts": "export {};",
  "scripts/contratos.json": SIN_CONTRATOS,
  "migraciones/0001_base.sql": "select 1;",
  "migraciones/contratos.json": SIN_CONTRATOS,
  "src/modulos/empresas/dominio/empresa.ts": "export const empresa = 1;",
  "src/modulos/empresas/contratos.json": SIN_CONTRATOS,
  "src/capacidades/permisos/permisos.ts": "export const permiso = 1;",
  "src/capacidades/contratos.json": SIN_CONTRATOS,
  "apps/web/ui/tokens.css": TOKENS,
  "apps/web/ui/Caja.module.css": ".caja { border-color: red; }\n",
  "apps/web/contratos.json": SIN_CONTRATOS,
};

export const EXCLUSIONES_BASE = [
  {
    id: "excl-generado",
    alcance: "clase",
    clase: "generado",
    motivo: "Archivos de bloqueo escritos por una herramienta.",
    responsable: "Ingeniería",
    aprobadoPor: "Dueño",
    creada: "2026-10-21",
    vence: "2026-12-20",
  },
  {
    id: "excl-docs",
    alcance: "clase",
    clase: "docs",
    motivo: "Documentación para leer.",
    responsable: "Ingeniería",
    aprobadoPor: "Dueño",
    creada: "2026-10-21",
    vence: "2026-12-20",
  },
];

/** Contrato sintético: el color de los separadores, con fuente en `tokens.css`. */
export function contrato(cambios: Contrato = {}): Contrato {
  return {
    id: "color-separador",
    protege: "Que todos los separadores tengan el mismo color.",
    alcance: "Hojas de estilo y componentes de la web.",
    fuenteDeVerdad: { archivo: "apps/web/ui/tokens.css", variable: "--color-separador" },
    incumplimiento: "Un color de separador escrito a mano o definido fuera de tokens.css.",
    deteccion: [
      porPatron({
        tipo: "uso",
        clases: ["frontend", "backend"],
        patron: /var\(--color-separador\)/,
        nombre: "uso de la variable",
      }),
      porPatron({
        tipo: "definicion",
        clases: ["frontend"],
        patron: /^\s*--color-separador\s*:/,
        nombre: "definición de la variable",
      }),
    ],
    limites: "No ve colores calculados en JavaScript; los cubre la prueba de navegador.",
    version: "1.0.0",
    politicaDeCambio:
      "Compatible: se agrega. Incompatible: fuente, consumidores y pruebas en el mismo PR.",
    bloqueaDeclaracionFalsa: true,
    ...cambios,
  };
}

/**
 * Un detector de `definicion` que no reconoce nada real: para los registros de prueba que solo quieren
 * detectores de uso (el registro exige uno de definición: ver `registro.cjs`). Mira `config`, una clase
 * con archivos en todos los repositorios de prueba, para no sumar fallas de «detector sin rutas».
 */
export const definicionInerte = (): Detector =>
  porPatron({
    tipo: "definicion",
    clases: ["config"],
    patron: /^--definicion-que-no-existe:/,
    nombre: "definición inerte",
  });

/** Un segundo contrato, para probar «usa uno y no el otro». */
export function contratoDeRadio(cambios: Contrato = {}): Contrato {
  return contrato({
    id: "radio-unico",
    fuenteDeVerdad: { archivo: "apps/web/ui/tokens.css", variable: "--radio" },
    deteccion: [
      porPatron({
        tipo: "uso",
        clases: ["frontend"],
        patron: /var\(--radio\)/,
        nombre: "uso del radio",
      }),
      porPatron({
        tipo: "definicion",
        clases: ["frontend"],
        patron: /^\s*--radio\s*:/,
        nombre: "definición del radio",
      }),
    ],
    ...cambios,
  });
}

export function declaracion(usa: string[], noUsa?: string): string {
  return JSON.stringify(noUsa === undefined ? { usa } : { usa, noUsa });
}

export type Opciones = Partial<Omit<Entradas, "rutas" | "leer">> & {
  /** Archivos a sumar (o pisar) sobre `BASE`. `null` borra el archivo. */
  archivos?: Record<string, string | null>;
  /** Se llama con la ruta de cada archivo que el guardián lee. */
  alLeer?: (ruta: string) => void;
};

/** Corre el guardián sobre `BASE` con los cambios indicados. */
export function correr(opciones: Opciones = {}): Resultado & { archivos: Record<string, string> } {
  const archivos: Record<string, string> = { ...BASE };
  for (const [ruta, contenido] of Object.entries(opciones.archivos ?? {})) {
    if (contenido === null) delete archivos[ruta];
    else archivos[ruta] = contenido;
  }
  const { archivos: _archivos, alLeer, ...resto } = opciones;
  void _archivos;
  const resultado = ejecutar({
    rutas: Object.keys(archivos),
    leer: (ruta) => {
      alLeer?.(ruta);
      return archivos[ruta] ?? null;
    },
    contratos: [],
    excepciones: [],
    exclusiones: EXCLUSIONES_BASE,
    ahora: AHORA,
    ...resto,
  });
  return { ...resultado, archivos };
}

export const codigos = (resultado: Resultado): string[] => resultado.fallas.map((f) => f.codigo);

// --- Árboles temporales y repositorios en disco ----------------------------------------------------------

const temporales: string[] = [];

/** Una carpeta temporal nueva; `limpiarTemporales` (o `borrarTemporal`) la borra. */
export function carpetaTemporal(prefijo: string): string {
  const carpeta = mkdtempSync(join(tmpdir(), prefijo));
  temporales.push(carpeta);
  return carpeta;
}
export function borrarTemporal(carpeta: string): void {
  rmSync(carpeta, { recursive: true, force: true });
  const posicion = temporales.indexOf(carpeta);
  if (posicion !== -1) temporales.splice(posicion, 1);
}
export function limpiarTemporales(): void {
  for (const carpeta of temporales.splice(0)) rmSync(carpeta, { recursive: true, force: true });
}

export const leerEn = (raiz: string, archivo: string): string =>
  readFileSync(join(raiz, archivo), "utf8");
export function escribirEn(raiz: string, archivo: string, texto: string): void {
  mkdirSync(dirname(join(raiz, archivo)), { recursive: true });
  writeFileSync(join(raiz, archivo), texto);
}
/** Cambia el texto de un archivo del árbol; lo que se reemplaza tiene que aparecer exactamente una vez. */
export function alterar(raiz: string, archivo: string, de: string | RegExp, a: string): void {
  const texto = leerEn(raiz, archivo);
  const veces =
    typeof de === "string"
      ? texto.split(de).length - 1
      : (texto.match(new RegExp(de.source, `${de.flags}g`)) ?? []).length;
  if (veces !== 1) {
    throw new Error(`«${String(de)}» debe aparecer una vez en ${archivo} y aparece ${veces}`);
  }
  escribirEn(
    raiz,
    archivo,
    texto.replace(de, () => a),
  );
}
/** Número de línea (desde 1) de la primera línea que cumple, calculado acá y no por el verificador. */
export function lineaEn(
  raiz: string,
  archivo: string,
  cumple: (linea: string) => boolean,
  desde = 0,
): number {
  const indice = leerEn(raiz, archivo)
    .split("\n")
    .findIndex((linea, i) => i >= desde && cumple(linea));
  if (indice < 0) throw new Error(`no hay una línea que cumpla en ${archivo}`);
  return indice + 1;
}

/**
 * Una copia de lo que lee la vigilancia de la versión anterior (`no-debilitar.cjs`): `arquitectura/`, el
 * workflow de CI y `package.json` del repositorio real. Es la base y el pull request de las pruebas.
 * Son árboles que se ANALIZAN como texto (no se ejecutan): salen del original, sin instrumentar.
 */
export function arbolDesdeElRepo(): string {
  const destino = carpetaTemporal("arbol-");
  cpSync(join(RAIZ_ORIGINAL, "arquitectura"), join(destino, "arquitectura"), {
    recursive: true,
    filter: (origen) => !origen.endsWith("informe.json"),
  });
  mkdirSync(join(destino, ".github/workflows"), { recursive: true });
  cpSync(
    join(RAIZ_ORIGINAL, ".github/workflows/ci.yml"),
    join(destino, ".github/workflows/ci.yml"),
  );
  cpSync(join(RAIZ_ORIGINAL, "package.json"), join(destino, "package.json"));
  return destino;
}

const CATALOGO = "arquitectura/contratos/invariantes.cjs";
/** Borra del `invariantes.cjs` de un árbol la mutación con ese id (el bloque entero, a 6 espacios de sangría). */
export function quitarMutacionDelCatalogo(raiz: string, id: string): void {
  alterar(raiz, CATALOGO, new RegExp(`\\n {6}\\{\\n {8}id: "${id}",[\\s\\S]*?\\n {6}\\},`), "");
}
/** Borra del `invariantes.cjs` de un árbol el invariante con ese id (el bloque entero, a 2 espacios de sangría). */
export function quitarInvarianteDelCatalogo(raiz: string, id: string): void {
  alterar(raiz, CATALOGO, new RegExp(`\\n {2}\\{\\n {4}id: "${id}",[\\s\\S]*?\\n {2}\\},`), "");
}

/** Un registro con un contrato real (con detectores de verdad): la base de los casos de punta a punta. */
export const REGISTRO_DE_EJEMPLO = [
  'const { porPatron } = require("./detectores.cjs");',
  "",
  "module.exports = [",
  "  {",
  '    id: "color-de-separadores",',
  '    protege: "Que los separadores tengan un solo color.",',
  '    alcance: "frontend",',
  '    fuenteDeVerdad: { archivo: "apps/web/ui/tokens.css", variable: "--color-separador" },',
  '    incumplimiento: "Un color de separador fuera de la fuente.",',
  "    deteccion: [",
  '      porPatron({ tipo: "uso", clases: ["frontend", "backend"], patron: /var\\(--color-separador\\)/ }),',
  '      porPatron({ tipo: "uso", clases: ["frontend"], patron: /separador/ }),',
  '      porPatron({ tipo: "definicion", clases: ["frontend"], patron: /--color-separador:/ }),',
  "    ],",
  '    limites: "No ve usos dinámicos.",',
  '    version: "1.0.0",',
  '    politicaDeCambio: "Compatible: se agrega.",',
  "    bloqueaDeclaracionFalsa: true,",
  "  },",
  "];",
  "",
].join("\n");

/** Un retiro completo de `retiros.json` (con campos de más o de menos para romperlo). */
export const retiroCompleto = (
  id: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  motivo: "El contrato se reemplazó por otro.",
  responsable: "Equipo de plataforma",
  aprobadoPor: "Dueño",
  creada: "2026-10-01",
  ...extra,
});

/**
 * Un repositorio git REAL en disco que pasa el guardián: el código del guardián (el real, copiado), los
 * archivos de `BASE` y un `exclusiones.json` con fechas relativas a hoy (así no vence nunca). Sirve para
 * correr el CLI sin depender de que este árbol tenga `.git` (el sandbox de Stryker no lo tiene).
 */
export function repoSanoEnDisco(): string {
  const carpeta = carpetaTemporal("repo-sano-");
  const origen = join(RAIZ, "arquitectura/contratos");
  for (const nombre of readdirSync(origen)) {
    if (/\.cjs$/.test(nombre) || nombre === "excepciones.json" || nombre === "retiros.json") {
      escribirEn(
        carpeta,
        `arquitectura/contratos/${nombre}`,
        readFileSync(join(origen, nombre), "utf8"),
      );
    }
  }
  for (const [ruta, texto] of Object.entries(BASE)) escribirEn(carpeta, ruta, texto);
  const hoy = new Date();
  const dia = (desplazamiento: number): string =>
    new Date(hoy.getTime() + desplazamiento * 86_400_000).toISOString().slice(0, 10);
  escribirEn(
    carpeta,
    "arquitectura/contratos/exclusiones.json",
    `${JSON.stringify(
      EXCLUSIONES_BASE.map((e) => ({ ...e, creada: dia(0), vence: dia(30) })),
      null,
      2,
    )}\n`,
  );
  const entorno = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const inicio = spawnSync("git", ["init", "-q"], { cwd: carpeta, env: entorno, encoding: "utf8" });
  if (inicio.status !== 0) throw new Error(`git init falló: ${inicio.stderr}`);
  return carpeta;
}
