import { describe, expect, it } from "vitest";
import { LARGO_MAXIMO_DE_ERROR, textoDeErrorSeguro, textoDeExcepcionSegura } from "./error-seguro";

describe("textoDeErrorSeguro", () => {
  it("deja pasar un mensaje corto y normal", () => {
    expect(textoDeErrorSeguro("el proveedor respondió 500")).toBe("el proveedor respondió 500");
  });

  it("tapa los enlaces", () => {
    expect(textoDeErrorSeguro("falló https://app.ejemplo.com/invitaciones/abc?x=1 otra vez")).toBe(
      "falló [enlace] otra vez",
    );
    expect(textoDeErrorSeguro("http://localhost:3000/x")).toBe("[enlace]");
    expect(textoDeErrorSeguro("postgres://usuario:clave@host/base")).toBe("[enlace]");
  });

  it("tapa tokens, claves y hashes largos", () => {
    const token = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0-_";
    const hash = "a".repeat(64);
    expect(textoDeErrorSeguro(`token ${token} y hash ${hash}`)).toBe(
      "token [oculto] y hash [oculto]",
    );
  });

  it("no toca un uuid ni tiras de menos de 32 caracteres (un nombre de restricción)", () => {
    const uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    expect(textoDeErrorSeguro(`falló ${uuid}`)).toBe(`falló ${uuid}`);
    // Pero un uuid con algo pegado ya no es un identificador.
    expect(textoDeErrorSeguro(`falló ${uuid}abc`)).toBe("falló [oculto]");
    expect(textoDeErrorSeguro(`falló abc${uuid}`)).toBe("falló [oculto]");
    expect(textoDeErrorSeguro("trabajo_clave_uk")).toBe("trabajo_clave_uk");
  });

  it("tapa una tira justo de 32 caracteres, pero no una de 31", () => {
    expect(textoDeErrorSeguro("x".repeat(32))).toBe("[oculto]");
    expect(textoDeErrorSeguro("x".repeat(31))).toBe("x".repeat(31));
  });

  it("junta los blancos y los saltos de línea en un solo espacio", () => {
    expect(textoDeErrorSeguro("  uno\n\n dos\t\ttres  ")).toBe("uno dos tres");
  });

  it("un texto vacío o solo de blancos queda con un mensaje genérico", () => {
    expect(textoDeErrorSeguro("")).toBe("error sin detalle");
    expect(textoDeErrorSeguro(" \n ")).toBe("error sin detalle");
  });

  it("recorta a 500 caracteres exactos, con puntos suspensivos", () => {
    const largo = "palabra ".repeat(200);
    const recortado = textoDeErrorSeguro(largo);
    expect(recortado).toHaveLength(LARGO_MAXIMO_DE_ERROR);
    expect(recortado.endsWith("…")).toBe(true);
    const justo = "a ".repeat(250).trim();
    expect(justo.length).toBeLessThanOrEqual(LARGO_MAXIMO_DE_ERROR);
    expect(textoDeErrorSeguro(justo)).toBe(justo);
    // Justo 500 caracteres (con espacios, para que ninguna tira pase de 31): se deja entero.
    const exacto = `${"a ".repeat(249)}aa`;
    expect(exacto).toHaveLength(LARGO_MAXIMO_DE_ERROR);
    expect(textoDeErrorSeguro(exacto)).toBe(exacto);
    const unoMas = `${exacto}a`;
    expect(textoDeErrorSeguro(unoMas)).toHaveLength(LARGO_MAXIMO_DE_ERROR);
    expect(textoDeErrorSeguro(unoMas).endsWith("…")).toBe(true);
  });

  it("el largo máximo es 500", () => {
    expect(LARGO_MAXIMO_DE_ERROR).toBe(500);
  });
});

describe("textoDeExcepcionSegura", () => {
  it("usa el nombre y el mensaje de un Error, ya limpios", () => {
    expect(textoDeExcepcionSegura(new TypeError("fetch failed https://x.test/a/b"))).toBe(
      "TypeError: fetch failed [enlace]",
    );
  });

  it("no expone nada de lo que no es un Error", () => {
    expect(textoDeExcepcionSegura("secreto-en-un-texto")).toBe("excepción que no es un Error");
    expect(textoDeExcepcionSegura({ token: "x" })).toBe("excepción que no es un Error");
    expect(textoDeExcepcionSegura(null)).toBe("excepción que no es un Error");
  });
});
