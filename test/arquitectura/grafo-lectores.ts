import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import ts from "typescript";
import type {
  EntradaDeCaso,
  EntradaDeMigracion,
  EntradaDeRuta,
  EntradaDeTabla,
} from "./grafo-apoyo";

/**
 * Los lectores que alimentan el grafo (etapa 0). Leen el disco y devuelven datos planos para `construirGrafo`; no deciden nada.
 * Reusan lo que ya existe: las declaraciones de casos de uso y el catálogo se importan en `grafo.test.ts` (no se reescriben acá);
 * acá solo va lo que hoy no tiene registro (rutas, alcance desde una página, tablas y su uso, el índice de docs).
 */

const EXTENSIONES = [".ts", ".tsx"];
const ES_DE_PRUEBA = /\.(test|recorrido)\.[cm]?[jt]sx?$/;
const CARPETAS_IGNORADAS = new Set(["node_modules", ".next", ".vitest"]);

/** Todo el código de `src/` y `apps/` (sin pruebas): ruta desde la raíz → texto. */
export function leerFuentes(raiz: string): Map<string, string> {
  const fuentes = new Map<string, string>();
  for (const base of ["src", "apps"]) {
    for (const r of readdirSync(join(raiz, base), { recursive: true, encoding: "utf8" })) {
      const partes = r.split("/");
      if (partes.some((p) => CARPETAS_IGNORADAS.has(p))) continue;
      if (!EXTENSIONES.some((e) => r.endsWith(e)) || ES_DE_PRUEBA.test(r)) continue;
      fuentes.set(`${base}/${r}`, readFileSync(join(raiz, base, r), "utf8"));
    }
  }
  return fuentes;
}

/** `apps/web/app/s/app/(operacion)/caja/cajas/[id]/page.tsx` → `web:/caja/cajas/[id]`. */
export function rutaDePagina(archivo: string): EntradaDeRuta | null {
  const web = /^apps\/web\/app\/(.*)\/page\.tsx$|^apps\/web\/app\/page\.tsx$/.exec(archivo);
  const plataforma =
    /^apps\/plataforma\/app\/(.*)\/page\.tsx$|^apps\/plataforma\/app\/page\.tsx$/.exec(archivo);
  const coincidencia = web ?? plataforma;
  if (coincidencia === null) return null;
  const app = web === null ? "plataforma" : "web";
  const tramos = (coincidencia[1] ?? "").split("/").filter((t) => t !== "" && !/^\(.*\)$/.test(t));
  // La aplicación web sirve la operación bajo `s/app`: las pantallas de empresa se escriben sin ese prefijo en menú y fichas.
  const sinPrefijo =
    app === "web" && tramos[0] === "s" && tramos[1] === "app" ? tramos.slice(2) : tramos;
  const ruta = `/${sinPrefijo.join("/")}`;
  return { id: `${app}:${ruta}`, app, ruta, archivo };
}

export function leerRutas(fuentes: ReadonlyMap<string, string>): readonly EntradaDeRuta[] {
  const rutas: EntradaDeRuta[] = [];
  for (const archivo of fuentes.keys()) {
    const r = rutaDePagina(archivo);
    if (r !== null) rutas.push(r);
  }
  return rutas.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Alcance de una página: qué nombres aparecen en el código que esa página llega a usar (por símbolo, no por archivo).

/** Raíces de composición (listan todo) y la propia capa de módulos (ahí se DEFINEN los casos): la búsqueda no entra en ellas. */
function esFronteraDelAlcance(archivo: string): boolean {
  if (archivo.startsWith("src/modulos/")) return true;
  if (archivo.startsWith("src/capacidades/") || archivo.startsWith("src/primitivas/")) return true;
  if (archivo.startsWith("src/adaptadores/") || archivo.startsWith("src/plataforma/")) return true;
  if (archivo.startsWith("src/puertos/") || archivo.startsWith("src/contexto/")) return true;
  return /^src\/composicion\/(web|web-base|web-de-[\w-]+|trabajos|conexiones)\.ts$/.test(archivo);
}

function resolver(
  desde: string,
  especificador: string,
  existentes: ReadonlySet<string>,
): string | null {
  if (!especificador.startsWith(".")) return null;
  const base = posix.normalize(posix.join(posix.dirname(desde), especificador));
  const candidatos = [
    base,
    ...EXTENSIONES.map((e) => `${base}${e}`),
    ...EXTENSIONES.map((e) => posix.join(base, `index${e}`)),
  ];
  return candidatos.find((c) => existentes.has(c)) ?? null;
}

function esTsx(archivo: string): boolean {
  return archivo.endsWith("x");
}

function identificadoresEn(nodo: ts.Node): Set<string> {
  const nombres = new Set<string>();
  const visitar = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) nombres.add(n.text);
    ts.forEachChild(n, visitar);
  };
  visitar(nodo);
  return nombres;
}

