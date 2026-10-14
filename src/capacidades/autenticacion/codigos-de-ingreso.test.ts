import { describe, expect, it } from "vitest";
import {
  CODIGOS_DE_INGRESO,
  CODIGO_DE_INGRESO_GENERICO,
  CODIGO_DE_SOLICITUD_GENERICO,
  codigoPublicoDeIngreso,
  codigoPublicoDeSolicitud,
  sanearUbicacionDeError,
} from "./codigos-de-ingreso";

const ORIGEN = "https://app.marca-a.test";

describe("codigoPublicoDeIngreso", () => {
  it("la lista cerrada incluye los códigos de la librería que pueden pasar y los propios", () => {
    for (const codigo of [
      "account_not_linked",
      "email_no_verificado",
      "state_mismatch",
      "access_denied",
      "unable_to_create_user",
    ]) {
      expect(CODIGOS_DE_INGRESO).toContain(codigo);
    }
  });

  it("no tiene repetidos y todos tienen la forma de un código (minúsculas y guiones bajos)", () => {
    expect(new Set(CODIGOS_DE_INGRESO).size).toBe(CODIGOS_DE_INGRESO.length);
    for (const codigo of CODIGOS_DE_INGRESO) expect(codigo).toMatch(/^[a-z][a-z_]*$/);
  });

  it.each(CODIGOS_DE_INGRESO)("%s sale tal cual", (codigo) => {
    expect(codigoPublicoDeIngreso(codigo)).toBe(codigo);
  });

  it.each([
    null,
    "",
    " ",
    "algo_que_inventé",
    "STATE_MISMATCH",
    "state_mismatch ",
    "state-mismatch",
    "<script>",
  ])("%j sale como el genérico", (codigo) => {
    expect(codigoPublicoDeIngreso(codigo)).toBe(CODIGO_DE_INGRESO_GENERICO);
  });

  it("el genérico no es uno de los de la lista", () => {
    expect(CODIGO_DE_INGRESO_GENERICO).toBe("error_de_ingreso");
    expect(CODIGOS_DE_INGRESO as readonly string[]).not.toContain(CODIGO_DE_INGRESO_GENERICO);
  });
});

describe("sanearUbicacionDeError", () => {
  it("una ubicación relativa con un error conocido queda reducida a ese error", () => {
    expect(sanearUbicacionDeError("/ingreso?error=account_not_linked", ORIGEN)).toBe(
      "/ingreso?error=account_not_linked",
    );
  });

  it("descarta la descripción, los demás parámetros y el fragmento", () => {
    expect(
      sanearUbicacionDeError(
        "/ingreso?error=access_denied&error_description=%3Cscript%3E&x=1#abc",
        ORIGEN,
      ),
    ).toBe("/ingreso?error=access_denied");
  });

  it("un error que no es de la lista se vuelve el genérico", () => {
    expect(sanearUbicacionDeError("/ingreso?error=lo_que_sea", ORIGEN)).toBe(
      "/ingreso?error=error_de_ingreso",
    );
    expect(sanearUbicacionDeError("/ingreso?error=", ORIGEN)).toBe(
      "/ingreso?error=error_de_ingreso",
    );
  });

  it("una ubicación absoluta conserva su origen y se reduce igual", () => {
    expect(
      sanearUbicacionDeError(`${ORIGEN}/ingreso?error=state_mismatch&error_description=x`, ORIGEN),
    ).toBe(`${ORIGEN}/ingreso?error=state_mismatch`);
  });

  it("no deja pasar el origen de una ubicación que empieza con dos barras", () => {
    expect(sanearUbicacionDeError("//malo.test/x?error=access_denied", ORIGEN)).toBe(
      "/x?error=access_denied",
    );
  });

  it("sin error la ubicación pasa igual (la de un ingreso que salió bien)", () => {
    expect(sanearUbicacionDeError("/", ORIGEN)).toBe("/");
    expect(sanearUbicacionDeError("/panel?a=1&b=2#x", ORIGEN)).toBe("/panel?a=1&b=2#x");
    expect(sanearUbicacionDeError(`${ORIGEN}/panel`, ORIGEN)).toBe(`${ORIGEN}/panel`);
  });

  it("una ubicación que no se puede interpretar se vuelve el origen", () => {
    expect(sanearUbicacionDeError("http://[", ORIGEN)).toBe(ORIGEN);
  });
});

describe("codigoPublicoDeSolicitud", () => {
  it("devuelve el código de la librería y nada más", () => {
    expect(
      codigoPublicoDeSolicitud('{"code":"INVALID_ORIGIN","message":"Invalid origin: https://x"}'),
    ).toBe("INVALID_ORIGIN");
    expect(codigoPublicoDeSolicitud('{"code":"A1_B2"}')).toBe("A1_B2");
  });

  it("acepta un código de hasta 64 caracteres y no uno de 65", () => {
    expect(codigoPublicoDeSolicitud(JSON.stringify({ code: "A".repeat(64) }))).toBe("A".repeat(64));
    expect(codigoPublicoDeSolicitud(JSON.stringify({ code: "A".repeat(65) }))).toBe(
      CODIGO_DE_SOLICITUD_GENERICO,
    );
  });

  it.each([
    ["sin código", '{"message":"algo"}'],
    ["código en minúsculas", '{"code":"invalid_origin"}'],
    ["código que empieza con número", '{"code":"1ABC"}'],
    ["código que empieza con guion bajo", '{"code":"_ABC"}'],
    ["código con espacios", '{"code":"INVALID ORIGIN"}'],
    ["código con signos", '{"code":"A-B"}'],
    ["código vacío", '{"code":""}'],
    ["código que no es texto", '{"code":403}'],
    ["código que es un arreglo con un código", '{"code":["INVALID_ORIGIN"]}'],
    ["código nulo", '{"code":null}'],
    ["JSON nulo", "null"],
    ["JSON que es un texto", '"INVALID_ORIGIN"'],
    ["un arreglo", "[]"],
    ["no es JSON", "Not Found"],
    ["vacío", ""],
  ])("%s: el genérico", (_nombre, cuerpo) => {
    expect(codigoPublicoDeSolicitud(cuerpo)).toBe(CODIGO_DE_SOLICITUD_GENERICO);
  });

  it("el genérico es SOLICITUD_INVALIDA", () => {
    expect(CODIGO_DE_SOLICITUD_GENERICO).toBe("SOLICITUD_INVALIDA");
  });

  it("un código en un campo anidado no cuenta", () => {
    expect(codigoPublicoDeSolicitud('{"error":{"code":"INVALID_ORIGIN"}}')).toBe(
      CODIGO_DE_SOLICITUD_GENERICO,
    );
  });
});
