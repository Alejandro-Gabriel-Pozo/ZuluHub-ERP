import { describe, expect, it } from "vitest";
import {
  CODIGO_DE_INGRESO_GENERICO,
  CODIGOS_DE_INGRESO,
} from "../autenticacion/codigos-de-ingreso";
import { CATALOGO_DE_TEXTOS } from "../vocabulario/catalogo";
import { claveDeErrorDeIngreso } from "./errores-de-ingreso";

describe("claveDeErrorDeIngreso: cada código de la lista cerrada de W3b tiene su texto", () => {
  it.each([...CODIGOS_DE_INGRESO, CODIGO_DE_INGRESO_GENERICO])("%s", (codigo) => {
    const clave = claveDeErrorDeIngreso(codigo);
    expect(clave).not.toBeNull();
    expect(Object.hasOwn(CATALOGO_DE_TEXTOS, clave as string)).toBe(true);
    expect(clave).toMatch(/^ingreso\.error\./);
  });

  it("los grupos que la persona distingue", () => {
    expect(claveDeErrorDeIngreso("access_denied")).toBe("ingreso.error.cancelado");
    expect(claveDeErrorDeIngreso("email_no_verificado")).toBe("ingreso.error.email_no_verificado");
    expect(claveDeErrorDeIngreso("email_not_verified")).toBe("ingreso.error.email_no_verificado");
    expect(claveDeErrorDeIngreso("account_not_linked")).toBe("ingreso.error.cuenta_no_valida");
    expect(claveDeErrorDeIngreso("state_mismatch")).toBe("ingreso.error.interrumpido");
    expect(claveDeErrorDeIngreso("internal_server_error")).toBe("ingreso.error.generico");
  });

  it("sin error no hay texto", () => {
    expect(claveDeErrorDeIngreso(null)).toBeNull();
    expect(claveDeErrorDeIngreso(undefined)).toBeNull();
    expect(claveDeErrorDeIngreso("")).toBeNull();
  });

  it("un código que no es de la lista (incluidos los heredados de Object) es el genérico", () => {
    for (const raro of ["lo_que_sea", "constructor", "__proto__", "toString", "ACCESS_DENIED"]) {
      expect(claveDeErrorDeIngreso(raro)).toBe("ingreso.error.generico");
    }
  });
});