type Importado = Readonly<{ archivo: string | null; nombre: string }>;

type AnalisisDeArchivo = Readonly<{
  /** Símbolo de nivel superior → identificadores que usa su declaración. */
  simbolos: ReadonlyMap<string, ReadonlySet<string>>;
  /** Identificadores de lo que no es una declaración con nombre (expresiones sueltas, `export default <expresión>`). */
  sueltos: ReadonlySet<string>;
  importaciones: ReadonlyMap<string, Importado>;
  /** Nombre exportado → símbolo local. */
  exportaciones: ReadonlyMap<string, string>;
  reexportaciones: ReadonlyMap<string, Importado>;
  estrellas: readonly string[];
}>;

function analizar(
  archivo: string,
  texto: string,
  existentes: ReadonlySet<string>,
): AnalisisDeArchivo {
  const fuente = ts.createSourceFile(
    archivo,
    texto,
    ts.ScriptTarget.Latest,
    false,
    esTsx(archivo) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const simbolos = new Map<string, Set<string>>();
  const sueltos = new Set<string>();
  const importaciones = new Map<string, Importado>();
  const exportaciones = new Map<string, string>();
  const reexportaciones = new Map<string, Importado>();
  const estrellas: string[] = [];
  const tiene = (n: ts.Node, m: ts.SyntaxKind): boolean =>
    ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((x) => x.kind === m);
  const destino = (e: ts.Expression | undefined): string | null =>
    e !== undefined && ts.isStringLiteral(e) ? resolver(archivo, e.text, existentes) : null;

  for (const s of fuente.statements) {
    if (ts.isImportDeclaration(s)) {
      const archivoDestino = destino(s.moduleSpecifier);
      const c = s.importClause;
      if (c === undefined) continue;
      if (c.name !== undefined)
        importaciones.set(c.name.text, { archivo: archivoDestino, nombre: "default" });
      if (c.namedBindings !== undefined && ts.isNamespaceImport(c.namedBindings))
        importaciones.set(c.namedBindings.name.text, { archivo: archivoDestino, nombre: "*" });
      else if (c.namedBindings !== undefined)
        for (const e of c.namedBindings.elements)
          importaciones.set(e.name.text, {
            archivo: archivoDestino,
            nombre: (e.propertyName ?? e.name).text,
          });
    } else if (ts.isExportDeclaration(s)) {
      const archivoDestino = destino(s.moduleSpecifier);
      if (s.exportClause === undefined) {
        if (archivoDestino !== null) estrellas.push(archivoDestino);
      } else if (ts.isNamedExports(s.exportClause)) {
        for (const e of s.exportClause.elements) {
          const local = (e.propertyName ?? e.name).text;
          if (s.moduleSpecifier === undefined) exportaciones.set(e.name.text, local);
          else reexportaciones.set(e.name.text, { archivo: archivoDestino, nombre: local });
        }
      }
    } else if (ts.isExportAssignment(s)) {
      if (ts.isIdentifier(s.expression)) exportaciones.set("default", s.expression.text);
      else {
        simbolos.set("default", identificadoresEn(s.expression));
        exportaciones.set("default", "default");
      }
    } else if (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) {
      const nombre = s.name?.text ?? "default";
      simbolos.set(nombre, identificadoresEn(s));
      if (tiene(s, ts.SyntaxKind.ExportKeyword)) exportaciones.set(nombre, nombre);
      if (tiene(s, ts.SyntaxKind.DefaultKeyword)) exportaciones.set("default", nombre);
    } else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) {
          for (const n of identificadoresEn(d)) sueltos.add(n);
          continue;
        }
        simbolos.set(d.name.text, identificadoresEn(d));
        if (tiene(s, ts.SyntaxKind.ExportKeyword)) exportaciones.set(d.name.text, d.name.text);
      }
    } else if (!ts.isTypeAliasDeclaration(s) && !ts.isInterfaceDeclaration(s)) {
      for (const n of identificadoresEn(s)) sueltos.add(n);
    }
  }
  return { simbolos, sueltos, importaciones, exportaciones, reexportaciones, estrellas };
}

