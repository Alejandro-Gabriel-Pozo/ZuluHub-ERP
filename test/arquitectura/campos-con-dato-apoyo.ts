import ts from "typescript";
import { DATO_PENDIENTE, type DefinicionDeDato } from "../../src/capacidades/datos/registro";

/**
 * Analizador de `campos-con-dato.test.ts` (regla 5 de `Pedernal-docs/01-vision/primitivas-de-negocio.md`: sin dato registrado no hay
 * campo). Es puro: recibe rutas y texto, no toca el disco. Fail-closed por LISTA DE PERMITIDOS (dueño: «lo que el chequeo no puede
 * analizar, falla»; no se intenta entender alias ni fábricas de elementos: se prohíbe el NOMBRE en cualquier forma):
 *  - tags JSX: los intrínsecos se comparan sin distinguir mayúsculas y solo pasan los de `ETIQUETAS_PERMITIDAS` (no interactivos o
 *    estructurales); `input`, `textarea` y `select` son controles crudos; cualquier otro tag minúsculo cuenta como control crudo;
 *  - cualquier aparición como identificador, propiedad, clave entre corchetes, string literal o especificador de import (con o sin
 *    alias) de `NOMBRES_PROHIBIDOS`, `document.write` y `role="textbox"` cuenta como control crudo (deuda que solo baja);
 *  - un tag que viene de una variable o un parámetro cuenta como tag dinámico; el `<input type="hidden">` solo se exime con `type` y
 *    `name` literales y ningún spread; un campo con alias, sin `dato` o con `{...props}` después del `dato` es un problema;
 *  - cualquier cadena que nombre `react/jsx-runtime` o `react/jsx-dev-runtime` (import, `require`, `import()`, `export … from`) es un
 *    problema; un `role` que no es un literal (o una condición de literales) y `setAttribute("role"|"contenteditable", …)` cuentan como
 *    control crudo; `document.write` cuenta con cualquier receptor que contenga `document`;
 *  - un acceso con clave calculada a React o a `document` (`R["create" + "Element"]`, `R[k]`, `Reflect.get(React, …)`, `const { [k]: f } =
 *    React`) es un problema: no se puede saber qué elemento arma;
 *  - se analizan todas las extensiones de código (`EXTENSIONES_DE_CODIGO`); un archivo con error de sintaxis es un problema.
 * Límites declarados: HTML armado como texto fuera de JSX (un `route.ts` que devuelva `"<input>"`, un MDX) y componentes importados de
 * paquetes externos que rendericen un control por dentro (sumar una dependencia ya exige aviso, CLAUDE.md).
 */

export type Registro = Readonly<Record<string, DefinicionDeDato>>;
export type Contexto = Readonly<{ componentes: readonly string[]; registro: Registro }>;
export type ResultadoDeArchivo = Readonly<{
  problemas: string[];
  pendientes: number;
  crudos: number;
  /** Tags dinámicos (`<Etiqueta>` que viene de una variable o un parámetro): no se puede saber a qué elemento resuelven. */
  dinamicos: number;
  /** Controles crudos por clase: `input`, `textarea`, `select`, `etiqueta-no-permitida`, `nombre-prohibido`, `role-textbox`, `document.write`. */
  crudosPorEtiqueta: ReadonlyMap<string, number>;
  usos: ReadonlyMap<string, number>;
}>;

const CONTROLES_CRUDOS = new Set(["input", "textarea", "select"]);
/**
 * Con estos nombres se arman elementos, HTML o código sin pasar por JSX: se prohíbe el nombre, en cualquier forma en que aparezca y sin
 * distinguir mayúsculas (`Createelement` o `CREATEELEMENT` no esquivan nada). Se guardan tal cual y se comparan en minúscula.
 */
