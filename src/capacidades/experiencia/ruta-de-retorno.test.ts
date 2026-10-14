import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { rutaDeRetorno } from "./ruta-de-retorno";

describe("rutaDeRetorno: solo rutas propias", () => {
  it.each(["/", "/empresa", "/cuenta", "/ventas/nueva", "/ventas?mesa=3&x=1", "/a/b#parte"])(
    "deja pasar %s",
    (ruta) => {
      expect(rutaDeRetorno(ruta)).toBe(ruta);
    },
  );

  it.each([
    ["sin valor", null],
    ["indefinido", undefined],
    ["vacío", ""],
    ["una URL completa", "https://sitio-ajeno.test/"],
    ["protocolo relativo", "//sitio-ajeno.test"],
    ["barra invertida", "/\\sitio-ajeno.test"],
    ["barra invertida adentro", "/a\\b"],
    ["sin barra inicial", "empresa"],
    ["con espacio", "/a b"],
    ["con salto de línea", "/a\nb"],
    ["con control", "/a\u0000b"],
    ["con tabulación", "/\tsitio-ajeno.test"],
    ["con DEL", "/a\u007fb"],
    ["sube de nivel", "/a/../b"],
    ["punto solo", "/a/./b"],
    ["sube de nivel codificado", "/a/%2e%2e/b"],
    ["punto codificado", "/%2e/b"],
    ["protocolo relativo codificado", "/%2fsitio-ajeno.test"],
    ["barra invertida codificada", "/%5csitio-ajeno.test"],
    ["codificación rota", "/%E0%A4%A"],
    ["rutas internas de Next", "/s/app"],
    ["rutas internas, mayúsculas", "/S/app"],
    ["rutas internas codificadas", "/%73/app"],
    ["la API", "/api/auth/sign-out"],
    ["la API sola", "/api"],
    ["la API con consulta", "/api?x=1"],
    ["el ingreso (bucle)", "/ingreso"],
    ["el ingreso con consulta", "/ingreso?volver=/"],
    ["el ingreso con fragmento", "/ingreso#a"],
    ["el ingreso con barra", "/ingreso/otra"],
  ])("vuelve al inicio con %s", (_nombre, candidata) => {
    expect(rutaDeRetorno(candidata)).toBe("/");
  });

  it("los prefijos parecidos a los prohibidos sí pasan", () => {
    for (const ruta of ["/s", "/sucursales", "/apis", "/ingresos", "/ingreso-x"]) {
      expect(rutaDeRetorno(ruta)).toBe(ruta === "/s" ? "/" : ruta);
    }
  });

  it("el largo máximo es 512", () => {
    const justa = `/${"a".repeat(511)}`;
    expect(justa).toHaveLength(512);
    expect(rutaDeRetorno(justa)).toBe(justa);
    expect(rutaDeRetorno(`${justa}a`)).toBe("/");
  });

  it("propiedad: lo que devuelve siempre empieza con una sola barra y nunca es un destino ajeno", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (candidata) => {
        const ruta = rutaDeRetorno(candidata);
        expect(ruta.startsWith("/")).toBe(true);
        expect(ruta.startsWith("//")).toBe(false);
        expect(ruta).not.toContain("\\");
        // eslint-disable-next-line no-control-regex -- justamente se buscan los caracteres de control
        expect(ruta).not.toMatch(/[\u0000- \u007f]/);
        expect(() => new URL(ruta, "https://app.test")).not.toThrow();
        expect(new URL(ruta, "https://app.test").origin).toBe("https://app.test");
      }),
    );
  });
});
