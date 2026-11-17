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

  it.each([
    "/ventas/",
    "/facturacion/comprobantes?periodo=mes&texto=Hotel+Sol&despues=abc-_.~*%3D",
    "/facturacion/comprobantes?texto=a*b",
    "/a?x=1#y",
    "/a#y?z",
    "/a?",
    "/a#",
  ])("deja pasar la consulta y el fragmento que arma la propia aplicación: %s", (ruta) => {
    expect(rutaDeRetorno(ruta)).toBe(ruta);
  });

  it.each([
    "/ventas?x=a:b",
    "/ventas?x=a@b",
    "/ventas?x=a,b",
    "/ventas?x=a;b",
    "/ventas?x=a'b",
    "/ventas?x=a(b)",
    "/ventas?x=a!b",
    "/ventas?x=a$b",
    "/ventas?x=a b",
    "/ventas?x=a\\b",
    "/ventas?x=a\nb",
    "/ventas?x=a\tb",
    "/ventas?x=a\u0000b",
    "/ventas?x=a<b",
    '/ventas?x=a"b',
    "/ventas?x=ñ",
    "/ventas?x=／evil.com",
    "/ventas?x=a\u202eb",
    "/ventas#a\nb",
    "/ventas#a b",
    "/ventas?a b#c",
    "/ventas#a b?c",
    "/ventas?a:b#c=d",
  ])("la consulta o el fragmento con algo fuera del conjunto vuelve al inicio: %j", (ruta) => {
    expect(rutaDeRetorno(ruta)).toBe("/");
  });

  it.each([
    "//evil.com",
    "/\\evil.com",
    "/%2f%2fevil.com",
    "/%2F%2Fevil.com",
    "/%5cevil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r/evil.com",
    "https:evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/javascript:alert(1)",
    "/／evil.com",
    "/∕evil.com",
    "/⁄evil.com",
    "/․․/x",
    "/‮evil.com",
    "/a\u0000b",
    "/a%00b",
    "/%252f%252fevil.com",
    "///",
    "/.//evil",
    "/@evil.com",
    "/a@evil.com",
    "/user:pass@evil.com",
    "/ingreso?volver=https://evil.com",
    "/%69ngreso",
    "/%49ngreso",
    "/%61pi/auth",
    "//evil.com?x=1",
    "//evil.com#x",
    "?x=//evil.com",
    "#/evil.com",
  ])("vector de redirección abierta, vuelve al inicio: %j", (ruta) => {
    expect(rutaDeRetorno(ruta)).toBe("/");
  });

  it("el cambio de camino a consulta o fragmento se hace en el primer ? o # (el que viene antes)", () => {
    expect(rutaDeRetorno("/a#b?c")).toBe("/a#b?c");
    expect(rutaDeRetorno("/a?b#c")).toBe("/a?b#c");
    expect(rutaDeRetorno("/a:b?x")).toBe("/");
    expect(rutaDeRetorno("/a?x=:")).toBe("/");
  });

  it("lo prohibido es solo al principio de la ruta, y los puntos dentro de un nombre no son «subir de nivel»", () => {
    for (const ruta of [
      "/ventas/api",
      "/ventas/s/1",
      "/mi/ingreso",
      "/informes/2026.10",
      "/v1.2/x",
      "/archivo.pdf",
      "/a/.oculto/b",
      "/a/b../c",
    ]) {
      expect(rutaDeRetorno(ruta)).toBe(ruta);
    }
  });

  it("solo se revisa la ruta: lo que viene después de ? o # es dato, no camino", () => {
    // El camino malo seguido de una consulta o un fragmento sigue siendo malo (y completo, no solo hasta el primer carácter).
    for (const ruta of ["/a/..?x=1", "/a/..?xyz=123456", "/a/.#fragmento-largo", "/a/..#f"]) {
      expect(rutaDeRetorno(ruta), ruta).toBe("/");
    }
    // Y lo que parece malo pero está en la consulta no hace mala a la ruta.
    for (const ruta of [
      "/ventas?volver=/../x",
      "/ventas?x=//ajeno",
      "/ventas?x=%E0%A4%A",
      "/ventas#/../",
    ]) {
      expect(rutaDeRetorno(ruta), ruta).toBe(ruta);
    }
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

  it("propiedad: armada con piezas hostiles, vuelve al inicio o es exactamente la candidata y sigue en el mismo origen", () => {
    const pieza = fc.constantFrom(
      "/",
      "//",
      "\\",
      "..",
      ".",
      "%2f",
      "%5c",
      "%2e",
      "%00",
      "%252f",
      "a",
      "ñ",
      "@",
      ":",
      "?",
      "#",
      "=",
      "&",
      "+",
      "*",
      " ",
      "\t",
      "\n",
      "／",
      "∕",
      "⁄",
      "․",
      "‮",
      "https:",
      "javascript:",
      "ingreso",
      "api",
      "s",
    );
    fc.assert(
      fc.property(fc.array(pieza, { maxLength: 8 }), (piezas) => {
        const candidata = piezas.join("");
        const ruta = rutaDeRetorno(candidata);
        if (ruta === "/") return;
        expect(ruta).toBe(candidata);
        const url = new URL(ruta, "https://app.test");
        expect(url.origin).toBe("https://app.test");
        expect(url.pathname.startsWith("//")).toBe(false);
        expect(decodeURIComponent(ruta.replace(/[?#].*/, ""))).not.toContain("//");
      }),
    );
  });
});
