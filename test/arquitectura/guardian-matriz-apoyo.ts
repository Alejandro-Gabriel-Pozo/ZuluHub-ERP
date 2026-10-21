import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  AHORA,
  CODIGOS_DE_FALLA,
  EXCLUSIONES_BASE,
  LINEA_DE_USO,
  RAIZ,
  SIN_CONTRATOS,
  TOKENS,
  contrato,
  contratoDeRadio,
  ejecutar,
  huellaDe,
  huellaDelArchivo,
  type Contrato,
  type Detector,
  type Entradas,
  type Informe,
} from "./guardian-apoyo";

/**
 * Apoyo de la matriz de invariantes (`guardian-matriz.test.ts`): el repositorio sintético SANO, los
 * aplicadores de cada mutación del catálogo (`arquitectura/contratos/invariantes.cjs`) y el canario.
 *
 * Un aplicador es una función sin argumentos que arma el mundo (sano o con un texto real alterado en
 * memoria), le aplica UNA mutación, corre el guardián (o el verificador que corresponda) y devuelve
 * lo que dijo: una lista de `Salida` con archivo, línea, contrato, motivo y corrección. Nada toca el
 * repositorio real: se lee `package.json`, `ci.yml`, `vitest.config.ts` y las pruebas del guardián
 * y se altera la COPIA en memoria. El reloj es el de `AHORA`.
 */

const require = createRequire(import.meta.url);

// --- Tipos del catálogo ---------------------------------------------------------------------------

export type LineaDe = string | { texto: string; despuesDe?: string };
export type Esperado = {
  codigo?: string;
  pasa?: boolean;
  archivo?: string;
  linea?: number;
  lineaDe?: LineaDe;
  contrato?: string;
  contieneMotivo?: string;
};
export type Mutacion = {
  id: string;
  tipo: string;
  objetivo?: string;
  descripcion?: string;
  esperado?: Esperado;
  noAplica?: string;
  pendiente?: string;
};
export type Invariante = {
  id: string;
  enunciado: string;
  elementos: Record<string, string[]>;
  codigosDeFalla: string[];
  mutaciones: Mutacion[];
};
export type Problema = {
  codigo: string;
  archivo: string;
  linea: number;
  motivo: string;
  correccion: string;
};

const {
  INVARIANTES,
  TIPOS_DE_MUTACION,
  OBJETIVOS,
  IDS_DE_INVARIANTES,
  ARCHIVO_DE_LA_MATRIZ,
  comprobarMatriz,
  huecosAbiertos,
} = require("../../arquitectura/contratos/invariantes.cjs") as {
  INVARIANTES: Invariante[];
  TIPOS_DE_MUTACION: string[];
  OBJETIVOS: string[];
  IDS_DE_INVARIANTES: string[];
  ARCHIVO_DE_LA_MATRIZ: string;
  comprobarMatriz: (datos: {
    invariantes: readonly object[];
    codigosDeFalla: readonly string[];
    idsConAplicador: Iterable<string>;
    texto?: string;
  }) => Problema[];
  huecosAbiertos: (
    invariantes?: readonly Invariante[],
  ) => { invariante: string; mutacion: string; motivo: string }[];
};
export {
  INVARIANTES,
  TIPOS_DE_MUTACION,
  OBJETIVOS,
  IDS_DE_INVARIANTES,
  comprobarMatriz,
  huecosAbiertos,
};
export const {
  CODIGOS_DE_MECANISMO,
  PRUEBAS_DEL_GUARDIAN,
  SALTOS_PERMITIDOS,
  verificarScriptsDeArquitectura,
  verificarWorkflowDeCi,
  verificarVitestConfig,
  escanearPruebasDelGuardian,
  verificarInformeDeEvidencia,
  evaluarCanario,
} = require("../../arquitectura/contratos/verificar-mecanismo.cjs") as {
  CODIGOS_DE_MECANISMO: string[];
  PRUEBAS_DEL_GUARDIAN: string[];
  SALTOS_PERMITIDOS: { archivo: string; linea: string; requiere: string | null }[];
  verificarScriptsDeArquitectura: (texto: string) => Problema[];
  verificarWorkflowDeCi: (texto: string) => Problema[];
  verificarVitestConfig: (texto: string) => Problema[];
  escanearPruebasDelGuardian: (archivos: Record<string, string>) => Problema[];
  verificarInformeDeEvidencia: (informe: Informe) => Problema[];
  evaluarCanario: (
    corrida: { estado: number | null; salidaDeError: string },
    esperadas: { archivo: string; linea: number }[],
    archivoDelGuardian: string,
  ) => Problema[];
};

type Regla = { clase: string; glob: string };
type Nivel = { nombre: string; reglas: Regla[] };
const { NIVELES, CLASES } = require("../../arquitectura/contratos/clasificacion.cjs") as {
  NIVELES: Nivel[];
  CLASES: string[];
};

// --- Lo que devuelve un aplicador --------------------------------------------------------------------

/** Lo que dijo la verificación: una falla del guardián o un problema de un verificador. */
export type Salida = {
  codigo: string;
  archivo: string;
  linea?: number | undefined;
  contrato?: string | null | undefined;
  motivo: string;
  correccion: string;
};
/** El resultado de aplicar una mutación: lo que se dijo y los textos (alterados) en que buscar líneas. */
export type Corrida = { salidas: Salida[]; textos: Record<string, string> };

// --- Lectura de lo real (solo lectura) ---------------------------------------------------------------

export const leerReal = (ruta: string): string => readFileSync(join(RAIZ, ruta), "utf8");

/** Reemplaza la primera aparición; si el texto real ya no la tiene, falla fuerte (la mutación caducó). */
function reemplazar(texto: string, de: string, a: string): string {
  if (!texto.includes(de)) {
    throw new Error(`la mutación no se pudo aplicar: el texto real ya no contiene «${de}»`);
  }
  return texto.replace(de, () => a);
}

/** Las pruebas reales `guardian-*.test.ts`: nombre de archivo (sin carpeta) → texto. */
export function leerPruebasDelGuardian(): Record<string, string> {
  const carpeta = join(RAIZ, "test/arquitectura");
  return Object.fromEntries(
    readdirSync(carpeta)
      .filter((nombre) => /^guardian-.*\.test\.ts$/.test(nombre))
      .sort()
      .map((nombre) => [nombre, readFileSync(join(carpeta, nombre), "utf8")]),
  );
}

// --- Resolución de líneas del catálogo -----------------------------------------------------------------

