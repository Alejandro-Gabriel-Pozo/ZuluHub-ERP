import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";

/**
 * REGLA (escalabilidad, brief PR-1, 18/11/2026): las ofertas de botones de la web («¿puede…?») viven en un archivo por módulo,
 * `apps/web/servidor/ofertas-de-<clave del módulo>.ts`; `servidor/modulos.ts` queda con el menú y una lista de reexportaciones que solo
 * baja. Esta prueba vigila:
 *  1. `modulos.ts` no suma exportaciones: sus nombres exportados son un subconjunto de la lista congelada de abajo (puede achicarse
 *     cuando una página pase a importar del archivo de su módulo; no puede crecer);
 *  2. todo `servidor/ofertas-de-*.ts` termina en una clave real de `CATALOGO_DE_MODULOS`;
 *  3. los permisos se leen en UN solo lugar: el identificador `permisosDelActor` (como código, no en comentarios) aparece solo en
 *     `servidor/permisos-de-la-persona.ts` (que define el `cache` una vez); otra lectura sería una segunda transacción por pantalla.
 * Previene: que el archivo común de ofertas vuelva a ser el punto donde chocan todos los PR de pantallas (caso real: 398 de 400 líneas
 * y 13 briefs en cola el 18/11/2026), un módulo con nombre inventado que nadie encuentra y una pantalla que lee los permisos dos veces
 * por pedido. Cada forma de violación está inyectada abajo.
 */

const RAIZ = join(import.meta.dirname, "../..");
const SERVIDOR = join(RAIZ, "apps/web/servidor");
const RUTA_DE_MODULOS = "apps/web/servidor/modulos.ts";
const RUTA_DE_PERMISOS = "apps/web/servidor/permisos-de-la-persona.ts";
const PREFIJO = "ofertas-de-";

/** Lo que `modulos.ts` exportaba el 18/11/2026: las propias del menú, dos de Configuración fiscal (que no se pueden mudar: leen la tabla del menú) y las reexportadas. Solo baja. */
export const EXPORTACIONES_CONGELADAS: ReadonlySet<string> = new Set([
  "destinosDeAreas",
  "destinosDeModulos",
  "pantallasDeCuenta",
  "ACCION_DE_CONFIGURACION_FISCAL",
  "puedeVerLaConfiguracionFiscal",
  "pendientesDeLaEmpresa",
  "accionesDePuntosDeVenta",
  "puedeEditarElContactoDeLaSucursal",
  "accionesDeLaListaDeCaja",
  "puedeEditarProductos",
  "puedeCrearProductos",
  "puedeCambiarPrecios",
  "OfertaDeLaCarta",
  "ofertaDeLaCartaEnLinea",
  "puedeOcultarEnElLocal",
  "puedeOcultarEnLaEmpresa",
  "puedeEmitirNotasDeCredito",
  "puedeEmitirFacturas",
  "puedeAdministrarMesas",
  "puedeCambiarDeMesa",
  "puedeUnirMesas",
  "puedeDividirCuentas",
  "puedeEnviarAComandas",
  "puedeImprimir",
  "puedeReimprimir",
  "puedeAdministrarImpresoras",
]);

const archivoDe = (nombre: string, texto: string): ts.SourceFile =>
  ts.createSourceFile(nombre, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

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
        const nombreDeclarado =
          "name" in sentencia ? (sentencia.name as ts.Node | undefined) : undefined;
        nombres.push(
          nombreDeclarado !== undefined && ts.isIdentifier(nombreDeclarado)
            ? nombreDeclarado.text
            : "*",
        );
      }
    }
  }
  return nombres;
}

/** Regla 1: las exportaciones de `modulos.ts` que no están en la lista congelada. */
export function exportacionesNuevasDeModulos(nombre: string, texto: string): string[] {
  return exportacionesDe(nombre, texto)
    .filter((n) => !EXPORTACIONES_CONGELADAS.has(n))
    .map(
      (n) =>
        `${nombre}: exporta «${n}», que no estaba: sumala en apps/web/servidor/ofertas-de-<módulo>.ts (no acá)`,
    );
}

/** Regla 2: un archivo `ofertas-de-*.ts` cuyo sufijo no es una clave de módulo. */
export function ofertasConModuloInventado(
  archivos: readonly string[],
  modulos: readonly string[],
): string[] {
  return archivos
    .filter((a) => a.startsWith(PREFIJO) && a.endsWith(".ts"))
    .filter((a) => !modulos.includes(a.slice(PREFIJO.length, -".ts".length)))
    .map((a) => `${a}: el sufijo no es una clave de CATALOGO_DE_MODULOS`);
}

