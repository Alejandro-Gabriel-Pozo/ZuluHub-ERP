import { describe, expect, it } from "vitest";
import {
  LARGO_MAXIMO_DE_LA_NOTA_DE_PARTE,
  LARGO_MAXIMO_DEL_ALIAS_DE_PARTE,
  LARGO_MAXIMO_DEL_APELLIDO_DE_PARTE,
  validarDatosDeParte,
  type EntradaDeParte,
} from "./datos-de-parte";

const persona: EntradaDeParte = { naturaleza: "HUMANA", nombre: "Juan", apellido: "Pérez" };
const empresa: EntradaDeParte = { naturaleza: "JURIDICA", nombre: "Distribuidora Sur SA" };
const domicilioAr = {
  calle: "Av. Corrientes",
  numero: "1234",
  localidad: "Rosario",
  provincia: "AR-S",
};

const errores = (entrada: EntradaDeParte) => {
  const r = validarDatosDeParte(entrada);
  return r.ok ? [] : r.error;
};

describe("validarDatosDeParte: los datos mínimos", () => {
  it("una persona con nombre y apellido; todo lo opcional queda null", () => {
    expect(validarDatosDeParte(persona)).toEqual({
      ok: true,
      valor: {
        naturaleza: "HUMANA",
        nombre: "Juan",
        apellido: "Pérez",
        alias: null,
        documento: null,
        condicionIva: null,
        email: null,
        telefono: null,
        domicilio: null,
        nota: null,
      },
    });
  });

  it("una empresa solo con su razón social", () => {
    const r = validarDatosDeParte(empresa);
    expect(r.ok && r.valor).toMatchObject({
      naturaleza: "JURIDICA",
      nombre: "Distribuidora Sur SA",
      apellido: null,
    });
  });

  it("los opcionales vacíos, en blanco o nulos quedan null", () => {
    const r = validarDatosDeParte({
      ...persona,
      apellido: "  ",
      alias: "",
      documento: null,
      condicionIva: " ",
      email: null,
      telefono: "   ",
      domicilio: null,
      nota: "",
    });
    expect(r.ok && r.valor).toMatchObject({
      apellido: null,
      alias: null,
      documento: null,
      condicionIva: null,
      email: null,
      telefono: null,
      domicilio: null,
      nota: null,
    });
  });

  it("la naturaleza inválida es el único error que se informa", () => {
    expect(errores({ naturaleza: "OTRA", nombre: "" })).toEqual([
      { campo: "naturaleza", codigo: "NATURALEZA_INVALIDA" },
    ]);
  });
});

describe("validarDatosDeParte: nombre", () => {
  it("vacío es NOMBRE_REQUERIDO; lo demás inválido es NOMBRE_INVALIDO", () => {
    expect(errores({ ...persona, nombre: "" })).toEqual([
      { campo: "nombre", codigo: "NOMBRE_REQUERIDO" },
    ]);
    expect(errores({ ...persona, nombre: "   " })).toEqual([
      { campo: "nombre", codigo: "NOMBRE_REQUERIDO" },
    ]);
    for (const nombre of ["<b>Juan</b>", "12345", "J".repeat(201)]) {
      expect(errores({ ...persona, nombre }), nombre).toEqual([
        { campo: "nombre", codigo: "NOMBRE_INVALIDO" },
      ]);
    }
  });

  it("recorta y colapsa los espacios", () => {
    const r = validarDatosDeParte({ ...persona, nombre: "  Juan   Carlos " });
    expect(r.ok && r.valor.nombre).toBe("Juan Carlos");
  });
});

describe("validarDatosDeParte: apellido y alias", () => {
  it("una empresa no tiene apellido", () => {
    expect(errores({ ...empresa, apellido: "Pérez" })).toEqual([
      { campo: "apellido", codigo: "APELLIDO_SOLO_DE_PERSONA" },
    ]);
    expect(errores({ ...empresa, apellido: " " })).toEqual([]);
  });

  it("el apellido llega a 100 caracteres, no a 101, y exige una letra", () => {
    expect(LARGO_MAXIMO_DEL_APELLIDO_DE_PARTE).toBe(100);
    expect(errores({ ...persona, apellido: "P".repeat(100) })).toEqual([]);
    expect(errores({ ...persona, apellido: "P".repeat(101) })).toEqual([
      { campo: "apellido", codigo: "APELLIDO_INVALIDO" },
    ]);
    expect(errores({ ...persona, apellido: "123" })).toEqual([
      { campo: "apellido", codigo: "APELLIDO_INVALIDO" },
    ]);
  });

  it("el alias llega a 100 caracteres, no a 101", () => {
    expect(LARGO_MAXIMO_DEL_ALIAS_DE_PARTE).toBe(100);
    expect(errores({ ...persona, alias: "A".repeat(100) })).toEqual([]);
    expect(errores({ ...persona, alias: "A".repeat(101) })).toEqual([
      { campo: "alias", codigo: "ALIAS_INVALIDO" },
    ]);
    expect(errores({ ...empresa, alias: "El Sur" })).toEqual([]);
  });
});

