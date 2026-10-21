import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";

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
    chequeos: { codigo: string; descripcion: string }[];
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
