import ts from "typescript";

/**
 * Analizador de «la validación de un dato declara lo que se PERMITE, nunca lo que se prohíbe» (CLAUDE.md «Todo nace cerrado»;
 * regla 4 de `Pedernal-docs/01-vision/primitivas-de-negocio.md`). Cuenta, por archivo, las validaciones por LISTA DE PROHIBIDOS: una
 * condición que describe lo que NO se quiere (controles, invisibles, `<`/`>`, «todo menos esto») y decide si un texto vale. Lo que
 * nadie pensó en prohibir pasa. Fail-closed: lo que no se puede analizar CUENTA como prohibición desconocida.
 * Previene: `/\p{Cc}/u` en `datos-fiscales.ts` solo rechazaba controles y dejaba pasar invisibles y `<>` (caso real).
 *
 * Qué describe una prohibición (`esPatronDeProhibicion`, sobre el patrón de una expresión regular o de un CHECK de SQL):
 *  - categorías no imprimibles o de separadores: `\p{C…}`, `\p{Z…}`;
 *  - controles e invisibles escritos con escape (`\x00`–`\x1f`, `\x7f`–`\x9f`, `\u00ad`, `\u200b`–`\u200f`, `\u2028`–`\u202e`,
 *    `\u2060`–`\u2064`, `\ufeff`) o con el carácter mismo;
 *  - `\S` (todo menos espacios) y una clase que lista `<` o `>`;
 *  - una clase NEGADA que lista cualquier cosa fuera de letras, dígitos, `.`, `_` y `-` («cualquier cosa menos esto»: `[^,;]`, `[^\r\n]`).
 * En SQL, además, cualquier escape `\u`/`\U` (una lista de caracteres no ASCII).
 *
 * Qué NO cuenta: una expresión regular que solo se usa para REEMPLAZAR, separar o normalizar (`replace`, `replaceAll`, `split`), el
 * recorte de espacios (`^\s|\s$`) y la lista de lo permitido (`^[A-Za-z0-9 ]{1,40}$`, `!~ '^[0-9]{11}$'`).
 *
 * Formas que cuentan además de la expresión regular literal:
 *  - `new RegExp(…)`, `RegExp(…)` y `globalThis.RegExp(…)`: se lee el texto fijo (cadena, plantilla o suma de cadenas); la lista de
 *    permitidos armada con constantes (`^[${PERMITIDOS}]+$`) tiene texto fijo sin prohibición y no cuenta; una construcción SIN texto fijo
 *    (`new RegExp(variable)`) no se puede analizar y cuenta;
 *  - un alias de `RegExp` (`const R = RegExp`, `[RegExp]`, `f(RegExp)`, `globalThis.RegExp` sin llamar) cuenta: esconde la construcción;
 *  - `.includes/.indexOf/.lastIndexOf/.startsWith/.endsWith` contra `<`, `>`, un control o un invisible; `x === "<"`/`">"`; y
 *    `.charCodeAt/.codePointAt` comparado con un número de control, de invisible, `<` o `>`;
 *  - en SQL: cada `!~`, `!~*`, `NOT (x ~ …)`, `NOT LIKE`, `NOT ILIKE` y `NOT SIMILAR TO` cuyo patrón (cadenas unidas con `||`) describe una
 *    prohibición; si el patrón es una cadena `E'…'`, una expresión o no se puede leer, cuenta (fail-closed); los `NOT LIKE/ILIKE/SIMILAR TO`
 *    cuentan siempre.
 * LÍMITES conocidos: esto es una ALARMA para errores honestos, NO un límite de seguridad (quien quiere esquivarlo, lo esquiva). Este párrafo es
 * el ÚNICO lugar donde se listan (CLAUDE.md lo cita). No ve: una prohibición armada solo con constantes de otro archivo; `x.constructor(…)` y
 * `Function(…)` (el analizador de campos sí cuenta `Function`); `\s` solo y `<` fuera de una clase; `split`/`replace`/`Set`/`switch` contra `<` o
 * un control; comparaciones de texto (`c < " "`); códigos de carácter que llegan por una variable; tablas de búsqueda; en SQL, `position`/
 * `strpos`/`translate`/`regexp_like`, `!~* '^\s'` (el recorte de espacios está eximido a propósito), funciones anidadas dos niveles
 * (`NOT (lower(btrim(a)) ~ …)`), funciones con una cadena como argumento (`coalesce(a, '')`, `replace(…)`, `regexp_replace(…)`) y `NOT (a)::text ~ …`;
 * `\p{…}` con propiedades que no están en la lista, y un nombre de función armado con texto. Cerradas por ser baratas: categorías con nombre
 * largo (`\p{General_Category=…}`, `\p{gc=…}`, `\p{White_Space}`), `\p{Default_Ignorable_Code_Point}`, escapes `\u{…}`, `\x3c`/`\u003c` (`<` escapado),
 * `\W`, escapes cortos de control dentro de una clase, `globalThis["RegExp"]`, `globalThis[clave]` (también `global`, `window`, `self` y con
 * conversión de tipo), `Reflect.get(globalThis, …)`, `NOT a ~ '…'` sin paréntesis y con una función (`NOT (lower(a) ~ '…')`, `NOT btrim(a) ~ '…'`)
 * y `"nombre"(` entre comillas.
 * No se miran los archivos de prueba (`*.test.*` y `test/`): usan estas expresiones como ejemplos. Las migraciones `reversiones/` SÍ se
 * leen (solo traen `DROP`, que no cuenta).
 */

