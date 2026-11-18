import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, posix } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";

const require = createRequire(import.meta.url);
const { lineasDe } = require("../../arquitectura/deuda/tamano.cjs") as {
  lineasDe: (texto: string) => number;
};

/**
 * REGLA (escalabilidad, E-1, 18/11/2026; convención en `11-especificaciones/ficha-de-archivo-central.md` del repositorio de documentos):
 * un ARCHIVO CENTRAL es el que todo módulo nuevo tiene que tocar para existir (lo junta, lo registra o lo conecta). Cada uno está en la
 * lista única `arquitectura/centrales.json` y esta prueba, para cada entrada, falla si:
 *  1. el primer comentario del archivo no es el encabezado «ARCHIVO CENTRAL» con sus cinco etiquetas exactas (QUÉ ES, QUÉ NO ES,
 *     EXPORTA, IMPORTA, PARTE DEDICADA), una por línea;
 *  2. lo que el archivo exporta de verdad no es igual a `exporta` del JSON ni a la línea EXPORTA del encabezado (una exportación nueva
 *     obliga a decidir a propósito; el mensaje dice «si es de un módulo, va en <parteDedicada>»); las reexportaciones `export {…} from`
 *     cuentan como exportaciones;
 *  3. importa (`import`, `export … from` o `import()`) de una ruta que no está en `importaDe`, ni la línea IMPORTA del encabezado
 *     coincide con `importaDe`;
 *  4. con `soloJunta: true`, tiene algo que no sea imports, reexportaciones, tipos y constantes sin funciones (ni clases);
 *  5. tiene más líneas que `lineas` (el trinquete solo baja: se baja el número en el JSON cuando el archivo baja);
 *  6. un archivo que cumple el patrón `parteDedicada` no termina en una clave real de `CATALOGO_DE_MODULOS` (o en `excepciones`).
 * Previene: que lo propio de un módulo se escriba en el archivo común (caso real: `apps/web/servidor/modulos.ts`, 398 de 400 líneas y 13
 * briefs en cola el 18/11/2026) y que dos sesiones entiendan distinto para qué sirve un archivo. Cada forma de violación está
 * inyectada abajo.
 *
 * Límites que NO ve (a propósito): no puede juzgar si una función «es lógica de un módulo»; vuelve visible y deliberado cada agregado
 * (lista exacta de exportaciones, importaciones permitidas, tamaño que solo baja y `soloJunta`). Una función privada nueva dentro de un
 * archivo que no es `soloJunta` pasa si no supera el tamaño. Con `soloJunta` no comprueba que la constante sea «la del registro». Un
 * `import()` o `require()` con texto armado (no literal) cuenta como importación no permitida (cierra, no abre).
 */

const RAIZ = join(import.meta.dirname, "../..");
const ETIQUETAS = ["QUÉ ES", "QUÉ NO ES", "EXPORTA", "IMPORTA", "PARTE DEDICADA"] as const;
const TITULO = "ARCHIVO CENTRAL";
const MARCA_DE_MODULO = "<módulo>";

export type EntradaCentral = Readonly<{
  ruta: string;
  exporta: readonly string[];
  importaDe: readonly string[];
  parteDedicada: string;
  soloJunta: boolean;
  lineas: number;
  excepciones?: readonly string[];
}>;

