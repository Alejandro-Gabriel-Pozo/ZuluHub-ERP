import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Decisiones del dueño sobre la letra (D4 y D10) y el documento de la aplicación, comprobadas sobre el
 * código real de `apps/web` (las pantallas en el navegador las mide `ui/plantillas/sesion/pantallas.test.tsx`):
 *  - nada de letra por debajo de 16 px y ningún tamaño de letra en `px` (se usa `rem`/`em`: respeta el tamaño
 *    que la persona configuró en su celular);
 *  - fuente del sistema: ninguna fuente que descargar (ni Google Fonts ni `@font-face`);
 *  - `<html lang="es-AR">` y el zoom del navegador nunca se bloquea;
 *  - sin modo oscuro en v1.
 */
const RAIZ = join(import.meta.dirname, "../../apps/web");

function archivos(carpeta: string, extension: RegExp): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    if (nombre === "node_modules" || nombre === ".next") return [];
    const ruta = join(carpeta, nombre);
    return statSync(ruta).isDirectory()
      ? archivos(ruta, extension)
      : extension.test(ruta)
        ? [ruta]
        : [];
  });
}
const css = archivos(RAIZ, /\.css$/);
/** El CSS de la hoja y del ticket impresos: es papel, tiene su propia regla (ver «el papel impreso» más abajo). */
const esDelPapel = (ruta: string): boolean => ruta.includes("/plantillas/facturacion/impresion/");
const fuentes = archivos(RAIZ, /\.(tsx?|css)$/).filter(
  (f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"),
);

describe("legibilidad de la aplicación (D4 y D10)", () => {
  it("hay CSS que revisar", () => {
    expect(css.length).toBeGreaterThan(20);
  });

  it("ningún tamaño de letra está en px (rem y em respetan lo que la persona configuró)", () => {
    const conPx = css.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .filter((linea) => /^\s*font(-size)?\s*:[^;]*\d\s*px/i.test(linea))
        .map((linea) => `${f}: ${linea.trim()}`),
    );
    expect(conPx).toEqual([]);
  });

  it("ningún token de tamaño de letra baja de 16 px (1 rem)", () => {
    const tokens = readFileSync(join(RAIZ, "ui/tokens.css"), "utf8");
    const tamanos = [...tokens.matchAll(/--tipo-tamano-[a-z]+:\s*([\d.]+)rem;/g)].map((m) =>
      Number.parseFloat(m[1] as string),
    );
    expect(tamanos.length).toBeGreaterThanOrEqual(5);
    for (const t of tamanos) expect(t).toBeGreaterThanOrEqual(1);
  });

  it("los tamaños de letra de los módulos CSS (menos la carta, que tiene su propia escala D10) salen de los tokens o son rem/em de 1 o más", () => {
    const sueltos = css
      .filter((f) => !f.includes("/plantillas/vidriera/") && !esDelPapel(f))
      .flatMap((f) =>
        [...readFileSync(f, "utf8").matchAll(/font-size:\s*([^;]+);/g)]
          .map((m) => (m[1] as string).trim())
          .filter((valor) => {
            if (valor.startsWith("var(--tipo-tamano-") || valor === "inherit") return false;
            const rem = /^([\d.]+)(rem|em)$/.exec(valor);
            return rem === null || Number.parseFloat(rem[1] as string) < 1;
          })
          .map((valor) => `${f}: ${valor}`),
      );
    expect(sueltos).toEqual([]);
  });

  it("el papel impreso (hoja A4 y ticket) fija la letra en `pt`: es papel, no se agranda con la configuración del celular", () => {
    // Previene: que la hoja cambie de tamaño con la letra del celular y el paginador corte donde no es (la vista previa escala la hoja entera).
    // Sin esto el papel quedaría exento de la regla de arriba sin ninguna otra; con esto solo puede usar `pt` (D4/D10 siguen valiendo en pantalla).
    const delPapel = css.filter(esDelPapel);
    expect(delPapel.length).toBeGreaterThanOrEqual(3);
    const sueltos = delPapel.flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/font-size:\s*([^;]+);/g)]
        .map((m) => (m[1] as string).trim())
        .filter((valor) => !/^[\d.]+pt$/.test(valor))
        .map((valor) => `${f}: ${valor}`),
    );
    expect(sueltos).toEqual([]);
  });

  it("fuente del sistema: ni Google Fonts, ni @font-face, ni @import de fuentes", () => {
    const conFuentes = fuentes.filter((f) =>
      /fonts\.googleapis|fonts\.gstatic|@font-face|next\/font/i.test(readFileSync(f, "utf8")),
    );
    expect(conFuentes).toEqual([]);
  });

  it("sin modo oscuro en v1", () => {
    const tokens = readFileSync(join(RAIZ, "ui/tokens.css"), "utf8");
    expect(tokens).toContain("color-scheme: light;");
    const oscuros = css.filter((f) =>
      /prefers-color-scheme:\s*dark/i.test(readFileSync(f, "utf8")),
    );
    expect(oscuros).toEqual([]);
  });
});