const CATEGORIAS =
  /\\[pP]\{(?:[CZ][A-Za-z_]*|(?:General_Category|gc)\s*=[^}]*|Control|Format|Surrogate|Private_Use|Unassigned|Other|Separator|Space_Separator|Line_Separator|Paragraph_Separator|White_Space|space|Default_Ignorable_Code_Point|DI|Variation_Selector|Join_Control|Noncharacter_Code_Point)\}/;
/** Controles escritos con un escape corto dentro de una clase: `[\r\n\t]`, `[\0-\37]`, `[\cA-\cZ]`, y los escapes `\u{…}`. */
const ESCAPES_CORTOS = /\[[^\]]*\\(?:[rntfv0]|c[A-Za-z]|[0-3][0-7])|\\u\{/;
const CONTROLES =
  /\\x(?:3[cCeE]|[01][0-9a-fA-F]|7[fF]|[89][0-9a-fA-F])|\\u(?:00(?:3[cCeE]|[01][0-9a-fA-F]|7[fF]|[89][0-9a-fA-F]|[aA][dD])|200[b-fB-F]|202[89a-eA-E]|206[0-4]|[fF][eE][fF][fF])/;
const INVISIBLES_LITERALES = /[\u0080-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/;
const CLASE_CON_MARCADO = /\[[^\]]*[<>]/;
const TODO_MENOS_ESPACIOS = /\\[SW]/;
const CLASE_NEGADA = /\[\^((?:\\.|[^\]\\])*)\]/g;
/** Lo que una clase negada puede listar sin ser una prohibición: letras, dígitos, `. _ -` y el ASCII visible `!-~` (el reverso de una lista de permitidos). */
const MIEMBROS_DE_PERMITIDOS = /!-~|[A-Za-z0-9]-[A-Za-z0-9]|\\d|\\w|\\\.|\\-|[A-Za-z0-9._-]/g;

function listaNegadaAbierta(patron: string): boolean {
  for (const m of patron.matchAll(CLASE_NEGADA)) {
    if ((m[1] ?? "").replace(MIEMBROS_DE_PERMITIDOS, "") !== "") return true;
  }
  return false;
}

/** ¿El patrón (texto entre las barras de una expresión regular, o el de un CHECK de SQL) describe lo que se prohíbe? */
export function esPatronDeProhibicion(bruto: string): boolean {
  // `[\s\S]` («cualquier carácter») y el rango abierto `\u0080-\uffff` («todo lo no ASCII», típico de los identificadores) no prohíben nada.
  const patron = bruto
    .replace(/\[\\s\\S\]|\[\\S\\s\]/g, ".")
    .replace(/\\u0080-(?:\\uffff|\uffff)/gi, "");
  return (
    CATEGORIAS.test(patron) ||
    ESCAPES_CORTOS.test(patron) ||
    CONTROLES.test(patron) ||
    INVISIBLES_LITERALES.test(patron) ||
    TODO_MENOS_ESPACIOS.test(patron) ||
    CLASE_CON_MARCADO.test(patron) ||
    listaNegadaAbierta(patron)
  );
}

const SOLO_REEMPLAZA = new Set(["replace", "replaceAll", "split"]);
const BUSQUEDAS = new Set(["includes", "indexOf", "lastIndexOf", "startsWith", "endsWith"]);
const CODIGOS = new Set(["charCodeAt", "codePointAt"]);
/** Códigos de control, invisibles, `<` y `>` (decimal). */
const CODIGOS_PROHIBIDOS = (n: number): boolean =>
  n < 32 ||
  (n >= 127 && n <= 159) ||
  n === 173 ||
  (n >= 0x200b && n <= 0x200f) ||
  (n >= 0x2028 && n <= 0x202e) ||
  (n >= 0x2060 && n <= 0x2064) ||
  n === 0xfeff ||
  n === 60 ||
  n === 62;

/** Los números con los que se acota por comparación una zona de controles o invisibles. */
const BORDES_DE_ZONAS = new Set([
  31, 32, 33, 126, 127, 128, 159, 160, 0x200a, 0x200b, 0x200f, 0x2028, 0x202e, 0xfeff,
]);

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
  // `String.raw\`…\`` (y cualquier plantilla etiquetada): el texto CRUDO, que es el que llega a la expresión regular (`\p{Cc}` y no su cocción)
  if (ts.isTaggedTemplateExpression(n)) return textoCrudo(n.template);
  return "";
}

