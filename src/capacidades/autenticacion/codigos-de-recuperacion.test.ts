import { createHmac } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  codificarCodigosDeRecuperacion,
  esHuellaDeCodigoDeRecuperacion,
  huellaDeCodigoDeRecuperacion,
  huellasGuardadas,
} from "./codigos-de-recuperacion";

const SECRETO = "secreto-de-prueba-0123456789abcdef";
const CODIGOS = ["abcde-12345", "FGHIJ-67890", "kLmNo-pQrSt"];

describe("huellaDeCodigoDeRecuperacion", () => {
  it("es h1: y el HMAC-SHA256 hexadecimal (con el secreto como clave) del código con su separador de dominio", () => {
    const esperado = createHmac("sha256", Buffer.from(SECRETO, "utf8"))
      .update("zuluhub/codigo-de-recuperacion/v1:abcde-12345", "utf8")
      .digest("hex");
    expect(huellaDeCodigoDeRecuperacion(SECRETO, "abcde-12345")).toBe(`h1:${esperado}`);
  });

  it("es determinista, depende del código y del secreto, y no contiene el código", () => {
    const h = huellaDeCodigoDeRecuperacion(SECRETO, "abcde-12345");
    expect(huellaDeCodigoDeRecuperacion(SECRETO, "abcde-12345")).toBe(h);
    expect(huellaDeCodigoDeRecuperacion(SECRETO, "abcde-12346")).not.toBe(h);
    expect(huellaDeCodigoDeRecuperacion(`${SECRETO}x`, "abcde-12345")).not.toBe(h);
    expect(h).not.toContain("abcde");
    expect(esHuellaDeCodigoDeRecuperacion(h)).toBe(true);
  });

  it("distingue mayúsculas (el código es sensible a ellas)", () => {
    expect(huellaDeCodigoDeRecuperacion(SECRETO, "abcde-12345")).not.toBe(
      huellaDeCodigoDeRecuperacion(SECRETO, "ABCDE-12345"),
    );
  });
});

describe("esHuellaDeCodigoDeRecuperacion", () => {
  const buena = huellaDeCodigoDeRecuperacion(SECRETO, "abcde-12345");

  it("acepta h1: más 64 hexadecimales en minúscula y nada más", () => {
    expect(esHuellaDeCodigoDeRecuperacion(buena)).toBe(true);
  });

  it.each([
    ["sin prefijo", buena.slice(3)],
    ["prefijo de otra versión", `h2:${buena.slice(3)}`],
    ["63 hexadecimales", buena.slice(0, -1)],
    ["65 hexadecimales", `${buena}0`],
    ["mayúsculas", `h1:${buena.slice(3).toUpperCase()}`],
    ["con un carácter que no es hexadecimal", `${buena.slice(0, -1)}g`],
    ["con un salto de línea al final", `${buena}\n`],
    ["con algo delante", ` ${buena}`],
    ["un código en claro", "abcde-12345"],
    ["vacía", ""],
  ])("rechaza %s", (_c, texto) => {
    expect(esHuellaDeCodigoDeRecuperacion(texto)).toBe(false);
  });
});