/** Regla 3: cada uso del identificador `permisosDelActor` como código (los comentarios y las cadenas no cuentan). */
export function lecturasDePermisos(nombre: string, texto: string): string[] {
  const usos: string[] = [];
  const mirar = (nodo: ts.Node): void => {
    if (ts.isIdentifier(nodo) && nodo.text === "permisosDelActor") usos.push(nodo.text);
    ts.forEachChild(nodo, mirar);
  };
  mirar(archivoDe(nombre, texto));
  return usos;
}

function archivosDe(carpeta: string): string[] {
  const salida: string[] = [];
  for (const e of readdirSync(carpeta, { withFileTypes: true })) {
    const ruta = join(carpeta, e.name);
    if (e.isDirectory()) salida.push(...archivosDe(ruta));
    else if (/\.tsx?$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

describe("ofertas por módulo: los archivos reales", () => {
  it("modulos.ts no suma exportaciones", () => {
    const texto = readFileSync(join(RAIZ, RUTA_DE_MODULOS), "utf8");
    expect(exportacionesNuevasDeModulos(RUTA_DE_MODULOS, texto)).toEqual([]);
  });

  it("cada ofertas-de-*.ts es de un módulo del catálogo", () => {
    const nombres = readdirSync(SERVIDOR);
    expect(ofertasConModuloInventado(nombres, Object.keys(CATALOGO_DE_MODULOS))).toEqual([]);
  });

  it("los permisos se leen solo en permisos-de-la-persona.ts", () => {
    const lecturas = archivosDe(join(RAIZ, "apps/web/servidor"))
      .map((ruta) => relative(RAIZ, ruta))
      .filter((ruta) => ruta !== RUTA_DE_PERMISOS)
      .flatMap((ruta) =>
        lecturasDePermisos(ruta, readFileSync(join(RAIZ, ruta), "utf8")).map(
          (u) => `${ruta}: ${u}`,
        ),
      );
    expect(lecturas).toEqual([]);
    expect(
      lecturasDePermisos(RUTA_DE_PERMISOS, readFileSync(join(RAIZ, RUTA_DE_PERMISOS), "utf8")),
    ).toHaveLength(1);
  });
});

describe("ofertas por módulo: el analizador ve cada forma (violaciones inyectadas)", () => {
  it("una función exportada nueva en modulos.ts falla y dice dónde sumarla", () => {
    const problemas = exportacionesNuevasDeModulos(
      "modulos.ts",
      "export async function puedeAlgoNuevo() { return true; }",
    );
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("puedeAlgoNuevo");
    expect(problemas[0]).toContain("apps/web/servidor/ofertas-de-<módulo>.ts");
  });

  it.each([
    ["una constante", "export const puedeAlgo = 1;"],
    ["una reexportación", 'export { puedeAlgo } from "./ofertas-de-caja";'],
    ["un tipo", "export type Algo = string;"],
    ["export *", 'export * from "./ofertas-de-caja";'],
    ["export default", "export default function () {}"],
  ])("%s también falla", (_nombre, texto) => {
    expect(exportacionesNuevasDeModulos("modulos.ts", texto)).toHaveLength(1);
  });

  it("un nombre de la lista congelada, o una función no exportada, no falla", () => {
    expect(
      exportacionesNuevasDeModulos(
        "modulos.ts",
        "export async function puedeImprimir() {}\nfunction auxiliar() {}",
      ),
    ).toEqual([]);
  });

  it("un archivo ofertas-de-inventado.ts falla; uno de un módulo real, no", () => {
    const modulos = Object.keys(CATALOGO_DE_MODULOS);
    expect(ofertasConModuloInventado(["ofertas-de-inventado.ts"], modulos)).toHaveLength(1);
    expect(ofertasConModuloInventado(["ofertas-de-caja.ts", "modulos.ts"], modulos)).toEqual([]);
  });

  it("una segunda lectura de permisos en otro archivo falla; un comentario no cuenta", () => {
    expect(
      lecturasDePermisos(
        "ofertas-de-x.ts",
        "const p = await web.consultasDeEmpresas().permisosDelActor(contexto);",
      ),
    ).toEqual(["permisosDelActor"]);
    expect(
      lecturasDePermisos("x.ts", "// permisosDelActor\nconst a = 'permisosDelActor';"),
    ).toEqual([]);
  });
});