/** El texto fijo de una plantilla tal como está escrito (sin interpretar las barras invertidas). */
function textoCrudo(n: ts.TemplateLiteral): string {
  if (ts.isNoSubstitutionTemplateLiteral(n)) return n.rawText ?? n.text;
  return [
    n.head.rawText ?? n.head.text,
    ...n.templateSpans.map((s) => s.literal.rawText ?? s.literal.text),
  ].join("");
}

/** La expresión sin paréntesis ni conversiones de tipo (`(globalThis as unknown as Record<string, unknown>)` es `globalThis`). */
function sinEnvoltorios(e: ts.Expression): ts.Expression {
  let actual = e;
  while (
    ts.isParenthesizedExpression(actual) ||
    ts.isAsExpression(actual) ||
    ts.isTypeAssertionExpression(actual) ||
    ts.isNonNullExpression(actual) ||
    ts.isSatisfiesExpression(actual)
  )
    actual = actual.expression;
  return actual;
}

/** ¿Es el objeto global (`globalThis`, `global`, `window`, `self`), con o sin conversión de tipo? */
const esGlobal = (e: ts.Expression): boolean => {
  const limpia = sinEnvoltorios(e);
  return ts.isIdentifier(limpia) && /^(?:globalThis|global|window|self)$/.test(limpia.text);
};

const esRegExp = (e: ts.Expression): boolean =>
  (ts.isIdentifier(e) && e.text === "RegExp") ||
  (ts.isPropertyAccessExpression(e) && e.name.text === "RegExp");

const esDeTipos = (n: ts.Node): boolean => {
  for (let p: ts.Node | undefined = n.parent; p !== undefined; p = p.parent) {
    if (ts.isTypeNode(p) || ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p))
      return true;
  }
  return false;
};

/** ¿Una cadena literal es `<`, `>` o contiene un control o un invisible? */
const literalProhibido = (texto: string): boolean =>
  texto === "<" ||
  texto === ">" ||
  INVISIBLES_LITERALES.test(texto) ||
  [...texto].some((c) => (c.codePointAt(0) ?? 255) < 32 || c === "\u007f");

const numeroDe = (e: ts.Expression): number | undefined => {
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (ts.isParenthesizedExpression(e)) return numeroDe(e.expression);
  return undefined;
};

