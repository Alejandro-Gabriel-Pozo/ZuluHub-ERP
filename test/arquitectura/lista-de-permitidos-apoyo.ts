import ts from "typescript";

/**
 * Analizador de «la validación de un dato declara lo que se PERMITE, nunca lo que se prohíbe» (CLAUDE.md «Todo nace cerrado»;
 * regla 4 de `Pedernal-docs/01-vision/primitivas-de-negocio.md`). Cuenta, por archivo, las validaciones por LISTA DE PROHIBIDOS: una
 * expresión regular que describe lo que NO se quiere (controles, invisibles, `<`/`>`, «todo menos esto») y se usa para decidir si un
 * texto vale. Lo que nadie pensó en prohibir pasa.
 * Previene: `/\p{Cc}/u` en `datos-fiscales.ts` solo rechazaba controles y dejaba pasar invisibles y `<>` (caso real).
 *
 * Qué cuenta como prohibición (el patrón de la expresión regular, dicho solo en términos de lo que es):
 *  - categorías de caracteres no imprimibles: `\p{C…}`, `\p{Zl}`, `\p{Zp}`;
 *  - rangos de controles escritos a mano: `\x00`–`\x1f`, `\x7f`, `\u0000`–`\u001f`, `\u007f`;
 *  - una clase que lista `<` o `>` (marcado);
 *  - una clase NEGADA que lista espacio (`\s`), `<`, `>`, `@` o comillas: «cualquier cosa menos esto».
 * No cuenta una expresión regular que solo se usa para REEMPLAZAR, separar o normalizar (`replace`, `replaceAll`, `split`): eso
 * no decide si un dato vale. Una clase negada solo de letras y dígitos (`[^a-z0-9]`) es la lista de permitidos escrita al revés.
 *
 * `new RegExp(…)` se lee por sus partes de texto fijas (cadena, plantilla o suma de cadenas): la lista de permitidos armada a partir de
 * constantes (`^${PERMITIDOS}+$`) es la forma correcta y no cuenta. LÍMITE conocido: una prohibición armada solo con constantes de otro
 * archivo no se ve acá (Hallazgo aparte, no se cierra con esta regla).
 */

const CATEGORIAS = /\\p\{(?:C|Z[lp])/;
const CONTROLES = /\\x(?:0[0-9a-fA-F]|1[0-9a-fA-F]|7[fF])|\\u(?:00[01][0-9a-fA-F]|007[fF])/;
const CLASE_CON_MARCADO = /\[[^\]]*[<>]/;
const CLASE_NEGADA_ABIERTA = /\[\^[^\]]*(?:\\s|[<>@"])/;

/** ¿El patrón (texto entre las barras) describe lo que se prohíbe? */
export function esPatronDeProhibicion(patron: string): boolean {
  return (
    CATEGORIAS.test(patron) ||
    CONTROLES.test(patron) ||
    CLASE_CON_MARCADO.test(patron) ||
    CLASE_NEGADA_ABIERTA.test(patron)
  );
}

const SOLO_REEMPLAZA = new Set(["replace", "replaceAll", "split"]);

/** Cómo se usa un nodo (la expresión regular o el nombre de la constante que la guarda): ¿solo para reemplazar o separar? */
function soloReemplaza(f: ts.SourceFile, nodo: ts.Node): boolean {
  const p = nodo.parent;
  if (ts.isCallExpression(p) && p.arguments.includes(nodo as ts.Expression)) {
    return (
      ts.isPropertyAccessExpression(p.expression) && SOLO_REEMPLAZA.has(p.expression.name.text)
    );
  }
  if (ts.isVariableDeclaration(p) && p.initializer === nodo && ts.isIdentifier(p.name)) {
    const nombre = p.name.text;
    const usos: boolean[] = [];
    const mirar = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && n.text === nombre && n !== p.name) usos.push(soloReemplaza(f, n));
      ts.forEachChild(n, mirar);
    };
    mirar(f);
    // una constante que nadie usa en el archivo (se exporta) puede usarse para validar: no se la exime
    return usos.length > 0 && usos.every(Boolean);
  }
  return false;
}

/** Las partes de texto fijas de una cadena, plantilla o suma de cadenas (lo variable queda afuera). */
function textoFijo(n: ts.Node): string {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n))
    return [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join("");
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken)
    return textoFijo(n.left) + textoFijo(n.right);
  if (ts.isParenthesizedExpression(n)) return textoFijo(n.expression);
  return "";
}

/** Cuántas validaciones por lista de prohibidos tiene un archivo de código (`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`). */
export function contarProhibidosEnCodigo(ruta: string, texto: string): number {
  const f = ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true);
  let cuenta = 0;
  const ir = (n: ts.Node): void => {
    if (ts.isRegularExpressionLiteral(n)) {
      const cuerpo = n.text.slice(1, n.text.lastIndexOf("/"));
      if (esPatronDeProhibicion(cuerpo) && !soloReemplaza(f, n)) cuenta += 1;
    } else if (
      ts.isNewExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "RegExp" &&
      !soloReemplaza(f, n)
    ) {
      const primero = n.arguments?.[0];
      if (primero !== undefined && esPatronDeProhibicion(textoFijo(primero))) cuenta += 1;
    }
    ts.forEachChild(n, ir);
  };
  ir(f);
  return cuenta;
}

/** Cuántos controles de «no coincide con una lista de caracteres de control» tiene un archivo SQL: `x !~ '[\x01-\x1F…]'`. */
export function contarProhibidosEnSql(texto: string): number {
  return (texto.match(/!~\s*'[^']*\\x[0-9A-Fa-f]{2}[^']*'/g) ?? []).length;
}