describe("el documento de la aplicación", () => {
  // Sin los comentarios: el propio comentario explica qué NO se pone.
  const raiz = readFileSync(join(RAIZ, "app/layout.tsx"), "utf8").replace(/^\s*\/\/.*$/gm, "");

  it('es <html lang="es-AR">', () => {
    expect(raiz).toContain('<html lang="es-AR">');
  });

  it("el zoom del navegador nunca se bloquea", () => {
    expect(raiz).not.toMatch(/maximumScale|userScalable|maximum-scale|user-scalable/);
    expect(raiz).toContain('width: "device-width"');
  });
});

/**
 * El código sin comentarios ni textos entre comillas: lo que queda es lo que se ejecuta. Un recorrido simple (no un
 * parser): los comentarios de línea y de bloque, comillas simples y dobles (terminan al fin de la línea si falta la de cierre) y plantillas,
 * cuyo `${...}` sí es código.
 */
function sinComentariosNiTextos(codigo: string): string {
  let salida = "";
  const plantillas: number[] = []; // por cada plantilla abierta, cuántas llaves de `${` faltan cerrar
  let i = 0;
  const texto = (cierre: string, enPlantilla: boolean): void => {
    i++;
    while (i < codigo.length) {
      const c = codigo.charAt(i);
      if (c === "\\") i += 2;
      else if (c === cierre) return void i++;
      else if (enPlantilla && c === "$" && codigo.charAt(i + 1) === "{") {
        plantillas.push(1);
        i += 2;
        return;
      } else if (!enPlantilla && c === "\n") return;
      else i++;
    }
  };
  while (i < codigo.length) {
    const c = codigo.charAt(i);
    const dos = codigo.slice(i, i + 2);
    if (dos === "//") {
      while (i < codigo.length && codigo.charAt(i) !== "\n") i++;
    } else if (dos === "/*") {
      const fin = codigo.indexOf("*/", i + 2);
      i = fin === -1 ? codigo.length : fin + 2;
    } else if (c === '"' || c === "'") texto(c, false);
    else if (c === "`") texto("`", true);
    else {
      if (plantillas.length > 0 && c === "{") plantillas[plantillas.length - 1]!++;
      if (plantillas.length > 0 && c === "}") {
        plantillas[plantillas.length - 1]!--;
        if (plantillas[plantillas.length - 1] === 0) {
          plantillas.pop();
          texto("`", true); // `i` está en la `}`: `texto` salta un carácter al empezar

          continue;
        }
      }
      salida += c;
      i++;
    }
  }
  return salida;
}

// `BigInt` NO está prohibido: es entero exacto, no pierde dígitos. Sí lo está todo lo que redondea o corre un día.
const PROHIBIDO_EN_EL_DETALLE =
  /\b(Number|parseFloat|parseInt|Date|Intl|toFixed|toLocale\w*)\b|\bMath\./;

const usosProhibidos = (codigo: string): string[] =>
  sinComentariosNiTextos(codigo).match(new RegExp(PROHIBIDO_EN_EL_DETALLE, "g")) ?? [];

