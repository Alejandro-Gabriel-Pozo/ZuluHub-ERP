import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * REGLA: el puerto «cobrar» de caja (`CajaParaVentas`: `estadoDeCajasParaCobrar`, `opcionesDeCobro`, `registrarCobroEnTx` y
 * `cobrosPorOrigen`) corre en la transacción de ventas y NO autoriza (el permiso es el de la acción de ventas, `tickets.cobrar`): por eso
 * el cliente nunca lo llama directo. Dos cosas lo garantizan y esta prueba las vigila:
 *  1. ningún archivo de `apps/` (acciones de servidor, rutas, páginas) nombra el puerto ni sus funciones: ni un identificador, ni un
 *     import, ni una reexportación, ni un acceso por texto (`caja["registrarCobroEnTx"]`);
 *  2. ningún archivo de `src/` lleva la directiva `"use server"`: todo lo que exporta un archivo así es una acción invocable desde el
 *     navegador, y el puerto vive en `src/modulos/caja`.
 * Lo mismo vale para los puertos de venta de stock (E5-T7: `ConsumoDeStock`, `ReversionDeStock`, `DepositoDeVenta`, `ArticulosDeVenta`,
 * `ExistenciaParaMostrar` y `EntradaPorOrigen`): corren en la transacción de ventas o de compras, no tienen acción propia y no pasan por el
 * guard de stock; llamarlos desde una acción de servidor descontaría, devolvería o mostraría stock sin permiso.
 * Previene: un cobro sin guard. Quien llamara a `registrarCobroEnTx` desde una acción de servidor dejaría cobrar a cualquiera que pueda
 * invocar esa acción, sin permiso de ventas, sin ticket y sin que el módulo `ventas` lo valide. La ventas (E4) lo usa desde su caso de uso,
 * con su propio guard, y la composición lo cablea sin exponerlo.
 * Cada forma está inyectada abajo: si se debilita el analizador o el recorrido, la prueba falla.
 */

const RAIZ = join(import.meta.dirname, "../..");

/** Lo que no se puede nombrar desde una app: el puerto y sus cuatro funciones (la fuente es `src/modulos/caja/cobrar/contrato.ts`). */
const NOMBRES_DEL_PUERTO: ReadonlySet<string> = new Set([
  "CajaParaVentas",
  "cajaParaVentas",
  "estadoDeCajasParaCobrar",
  "opcionesDeCobro",
  "registrarCobroEnTx",
  "cobrosPorOrigen",
  // Los puertos de venta de stock (fuente: `src/modulos/stock/puertos.ts`). `registrarEntrada` solo, sin `PorOrigen`, es el caso de uso de las pantallas: no va.
  "PuertosDeStock",
  "crearPuertosDeStock",
  "ConsumoDeStock",
  "crearConsumoDeStock",
  "registrarSalidaPorVentaEnTx",
  "ReversionDeStock",
  "crearReversionDeStock",
  "revertirPorOrigen",
  "DepositoDeVenta",
  "crearDepositoDeVenta",
  "ArticulosDeVenta",
  "crearArticulosDeVenta",
  "ExistenciaParaMostrar",
  "crearExistenciaParaMostrar",
  "EntradaPorOrigen",
  "crearEntradaPorOrigen",
]);

const fuenteDe = (nombre: string, texto: string): ts.SourceFile =>
  ts.createSourceFile(nombre, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Cada lugar de un archivo que nombra al puerto: identificadores y textos (los comentarios no cuentan: no ejecutan nada). */
function usosDelPuerto(nombre: string, texto: string): string[] {
  const fuente = fuenteDe(nombre, texto);
  const usos: string[] = [];
  const mirar = (nodo: ts.Node): void => {
    const nombrado =
      ts.isIdentifier(nodo) || ts.isStringLiteralLike(nodo) || ts.isPrivateIdentifier(nodo)
        ? nodo.text
        : null;
    if (nombrado !== null && NOMBRES_DEL_PUERTO.has(nombrado)) {
      const linea = fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente)).line + 1;
      usos.push(`${nombre}:${linea} nombra «${nombrado}»`);
    }
    ts.forEachChild(nodo, mirar);
  };
  mirar(fuente);
  return usos;
}

