import { describe, expect, expectTypeOf, it } from "vitest";
import type { EmpresaNoOpera } from "../../contexto/estados";
import type { MotivoDeRechazo } from "../permisos/guard";
import { CATALOGO_DE_TEXTOS, type ClaveDeTexto } from "../vocabulario/catalogo";
import { CLAVES_DE_ERRORES_DE_CAJA } from "./respuesta-de-caja";
import { CLAVES_DE_ERRORES_DE_CATALOGO } from "./respuesta-de-catalogo";
import {
  CODIGOS_PUBLICOS,
  clasificarError,
  detalleDeFalla,
  errorDeCodigo,
  errorInesperado,
  errorPublicoDe,
  estadoHttpDe,
  type CodigoPublico,
} from "./respuesta";

/**
 * El núcleo puro del traductor único (ADR-016). Lo que más importa: (1) todo código público tiene su texto,
 * (2) lo inesperado no deja pasar NI UNA PALABRA del detalle, (3) lo conocido sale solo con su código.
 */
const codigos = Object.keys(CODIGOS_PUBLICOS) as CodigoPublico[];

describe("CODIGOS_PUBLICOS: contrato exhaustivo", () => {
  it("cada motivo del guard es un código público (el tipo lo exige; esto lo comprueba en ejecución)", () => {
    expectTypeOf<MotivoDeRechazo>().toExtend<CodigoPublico>();
    const motivos: MotivoDeRechazo[] = [
      "MODULO_EN_DESARROLLO",
      "MODULO_NO_ACTIVO",
      "MODULO_EN_SOLO_LECTURA",
      "SIN_CAPACIDAD",
      "SIN_PERMISO",
    ];
    for (const motivo of motivos) {
      expect(CODIGOS_PUBLICOS[motivo].presentacion).toBe("POR_QUE_NO_PUEDO");
      // El texto del motivo es el del guard, en un solo lugar: `motivo.<motivo>`.
      expect(CODIGOS_PUBLICOS[motivo].clave).toBe(`motivo.${motivo.toLowerCase()}`);
    }
  });

  it.each(codigos)("%s tiene un texto en el catálogo", (codigo) => {
    const clave = CODIGOS_PUBLICOS[codigo].clave;
    expect(Object.hasOwn(CATALOGO_DE_TEXTOS, clave)).toBe(true);
  });

  it("los errores de negocio usan `error.<código>` en minúsculas; los inesperados, el texto genérico", () => {
    for (const codigo of codigos) {
      const { clave, presentacion } = CODIGOS_PUBLICOS[codigo];
      // Los códigos de caja y de catálogo viven en el archivo de textos de su módulo, que exige su prefijo a toda clave (`catalogo.test.ts`): `caja.error.<…>` y `catalogo.error.<…>`.
      if (
        presentacion === "AVISO" &&
        !Object.hasOwn(CLAVES_DE_ERRORES_DE_CAJA, codigo) &&
        !Object.hasOwn(CLAVES_DE_ERRORES_DE_CATALOGO, codigo)
      )
        expect(clave).toBe(`error.${codigo.toLowerCase()}`);
    }
    expect(CODIGOS_PUBLICOS.ERROR_INTERNO.clave).toBe("error.inesperado");
    expect(CODIGOS_PUBLICOS.NO_DISPONIBLE.clave).toBe("error.no_disponible");
    expect(CODIGOS_PUBLICOS.SESION_VENCIDA.clave).toBe("error.sesion_vencida");
    expect(CODIGOS_PUBLICOS.EMPRESA_NO_OPERA.clave).toBe("error.empresa_no_opera");
  });

  it("la tabla está congelada y nadie usa dos claves iguales por error en los de negocio", () => {
    expect(Object.isFrozen(CODIGOS_PUBLICOS)).toBe(true);
    const claves = codigos
      .filter((c) => CODIGOS_PUBLICOS[c].presentacion === "AVISO")
      .map((c) => CODIGOS_PUBLICOS[c].clave);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it("cada presentación se asigna a lo que corresponde", () => {
    expect(CODIGOS_PUBLICOS.SESION_VENCIDA.presentacion).toBe("SESION");
    expect(CODIGOS_PUBLICOS.ERROR_INTERNO.presentacion).toBe("INESPERADO");
    expect(CODIGOS_PUBLICOS.NO_DISPONIBLE.presentacion).toBe("INESPERADO");
    expect(CODIGOS_PUBLICOS.EMPRESA_NO_OPERA.presentacion).toBe("POR_QUE_NO_PUEDO");
    expect(CODIGOS_PUBLICOS.PERSONA_DE_OTRO_USUARIO.presentacion).toBe("AVISO");
  });

  it("el estado HTTP de cada código", () => {
    expect(estadoHttpDe("ERROR_INTERNO")).toBe(500);
    expect(estadoHttpDe("NO_DISPONIBLE")).toBe(503);
    expect(estadoHttpDe("SESION_VENCIDA")).toBe(401);
    expect(estadoHttpDe("SIN_PERMISO")).toBe(403);
    expect(estadoHttpDe("MODULO_NO_ACTIVO")).toBe(403);
    expect(estadoHttpDe("EMPRESA_NO_OPERA")).toBe(422);
    expect(estadoHttpDe("INVITACION_VENCIDA")).toBe(422);
  });
});

describe("clasificarError", () => {
  it("un código de negocio o un motivo del guard (texto) es público", () => {
    expect(clasificarError("INVITACION_VENCIDA")).toEqual({
      tipo: "PUBLICO",
      codigo: "INVITACION_VENCIDA",
    });
    expect(clasificarError("SIN_PERMISO")).toEqual({ tipo: "PUBLICO", codigo: "SIN_PERMISO" });
  });

  it("un objeto con `codigo` conocido sale solo con el código (los ids y demás datos se descartan)", () => {
    const c = clasificarError({
      codigo: "ROL_DISTINTO_AL_ANTERIOR",
      empresaId: "11111111-1111-4111-8111-111111111111",
    });
    expect(c).toEqual({ tipo: "PUBLICO", codigo: "ROL_DISTINTO_AL_ANTERIOR" });
    expect(JSON.stringify(c)).not.toContain("1111");
  });

  it("el campo solo pasa si tiene forma de campo de formulario", () => {
    for (const campo of ["email", "empresa.cuit", "a_1", "datos.domicilio.calle"]) {
      expect(clasificarError({ codigo: "YA_ES_MIEMBRO", campo })).toEqual({
        tipo: "PUBLICO",
        codigo: "YA_ES_MIEMBRO",
        campo,
      });
    }
    for (const campo of [
      "",
      "Email",
      "1campo",
      "con espacio",
      "campo;drop",
      "a".repeat(65),
      "a.b.c.d.e",
      "a..b",
      42,
      null,
    ]) {
      expect(clasificarError({ codigo: "YA_ES_MIEMBRO", campo })).toStrictEqual({
        tipo: "PUBLICO",
        codigo: "YA_ES_MIEMBRO",
      });
    }
    // 64 caracteres exactos sí; la forma admite hasta cuatro tramos.
    expect(clasificarError({ codigo: "YA_ES_MIEMBRO", campo: "a".repeat(64) })).toHaveProperty(
      "campo",
    );
    expect(clasificarError({ codigo: "YA_ES_MIEMBRO", campo: "a.b.c.d" })).toHaveProperty("campo");
  });

  it("EMPRESA_NO_OPERA lleva el texto de su motivo (`motivo.empresa.<estado>`)", () => {
    const motivos: EmpresaNoOpera["motivo"][] = [
      "EMPRESA_EN_ALTA",
      "EMPRESA_SUSPENDIDA",
      "EMPRESA_CANCELADA",
      "EMPRESA_EN_BAJA",
      "TENANT_SUSPENDIDO",
    ];
    for (const motivo of motivos) {
      const c = clasificarError({ codigo: "EMPRESA_NO_OPERA", empresaId: "x", motivo });
      expect(c).toEqual({
        tipo: "PUBLICO",
        codigo: "EMPRESA_NO_OPERA",
        clave: `motivo.empresa.${motivo.toLowerCase()}`,
      });
      expect(Object.hasOwn(CATALOGO_DE_TEXTOS, (c as { clave: string }).clave)).toBe(true);
    }
  });

  it("EMPRESA_NO_OPERA con un motivo desconocido o sin motivo usa el texto genérico (y no trae una clave vacía)", () => {
    // Un arreglo con el nombre de un motivo se convertiría en ese texto al buscarlo: tampoco vale.
    for (const extra of [
      { motivo: "INVENTADO" },
      { motivo: 3 },
      { motivo: ["EMPRESA_EN_ALTA"] },
      { motivo: { toString: () => "EMPRESA_EN_ALTA" } },
      {},
    ]) {
      expect(clasificarError({ codigo: "EMPRESA_NO_OPERA", ...extra })).toStrictEqual({
        tipo: "PUBLICO",
        codigo: "EMPRESA_NO_OPERA",
      });
    }
    // El motivo de empresa solo vale para EMPRESA_NO_OPERA.
    expect(clasificarError({ codigo: "YA_ES_MIEMBRO", motivo: "EMPRESA_EN_ALTA" })).toStrictEqual({
      tipo: "PUBLICO",
      codigo: "YA_ES_MIEMBRO",
    });
  });

  it("lo que solo se convierte en un código al pasarlo a texto (un arreglo, un objeto con toString) no es un código", () => {
    expect(clasificarError(["SIN_PERMISO"]).tipo).toBe("INESPERADO");
    expect(clasificarError({ toString: () => "SIN_PERMISO" }).tipo).toBe("INESPERADO");
    expect(clasificarError({ codigo: ["SIN_PERMISO"] }).tipo).toBe("INESPERADO");
  });

  it("un motivo con nombre de propiedad heredada no cuenta como conocido", () => {
    expect(clasificarError({ codigo: "EMPRESA_NO_OPERA", motivo: "constructor" })).toEqual({
      tipo: "PUBLICO",
      codigo: "EMPRESA_NO_OPERA",
    });
    for (const raro of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(clasificarError(raro).tipo).toBe("INESPERADO");
      expect(clasificarError({ codigo: raro }).tipo).toBe("INESPERADO");
    }
  });

  it("los errores de persistencia son inesperados y su detalle queda para el registro", () => {
    const base = clasificarError({
      tipo: "Inesperado",
      sqlstate: "08006",
      mensaje: "password failed for pedernal_app",
    });
    expect(base).toEqual({
      tipo: "INESPERADO",
      detalle: "Inesperado 08006 password failed for pedernal_app",
    });
    expect(clasificarError({ tipo: "ConcurrenciaAgotada" })).toEqual({
      tipo: "INESPERADO",
      detalle: "ConcurrenciaAgotada",
    });
    expect(clasificarError({ tipo: "AccesoDenegado" }).tipo).toBe("INESPERADO");
    expect(clasificarError({ tipo: "Unicidad", restriccion: "persona_email_uk" })).toEqual({
      tipo: "INESPERADO",
      detalle: "Unicidad persona_email_uk",
    });
  });

  it("una excepción, un texto desconocido y cualquier otra cosa son inesperados", () => {
    expect(clasificarError(new TypeError("x es undefined"))).toEqual({
      tipo: "INESPERADO",
      detalle: "TypeError: x es undefined",
    });
    expect(clasificarError("TEXTO_QUE_NO_ES_UN_CODIGO")).toEqual({
      tipo: "INESPERADO",
      detalle: "TEXTO_QUE_NO_ES_UN_CODIGO",
    });
    for (const raro of [null, undefined, 42, {}, [], Symbol("x")]) {
      expect(clasificarError(raro).tipo).toBe("INESPERADO");
    }
  });
});

describe("detalleDeFalla", () => {
  it("un Error: nombre y mensaje; un texto: el texto; lo demás, un texto fijo", () => {
    expect(detalleDeFalla(new RangeError("fuera de rango"))).toBe("RangeError: fuera de rango");
    expect(detalleDeFalla("suelto")).toBe("suelto");
    expect(detalleDeFalla(7)).toBe("falla sin descripción");
    expect(detalleDeFalla({ sin: "tipo" })).toBe("falla sin descripción");
  });

  it("un objeto con `tipo` junta el tipo y los campos de texto que traiga, en ese orden", () => {
    expect(
      detalleDeFalla({ tipo: "Check", restriccion: "r", sqlstate: "23514", mensaje: "m" }),
    ).toBe("Check r 23514 m");
    expect(detalleDeFalla({ tipo: "Check", restriccion: null, mensaje: "m" })).toBe("Check m");
    expect(detalleDeFalla({ tipo: 5 })).toBe("falla sin descripción");
  });
});

describe("errorPublicoDe, errorInesperado y errorDeCodigo", () => {
  it("un código conocido sale con su clave y su presentación, sin referencia", () => {
    expect(errorPublicoDe({ tipo: "PUBLICO", codigo: "INVITACION_VENCIDA" })).toStrictEqual({
      codigo: "INVITACION_VENCIDA",
      clave: "error.invitacion_vencida",
      presentacion: "AVISO",
    });
  });

  it("el campo y el texto propio (el de un motivo de empresa) reemplazan a los de la tabla", () => {
    expect(
      errorPublicoDe({
        tipo: "PUBLICO",
        codigo: "EMPRESA_NO_OPERA",
        clave: "motivo.empresa.empresa_en_baja",
        campo: "empresa",
      }),
    ).toEqual({
      codigo: "EMPRESA_NO_OPERA",
      clave: "motivo.empresa.empresa_en_baja",
      presentacion: "POR_QUE_NO_PUEDO",
      campo: "empresa",
    });
  });

  it("lo inesperado sale con el código genérico y la referencia, y nada más", () => {
    expect(errorInesperado("PD-ABCD-0123", false)).toEqual({
      codigo: "ERROR_INTERNO",
      clave: "error.inesperado",
      presentacion: "INESPERADO",
      referencia: "PD-ABCD-0123",
    });
    expect(errorInesperado("PD-ABCD-0123", true)).toEqual({
      codigo: "NO_DISPONIBLE",
      clave: "error.no_disponible",
      presentacion: "INESPERADO",
      referencia: "PD-ABCD-0123",
    });
  });

  it("errorDeCodigo no trae campo ni referencia", () => {
    expect(errorDeCodigo("SIN_PERMISO")).toEqual({
      codigo: "SIN_PERMISO",
      clave: "motivo.sin_permiso",
      presentacion: "POR_QUE_NO_PUEDO",
    });
    expect(errorDeCodigo("SESION_VENCIDA")).toEqual({
      codigo: "SESION_VENCIDA",
      clave: "error.sesion_vencida",
      presentacion: "SESION",
    });
  });
});

describe("las claves de texto de los errores son del catálogo", () => {
  it("el tipo de la clave del error público es una clave del catálogo", () => {
    expectTypeOf(errorDeCodigo("SIN_PERMISO").clave).toEqualTypeOf<ClaveDeTexto>();
  });
});

describe("los parámetros públicos de un error (A1, T3: el importe vigente del precio que otra persona cambió)", () => {
  const con = (parametros: unknown, codigo = "CATALOGO_PRECIO_DESACTUALIZADO") =>
    clasificarError({ codigo, campo: "precio", parametros });

  it("pasa el importe declarado por el código, y solo ese", () => {
    expect(con({ importe: "13000.000000", otro: "1", precioId: "x" })).toEqual({
      tipo: "PUBLICO",
      codigo: "CATALOGO_PRECIO_DESACTUALIZADO",
      campo: "precio",
      parametros: { importe: "13000.000000" },
    });
    expect(con({ importe: "0" })).toHaveProperty("parametros", { importe: "0" });
    expect(con({ importe: "1.5" })).toHaveProperty("parametros", { importe: "1.5" });
  });

  it.each([
    ["texto libre", "Hola"],
    ["con signo", "-5.00"],
    ["con coma", "13000,00"],
    ["con exponente", "1e3"],
    ["con 7 decimales", "1.1234567"],
    ["con 19 enteros", "1".repeat(19)],
    ["vacío", ""],
    ["un número", 13000],
    ["marcado", "<b>1</b>"],
  ])("un importe %s no pasa: el error sale sin parámetros", (_caso, importe) => {
    expect(con({ importe })).not.toHaveProperty("parametros");
  });

  it("sin parámetros, con parámetros que no son un objeto o sin el importe: no hay parámetros", () => {
    expect(con(undefined)).not.toHaveProperty("parametros");
    expect(con("13000.00")).not.toHaveProperty("parametros");
    expect(con(null)).not.toHaveProperty("parametros");
    expect(con({})).not.toHaveProperty("parametros");
  });

  it("un código que no declara parámetros los descarta aunque vengan bien formados", () => {
    expect(con({ importe: "1.00" }, "YA_ES_MIEMBRO")).not.toHaveProperty("parametros");
    expect(con({ importe: "1.00" }, "CATALOGO_PRECIO_INVALIDO")).not.toHaveProperty("parametros");
  });

  it("un nombre heredado de Object.prototype no se confunde con un parámetro declarado", () => {
    expect(con({}, "toString").tipo).toBe("INESPERADO");
  });

  it("el error público lleva los parámetros que clasificó; sin ellos, no trae la clave", () => {
    const c = con({ importe: "13000.00" });
    if (c.tipo !== "PUBLICO") throw new Error("se esperaba un código público");
    expect(errorPublicoDe(c)).toEqual({
      codigo: "CATALOGO_PRECIO_DESACTUALIZADO",
      clave: "catalogo.precio.vigente_ahora",
      presentacion: "AVISO",
      campo: "precio",
      parametros: { importe: "13000.00" },
    });
    const sin = clasificarError("SIN_PERMISO");
    if (sin.tipo !== "PUBLICO") throw new Error("se esperaba un código público");
    expect(errorPublicoDe(sin)).not.toHaveProperty("parametros");
  });
});