const archivoDe = (nombre: string, texto: string): ts.SourceFile =>
  ts.createSourceFile(nombre, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Cada nombre que un archivo exporta. `export *` y `export default` cuentan como «*» y «default»: no se pueden listar (cierra, no abre). */
export function exportacionesDe(nombre: string, texto: string): string[] {
  const nombres: string[] = [];
  for (const sentencia of archivoDe(nombre, texto).statements) {
    if (ts.isExportAssignment(sentencia)) nombres.push("default");
    else if (ts.isExportDeclaration(sentencia)) {
      if (sentencia.exportClause === undefined || !ts.isNamedExports(sentencia.exportClause))
        nombres.push("*");
      else for (const e of sentencia.exportClause.elements) nombres.push(e.name.text);
    } else if (ts.canHaveModifiers(sentencia)) {
      const modificadores = ts.getModifiers(sentencia) ?? [];
      if (!modificadores.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      if (modificadores.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword))
        nombres.push("default");
      else if (ts.isVariableStatement(sentencia))
        for (const d of sentencia.declarationList.declarations)
          nombres.push(ts.isIdentifier(d.name) ? d.name.text : "*");
      else {
        const declarado = "name" in sentencia ? (sentencia.name as ts.Node | undefined) : undefined;
        nombres.push(declarado !== undefined && ts.isIdentifier(declarado) ? declarado.text : "*");
      }
    }
  }
  return nombres;
}

export const DINAMICO = "<import dinámico sin texto fijo>";

/** Cada ruta de la que un archivo importa, tal como está escrita: `import`, `export … from`, `import()` y `require()`. */
export function importacionesDe(nombre: string, texto: string): string[] {
  const rutas: string[] = [];
  const mirar = (nodo: ts.Node): void => {
    if (
      (ts.isImportDeclaration(nodo) || ts.isExportDeclaration(nodo)) &&
      nodo.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(nodo.moduleSpecifier)
    )
      rutas.push(nodo.moduleSpecifier.text);
    else if (
      ts.isCallExpression(nodo) &&
      (nodo.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(nodo.expression) && nodo.expression.text === "require"))
    ) {
      const [argumento] = nodo.arguments;
      rutas.push(
        argumento !== undefined && ts.isStringLiteralLike(argumento) ? argumento.text : DINAMICO,
      );
    } else if (
      ts.isImportEqualsDeclaration(nodo) &&
      ts.isExternalModuleReference(nodo.moduleReference)
    ) {
      const expresion = nodo.moduleReference.expression;
      rutas.push(ts.isStringLiteralLike(expresion) ? expresion.text : DINAMICO);
    }
    ts.forEachChild(nodo, mirar);
  };
  mirar(archivoDe(nombre, texto));
  return rutas;
}

/** La ruta desde la raíz, sin extensión, de lo que un archivo importa (los módulos de afuera, como están escritos). */
export function resolverImportacion(rutaDelArchivo: string, especificador: string): string {
  if (!especificador.startsWith(".")) return especificador;
  return posix
    .normalize(posix.join(posix.dirname(rutaDelArchivo), especificador))
    .replace(/\.(?:[cm]?[jt]sx?)$/, "");
}