/** La línea (desde 1) del primer renglón con `texto` (después de `despuesDe`); `null` si no está. */
export function resolverLinea(texto: string | undefined, lineaDe: LineaDe): number | null {
  if (texto === undefined) return null;
  const lineas = texto.split(/\r\n|\n/);
  const { texto: buscado, despuesDe } =
    typeof lineaDe === "string" ? { texto: lineaDe, despuesDe: undefined } : lineaDe;
  let desde = 0;
  if (despuesDe !== undefined) {
    const marca = lineas.findIndex((linea) => linea.includes(despuesDe));
    if (marca === -1) return null;
    desde = marca + 1;
  }
  for (let i = desde; i < lineas.length; i += 1) {
    if ((lineas[i] ?? "").includes(buscado)) return i + 1;
  }
  return null;
}

/** Si la salida cumple lo esperado, y si no, por qué. */
export function cumpleLoEsperado(
  esperado: Esperado,
  salida: Salida,
  textos: Record<string, string>,
): boolean {
  if (salida.codigo !== esperado.codigo) return false;
  if (esperado.archivo !== undefined && salida.archivo !== esperado.archivo) return false;
  if (esperado.contrato !== undefined && salida.contrato !== esperado.contrato) return false;
  if (esperado.contieneMotivo !== undefined && !salida.motivo.includes(esperado.contieneMotivo)) {
    return false;
  }
  if (esperado.linea !== undefined && salida.linea !== esperado.linea) return false;
  if (esperado.lineaDe !== undefined) {
    const linea = resolverLinea(textos[esperado.archivo ?? salida.archivo], esperado.lineaDe);
    if (linea === null || salida.linea !== linea) return false;
  }
  return true;
}

export type Veredicto = { cumple: boolean; detalle: string };

/** Compara lo que dijo la verificación con `esperado`. `cumple` = la mutación fue DETECTADA (o, en `pasa`, no falló). */
export function veredicto(esperado: Esperado, corrida: Corrida): Veredicto {
  const dicho =
    corrida.salidas.map((s) => `${s.codigo} @ ${s.archivo}:${String(s.linea)}`).join("; ") ||
    "(nada: no falló)";
  if (esperado.pasa === true) {
    return {
      cumple: corrida.salidas.length === 0,
      detalle: `se esperaba que NO fallara; dijo: ${dicho}`,
    };
  }
  const cumple = corrida.salidas.some((s) => cumpleLoEsperado(esperado, s, corrida.textos));
  return {
    cumple,
    detalle: `se esperaba ${JSON.stringify(esperado)}; el guardián dijo: ${dicho}`,
  };
}

/** M3 sobre una salida: archivo, línea entera ≥ 1, motivo y corrección (y contrato definido si es del guardián). */
export function defectosDeUbicacion(salida: Salida, delGuardian: boolean): string[] {
  const defectos: string[] = [];
  if (typeof salida.archivo !== "string" || salida.archivo.trim() === "")
    defectos.push("sin archivo");
  if (!Number.isInteger(salida.linea) || (salida.linea ?? 0) < 1) {
    defectos.push(`línea inválida (${String(salida.linea)})`);
  }
  if (typeof salida.motivo !== "string" || salida.motivo.trim() === "") defectos.push("sin motivo");
  if (typeof salida.correccion !== "string" || salida.correccion.trim() === "") {
    defectos.push("sin corrección");
  }
  if (delGuardian && salida.contrato === undefined) defectos.push("sin campo contrato");
  return defectos;
}

// --- El repositorio sintético --------------------------------------------------------------------------

export const CONTRATO_A = "color-separador";
const CONTRATO_B = "radio-unico";
const USO_EN_TS = 'export const clase = "var(--color-separador)";';

/** JSON de dos espacios con salto final: cada clave en su línea, para que las líneas esperadas sean fijas. */
const json = (valor: unknown): string => `${JSON.stringify(valor, null, 2)}\n`;

type ContratoTipado = Contrato & {
  id: string;
  version: string;
  fuenteDeVerdad: { archivo: string; variable: string };
  deteccion: Detector[];
};

/** El mundo que se muta: archivos, registro, excepciones, exclusiones, tabla de clasificación y reloj. */
export type Mundo = {
  archivos: Record<string, string>;
  contratos: Contrato[];
  excepciones: unknown;
  exclusiones: unknown;
  niveles: Nivel[];
  /** Reglas agregadas a la tabla: se reflejan en el texto de `clasificacion.cjs` sintético. */
  reglasExtras: Regla[];
  sinRutas: boolean;
  ilegibles: Set<string>;
  previas: { fallas: unknown[]; avisos: unknown[] };
  ahora: Date;
};

/** Repositorio sintético SANO: dos contratos, tres unidades que usan y declaran, el resto sin contratos. */
export function mundoSano(): Mundo {
  const archivos: Record<string, string> = {
    "package.json": "{}",
    "package-lock.json": "{}",
    "README.md": "# Repo\n",
    "arquitectura/reglas.cjs": "module.exports = [];\n",
    "test/una.test.ts": "export {};\n",
    "scripts/migrar.ts": "export {};\n",
    "scripts/contratos.json": SIN_CONTRATOS,
    "migraciones/0001_base.sql": "select 1;\n",
    "migraciones/contratos.json": SIN_CONTRATOS,
    "src/modulos/empresas/dominio/empresa.ts": "export const empresa = 1;\n",
    "src/modulos/empresas/dominio/separador.ts": `${USO_EN_TS}\n`,
    "src/modulos/empresas/contratos.json": json({ usa: [CONTRATO_A] }),
    "src/capacidades/permisos/permisos.ts": "export const permiso = 1;\n",
    "src/capacidades/contratos.json": SIN_CONTRATOS,
    "apps/web/ui/tokens.css": TOKENS,
    "apps/web/ui/Linea.module.css": `${LINEA_DE_USO}\n`,
    "apps/web/ui/Caja.module.css": ".caja { border-radius: var(--radio); }\n",
    "apps/web/contratos.json": json({ usa: [CONTRATO_A, CONTRATO_B] }),
    "apps/plataforma/pantallas/Inicio.css": ".inicio {\n  color: red;\n}\n",
    "apps/plataforma/contratos.json": json({ usa: [], noUsa: "Todavía no usa contratos." }),
  };
  return {
    archivos,
    contratos: [contrato(), contratoDeRadio()],
    excepciones: [],
    exclusiones: structuredClone(EXCLUSIONES_BASE),
    niveles: structuredClone(NIVELES),
    reglasExtras: [],
    sinRutas: false,
    ilegibles: new Set(),
    previas: { fallas: [], avisos: [] },
    ahora: AHORA,
  };
}

