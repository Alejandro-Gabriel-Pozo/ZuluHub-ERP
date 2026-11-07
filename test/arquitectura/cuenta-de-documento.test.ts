import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Las dos cuentas del número de documento (dueño, 2026-11-07: «imprimir no valida»; revisión de #222). `numeroDeDocumentoParaArca` es la
 * ESTRICTA (arma lo que se ENVÍA a ARCA y lanza ante un dato que no se puede informar) y solo puede aparecer en los archivos que
 * envían, validan o reconcilian. `numeroDeDocumentoParaImprimir` es la de LECTURA (nunca lanza) y solo puede aparecer donde se arma el
 * QR de un comprobante ya emitido. Es una lista de PERMITIDOS sobre todo `src/` y `apps/` (sin pruebas): cualquier otro archivo falla.
 * Previene: poner la estricta en el camino de la impresión (una factura ya emitida dejaría de imprimirse por un dato congelado), o la de
 * lectura en el envío (un pasaporte en cero viajaría a ARCA como 0, «sin identificar»). Se mira por identificadores, no por texto: un
 * comentario que nombra la función no cuenta. Hueco real que cubre: `modelo-de-impresion-web.ts` y `apps/web/**`, que una lista fija de
 * archivos de impresión no veía.
 */

const RAIZ = join(import.meta.dirname, "../..");

const ESTRICTA = "numeroDeDocumentoParaArca";
const DE_LECTURA = "numeroDeDocumentoParaImprimir";

/** Dónde puede aparecer cada una (rutas desde la raíz). */
const PERMITIDOS: Readonly<Record<string, readonly string[]>> = {
  [ESTRICTA]: [
    "src/modulos/fiscal/dominio/receptor.ts", // la define y valida con ella
    "src/adaptadores/arca/traducir.ts", // el pedido que se envía
    "src/modulos/fiscal/dominio/reconciliacion-de-comprobante.ts", // compara contra lo que se envió
    "src/modulos/fiscal/superficie/certificados-y-configuracion.ts", // la reexporta
  ],
  [DE_LECTURA]: [
    "src/modulos/fiscal/dominio/receptor.ts", // la define
    "src/modulos/fiscal/dominio/qr-de-arca.ts", // el QR de un comprobante ya emitido
  ],
};

/** Los identificadores `nombre` de un archivo (no cuentan los comentarios ni los textos). */
function aparece(ruta: string, texto: string, nombre: string): boolean {
  let hay = false;
  const visitar = (nodo: ts.Node): void => {
    if (ts.isIdentifier(nodo) && nodo.text === nombre) hay = true;
    if (!hay) ts.forEachChild(nodo, visitar);
  };
  visitar(ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true));
  return hay;
}

/** Los problemas de un conjunto de archivos (ruta → texto): usos fuera de lo permitido, y permitidos que ya no la usan. */
function problemasDeLaCuenta(archivos: ReadonlyMap<string, string>): string[] {
  const problemas: string[] = [];
  for (const [nombre, permitidos] of Object.entries(PERMITIDOS)) {
    for (const [ruta, texto] of archivos) {
      if (!permitidos.includes(ruta) && aparece(ruta, texto, nombre)) {
        problemas.push(`${ruta}: no puede usar ${nombre}`);
      }
    }
    for (const ruta of permitidos) {
      const texto = archivos.get(ruta);
      if (texto === undefined || !aparece(ruta, texto, nombre)) {
        problemas.push(`${ruta}: figura como permitido para ${nombre} y ya no lo usa`);
      }
    }
  }
  return problemas;
}

function codigoDe(carpeta: string, salida: Map<string, string>): void {
  for (const nombre of readdirSync(join(RAIZ, carpeta))) {
    if (nombre === "node_modules" || nombre === ".next") continue;
    const ruta = `${carpeta}/${nombre}`;
    if (statSync(join(RAIZ, ruta)).isDirectory()) codigoDe(ruta, salida);
    else if (/\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) {
      salida.set(relative(RAIZ, join(RAIZ, ruta)), readFileSync(join(RAIZ, ruta), "utf8"));
    }
  }
}

const real = (): Map<string, string> => {
  const archivos = new Map<string, string>();
  codigoDe("src", archivos);
  codigoDe("apps", archivos);
  return archivos;
};

describe("las dos cuentas del número de documento", () => {
  it("el código real cumple la lista de permitidos", () => {
    const archivos = real();
    expect(archivos.size).toBeGreaterThan(500);
    expect(problemasDeLaCuenta(archivos)).toEqual([]);
  });

  describe("violaciones inyectadas (cada una tiene que fallar)", () => {
    const con = (ruta: string, texto: string) => {
      const archivos = real();
      archivos.set(ruta, texto);
      return problemasDeLaCuenta(archivos);
    };

    it.each([
      [
        "src/composicion/modelo-de-impresion-web.ts",
        `import { ${ESTRICTA} } from "x"; ${ESTRICTA}(d);`,
      ],
      ["apps/web/pantallas/modelo-de-impresion.ts", `const n = ${ESTRICTA}(d);`],
      ["apps/web/ui/algo.tsx", `export const x = ${ESTRICTA};`],
      ["src/adaptadores/pdf/bloques-del-pdf.ts", `${ESTRICTA}(d)`],
      ["src/modulos/fiscal/dominio/modelo-de-impresion.ts", `${ESTRICTA}(d)`],
    ])("la estricta en %s", (ruta, texto) => {
      expect(con(ruta, texto)).toContain(`${ruta}: no puede usar ${ESTRICTA}`);
    });

    it.each([
      ["src/adaptadores/arca/traducir.ts", `${DE_LECTURA}(d)`],
      ["src/modulos/fiscal/dominio/reconciliacion-de-comprobante.ts", `${DE_LECTURA}(d)`],
      ["src/composicion/modelo-de-impresion-web.ts", `${DE_LECTURA}(d)`],
      ["apps/web/ui/algo.tsx", `export const x = ${DE_LECTURA};`],
    ])("la de lectura en %s", (ruta, texto) => {
      expect(con(ruta, texto)).toContain(`${ruta}: no puede usar ${DE_LECTURA}`);
    });

    it("un comentario o un texto que nombran la función no cuentan", () => {
      expect(
        con("src/composicion/otra.ts", `// ${ESTRICTA}\nexport const t = "${DE_LECTURA}";`),
      ).toEqual([]);
    });

    it("un permitido que ya no la usa falla (la lista no se pudre)", () => {
      const archivos = real();
      archivos.set("src/modulos/fiscal/dominio/qr-de-arca.ts", "export const x = 1;");
      expect(problemasDeLaCuenta(archivos)).toContain(
        `src/modulos/fiscal/dominio/qr-de-arca.ts: figura como permitido para ${DE_LECTURA} y ya no lo usa`,
      );
    });
  });
});