/** `"use server"` como directiva de MÓDULO (la primera sentencia): todo lo que el archivo exporta es una acción invocable desde el cliente. */
function esModuloDeAcciones(nombre: string, texto: string): boolean {
  for (const sentencia of fuenteDe(nombre, texto).statements) {
    if (!ts.isExpressionStatement(sentencia) || !ts.isStringLiteral(sentencia.expression)) {
      return false;
    }
    if (sentencia.expression.text === "use server") return true;
  }
  return false;
}

function archivosDe(carpeta: string): string[] {
  const archivos: string[] = [];
  const recorrer = (actual: string): void => {
    for (const entrada of readdirSync(actual, { withFileTypes: true })) {
      if (["node_modules", ".next", "test-results", "playwright-report"].includes(entrada.name)) {
        continue;
      }
      const completa = join(actual, entrada.name);
      if (entrada.isDirectory()) recorrer(completa);
      else if (/\.(ts|tsx)$/.test(entrada.name) && !entrada.name.endsWith(".d.ts")) {
        archivos.push(completa);
      }
    }
  };
  recorrer(carpeta);
  return archivos;
}

/** Problemas de un conjunto de archivos dado como `{ ruta: texto }`: la parte pura de la regla. */
function problemasDeExposicion(archivos: Readonly<Record<string, string>>): string[] {
  const problemas: string[] = [];
  for (const [ruta, texto] of Object.entries(archivos)) {
    if (ruta.startsWith("apps/")) problemas.push(...usosDelPuerto(ruta, texto));
    if (ruta.startsWith("src/") && esModuloDeAcciones(ruta, texto)) {
      problemas.push(`${ruta} lleva "use server": todo lo que exporta es una acción de servidor`);
    }
  }
  return problemas;
}

