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

/** Los números escritos a mano en un lugar de límite de largo, con su línea (0-based). */
function limitesEscritos(ruta: string, texto: string): { valor: number; linea: number }[] {
  const f = fuente(ruta, texto);
  const numeros: { valor: number; linea: number }[] = [];
  const sumar = (e: ts.Expression | undefined) => {
    const valor = numero(e);
    if (e !== undefined && valor !== undefined)
      numeros.push({ valor, linea: f.getLineAndCharacterOfPosition(e.getStart(f)).line });
  };
  const ir = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const metodo = n.expression.name.text;
      if (["max", "min", "length"].includes(metodo) && n.arguments.length === 1)
        sumar(n.arguments[0]);
      if (["slice", "substring", "substr"].includes(metodo) && n.arguments.length === 2)
        sumar(n.arguments[1]);
    } else if (ts.isBinaryExpression(n) && OPERADORES.has(n.operatorToken.kind)) {
      for (const [a, b] of [
        [n.left, n.right],
        [n.right, n.left],
      ] as const)
        if (ts.isPropertyAccessExpression(a) && a.name.text === "length") sumar(b);
    } else if (ts.isRegularExpressionLiteral(n)) {
      for (const m of n.text.matchAll(/\{(?:\d+,)?(\d+)\}/g))
        numeros.push({
          valor: Number(m[1]),
          linea: f.getLineAndCharacterOfPosition(n.getStart(f)).line,
        });
    } else if (
      ts.isJsxAttribute(n) &&
      n.name.getText(f) === "maxLength" &&
      n.initializer !== undefined &&
      ts.isJsxExpression(n.initializer)
    ) {
      sumar(n.initializer.expression);
    } else if (
      ts.isPropertyAssignment(n) &&
      (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) &&
      n.name.text === "maxLength"
    ) {
      sumar(n.initializer);
    }
    ts.forEachChild(n, ir);
  };
  ir(f);
  return numeros;
}

