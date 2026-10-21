import { createRequire } from "node:module";

/**
 * Apoyo de las pruebas que fijan el comportamiento exacto de los módulos puros del guardián
 * (globs, detectores, clasificación, declaraciones, comparación y excepciones): carga cada `.cjs`
 * con su tipo y arma las entradas sintéticas. Se carga el código del repositorio (dentro del
 * sandbox de Stryker, el instrumentado), nunca una copia.
 */

const require = createRequire(import.meta.url);

/** Dónde calcula `ubicacion.cjs` la línea de una falla (el descriptor `donde`). */
export type Donde =
  | { tipo: "archivo" }
  | { tipo: "json"; camino: (string | number)[] }
  | { tipo: "texto"; texto: string };

export type FallaCruda = {
  codigo: string;
  archivo: string;
  contrato: string | null;
  motivo: string;
  correccion: string;
  donde: Donde;
};

type Regla = { clase: string; glob: string };
export type Nivel = { nombre: string; reglas: Regla[] };
export type ReglaDescrita = {
  nivel: number;
  nombreDelNivel: string;
  clase: string;
  glob: string;
  rutas: number;
};

export const { compilar, esRutaExacta } = require("../../arquitectura/contratos/globs.cjs") as {
  compilar: (glob: unknown) => RegExp;
  esRutaExacta: (ruta: string) => boolean;
};

export const { porPatron } = require("../../arquitectura/contratos/detectores.cjs") as {
  porPatron: (datos: { tipo: string; clases: string[]; patron: unknown; nombre?: string }) => {
    nombre: string;
    tipo: string;
    clases: string[];
    reconoce: (contenido: string) => { linea: number; texto: string }[];
  };
};

export const { NIVELES, ARCHIVO_DE_REGLAS, clasificar, revisarClasesExcluidas } =
  require("../../arquitectura/contratos/clasificacion.cjs") as {
    NIVELES: Nivel[];
    ARCHIVO_DE_REGLAS: string;
    clasificar: (
      rutas: string[],
      opciones?: { niveles?: Nivel[] },
    ) => {
      porRuta: Map<string, string>;
      porClase: Record<string, string[]>;
      reglas: ReglaDescrita[];
      fallas: FallaCruda[];
    };
    revisarClasesExcluidas: (
      porClase: Record<string, string[]>,
      opciones?: {
        excluibles?: readonly string[];
        permitidoPorClase?: Record<string, { extensiones: string[]; rutas: string[] }>;
      },
    ) => FallaCruda[];
  };

export const { unidadDe, descubrirUnidades, leerDeclaraciones } =
  require("../../arquitectura/contratos/declaraciones.cjs") as {
    unidadDe: (ruta: string) => string | null;
    descubrirUnidades: (rutas: string[]) => Map<string, string[]>;
    leerDeclaraciones: (
      unidades: Map<string, string[]>,
      contexto: {
        rutas: Set<string>;
        leer: (ruta: string) => Buffer | string | null;
        idsDeContratos: Set<string> | null;
      },
    ) => {
      declaraciones: Map<string, { usa: string[]; noUsa: string | null }>;
      fallas: FallaCruda[];
    };
  };

type Hallazgo = {
  contrato: string;
  archivo: string;
  linea: number;
  huella: string;
  texto: string;
  unidad: string | null;
  codigo?: string;
  motivo?: string;
  correccion?: string;
};
export type DetectorDePrueba = {
  tipo: string;
  clases: string[];
  nombre?: string;
  reconoce: (texto: string, ruta: string) => unknown;
};
export type ContratoDePrueba = {
  id: string;
  fuenteDeVerdad: { archivo: string; exportacion?: string; variable?: string };
  deteccion: DetectorDePrueba[];
  bloqueaDeclaracionFalsa?: boolean;
};
export type SalidaDeComparar = {
  hallazgos: Hallazgo[];
  fallas: FallaCruda[];
  avisos: FallaCruda[];
  reglas: { contrato: string; detector: string; tipo: string; clases: string[] }[];
  escaneadasPorClase: Record<string, number>;
  omitidasPorClase: Record<string, number>;
  usosFueraDeUnidades: Hallazgo[];
};
export const { comparar } = require("../../arquitectura/contratos/comparacion.cjs") as {
  comparar: (datos: {
    registro: { contratos: ContratoDePrueba[]; porId: Map<string, ContratoDePrueba> };
    porRuta: Map<string, string>;
    rutas: Set<string>;
    leer: (ruta: string) => Buffer | string | null;
    declaraciones: Map<string, { usa: string[]; noUsa: string | null }>;
    clasesExcluidas: Set<string>;
    rutasExcluidas: Set<string>;
  }) => SalidaDeComparar;
};

export type Hallazgo4 = {
  codigo: string;
  contrato: string;
  archivo: string;
  linea?: number;
  huella?: string;
};
export type Aplicada = {
  id: string;
  contrato: string;
  ruta: string;
  linea: number | undefined;
  huella: string;
  creada: string;
  vence: string;
  motivo: string;
  responsable: string;
  aprobadoPor: string;
};
export const {
  ARCHIVO_DE_EXCEPCIONES,
  ARCHIVO_DE_EXCLUSIONES,
  aplicarExcepciones,
  procesarExclusiones,
  huellaDeLinea,
} = require("../../arquitectura/contratos/excepciones.cjs") as {
  ARCHIVO_DE_EXCEPCIONES: string;
  ARCHIVO_DE_EXCLUSIONES: string;
  aplicarExcepciones: (
    lista: unknown,
    contexto: {
      rutas: Set<string>;
      idsDeContratos: Set<string>;
      ahora: unknown;
      hallazgos: Hallazgo4[];
    },
  ) => {
    fallas: FallaCruda[];
    avisos: FallaCruda[];
    aplicadas: Aplicada[];
    restantes: Hallazgo4[];
  };
  procesarExclusiones: (
    lista: unknown,
    contexto: {
      rutas: Set<string>;
      porRuta: Map<string, string>;
      porClase: Record<string, string[]>;
      leer: (ruta: string) => Buffer | string | null;
      ahora: unknown;
    },
  ) => {
    fallas: FallaCruda[];
    avisos: FallaCruda[];
    clases: Map<string, Record<string, unknown>>;
    archivos: Map<string, Record<string, unknown>>;
  };
  huellaDeLinea: (texto: string) => string;
};

/** Una ubicación en un JSON: `json(0, "id")` es la clave `id` de la entrada 0. */
export const json = (...camino: (string | number)[]): Donde => ({ tipo: "json", camino });