describe("codificarCodigosDeRecuperacion (el `encrypt` que la librería llama al guardar)", () => {
  it("guarda la lista de las huellas, en el mismo orden, y ningún código en claro", () => {
    const guardado = codificarCodigosDeRecuperacion(SECRETO, JSON.stringify(CODIGOS));
    expect(JSON.parse(guardado)).toEqual(
      CODIGOS.map((c) => huellaDeCodigoDeRecuperacion(SECRETO, c)),
    );
    for (const c of CODIGOS) expect(guardado).not.toContain(c);
  });

  it("es idempotente: lo que ya es una huella queda igual (la librería recodifica la lista restante al gastar un código)", () => {
    const una = codificarCodigosDeRecuperacion(SECRETO, JSON.stringify(CODIGOS));
    expect(codificarCodigosDeRecuperacion(SECRETO, una)).toBe(una);
    const mezcla = JSON.stringify([
      huellaDeCodigoDeRecuperacion(SECRETO, CODIGOS[0] as string),
      CODIGOS[1],
    ]);
    expect(JSON.parse(codificarCodigosDeRecuperacion(SECRETO, mezcla))).toEqual([
      huellaDeCodigoDeRecuperacion(SECRETO, CODIGOS[0] as string),
      huellaDeCodigoDeRecuperacion(SECRETO, CODIGOS[1] as string),
    ]);
  });

  it("una lista vacía queda vacía (se gastaron todos)", () => {
    expect(codificarCodigosDeRecuperacion(SECRETO, "[]")).toBe("[]");
  });

  it("falla cerrado ante algo que no es un código ni una huella: nunca guarda un texto desconocido", () => {
    for (const mal of [
      JSON.stringify(["no-es-un-codigo"]),
      JSON.stringify(["abcde-12345", "mal"]),
      JSON.stringify([5]),
      JSON.stringify([null]),
      JSON.stringify({ a: "abcde-12345" }),
      JSON.stringify("abcde-12345"),
      "null",
    ]) {
      expect(() => codificarCodigosDeRecuperacion(SECRETO, mal), mal).toThrow(RangeError);
    }
    expect(() => codificarCodigosDeRecuperacion(SECRETO, "no es json")).toThrow();
  });

  it("propiedad: para códigos con la forma de la librería, codificar dos veces es codificar una", () => {
    const codigo = fc
      .tuple(fc.stringMatching(/^[A-Za-z0-9]{5}$/), fc.stringMatching(/^[A-Za-z0-9]{5}$/))
      .map(([a, b]) => `${a}-${b}`);
    fc.assert(
      fc.property(fc.array(codigo, { maxLength: 12 }), (lista) => {
        const una = codificarCodigosDeRecuperacion(SECRETO, JSON.stringify(lista));
        expect(codificarCodigosDeRecuperacion(SECRETO, una)).toBe(una);
        expect(JSON.parse(una)).toHaveLength(lista.length);
      }),
    );
  });
});

describe("huellasGuardadas (lo que se compara al verificar)", () => {
  it("lee la lista de huellas guardada", () => {
    const guardado = codificarCodigosDeRecuperacion(SECRETO, JSON.stringify(CODIGOS));
    expect(huellasGuardadas(guardado)).toEqual(
      CODIGOS.map((c) => huellaDeCodigoDeRecuperacion(SECRETO, c)),
    );
    expect(huellasGuardadas("[]")).toEqual([]);
  });

  it.each([
    ["una lista de códigos en claro", JSON.stringify(CODIGOS)],
    [
      "una mezcla",
      JSON.stringify([huellaDeCodigoDeRecuperacion(SECRETO, "abcde-12345"), "abcde-12345"]),
    ],
    ["algo que no es una lista", JSON.stringify({ a: 1 })],
    ["un texto", JSON.stringify("h1:abc")],
    ["números", JSON.stringify([1, 2])],
    ["null", "null"],
    ["lo que no es JSON", "no es json"],
    ["vacío", ""],
  ])("devuelve null si lo guardado es %s", (_c, guardado) => {
    expect(huellasGuardadas(guardado)).toBeNull();
  });
});

describe("mensajes de error y tipos (nada se coacciona a texto)", () => {
  it("lo que no es una lista de textos lanza con el mensaje de esa causa", () => {
    for (const malo of ['"texto"', "{}", "[1]", "[null]", '[["abcde-12345"]]']) {
      expect(() => codificarCodigosDeRecuperacion(SECRETO, malo), malo).toThrow(
        "los códigos de recuperación tienen que ser una lista de textos",
      );
    }
  });

  it("un texto sin la forma de un código lanza con el mensaje de esa causa", () => {
    expect(() => codificarCodigosDeRecuperacion(SECRETO, '["en-claro-raro"]')).toThrow(
      "un código de recuperación no tiene la forma esperada",
    );
  });

  it("huellasGuardadas: una lista con una lista de huella adentro no vale; lo que no es JSON es null (no undefined)", () => {
    const huella = `h1:${"a".repeat(64)}`;
    expect(huellasGuardadas(JSON.stringify([[huella]]))).toBeNull();
    expect(huellasGuardadas(JSON.stringify([huella]))).toEqual([huella]);
    expect(huellasGuardadas("esto no es json")).toBeNull();
    expect(huellasGuardadas("")).toBeNull();
  });
});
