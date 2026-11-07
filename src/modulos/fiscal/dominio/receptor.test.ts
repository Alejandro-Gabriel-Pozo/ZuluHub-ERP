import { describe, expect, it } from "vitest";
import { CUIT_A, CUIT_B, CUIT_C } from "../../../../test/utilidades/fiscal";
import { CONDICIONES_DE_IVA_DEL_RECEPTOR } from "./condicion-iva-receptor";
import type { LetraDeComprobante } from "./comprobante-emitido";
import {
  LIMITES_DE_RECEPTOR,
  numeroDeDocumentoParaArca,
  validarReceptor,
  type DocumentoDelReceptor,
  type Receptor,
} from "./receptor";

const contexto = (letra: LetraDeComprobante) => ({ letra, cuitDelEmisor: CUIT_B });

const inscripto: Receptor = {
  nombre: "Distribuidora Sur SA",
  documento: { tipo: "CUIT", numero: CUIT_C },
  condicionIva: "RESPONSABLE_INSCRIPTO",
  domicilio: "Av. Siempreviva 742",
};

const consumidorFinal: Receptor = {
  nombre: null,
  documento: { tipo: "SIN_IDENTIFICAR" },
  condicionIva: "CONSUMIDOR_FINAL",
  domicilio: null,
};

const conDocumento = (
  documento: DocumentoDelReceptor,
  cambios: Partial<Receptor> = {},
): Receptor => ({
  ...inscripto,
  condicionIva: "CONSUMIDOR_FINAL",
  documento,
  ...cambios,
});

const invalido = (campo: string) => ({
  ok: false,
  error: { codigo: "RECEPTOR_INVALIDO", campo },
});

describe("validarReceptor: lo que acepta", () => {
  it("un inscripto con CUIT en la clase A", () => {
    const r = validarReceptor(inscripto, contexto("A"));
    expect(r).toEqual({ ok: true, valor: inscripto });
  });

  it("el consumidor final sin datos en B y en C: documento sin identificar y nombre ausente", () => {
    for (const letra of ["B", "C"] as const) {
      expect(validarReceptor(consumidorFinal, contexto(letra))).toEqual({
        ok: true,
        valor: consumidorFinal,
      });
    }
  });

  it("sin identificar admite un nombre (se conserva recortado)", () => {
    const r = validarReceptor({ ...consumidorFinal, nombre: "  Mostrador  " }, contexto("B"));
    expect(r).toEqual({ ok: true, valor: { ...consumidorFinal, nombre: "Mostrador" } });
  });

  it("recorta los blancos y vuelve null los textos vacíos", () => {
    const r = validarReceptor(
      { ...inscripto, nombre: "  Distribuidora Sur SA  ", domicilio: "  Av. Siempreviva 742  " },
      contexto("A"),
    );
    expect(r).toEqual({
      ok: true,
      valor: { ...inscripto, nombre: "Distribuidora Sur SA", domicilio: "Av. Siempreviva 742" },
    });
    // El consumidor final sí admite un domicilio en blanco: queda sin domicilio.
    const cf = validarReceptor({ ...consumidorFinal, domicilio: "   " }, contexto("B"));
    expect(cf).toEqual({ ok: true, valor: consumidorFinal });
  });

  it("el domicilio es obligatorio salvo con el consumidor final (RG 1415 Anexo II A.II)", () => {
    for (const domicilio of [null, "", "   "]) {
      expect(
        validarReceptor({ ...inscripto, domicilio }, contexto("A")),
        JSON.stringify(domicilio),
      ).toEqual(invalido("domicilio"));
    }
    // También con un consumidor final IDENTIFICADO: el consumidor final nunca lo necesita.
    const identificado = conDocumento(
      { tipo: "DNI", numero: "12345678" },
      { nombre: "Juana Pérez" },
    );
    expect(validarReceptor(identificado, contexto("B"))).toMatchObject({ ok: true });
    const monotributista = { ...inscripto, condicionIva: "MONOTRIBUTO", domicilio: null } as const;
    expect(validarReceptor(monotributista, contexto("A"))).toEqual(invalido("domicilio"));
  });

  it("un nombre en blanco es «sin nombre»: el consumidor final lo admite y un documento identificado lo exige", () => {
    for (const nombre of ["", "   ", " \t "]) {
      expect(
        validarReceptor({ ...consumidorFinal, nombre }, contexto("B")),
        JSON.stringify(nombre),
      ).toEqual({
        ok: true,
        valor: consumidorFinal,
      });
      expect(
        validarReceptor({ ...inscripto, nombre }, contexto("A")),
        JSON.stringify(nombre),
      ).toEqual(invalido("nombre"));
    }
  });

  it("un CUIT con guiones queda en su forma canónica", () => {
    const r = validarReceptor(
      { ...inscripto, documento: { tipo: "CUIT", numero: "30-71234567-1" } },
      contexto("A"),
    );
    expect(r).toEqual({ ok: true, valor: inscripto });
  });

  it("CUIL, CDI, DNI y pasaporte válidos en B", () => {
    for (const documento of [
      { tipo: "CUIL", numero: CUIT_A },
      { tipo: "CDI", numero: CUIT_A },
      { tipo: "DNI", numero: "12345678" },
      { tipo: "DNI", numero: "123456" },
      { tipo: "DNI", numero: "123456789" },
      { tipo: "PASAPORTE", numero: "123456" },
      { tipo: "PASAPORTE", numero: "ABC123456" },
      { tipo: "PASAPORTE", numero: "A1B2C3D4" },
    ] as const) {
      const r = validarReceptor(conDocumento(documento), contexto("B"));
      expect(r, JSON.stringify(documento)).toEqual({ ok: true, valor: conDocumento(documento) });
    }
  });

  it("el largo exacto de nombre y domicilio entra", () => {
    const nombre = "n".repeat(LIMITES_DE_RECEPTOR.nombre);
    const domicilio = "d".repeat(LIMITES_DE_RECEPTOR.domicilio);
    const r = validarReceptor({ ...inscripto, nombre, domicilio }, contexto("A"));
    expect(r).toEqual({ ok: true, valor: { ...inscripto, nombre, domicilio } });
  });
});

