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
      .filter((f) => !f.includes("/plantillas/carta/"))
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