describe("validarDatosDeParte: documento, condición, email, teléfono y nota", () => {
  it("el documento se valida con la naturaleza", () => {
    const r = validarDatosDeParte({
      ...empresa,
      documento: { tipo: "CUIT", numero: "30-71234567-1" },
    });
    expect(r.ok && r.valor.documento).toEqual({ tipo: "CUIT", pais: null, numero: "30712345671" });
    expect(errores({ ...empresa, documento: { tipo: "DNI", numero: "12345678" } })).toEqual([
      { campo: "documento", codigo: "DOCUMENTO_NO_ADMITIDO_PARA_EMPRESA" },
    ]);
    expect(errores({ ...persona, documento: { tipo: "CUIT", numero: "1" } })).toEqual([
      { campo: "documento", codigo: "CUIT_INVALIDO" },
    ]);
  });

  it("la condición frente al IVA es una de las once de ARCA", () => {
    const r = validarDatosDeParte({ ...persona, condicionIva: "RESPONSABLE_INSCRIPTO" });
    expect(r.ok && r.valor.condicionIva).toBe("RESPONSABLE_INSCRIPTO");
    expect(errores({ ...persona, condicionIva: "responsable" })).toEqual([
      { campo: "condicionIva", codigo: "CONDICION_IVA_INVALIDA" },
    ]);
  });

  it("el email se normaliza y se valida", () => {
    const r = validarDatosDeParte({ ...persona, email: " Juan@Mail.COM " });
    expect(r.ok && r.valor.email).toBe("juan@mail.com");
    expect(errores({ ...persona, email: "sin-arroba" })).toEqual([
      { campo: "email", codigo: "EMAIL_INVALIDO" },
    ]);
  });

  it("el teléfono es una línea de hasta 40 caracteres", () => {
    const r = validarDatosDeParte({ ...persona, telefono: " +54 11 4321-0000 " });
    expect(r.ok && r.valor.telefono).toBe("+54 11 4321-0000");
    expect(errores({ ...persona, telefono: "1".repeat(41) })).toEqual([
      { campo: "telefono", codigo: "TELEFONO_INVALIDO" },
    ]);
    expect(errores({ ...persona, telefono: "43\n21" })).toEqual([
      { campo: "telefono", codigo: "TELEFONO_INVALIDO" },
    ]);
  });

  it("la nota llega a 2000 caracteres, no a 2001", () => {
    expect(LARGO_MAXIMO_DE_LA_NOTA_DE_PARTE).toBe(2000);
    expect(errores({ ...persona, nota: "a".repeat(2000) })).toEqual([]);
    expect(errores({ ...persona, nota: "a".repeat(2001) })).toEqual([
      { campo: "nota", codigo: "NOTA_INVALIDA" },
    ]);
    expect(errores({ ...persona, nota: "<script>" })).toEqual([
      { campo: "nota", codigo: "NOTA_INVALIDA" },
    ]);
    const solaConNumeros = validarDatosDeParte({ ...persona, nota: "30 60 90" });
    expect(solaConNumeros.ok && solaConNumeros.valor.nota).toBe("30 60 90");
    const r = validarDatosDeParte({ ...persona, nota: "Paga a 30 días" });
    expect(r.ok && r.valor.nota).toBe("Paga a 30 días");
  });
});

