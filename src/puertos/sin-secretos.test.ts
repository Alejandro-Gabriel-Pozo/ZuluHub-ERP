import { describe, expect, it } from "vitest";
import { campoConPosibleSecreto, exigirSinSecretos } from "./sin-secretos";

describe("campoConPosibleSecreto", () => {
  it("deja pasar los datos sin campos de secretos", () => {
    expect(
      campoConPosibleSecreto({ invitacionId: "x", rol: "OPERADOR", reactivada: false }),
    ).toBeNull();
    expect(
      campoConPosibleSecreto({ sucursales: ["a", "b"], anidado: { n: 1, m: null } }),
    ).toBeNull();
    expect(campoConPosibleSecreto(null)).toBeNull();
    expect(campoConPosibleSecreto("texto")).toBeNull();
    expect(campoConPosibleSecreto(3)).toBeNull();
    expect(campoConPosibleSecreto([])).toBeNull();
  });

  it.each([
    "token",
    "tokenHash",
    "token_hash",
    "hash",
    "secreto",
    "secret",
    "claveDeFirma",
    "clave",
    "password",
    "contraseña",
    "credenciales",
    "firma",
    "TOKEN",
  ])("detecta el campo %s", (campo) => {
    expect(campoConPosibleSecreto({ [campo]: "x" })).toBe(campo);
  });

  it("informa la ruta del campo, también dentro de objetos y de listas", () => {
    expect(campoConPosibleSecreto({ a: { b: { token: "x" } } })).toBe("a.b.token");
    expect(campoConPosibleSecreto({ lista: [{ ok: 1 }, { hash: "x" }] })).toBe("lista[1].hash");
    expect(campoConPosibleSecreto([{ ok: 1 }, [{ firma: "x" }]])).toBe("[1][0].firma");
  });

  it("devuelve el primer hallazgo en orden", () => {
    expect(campoConPosibleSecreto({ a: 1, secreto: 2, token: 3 })).toBe("secreto");
  });
});

describe("exigirSinSecretos", () => {
  it("no lanza si no hay secretos", () => {
    expect(() => exigirSinSecretos({ invitacionId: "x" }, "encolar")).not.toThrow();
  });

  it("lanza RangeError con el lugar y el campo, sin el valor", () => {
    expect(() => exigirSinSecretos({ token: "abc-valor-secreto" }, "encolar")).toThrow(RangeError);
    expect(() => exigirSinSecretos({ token: "abc-valor-secreto" }, "encolar")).toThrow(
      /encolar: el campo 'token'/,
    );
    let mensaje = "";
    try {
      exigirSinSecretos({ token: "abc-valor-secreto" }, "encolar");
    } catch (e) {
      mensaje = (e as Error).message;
    }
    expect(mensaje).not.toContain("abc-valor-secreto");
  });
});
