import { describe, expect, it } from "vitest";
import {
  TIPOS_DE_DOCUMENTO_DE_EMPRESA,
  TIPOS_DE_DOCUMENTO_DE_PARTE,
  documentoDeParteDesdeDatos,
  documentoNormalizado,
  esTipoDeDocumentoDeParte,
} from "./documento";

const error = (codigo: string) => ({ ok: false, error: codigo });

describe("documentoDeParteDesdeDatos", () => {
  it("las listas de tipos", () => {
    expect([...TIPOS_DE_DOCUMENTO_DE_PARTE]).toEqual([
      "CUIT",
      "CUIL",
      "CDI",
      "DNI",
      "PASAPORTE",
      "ID_EXTRANJERO",
    ]);
    expect([...TIPOS_DE_DOCUMENTO_DE_EMPRESA]).toEqual(["CUIT", "ID_EXTRANJERO"]);
    for (const t of TIPOS_DE_DOCUMENTO_DE_PARTE) expect(esTipoDeDocumentoDeParte(t)).toBe(true);
    for (const t of ["cuit", "", "LE", "CUIT "]) expect(esTipoDeDocumentoDeParte(t)).toBe(false);
  });

  it("CUIT, CUIL y CDI: con o sin guiones, se guarda sin guiones y sin país", () => {
    for (const tipo of ["CUIT", "CUIL", "CDI"]) {
      expect(documentoDeParteDesdeDatos("HUMANA", { tipo, numero: "30-71234567-1" })).toEqual({
        ok: true,
        valor: { tipo, pais: null, numero: "30712345671" },
      });
    }
    expect(
      documentoDeParteDesdeDatos("JURIDICA", { tipo: "CUIT", numero: "30712345671", pais: null }),
    ).toEqual({
      ok: true,
      valor: { tipo: "CUIT", pais: null, numero: "30712345671" },
    });
  });

  it("CUIT con dígito verificador mal o con letras: CUIT_INVALIDO", () => {
    for (const tipo of ["CUIT", "CUIL", "CDI"]) {
      expect(documentoDeParteDesdeDatos("HUMANA", { tipo, numero: "30712345672" })).toEqual(
        error("CUIT_INVALIDO"),
      );
      expect(documentoDeParteDesdeDatos("HUMANA", { tipo, numero: "Juan" })).toEqual(
        error("CUIT_INVALIDO"),
      );
    }
  });

  it("DNI: con puntos de miles, se guarda sin ellos; el inválido da DNI_INVALIDO", () => {
    expect(documentoDeParteDesdeDatos("HUMANA", { tipo: "DNI", numero: "12.345.678" })).toEqual({
      ok: true,
      valor: { tipo: "DNI", pais: null, numero: "12345678" },
    });
    for (const numero of ["012345678", "12", "1234567890", "abc"]) {
      expect(documentoDeParteDesdeDatos("HUMANA", { tipo: "DNI", numero }), numero).toEqual(
        error("DNI_INVALIDO"),
      );
    }
  });

  it("los documentos argentinos no llevan país", () => {
    expect(
      documentoDeParteDesdeDatos("HUMANA", { tipo: "DNI", numero: "12345678", pais: "AR" }),
    ).toEqual(error("PAIS_NO_CORRESPONDE"));
    expect(
      documentoDeParteDesdeDatos("JURIDICA", { tipo: "CUIT", numero: "30712345671", pais: "AR" }),
    ).toEqual(error("PAIS_NO_CORRESPONDE"));
  });

  it("pasaporte: país y de 6 a 9 letras o números, en mayúsculas", () => {
    expect(
      documentoDeParteDesdeDatos("HUMANA", { tipo: "PASAPORTE", numero: "abc123456", pais: "AR" }),
    ).toEqual({
      ok: true,
      valor: { tipo: "PASAPORTE", pais: "AR", numero: "ABC123456" },
    });
    expect(
      documentoDeParteDesdeDatos("HUMANA", { tipo: "PASAPORTE", numero: "ABC12", pais: "AR" }),
    ).toEqual(error("PASAPORTE_INVALIDO"));
    expect(
      documentoDeParteDesdeDatos("HUMANA", { tipo: "PASAPORTE", numero: "ABC1234567", pais: "AR" }),
    ).toEqual(error("PASAPORTE_INVALIDO"));
  });

  it("documento extranjero: país y de 3 a 20 letras o números", () => {
    expect(
      documentoDeParteDesdeDatos("JURIDICA", {
        tipo: "ID_EXTRANJERO",
        numero: "rut123",
        pais: "CL",
      }),
    ).toEqual({
      ok: true,
      valor: { tipo: "ID_EXTRANJERO", pais: "CL", numero: "RUT123" },
    });
    expect(
      documentoDeParteDesdeDatos("HUMANA", { tipo: "ID_EXTRANJERO", numero: "AB", pais: "CL" }),
    ).toEqual(error("DOCUMENTO_EXTRANJERO_INVALIDO"));
  });

  it("los dos extranjeros exigen un país: PAIS_REQUERIDO si falta, PAIS_INVALIDO si no tiene la forma", () => {
    for (const tipo of ["PASAPORTE", "ID_EXTRANJERO"]) {
      for (const pais of [undefined, null]) {
        expect(
          documentoDeParteDesdeDatos("HUMANA", {
            tipo,
            numero: "ABC123456",
            ...(pais === undefined ? {} : { pais }),
          }),
          `${tipo} ${pais}`,
        ).toEqual(error("PAIS_REQUERIDO"));
      }
      for (const pais of ["", "ar", "ARG"]) {
        expect(
          documentoDeParteDesdeDatos("HUMANA", { tipo, numero: "ABC123456", pais }),
          `${tipo} ${pais}`,
        ).toEqual(error("PAIS_INVALIDO"));
      }
    }
  });

  it("una empresa solo admite CUIT o documento extranjero", () => {
    for (const [tipo, pais] of [
      ["DNI", null],
      ["CUIL", null],
      ["CDI", null],
      ["PASAPORTE", "AR"],
    ] as const) {
      expect(
        documentoDeParteDesdeDatos("JURIDICA", { tipo, numero: "12345678", pais }),
        tipo,
      ).toEqual(error("DOCUMENTO_NO_ADMITIDO_PARA_EMPRESA"));
    }
  });

  it("un tipo desconocido, antes que cualquier otra cosa", () => {
    expect(documentoDeParteDesdeDatos("JURIDICA", { tipo: "LE", numero: "1" })).toEqual(
      error("TIPO_DE_DOCUMENTO_INVALIDO"),
    );
    expect(documentoDeParteDesdeDatos("HUMANA", { tipo: "", numero: "1" })).toEqual(
      error("TIPO_DE_DOCUMENTO_INVALIDO"),
    );
  });
});