describe("validarDatosDeParte: domicilio", () => {
  it("argentino estructurado", () => {
    const r = validarDatosDeParte({
      ...persona,
      domicilio: { pais: "AR", estructurado: domicilioAr },
    });
    expect(r.ok && r.valor.domicilio).toEqual({
      pais: "AR",
      estructurado: {
        calle: "Av. Corrientes",
        numero: "1234",
        piso: null,
        departamento: null,
        localidad: "Rosario",
        provincia: "AR-S",
        codigoPostal: null,
      },
    });
  });

  it("del exterior: una línea de texto", () => {
    const r = validarDatosDeParte({
      ...persona,
      domicilio: { pais: "BR", texto: "Rua Augusta 100, São Paulo" },
    });
    expect(r.ok && r.valor.domicilio).toEqual({ pais: "BR", texto: "Rua Augusta 100, São Paulo" });
  });

  it("del exterior con estructura en null y texto: pasa (null es «sin estructura»)", () => {
    const r = validarDatosDeParte({
      ...persona,
      domicilio: { pais: "BR", texto: "Rua Augusta 100", estructurado: null },
    });
    expect(r.ok && r.valor.domicilio).toEqual({ pais: "BR", texto: "Rua Augusta 100" });
  });

  it("los textos del domicilio también tienen que estar en la lista de permitidos de la base", () => {
    for (const campo of ["calle", "localidad"] as const) {
      expect(
        errores({
          ...persona,
          domicilio: { pais: "AR", estructurado: { ...domicilioAr, [campo]: "Av. <Sur>" } },
        }),
        campo,
      ).toEqual([{ campo: "domicilio", codigo: "DOMICILIO_INVALIDO" }]);
    }
    expect(
      errores({
        ...persona,
        domicilio: { pais: "AR", estructurado: { ...domicilioAr, piso: "5*", departamento: "B" } },
      }),
    ).toEqual([{ campo: "domicilio", codigo: "DOMICILIO_INVALIDO" }]);
    // El primer carácter no puede ser `+` ni `-` (la base lo rechaza); adentro del texto sí.
    for (const calle of ["+Av. Sur", "-Av. Sur"]) {
      expect(
        errores({ ...persona, domicilio: { pais: "AR", estructurado: { ...domicilioAr, calle } } }),
        calle,
      ).toEqual([{ campo: "domicilio", codigo: "DOMICILIO_INVALIDO" }]);
    }
    expect(
      errores({
        ...persona,
        domicilio: {
          pais: "AR",
          estructurado: { ...domicilioAr, calle: "Av. 9 de Julio - Norte" },
        },
      }),
    ).toEqual([]);
    expect(
      errores({
        ...persona,
        domicilio: { pais: "AR", estructurado: { ...domicilioAr, piso: "5", departamento: "B/2" } },
      }),
    ).toEqual([]);
  });

  it("se rechaza el país inválido, el argentino sin estructura o con texto, el del exterior sin texto o con estructura", () => {
    const malo = [
      { pais: "AR" },
      { pais: "AR", estructurado: null, texto: "algo" },
      { pais: "AR", estructurado: null },
      { pais: "AR", estructurado: { ...domicilioAr, provincia: "ZZ" } },
      { pais: "AR", estructurado: domicilioAr, texto: "algo" },
      { pais: "BR" },
      { pais: "BR", texto: "  " },
      { pais: "BR", texto: "x".repeat(301) },
      { pais: "BR", texto: "Rua 1", estructurado: domicilioAr },
    ];
    for (const domicilio of malo) {
      expect(errores({ ...persona, domicilio }), JSON.stringify(domicilio)).toEqual([
        { campo: "domicilio", codigo: "DOMICILIO_INVALIDO" },
      ]);
    }
    expect(errores({ ...persona, domicilio: { pais: "ar", estructurado: domicilioAr } })).toEqual([
      { campo: "domicilio", codigo: "PAIS_INVALIDO" },
    ]);
  });
});

describe("validarDatosDeParte: varios errores a la vez", () => {
  it("los informa todos, uno por campo, en el orden del formulario", () => {
    expect(
      errores({
        naturaleza: "HUMANA",
        nombre: "",
        alias: "1",
        documento: { tipo: "DNI", numero: "1" },
        condicionIva: "X",
        email: "x",
        telefono: "4\n3",
        nota: "<",
      }),
    ).toEqual([
      { campo: "nombre", codigo: "NOMBRE_REQUERIDO" },
      { campo: "alias", codigo: "ALIAS_INVALIDO" },
      { campo: "documento", codigo: "DNI_INVALIDO" },
      { campo: "condicionIva", codigo: "CONDICION_IVA_INVALIDA" },
      { campo: "email", codigo: "EMAIL_INVALIDO" },
      { campo: "telefono", codigo: "TELEFONO_INVALIDO" },
      { campo: "nota", codigo: "NOTA_INVALIDA" },
    ]);
  });
});
