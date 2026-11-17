import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * REGLA: una prueba de integración que trabaja con jornadas o fechas de negocio (menciona `fechaLocal`, `fechaCivil`, `fechaDeNegocio` o `jornada`) no mira el
 * reloj real en cada llamada (`new Date()` sin argumentos, `Date.now()`): arma su «ahora» con `ahoraDeLaCorrida()` (test/integracion/reloj-de-la-corrida.ts) o
 * con un instante fijo. Previene: «la jornada que se creó y ya no se encuentra»: el reloj cruzó la medianoche de Buenos Aires (03:00 UTC) entre dos llamadas y la
 * segunda buscó la fecha de negocio del día siguiente (caso real: `desactivar-sucursal-concurrencia.test.ts`, «expected null to be 'CERRADA'», gate del
 * 15/11/2026). Los usos que sobreviven (no son un corte de día: expiraciones, vencimientos, cursores) están en una lista EXACTA con motivo y cuenta exacta:
 * crecer es editar esta prueba. Cada forma está inyectada abajo.
 *
 * LÍMITES que NO ve (alarma para errores honestos): un reloj real alcanzado por un alias (`const D = Date; D.now()`) o por una función propia, un archivo que no
 * menciona esas palabras pero igual cruza un corte, y las pruebas fuera de `test/integracion/`.
 */
const RAIZ = join(import.meta.dirname, "../..");
const CARPETA = join(RAIZ, "test/integracion");
const MENCIONA_JORNADA = /fechaLocal|fechaCivil|fechaDeNegocio|jornada/;

export type UsoDelRelojReal = Readonly<{ uso: string; linea: number }>;

/** Los usos del reloj real en el texto de un archivo: `new Date()` o `new Date` sin argumentos, y `Date.now()`. */
export function usosDelRelojReal(ruta: string, texto: string): UsoDelRelojReal[] {
  const fuente = ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hallados: UsoDelRelojReal[] = [];
  const linea = (n: ts.Node) => fuente.getLineAndCharacterOfPosition(n.getStart(fuente)).line + 1;
  const visitar = (n: ts.Node): void => {
    if (
      ts.isNewExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "Date" &&
      (n.arguments === undefined || n.arguments.length === 0)
    ) {
      hallados.push({ uso: "new Date()", linea: linea(n) });
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === "Date" &&
      n.expression.name.text === "now"
    ) {
      hallados.push({ uso: "Date.now()", linea: linea(n) });
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return hallados;
}

const PERMITIDOS: Readonly<Record<string, Readonly<{ usos: number; motivo: string }>>> = {
  "reloj-de-la-corrida.ts": {
    usos: 2,
    motivo:
      "ES el reloj de la corrida: lee el reloj real una vez para decidir el desplazamiento y en cada llamada para avanzar como el real.",
  },
  "caja-operacion-apoyo.ts": {
    usos: 1,
    motivo:
      "`AHORA_DE_LA_CORRIDA`: se toma UNA vez por archivo; todas las fechas «de mañana» salen de ese instante fijo.",
  },
  "plataforma-sql.test.ts": {
    usos: 1,
    motivo:
      "Segundos de época para la expiración de un token de prueba; no es un corte de jornada.",
  },
  "facturacion-persistencia-apoyo.ts": {
    usos: 1,
    motivo: "Vencimiento de un certificado de prueba a un año; no es un corte de jornada.",
  },
  "caja-cierre-del-dia-consultas.test.ts": {
    usos: 1,
    motivo:
      "Un cursor `registradoEn` de la paginación pedido «ahora»; no decide ninguna fecha de negocio.",
  },
  "catalogo.test.ts": {
    usos: 1,
    motivo: "Expiración de un token de prueba a 300 s; no es un corte de jornada.",
  },
};

function archivos(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    return /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

describe("reloj de jornada: las pruebas que usan jornadas no leen el reloj real en cada llamada", () => {
  it("solo quedan los usos permitidos, con su cuenta exacta", () => {
    const porArchivo = new Map<string, UsoDelRelojReal[]>();
    for (const ruta of archivos(CARPETA)) {
      const texto = readFileSync(ruta, "utf8");
      if (!MENCIONA_JORNADA.test(texto)) continue;
      const usos = usosDelRelojReal(ruta, texto);
      if (usos.length > 0) porArchivo.set(relative(CARPETA, ruta), usos);
    }
    const sobran = [...porArchivo.entries()]
      .map(([archivo, usos]) => ({
        archivo,
        usos: usos.length > (PERMITIDOS[archivo]?.usos ?? 0) ? usos : [],
      }))
      .filter((x) => x.usos.length > 0);
    expect(
      sobran,
      "usos del reloj real en una prueba de jornadas (usá `ahoraDeLaCorrida()` de test/integracion/reloj-de-la-corrida.ts o un instante fijo)",
    ).toEqual([]);
    // Y la lista no se pudre: cada permitido sigue teniendo exactamente su cuenta.
    for (const [archivo, { usos }] of Object.entries(PERMITIDOS)) {
      expect(porArchivo.get(archivo)?.length ?? 0, `${archivo}: la cuenta permitida`).toBe(usos);
    }
  });
});

describe("reloj de jornada: cada forma prohibida está inyectada (si se debilita el analizador, esta prueba falla)", () => {
  const usos = (texto: string) => usosDelRelojReal("x.test.ts", texto).map((u) => u.uso);

  it("detecta new Date() sin argumentos, con y sin paréntesis", () => {
    expect(usos("const a = new Date();")).toEqual(["new Date()"]);
    expect(usos("const a = new Date;")).toEqual(["new Date()"]);
    expect(usos("const f = () => ({ ahora: new Date() });")).toEqual(["new Date()"]);
  });

  it("detecta Date.now()", () => {
    expect(usos("const t = Date.now();")).toEqual(["Date.now()"]);
    expect(usos("const t = Math.floor(Date.now() / 1000);")).toEqual(["Date.now()"]);
  });

  it("no marca un instante fijo, new Date con argumento ni lo que se arma desde otro instante", () => {
    expect(usos('const a = new Date("2026-11-15T12:00:00Z");')).toEqual([]);
    expect(usos("const b = new Date(otro.getTime() + 1000);")).toEqual([]);
    expect(usos("const c = Date.UTC(2026, 10, 15);")).toEqual([]);
    expect(usos("const d = Date.parse(texto);")).toEqual([]);
  });

  it("dice la línea del uso", () => {
    expect(usosDelRelojReal("x.ts", "\n\nconst a = new Date();")).toEqual([
      { uso: "new Date()", linea: 3 },
    ]);
  });
});