/** El texto del registro sintético: el id de cada contrato está en una línea fija (4, 7, 10…). */
function registroComoTexto(contratos: Contrato[]): string {
  const lineas = ["// Registro sintético de la matriz de invariantes.", "module.exports = ["];
  for (const c of contratos) {
    lineas.push(
      "  {",
      typeof c["id"] === "string" ? `    id: "${c["id"]}",` : "    // sin id",
      "  },",
    );
  }
  lineas.push("];");
  return `${lineas.join("\n")}\n`;
}

/** El texto de la tabla sintética: `const NIVELES` en la línea 2 y una línea por clase (3 a 11). */
function clasificacionComoTexto(extras: Regla[]): string {
  const lineas = [
    "// Tabla de clasificación sintética de la matriz de invariantes.",
    "const NIVELES = [",
    ...CLASES.map((clase) => `  { clase: "${clase}" },`),
    ...extras.map((r) => `  { clase: "${r.clase}", glob: "${r.glob}" },`),
    "];",
  ];
  return `${lineas.join("\n")}\n`;
}

/** Corre el guardián sobre el mundo. Los archivos de reglas y de datos (sintéticos) también son rutas. */
export function ejecutarMundo(m: Mundo): ReturnType<typeof ejecutar> & {
  textos: Record<string, string>;
} {
  const textos: Record<string, string> = {
    ...m.archivos,
    "arquitectura/contratos/contratos.cjs": registroComoTexto(m.contratos),
    "arquitectura/contratos/clasificacion.cjs": clasificacionComoTexto(m.reglasExtras),
    "arquitectura/contratos/excepciones.json": json(m.excepciones),
    "arquitectura/contratos/exclusiones.json": json(m.exclusiones),
  };
  const entradas: Entradas = {
    rutas: m.sinRutas ? [] : Object.keys(textos),
    leer: (ruta) => (m.ilegibles.has(ruta) ? null : (textos[ruta] ?? null)),
    contratos: m.contratos,
    excepciones: m.excepciones,
    exclusiones: m.exclusiones,
    niveles: m.niveles,
    previas: m.previas,
    ahora: m.ahora,
  };
  return { ...ejecutar(entradas), textos };
}

/** Lo mismo, como lo que devuelve un aplicador: las fallas y los textos para ubicar líneas. */
function correrMundo(m: Mundo): Corrida {
  const { fallas, textos } = ejecutarMundo(m);
  return { salidas: fallas.map((f) => ({ ...f })), textos };
}

// --- Operaciones sobre el mundo ----------------------------------------------------------------------