describe("el detalle de un comprobante: importes y fechas solo como texto (ADR-006)", () => {
  // Previene: un importe que pierde centavos por pasar por `Number`, o un día corrido por pasar por `Date`.
  const carpeta = join(RAIZ, "ui/plantillas/facturacion");
  // Todo archivo de la carpeta (se lee el directorio: uno nuevo queda cubierto solo), menos pruebas y estilos.
  const delDetalle = readdirSync(carpeta, { withFileTypes: true })
    .filter((e) => e.isFile() && !/\.test\./.test(e.name) && !e.name.endsWith(".css"))
    .map((e) => e.name);

  it("la carpeta tiene los archivos del detalle y los del listado de comprobantes", () => {
    expect(delDetalle).toEqual(
      expect.arrayContaining([
        "formato-fiscal.ts",
        "modelo-del-detalle.ts",
        "filtros-del-listado.ts",
        "modelo-del-listado.ts",
        "PantallaDeListadoDeComprobantes.tsx",
        "FormularioDeFiltros.cliente.tsx",
        "EleccionDeSucursal.cliente.tsx",
      ]),
    );
  });

  it.each(delDetalle)(
    "%s no usa Number, parseFloat, Date ni formateadores del navegador",
    (archivo) => {
      expect(usosProhibidos(readFileSync(join(carpeta, archivo), "utf8"))).toEqual([]);
    },
  );

  describe("el detector (violación inyectada)", () => {
    it("marca Number(x) y new Date()", () => {
      expect(usosProhibidos("const a = Number(x);")).toEqual(["Number"]);
      expect(usosProhibidos("const d = new Date();")).toEqual(["Date"]);
      expect(usosProhibidos("const t = `${Number(x)}`;")).toEqual(["Number"]);
    });

    it("no marca comentarios ni textos que nombran Date o Number", () => {
      const inocente = [
        "// Number y Date no se usan",
        "/* Date(x) y Number(y) */",
        "/** Previene `Number(x)`.",
        " * Y `new Date()`. */",
        'const a = "Date";',
        "const b = 'Number(x)';",
        "const c = `la Date y el Number`;",
        "const d = <p>{'Date'}</p>;",
      ].join("\n");
      expect(usosProhibidos(inocente)).toEqual([]);
    });

    it("no prohíbe BigInt", () => {
      expect(usosProhibidos("const n = BigInt(x);")).toEqual([]);
    });
  });
});

describe("la vista imprimible: importes y fechas solo como texto (ADR-006)", () => {
  // Misma regla que el detalle, para la subcarpeta de la hoja y el ticket. Previene: un importe que pierde centavos o un día corrido en el papel.
  const carpeta = join(RAIZ, "ui/plantillas/facturacion/impresion");
  const archivosDelPapel = readdirSync(carpeta, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name))
    .map((e) => e.name);
  // Estos solo miden píxeles y milímetros (`Math.ceil`, `Math.min`): nunca tocan un importe ni una fecha. Siguen sin poder usar lo demás.
  const MIDEN_PIXELES = [
    "geometria.ts",
    "medicion.ts",
    "medidas-de-la-hoja.ts",
    "TicketDe80mm.cliente.tsx",
    "VistaPrevia.cliente.tsx",
  ];
  const SIN_REDONDEO_DE_DINERO = /\b(parseFloat|parseInt|Date|Intl|toFixed|toLocale\w*)\b/;

  it("la carpeta tiene el paginador, el modelo de la hoja y las piezas que miden", () => {
    expect(archivosDelPapel).toEqual(
      expect.arrayContaining(["paginador.ts", "modelo-de-la-hoja.ts", ...MIDEN_PIXELES]),
    );
  });

  it.each(archivosDelPapel.filter((a) => !MIDEN_PIXELES.includes(a)))(
    "%s no usa Number, parseFloat, Date, Math ni formateadores del navegador",
    (archivo) => {
      expect(usosProhibidos(readFileSync(join(carpeta, archivo), "utf8"))).toEqual([]);
    },
  );

  it.each(MIDEN_PIXELES)(
    "%s mide píxeles: puede usar Math, pero no redondea dinero ni toca fechas",
    (archivo) => {
      const codigo = sinComentariosNiTextos(readFileSync(join(carpeta, archivo), "utf8"));
      expect(codigo).not.toMatch(SIN_REDONDEO_DE_DINERO);
    },
  );
});