describe("documentoNormalizado (la columna generada de la base)", () => {
  it("CUIT, CUIL y CDI con el mismo número son el mismo documento", () => {
    const n = (tipo: "CUIT" | "CUIL" | "CDI") =>
      documentoNormalizado({ tipo, pais: null, numero: "30712345671" });
    expect(n("CUIT")).toBe("T30712345671");
    expect(n("CUIL")).toBe("T30712345671");
    expect(n("CDI")).toBe("T30712345671");
  });
  it("DNI, pasaporte y documento extranjero", () => {
    expect(documentoNormalizado({ tipo: "DNI", pais: null, numero: "12345678" })).toBe("D12345678");
    expect(documentoNormalizado({ tipo: "PASAPORTE", pais: "AR", numero: "ABC123456" })).toBe(
      "PAR:ABC123456",
    );
    expect(documentoNormalizado({ tipo: "ID_EXTRANJERO", pais: "CL", numero: "RUT123" })).toBe(
      "ICL:RUT123",
    );
  });
  it("el mismo número en otro país es otro documento", () => {
    expect(documentoNormalizado({ tipo: "PASAPORTE", pais: "AR", numero: "ABC123456" })).not.toBe(
      documentoNormalizado({ tipo: "PASAPORTE", pais: "UY", numero: "ABC123456" }),
    );
  });
});