describe("validarReceptor: forma", () => {
  it("un documento identificado exige nombre", () => {
    for (const nombre of [null, "", "   "]) {
      expect(validarReceptor({ ...inscripto, nombre }, contexto("A"))).toEqual(invalido("nombre"));
    }
  });

  it("el nombre y el domicilio no pasan de su límite", () => {
    expect(
      validarReceptor(
        { ...inscripto, nombre: "n".repeat(LIMITES_DE_RECEPTOR.nombre + 1) },
        contexto("A"),
      ),
    ).toEqual(invalido("nombre"));
    expect(
      validarReceptor(
        { ...consumidorFinal, nombre: "n".repeat(LIMITES_DE_RECEPTOR.nombre + 1) },
        contexto("B"),
      ),
    ).toEqual(invalido("nombre"));
    expect(
      validarReceptor(
        { ...inscripto, domicilio: "d".repeat(LIMITES_DE_RECEPTOR.domicilio + 1) },
        contexto("A"),
      ),
    ).toEqual(invalido("domicilio"));
  });

  it("el nombre tiene que tener al menos una letra: solo números o un documento se rechazan (campo nombre)", () => {
    for (const nombre of ["12345678", "30-71234567-1", "30712345671", "-", "&&&"]) {
      expect(validarReceptor({ ...inscripto, nombre }, contexto("A")), nombre).toEqual(
        invalido("nombre"),
      );
    }
    // También sin identificar: si se escribe un nombre, tiene que ser un nombre.
    expect(validarReceptor({ ...consumidorFinal, nombre: "12345678" }, contexto("B"))).toEqual(
      invalido("nombre"),
    );
  });

  it("el nombre y el domicilio sin saltos de línea, invisibles, etiquetas ni emojis (la base los rechaza)", () => {
    for (const texto of ["Juan\nPérez", "Ju\u200ban", "Ju\u202ean", "<b>Juan</b>", "Juan 😀"]) {
      expect(validarReceptor({ ...inscripto, nombre: texto }, contexto("A")), texto).toEqual(
        invalido("nombre"),
      );
      expect(validarReceptor({ ...inscripto, domicilio: texto }, contexto("A")), texto).toEqual(
        invalido("domicilio"),
      );
    }
  });

  it("un nombre o un domicilio que empieza con `=`, `+`, `-` o `@` se rechaza con su campo", () => {
    for (const texto of ["=SUMA(A1)", "+Juan", "-Juan", "@Juan"]) {
      expect(validarReceptor({ ...inscripto, nombre: texto }, contexto("A")), texto).toEqual(
        invalido("nombre"),
      );
      expect(validarReceptor({ ...inscripto, domicilio: texto }, contexto("A")), texto).toEqual(
        invalido("domicilio"),
      );
    }
  });

  it("el nombre y el domicilio quedan en su forma canónica (blancos repetidos, NFC)", () => {
    const r = validarReceptor(
      { ...inscripto, nombre: "  Pérez   e  Hijos ", domicilio: "Av.  Siempreviva   742" },
      contexto("A"),
    );
    expect(r).toEqual({
      ok: true,
      valor: { ...inscripto, nombre: "Pérez e Hijos", domicilio: "Av. Siempreviva 742" },
    });
  });

  it("un nombre en el campo del documento y un documento en el campo del nombre (el caso real del dueño)", () => {
    // Al revés: el CUIT en el nombre y el nombre en el documento. El documento se mira primero.
    const alReves: Receptor = {
      ...inscripto,
      nombre: "30712345671",
      documento: { tipo: "CUIT", numero: "Distribuidora Sur SA" },
    };
    expect(validarReceptor(alReves, contexto("A"))).toEqual(invalido("documento"));
    // Con el documento bien y el CUIT todavía en el nombre, el error marca el nombre.
    expect(validarReceptor({ ...inscripto, nombre: "30712345671" }, contexto("A"))).toEqual(
      invalido("nombre"),
    );
  });

  it("CUIT, CUIL y CDI con dígito verificador inválido o mal formados", () => {
    for (const tipo of ["CUIT", "CUIL", "CDI"] as const) {
      for (const numero of ["30712345672", "123", "", "3071234567a", " 30712345671"]) {
        expect(validarReceptor(conDocumento({ tipo, numero }), contexto("B"))).toEqual(
          invalido("documento"),
        );
      }
    }
  });

  it("DNI: de 6 a 9 dígitos y sin ceros a la izquierda", () => {
    for (const numero of ["12345", "1234567890", "012345678", "1234567a", "", "12 345 678"]) {
      expect(validarReceptor(conDocumento({ tipo: "DNI", numero }), contexto("B"))).toEqual(
        invalido("documento"),
      );
    }
  });

  it("DNI con puntos de miles: se guarda en su forma canónica y con otros separadores se rechaza (Q6)", () => {
    const r = validarReceptor(conDocumento({ tipo: "DNI", numero: "12.345.678" }), contexto("B"));
    expect(r).toMatchObject({
      ok: true,
      valor: { documento: { tipo: "DNI", numero: "12345678" } },
    });
    // Lo que se le informa a ARCA (`DocNro`) es lo mismo con o sin puntos.
    if (r.ok) expect(numeroDeDocumentoParaArca(r.valor.documento)).toBe(12345678n);
    for (const numero of ["12 345 678", "12,345,678", "12.345.67"]) {
      expect(validarReceptor(conDocumento({ tipo: "DNI", numero }), contexto("B"))).toEqual(
        invalido("documento"),
      );
    }
  });

  it("pasaporte: letras y números de 6 a 9; sin cifra, solo ceros, de 5 o de 10 caracteres o con otro carácter se rechaza marcando el documento", () => {
    for (const numero of [
      "",
      "ABCDEF",
      "ABCDEFGHI",
      "ABC000000",
      "000000",
      "ABC12",
      "12345",
      "ABC1234567",
      "1234567890",
      "ABC-12345",
      "ABC 12345",
      " ABC12345",
      "ÑBC123456",
      "-123456",
      "1.5",
      "0",
      "12345678901",
    ]) {
      expect(
        validarReceptor(conDocumento({ tipo: "PASAPORTE", numero }), contexto("B")),
        JSON.stringify(numero),
      ).toEqual(invalido("documento"));
    }
  });

  it("pasaporte: las minúsculas se guardan en mayúsculas y el resto queda tal cual", () => {
    const r = validarReceptor(
      conDocumento({ tipo: "PASAPORTE", numero: "abc123456" }),
      contexto("B"),
    );
    expect(r).toEqual({
      ok: true,
      valor: conDocumento({ tipo: "PASAPORTE", numero: "ABC123456" }),
    });
  });
});

