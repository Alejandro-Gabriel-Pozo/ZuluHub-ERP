import { describe, expect, it } from "vitest";
import {
  CONDICIONES_DE_IIBB,
  CONDICION_NO_CONTRIBUYENTE,
  LARGO_MAXIMO_DEL_NUMERO_DE_IIBB,
  esCondicionDeIibb,
} from "./ingresos-brutos";

describe("ingresos brutos", () => {
  it("el número admite hasta 30 caracteres (valor que ya tenía el sistema)", () => {
    expect(LARGO_MAXIMO_DEL_NUMERO_DE_IIBB).toBe(30);
  });

  it("las condiciones son las cuatro de la base, sin repetir, y «No contribuyente» es una de ellas", () => {
    expect([...CONDICIONES_DE_IIBB]).toEqual([
      "LOCAL",
      "CONVENIO_MULTILATERAL",
      "EXENTO",
      "NO_CONTRIBUYENTE",
    ]);
    expect(CONDICION_NO_CONTRIBUYENTE).toBe("NO_CONTRIBUYENTE");
  });

  it.each(["LOCAL", "CONVENIO_MULTILATERAL", "EXENTO", "NO_CONTRIBUYENTE"])(
    "reconoce %s",
    (condicion) => {
      expect(esCondicionDeIibb(condicion)).toBe(true);
    },
  );

  it.each(["", " ", "local", "Local", "NO CONTRIBUYENTE", " LOCAL", "LOCAL ", "constructor"])(
    "no reconoce «%s»",
    (texto) => {
      expect(esCondicionDeIibb(texto)).toBe(false);
    },
  );
});