/** Un patrón con `*` (dentro de una carpeta) y `**` (varias) contra una ruta completa. */
export function coincide(patron: string, ruta: string): boolean {
  const regex = patron
    .split("**")
    .map((parte) =>
      parte
        .split("*")
        .map((fragmento) => fragmento.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${regex}$`, "u").test(ruta);
}

/** El primer comentario de bloque del archivo, línea por línea y sin los asteriscos. `null` si no hay. */
export function primerComentario(nombre: string, texto: string): string[] | null {
  for (const sentencia of archivoDe(nombre, texto).statements) {
    const comentario = (ts.getLeadingCommentRanges(texto, sentencia.getFullStart()) ?? []).find(
      (c) => c.kind === ts.SyntaxKind.MultiLineCommentTrivia,
    );
    if (comentario !== undefined)
      return texto
        .slice(comentario.pos, comentario.end)
        .replace(/^\/\*+/, "")
        .replace(/\*\/$/, "")
        .split("\n")
        .map((linea) => linea.replace(/^\s*\*?\s?/, "").trimEnd())
        .filter((linea) => linea !== "");
  }
  return null;
}

function listaDe(valor: string): string[] {
  return valor
    .replace(/\.$/, "")
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n !== "");
}

const iguales = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && new Set(a).size === a.length && a.every((x) => b.includes(x));

/** Reglas 1, 2, 3, 4 y 5 de un archivo central contra su texto. */
export function problemasDeUnCentral(entrada: EntradaCentral, texto: string): string[] {
  const { ruta } = entrada;
  const problemas: string[] = [];

  // 1. El encabezado.
  const comentario = primerComentario(ruta, texto);
  let lineaDe: (etiqueta: string) => string | null = () => null;
  if (comentario === null || comentario[0] !== TITULO) {
    problemas.push(`${ruta}: el primer comentario no es el encabezado «${TITULO}»`);
  } else {
    lineaDe = (etiqueta) => {
      const coincidencias = comentario.filter((l) => l.startsWith(`${etiqueta}: `));
      return coincidencias.length === 1
        ? (coincidencias[0] ?? "").slice(etiqueta.length + 2)
        : null;
    };
    for (const etiqueta of ETIQUETAS) {
      const valor = lineaDe(etiqueta);
      if (valor === null || valor.trim() === "")
        problemas.push(
          `${ruta}: al encabezado le falta la etiqueta «${etiqueta}:» (una vez, con texto)`,
        );
    }
  }

  // 2. Lo que exporta.
  const reales = exportacionesDe(ruta, texto);
  for (const n of reales)
    if (!entrada.exporta.includes(n))
      problemas.push(
        `${ruta}: exporta «${n}», que no está en \`exporta\` de arquitectura/centrales.json: si es de un módulo, va en ${entrada.parteDedicada}`,
      );
  for (const n of entrada.exporta)
    if (!reales.includes(n))
      problemas.push(
        `${ruta}: \`exporta\` lista «${n}» y el archivo no lo exporta (sacalo del JSON y del encabezado)`,
      );
  const exportaDelEncabezado = lineaDe("EXPORTA");
  if (exportaDelEncabezado !== null && !iguales(listaDe(exportaDelEncabezado), entrada.exporta))
    problemas.push(`${ruta}: la línea EXPORTA del encabezado no es igual a \`exporta\` del JSON`);
  const parteDelEncabezado = lineaDe("PARTE DEDICADA");
  if (parteDelEncabezado !== null && !parteDelEncabezado.includes(entrada.parteDedicada))
    problemas.push(
      `${ruta}: la línea PARTE DEDICADA del encabezado no nombra «${entrada.parteDedicada}»`,
    );

  // 3. Lo que importa.
  for (const especificador of new Set(importacionesDe(ruta, texto))) {
    const destino = resolverImportacion(ruta, especificador);
    if (!entrada.importaDe.some((patron) => coincide(patron, destino)))
      problemas.push(`${ruta}: importa de «${especificador}», que no está en \`importaDe\``);
  }
  const importaDelEncabezado = lineaDe("IMPORTA");
  if (importaDelEncabezado !== null && !iguales(listaDe(importaDelEncabezado), entrada.importaDe))
    problemas.push(`${ruta}: la línea IMPORTA del encabezado no es igual a \`importaDe\` del JSON`);

  // 4. Solo junta.
  if (entrada.soloJunta) problemas.push(...problemasDeSoloJunta(ruta, texto));

  // 5. El tamaño.
  const lineas = lineasDe(texto);
  if (lineas > entrada.lineas)
    problemas.push(
      `${ruta}: tiene ${lineas} líneas y su tope en \`lineas\` es ${entrada.lineas} (solo baja)`,
    );
  return problemas;
}

/** Regla 4: con `soloJunta`, nada de funciones ni clases, y solo imports, reexportaciones, tipos y constantes. */
export function problemasDeSoloJunta(ruta: string, texto: string): string[] {
  const problemas: string[] = [];
  const fuente = archivoDe(ruta, texto);
  const esFuncion = (n: ts.Node): boolean =>
    ts.isFunctionLike(n) ||
    ts.isClassLike(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n);
  const contieneFuncion = (n: ts.Node): boolean =>
    esFuncion(n) || ts.forEachChild(n, contieneFuncion) === true;
  for (const sentencia of fuente.statements) {
    const permitida =
      ts.isImportDeclaration(sentencia) ||
      ts.isExportDeclaration(sentencia) ||
      ts.isTypeAliasDeclaration(sentencia) ||
      ts.isInterfaceDeclaration(sentencia) ||
      ts.isVariableStatement(sentencia);
    if (!permitida || contieneFuncion(sentencia))
      problemas.push(
        `${ruta}: es \`soloJunta\` y tiene ${ts.SyntaxKind[sentencia.kind]} con lógica (solo imports, reexportaciones, tipos y constantes sin funciones)`,
      );
  }
  return problemas;
}

/** Regla 6: los archivos de una carpeta que cumplen el patrón `parteDedicada` y no terminan en una clave de módulo. */
export function problemasDeNombres(
  entrada: EntradaCentral,
  archivos: readonly string[],
  claves: readonly string[],
): string[] {
  const [prefijo, sufijo, ...resto] = entrada.parteDedicada.split(MARCA_DE_MODULO);
  if (prefijo === undefined || sufijo === undefined || resto.length > 0)
    return [
      `${entrada.ruta}: \`parteDedicada\` tiene que llevar «${MARCA_DE_MODULO}» una sola vez`,
    ];
  const base = posix.basename(prefijo);
  const permitidas = [...claves, ...(entrada.excepciones ?? [])];
  return archivos
    .filter(
      (a) => a.startsWith(base) && a.endsWith(sufijo) && a.length > base.length + sufijo.length,
    )
    .filter((a) => !permitidas.includes(a.slice(base.length, a.length - sufijo.length)))
    .map(
      (a) =>
        `${posix.dirname(prefijo)}/${a}: cumple ${entrada.parteDedicada} pero lo que va en ${MARCA_DE_MODULO} no es una clave de CATALOGO_DE_MODULOS`,
    );
}

/** La forma de la lista: cada entrada con todos sus campos (cierra, no abre). */
export function problemasDeLaLista(lista: unknown): string[] {
  const problemas: string[] = [];
  if (
    typeof lista !== "object" ||
    lista === null ||
    !("centrales" in lista) ||
    !Array.isArray(lista.centrales)
  )
    return ['arquitectura/centrales.json: tiene que ser { "centrales": [...] }'];
  const rutas = new Set<string>();
  for (const [i, e] of (lista.centrales as unknown[]).entries()) {
    const entrada = e as Record<string, unknown>;
    const quien = `arquitectura/centrales.json[${i}]`;
    const texto = (v: unknown): boolean => typeof v === "string" && v !== "";
    const textos = (v: unknown): boolean => Array.isArray(v) && v.every(texto);
    if (!texto(entrada["ruta"])) problemas.push(`${quien}: falta \`ruta\``);
    else if (rutas.has(entrada["ruta"] as string))
      problemas.push(`${quien}: la ruta está repetida`);
    else rutas.add(entrada["ruta"] as string);
    if (!textos(entrada["exporta"]))
      problemas.push(`${quien}: \`exporta\` tiene que ser una lista de nombres`);
    if (!textos(entrada["importaDe"]))
      problemas.push(`${quien}: \`importaDe\` tiene que ser una lista de patrones`);
    if (!texto(entrada["parteDedicada"])) problemas.push(`${quien}: falta \`parteDedicada\``);
    if (typeof entrada["soloJunta"] !== "boolean")
      problemas.push(`${quien}: \`soloJunta\` tiene que ser true o false`);
    if (!Number.isInteger(entrada["lineas"]) || (entrada["lineas"] as number) < 1)
      problemas.push(`${quien}: \`lineas\` tiene que ser un entero positivo`);
    if (entrada["excepciones"] !== undefined && !textos(entrada["excepciones"]))
      problemas.push(`${quien}: \`excepciones\` tiene que ser una lista de nombres`);
  }
  return problemas;
}

describe("archivos centrales: la lista y los archivos reales", () => {
  const lista = JSON.parse(readFileSync(join(RAIZ, "arquitectura/centrales.json"), "utf8")) as {
    centrales: EntradaCentral[];
  };

  it("la lista tiene la forma que se espera y cada archivo existe", () => {
    expect(problemasDeLaLista(lista)).toEqual([]);
    for (const e of lista.centrales) expect(existsSync(join(RAIZ, e.ruta)), e.ruta).toBe(true);
  });

  it("cada archivo central cumple su ficha: encabezado, exportaciones, importaciones, solo junta y tamaño", () => {
    const problemas = lista.centrales.flatMap((e) =>
      problemasDeUnCentral(e, readFileSync(join(RAIZ, e.ruta), "utf8")),
    );
    expect(problemas).toEqual([]);
  });

  it("cada archivo de la parte dedicada es de un módulo real", () => {
    const claves = Object.keys(CATALOGO_DE_MODULOS);
    const problemas = lista.centrales.flatMap((e) =>
      problemasDeNombres(e, readdirSync(join(RAIZ, dirname(e.parteDedicada))), claves),
    );
    expect(problemas).toEqual([]);
  });
});

describe("archivos centrales: el analizador ve cada forma (violaciones inyectadas)", () => {
  const ruta = "apps/web/servidor/ejemplo.ts";
  const encabezado = (extra: Partial<Record<(typeof ETIQUETAS)[number], string>> = {}): string =>
    [
      "/**",
      ` * ${TITULO}`,
      ` * QUÉ ES: ${extra["QUÉ ES"] ?? "una junta."}`,
      ` * QUÉ NO ES: ${extra["QUÉ NO ES"] ?? "el lugar de la lógica de un módulo."}`,
      ` * EXPORTA: ${extra["EXPORTA"] ?? "a, B."}`,
      ` * IMPORTA: ${extra["IMPORTA"] ?? "server-only, apps/web/servidor/ofertas-de-*."}`,
      ` * PARTE DEDICADA: ${extra["PARTE DEDICADA"] ?? "apps/web/servidor/ofertas-de-<módulo>.ts"}`,
      " */",
    ].join("\n");
  const cuerpo = [
    'import "server-only";',
    'import { x } from "./ofertas-de-caja";',
    "export const a = x;",
    "export type B = string;",
  ].join("\n");
  const bien = `${cuerpo.split("\n")[0] ?? ""}\n${encabezado()}\n${cuerpo.split("\n").slice(1).join("\n")}\n`;
  const entrada: EntradaCentral = {
    ruta,
    exporta: ["a", "B"],
    importaDe: ["server-only", "apps/web/servidor/ofertas-de-*"],
    parteDedicada: "apps/web/servidor/ofertas-de-<módulo>.ts",
    soloJunta: false,
    lineas: 100,
  };

  it("un archivo que cumple todo no tiene problemas", () => {
    expect(problemasDeUnCentral(entrada, bien)).toEqual([]);
  });

  it("1. sin encabezado, o con una etiqueta que falta o repetida, falla", () => {
    expect(problemasDeUnCentral(entrada, cuerpo).join("|")).toContain("no es el encabezado");
    const sinEtiqueta = bien.replace(" * QUÉ NO ES: el lugar de la lógica de un módulo.\n", "");
    expect(problemasDeUnCentral(entrada, sinEtiqueta)).toEqual([
      `${ruta}: al encabezado le falta la etiqueta «QUÉ NO ES:» (una vez, con texto)`,
    ]);
    const repetida = bien.replace(
      " * QUÉ ES: una junta.\n",
      " * QUÉ ES: una junta.\n * QUÉ ES: otra.\n",
    );
    expect(problemasDeUnCentral(entrada, repetida)).toHaveLength(1);
  });

  it("2. una exportación nueva falla y dice dónde va si es de un módulo", () => {
    const problemas = problemasDeUnCentral(entrada, `${bien}export function puedeAlgoNuevo() {}\n`);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("puedeAlgoNuevo");
    expect(problemas[0]).toContain("va en apps/web/servidor/ofertas-de-<módulo>.ts");
  });

  it.each([
    ["una constante", "export const c = 1;"],
    ["una reexportación con nombre", 'export { y } from "./ofertas-de-caja";'],
    ["un tipo", "export type C = string;"],
    ["export *", 'export * from "./ofertas-de-caja";'],
    ["export default", "export default function () {}"],
  ])("2. %s también falla", (_nombre, texto) => {
    expect(
      problemasDeUnCentral(entrada, `${bien}${texto}\n`).filter((p) => p.includes("exporta")),
    ).not.toEqual([]);
  });

  it("2. una exportación que el JSON lista y el archivo no tiene falla", () => {
    expect(
      problemasDeUnCentral({ ...entrada, exporta: ["a", "B", "z"] }, bien).some((p) =>
        p.includes("«z»"),
      ),
    ).toBe(true);
  });

  it("2. la línea EXPORTA del encabezado tiene que coincidir con el JSON", () => {
    const desparejo = `${cuerpo.split("\n")[0] ?? ""}\n${encabezado({ EXPORTA: "a." })}\n${cuerpo.split("\n").slice(1).join("\n")}\n`;
    expect(problemasDeUnCentral(entrada, desparejo)).toEqual([
      `${ruta}: la línea EXPORTA del encabezado no es igual a \`exporta\` del JSON`,
    ]);
  });

  it("3. importar de una ruta que no está permitida falla (import, reexportación, import() y require())", () => {
    for (const linea of [
      'import { q } from "../ui/otra";',
      'export { q } from "./ofertas-de-caja/../../otra";',
      'const m = await import("./otra");',
      'const m = require("otra-libreria");',
    ])
      expect(
        problemasDeUnCentral(entrada, `${bien}${linea}\n`).filter((p) => p.includes("importaDe")),
      ).not.toEqual([]);
  });

  it("3. un import() con texto armado cuenta como no permitido", () => {
    expect(importacionesDe(ruta, "const m = await import(`./x/${n}`);")).toEqual([DINAMICO]);
    expect(
      problemasDeUnCentral(entrada, `${bien}const m = await import(nombre);\n`).some((p) =>
        p.includes("importaDe"),
      ),
    ).toBe(true);
  });

  it("3. la línea IMPORTA del encabezado tiene que coincidir con el JSON", () => {
    const desparejo = `${cuerpo.split("\n")[0] ?? ""}\n${encabezado({ IMPORTA: "server-only." })}\n${cuerpo.split("\n").slice(1).join("\n")}\n`;
    expect(problemasDeUnCentral(entrada, desparejo)).toEqual([
      `${ruta}: la línea IMPORTA del encabezado no es igual a \`importaDe\` del JSON`,
    ]);
  });

  it("3. las rutas se resuelven contra la carpeta del archivo y se comparan sin extensión", () => {
    expect(resolverImportacion("apps/web/servidor/modulos.ts", "./ofertas-de-caja")).toBe(
      "apps/web/servidor/ofertas-de-caja",
    );
    expect(resolverImportacion("apps/web/servidor/modulos.ts", "../ui/navegacion/menu.ts")).toBe(
      "apps/web/ui/navegacion/menu",
    );
    expect(resolverImportacion("a/b.ts", "react")).toBe("react");
    expect(coincide("apps/web/servidor/ofertas-de-*", "apps/web/servidor/ofertas-de-caja")).toBe(
      true,
    );
    expect(coincide("apps/web/servidor/ofertas-de-*", "apps/web/servidor/ofertas-de-caja/x")).toBe(
      false,
    );
    expect(coincide("apps/**", "apps/web/servidor/x")).toBe(true);
  });

  it("4. con soloJunta, una función (declarada, flecha o clase) falla; los imports, tipos y constantes no", () => {
    const junta = { ...entrada, soloJunta: true };
    expect(problemasDeUnCentral(junta, bien)).toEqual([]);
    for (const linea of [
      "function f() {}",
      "export const g = () => 1;",
      "const h = { m() {} };",
      "class K {}",
      "if (true) {}",
    ])
      expect(
        problemasDeUnCentral(junta, `${bien}${linea}\n`).filter((p) => p.includes("soloJunta")),
      ).not.toEqual([]);
  });

  it("5. un archivo con más líneas que su tope falla; con las justas no", () => {
    const lineas = lineasDe(bien);
    expect(problemasDeUnCentral({ ...entrada, lineas }, bien)).toEqual([]);
    expect(problemasDeUnCentral({ ...entrada, lineas: lineas - 1 }, bien)).toEqual([
      `${ruta}: tiene ${lineas} líneas y su tope en \`lineas\` es ${lineas - 1} (solo baja)`,
    ]);
  });

  it("6. un archivo de la parte dedicada con un módulo inventado falla; uno real, no", () => {
    const claves = Object.keys(CATALOGO_DE_MODULOS);
    expect(problemasDeNombres(entrada, ["ofertas-de-inventado.ts"], claves)).toHaveLength(1);
    expect(
      problemasDeNombres(entrada, ["ofertas-de-caja.ts", "modulos.ts", "ofertas-de-.ts"], claves),
    ).toEqual([]);
    expect(
      problemasDeNombres(
        { ...entrada, excepciones: ["inventado"] },
        ["ofertas-de-inventado.ts"],
        claves,
      ),
    ).toEqual([]);
    expect(
      problemasDeNombres({ ...entrada, parteDedicada: "sin marca.ts" }, [], claves),
    ).toHaveLength(1);
  });

  it("la forma de la lista falla si falta un campo, si hay una ruta repetida o si no es la lista", () => {
    const ok = { centrales: [{ ...entrada }] };
    expect(problemasDeLaLista(ok)).toEqual([]);
    expect(problemasDeLaLista([])).toHaveLength(1);
    expect(problemasDeLaLista({ centrales: [{ ...entrada, lineas: 0 }] })).toHaveLength(1);
    expect(problemasDeLaLista({ centrales: [{ ...entrada, soloJunta: "si" }] })).toHaveLength(1);
    expect(problemasDeLaLista({ centrales: [entrada, entrada] })).toHaveLength(1);
    const sin: Record<string, unknown> = { ...entrada };
    delete sin["parteDedicada"];
    expect(problemasDeLaLista({ centrales: [sin] })).toHaveLength(1);
  });
});