describe("validarReceptor: reglas de ARCA", () => {
  it("la condición tiene que admitir la letra (rechazos 10242 y 10243)", () => {
    // un consumidor final no recibe una A; un inscripto no recibe una B
    expect(
      validarReceptor({ ...inscripto, condicionIva: "CONSUMIDOR_FINAL" }, contexto("A")),
    ).toEqual(invalido("condicionIva"));
    expect(validarReceptor(inscripto, contexto("B"))).toEqual(invalido("condicionIva"));
    // en C todas las condiciones entran
    for (const condicionIva of CONDICIONES_DE_IVA_DEL_RECEPTOR) {
      const r = validarReceptor({ ...inscripto, condicionIva }, contexto("C"));
      expect(r.ok, condicionIva).toBe(true);
    }
  });

  it("la clase A exige documento CUIT (error 10013), no CUIL, CDI ni DNI ni sin identificar", () => {
    for (const documento of [
      { tipo: "CUIL", numero: CUIT_C },
      { tipo: "CDI", numero: CUIT_C },
      { tipo: "DNI", numero: "12345678" },
      { tipo: "SIN_IDENTIFICAR" },
    ] as const) {
      const r = validarReceptor({ ...inscripto, documento }, contexto("A"));
      expect(r, documento.tipo).toEqual({
        ok: false,
        error: { codigo: "RECEPTOR_INVALIDO_PARA_A" },
      });
    }
  });

  it("el documento no puede ser el CUIT del emisor (error 10069), con cualquier tipo identificado", () => {
    for (const tipo of ["CUIT", "CUIL", "CDI"] as const) {
      const r = validarReceptor(conDocumento({ tipo, numero: CUIT_B }), contexto("B"));
      expect(r).toEqual({ ok: false, error: { codigo: "RECEPTOR_IGUAL_AL_EMISOR" } });
    }
    // con un guion también: se compara la forma canónica
    const conGuiones = validarReceptor(
      conDocumento({ tipo: "CUIT", numero: "30-70853393-5" }),
      contexto("B"),
    );
    expect(conGuiones).toEqual({ ok: false, error: { codigo: "RECEPTOR_IGUAL_AL_EMISOR" } });
    // otro CUIT sí
    expect(validarReceptor(conDocumento({ tipo: "CUIT", numero: CUIT_A }), contexto("B")).ok).toBe(
      true,
    );
  });

  it("sujeto no categorizado en B se rechaza (error 10067 de ARCA); en C se admite", () => {
    const noCategorizado: Receptor = { ...inscripto, condicionIva: "NO_CATEGORIZADO" };
    expect(validarReceptor(noCategorizado, contexto("B"))).toEqual({
      ok: false,
      error: { codigo: "RECEPTOR_NO_CATEGORIZADO_NO_SOPORTADO" },
    });
    expect(validarReceptor(noCategorizado, contexto("C"))).toEqual({
      ok: true,
      valor: noCategorizado,
    });
  });

  it("devuelve el primer error: documento, nombre, domicilio, condición, A, emisor, no categorizado", () => {
    const todoMal: Receptor = {
      nombre: null,
      documento: { tipo: "CUIT", numero: "1" },
      condicionIva: "CONSUMIDOR_FINAL",
      domicilio: "d".repeat(LIMITES_DE_RECEPTOR.domicilio + 1),
    };
    expect(validarReceptor(todoMal, contexto("A"))).toEqual(invalido("documento"));
    const sinNombre = { ...todoMal, documento: { tipo: "CUIT", numero: CUIT_B } } as const;
    expect(validarReceptor(sinNombre, contexto("A"))).toEqual(invalido("nombre"));
    const sinDomicilioValido = { ...sinNombre, nombre: "X" };
    expect(validarReceptor(sinDomicilioValido, contexto("A"))).toEqual(invalido("domicilio"));
    const condicion = { ...sinDomicilioValido, domicilio: null };
    expect(validarReceptor(condicion, contexto("A"))).toEqual(invalido("condicionIva"));
    const inscriptoSinDomicilio = { ...condicion, condicionIva: "RESPONSABLE_INSCRIPTO" } as const;
    expect(validarReceptor(inscriptoSinDomicilio, contexto("A"))).toEqual(invalido("domicilio"));
    const para = { ...inscriptoSinDomicilio, domicilio: "Av. Siempreviva 742" } as const;
    expect(
      validarReceptor({ ...para, documento: { tipo: "DNI", numero: "12345678" } }, contexto("A")),
    ).toEqual({
      ok: false,
      error: { codigo: "RECEPTOR_INVALIDO_PARA_A" },
    });
    expect(validarReceptor(para, contexto("A"))).toEqual({
      ok: false,
      error: { codigo: "RECEPTOR_IGUAL_AL_EMISOR" },
    });
  });
});