const NOMBRES_PROHIBIDOS_ESCRITOS = [
  "createElement",
  "createElementNS",
  "cloneElement",
  "jsx",
  "jsxs",
  "jsxDEV",
  "_jsx",
  "_jsxs",
  "_jsxDEV",
  "dangerouslySetInnerHTML",
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
  "DOMParser",
  "createContextualFragment",
  "contentEditable",
  "setHTMLUnsafe",
  "parseHTMLUnsafe",
  "eval",
  "designMode",
  "execCommand",
];
const NOMBRES_PROHIBIDOS = new Set(NOMBRES_PROHIBIDOS_ESCRITOS.map((n) => n.toLowerCase()));
/** Elementos HTML y SVG no interactivos (o de estructura) que pueden usarse sin pasar por el registro: la lista de permitidos. */
const ETIQUETAS_PERMITIDAS = new Set(
  (
    "html body main header footer nav section article aside div span p h1 h2 h3 h4 h5 h6 ul ol li dl dt dd " +
    "table caption colgroup col thead tbody tfoot tr th td strong em b i u s small mark code pre kbd samp var sub sup abbr " +
    "time q blockquote cite br hr wbr img picture source figure figcaption address data a button form label fieldset legend " +
    "details summary dialog output option optgroup style svg g path rect circle ellipse line polyline polygon defs use title desc " +
    "text tspan lineargradient radialgradient stop clippath mask"
  ).split(" "),
);
/** Las extensiones de código que se analizan en las aplicaciones (los tests entran si el tsconfig los compila). */
export const EXTENSIONES_DE_CODIGO = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
] as const;
const TIPOS_DE_SCRIPT: Record<string, ts.ScriptKind> = {
  ts: ts.ScriptKind.TS,
  mts: ts.ScriptKind.TS,
  cts: ts.ScriptKind.TS,
  tsx: ts.ScriptKind.TSX,
  js: ts.ScriptKind.JSX,
  jsx: ts.ScriptKind.JSX,
  mjs: ts.ScriptKind.JSX,
  cjs: ts.ScriptKind.JSX,
};
const ENVOLTORIOS_DE_COMPONENTE = new Set(["memo", "forwardRef", "lazy", "createContext"]);

const nombreDeComponente = (ruta: string): string =>
  (ruta.split("/").pop() ?? ruta).replace(/\.tsx$/, "");

type Atributos = readonly ts.JsxAttributeLike[];

function atributo(atributos: Atributos, nombre: string, fuente: ts.SourceFile) {
  return atributos.find(
    (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(fuente) === nombre,
  );
}

/** El literal de texto de un atributo JSX (`x="a"` o `x={"a"}`), o `undefined` si es dinámico. */
function literalDe(attr: ts.JsxAttribute | undefined): string | undefined {
  const valor = attr?.initializer;
  if (valor === undefined) return undefined;
  if (ts.isStringLiteral(valor)) return valor.text;
  if (ts.isJsxExpression(valor) && valor.expression !== undefined) {
    const e = valor.expression;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  }
  return undefined;
}

/** Todos los valores literales que puede tomar una expresión (literal, condición de literales, con paréntesis o `as const`); `undefined` si alguno no lo es. */
function literalesDe(e: ts.Expression): string[] | undefined {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e))
    return literalesDe(e.expression);
  if (ts.isConditionalExpression(e)) {
    const a = literalesDe(e.whenTrue);
    const b = literalesDe(e.whenFalse);
    return a === undefined || b === undefined ? undefined : [...a, ...b];
  }
  return undefined;
}

/** Los valores literales de un atributo JSX (`x="a"`, `x={"a"}`, `x={c ? "a" : "b"}`), o `undefined` si alguno es dinámico. */
function literalesDeAtributo(attr: ts.JsxAttribute): string[] | undefined {
  const valor = attr.initializer;
  if (valor === undefined) return undefined;
  if (ts.isStringLiteral(valor)) return [valor.text];
  return ts.isJsxExpression(valor) && valor.expression !== undefined
    ? literalesDe(valor.expression)
    : undefined;
}

const esDeTipos = (nodo: ts.Node): boolean => {
  for (let p: ts.Node | undefined = nodo.parent; p !== undefined; p = p.parent) {
    if (ts.isTypeNode(p) || ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p))
      return true;
  }
  return false;
};

