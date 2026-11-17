import { describe, expect, it } from "vitest";
import { datosDeReceptorSugeridos, type DatosParaReceptor } from "./receptor-sugerido";

const base: DatosParaReceptor = {
  naturaleza: "JURIDICA",
  nombre: "Distribuidora Sur SA",
  apellido: null,
  documento: { tipo: "CUIT", pais: null, numero: "30712345671" },
  condicionIva: "RESPONSABLE_INSCRIPTO",
};

describe("datosDeReceptorSugeridos", () => {
  it("una empresa: su razón social, su CUIT y su condición", () => {
    expect(datosDeReceptorSugeridos(base)).toEqual({
      nombre: "Distribuidora Sur SA",
      documento: { tipo: "CUIT", numero: "30712345671" },
      condicionIva: "RESPONSABLE_INSCRIPTO",
    });
  });

  it("una persona: «nombre apellido»; sin apellido, solo el nombre", () => {
    const persona = { ...base, naturaleza: "HUMANA", nombre: "Juan", apellido: "Pérez" } as const;
    expect(datosDeReceptorSugeridos(persona)?.nombre).toBe("Juan Pérez");
    expect(datosDeReceptorSugeridos({ ...persona, apellido: null })?.nombre).toBe("Juan");
  });

  it("una empresa no lleva apellido aunque el dato exista", () => {
    expect(datosDeReceptorSugeridos({ ...base, apellido: "Pérez" })?.nombre).toBe(
      "Distribuidora Sur SA",
    );
  });

  it("los documentos que ARCA admite como receptor pasan; el extranjero queda sin documento", () => {
    for (const tipo of ["CUIT", "CUIL", "CDI", "DNI"] as const) {
      expect(
        datosDeReceptorSugeridos({ ...base, documento: { tipo, pais: null, numero: "1" } })
          ?.documento,
      ).toEqual({
        tipo,
        numero: "1",
      });
    }
    expect(
      datosDeReceptorSugeridos({
        ...base,
        documento: { tipo: "PASAPORTE", pais: "AR", numero: "ABC123456" },
      })?.documento,
    ).toEqual({ tipo: "PASAPORTE", numero: "ABC123456" });
    expect(
      datosDeReceptorSugeridos({
        ...base,
        documento: { tipo: "ID_EXTRANJERO", pais: "CL", numero: "RUT1" },
      })?.documento,
    ).toBeNull();
    expect(datosDeReceptorSugeridos({ ...base, documento: null })?.documento).toBeNull();
  });

  it("sin condición queda null; una parte sin nombre (anonimizada) no tiene sugerencia", () => {
    expect(datosDeReceptorSugeridos({ ...base, condicionIva: null })?.condicionIva).toBeNull();
    expect(datosDeReceptorSugeridos({ ...base, nombre: null })).toBeNull();
  });
});
