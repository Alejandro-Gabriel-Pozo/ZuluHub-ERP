import ts from "typescript";

/**
 * Analizador de «un mismo límite no se escribe en dos lugares» (CLAUDE.md «Una regla, un lugar»; regla 4 de
 * `Pedernal-docs/01-vision/primitivas-de-negocio.md`): el largo máximo de un dato vive una vez, en una constante exportada
 * `LARGO_MAXIMO_…`, y el resto la importa. Cuenta, por archivo, los topes de largo escritos dos veces:
 *  1. una constante `LARGO_MAXIMO_…` con el MISMO nombre y el MISMO valor que otra de otro archivo (la copia es la que no está en `src/`
 *     o, entre dos de `src/`, la de ruta posterior);
 *  2. un número escrito a mano en un lugar de límite (`.max(N)`, `.min(N)`, `.length(N)`, `.slice(0, N)`, `.substring(0, N)`, `maxLength={N}`
 *     o `maxLength: N`, `.length` comparado con N, una cantidad máxima `{m,N}` de una expresión regular) cuyo valor es el de una constante
 *     `LARGO_MAXIMO_…` de una PRIMITIVA (`src/primitivas/**`, la dueña del largo de un dato) en cualquier archivo, o el de una constante
 *     `LARGO_MAXIMO_…` que el archivo declara o nombra: tenía la fuente a mano o es de un dato con dueña;
 *  3. una constante de límite (nombre con LARGO o LONGITUD; exportada o privada, con cualquier nombre) cuyo valor es el
 *     de una constante de largo de una primitiva, fuera de esa primitiva: el mismo límite con otro nombre (caso real:
 *     `LARGO_MAXIMO_DEL_CORREO = 254` en `formulario.ts` y `LARGO_MAXIMO_DEL_EMAIL_DE_CONTACTO = 254` en `email.ts`).
 * Previene: la auditoría de columnas halló 37 reglas escritas en dos lugares y 6 que ya no coincidían (caso real, 2026-11-05).
 *
 * LÍMITES conocidos (con ejemplo, ver la regla en CLAUDE.md): el número de una constante que NO es de una primitiva escrito en un archivo
 * que no la nombra (`motivo.length > 200`) no se ve, porque sin vínculo semántico no se sabe si es el mismo dato; una lista de caracteres
 * permitidos repetida en dos archivos no se compara; un número que sale de un cálculo (`2 * 150`) no se lee. Un número de una primitiva
 * puede ser coincidencia con otro dato: entra a la deuda y se paga importando la constante o se documenta. La copia en la base la
 * comprueba el espejo de la base (trabajo aparte).
 */

type Constante = { nombre: string; valor: number; ruta: string };

const esExportada = (s: ts.VariableStatement) =>
  s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;

const fuente = (ruta: string, texto: string) =>
  ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true);

/** Las constantes exportadas `LARGO_MAXIMO_…` con valor numérico literal de un archivo. */
export function constantesDeLargo(ruta: string, texto: string): Constante[] {
  const salida: Constante[] = [];
  for (const s of fuente(ruta, texto).statements) {
    if (!ts.isVariableStatement(s) || !esExportada(s)) continue;
    for (const d of s.declarationList.declarations) {
      if (
        ts.isIdentifier(d.name) &&
        /^LARGO_MAXIMO_/.test(d.name.text) &&
        d.initializer !== undefined &&
        ts.isNumericLiteral(d.initializer)
      )
        salida.push({ nombre: d.name.text, valor: Number(d.initializer.text), ruta });
    }
  }
  return salida;
}

