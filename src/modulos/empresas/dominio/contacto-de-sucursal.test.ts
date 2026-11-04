import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import {
  cambiosDeContactoValidos,
  contactoDeLosDatos,
  contactoQueCambia,
  correoDeSucursalValido,
  telefonoDeSucursalValido,
  webDeSucursalValida,
} from "./contacto-de-sucursal";

const TEL = { ok: false, error: "TELEFONO_DE_SUCURSAL_INVALIDO" } as const;
const MAIL = { ok: false, error: "CORREO_DE_SUCURSAL_INVALIDO" } as const;
const WEB = { ok: false, error: "WEB_DE_SUCURSAL_INVALIDA" } as const;
const SIN_DATO = { ok: true, valor: null } as const;

describe("los datos de la sucursal delegan en las primitivas de contacto", () => {
  it("null o en blanco es «sin dato», sin llamar a la regla del dato", () => {
    for (const vacio of [null, "", "   ", "\t\n"]) {
      expect(telefonoDeSucursalValido(vacio)).toEqual(SIN_DATO);
      expect(correoDeSucursalValido(vacio)).toEqual(SIN_DATO);
      expect(webDeSucursalValida(vacio)).toEqual(SIN_DATO);
    }
  });

  it("lo válido sale limpio y normalizado como lo deja la primitiva", () => {
    expect(telefonoDeSucursalValido(" +54 11 4321-0000 ")).toEqual({
      ok: true,
      valor: "+54 11 4321-0000",
    });
    expect(correoDeSucursalValido("  Centro@Hotel.COM ")).toEqual({
      ok: true,
      valor: "centro@hotel.com",
    });
    expect(webDeSucursalValida(" HTTPS://Hotel.com/centro ")).toEqual({
      ok: true,
      valor: "hotel.com/centro",
    });
    expect(webDeSucursalValida("www.hotel.com")).toEqual({ ok: true, valor: "www.hotel.com" });
  });

  it("lo inválido da el error PROPIO de la sucursal, no el de la primitiva", () => {
    expect(telefonoDeSucursalValido("43\n21")).toEqual(TEL);
    expect(correoDeSucursalValido("centro")).toEqual(MAIL);
    expect(webDeSucursalValida("javascript:alert(1)")).toEqual(WEB);
  });
});

describe("cambiosDeContactoValidos", () => {
  it("lo no pedido (undefined) no se toca ni se valida", () => {
    expect(cambiosDeContactoValidos({})).toEqual({ ok: true, valor: {} });
    expect(cambiosDeContactoValidos({ telefono: undefined, correo: undefined })).toEqual({
      ok: true,
      valor: {},
    });
  });

  it("null o en blanco BORRA (queda null); lo demás se limpia", () => {
    expect(
      cambiosDeContactoValidos({ telefono: null, correo: "  ", web: " https://Hotel.com/ " }),
    ).toEqual({ ok: true, valor: { telefono: null, correo: null, web: "hotel.com" } });
  });

  it("el primer dato inválido corta, en el orden teléfono, correo, web", () => {
    expect(cambiosDeContactoValidos({ telefono: "a\nb", correo: "x", web: "y" })).toEqual(TEL);
    expect(cambiosDeContactoValidos({ correo: "x", web: "y" })).toEqual(MAIL);
    expect(cambiosDeContactoValidos({ web: "y" })).toEqual(WEB);
  });

  it("propiedad: lo que sale válido vuelve a validar igual (idempotente) y nunca trae blancos en los extremos", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (texto) => {
        for (const validar of [
          telefonoDeSucursalValido,
          correoDeSucursalValido,
          webDeSucursalValida,
        ]) {
          const una = validar(texto);
          if (!una.ok || una.valor === null) continue;
          expect(una.valor).toBe(una.valor.trim());
          expect(validar(una.valor)).toEqual(una);
        }
      }),
    );
  });
});

describe("contactoQueCambia y contactoDeLosDatos", () => {
  const actual = { telefono: "4321-0000", correo: null, web: "hotel.com" };

  it("solo queda lo pedido que de verdad cambia (borrar lo que ya no hay no es un cambio)", () => {
    expect(
      contactoQueCambia(actual, { telefono: "4321-0000", correo: null, web: "otra.com" }),
    ).toEqual({ web: "otra.com" });
    expect(contactoQueCambia(actual, { correo: "a@b", web: null })).toEqual({
      correo: "a@b",
      web: null,
    });
    expect(contactoQueCambia(actual, {})).toEqual({});
  });

  it("devuelve del contacto solo los datos nombrados, para el antes y el después de la auditoría", () => {
    expect(contactoDeLosDatos(actual, { correo: "a@b", web: null })).toEqual({
      correo: null,
      web: "hotel.com",
    });
    expect(contactoDeLosDatos(actual, {})).toEqual({});
  });
});