describe("numeroDeDocumentoParaArca", () => {
  it("es el número como entero, o cero sin identificar", () => {
    expect(numeroDeDocumentoParaArca({ tipo: "SIN_IDENTIFICAR" })).toBe(0n);
    expect(numeroDeDocumentoParaArca({ tipo: "CUIT", numero: CUIT_C })).toBe(30712345671n);
    expect(numeroDeDocumentoParaArca({ tipo: "DNI", numero: "12345678" })).toBe(12345678n);
    // Un pasaporte ya guardado antes de las letras (solo dígitos, de cualquier largo de 1 a 11) da el mismo número que siempre.
    expect(numeroDeDocumentoParaArca({ tipo: "PASAPORTE", numero: "007" })).toBe(7n);
    // Un pasaporte en cero nunca llega a ARCA como 0 («sin identificar»): lanza.
    expect(() => numeroDeDocumentoParaArca({ tipo: "PASAPORTE", numero: "0" })).toThrow(RangeError);
  });

  it("fail closed: solo el pasaporte extrae cifras; un DNI, CUIT o CUIL con letras lanza como siempre y un pasaporte sin cifra o en cero también", () => {
    // Violaciones inyectadas: si la cuenta extrajera cifras de cualquier tipo, estos devolverían un número en lugar de lanzar.
    for (const tipo of ["DNI", "CUIT", "CUIL", "CDI"] as const) {
      expect(() => numeroDeDocumentoParaArca({ tipo, numero: "ABC123456" }), tipo).toThrow(
        SyntaxError,
      );
    }
    expect(() => numeroDeDocumentoParaArca({ tipo: "CUIT", numero: "30abc712345671" })).toThrow(
      SyntaxError,
    );
    for (const numero of ["ABC000000", "ABCDEF", "", "000000"]) {
      expect(() => numeroDeDocumentoParaArca({ tipo: "PASAPORTE", numero }), numero).toThrow(
        RangeError,
      );
    }
  });

  it("un pasaporte con letras informa solo la parte numérica, en orden y sin los ceros de la izquierda", () => {
    const de = (numero: string) => numeroDeDocumentoParaArca({ tipo: "PASAPORTE", numero });
    expect(de("ABC123456")).toBe(123456n);
    expect(de("AAB000123")).toBe(123n);
    expect(de("A1B2C3D4")).toBe(1234n);
  });
});