/** Identificadores que son un componente declarado en el archivo (importado, función, clase o constante-función). */
function componentesDeclarados(fuente: ts.SourceFile): Set<string> {
  const declarados = new Set<string>();
  const mirar = (nodo: ts.Node): void => {
    if (ts.isImportClause(nodo) && !nodo.isTypeOnly && nodo.name !== undefined) {
      declarados.add(nodo.name.text);
    }
    if (ts.isImportSpecifier(nodo) && !nodo.isTypeOnly) declarados.add(nodo.name.text);
    if (ts.isNamespaceImport(nodo)) declarados.add(nodo.name.text);
    if (
      (ts.isFunctionDeclaration(nodo) || ts.isClassDeclaration(nodo)) &&
      nodo.name !== undefined
    ) {
      declarados.add(nodo.name.text);
    }
    if (ts.isVariableDeclaration(nodo) && ts.isIdentifier(nodo.name)) {
      const i = nodo.initializer;
      const envuelto =
        i !== undefined &&
        ts.isCallExpression(i) &&
        ((ts.isIdentifier(i.expression) && ENVOLTORIOS_DE_COMPONENTE.has(i.expression.text)) ||
          (ts.isPropertyAccessExpression(i.expression) &&
            ENVOLTORIOS_DE_COMPONENTE.has(i.expression.name.text)));
      if (i !== undefined && (ts.isArrowFunction(i) || ts.isFunctionExpression(i) || envuelto)) {
        declarados.add(nodo.name.text);
      }
    }
    ts.forEachChild(nodo, mirar);
  };
  mirar(fuente);
  return declarados;
}

const DOCUMENTO = /document(?!o)/i; // «documento» (el dato fiscal) no es el `document` del navegador
/** `X.write(...)`, `X.writeln(...)` y sus formas con corchetes, con cualquier receptor X que contenga `document` (`ownerDocument`, `frame.contentDocument`, …). */
function esEscrituraDeDocumento(nodo: ts.Node): boolean {
  const fuente = nodo.getSourceFile();
  if (ts.isPropertyAccessExpression(nodo)) {
    return /^write(ln)?$/.test(nodo.name.text) && DOCUMENTO.test(nodo.expression.getText(fuente));
  }
  if (ts.isElementAccessExpression(nodo) && ts.isStringLiteralLike(nodo.argumentExpression)) {
    return (
      /^write(ln)?$/.test(nodo.argumentExpression.text) &&
      DOCUMENTO.test(nodo.expression.getText(fuente))
    );
  }
  return false;
}

const SOLO_REACT = /^react$/;
/** Los nombres que en este archivo son React (`React`, el alias de un import o de un `require("react")`). */
function receptoresDeReact(fuente: ts.SourceFile): Set<string> {
  const nombres = new Set(["React"]);
  const mirar = (n: ts.Node): void => {
    if (
      ts.isImportDeclaration(n) &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      SOLO_REACT.test(n.moduleSpecifier.text)
    ) {
      const c = n.importClause;
      if (c?.name !== undefined) nombres.add(c.name.text);
      if (c?.namedBindings !== undefined && ts.isNamespaceImport(c.namedBindings))
        nombres.add(c.namedBindings.name.text);
    }
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer !== undefined &&
      ts.isCallExpression(n.initializer) &&
      n.initializer.expression.getText(fuente) === "require" &&
      n.initializer.arguments[0] !== undefined &&
      ts.isStringLiteralLike(n.initializer.arguments[0]) &&
      SOLO_REACT.test(n.initializer.arguments[0].text)
    )
      nombres.add(n.name.text);
    ts.forEachChild(n, mirar);
  };
  mirar(fuente);
  return nombres;
}