/** Las constantes de límite (por su nombre, exportadas o no) con valor numérico literal declaradas en el nivel superior de un archivo. */
function constantesDeLimite(ruta: string, texto: string): (Constante & { linea: number })[] {
  const salida: (Constante & { linea: number })[] = [];
  const f = fuente(ruta, texto);
  for (const s of f.statements) {
    if (!ts.isVariableStatement(s)) continue;
    for (const d of s.declarationList.declarations) {
      const valor = numero(d.initializer);
      if (ts.isIdentifier(d.name) && valor !== undefined && /LARGO|LONGITUD/i.test(d.name.text))
        salida.push({
          nombre: d.name.text,
          valor,
          ruta,
          linea: f.getLineAndCharacterOfPosition(d.getStart(f)).line,
        });
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

/**
 * Marca de «valor ajeno»: `// fuente-unica: ajeno — <motivo>` en la línea del número o en la anterior declara que un número coincide
 * por casualidad con el límite de una primitiva y es otro dato. El motivo es obligatorio (mínimo `LARGO_MINIMO_DEL_MOTIVO` caracteres).
 * Previene: falsos positivos por coincidencia numérica que empujan a registrar deuda falsa en archivos ajenos (caso real: el 32 del
 * cupón contra el secreto, la clave de rol y un UUID). Una marca sin motivo es un error (`marcasInvalidas`), no una excepción gratis.
 */
const LARGO_MINIMO_DEL_MOTIVO = 15;
const MARCA = /\/\/\s*fuente-unica:\s*ajeno\b(?:\s*[—-]\s*(.*))?$/;

/** Las líneas (0-based) con marca y su motivo. */
function marcasDe(texto: string): { linea: number; motivo: string }[] {
  const salida: { linea: number; motivo: string }[] = [];
  texto.split("\n").forEach((l, linea) => {
    const m = MARCA.exec(l);
    if (m) salida.push({ linea, motivo: (m[1] ?? "").trim() });
  });
  return salida;
}

/** Las líneas cubiertas por una marca válida: la suya y la siguiente. */
function lineasMarcadas(texto: string): Set<number> {
  const cubiertas = new Set<number>();
  for (const m of marcasDe(texto))
    if (m.motivo.length >= LARGO_MINIMO_DEL_MOTIVO) {
      cubiertas.add(m.linea);
      cubiertas.add(m.linea + 1);
    }
  return cubiertas;
}

/** Las marcas de «valor ajeno» sin motivo (o con uno demasiado corto): `ruta:línea`. */
export function marcasInvalidas(archivos: ReadonlyMap<string, string>): string[] {
  return [...archivos].flatMap(([ruta, texto]) =>
    marcasDe(texto)
      .filter((m) => m.motivo.length < LARGO_MINIMO_DEL_MOTIVO)
      .map((m) => `${ruta}:${m.linea + 1}`),
  );
}

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
    const ajenas = lineasMarcadas(archivos.get(ruta) ?? "");
    for (const c of constantesDeLimite(ruta, archivos.get(ruta) ?? ""))
      if (
        delasPrimitivas.has(c.valor) &&
        !yaContadas.has(`${ruta}:${c.nombre}`) &&
        !ajenas.has(c.linea)
      )
        sumar(ruta);
  }

  // 2. un número a mano igual al de una primitiva, o al de una constante de largo que el archivo declara o nombra
  for (const ruta of rutas) {
    const texto = archivos.get(ruta) ?? "";
    const nombres = nombresUsados(ruta, texto);
    const valores = new Set([
      ...delasPrimitivas,
      ...todas.filter((c) => nombres.has(c.nombre)).map((c) => c.valor),
    ]);
    const ajenas = lineasMarcadas(texto);
    for (const n of limitesEscritos(ruta, texto))
      if (valores.has(n.valor) && !ajenas.has(n.linea)) sumar(ruta);
  }
  return cuenta;
}

/**
 * LÍMITES DE DIVIDIR LA CUENTA (dueño, 14/11/2026: 10 por ítems, 12 por porcentaje; fuente única `src/primitivas/cuentas/limites-de-division.ts`).
 * Cuenta, fuera de esa primitiva, cada lugar que vuelve a escribir esos topes (`ruta:línea`):
 *  1. una constante `MAXIMO_DE_CUENTAS_…` o `MAXIMO_DE_PARTES_…` declarada de nuevo (el mismo límite con el mismo nombre, con cualquier valor);
 *  2. el número de una de las dos constantes escrito a mano en una comparación (`<`, `<=`, `>`, `>=`, `===`, `!==`) o en un `.max(N)`/`.min(N)`/`.lte(N)`/`.lt(N)`
 *     contra algo cuyo nombre diga parte o cuenta (`partes > 10`, `cuentas.length <= 12`, `partes: z.number().max(12)`).
 * Previene: el tope que se desfasa entre el dominio, la pantalla y la base (caso real: 4 y 6 salieron de maquetas y estaban escritos en dos archivos).
 * LÍMITES que NO ve (con ejemplo): un número de otra forma (`Array.from({ length: 12 })`, `partes: 12`), uno calculado (`6 * 2`), un nombre que no diga parte ni cuenta
 * (`n > 10`), y la copia en la base (la comprueba `test/integracion/salon-division-limites.test.ts`).
 */
export const RUTA_DE_LOS_LIMITES_DE_DIVISION = "src/primitivas/cuentas/limites-de-division.ts";
const NOMBRES_DE_LIMITES_DE_DIVISION = [
  "MAXIMO_DE_CUENTAS_POR_ITEMS",
  "MAXIMO_DE_PARTES_POR_PORCENTAJE",
];
const NOMBRE_DE_PARTES_O_CUENTAS = /parte|cuenta/i;
const METODOS_DE_TOPE = new Set(["max", "min", "lte", "lt", "gte", "gt"]);

/** Los valores de las dos constantes, leídos de su archivo (vacío si el archivo o una constante falta: la prueba real lo exige). */
export function valoresDeLosLimitesDeDivision(archivos: ReadonlyMap<string, string>): number[] {
  const texto = archivos.get(RUTA_DE_LOS_LIMITES_DE_DIVISION);
  if (texto === undefined) return [];
  const valores: number[] = [];
  for (const s of fuente(RUTA_DE_LOS_LIMITES_DE_DIVISION, texto).statements) {
    if (!ts.isVariableStatement(s) || !esExportada(s)) continue;
    for (const d of s.declarationList.declarations) {
      const valor = numero(d.initializer);
      if (
        ts.isIdentifier(d.name) &&
        NOMBRES_DE_LIMITES_DE_DIVISION.includes(d.name.text) &&
        valor !== undefined
      )
        valores.push(valor);
    }
  }
  return valores;
}

export function topesDeDivisionEscritos(archivos: ReadonlyMap<string, string>): string[] {
  const valores = new Set(valoresDeLosLimitesDeDivision(archivos));
  const halladas: string[] = [];
  for (const [ruta, texto] of archivos) {
    if (ruta === RUTA_DE_LOS_LIMITES_DE_DIVISION) continue;
    const f = fuente(ruta, texto);
    const ajenas = lineasMarcadas(texto);
    const anotar = (n: ts.Node) => {
      const linea = f.getLineAndCharacterOfPosition(n.getStart(f)).line;
      if (!ajenas.has(linea)) halladas.push(`${ruta}:${linea + 1}`);
    };
    const nombreDeLoComparado = (e: ts.Node): string => e.getText(f);
    const ir = (n: ts.Node, contexto: string): void => {
      let siguiente = contexto;
      if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)))
        siguiente = n.name.text;
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
        if (/^MAXIMO_DE_(CUENTAS|PARTES)_/.test(n.name.text)) anotar(n);
        siguiente = n.name.text;
      }
      if (ts.isBinaryExpression(n) && OPERADORES.has(n.operatorToken.kind)) {
        for (const [a, b] of [
          [n.left, n.right],
          [n.right, n.left],
        ] as const) {
          const valor = numero(a);
          if (
            valor !== undefined &&
            valores.has(valor) &&
            NOMBRE_DE_PARTES_O_CUENTAS.test(nombreDeLoComparado(b))
          )
            anotar(a);
        }
      }
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        METODOS_DE_TOPE.has(n.expression.name.text) &&
        n.arguments.length === 1
      ) {
        const valor = numero(n.arguments[0]);
        if (
          valor !== undefined &&
          valores.has(valor) &&
          NOMBRE_DE_PARTES_O_CUENTAS.test(`${contexto} ${n.expression.expression.getText(f)}`)
        )
          anotar(n.arguments[0] as ts.Expression);
      }
      ts.forEachChild(n, (h) => ir(h, siguiente));
    };
    ir(f, "");
  }
  return halladas.sort();
}
