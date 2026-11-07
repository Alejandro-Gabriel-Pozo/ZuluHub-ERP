import { describe, expect, it } from "vitest";
import { cotaSuperiorDelPrefijo } from "./lecturas-de-comprobantes";

/**
 * La cota superior del rango de prefijo de documento (`[prefijo, cota)`). Previene: un rango que deje afuera documentos que empiezan con
 * el prefijo (cota demasiado baja) o meta otros (cota demasiado alta), y un texto que no son dígitos llegando al SQL.
 */
describe("cotaSuperiorDelPrefijo", () => {
  it("sube el último dígito: es la primera cadena que ya no empieza con el prefijo", () => {
    expect(cotaSuperiorDelPrefijo("4688")).toBe("4689");
    expect(cotaSuperiorDelPrefijo("0")).toBe("1");
    expect(cotaSuperiorDelPrefijo("20123456788")).toBe("20123456789");
  });

  it("con un 9 al final la cota es el carácter siguiente al 9 (no hay acarreo: la comparación es por bytes)", () => {
    expect(cotaSuperiorDelPrefijo("9")).toBe(":");
    expect(cotaSuperiorDelPrefijo("49")).toBe("4:");
    expect(cotaSuperiorDelPrefijo("999")).toBe("99:");
    expect(cotaSuperiorDelPrefijo("20123456789")).toBe("2012345678:");
  });

  it("el prefijo cae adentro del rango y todo lo que sigue con más dígitos también; la cota y lo de después, no", () => {
    for (const prefijo of ["4688", "49", "9", "0", "12"]) {
      const cota = cotaSuperiorDelPrefijo(prefijo);
      for (const largo of ["", "0", "5", "99999999"]) {
        const documento = prefijo + largo;
        expect(documento >= prefijo && documento < cota, `${documento} dentro`).toBe(true);
      }
      expect(cota.startsWith(prefijo.slice(0, -1))).toBe(true);
    }
    // Lo que no empieza con el prefijo queda afuera por los dos lados.
    expect("4687999" < "4688").toBe(true);
    expect("4689" < cotaSuperiorDelPrefijo("4688")).toBe(false);
    expect("46890" < cotaSuperiorDelPrefijo("4688")).toBe(false);
  });

  it("solo dígitos y no vacío: cualquier otra cosa es un error de programación, no una búsqueda", () => {
    for (const malo of ["", "46a8", "4 688", "4688%", "-1", "４６"]) {
      expect(() => cotaSuperiorDelPrefijo(malo), JSON.stringify(malo)).toThrow(RangeError);
    }
  });
});