const OPERADORES = new Set([
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

const numero = (e: ts.Expression | undefined): number | undefined =>
  e !== undefined && ts.isNumericLiteral(e) ? Number(e.text) : undefined;

/** Los números escritos a mano en un lugar de límite de largo. */
function limitesEscritos(ruta: string, texto: string): number[] {
  const f = fuente(ruta, texto);
  const numeros: number[] = [];
  const sumar = (n: number | undefined) => {
    if (n !== undefined) numeros.push(n);
  };
  const ir = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const metodo = n.expression.name.text;
      if (["max", "min", "length"].includes(metodo) && n.arguments.length === 1)
        sumar(numero(n.arguments[0]));
      if (["slice", "substring", "substr"].includes(metodo) && n.arguments.length === 2)
        sumar(numero(n.arguments[1]));
    } else if (ts.isBinaryExpression(n) && OPERADORES.has(n.operatorToken.kind)) {
      for (const [a, b] of [
        [n.left, n.right],
        [n.right, n.left],
      ] as const)
        if (ts.isPropertyAccessExpression(a) && a.name.text === "length") sumar(numero(b));
    } else if (ts.isRegularExpressionLiteral(n)) {
      for (const m of n.text.matchAll(/\{(?:\d+,)?(\d+)\}/g)) sumar(Number(m[1]));
    } else if (
      ts.isJsxAttribute(n) &&
      n.name.getText(f) === "maxLength" &&
      n.initializer !== undefined &&
      ts.isJsxExpression(n.initializer)
    ) {
      sumar(numero(n.initializer.expression));
    } else if (
      ts.isPropertyAssignment(n) &&
      (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) &&
      n.name.text === "maxLength"
    ) {
      sumar(numero(n.initializer));
    }
    ts.forEachChild(n, ir);
  };
  ir(f);
  return numeros;
}

/** Las constantes de límite (por su nombre, exportadas o no) con valor numérico literal declaradas en el nivel superior de un archivo. */
function constantesDeLimite(ruta: string, texto: string): Constante[] {
  const salida: Constante[] = [];
  for (const s of fuente(ruta, texto).statements) {
    if (!ts.isVariableStatement(s)) continue;
    for (const d of s.declarationList.declarations) {
      const valor = numero(d.initializer);
      if (ts.isIdentifier(d.name) && valor !== undefined && /LARGO|LONGITUD/i.test(d.name.text))
        salida.push({ nombre: d.name.text, valor, ruta });
    }
  }
  return salida;
}

/** Los nombres que un archivo escribe (declaraciones, importaciones y usos): para saber si «tiene la fuente a mano». */
function nombresUsados(ruta: string, texto: string): Set<string> {
  const nombres = new Set<string>();
  const ir = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) nombres.add(n.text);
    ts.forEachChild(n, ir);
  };
  ir(fuente(ruta, texto));
  return nombres;
}

const esPrimitiva = (ruta: string) => ruta.startsWith("src/primitivas/");

/** Cuántos topes de largo escritos dos veces tiene cada archivo (solo los que tienen alguno). */
export function duplicadosPorArchivo(archivos: ReadonlyMap<string, string>): Map<string, number> {
  const rutas = [...archivos.keys()].sort();
  const todas = rutas.flatMap((r) => constantesDeLargo(r, archivos.get(r) ?? ""));
  const delasPrimitivas = new Set(todas.filter((c) => esPrimitiva(c.ruta)).map((c) => c.valor));
  const cuenta = new Map<string, number>();
  const sumar = (ruta: string) => cuenta.set(ruta, (cuenta.get(ruta) ?? 0) + 1);
  const yaContadas = new Set<string>();

  // 1. misma constante (nombre y valor) en dos archivos: la dueña es la de `src/primitivas/`, si no la de `src/`, si no la primera
  const grupos = new Map<string, Constante[]>();
  for (const c of todas)
    grupos.set(`${c.nombre}=${c.valor}`, [...(grupos.get(`${c.nombre}=${c.valor}`) ?? []), c]);
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    const duena =
      grupo.find((c) => esPrimitiva(c.ruta)) ??
      grupo.find((c) => c.ruta.startsWith("src/")) ??
      grupo[0];
    for (const c of grupo)
      if (c !== duena) {
        sumar(c.ruta);
        yaContadas.add(`${c.ruta}:${c.nombre}`);
      }
  }

  // 3. el mismo límite que una primitiva, con otro nombre o privado, fuera de la primitiva
  for (const ruta of rutas) {
    if (esPrimitiva(ruta)) continue;
    for (const c of constantesDeLimite(ruta, archivos.get(ruta) ?? ""))
      if (delasPrimitivas.has(c.valor) && !yaContadas.has(`${ruta}:${c.nombre}`)) sumar(ruta);
  }

  // 2. un número a mano igual al de una primitiva, o al de una constante de largo que el archivo declara o nombra
  for (const ruta of rutas) {
    const texto = archivos.get(ruta) ?? "";
    const nombres = nombresUsados(ruta, texto);
    const valores = new Set([
      ...delasPrimitivas,
      ...todas.filter((c) => nombres.has(c.nombre)).map((c) => c.valor),
    ]);
    for (const n of limitesEscritos(ruta, texto)) if (valores.has(n)) sumar(ruta);
  }
  return cuenta;
}
