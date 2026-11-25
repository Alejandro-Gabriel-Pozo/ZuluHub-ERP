import { describe, expect, it } from "vitest";
import {
  CODIGO_FUERA_DE_SECUENCIA,
  CODIGO_SIN_DATOS,
  CODIGOS_DE_INFRAESTRUCTURA,
  CODIGOS_DE_TOKEN,
  categoriaDeCodigo,
  causaDeErroresDeWsfe,
  causaDeFallaDeWsaa,
  codigoDeFallaDeWsaa,
  conCausa,
  codigosComoTexto,
  errorDeFallaDeWsaa,
  hayCategoria,
  soloSinDatos,
} from "./errores-de-arca";

const m = (codigo: number) => ({ codigo, texto: "t" });

describe("los códigos reales de ARCA", () => {
  it("son los de WSFE v4.8", () => {
    expect(CODIGOS_DE_TOKEN).toEqual([600, 601]);
    expect(CODIGOS_DE_INFRAESTRUCTURA).toEqual([500, 501, 502]);
    expect(CODIGO_SIN_DATOS).toBe(602);
    expect(CODIGO_FUERA_DE_SECUENCIA).toBe(10016);
  });
});

describe("categoriaDeCodigo", () => {
  it("600 y 601: el token no sirve para esa CUIT", () => {
    expect(categoriaDeCodigo(600)).toBe("TOKEN");
    expect(categoriaDeCodigo(601)).toBe("TOKEN");
  });

  it("500, 501 y 502: error interno de ARCA", () => {
    expect(categoriaDeCodigo(500)).toBe("INFRAESTRUCTURA");
    expect(categoriaDeCodigo(501)).toBe("INFRAESTRUCTURA");
    expect(categoriaDeCodigo(502)).toBe("INFRAESTRUCTURA");
  });

  it("602 es lo único que prueba que no existe", () => {
    expect(categoriaDeCodigo(602)).toBe("SIN_DATOS");
  });

  it("10016: la numeración no es la siguiente", () => {
    expect(categoriaDeCodigo(10016)).toBe("FUERA_DE_SECUENCIA");
  });

  it("todo lo demás es un rechazo de negocio, también los vecinos de los códigos especiales", () => {
    for (const codigo of [
      0,
      499,
      503,
      599,
      603,
      10007,
      10013,
      10015,
      10015 + 1 + 1,
      10048,
      10237,
    ]) {
      expect(categoriaDeCodigo(codigo), String(codigo)).toBe("RECHAZO");
    }
  });
});

describe("hayCategoria, soloSinDatos y codigosComoTexto", () => {
  it("hayCategoria: hay al menos un mensaje de esa categoría", () => {
    expect(hayCategoria([], "TOKEN")).toBe(false);
    expect(hayCategoria([m(10016), m(601)], "TOKEN")).toBe(true);
    expect(hayCategoria([m(10016), m(10007)], "TOKEN")).toBe(false);
    expect(hayCategoria([m(500)], "INFRAESTRUCTURA")).toBe(true);
  });

  it("soloSinDatos: hay errores y TODOS son 602", () => {
    expect(soloSinDatos([])).toBe(false);
    expect(soloSinDatos([m(602)])).toBe(true);
    expect(soloSinDatos([m(602), m(602)])).toBe(true);
    expect(soloSinDatos([m(602), m(601)])).toBe(false);
    expect(soloSinDatos([m(601)])).toBe(false);
    expect(soloSinDatos([m(500), m(602)])).toBe(false);
  });

  it("codigosComoTexto: solo los códigos, separados por coma", () => {
    expect(codigosComoTexto([])).toBe("");
    expect(codigosComoTexto([{ codigo: 600, texto: "SECRETO" }])).toBe("600");
    expect(codigosComoTexto([m(600), m(10016)])).toBe("600, 10016");
  });
});