const poner = (m: Mundo, ruta: string, texto: string): void => {
  m.archivos[ruta] = texto;
};
const quitar = (m: Mundo, ruta: string): void => {
  if (!(ruta in m.archivos)) throw new Error(`el mundo sano no tiene ${ruta}`);
  delete m.archivos[ruta];
};
const mover = (m: Mundo, de: string, a: string): void => {
  const texto = m.archivos[de];
  if (texto === undefined) throw new Error(`el mundo sano no tiene ${de}`);
  delete m.archivos[de];
  m.archivos[a] = texto;
};
const declarar = (m: Mundo, unidad: string, datos: unknown): void => {
  poner(m, `${unidad}/contratos.json`, json(datos));
};
const contratoDe = (m: Mundo, id: string): ContratoTipado => {
  const encontrado = m.contratos.find((c) => c["id"] === id);
  if (encontrado === undefined) throw new Error(`el mundo sano no tiene el contrato ${id}`);
  return encontrado as ContratoTipado;
};
const detectorDe = (m: Mundo, id: string, posicion: number): Detector => {
  const detector = contratoDe(m, id).deteccion[posicion];
  if (detector === undefined) throw new Error(`el contrato ${id} no tiene el detector ${posicion}`);
  return detector;
};
const ubicarRegla = (m: Mundo, glob: string): { nivel: Nivel; posicion: number } => {
  for (const nivel of m.niveles) {
    const posicion = nivel.reglas.findIndex((r) => r.glob === glob);
    if (posicion !== -1) return { nivel, posicion };
  }
  throw new Error(`la tabla de clasificación no tiene la regla ${glob}`);
};
const quitarRegla = (m: Mundo, glob: string): void => {
  const { nivel, posicion } = ubicarRegla(m, glob);
  nivel.reglas.splice(posicion, 1);
};
const cambiarGlob = (m: Mundo, glob: string, nuevo: string): void => {
  const { nivel, posicion } = ubicarRegla(m, glob);
  nivel.reglas[posicion] = { clase: nivel.reglas[posicion]?.clase ?? "backend", glob: nuevo };
};
const cambiarClase = (m: Mundo, glob: string, clase: string): void => {
  const { nivel, posicion } = ubicarRegla(m, glob);
  nivel.reglas[posicion] = { clase, glob };
};
/** Agrega una regla en el mismo nivel que otra ya existente. */
const agregarReglaJuntoA = (m: Mundo, glob: string, regla: Regla): void => {
  ubicarRegla(m, glob).nivel.reglas.push(regla);
  m.reglasExtras.push(regla);
};
const exclusionDeRuta = (m: Mundo, ruta: string, cambios: Record<string, unknown> = {}) => ({
  id: `excl-${ruta.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
  alcance: "ruta",
  ruta,
  huella: huellaDelArchivo(m.archivos[ruta] ?? ""),
  motivo: "Archivo aprobado para quedar fuera del análisis.",
  responsable: "Ingeniería",
  aprobadoPor: "Dueño",
  creada: "2026-10-21",
  vence: "2026-12-20",
  ...cambios,
});
const listaDe = (valor: unknown): Record<string, unknown>[] => valor as Record<string, unknown>[];

/** Un uso del contrato A en una unidad que no lo declara, silenciado por una excepción válida (base de I5). */
function conUsoSilenciado(m: Mundo): void {
  const ruta = "src/capacidades/permisos/separador.ts";
  poner(m, ruta, `${USO_EN_TS}\n`);
  m.excepciones = [
    {
      id: "exc-1",
      contrato: CONTRATO_A,
      ruta,
      huella: huellaDe(USO_EN_TS),
      motivo: "Uso heredado que se migra en la próxima entrega.",
      responsable: "Ingeniería",
      aprobadoPor: "Dueño",
      creada: "2026-10-15",
      vence: "2026-12-01",
    },
  ];
}

/** El mundo sano con su excepción vigente: precondición de las mutaciones de I5. */
export function mundoConExcepcionVigente(): Mundo {
  const m = mundoSano();
  conUsoSilenciado(m);
  return m;
}

// --- El canario -------------------------------------------------------------------------------------

/** Las fallas que el guardián REAL tiene que imprimir sobre el repositorio roto conocido. */
const FALLAS_DEL_CANARIO = [
  { archivo: "herramienta-sin-clase/x.ts", linea: 1 },
  { archivo: "src/modulos/fiscal/contratos.json", linea: 1 },
];
const GUARDIAN = "arquitectura/contratos/guardian.cjs";

/**
 * Corre el guardián (la copia que prepara `variante`) como CLI sobre un repositorio roto conocido en
 * una carpeta temporal: una ruta sin clase y un módulo sin declaración. El repo real no se toca.
 */
export function correrElCanario(variante: (carpeta: string) => void = () => undefined): Problema[] {
  const carpeta = mkdtempSync(join(tmpdir(), "canario-"));
  try {
    const origen = join(RAIZ, "arquitectura/contratos");
    for (const nombre of readdirSync(origen)) {
      if (/\.cjs$/.test(nombre) || nombre === "exclusiones.json" || nombre === "excepciones.json") {
        const destino = join(carpeta, "arquitectura/contratos", nombre);
        mkdirSync(dirname(destino), { recursive: true });
        writeFileSync(destino, readFileSync(join(origen, nombre)));
      }
    }
    for (const ruta of ["herramienta-sin-clase/x.ts", "src/modulos/fiscal/dominio/x.ts"]) {
      mkdirSync(dirname(join(carpeta, ruta)), { recursive: true });
      writeFileSync(join(carpeta, ruta), "export {};\n");
    }
    variante(carpeta);
    const entorno = {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    };
    const inicio = spawnSync("git", ["init", "-q"], {
      cwd: carpeta,
      env: entorno,
      encoding: "utf8",
    });
    if (inicio.status !== 0) throw new Error(`git init falló en el canario: ${inicio.stderr}`);
    const corrida = spawnSync(process.execPath, [join(carpeta, GUARDIAN), "--sin-informe"], {
      cwd: carpeta,
      env: entorno,
      encoding: "utf8",
      timeout: 60_000,
    });
    return evaluarCanario(
      { estado: corrida.status, salidaDeError: corrida.stderr },
      FALLAS_DEL_CANARIO,
      GUARDIAN,
    );
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
}

const escribirElGuardian = (texto: string) => (carpeta: string) => {
  writeFileSync(join(carpeta, GUARDIAN), texto);
};

// --- Aplicadores --------------------------------------------------------------------------------------

type Aplicador = () => Corrida;

/** Un aplicador sobre el repositorio sintético sano. */
const enRepo =
  (cambiar: (m: Mundo) => void): Aplicador =>
  () => {
    const m = mundoSano();
    cambiar(m);
    return correrMundo(m);
  };

/** Un aplicador sobre la base con la excepción vigente (I5). */
const enRepoConExcepcion =
  (cambiar: (m: Mundo, excepcion: Record<string, unknown>) => void): Aplicador =>
  () => {
    const m = mundoConExcepcionVigente();
    cambiar(m, listaDe(m.excepciones)[0] as Record<string, unknown>);
    return correrMundo(m);
  };

/** Un aplicador sobre un texto real (package.json, ci.yml, vitest.config.ts) alterado en memoria. */
const enTexto =
  (
    archivo: string,
    alterar: (texto: string) => string,
    verificar: (texto: string) => Problema[],
  ): Aplicador =>
  () => {
    const texto = alterar(leerReal(archivo));
    return { salidas: verificar(texto), textos: { [archivo]: texto } };
  };

const enPackageJson = (alterar: (t: string) => string) =>
  enTexto("package.json", alterar, verificarScriptsDeArquitectura);
const enWorkflow = (alterar: (t: string) => string) =>
  enTexto(".github/workflows/ci.yml", alterar, verificarWorkflowDeCi);
const enVitest = (alterar: (t: string) => string) =>
  enTexto("vitest.config.ts", alterar, verificarVitestConfig);

/** Las líneas de un trabajo del workflow: `[desde, hasta)` (índices desde 0). */
function tramoDelTrabajo(texto: string, nombre: string): [number, number] {
  const lineas = texto.split("\n");
  const desde = lineas.findIndex((l) => l === `  ${nombre}:`);
  if (desde === -1) throw new Error(`el ci.yml real no tiene el trabajo ${nombre}`);
  let hasta = lineas.length;
  for (let i = desde + 1; i < lineas.length; i += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lineas[i] ?? "") || /^\S/.test(lineas[i] ?? "")) {
      hasta = i;
      break;
    }
  }
  return [desde, hasta];
}
/** Quita del trabajo la primera línea que cumple `patron`. */
function quitarLineaDelTrabajo(texto: string, nombre: string, patron: RegExp): string {
  const lineas = texto.split("\n");
  const [desde, hasta] = tramoDelTrabajo(texto, nombre);
  const indice = lineas.slice(desde, hasta).findIndex((l) => patron.test(l));
  if (indice === -1) throw new Error(`el trabajo ${nombre} no tiene una línea ${String(patron)}`);
  lineas.splice(desde + indice, 1);
  return lineas.join("\n");
}
/** Inserta una línea justo debajo de la clave del trabajo. */
function insertarEnElTrabajo(texto: string, nombre: string, linea: string): string {
  const lineas = texto.split("\n");
  const [desde] = tramoDelTrabajo(texto, nombre);
  lineas.splice(desde + 1, 0, linea);
  return lineas.join("\n");
}

const enPruebas =
  (alterar: (archivos: Record<string, string>) => void): Aplicador =>
  () => {
    const archivos = leerPruebasDelGuardian();
    alterar(archivos);
    const textos = Object.fromEntries(
      Object.entries(archivos).map(([nombre, texto]) => [`test/arquitectura/${nombre}`, texto]),
    );
    return { salidas: escanearPruebasDelGuardian(archivos), textos };
  };
const agregarAlFinal = (archivos: Record<string, string>, nombre: string, texto: string) => {
  const actual = archivos[nombre];
  if (actual === undefined) throw new Error(`no existe ${nombre}`);
  archivos[nombre] = `${actual.trimEnd()}\n${texto}\n`;
};

/** Una copia profunda del catálogo para alterarla sin tocar el real. */
const copiaDelCatalogo = (): Invariante[] => structuredClone(INVARIANTES);
const invariante = (copia: Invariante[], id: string): Invariante => {
  const encontrado = copia.find((i) => i.id === id);
  if (encontrado === undefined) throw new Error(`el catálogo real no tiene el invariante ${id}`);
  return encontrado;
};
const enLaMatriz =
  (
    alterar: (copia: Invariante[]) => {
      codigosDeFalla?: string[];
      idsConAplicador?: string[];
    } | void,
  ): Aplicador =>
  () => {
    const copia = copiaDelCatalogo();
    const cambios = alterar(copia) ?? {};
    const texto = readFileSync(join(RAIZ, ARCHIVO_DE_LA_MATRIZ), "utf8");
    return {
      salidas: comprobarMatriz({
        invariantes: copia,
        codigosDeFalla: cambios.codigosDeFalla ?? CODIGOS_DE_FALLA,
        idsConAplicador: cambios.idsConAplicador ?? Object.keys(APLICADORES),
        texto,
      }),
      textos: { [ARCHIVO_DE_LA_MATRIZ]: texto },
    };
  };

const exclusionesDe = (m: Mundo) => listaDe(m.exclusiones);

/** Aplicadores por id de mutación: la otra mitad del catálogo (M5: ninguna mutación sin aplicador). */
export const APLICADORES: Record<string, Aplicador> = {
  // I1 · Toda ruta versionada tiene exactamente una clase.
  "I1-quitar-la-regla-de-una-carpeta": enRepo((m) => quitarRegla(m, "src/modulos/empresas/**")),
  "I1-vaciar-una-clase-esperada": enRepo((m) => quitar(m, "scripts/migrar.ts")),
  "I1-mover-codigo-fuera-de-las-reglas": enRepo((m) =>
    mover(m, "apps/web/ui/Linea.module.css", "herramientas/Linea.module.css"),
  ),
  "I1-renombrar-una-carpeta": enRepo((m) => {
    for (const ruta of Object.keys(m.archivos)) {
      if (ruta.startsWith("src/modulos/empresas/")) {
        mover(m, ruta, ruta.replace("src/modulos/empresas/", "src/modulos/clientes/"));
      }
    }
  }),
  "I1-duplicar-la-regla-con-otra-clase": enRepo((m) =>
    agregarReglaJuntoA(m, "src/modulos/empresas/**", {
      clase: "frontend",
      glob: "src/modulos/empresas/**",
    }),
  ),
  "I1-regla-desconectada-de-su-carpeta": enRepo((m) =>
    cambiarGlob(m, "src/modulos/empresas/**", "src/modulos/empresa/**"),
  ),
  "I1-clase-que-se-ignora-sin-exclusion": enRepo((m) => {
    agregarReglaJuntoA(m, "package-lock.json", { clase: "ignorada", glob: "tmp/**" });
    poner(m, "tmp/x.ts", "export {};\n");
  }),

  "I1-reclasificar-codigo-como-documentacion": enRepo((m) => {
    cambiarClase(m, "src/capacidades/**", "docs");
    poner(m, "src/capacidades/permisos/separador.ts", `${USO_EN_TS}\n`);
  }),

  // I2 · Toda unidad declara sus contratos (o declara que no tiene).
  "I2-borrar-la-declaracion": enRepo((m) => quitar(m, "src/modulos/empresas/contratos.json")),
  "I2-noUsa-vacio": enRepo((m) => declarar(m, "apps/plataforma", { usa: [], noUsa: "" })),
  "I2-usa-y-noUsa-a-la-vez": enRepo((m) =>
    declarar(m, "src/modulos/empresas", { usa: [CONTRATO_A], noUsa: "No usa nada." }),
  ),
  "I2-id-inexistente": enRepo((m) =>
    declarar(m, "apps/web", { usa: [CONTRATO_A, CONTRATO_B, "no-existe"] }),
  ),
  "I2-declaracion-fuera-de-la-raiz-de-la-unidad": enRepo((m) =>
    mover(m, "src/capacidades/contratos.json", "src/capacidades/permisos/contratos.json"),
  ),
  "I2-id-repetido-en-usa": enRepo((m) =>
    declarar(m, "src/modulos/empresas", { usa: [CONTRATO_A, CONTRATO_A] }),
  ),
  "I2-unidad-nueva-sin-declaracion": enRepo((m) => {
    agregarReglaJuntoA(m, "src/modulos/empresas/**", {
      clase: "backend",
      glob: "src/modulos/nuevo/**",
    });
    poner(m, "src/modulos/nuevo/dominio/x.ts", "export {};\n");
  }),
  "I2-unidad-con-solo-documentos": enRepo((m) =>
    poner(m, "src/modulos/solo-docs/README.md", "# Solo documentos\n"),
  ),
  "I2-archivo-suelto-fuera-de-toda-unidad": enRepo((m) =>
    poner(m, "apps/suelto.css", `${LINEA_DE_USO}\n`),
  ),

  // I3 · La declaración coincide con el uso real.
  "I3-quitar-el-id-de-usa": enRepo((m) => declarar(m, "apps/web", { usa: [CONTRATO_B] })),
  "I3-vaciar-el-detector": enRepo((m) => {
    contratoDe(m, CONTRATO_A).deteccion = [];
  }),
  "I3-noUsa-con-uso-real": enRepo((m) =>
    declarar(m, "src/modulos/empresas", { usa: [], noUsa: "No usa nada." }),
  ),
  "I3-declarar-sin-uso": enRepo((m) =>
    declarar(m, "src/modulos/empresas", { usa: [CONTRATO_A, CONTRATO_B] }),
  ),
  "I3-mover-el-uso-a-una-clase-no-mirada": enRepo((m) =>
    mover(
      m,
      "src/modulos/empresas/dominio/separador.ts",
      "src/modulos/empresas/dominio/separador.test.ts",
    ),
  ),
  "I3-detector-que-lanza-un-error": enRepo((m) => {
    detectorDe(m, CONTRATO_A, 0).reconoce = () => {
      throw new Error("el detector se rompió");
    };
  }),
  "I3-detector-con-linea-fuera-del-archivo": enRepo((m) => {
    detectorDe(m, CONTRATO_A, 0).reconoce = () => [{ linea: 999, texto: "no existe" }];
  }),
  "I3-detector-que-nunca-reconoce": enRepo((m) => {
    detectorDe(m, CONTRATO_A, 0).reconoce = () => [];
  }),
  "I3-copiar-el-uso-a-una-unidad-que-no-declara": enRepo((m) =>
    poner(m, "src/capacidades/permisos/separador.ts", `${USO_EN_TS}\n`),
  ),
  "I3-desconectar-el-detector-de-las-clases-del-uso": enRepo((m) => {
    detectorDe(m, CONTRATO_A, 0).clases = ["pruebas"];
  }),
  "I3-detector-sin-clases": enRepo((m) => {
    detectorDe(m, CONTRATO_A, 0).clases = [];
  }),
  "I3-excluir-el-archivo-que-usa": enRepo((m) => {
    m.exclusiones = [...listaDe(m.exclusiones), exclusionDeRuta(m, "apps/web/ui/Caja.module.css")];
  }),
  "I3-escribir-el-uso-por-un-camino-que-el-detector-no-reconoce": enRepo((m) =>
    poner(m, "apps/web/ui/Caja.module.css", ".caja { border-radius: var( --radio ); }\n"),
  ),

  // I4 · Cada contrato tiene una única fuente de verdad.
  "I4-borrar-la-fuente": enRepo((m) => quitar(m, "apps/web/ui/tokens.css")),
  "I4-cambiar-la-exportacion": enRepo((m) => {
    contratoDe(m, CONTRATO_A).fuenteDeVerdad = {
      archivo: "apps/web/ui/tokens.css",
      variable: "--color-de-linea",
    };
  }),
  "I4-copiar-el-valor-en-otro-archivo": enRepo((m) =>
    poner(m, "apps/web/ui/Otra.module.css", ":root {\n  --color-separador: #cccccc;\n}\n"),
  ),
  "I4-segunda-definicion-en-otra-unidad": enRepo((m) =>
    poner(m, "apps/plataforma/pantallas/Inicio.css", ".inicio {\n  --color-separador: #ccc;\n}\n"),
  ),
  "I4-fuente-apuntada-a-un-archivo-que-no-existe": enRepo((m) => {
    contratoDe(m, CONTRATO_A).fuenteDeVerdad = {
      archivo: "apps/web/ui/otros-tokens.css",
      variable: "--color-separador",
    };
  }),
  "I4-quitar-el-detector-de-definicion": enRepo((m) => {
    const registro = contratoDe(m, CONTRATO_A);
    registro.deteccion = registro.deteccion.filter((d) => d.tipo !== "definicion");
    poner(m, "apps/web/ui/Otra.module.css", ":root {\n  --color-separador: #cccccc;\n}\n");
  }),
  "I4-silenciar-la-copia-con-una-exclusion-vencida": enRepo((m) => {
    poner(m, "apps/web/ui/Otra.module.css", ":root {\n  --color-separador: #cccccc;\n}\n");
    m.exclusiones = [
      ...listaDe(m.exclusiones),
      exclusionDeRuta(m, "apps/web/ui/Otra.module.css", {
        creada: "2026-07-01",
        vence: "2026-08-30",
      }),
    ];
  }),

  // I5 · Las excepciones son acotadas y vigentes (base: un uso silenciado por una excepción vigente).
  "I5-campo-faltante": enRepoConExcepcion((_m, excepcion) => {
    delete excepcion["responsable"];
  }),
  "I5-excepcion-obsoleta": enRepoConExcepcion((m) =>
    poner(m, "src/capacidades/permisos/separador.ts", "export const permiso = 2;\n"),
  ),
  "I5-vencida": enRepoConExcepcion((_m, excepcion) => {
    Object.assign(excepcion, { creada: "2026-08-01", vence: "2026-09-15" });
  }),
  "I5-mas-de-60-dias": enRepoConExcepcion((_m, excepcion) => {
    Object.assign(excepcion, { creada: "2026-10-01", vence: "2026-12-01" });
  }),
  "I5-creada-en-el-futuro": enRepoConExcepcion((_m, excepcion) => {
    Object.assign(excepcion, { creada: "2026-11-01", vence: "2026-12-01" });
  }),
  "I5-vence-antes-de-creada": enRepoConExcepcion((_m, excepcion) => {
    Object.assign(excepcion, { creada: "2026-10-15", vence: "2026-10-10" });
  }),
  "I5-la-huella-ya-no-coincide": enRepoConExcepcion((m) =>
    poner(m, "src/capacidades/permisos/separador.ts", `${USO_EN_TS} // cambiada\n`),
  ),
  "I5-comodin-en-la-ruta": enRepoConExcepcion((_m, excepcion) => {
    excepcion["ruta"] = "src/capacidades/**";
  }),
  "I5-ampliar-el-alcance-a-otra-linea-igual": enRepoConExcepcion((m) =>
    poner(m, "src/capacidades/permisos/separador.ts", `${USO_EN_TS}\n${USO_EN_TS}\n`),
  ),
  "I5-dos-excepciones-para-un-hallazgo": enRepoConExcepcion((m, excepcion) => {
    m.excepciones = [excepcion, { ...excepcion, id: "exc-2" }];
  }),
  "I5-contrato-inexistente": enRepoConExcepcion((_m, excepcion) => {
    excepcion["contrato"] = "no-existe";
  }),

  // I6 · Lo que no se analiza está excluido de forma explícita y temporal.
  "I6-exclusion-sin-motivo": enRepo((m) => {
    delete exclusionesDe(m)[0]?.["motivo"];
  }),
  "I6-vaciar-las-exclusiones": enRepo((m) => {
    m.exclusiones = [];
  }),
  "I6-exclusion-sin-aprobacion": enRepo((m) => {
    Object.assign(exclusionesDe(m)[0] ?? {}, { aprobadoPor: "" });
  }),
  "I6-excluir-una-clase-no-permitida": enRepo((m) => {
    Object.assign(exclusionesDe(m)[0] ?? {}, { clase: "backend" });
  }),
  "I6-exclusion-vencida": enRepo((m) => {
    Object.assign(exclusionesDe(m)[1] ?? {}, { creada: "2026-07-01", vence: "2026-08-30" });
  }),
  "I6-exclusion-de-mas-de-60-dias": enRepo((m) => {
    Object.assign(exclusionesDe(m)[0] ?? {}, { creada: "2026-10-01", vence: "2026-12-31" });
  }),
  "I6-misma-clase-excluida-dos-veces": enRepo((m) => {
    m.exclusiones = [
      ...listaDe(m.exclusiones),
      { ...listaDe(m.exclusiones)[0], id: "excl-generado-2" },
    ];
  }),
  "I6-exclusion-de-un-archivo-que-ya-no-existe": enRepo((m) => {
    m.exclusiones = [
      ...listaDe(m.exclusiones),
      exclusionDeRuta(m, "apps/web/ui/Borrada.css", { huella: "a".repeat(64) }),
    ];
  }),
  "I6-detector-sobre-una-clase-excluida": enRepo((m) => {
    detectorDe(m, CONTRATO_A, 0).clases = ["frontend", "backend", "docs"];
  }),
  "I6-exclusion-de-archivo-con-la-huella-vieja": enRepo((m) => {
    m.exclusiones = [
      ...listaDe(m.exclusiones),
      exclusionDeRuta(m, "apps/web/ui/Caja.module.css", { huella: huellaDelArchivo("otro texto") }),
    ];
  }),
  "I6-exclusion-con-comodin": enRepo((m) => {
    m.exclusiones = [
      ...listaDe(m.exclusiones),
      exclusionDeRuta(m, "apps/web/**", { huella: "a".repeat(64) }),
    ];
  }),

  // I7 · «Pasó» significa «se analizó algo».
  "I7-repositorio-sin-archivos": enRepo((m) => {
    m.sinRutas = true;
  }),
  "I7-clase-esperada-vacia": enRepo((m) => quitar(m, "test/una.test.ts")),
  "I7-archivo-ilegible": enRepo((m) => {
    m.ilegibles.add("apps/web/ui/Caja.module.css");
  }),
  "I7-detector-sobre-clase-sin-texto": enRepo((m) => {
    detectorDe(m, CONTRATO_A, 0).clases = ["pruebas"];
    quitar(m, "test/una.test.ts");
    poner(m, "test/una.png", "binario");
  }),
  "I7-excluir-todos-los-archivos-del-detector": enRepo((m) => {
    const frontend = Object.keys(m.archivos).filter(
      (ruta) => ruta.startsWith("apps/web/ui/") || ruta.startsWith("apps/plataforma/pantallas/"),
    );
    m.exclusiones = [
      ...listaDe(m.exclusiones),
      ...frontend.map((ruta) => exclusionDeRuta(m, ruta)),
    ];
  }),
  "I7-informe-sin-reglas-ejecutadas": () => {
    const { informe } = ejecutarMundo(mundoSano());
    informe.reglasEjecutadas.chequeos = [];
    return { salidas: verificarInformeDeEvidencia(informe), textos: {} };
  },

  // I8 · El registro de contratos es válido y no se debilita en silencio.
  "I8-campo-del-contrato-faltante": enRepo((m) => {
    delete contratoDe(m, CONTRATO_A)["protege"];
  }),
  "I8-contrato-borrado-con-unidades-que-lo-declaran": enRepo((m) => {
    m.contratos = m.contratos.filter((c) => c["id"] !== CONTRATO_A);
  }),
  "I8-contrato-borrado-junto-con-todas-sus-declaraciones": enRepo((m) => {
    m.contratos = m.contratos.filter((c) => c["id"] !== CONTRATO_A);
    declarar(m, "apps/web", { usa: [CONTRATO_B] });
    declarar(m, "src/modulos/empresas", { usa: [], noUsa: "Ya no usa contratos." });
  }),
  "I8-version-mal-formada": enRepo((m) => {
    contratoDe(m, CONTRATO_A).version = "1";
  }),
  "I8-id-de-contrato-repetido": enRepo((m) => {
    m.contratos = [...m.contratos, contrato()];
  }),
  "I8-detector-que-no-es-una-funcion": enRepo((m) => {
    (detectorDe(m, CONTRATO_A, 0) as unknown as Record<string, unknown>)["reconoce"] = "no";
  }),
  "I8-registro-vaciado-con-unidades-que-declaran": enRepo((m) => {
    m.contratos = [];
  }),

  // I9 · El guardián corre y bloquea en CI.
  "I9-quitar-guardian-del-script-arquitectura": enPackageJson((t) =>
    reemplazar(t, " && npm run guardian", ""),
  ),
  "I9-package-json-roto": enPackageJson((t) => t.slice(0, 200)),
  "I9-guardian-que-no-bloquea": enPackageJson((t) =>
    reemplazar(
      t,
      '"guardian": "node arquitectura/contratos/guardian.cjs"',
      '"guardian": "node arquitectura/contratos/guardian.cjs || true"',
    ),
  ),
  "I9-script-guardian-duplicado": enPackageJson((t) =>
    reemplazar(
      t,
      '"guardian": "node arquitectura/contratos/guardian.cjs",',
      '"guardian": "node arquitectura/contratos/guardian.cjs",\n    "guardian": "echo guardián omitido",',
    ),
  ),
  "I9-quitar-arquitectura-del-gate": enPackageJson((t) =>
    reemplazar(t, " && npm run arquitectura", ""),
  ),
  "I9-test-sin-el-proyecto-node": enPackageJson((t) =>
    reemplazar(
      t,
      '"test": "vitest run --project node"',
      '"test": "vitest run --project componentes"',
    ),
  ),
  "I9-quitar-un-job-de-needs": enWorkflow((t) => {
    const lineas = t.split("\n");
    const [desde, hasta] = tramoDelTrabajo(t, "gate");
    const indice = lineas.slice(desde, hasta).findIndex((l) => l.trim() === "pruebas,");
    if (indice === -1) throw new Error("el Gate real no lista `pruebas,` en needs");
    lineas.splice(desde + indice, 1);
    return lineas.join("\n");
  }),
  "I9-quitar-el-tope-de-tiempo": enWorkflow((t) =>
    quitarLineaDelTrabajo(t, "pruebas", /^ {4}timeout-minutes:/),
  ),
  "I9-ningun-trabajo-corre-el-guardian": enWorkflow((t) =>
    t
      .replace(/npm run (?:arquitectura|guardian)\b/g, "echo omitido")
      .replace(/arquitectura\/contratos\/guardian\.cjs/g, "arquitectura/contratos/omitido.cjs"),
  ),
  "I9-ningun-trabajo-corre-las-pruebas": enWorkflow((t) =>
    reemplazar(t, "- run: npm test\n", "- run: echo omitido\n"),
  ),
  "I9-continue-on-error": enWorkflow((t) =>
    insertarEnElTrabajo(t, "pruebas", "    continue-on-error: true"),
  ),
  "I9-job-con-if-false": enWorkflow((t) => insertarEnElTrabajo(t, "pruebas", "    if: false")),
  "I9-comando-que-nunca-falla": enWorkflow((t) =>
    reemplazar(t, "- run: npm test\n", "- run: npm test || true\n"),
  ),
  "I9-gate-sin-always": enWorkflow((t) => quitarLineaDelTrabajo(t, "gate", /^ {4}if: always\(\)/)),
  "I9-renombrar-el-gate": enWorkflow((t) => reemplazar(t, "\n  gate:\n", "\n  puerta:\n")),
  "I9-vitest-deja-de-incluir-test": enVitest((t) =>
    reemplazar(
      t,
      'include: ["src/**/*.test.ts", "test/**/*.test.ts"],',
      'include: ["src/**/*.test.ts"],',
    ),
  ),
  "I9-excluir-las-pruebas-del-guardian-en-vitest": enVitest((t) =>
    reemplazar(
      t,
      'include: ["src/**/*.test.ts", "test/**/*.test.ts"],',
      'include: ["src/**/*.test.ts", "test/**/*.test.ts"],\n          exclude: ["test/arquitectura/guardian-*"],',
    ),
  ),
  "I9-borrar-una-prueba-del-guardian": enPruebas((archivos) => {
    delete archivos["guardian-nucleo.test.ts"];
  }),
  "I9-prueba-del-guardian-pendiente": enPruebas((archivos) =>
    agregarAlFinal(archivos, "guardian-registro.test.ts", 'it.todo("marca-de-la-matriz");'),
  ),
  "I9-prueba-del-guardian-exclusiva": enPruebas((archivos) =>
    agregarAlFinal(
      archivos,
      "guardian-excepciones.test.ts",
      'it.only("marca-de-la-matriz", () => {});',
    ),
  ),
  "I9-saltar-con-una-condicion-nueva": enPruebas((archivos) =>
    agregarAlFinal(
      archivos,
      "guardian-diagnostico.test.ts",
      'describe.skipIf(true)("marca-de-la-matriz", () => {});',
    ),
  ),
  "I9-constante-de-salto-forzada": enPruebas((archivos) => {
    const nucleo = archivos["guardian-nucleo.test.ts"];
    if (nucleo === undefined) throw new Error("no existe guardian-nucleo.test.ts");
    archivos["guardian-nucleo.test.ts"] = reemplazar(
      nucleo,
      "const SIN_GIT = !HAY_GIT;",
      "const SIN_GIT = true;",
    );
  }),
  "I9-saltar-una-prueba-del-guardian": enPruebas((archivos) =>
    agregarAlFinal(
      archivos,
      "guardian-clasificacion.test.ts",
      'describe.skip("marca-de-la-matriz", () => {});',
    ),
  ),
  "I9-job-solo-en-un-evento": enWorkflow((t) =>
    insertarEnElTrabajo(t, "pruebas", "    if: github.event_name == 'workflow_dispatch'"),
  ),
  "I9-sin-disparador-de-pull-request": enWorkflow((t) => reemplazar(t, "  pull_request:\n", "")),
  "I9-disparador-con-filtro-de-rutas": enWorkflow((t) =>
    reemplazar(t, "  pull_request:\n", '  pull_request:\n    paths-ignore: ["**/*.md"]\n'),
  ),
  "I9-renombrar-el-proyecto-node": enVitest((t) => reemplazar(t, 'name: "node"', 'name: "unidad"')),
  "I9-guardian-que-sale-0-sin-analizar": () => ({
    salidas: correrElCanario(escribirElGuardian("process.exit(0);\n")),
    textos: {},
  }),
  "I9-guardian-que-rechaza-sin-diagnostico": () => ({
    salidas: correrElCanario(escribirElGuardian("process.exit(1);\n")),
    textos: {},
  }),
  "I9-guardian-que-no-ve-las-rutas-sin-clase": () => ({
    salidas: correrElCanario((carpeta) => {
      const archivo = join(carpeta, "arquitectura/contratos/clasificacion.cjs");
      writeFileSync(
        archivo,
        reemplazar(readFileSync(archivo, "utf8"), "if (!decidida) {", "if (false) {"),
      );
    }),
    textos: {},
  }),

  // I10 · La matriz está completa y conectada.
  "I10-quitar-las-mutaciones-de-un-tipo": enLaMatriz((copia) => {
    const i2 = invariante(copia, "I2");
    i2.mutaciones = i2.mutaciones.filter((m) => m.tipo !== "eliminacion");
  }),
  "I10-agregar-un-codigo-sin-invariante": enLaMatriz(() => ({
    codigosDeFalla: [...CODIGOS_DE_FALLA, "chequeo-nuevo-sin-invariante"],
  })),
  "I10-codigo-sin-mutacion-que-lo-espere": enLaMatriz((copia) => {
    for (const i of copia) {
      i.mutaciones = i.mutaciones.filter((m) => m.esperado?.codigo !== "uso-sin-declarar");
    }
  }),
  "I10-borrar-un-invariante": enLaMatriz((copia) => {
    copia.splice(
      copia.findIndex((i) => i.id === "I7"),
      1,
    );
  }),
  "I10-invariante-sin-elementos": enLaMatriz((copia) => {
    delete invariante(copia, "I3").elementos["define"];
  }),
  "I10-mutacion-sin-esperado": enLaMatriz((copia) => {
    const primera = invariante(copia, "I1").mutaciones[0];
    if (primera === undefined) throw new Error("I1 no tiene mutaciones");
    delete primera.esperado;
  }),
  "I10-invariante-con-codigo-inexistente": enLaMatriz((copia) => {
    invariante(copia, "I1").codigosDeFalla.push("codigo-que-no-existe");
  }),
  "I10-noaplica-sin-motivo": enLaMatriz((copia) => {
    const sinMotivo = invariante(copia, "I4").mutaciones.find((m) => m.noAplica !== undefined);
    if (sinMotivo === undefined) throw new Error("I4 no tiene un noAplica");
    sinMotivo.noAplica = "";
  }),
  "I10-id-de-mutacion-repetido": enLaMatriz((copia) => {
    const mutaciones = invariante(copia, "I1").mutaciones;
    const [primera, segunda] = mutaciones;
    if (primera === undefined || segunda === undefined)
      throw new Error("I1 tiene pocas mutaciones");
    segunda.id = primera.id;
  }),
  "I10-mutacion-sin-aplicador": enLaMatriz(() => ({
    idsConAplicador: Object.keys(APLICADORES).filter(
      (id) => id !== "I1-quitar-la-regla-de-una-carpeta",
    ),
  })),
  "I10-aplicador-sin-mutacion": enLaMatriz(() => ({
    idsConAplicador: [...Object.keys(APLICADORES), "mutacion-que-ya-no-existe"],
  })),
  "I10-hallazgo-sin-linea": enRepo((m) => {
    m.previas.fallas.push({
      codigo: "ruta-sin-clase",
      archivo: "src/chequeo-nuevo.ts",
      contrato: null,
      motivo: "Un chequeo nuevo que olvidó decir la línea.",
      correccion: "Decir la línea.",
    });
  }),
  "I10-codigo-fuera-de-la-lista-cerrada": enRepo((m) => {
    m.previas.fallas.push({
      codigo: "chequeo-que-nadie-anoto",
      archivo: "src/chequeo-nuevo.ts",
      linea: 1,
      contrato: null,
      motivo: "Un chequeo nuevo con un código que no está en la lista cerrada.",
      correccion: "Anotar el código.",
    });
  }),
  "I10-excluir-la-matriz-en-vitest": enVitest((t) =>
    reemplazar(
      t,
      'include: ["src/**/*.test.ts", "test/**/*.test.ts"],',
      'include: ["src/**/*.test.ts", "test/**/*.test.ts"],\n          exclude: ["test/arquitectura/guardian-matriz*"],',
    ),
  ),
  "I10-saltar-la-matriz": enPruebas((archivos) =>
    agregarAlFinal(archivos, "guardian-matriz.test.ts", 'it.skip("marca-de-la-matriz", () => {});'),
  ),
};
