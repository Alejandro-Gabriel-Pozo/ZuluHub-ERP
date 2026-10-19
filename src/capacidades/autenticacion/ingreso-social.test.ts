import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cuerpoDeIngresoSocialValido, cuerpoPublicoDeIngresoSocial } from "./ingreso-social";

const VALIDO = { provider: "google", callbackURL: "/inicio" };
const json = (x: unknown) => JSON.stringify(x);

describe("cuerpoDeIngresoSocialValido (S1)", () => {
  it("acepta el pedido de siempre: proveedor google y la ruta de retorno", () => {
    expect(cuerpoDeIngresoSocialValido(json(VALIDO))).toBe(true);
    expect(cuerpoDeIngresoSocialValido(json({ provider: "google" }))).toBe(true);
  });

  it.each([
    "idToken",
    "accessToken",
    "refreshToken",
    "disableRedirect",
    "requestSignUp",
    "scopes",
    "loginHint",
    "errorCallbackURL",
    "newUserCallbackURL",
    "additionalData",
    "__proto__",
  ])("rechaza el campo extra %s", (campo) => {
    const cuerpo = `{"provider":"google","callbackURL":"/inicio","${campo}":"x"}`;
    expect(cuerpoDeIngresoSocialValido(cuerpo)).toBe(false);
  });

  it("rechaza un idToken enviado directo, con la forma exacta del ataque", () => {
    const ataque = json({
      provider: "google",
      idToken: { token: "a.b.c", nonce: "n" },
    });
    expect(cuerpoDeIngresoSocialValido(ataque)).toBe(false);
  });

  it("rechaza otro proveedor, el proveedor ausente o que no es texto", () => {
    expect(cuerpoDeIngresoSocialValido(json({ ...VALIDO, provider: "github" }))).toBe(false);
    expect(cuerpoDeIngresoSocialValido(json({ callbackURL: "/inicio" }))).toBe(false);
    expect(cuerpoDeIngresoSocialValido(json({ ...VALIDO, provider: ["google"] }))).toBe(false);
  });

  it("rechaza un callbackURL que no es texto o es demasiado largo; acepta el largo máximo", () => {
    expect(cuerpoDeIngresoSocialValido(json({ ...VALIDO, callbackURL: 5 }))).toBe(false);
    expect(cuerpoDeIngresoSocialValido(json({ ...VALIDO, callbackURL: null }))).toBe(false);
    expect(
      cuerpoDeIngresoSocialValido(json({ ...VALIDO, callbackURL: "/" + "a".repeat(511) })),
    ).toBe(true);
    expect(
      cuerpoDeIngresoSocialValido(json({ ...VALIDO, callbackURL: "/" + "a".repeat(512) })),
    ).toBe(false);
  });

  it("rechaza lo que no es un objeto JSON, un cuerpo vacío o uno enorme", () => {
    for (const cuerpo of ["", "no es json", "null", "[]", '["google"]', '"google"', "5", "true"]) {
      expect(cuerpoDeIngresoSocialValido(cuerpo), cuerpo).toBe(false);
    }
    const grande = json({ ...VALIDO, callbackURL: "/" + "a".repeat(2100) });
    expect(cuerpoDeIngresoSocialValido(grande)).toBe(false);
    const justo = json(VALIDO) + " ".repeat(2048 - json(VALIDO).length);
    expect(justo.length).toBe(2048);
    expect(cuerpoDeIngresoSocialValido(justo)).toBe(true);
    expect(cuerpoDeIngresoSocialValido(justo + " ")).toBe(false);
  });

  it("propiedad: con cualquier campo agregado a un pedido válido, es inválido", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 20 })
          .filter((c) => c !== "provider" && c !== "callbackURL"),
        fc.jsonValue(),
        (campo, valor) => {
          const objeto = JSON.parse(json(VALIDO)) as Record<string, unknown>;
          Object.defineProperty(objeto, campo, {
            value: valor,
            enumerable: true,
            configurable: true,
            writable: true,
          });
          expect(cuerpoDeIngresoSocialValido(JSON.stringify(objeto))).toBe(false);
        },
      ),
    );
  });
});

describe("cuerpoPublicoDeIngresoSocial (S1)", () => {
  it("deja pasar solo la dirección de Google", () => {
    expect(
      cuerpoPublicoDeIngresoSocial(json({ url: "https://accounts.google.com/x", redirect: true })),
    ).toEqual({ url: "https://accounts.google.com/x", redirect: true });
  });

  it("nunca lleva el token de sesión ni el usuario, aunque la librería los devuelva", () => {
    const respuesta = json({
      redirect: false,
      token: "TOKEN-DE-SESION",
      url: "https://accounts.google.com/x",
      user: { id: "u1", email: "ana@ejemplo.test" },
    });
    const salida = cuerpoPublicoDeIngresoSocial(respuesta);
    expect(Object.keys(salida ?? {}).sort()).toEqual(["redirect", "url"]);
    expect(JSON.stringify(salida)).not.toMatch(/TOKEN-DE-SESION|ana@ejemplo/);
  });

  it("sin dirección https (o sin JSON) no hay cuerpo", () => {
    expect(cuerpoPublicoDeIngresoSocial(json({ token: "t" }))).toBeNull();
    expect(cuerpoPublicoDeIngresoSocial(json({ url: "http://google.test" }))).toBeNull();
    expect(cuerpoPublicoDeIngresoSocial(json({ url: 5 }))).toBeNull();
    expect(cuerpoPublicoDeIngresoSocial("no es json")).toBeNull();
    expect(cuerpoPublicoDeIngresoSocial("null")).toBeNull();
  });
});