describe("el puerto «cobrar» de caja no es una acción de servidor ni una ruta", () => {
  it("el repositorio real lo cumple, y la prueba recorre archivos de las dos carpetas", () => {
    const archivos: Record<string, string> = {};
    for (const carpeta of ["apps", "src"]) {
      for (const ruta of archivosDe(join(RAIZ, carpeta))) {
        archivos[relative(RAIZ, ruta)] = readFileSync(ruta, "utf8");
      }
    }
    expect(Object.keys(archivos).filter((r) => r.startsWith("apps/")).length).toBeGreaterThan(50);
    expect(Object.keys(archivos).filter((r) => r.startsWith("src/")).length).toBeGreaterThan(500);
    // Hay acciones de servidor reales en apps (la prueba las ve) y el puerto existe en caja (no es una búsqueda vacía).
    expect(Object.values(archivos).some((t) => t.includes('"use server"'))).toBe(true);
    expect(archivos["src/modulos/caja/cobrar/caja-para-ventas.ts"]).toContain("registrarCobroEnTx");
    expect(problemasDeExposicion(archivos)).toEqual([]);
  });

  it("detecta una acción de servidor que cobra: el import, la llamada y el nombre", () => {
    const problemas = problemasDeExposicion({
      "apps/web/servidor/acciones-de-cobro.ts": [
        '"use server";',
        'import { cajaParaVentas } from "../../../src/modulos/caja/publico";',
        "export async function cobrar(tx: never, c: never, e: never) {",
        "  return cajaParaVentas.registrarCobroEnTx(tx, c, e);",
        "}",
      ].join("\n"),
    });
    expect(problemas).toEqual([
      "apps/web/servidor/acciones-de-cobro.ts:2 nombra «cajaParaVentas»",
      "apps/web/servidor/acciones-de-cobro.ts:4 nombra «cajaParaVentas»",
      "apps/web/servidor/acciones-de-cobro.ts:4 nombra «registrarCobroEnTx»",
    ]);
  });

  it("detecta los puertos de venta de stock: una acción de servidor que descuenta, una ruta que revierte y un tipo", () => {
    expect(
      problemasDeExposicion({
        "apps/web/servidor/descontar.ts": [
          '"use server";',
          'import { crearConsumoDeStock } from "../../../src/modulos/stock/publico";',
          "export const descontar = crearConsumoDeStock;",
        ].join("\n"),
      }),
    ).toEqual([
      "apps/web/servidor/descontar.ts:2 nombra «crearConsumoDeStock»",
      "apps/web/servidor/descontar.ts:3 nombra «crearConsumoDeStock»",
    ]);
    expect(
      problemasDeExposicion({
        "apps/web/app/api/revertir/route.ts":
          'export { revertirPorOrigen as POST } from "../../../../../src/modulos/stock/publico";',
        "apps/plataforma/servidor/x.ts":
          'import type { EntradaPorOrigen } from "../../../src/modulos/stock/publico";\nexport type T = EntradaPorOrigen;',
      }),
    ).toHaveLength(3);
    // Lo que sí es de las pantallas de stock no se confunde con el puerto: los casos de uso y las consultas.
    expect(
      problemasDeExposicion({
        "apps/web/servidor/stock.ts":
          "export const a = (c: { registrarEntrada: unknown; existencias: unknown; transferir: unknown }) => [c.registrarEntrada, c.existencias, c.transferir];",
      }),
    ).toEqual([]);
  });

  it("detecta una ruta que lo reexporta con otro nombre, con alias y por texto", () => {
    expect(
      problemasDeExposicion({
        "apps/web/app/api/cobrar/route.ts":
          'export { registrarCobroEnTx as POST } from "../../../../../src/modulos/caja/publico";',
      }),
    ).toHaveLength(1);
    expect(
      problemasDeExposicion({
        "apps/web/app/s/app/page.tsx":
          'import { estadoDeCajasParaCobrar as estado } from "../../../../../src/modulos/caja/publico";\nexport default estado;',
      }),
    ).toHaveLength(1);
    expect(
      problemasDeExposicion({
        "apps/web/servidor/x.ts": 'export const f = (caja: object) => caja["opcionesDeCobro"];',
      }),
    ).toHaveLength(1);
    expect(
      problemasDeExposicion({
        "apps/plataforma/servidor/x.ts":
          'import type { CajaParaVentas } from "../../../src/modulos/caja/publico";\nexport type T = CajaParaVentas;',
      }),
    ).toHaveLength(2);
    expect(
      problemasDeExposicion({
        "apps/web/servidor/y.ts":
          "export const g = (c: { cobrosPorOrigen: unknown }) => c.cobrosPorOrigen;",
      }).length,
    ).toBeGreaterThan(0);
  });

  it('detecta un archivo de src/ con "use server": lo que exporta sería una acción invocable desde el navegador', () => {
    expect(
      problemasDeExposicion({
        "src/modulos/caja/cobrar/cobrar-desde-el-cliente.ts":
          '"use server";\nexport async function cobrar() { return 1; }\n',
      }),
    ).toEqual([
      'src/modulos/caja/cobrar/cobrar-desde-el-cliente.ts lleva "use server": todo lo que exporta es una acción de servidor',
    ]);
    // La directiva no es la primera sentencia: no es de módulo (es una función suelta, otra regla), y un texto que la menciona no cuenta.
    expect(
      problemasDeExposicion({
        "src/a.ts": 'export const x = 1;\n"use server";\n',
        "src/b.ts": 'export const t = "use server";\n',
      }),
    ).toEqual([]);
  });

  it("deja pasar lo que no es el puerto: nombres parecidos, comentarios, el resto de caja y el uso de ventas en src", () => {
    expect(
      problemasDeExposicion({
        "apps/web/servidor/ok.ts": [
          "// registrarCobroEnTx se usa desde ventas, nunca desde acá.",
          "export const registrarCobro = 1;",
          "export const opcionesDeCobroX = 2;",
          "export const cobrosPorOrigenDelTicket = 3;",
        ].join("\n"),
        "src/modulos/ventas/casos-de-uso/cobrar-ticket.ts":
          'import { cajaParaVentas } from "../../caja/publico";\nexport const c = cajaParaVentas;\n',
        "src/composicion/web.ts": "export const cajaParaVentas = 1;\n",
      }),
    ).toEqual([]);
  });
});
