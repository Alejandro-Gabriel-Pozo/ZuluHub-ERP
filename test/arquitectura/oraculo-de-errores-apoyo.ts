import ts from "typescript";

/**
 * Analizador de «todo código de error de ventas o fiscal figura en el oráculo o está declarado fuera de él» (CLAUDE.md «Todo nace cerrado»;
 * `Pedernal-docs/11-especificaciones/auditoria-de-reglas/oraculo-ticket-cobranza.md` §10 punto 3). Lee, en el código de producción de ventas y
 * de fiscal, cada llamada `err(...)` (la forma en que el sistema devuelve un error con nombre) y saca el código:
 *  - `err("CODIGO")`;
 *  - `err({ error: "CODIGO", … })` y `err({ codigo: "CODIGO", … })`;
 *  - `err(cond ? "A" : "B")`: cuenta los dos.
 * Reenviar un error ya tipado (`err(r.error)`, `err(error)`: un identificador o un acceso a propiedad) NO cuenta: el código nació donde se
 * escribió. Todo lo demás que no se puede leer (`err(codigo as ErrorDeVentas)`, una llamada, un objeto sin `error` ni `codigo`) cuenta como OPACO
 * por archivo: es deuda con presupuesto exacto (fail-closed: lo que no puede analizar, cuenta).
 * Previene: la regla sin clasificar que originó `documento_vigente_uk`: un error que el sistema devuelve y que ninguna celda del oráculo
 * describe es una regla que nadie clasificó.
 * LÍMITES conocidos (con ejemplo): un código que llega por una constante o variable (`const c = "X"; return err(c)`) se ve como reenvío y no
 * cuenta; un código escrito en una unión de tipos o en un mapa (`ERRORES_DE_VENTAS_POR_RESTRICCION`) sin llamar a `err` no se ve; los casos
 * de uso que no usan `err` (excepciones) no se ven. Es una alarma para errores honestos, no un límite de seguridad.
 */

export type CodigosDeUnArchivo = Readonly<{ codigos: readonly string[]; opacos: number }>;

const CLAVES_DE_CODIGO = new Set(["error", "codigo"]);

const textoDe = (nodo: ts.Node): string | null =>
  ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo) ? nodo.text : null;

/** Un reenvío: algo que ya es un error tipado y no se escribe acá (un identificador o `a.b.c`). */
const esReenvio = (nodo: ts.Node): boolean =>
  ts.isIdentifier(nodo) ||
  (ts.isPropertyAccessExpression(nodo) && esReenvio(nodo.expression)) ||
  ts.isNonNullExpression(nodo);

function leerArgumento(nodo: ts.Expression, codigos: string[], opaco: () => void): void {
  const texto = textoDe(nodo);
  if (texto !== null) {
    codigos.push(texto);
    return;
  }
  if (ts.isParenthesizedExpression(nodo)) {
    leerArgumento(nodo.expression, codigos, opaco);
    return;
  }
  if (ts.isConditionalExpression(nodo)) {
    leerArgumento(nodo.whenTrue, codigos, opaco);
    leerArgumento(nodo.whenFalse, codigos, opaco);
    return;
  }
  if (esReenvio(nodo)) return;
  if (ts.isObjectLiteralExpression(nodo)) {
    let hallado = false;
    for (const p of nodo.properties) {
      if (
        ts.isPropertyAssignment(p) &&
        ts.isIdentifier(p.name) &&
        CLAVES_DE_CODIGO.has(p.name.text)
      ) {
        hallado = true;
        leerArgumento(p.initializer, codigos, opaco);
      }
    }
    if (!hallado) opaco();
    return;
  }
  opaco();
}