/** Cuántas validaciones por lista de prohibidos tiene un archivo de código (`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`). */
export function contarProhibidosEnCodigo(ruta: string, texto: string): number {
  const f = ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true);
  let cuenta = 0;
  const ir = (n: ts.Node): void => {
    if (ts.isRegularExpressionLiteral(n)) {
      const cuerpo = n.text.slice(1, n.text.lastIndexOf("/"));
      if (esPatronDeProhibicion(cuerpo) && !soloReemplaza(f, n)) cuenta += 1;
    } else if ((ts.isNewExpression(n) || ts.isCallExpression(n)) && esRegExp(n.expression)) {
      if (!soloReemplaza(f, n)) {
        const primero = n.arguments?.[0];
        const fijo = primero === undefined ? "" : textoFijo(primero);
        if (fijo === "" || esPatronDeProhibicion(fijo)) cuenta += 1;
      }
    } else if (
      ts.isElementAccessExpression(n) &&
      ((ts.isStringLiteralLike(n.argumentExpression) && n.argumentExpression.text === "RegExp") ||
        (!ts.isStringLiteralLike(n.argumentExpression) && esGlobal(n.expression)))
    ) {
      cuenta += 1; // globalThis["RegExp"] o globalThis[clave]: esconde la construcción
    } else if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "get" &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === "Reflect" &&
      n.arguments[0] !== undefined &&
      esGlobal(n.arguments[0]) &&
      !(
        n.arguments[1] !== undefined &&
        ts.isStringLiteralLike(n.arguments[1]) &&
        n.arguments[1].text !== "RegExp"
      )
    ) {
      cuenta += 1; // Reflect.get(globalThis, "RegExp") o Reflect.get(globalThis, clave): esconde la construcción
    } else if (ts.isIdentifier(n) && n.text === "RegExp") {
      const p = n.parent;
      const comoLlamada = (ts.isNewExpression(p) || ts.isCallExpression(p)) && p.expression === n;
      const accesoLlamado =
        ts.isPropertyAccessExpression(p) &&
        p.name === n &&
        (ts.isNewExpression(p.parent) || ts.isCallExpression(p.parent)) &&
        p.parent.expression === p;
      const enInstanceof =
        ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword;
      if (!comoLlamada && !accesoLlamado && !enInstanceof && !esDeTipos(n)) cuenta += 1;
    } else if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      BUSQUEDAS.has(n.expression.name.text)
    ) {
      const a = n.arguments[0];
      // con una posición (`indexOf("\n", i)`) es un recorrido, no una validación
      if (
        n.arguments.length === 1 &&
        a !== undefined &&
        (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))
      ) {
        if (literalProhibido(a.text)) cuenta += 1;
      }
    } else if (ts.isBinaryExpression(n)) {
      const igualdad = [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
      ].includes(n.operatorToken.kind);
      const esCaracter = (e: ts.Expression) =>
        ts.isStringLiteral(e) && (e.text === "<" || e.text === ">");
      if (igualdad && (esCaracter(n.left) || esCaracter(n.right))) cuenta += 1;
      const comparacion =
        igualdad ||
        [
          ts.SyntaxKind.LessThanToken,
          ts.SyntaxKind.LessThanEqualsToken,
          ts.SyntaxKind.GreaterThanToken,
          ts.SyntaxKind.GreaterThanEqualsToken,
        ].includes(n.operatorToken.kind);
      const llamaCodigo = (e: ts.Expression) =>
        ts.isCallExpression(e) &&
        ts.isPropertyAccessExpression(e.expression) &&
        CODIGOS.has(e.expression.name.text);
      for (const [a, b] of [
        [n.left, n.right],
        [n.right, n.left],
      ] as const) {
        const valor = numeroDe(b);
        if (comparacion && llamaCodigo(a) && valor !== undefined) {
          // con < <= > >= el límite es el borde de una zona (32 = fin de los controles, 127 = DEL, 160 = fin de los C1)
          const relacional = !igualdad;
          if (relacional ? BORDES_DE_ZONAS.has(valor) : CODIGOS_PROHIBIDOS(valor)) cuenta += 1;
        }
      }
    }
    ts.forEachChild(n, ir);
  };
  ir(f);
  return cuenta;
}

const OPERADOR_SQL =
  /!~\*?|\bNOT\s+(?:I?LIKE|SIMILAR\s+TO)\b|\bNOT\s*\(\s*(?:[^()~']|\([^()']*\))*?\s~\*?(?=\s)|\bNOT\s+[\w."]+(?:\([^()']*\))?(?:\s*::\s*\w+)?\s+~\*?(?=\s)/gi;
const CADENA_SQL = /(E?)'((?:[^']|'')*)'/gi;

/** El operando (cadenas unidas con `||`, entre paréntesis o suelto) que sigue a la posición `desde`, o `""` si no se puede leer. */
function operandoSql(texto: string, desde: number): string {
  let i = desde;
  while (/\s/.test(texto[i] ?? "")) i += 1;
  if (texto[i] === "(") {
    let profundidad = 0;
    let cadena = false;
    for (let j = i; j < texto.length; j += 1) {
      const c = texto[j];
      if (c === "'") cadena = !cadena;
      else if (!cadena && c === "(") profundidad += 1;
      else if (!cadena && c === ")") {
        profundidad -= 1;
        if (profundidad === 0) return texto.slice(i, j + 1);
      }
    }
    return "";
  }
  const cadenas = /^E?'(?:[^']|'')*'(?:\s*\|\|\s*E?'(?:[^']|'')*')*/i.exec(texto.slice(i));
  return cadenas?.[0] ?? "";
}