/** Problemas, deuda y usos de un archivo de aplicación (no de un componente de campo). */
export function analizarArchivo(
  ruta: string,
  texto: string,
  contexto: Contexto,
): ResultadoDeArchivo {
  const tipoDeArchivo = TIPOS_DE_SCRIPT[ruta.split(".").pop() ?? ""] ?? ts.ScriptKind.TSX;
  const fuente = ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true, tipoDeArchivo);
  const campos = new Set(contexto.componentes.map(nombreDeComponente));
  const declarados = componentesDeclarados(fuente);
  const reactNombres = receptoresDeReact(fuente);
  const problemas: string[] = [];
  // `parseDiagnostics` no es API pública: si desaparece (o hay un error de sintaxis) el archivo no se pudo analizar y se falla cerrado.
  const sintaxis = (fuente as unknown as { parseDiagnostics?: readonly unknown[] })
    .parseDiagnostics;
  if (sintaxis === undefined || sintaxis.length > 0) {
    problemas.push(
      `${ruta} tiene un error de sintaxis (o no se pudo leer): no se puede analizar y el chequeo falla cerrado`,
    );
  }
  const usos = new Map<string, number>();
  const crudosPorEtiqueta = new Map<string, number>();
  const sumarCrudo = (clave: string): void => {
    crudosPorEtiqueta.set(clave, (crudosPorEtiqueta.get(clave) ?? 0) + 1);
  };
  let pendientes = 0;
  let dinamicos = 0;
  const donde = (nodo: ts.Node): string =>
    `${ruta}:${fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente)).line + 1}`;

  const usoDeCampo = (nodo: ts.JsxOpeningLikeElement, etiqueta: string): void => {
    const lugar = `${donde(nodo)} <${etiqueta}>`;
    const atributos = nodo.attributes.properties;
    const dato = atributo(atributos, "dato", fuente);
    const literal = literalDe(dato);
    const despues =
      dato === undefined
        ? []
        : atributos.slice(atributos.indexOf(dato) + 1).filter(ts.isJsxSpreadAttribute);
    if (despues.length > 0) {
      problemas.push(`${lugar} usa {...props} después de dato: podría pisarlo`);
    } else if (dato === undefined) {
      problemas.push(`${lugar} no declara qué dato pide (falta la prop dato)`);
    } else if (literal === undefined) {
      problemas.push(`${lugar} declara su dato con una expresión: tiene que ser un literal`);
    } else if (literal === DATO_PENDIENTE) {
      pendientes += 1;
    } else {
      const definicion = contexto.registro[literal];
      if (definicion === undefined) {
        problemas.push(`${lugar} pide el dato «${literal}», que no está en el registro de datos`);
      } else if (!definicion.consumidores.includes(ruta)) {
        problemas.push(
          `${lugar} pide el dato «${literal}» pero ${ruta} no figura entre sus consumidores`,
        );
      } else {
        usos.set(literal, (usos.get(literal) ?? 0) + 1);
      }
    }
  };

  const usoDeControlCrudo = (nodo: ts.JsxOpeningLikeElement, etiqueta: string): void => {
    const atributos = nodo.attributes.properties;
    const oculto =
      etiqueta === "input" &&
      literalDe(atributo(atributos, "type", fuente)) === "hidden" &&
      literalDe(atributo(atributos, "name", fuente)) !== undefined &&
      !atributos.some(ts.isJsxSpreadAttribute);
    if (!oculto) sumarCrudo(etiqueta);
  };

  const mirar = (nodo: ts.Node): void => {
    if (ts.isJsxOpeningElement(nodo) || ts.isJsxSelfClosingElement(nodo)) {
      const tag = nodo.tagName;
      if (!ts.isIdentifier(tag)) {
        problemas.push(
          `${donde(nodo)} <${tag.getText(fuente)}> tiene un tag que no se puede analizar (compuesto o con espacio de nombres)`,
        );
      } else if (/^[a-z]/.test(tag.text)) {
        const minuscula = tag.text.toLowerCase();
        if (CONTROLES_CRUDOS.has(minuscula)) usoDeControlCrudo(nodo, minuscula);
        else if (!ETIQUETAS_PERMITIDAS.has(minuscula)) sumarCrudo("etiqueta-no-permitida");
      } else if (campos.has(tag.text)) {
        usoDeCampo(nodo, tag.text);
      } else if (!declarados.has(tag.text)) {
        dinamicos += 1;
      }
    }
    if (
      (ts.isIdentifier(nodo) ||
        ts.isStringLiteral(nodo) ||
        ts.isNoSubstitutionTemplateLiteral(nodo)) &&
      NOMBRES_PROHIBIDOS.has(nodo.text.toLowerCase())
    ) {
      sumarCrudo("nombre-prohibido");
    }
    if (ts.isJsxAttribute(nodo) && nodo.name.getText(fuente) === "role") {
      const valores = literalesDeAtributo(nodo);
      if (valores === undefined) sumarCrudo("role-dinamico");
      else if (valores.some((v) => v.split(/\s+/).includes("textbox"))) sumarCrudo("role-textbox");
    }
    if (
      ts.isCallExpression(nodo) &&
      ((ts.isPropertyAccessExpression(nodo.expression) &&
        /^setAttribute(NS)?$/.test(nodo.expression.name.text)) ||
        (ts.isElementAccessExpression(nodo.expression) &&
          ts.isStringLiteralLike(nodo.expression.argumentExpression) &&
          /^setAttribute(NS)?$/.test(nodo.expression.argumentExpression.text)))
    ) {
      const nombre = nodo.arguments[nodo.expression.getText(fuente).includes("NS") ? 1 : 0];
      if (
        nombre !== undefined &&
        ts.isStringLiteralLike(nombre) &&
        /^(role|contenteditable)$/i.test(nombre.text)
      )
        sumarCrudo("setAttribute");
    }
    if (
      ts.isStringLiteralLike(nodo) &&
      /react\/jsx(-dev)?-runtime/.test(nodo.text) &&
      !(ts.isImportDeclaration(nodo.parent) && nodo.parent.moduleSpecifier === nodo)
    ) {
      problemas.push(
        `${donde(nodo)} nombra el runtime de JSX: arma elementos sin pasar por el chequeo`,
      );
    }
    const esReact = (e: ts.Expression): boolean =>
      (ts.isIdentifier(e) && reactNombres.has(e.text)) || DOCUMENTO.test(e.getText(fuente));
    if (
      ts.isElementAccessExpression(nodo) &&
      esReact(nodo.expression) &&
      !ts.isStringLiteralLike(nodo.argumentExpression)
    ) {
      problemas.push(
        `${donde(nodo)} accede a React o a document con una clave calculada: no se puede saber qué arma`,
      );
    }
    if (
      ts.isCallExpression(nodo) &&
      /^Reflect\.(get|getOwnPropertyDescriptor)$/.test(nodo.expression.getText(fuente)) &&
      nodo.arguments[0] !== undefined &&
      esReact(nodo.arguments[0])
    ) {
      problemas.push(`${donde(nodo)} lee React o document con Reflect: no se puede saber qué arma`);
    }
    if (
      ts.isVariableDeclaration(nodo) &&
      ts.isObjectBindingPattern(nodo.name) &&
      nodo.initializer !== undefined &&
      esReact(nodo.initializer) &&
      nodo.name.elements.some(
        (e) => e.propertyName !== undefined && ts.isComputedPropertyName(e.propertyName),
      )
    ) {
      problemas.push(`${donde(nodo)} desestructura React o document con una clave calculada`);
    }
    if (esEscrituraDeDocumento(nodo)) sumarCrudo("document.write");
    if (
      ts.isImportSpecifier(nodo) &&
      nodo.propertyName !== undefined &&
      campos.has(nodo.propertyName.text)
    ) {
      problemas.push(
        `${donde(nodo)} importa ${nodo.propertyName.text} con otro nombre: el alias esconde el campo`,
      );
    }
    if (ts.isNamespaceImport(nodo)) {
      const modulo = nodo.parent.parent.moduleSpecifier;
      if (ts.isStringLiteral(modulo) && campos.has(nombreDeComponente(modulo.text))) {
        problemas.push(`${donde(nodo)} importa el componente de campo como espacio de nombres`);
      }
    }
    if (ts.isImportDeclaration(nodo) && ts.isStringLiteral(nodo.moduleSpecifier)) {
      if (/^react\/jsx(-dev)?-runtime$/.test(nodo.moduleSpecifier.text)) {
        problemas.push(
          `${donde(nodo)} importa el runtime de JSX: arma elementos sin pasar por el chequeo`,
        );
      }
    }
    if (ts.isIdentifier(nodo) && campos.has(nodo.text)) {
      const p = nodo.parent;
      const comoTag =
        (ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p)) &&
        p.tagName === nodo;
      const enImportSinAlias = ts.isImportSpecifier(p) && p.propertyName === undefined;
      const enImportPorDefecto = ts.isImportClause(p);
      if (!comoTag && !enImportSinAlias && !enImportPorDefecto && !esDeTipos(nodo)) {
        problemas.push(
          `${donde(nodo)} usa ${nodo.text} fuera de un tag JSX directo (alias o referencia): esconde el campo`,
        );
      }
    }
    ts.forEachChild(nodo, mirar);
  };
  mirar(fuente);
  const crudos = [...crudosPorEtiqueta.values()].reduce((a, b) => a + b, 0);
  return { problemas, pendientes, crudos, dinamicos, crudosPorEtiqueta, usos };
}