/** Los códigos que un archivo devuelve con `err(...)` y cuántos `err(...)` no se pudieron leer. */
export function codigosDeError(ruta: string, texto: string): CodigosDeUnArchivo {
  const fuente = ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true);
  const codigos: string[] = [];
  let opacos = 0;
  const visitar = (nodo: ts.Node): void => {
    if (
      ts.isCallExpression(nodo) &&
      ts.isIdentifier(nodo.expression) &&
      nodo.expression.text === "err"
    ) {
      const argumento = nodo.arguments[0];
      if (argumento === undefined) opacos += 1;
      else leerArgumento(argumento, codigos, () => (opacos += 1));
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return { codigos, opacos };
}

/** ¿Es código de producción de ventas o de fiscal? (no pruebas, no declaraciones). */
export function esCodigoDeVentasOFiscal(ruta: string): boolean {
  return (
    /^src\/modulos\/(ventas|fiscal)\//.test(ruta) &&
    /\.(ts|tsx|mts|cts)$/.test(ruta) &&
    !/\.test\.(ts|tsx|mts|cts)$/.test(ruta) &&
    !ruta.endsWith(".d.ts")
  );
}

export type ResumenDeErrores = Readonly<{
  /** Cada código con los archivos donde se devuelve. */
  codigos: ReadonlyMap<string, readonly string[]>;
  /** Archivos con `err(...)` ilegibles y cuántos. */
  opacos: ReadonlyMap<string, number>;
}>;

/** Todo lo que el sistema de ventas y fiscal devuelve con `err(...)`, de un conjunto de archivos `ruta → texto`. */
export function resumirErrores(archivos: ReadonlyMap<string, string>): ResumenDeErrores {
  const codigos = new Map<string, string[]>();
  const opacos = new Map<string, number>();
  for (const [ruta, texto] of [...archivos].sort(([a], [b]) => a.localeCompare(b))) {
    if (!esCodigoDeVentasOFiscal(ruta)) continue;
    const leido = codigosDeError(ruta, texto);
    for (const c of leido.codigos) codigos.set(c, [...(codigos.get(c) ?? []), ruta]);
    if (leido.opacos > 0) opacos.set(ruta, leido.opacos);
  }
  return { codigos, opacos };
}

export type ListaFueraDelOraculo = Readonly<{
  grupos: readonly Readonly<{ motivo: string; codigos: readonly string[] }>[];
  /** Presupuesto exacto de `err(...)` ilegibles por archivo. */
  opacos: Readonly<Record<string, number>>;
}>;

export type FallaDeErrores = Readonly<{ tipo: string; detalle: string }>;

/**
 * Compara lo que el código devuelve con lo que declaran las celdas (`enCeldas`) y la lista de permitidos. Fallas: un código sin celda ni
 * permiso; un código declarado fuera que ya figura en una celda, que ya no existe en el código o que está repetido; un código de celda que el
 * código no devuelve (nombre mal escrito); un grupo sin motivo; `err(...)` ilegibles que no coinciden EXACTO con el presupuesto.
 * `nombresPendientes`: códigos de celdas que todavía no existen y que el tramo define (no se exige que el código los devuelva).
 */
export function fallasDeErrores(
  resumen: ResumenDeErrores,
  enCeldas: ReadonlySet<string>,
  lista: ListaFueraDelOraculo,
): readonly FallaDeErrores[] {
  const fallas: FallaDeErrores[] = [];
  const fuera = new Map<string, number>();
  for (const g of lista.grupos) {
    if (g.motivo.trim() === "")
      fallas.push({ tipo: "grupo sin motivo", detalle: g.codigos.join(", ") });
    for (const c of g.codigos) fuera.set(c, (fuera.get(c) ?? 0) + 1);
  }
  for (const c of [...resumen.codigos.keys()].sort()) {
    if (!enCeldas.has(c) && !fuera.has(c)) {
      fallas.push({
        tipo: "código sin celda ni permiso",
        detalle: `${c} (${(resumen.codigos.get(c) ?? []).join(", ")})`,
      });
    }
  }
  for (const [c, veces] of [...fuera].sort(([a], [b]) => a.localeCompare(b))) {
    if (veces > 1) fallas.push({ tipo: "código declarado fuera dos veces", detalle: c });
    if (enCeldas.has(c))
      fallas.push({ tipo: "código declarado fuera que ya tiene celda", detalle: c });
    if (!resumen.codigos.has(c))
      fallas.push({ tipo: "código declarado fuera que el código ya no devuelve", detalle: c });
  }
  for (const c of [...enCeldas].sort()) {
    if (!resumen.codigos.has(c))
      fallas.push({ tipo: "código de celda que el código no devuelve", detalle: c });
  }
  const archivos = new Set([...resumen.opacos.keys(), ...Object.keys(lista.opacos)]);
  for (const a of [...archivos].sort()) {
    const real = resumen.opacos.get(a) ?? 0;
    const declarado = lista.opacos[a] ?? 0;
    if (real !== declarado) {
      fallas.push({
        tipo: "err(...) ilegibles fuera del presupuesto",
        detalle: `${a}: hay ${real}, el presupuesto dice ${declarado}`,
      });
    }
  }
  return fallas;
}