describe("las fallas SOAP de WSAA", () => {
  it("codigoDeFallaDeWsaa quita el prefijo del espacio de nombres", () => {
    expect(codigoDeFallaDeWsaa("ns1:coe.alreadyAuthenticated")).toBe("coe.alreadyAuthenticated");
    expect(codigoDeFallaDeWsaa("coe.notAuthorized")).toBe("coe.notAuthorized");
    expect(codigoDeFallaDeWsaa("a:b:cms.bad")).toBe("cms.bad");
    expect(codigoDeFallaDeWsaa("")).toBe("");
  });

  it("coe.alreadyAuthenticated: ya hay ticket, no se insiste", () => {
    expect(errorDeFallaDeWsaa("ns1:coe.alreadyAuthenticated")).toBe("ACCESO_YA_EMITIDO");
    expect(errorDeFallaDeWsaa("coe.alreadyAuthenticated")).toBe("ACCESO_YA_EMITIDO");
  });

  it("coe.notAuthorized: falta autorizar el servicio para el certificado", () => {
    expect(errorDeFallaDeWsaa("ns1:coe.notAuthorized")).toBe("AUTORIZACION_DEL_SERVICIO_FALTANTE");
  });

  it("cms.*: el certificado o la firma no sirven", () => {
    for (const falla of ["cms.bad", "cms.cert.expired", "cms.cert.untrusted", "cms.sign.invalid"]) {
      expect(errorDeFallaDeWsaa(`ns1:${falla}`), falla).toBe("SIN_CREDENCIAL");
    }
    expect(errorDeFallaDeWsaa("a:b:cms.bad")).toBe("SIN_CREDENCIAL");
  });

  it("todo lo demás es el servicio no disponible (se reintenta)", () => {
    for (const falla of [
      "wsaa.internalError",
      "wsn.unavailable",
      "xml.generationTime.invalid",
      "coe.otra",
      "coe.alreadyAuthenticatedX",
      "coe.notAuthorizedX",
      "cmsx",
      "xcms.bad",
      "",
    ]) {
      expect(errorDeFallaDeWsaa(falla), falla).toBe("SERVICIO_NO_DISPONIBLE");
    }
  });
});

describe("causaDeFallaDeWsaa: lista cerrada, igualdad exacta", () => {
  it.each([
    ["cms.cert.expired", "CERTIFICADO_VENCIDO"],
    ["cms.cert.untrusted", "CERTIFICADO_NO_RECONOCIDO"],
    ["xml.generationTime.invalid", "PROBLEMA_DEL_SISTEMA"],
    ["xml.expirationTime.invalid", "PROBLEMA_DEL_SISTEMA"],
    ["xml.expirationTime.expired", "PROBLEMA_DEL_SISTEMA"],
    ["xml.bad", "PROBLEMA_DEL_SISTEMA"],
    ["xml.source.invalid", "PROBLEMA_DEL_SISTEMA"],
    ["xml.destination.invalid", "PROBLEMA_DEL_SISTEMA"],
    ["xml.version.notSupported", "PROBLEMA_DEL_SISTEMA"],
    ["wsn.notFound", "PROBLEMA_DEL_SISTEMA"],
  ] as const)("%s → %s, con y sin el prefijo de espacio de nombres", (falla, causa) => {
    expect(causaDeFallaDeWsaa(falla)).toBe(causa);
    expect(causaDeFallaDeWsaa(`ns1:${falla}`)).toBe(causa);
  });

  it.each([
    "cms.cert.expiredX",
    "cms.cert",
    "xcms.cert.expired",
    "CMS.CERT.EXPIRED",
    "cms.cert.expired.",
    "xml.badX",
    "xml.",
    "wsn.notFoundX",
    // Tienen su propio `codigo` y no una causa: la causa no se inventa.
    "coe.notAuthorized",
    "coe.alreadyAuthenticated",
    "cms.bad",
    "wsaa.internalError",
    "__proto__",
    "toString",
    "",
  ])("%s no tiene causa", (falla) => {
    expect(causaDeFallaDeWsaa(falla)).toBeNull();
  });
});

describe("causaDeErroresDeWsfe: solo con un único código conocido", () => {
  it.each([
    [[601], "CUIT_NO_REPRESENTADA"],
    [[601, 601], "CUIT_NO_REPRESENTADA"],
    [[11002], "PUNTO_DE_VENTA_NO_HABILITADO"],
    [[11000], "PROBLEMA_DEL_SISTEMA"],
    [[11001], "PROBLEMA_DEL_SISTEMA"],
  ] as const)("%j → %s", (codigos, causa) => {
    expect(causaDeErroresDeWsfe(codigos.map(m))).toBe(causa);
  });

  it.each([
    ["601 junto a 600", [601, 600]],
    ["11002 junto a 500", [11002, 500]],
    ["11000 junto a 11001", [11000, 11001]],
    ["600 solo (tiene su código, no una causa)", [600]],
    ["6010", [6010]],
    ["1100", [1100]],
    ["110020", [110020]],
    ["602", [602]],
    ["10016", [10016]],
    ["lista vacía", []],
  ])("%s no tiene causa", (_nombre, codigos) => {
    expect(causaDeErroresDeWsfe(codigos.map(m))).toBeNull();
  });
});

describe("conCausa", () => {
  const error = { codigo: "SERVICIO_NO_DISPONIBLE", detalle: "d" } as const;

  it("sin causa devuelve el mismo error, sin la propiedad (exactOptionalPropertyTypes)", () => {
    const r = conCausa(error, null);
    expect(r).toBe(error);
    expect("causa" in r).toBe(false);
  });

  it("con causa la suma y no cambia el código", () => {
    expect(conCausa(error, "PROBLEMA_DEL_SISTEMA")).toEqual({
      ...error,
      causa: "PROBLEMA_DEL_SISTEMA",
    });
  });
});
