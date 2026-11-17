import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ANCHO_DE_LA_LETRA_MM,
  ANCHO_DEL_QR_MM,
  ANCHOS_DE_COLUMNA_MM,
  LETRA_EN_PT,
} from "./medidas-del-papel";

/**
 * Las medidas que el PDF repite de la hoja en pantalla se comparan con su CSS (`HojaA4.module.css`): tamaños de letra en `pt` y anchos en
 * `mm`. Si cambia una de las dos hojas y la otra no, esta prueba falla y dice cuál. Previene: que el PDF y la pantalla dibujen el mismo
 * comprobante con otra tipografía o columnas distintas sin que nadie lo note (el riesgo de dos diseños que el dueño aceptó, 2026-11-05).
 */
const CSS = readFileSync(
  "apps/web/ui/plantillas/facturacion/impresion/HojaA4.module.css",
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** El valor de una propiedad en la primera regla cuyo selector es exactamente `selector` (o lo lleva en una lista). */
function valorDe(selector: string, propiedad: string): string {
  for (const regla of CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectores = (regla[1] ?? "").split(",").map((s) => s.trim());
    if (!selectores.includes(selector)) continue;
    const valor = new RegExp(`(?:^|;|\\s)${propiedad}:\\s*([^;]+);`).exec(regla[2] ?? "")?.[1];
    if (valor !== undefined) return valor.trim();
  }
  throw new Error(`el CSS de la hoja no tiene ${selector} { ${propiedad} }`);
}

describe("el PDF repite las medidas de la hoja en pantalla", () => {
  it.each([
    [".hoja", LETRA_EN_PT.base],
    [".homologacion", LETRA_EN_PT.aviso],
    [".letraGrande", LETRA_EN_PT.letra],
    [".codigo", LETRA_EN_PT.chica],
    [".nombre", LETRA_EN_PT.nombre],
    [".rotulo", LETRA_EN_PT.nombre],
    [".numero", LETRA_EN_PT.numeroDeComprobante],
    [".filaFuerte", LETRA_EN_PT.totalFuerte],
    [".transparencia", LETRA_EN_PT.chica],
    [".numeroDeHoja", LETRA_EN_PT.chica],
    [".pieDerecho", LETRA_EN_PT.chica],
  ] as const)("el tamaño de letra de %s es de %i pt, como en el PDF", (selector, puntos) => {
    expect(valorDe(selector, "font-size")).toBe(`${puntos}pt`);
  });

  it.each([
    [".colCantidad", ANCHOS_DE_COLUMNA_MM.cantidad],
    [".colPrecio", ANCHOS_DE_COLUMNA_MM.precio],
    [".colIva", ANCHOS_DE_COLUMNA_MM.iva],
    [".colImporte", ANCHOS_DE_COLUMNA_MM.importe],
    [".qr", ANCHO_DEL_QR_MM],
  ] as const)("el ancho de %s es de %i mm, como en el PDF", (selector, milimetros) => {
    expect(valorDe(selector, "width")).toBe(`${milimetros}mm`);
  });

  it("la letra del comprobante ocupa la columna central de 24 mm de la cabecera", () => {
    expect(valorDe(".cabecera", "grid-template-columns")).toBe(`1fr ${ANCHO_DE_LA_LETRA_MM}mm 1fr`);
  });

  it("la prueba no es trivial: un selector o una propiedad que no existe falla", () => {
    expect(() => valorDe(".noExiste", "font-size")).toThrow();
    expect(() => valorDe(".hoja", "letter-spacing")).toThrow();
  });
});
