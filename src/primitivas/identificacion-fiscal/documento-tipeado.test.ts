import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import {
  numeroDeDocumentoDesdeTexto,
  TIPOS_DE_DOCUMENTO_DE_IDENTIDAD,
  type TipoDeDocumentoDeIdentidad,
} from "./documento";
import {
  documentoMientrasSeEscribe,
  escribirDocumento,
  interpretarDocumentoPegado,
} from "./documento-tipeado";

/** Escribe `texto` tecla por tecla sobre un campo vacío; el cursor va detrás de lo último escrito. */
function escribirTeclaPorTecla(tipo: TipoDeDocumentoDeIdentidad, texto: string) {
  let actual = { texto: "", canonico: "", cursor: 0 };
  for (const tecla of texto) {
    const crudo = actual.texto.slice(0, actual.cursor) + tecla + actual.texto.slice(actual.cursor);
    actual = escribirDocumento(tipo, crudo, actual.cursor + 1);
  }
  return actual;
}

describe("escribirDocumento: el sistema pone los guiones y los puntos", () => {
  it.each([
    ["CUIT", "20123456786", "20-12345678-6", "20123456786"],
    ["CUIL", "27123456784", "27-12345678-4", "27123456784"],
    ["CDI", "30712345671", "30-71234567-1", "30712345671"],
    ["CUIT", "2", "2", "2"],
    ["CUIT", "20", "20", "20"],
    ["CUIT", "201", "20-1", "201"],
    ["CUIT", "2012345678", "20-12345678", "2012345678"],
    ["DNI", "12345678", "12.345.678", "12345678"],
    ["DNI", "123456", "123.456", "123456"],
    ["DNI", "1234567", "1.234.567", "1234567"],
    ["DNI", "123456789", "123.456.789", "123456789"],
    ["PASAPORTE", "abc123456", "ABC123456", "ABC123456"],
  ] as const)("%s: escribir «%s» se ve «%s» y viaja «%s»", (tipo, escrito, visible, canonico) => {
    const r = escribirTeclaPorTecla(tipo, escrito);
    expect(r.texto).toBe(visible);
    expect(r.canonico).toBe(canonico);
    expect(r.cursor).toBe(visible.length);
  });

  it("los separadores tipeados, las letras en un CUIT o DNI y los espacios no entran", () => {
    expect(escribirTeclaPorTecla("CUIT", "20-1x2 3.4").texto).toBe("20-1234");
    expect(escribirTeclaPorTecla("DNI", "12.345-678abc").texto).toBe("12.345.678");
    expect(escribirTeclaPorTecla("PASAPORTE", "AB-12 3.").texto).toBe("AB123");
  });

  it("no pasa del largo de su tipo", () => {
    expect(escribirTeclaPorTecla("CUIT", "201234567860000").canonico).toBe("20123456786");
    expect(escribirTeclaPorTecla("DNI", "1234567890123").canonico).toBe("123456789");
    expect(escribirTeclaPorTecla("PASAPORTE", "ABCDEFGHIJKL").canonico).toBe("ABCDEFGHI");
  });

  it("el cero inicial del DNI se ignora; en el CUIT y el pasaporte es un dígito más", () => {
    expect(escribirTeclaPorTecla("DNI", "0").texto).toBe("");
    expect(escribirTeclaPorTecla("DNI", "012345678").canonico).toBe("12345678");
    expect(escribirTeclaPorTecla("DNI", "100").canonico).toBe("100");
    expect(escribirTeclaPorTecla("CUIT", "0123").canonico).toBe("0123");
    expect(escribirTeclaPorTecla("PASAPORTE", "012345").canonico).toBe("012345");
  });

  it("vacío o sin nada del tipo no entrega nada", () => {
    for (const tipo of TIPOS_DE_DOCUMENTO_DE_IDENTIDAD) {
      expect(escribirDocumento(tipo, "", 0)).toEqual({ texto: "", canonico: "", cursor: 0 });
    }
    expect(escribirDocumento("CUIT", "abc-.", 5)).toEqual({ texto: "", canonico: "", cursor: 0 });
  });

  it("el cursor no salta: insertar un dígito en el medio lo deja detrás de ese dígito", () => {
    // «20-12» con el cursor entre el 0 y el guion se escribe un 9: «209-12».
    expect(escribirDocumento("CUIT", "209-12", 3)).toEqual({
      texto: "20-912",
      canonico: "20912",
      cursor: 4,
    });
  });

  it("al escribir el tercer dígito aparece el guion y el cursor queda detrás del dígito", () => {
    expect(escribirDocumento("CUIT", "201", 3)).toEqual({
      texto: "20-1",
      canonico: "201",
      cursor: 4,
    });
    expect(escribirDocumento("DNI", "1234", 4)).toEqual({
      texto: "1.234",
      canonico: "1234",
      cursor: 5,
    });
  });

  it("con el cursor al principio, queda al principio; con lo de delante descartado, se acota al texto", () => {
    expect(escribirDocumento("CUIT", "2012", 0).cursor).toBe(0);
    expect(escribirDocumento("DNI", "0012", 3).cursor).toBe(1);
    expect(escribirDocumento("DNI", "0012", 4).cursor).toBe(2);
    expect(escribirDocumento("DNI", "012", 2)).toEqual({ texto: "12", canonico: "12", cursor: 1 });
  });

  it("borrar un guion o un punto no cambia el valor: el sistema lo vuelve a poner y el cursor queda delante", () => {
    // «20-12» con el cursor detrás del guion; Retroceso lo borra → «2012», cursor en 2.
    expect(escribirDocumento("CUIT", "2012", 2)).toEqual({
      texto: "20-12",
      canonico: "2012",
      cursor: 2,
    });
    expect(escribirDocumento("DNI", "1234", 1)).toEqual({
      texto: "1.234",
      canonico: "1234",
      cursor: 1,
    });
  });

  it("para cualquier texto: solo queda lo permitido del tipo y es idempotente", () => {
    for (const tipo of TIPOS_DE_DOCUMENTO_DE_IDENTIDAD) {
      fc.assert(
        fc.property(fc.string(), fc.nat(40), (crudo, cursor) => {
          const r = escribirDocumento(tipo, crudo, cursor);
          expect(r.texto).toBe(documentoMientrasSeEscribe(tipo, r.canonico));
          expect(r.cursor).toBeGreaterThanOrEqual(0);
          expect(r.cursor).toBeLessThanOrEqual(r.texto.length);
          const otra = escribirDocumento(tipo, r.texto, r.texto.length);
          expect(otra.canonico).toBe(r.canonico);
          expect(otra.texto).toBe(r.texto);
          if (tipo === "PASAPORTE") expect(r.canonico).toMatch(/^[A-Z0-9]{0,9}$/);
          else
            expect(r.canonico).toMatch(tipo === "DNI" ? /^(?:[1-9][0-9]{0,8})?$/ : /^[0-9]{0,11}$/);
        }),
      );
    }
  });
});