/**
 * Las funciones SQL que heredan una lista de prohibidos (su definición ya cuenta): cada USO en un CHECK o una función es una validación por
 * prohibidos más. `texto_visible_valido` y `texto_fiscal_valido` (migraciones 0007 y 0009); una función nueva con prohibidos se suma acá.
 */
export const FUNCIONES_SQL_CON_PROHIBIDOS = [
  "texto_visible_valido",
  "texto_fiscal_valido",
] as const;

/** Cuántos usos (no definiciones ni bajas) de esas funciones tiene un SQL. */
function usosDeFuncionesConProhibidos(sinComentarios: string): number {
  let usos = 0;
  for (const nombre of FUNCIONES_SQL_CON_PROHIBIDOS) {
    for (const m of sinComentarios.matchAll(new RegExp(`\\b"?${nombre}"?\\s*\\(`, "gi"))) {
      const antes = sinComentarios.slice(Math.max(0, (m.index ?? 0) - 40), m.index);
      if (
        !/\b(?:CREATE(?:\s+OR\s+REPLACE)?|DROP|ALTER|COMMENT\s+ON)\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?"?$/i.test(
          antes,
        )
      )
        usos += 1;
    }
  }
  return usos;
}

/** Cuántas condiciones SQL por negación de un patrón describen una prohibición, más los usos de las funciones que las heredan. */
export function contarProhibidosEnSql(texto: string): number {
  const sinComentarios = texto.replace(/--[^\n]*/g, "");
  let cuenta = usosDeFuncionesConProhibidos(sinComentarios);
  for (const m of sinComentarios.matchAll(OPERADOR_SQL)) {
    const operador = m[0];
    const fin = (m.index ?? 0) + operador.length;
    if (/^NOT\s+(?:I?LIKE|SIMILAR)/i.test(operador)) {
      cuenta += 1;
      continue;
    }
    const operando = operandoSql(sinComentarios, fin);
    const cadenas = [...operando.matchAll(CADENA_SQL)];
    if (cadenas.length === 0 || cadenas.some((c) => (c[1] ?? "") !== "")) {
      cuenta += 1;
      continue;
    }
    const patron = cadenas.map((c) => (c[2] ?? "").replaceAll("''", "'")).join("");
    // en SQL cualquier lista de caracteres no ASCII (escapada o escrita) es una prohibición
    const noAscii = [...patron].some((c) => (c.codePointAt(0) ?? 0) > 127);
    if (esPatronDeProhibicion(patron) || /\\[uU][0-9a-fA-F]/.test(patron) || noAscii) cuenta += 1;
  }
  return cuenta;
}

export type Exencion = Readonly<{ motivo: string; prohibidos: number }>;

/**
 * Problemas de las exenciones por «formato de máquinas de un tercero»: la lista de archivos eximidos es EXACTA (agregar uno obliga a
 * tocar la prueba), cada uno tiene motivo y su cuenta de prohibiciones es EXACTA (una prohibición nueva en un archivo eximido obliga a
 * tocar la prueba, no queda ciega), y ninguno figura también en el presupuesto de deuda.
 */
export function problemasDeExenciones(
  exenciones: Readonly<Record<string, Exencion>>,
  esperadas: readonly string[],
  cuentaReal: (ruta: string) => number,
  presupuesto: Readonly<Record<string, unknown>>,
): string[] {
  const problemas: string[] = [];
  const rutas = Object.keys(exenciones).sort();
  if (JSON.stringify(rutas) !== JSON.stringify([...esperadas].sort())) {
    problemas.push(
      `las exenciones son ${rutas.join(", ")} y tienen que ser exactamente ${esperadas.join(", ")}`,
    );
  }
  for (const ruta of rutas) {
    const e = exenciones[ruta] as Exencion;
    if (e.motivo.trim() === "") problemas.push(`${ruta}: la exención no tiene motivo`);
    const real = cuentaReal(ruta);
    if (real !== e.prohibidos)
      problemas.push(`${ruta}: tiene ${real} prohibiciones y la exención declara ${e.prohibidos}`);
    if (ruta in presupuesto)
      problemas.push(`${ruta}: está eximido y también en el presupuesto de deuda`);
  }
  return problemas;
}
