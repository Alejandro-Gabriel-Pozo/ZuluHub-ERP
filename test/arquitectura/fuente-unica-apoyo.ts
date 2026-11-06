import ts from "typescript";

/**
 * Analizador de «un mismo límite no se escribe en dos lugares» (CLAUDE.md «Una regla, un lugar»; regla 4 de
 * `Pedernal-docs/01-vision/primitivas-de-negocio.md`): el largo máximo de un dato vive una vez, en una constante exportada
 * `LARGO_MAXIMO_…`, y el resto la importa. Cuenta, por archivo, los topes de largo escritos dos veces:
 *  1. una constante `LARGO_MAXIMO_…` con el MISMO nombre y el MISMO valor que otra de otro archivo (la copia es la que no está en `src/`
 *     o, entre dos de `src/`, la de ruta posterior);
 *  2. un número escrito a mano, en un lugar de límite (`.max(N)`, `.min(N)`, `.length` comparado con N, una cantidad máxima `{m,N}` de
 *     una expresión regular), en un archivo que declara o usa una constante `LARGO_MAXIMO_…` de ese mismo valor: tenía la fuente a mano.
 * Previene: la auditoría de columnas halló 37 reglas escritas en dos lugares y 6 que ya no coincidían (caso real, 2026-11-05).
 *
 * LÍMITE conocido: un número igual a una constante pero en un archivo que no la nombra no se cuenta (sin vínculo semántico no se puede
 * saber si es el mismo dato); queda como Hallazgo. La copia en la base la comprueba el espejo de la base (trabajo aparte).
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

/** Los números escritos a mano en un lugar de límite de largo. */
function limitesEscritos(ruta: string, texto: string): number[] {
  const f = fuente(ruta, texto);
  const numeros: number[] = [];
  const ir = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      (n.expression.name.text === "max" || n.expression.name.text === "min") &&
      n.arguments.length === 1 &&
      ts.isNumericLiteral(n.arguments[0] as ts.Expression)
    ) {
      numeros.push(Number((n.arguments[0] as ts.NumericLiteral).text));
    } else if (ts.isBinaryExpression(n) && OPERADORES.has(n.operatorToken.kind)) {
      for (const [a, b] of [
        [n.left, n.right],
        [n.right, n.left],
      ] as const)
        if (ts.isPropertyAccessExpression(a) && a.name.text === "length" && ts.isNumericLiteral(b))
          numeros.push(Number(b.text));
    } else if (ts.isRegularExpressionLiteral(n)) {
      for (const m of n.text.matchAll(/\{(?:\d+,)?(\d+)\}/g)) numeros.push(Number(m[1]));
    }
    ts.forEachChild(n, ir);
  };
  ir(f);
  return numeros;
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

/** Cuántos topes de largo escritos dos veces tiene cada archivo (solo los que tienen alguno). */
export function duplicadosPorArchivo(archivos: ReadonlyMap<string, string>): Map<string, number> {
  const rutas = [...archivos.keys()].sort();
  const todas = rutas.flatMap((r) => constantesDeLargo(r, archivos.get(r) ?? ""));
  const cuenta = new Map<string, number>();
  const sumar = (ruta: string) => cuenta.set(ruta, (cuenta.get(ruta) ?? 0) + 1);

  // 1. misma constante (nombre y valor) en dos archivos: la dueña es la de `src/` (o la primera por ruta)
  const grupos = new Map<string, Constante[]>();
  for (const c of todas)
    grupos.set(`${c.nombre}=${c.valor}`, [...(grupos.get(`${c.nombre}=${c.valor}`) ?? []), c]);
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    const duena = grupo.find((c) => c.ruta.startsWith("src/")) ?? grupo[0];
    for (const c of grupo) if (c !== duena) sumar(c.ruta);
  }

  // 2. un número a mano igual a una constante de largo que el archivo declara o nombra
  for (const ruta of rutas) {
    const texto = archivos.get(ruta) ?? "";
    const nombres = nombresUsados(ruta, texto);
    const valores = new Set(todas.filter((c) => nombres.has(c.nombre)).map((c) => c.valor));
    if (valores.size === 0) continue;
    for (const n of limitesEscritos(ruta, texto)) if (valores.has(n)) sumar(ruta);
  }
  return cuenta;
}
