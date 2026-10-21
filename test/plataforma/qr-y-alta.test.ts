import { describe, expect, it } from "vitest";
import { datosDelAlta, secretoEnGrupos } from "../../apps/plataforma/logica/alta";
import { dibujoDeQr } from "../../apps/plataforma/logica/qr-seguro";
import { matrizDelQr, svgDeLaMatriz } from "../../src/adaptadores/autenticacion/plataforma/qr-svg";

const SVG_REAL = svgDeLaMatriz(matrizDelQr("otpauth://totp/Prueba:ana?secret=JBSWY3DPEHPK3PXP"));
const SECRETO = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const CODIGOS = Array.from({ length: 10 }, (_, i) => `abcd${i}-wxyz${i}`);

describe("dibujoDeQr", () => {
  it("reconoce el SVG que arma el servidor y devuelve solo el lado y el trazo", () => {
    const dibujo = dibujoDeQr(SVG_REAL);
    expect(dibujo).not.toBeNull();
    expect(dibujo?.lado).toBeGreaterThan(20);
    expect(dibujo?.trazo).toMatch(/^M[Mhvz0-9 -]+$/);
  });

  it.each([
    ["un script", SVG_REAL.replace("<rect", "<script>alert(1)</script><rect")],
    ["un atributo de evento", SVG_REAL.replace("<svg ", '<svg onload="x()" ')],
    ["un enlace externo", SVG_REAL.replace('fill="#000000"', 'fill="url(http://x)"')],
    ["un trazo con letras raras", SVG_REAL.replace(/d="M/, 'd="Mjavascript:')],
    ["un lado que no coincide", SVG_REAL.replace(/<rect width="\d+"/, '<rect width="1"')],
    ["texto cualquiera", "<p>hola</p>"],
    ["vacío", ""],
  ])("rechaza %s", (_nombre, svg) => {
    expect(dibujoDeQr(svg)).toBeNull();
  });
});

describe("datosDelAlta", () => {
  const cuerpo = { qrSvg: SVG_REAL, secreto: SECRETO, codigosDeRecuperacion: CODIGOS };

  it("acepta la respuesta de two-factor/enable", () => {
    const datos = datosDelAlta(cuerpo);
    expect(datos?.secreto).toBe(SECRETO);
    expect(datos?.codigosDeRecuperacion).toHaveLength(10);
    expect(datos?.dibujo).not.toBeNull();
  });

  it("acepta los códigos reales (mayúsculas y minúsculas mezcladas) y los devuelve sin modificar", () => {
    const reales = Array.from({ length: 10 }, (_, i) => `aB3d${i}-Fg7H${i}`);
    const datos = datosDelAlta({ ...cuerpo, codigosDeRecuperacion: reales });
    expect(datos?.codigosDeRecuperacion).toEqual(reales);
  });

  it("si el dibujo no es de fiar, queda la clave en texto", () => {
    const datos = datosDelAlta({ ...cuerpo, qrSvg: "<svg onload='x()'/>" });
    expect(datos?.dibujo).toBeNull();
    expect(datos?.secreto).toBe(SECRETO);
  });

  it.each([
    ["sin cuerpo", null],
    ["un texto", "hola"],
    ["secreto con minúsculas", { ...cuerpo, secreto: "jbswy3dpehpk3pxp" }],
    ["secreto corto", { ...cuerpo, secreto: "ABC" }],
    ["nueve códigos", { ...cuerpo, codigosDeRecuperacion: CODIGOS.slice(1) }],
    [
      "un código con forma rara",
      { ...cuerpo, codigosDeRecuperacion: [...CODIGOS.slice(1), "<b>x</b>"] },
    ],
    [
      "un código con guion bajo",
      { ...cuerpo, codigosDeRecuperacion: [...CODIGOS.slice(1), "abcd_-12345"] },
    ],
    ["códigos que no son texto", { ...cuerpo, codigosDeRecuperacion: Array(10).fill(1) }],
  ])("rechaza %s", (_nombre, entrada) => {
    expect(datosDelAlta(entrada)).toBeNull();
  });
});

describe("secretoEnGrupos", () => {
  it("separa de a cuatro", () => {
    expect(secretoEnGrupos("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
  });
});