/** Las extensiones de `src/` (y de los paquetes que importa una app) que pueden armar un control: las de JSX y las de JavaScript. */
export const EXTENSIONES_FUERA_DE_LAS_APPS = ["tsx", "jsx", "js", "mjs", "cjs"] as const;

/**
 * Fuera de las aplicaciones no hay deuda: el código de `src/` (y de un paquete que una app importa) con JSX o JavaScript no puede
 * tener un campo sin dato, un control crudo ni un tag dinámico, ni una evasión. Previene: un `.tsx` en `src/` o en un paquete
 * compartido que pinta un `<input>` y queda fuera de lo que el chequeo mira (CLAUDE.md «Sin dato registrado no hay campo»).
 */
export function problemasFueraDeLasApps(
  archivos: ReadonlyMap<string, string>,
  contexto: Contexto,
): string[] {
  return [...archivos].flatMap(([ruta, texto]) => {
    const r = analizarArchivo(ruta, texto, contexto);
    const suma = r.pendientes + r.crudos + r.dinamicos;
    return [
      ...r.problemas,
      ...(suma > 0
        ? [`${ruta} tiene ${suma} campos o controles sin dato: fuera de las apps no hay deuda`]
        : []),
    ];
  });
}

/**
 * Los destinos de los imports relativos de un archivo que salen de su carpeta de base (`apps/web`, …), como rutas desde la raíz y sin
 * extensión resuelta. Sirve para encontrar los paquetes que una app importa por fuera de `apps/` y de `src/`.
 */
export function importadosFueraDe(ruta: string, texto: string, base: string): string[] {
  const fuente = ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true);
  const carpeta = ruta.split("/").slice(0, -1);
  const salida = new Set<string>();
  const mirar = (n: ts.Node): void => {
    const especificador =
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier !== undefined
        ? n.moduleSpecifier
        : ts.isCallExpression(n) &&
            (n.expression.kind === ts.SyntaxKind.ImportKeyword ||
              n.expression.getText(fuente) === "require")
          ? n.arguments[0]
          : undefined;
    if (
      especificador !== undefined &&
      ts.isStringLiteralLike(especificador) &&
      especificador.text.startsWith(".")
    ) {
      const partes: string[] = [...carpeta];
      for (const p of especificador.text.split("/")) {
        if (p === "..") partes.pop();
        else if (p !== "." && p !== "") partes.push(p);
      }
      const destino = partes.join("/");
      if (!destino.startsWith(`${base}/`)) salida.add(destino);
    }
    ts.forEachChild(n, mirar);
  };
  mirar(fuente);
  return [...salida].sort();
}