/**
 * Por cada página, los nombres que aparecen en los símbolos que alcanza: parte de TODO lo que declara el archivo de la página y sigue
 * cada importación relativa solo hasta el símbolo importado (`import { listarLasCajas }` entra a esa función, no a todo el archivo).
 * No entra en la frontera (módulos y raíces de composición, donde los casos se definen o se listan todos). Sigue siendo una
 * aproximación por nombre: ver los límites en `grafo-apoyo.ts`.
 */
export function nombresAlcanzadosPorPagina(
  fuentes: ReadonlyMap<string, string>,
  rutas: readonly EntradaDeRuta[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const existentes = new Set(fuentes.keys());
  const analisis = new Map<string, AnalisisDeArchivo>();
  const de = (archivo: string): AnalisisDeArchivo => {
    const previo = analisis.get(archivo);
    if (previo !== undefined) return previo;
    const nuevo = analizar(archivo, fuentes.get(archivo) ?? "", existentes);
    analisis.set(archivo, nuevo);
    return nuevo;
  };
  /** A qué símbolos de qué archivos lleva `nombre` exportado por `archivo` (sigue reexportaciones y `export *`). */
  const resolverExportado = (
    archivo: string,
    nombre: string,
    vistos: Set<string>,
  ): readonly (readonly [string, string])[] => {
    const clave = `${archivo}#${nombre}`;
    if (vistos.has(clave) || esFronteraDelAlcance(archivo)) return [];
    vistos.add(clave);
    const a = de(archivo);
    const local = a.exportaciones.get(nombre);
    if (local !== undefined) return [[archivo, local]];
    const re = a.reexportaciones.get(nombre);
    if (re !== undefined && re.archivo !== null)
      return resolverExportado(re.archivo, re.nombre, vistos);
    return a.estrellas.flatMap((e) => resolverExportado(e, nombre, vistos));
  };

  const resultado = new Map<string, ReadonlySet<string>>();
  for (const ruta of rutas) {
    const nombres = new Set<string>();
    const visitados = new Set<string>();
    const pendientes: (readonly [string, string])[] = [];
    const agregarTodo = (archivo: string): void => {
      const a = de(archivo);
      for (const s of a.simbolos.keys()) pendientes.push([archivo, s]);
      for (const n of a.sueltos) nombres.add(n);
    };
    agregarTodo(ruta.archivo);
    while (pendientes.length > 0) {
      const siguiente = pendientes.pop();
      if (siguiente === undefined) continue;
      const [archivo, simbolo] = siguiente;
      const clave = `${archivo}#${simbolo}`;
      if (visitados.has(clave) || esFronteraDelAlcance(archivo)) continue;
      visitados.add(clave);
      const a = de(archivo);
      const usados = a.simbolos.get(simbolo);
      const importado = a.importaciones.get(simbolo);
      if (usados === undefined && importado !== undefined) {
        // Un símbolo reexportado con un `import` previo: se sigue por la importación.
        if (importado.archivo === null) continue;
        if (importado.nombre === "*") agregarTodo(importado.archivo);
        else pendientes.push(...resolverExportado(importado.archivo, importado.nombre, new Set()));
        continue;
      }
      for (const id of usados ?? []) {
        nombres.add(id);
        if (a.simbolos.has(id) && id !== simbolo) pendientes.push([archivo, id]);
        const imp = a.importaciones.get(id);
        if (imp === undefined || imp.archivo === null) continue;
        if (imp.nombre === "*") {
          if (!esFronteraDelAlcance(imp.archivo)) agregarTodo(imp.archivo);
        } else pendientes.push(...resolverExportado(imp.archivo, imp.nombre, new Set()));
      }
    }
    resultado.set(ruta.id, nombres);
  }
  return resultado;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Declaraciones de casos de uso (forma común de `DeclaracionDeCaso`).

type Declaracion = Readonly<{ accion?: string; tambien?: readonly string[]; sinGuard?: string }>;

export function casosDeDeclaraciones(
  carpeta: string,
  clase: EntradaDeCaso["clase"],
  declaraciones: Readonly<Record<string, Declaracion>>,
): readonly EntradaDeCaso[] {
  return Object.entries(declaraciones).map(([nombre, d]) => ({
    nombre,
    carpeta,
    clase,
    accion: d.accion ?? null,
    tambien: d.tambien ?? [],
    sinGuard: d.sinGuard ?? null,
  }));
}

/**
 * Acciones del catálogo que el código de un caso de uso o una consulta escribe entre comillas (`exigirAcciones(["vidrieras.crear"])`),
 * fuera de las declaraciones: el caso las pide por dentro aunque su declaración nombre otra. Es lectura por texto: puede contar una cita
 * que no es una exigencia (un mensaje, un comentario entre comillas).
 */
export function accionesExigidasDentroDeUnCaso(
  fuentes: ReadonlyMap<string, string>,
  acciones: readonly string[],
): ReadonlySet<string> {
  const conocidas = new Set(acciones);
  const halladas = new Set<string>();
  for (const [archivo, texto] of fuentes) {
    if (!/^src\/modulos\/[^/]+\/(casos-de-uso|consultas)\//.test(archivo)) continue;
    if (/\/declaraciones[\w-]*\.ts$/.test(archivo)) continue;
    for (const m of sinComentarios(texto).matchAll(/["'`]([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)["'`]/g))
      if (m[1] !== undefined && conocidas.has(m[1])) halladas.add(m[1]);
  }
  return halladas;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Tablas y migraciones.

const CREAR = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;
const BORRAR = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;
const RENOMBRAR =
  /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+RENAME\s+TO\s+"?([a-z_][a-z0-9_]*)"?/gi;

/** Quita comentarios de SQL y de TypeScript (aproximado: alcanza para buscar nombres de tablas). */
export function sinComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/--.*$/gm, " ");
}

export type LecturaDeMigraciones = Readonly<{
  migraciones: readonly EntradaDeMigracion[];
  /** Tabla → { migración que la crea, migración que la retira }. */
  tablas: ReadonlyMap<string, Readonly<{ migracion: string; retiradaEn: string | null }>>;
  /** Texto SQL de todas las migraciones, por migración: para saber si una tabla se escribe ahí (semilla, disparador). */
  texto: ReadonlyMap<string, string>;
}>;

export function leerMigraciones(raiz: string): LecturaDeMigraciones {
  const carpeta = join(raiz, "migraciones");
  const archivos = readdirSync(carpeta)
    .filter((a) => a.endsWith(".sql"))
    .sort();
  const migraciones: EntradaDeMigracion[] = [];
  const tablas = new Map<string, { migracion: string; retiradaEn: string | null }>();
  const texto = new Map<string, string>();
  for (const archivo of archivos) {
    const migracionId = archivo.replace(/\.sql$/, "");
    const sql = sinComentarios(readFileSync(join(carpeta, archivo), "utf8"));
    texto.set(migracionId, sql);
    const creadas: string[] = [];
    for (const m of sql.matchAll(CREAR)) {
      const nombre = m[1];
      if (nombre === undefined || tablas.has(nombre)) continue;
      tablas.set(nombre, { migracion: migracionId, retiradaEn: null });
      creadas.push(nombre);
    }
    for (const m of sql.matchAll(RENOMBRAR)) {
      const [, viejo, nuevo] = m;
      if (viejo === undefined || nuevo === undefined) continue;
      const previa = tablas.get(viejo);
      if (previa !== undefined) tablas.set(viejo, { ...previa, retiradaEn: migracionId });
      if (!tablas.has(nuevo)) {
        tablas.set(nuevo, { migracion: migracionId, retiradaEn: null });
        creadas.push(nuevo);
      }
    }
    for (const m of sql.matchAll(BORRAR)) {
      const previa = m[1] === undefined ? undefined : tablas.get(m[1]);
      if (m[1] !== undefined && previa !== undefined)
        tablas.set(m[1], { ...previa, retiradaEn: migracionId });
    }
    migraciones.push({ id: migracionId, tablasCreadas: creadas });
  }
  return { migraciones, tablas, texto };
}

const ESCRITURA_DE_CODIGO =
  /\b(?:insertInto|updateTable|deleteFrom)\(\s*["'`]([a-z_][a-z0-9_]*)(?:\s+as\s+[a-z_][a-z0-9_]*)?["'`]/g;
const LECTURA_DE_CODIGO =
  /\b(?:selectFrom|innerJoin|leftJoin|rightJoin|fullJoin)\(\s*["'`]([a-z_][a-z0-9_]*)(?:\s+as\s+[a-z_][a-z0-9_]*)?["'`]/g;
const ESCRITURA_SQL =
  /\b(?:insert\s+into|delete\s+from|update)\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*(?:\(|\bset\b|\bwhere\b|\bas\b|\busing\b|$|\n)/gi;
const LECTURA_SQL = /\b(?:from|join)\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;

/** El origen de un archivo de código: `modulos/caja`, `plataforma`, `adaptadores`, `apps`, `composicion`… */
function origenDe(archivo: string): string {
  const partes = archivo.split("/");
  if (partes[0] === "src" && partes[1] === "modulos" && partes[2] !== undefined)
    return `modulos/${partes[2]}`;
  if (partes[0] === "src" && partes[1] !== undefined) return partes[1];
  return partes[0] ?? archivo;
}

/** Quién escribe y quién lee cada tabla, mirando el código (no las migraciones) y por separado las migraciones. */
export function usoDeTablas(
  fuentes: ReadonlyMap<string, string>,
  lectura: LecturaDeMigraciones,
): readonly EntradaDeTabla[] {
  const nombres = new Set(lectura.tablas.keys());
  const escritores = new Map<string, Set<string>>();
  const lectores = new Map<string, Set<string>>();
  const anotar = (
    donde: Map<string, Set<string>>,
    tabla: string | undefined,
    origen: string,
  ): void => {
    if (tabla === undefined || !nombres.has(tabla)) return;
    (donde.get(tabla) ?? donde.set(tabla, new Set()).get(tabla)!).add(origen);
  };
  for (const [archivo, textoCrudo] of fuentes) {
    const texto = sinComentarios(textoCrudo);
    const origen = origenDe(archivo);
    for (const m of texto.matchAll(ESCRITURA_DE_CODIGO)) anotar(escritores, m[1], origen);
    for (const m of texto.matchAll(LECTURA_DE_CODIGO)) anotar(lectores, m[1], origen);
    for (const m of texto.matchAll(ESCRITURA_SQL)) anotar(escritores, m[1], origen);
    for (const m of texto.matchAll(LECTURA_SQL)) anotar(lectores, m[1], origen);
  }
  const escritaEnMigracion = new Set<string>();
  for (const sql of lectura.texto.values())
    for (const m of sql.matchAll(
      /\b(?:insert\s+into|update)\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi,
    ))
      if (m[1] !== undefined && nombres.has(m[1])) escritaEnMigracion.add(m[1]);
  return [...lectura.tablas.entries()]
    .map(([nombre, t]) => ({
      nombre,
      migracion: t.migracion,
      retiradaEn: t.retiradaEn,
      escritores: [...(escritores.get(nombre) ?? [])].sort(),
      lectores: [...(lectores.get(nombre) ?? [])].sort(),
      escritaEnMigracion: escritaEnMigracion.has(nombre),
    }))
    .sort((a, b) => (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Fichas: los nombres de maqueta que citan.

export function maquetasCitadas(texto: string): readonly string[] {
  return [...new Set([...texto.matchAll(/\b([a-z0-9][a-z0-9-]*\.html)\b/g)].map((m) => m[1] ?? ""))]
    .filter((m) => m !== "")
    .sort();
}
