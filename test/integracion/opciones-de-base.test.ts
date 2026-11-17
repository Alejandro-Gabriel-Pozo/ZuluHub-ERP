import { describe, expect, it } from "vitest";
import {
  ZONAS_DE_LA_BASE_DE_PRUEBAS,
  sentenciaDeZonaDeLaBase,
  zonaDeLaBaseDePruebas,
} from "./opciones-de-base";

/** La zona de la sesión de la base de pruebas: lista cerrada (Argentina por defecto y UTC); lo demás lanza. */
describe("zona de la base de pruebas", () => {
  it("sin pedir nada es la de Argentina", () => {
    expect(zonaDeLaBaseDePruebas(undefined)).toBe("America/Argentina/Buenos_Aires");
    expect(zonaDeLaBaseDePruebas("")).toBe("America/Argentina/Buenos_Aires");
  });

  it.each(ZONAS_DE_LA_BASE_DE_PRUEBAS)("«%s» se acepta", (zona) => {
    expect(zonaDeLaBaseDePruebas(zona)).toBe(zona);
  });

  it.each([
    "utc",
    "Europe/Madrid",
    "America/Argentina/Cordoba",
    " UTC",
    "UTC; drop database x",
    "America/Argentina/Buenos_Aires'; select 1; --",
    "-03:00",
  ])("«%s» se rechaza (nada fuera de la lista)", (zona) => {
    expect(() => zonaDeLaBaseDePruebas(zona)).toThrow("PEDERNAL_ZONA_DE_LA_BASE");
  });

  it("la sentencia usa la zona de la lista y solo acepta el nombre generado por la prueba", () => {
    expect(sentenciaDeZonaDeLaBase("pedernal_it_0123456789abcdef", "UTC")).toBe(
      "ALTER DATABASE pedernal_it_0123456789abcdef SET timezone TO 'UTC'",
    );
    for (const nombre of [
      "postgres",
      "pedernal_it_0123456789abcde",
      "pedernal_it_0123456789abcdefg",
      "pedernal_it_0123456789abcdef; drop database x",
      'pedernal_it_0123456789abcdef"',
      "",
    ]) {
      expect(() => sentenciaDeZonaDeLaBase(nombre, "UTC"), nombre).toThrow("pedernal_it_<16 hex>");
    }
  });
});