describe("interpretarDocumentoPegado: sin adivinar", () => {
  it.each([
    ["CUIT", "20-12345678-6", "20-12345678-6", "20123456786"],
    ["CUIT", "20123456786", "20-12345678-6", "20123456786"],
    ["CUIT", "  20123456786\n", "20-12345678-6", "20123456786"],
    ["CUIT", "20-1", "20-1", "201"],
    ["CUIT", "20", "20", "20"],
    ["CUIL", "27123456784", "27-12345678-4", "27123456784"],
    ["CDI", "30-71234567-1", "30-71234567-1", "30712345671"],
    ["DNI", "12345678", "12.345.678", "12345678"],
    ["DNI", "12.345.678", "12.345.678", "12345678"],
    ["DNI", "1.234.567", "1.234.567", "1234567"],
    ["DNI", "123456", "123.456", "123456"],
    ["PASAPORTE", "abc123456", "ABC123456", "ABC123456"],
    ["PASAPORTE", "XY1234", "XY1234", "XY1234"],
    // Palabras que un código descuidado podría tomar por «sin separador»: son pasaportes de letras como cualquier otro.
    ["PASAPORTE", "undefined", "UNDEFINED", "UNDEFINED"],
    ["PASAPORTE", "null12345", "NULL12345", "NULL12345"],
  ] as const)("%s: pegar «%s» entra como «%s»", (tipo, pegado, visible, canonico) => {
    expect(interpretarDocumentoPegado(tipo, pegado)).toEqual({
      ok: true,
      texto: visible,
      canonico,
    });
  });

  it.each([
    ["CUIT", ""],
    ["CUIT", "   "],
    ["CUIT", "20-1234-5678-6"],
    ["CUIT", "2-0123456786"],
    ["CUIT", "20-12345678-"],
    ["CUIT", "20--12345678-6"],
    ["CUIT", "20.12345678.6"],
    ["CUIT", "20 12345678 6"],
    ["CUIT", "201234567866"],
    ["CUIT", "2012345678a"],
    ["CUIT", "-20123456786"],
    ["DNI", "012345678"],
    ["DNI", "1.2345.678"],
    ["DNI", "12.34.5678"],
    ["DNI", "12-345-678"],
    ["DNI", "1234567890"],
    ["DNI", "12.345.678."],
    ["DNI", "12345 678"],
    ["DNI", "abc"],
    ["PASAPORTE", "AB-1234"],
    ["PASAPORTE", "AB.1234"],
    ["PASAPORTE", "AB 1234"],
    ["PASAPORTE", "ABCDEFGHIJ"],
    ["PASAPORTE", "ñ12345"],
  ] as const)("%s: pegar «%s» se rechaza y el campo no cambia", (tipo, pegado) => {
    expect(interpretarDocumentoPegado(tipo, pegado)).toEqual({ ok: false });
  });

  it("lo que muestra el sistema se puede volver a pegar y conserva el valor", () => {
    for (const tipo of TIPOS_DE_DOCUMENTO_DE_IDENTIDAD) {
      fc.assert(
        fc.property(fc.string(), (crudo) => {
          const r = escribirDocumento(tipo, crudo, crudo.length);
          if (r.canonico === "") return;
          expect(interpretarDocumentoPegado(tipo, r.texto)).toEqual({
            ok: true,
            texto: r.texto,
            canonico: r.canonico,
          });
        }),
      );
    }
  });

  it("un documento completo y válido pegado queda aceptado por la primitiva del servidor", () => {
    for (const [tipo, pegado] of [
      ["CUIT", "20-12345678-6"],
      ["DNI", "12.345.678"],
      ["PASAPORTE", "abc123456"],
    ] as const) {
      const r = interpretarDocumentoPegado(tipo, pegado);
      expect(r.ok && numeroDeDocumentoDesdeTexto(tipo, r.canonico)).toEqual({
        ok: true,
        valor: r.ok ? r.canonico : "",
      });
    }
  });
});
