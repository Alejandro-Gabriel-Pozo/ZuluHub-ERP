import { describe, expect, it } from "vitest";
import {
  DOMICILIO_1,
  DOMICILIO_2,
  EMISOR_1,
  EMISOR_2,
  EMPRESA,
  GERENTE,
  VERSION_1,
  VERSION_2,
} from "../../../../test/utilidades/fiscal";
import {
  CONDICIONES_DE_IIBB,
  LIMITES_DE_DATOS_FISCALES,
  borradorDesdeConfirmada,
  confirmarDatosFiscales,
  editarBorrador,
  esCondicionDeIibb,
  fechaCivilValida,
  nuevoBorrador,
  type CambiosDeBorrador,
  type DatosFiscalesBorrador,
  type DatosFiscalesConfirmados,
} from "./datos-fiscales";

const vacio = nuevoBorrador({
  id: VERSION_1,
  empresaId: EMPRESA,
  emisorId: EMISOR_1,
  creadoPor: GERENTE,
});

function editado(cambios: CambiosDeBorrador, desde: DatosFiscalesBorrador = vacio) {
  const r = editarBorrador(desde, cambios);
  if (!r.ok) throw new Error(`se esperaba un borrador válido y dio ${JSON.stringify(r.error)}`);
  return r.valor;
}

const completo = editado({
  razonSocial: "Hotel Sur SA",
  condicionIva: "RESPONSABLE_INSCRIPTO",
  domicilioFiscalId: DOMICILIO_1,
  inicioActividades: "2015-03-01",
  iibbNumero: "901-123456-7",
  iibbCondicion: "LOCAL",
});

const t = (ms: number) => new Date(ms);

describe("borradores", () => {
  it("un borrador nuevo está vacío y es la versión 1 de la fila", () => {
    expect(vacio).toEqual({
      id: VERSION_1,
      empresaId: EMPRESA,
      emisorId: EMISOR_1,
      razonSocial: null,
      condicionIva: null,
      domicilioFiscalId: null,
      inicioActividades: null,
      iibbNumero: null,
      iibbCondicion: null,
      creadoPor: GERENTE,
      version: 1,
    });
  });

  it("editar un borrador completa campos y normaliza el texto", () => {
    expect(
      editado({
        razonSocial: "  Hotel Sur SA ",
        condicionIva: "MONOTRIBUTO",
        domicilioFiscalId: DOMICILIO_2,
        inicioActividades: "2020-02-29",
        iibbNumero: " 123 ",
        iibbCondicion: "CONVENIO_MULTILATERAL",
      }),
    ).toEqual({
      ...vacio,
      razonSocial: "Hotel Sur SA",
      condicionIva: "MONOTRIBUTO",
      domicilioFiscalId: DOMICILIO_2,
      inicioActividades: "2020-02-29",
      iibbNumero: "123",
      iibbCondicion: "CONVENIO_MULTILATERAL",
    });
  });

  it("lo que no se menciona no se toca", () => {
    expect(editado({}, completo)).toEqual(completo);
    expect(editado({ razonSocial: "Otra SA" }, completo)).toEqual({
      ...completo,
      razonSocial: "Otra SA",
    });
    expect(editado({ condicionIva: "EXENTO" }, completo).razonSocial).toBe("Hotel Sur SA");
    expect(editado({ inicioActividades: "2016-01-01" }, completo).condicionIva).toBe(
      "RESPONSABLE_INSCRIPTO",
    );
    expect(editado({ domicilioFiscalId: DOMICILIO_2 }, completo).inicioActividades).toBe(
      "2015-03-01",
    );
  });

  it("los opcionales de IIBB se borran con null o en blanco", () => {
    for (const vaciar of [null, "", "   "]) {
      const r = editado({ iibbNumero: vaciar, iibbCondicion: vaciar }, completo);
      expect(r.iibbNumero).toBeNull();
      expect(r.iibbCondicion).toBeNull();
    }
  });

  it("el número de IIBB no toca la condición y viceversa", () => {
    expect(editado({ iibbNumero: null }, completo).iibbCondicion).toBe("LOCAL");
    expect(editado({ iibbCondicion: null }, completo).iibbNumero).toBe("901-123456-7");
  });

  it("un borrador desde una versión confirmada copia los valores y arranca en la versión 1", () => {
    const confirmada = confirmar(completo, []);
    expect(borradorDesdeConfirmada(confirmada, { id: VERSION_2, creadoPor: GERENTE })).toEqual({
      ...completo,
      id: VERSION_2,
      version: 1,
    });
  });
});

describe("editarBorrador: cada regla con su caso inválido", () => {
  const casos: [string, CambiosDeBorrador, string][] = [
    ["razón social vacía", { razonSocial: "" }, "RAZON_SOCIAL_INVALIDA"],
    ["razón social en blanco", { razonSocial: "   " }, "RAZON_SOCIAL_INVALIDA"],
    ["razón social con salto de línea", { razonSocial: "Sur\nSA" }, "RAZON_SOCIAL_INVALIDA"],
    ["razón social demasiado larga", { razonSocial: "a".repeat(201) }, "RAZON_SOCIAL_INVALIDA"],
    [
      "condición de IVA desconocida",
      { condicionIva: "CONSUMIDOR_FINAL" },
      "CONDICION_IVA_INVALIDA",
    ],
    ["condición de IVA en minúsculas", { condicionIva: "exento" }, "CONDICION_IVA_INVALIDA"],
    ["condición de IVA vacía", { condicionIva: "" }, "CONDICION_IVA_INVALIDA"],
    [
      "inicio de actividades con otro formato",
      { inicioActividades: "01/03/2015" },
      "INICIO_DE_ACTIVIDADES_INVALIDO",
    ],
    [
      "inicio de actividades inexistente",
      { inicioActividades: "2015-02-30" },
      "INICIO_DE_ACTIVIDADES_INVALIDO",
    ],
    ["inicio de actividades vacío", { inicioActividades: "" }, "INICIO_DE_ACTIVIDADES_INVALIDO"],
    ["número de IIBB con salto de línea", { iibbNumero: "1\n2" }, "IIBB_NUMERO_INVALIDO"],
    ["número de IIBB demasiado largo", { iibbNumero: "1".repeat(31) }, "IIBB_NUMERO_INVALIDO"],
    ["condición de IIBB desconocida", { iibbCondicion: "TOTAL" }, "IIBB_CONDICION_INVALIDA"],
    ["condición de IIBB en minúsculas", { iibbCondicion: "local" }, "IIBB_CONDICION_INVALIDA"],
  ];

  it.each(casos)("%s", (_nombre, cambios, error) => {
    expect(editarBorrador(vacio, cambios)).toEqual({ ok: false, error });
  });

  it("los límites exactos entran", () => {
    expect(LIMITES_DE_DATOS_FISCALES).toEqual({ razonSocial: 200, iibbNumero: 30 });
    expect(editado({ razonSocial: "a".repeat(200) }).razonSocial).toHaveLength(200);
    expect(editado({ iibbNumero: "1".repeat(30) }).iibbNumero).toHaveLength(30);
  });

  it("gana el primer error: razón social, condición de IVA, inicio, número de IIBB, condición de IIBB", () => {
    let cambios: CambiosDeBorrador = {
      razonSocial: "",
      condicionIva: "x",
      inicioActividades: "x",
      iibbNumero: "a\nb",
      iibbCondicion: "x",
    };
    const esperados = [
      "RAZON_SOCIAL_INVALIDA",
      "CONDICION_IVA_INVALIDA",
      "INICIO_DE_ACTIVIDADES_INVALIDO",
      "IIBB_NUMERO_INVALIDO",
      "IIBB_CONDICION_INVALIDA",
    ];
    const arreglos: CambiosDeBorrador[] = [
      { razonSocial: "Sur" },
      { condicionIva: "EXENTO" },
      { inicioActividades: "2015-01-01" },
      { iibbNumero: "1" },
    ];
    for (const [i, error] of esperados.entries()) {
      expect(editarBorrador(vacio, cambios)).toEqual({ ok: false, error });
      cambios = { ...cambios, ...arreglos[i] };
    }
  });

  it("un error no modifica el borrador original", () => {
    editarBorrador(completo, { razonSocial: "" });
    expect(completo.razonSocial).toBe("Hotel Sur SA");
  });
});

describe("condiciones de IIBB (valores NO VERIFICADOS, configurables)", () => {
  it("son las del supuesto del diseño", () => {
    expect(CONDICIONES_DE_IIBB).toEqual(["LOCAL", "CONVENIO_MULTILATERAL", "EXENTO"]);
    for (const c of CONDICIONES_DE_IIBB) expect(esCondicionDeIibb(c)).toBe(true);
    expect(esCondicionDeIibb("local")).toBe(false);
    expect(esCondicionDeIibb("")).toBe(false);
  });
});

describe("fechaCivilValida", () => {
  it.each([
    "2015-03-01",
    "2024-02-29",
    "2000-02-29",
    "1999-12-31",
    "2023-01-31",
    "2023-04-30",
    "0001-01-01",
    "9999-12-31",
  ])("%s es válida", (f) => {
    expect(fechaCivilValida(f)).toBe(true);
  });

  it.each([
    "2023-02-29",
    "1900-02-29",
    "2100-02-29",
    "2023-04-31",
    "2023-06-31",
    "2023-09-31",
    "2023-11-31",
    "2023-01-32",
    "2023-13-01",
    "2023-00-10",
    "2023-01-00",
    "0000-01-01",
    "2023-1-01",
    "2023-01-1",
    "23-01-01",
    "2023/01/01",
    "2023-01-01 ",
    " 2023-01-01",
    "2023-01-01T00:00:00Z",
    "",
    "abc",
  ])("%j no es válida", (f) => {
    expect(fechaCivilValida(f)).toBe(false);
  });

  it("los meses de 31 días llegan a 31 y febrero bisiesto a 29", () => {
    for (const mes of ["01", "03", "05", "07", "08", "10", "12"]) {
      expect(fechaCivilValida(`2023-${mes}-31`)).toBe(true);
    }
    for (const mes of ["04", "06", "09", "11"]) {
      expect(fechaCivilValida(`2023-${mes}-30`)).toBe(true);
      expect(fechaCivilValida(`2023-${mes}-31`)).toBe(false);
    }
    expect(fechaCivilValida("2023-02-28")).toBe(true);
    expect(fechaCivilValida("2024-02-29")).toBe(true);
    expect(fechaCivilValida("2024-02-30")).toBe(false);
  });
});

function confirmar(
  borrador: DatosFiscalesBorrador,
  existentes: readonly DatosFiscalesConfirmados[],
  datos: { vigenteDesde?: Date; motivo?: string } = {},
): DatosFiscalesConfirmados {
  const r = confirmarDatosFiscales(borrador, existentes, {
    ahora: t(1000),
    vigenteDesde: datos.vigenteDesde ?? t(1000),
    motivo: datos.motivo ?? "alta",
    confirmadaPor: GERENTE,
  });
  if (!r.ok) throw new Error(`se esperaba confirmar y dio ${JSON.stringify(r.error)}`);
  return r.valor;
}

describe("confirmarDatosFiscales", () => {
  it("congela los datos en una versión numerada con su vigencia y quién la confirmó", () => {
    const c = confirmar(completo, [], { vigenteDesde: t(5000), motivo: "  alta inicial " });
    expect(c).toEqual({
      id: VERSION_1,
      empresaId: EMPRESA,
      emisorId: EMISOR_1,
      numero: 1,
      razonSocial: "Hotel Sur SA",
      condicionIva: "RESPONSABLE_INSCRIPTO",
      domicilioFiscalId: DOMICILIO_1,
      inicioActividades: "2015-03-01",
      iibbNumero: "901-123456-7",
      iibbCondicion: "LOCAL",
      vigenteDesde: t(5000),
      confirmadaEn: t(1000),
      confirmadaPor: GERENTE,
      motivo: "alta inicial",
      version: 1,
    });
  });

  it("los datos de IIBB son opcionales", () => {
    const sinIibb = editado({ iibbNumero: null, iibbCondicion: null }, completo);
    const c = confirmar(sinIibb, []);
    expect(c.iibbNumero).toBeNull();
    expect(c.iibbCondicion).toBeNull();
  });

  it("el número es el máximo + 1 de las versiones del emisor", () => {
    const v1 = confirmar(completo, []);
    const v2 = confirmar({ ...completo, id: VERSION_2 }, [v1]);
    expect(v2.numero).toBe(2);
    expect(confirmar({ ...completo, id: VERSION_2 }, [{ ...v1, numero: 7 }]).numero).toBe(8);
  });

  it("conserva la versión de fila del borrador (la base la sube)", () => {
    expect(confirmar({ ...completo, version: 4 }, []).version).toBe(4);
  });

  it("sin datos obligatorios informa cuáles faltan, en orden", () => {
    const todos = ["razonSocial", "condicionIva", "domicilioFiscalId", "inicioActividades"];
    const inc = (b: DatosFiscalesBorrador) =>
      confirmarDatosFiscales(b, [], {
        ahora: t(1),
        vigenteDesde: t(1),
        motivo: "x",
        confirmadaPor: GERENTE,
      });
    expect(inc(vacio)).toEqual({
      ok: false,
      error: { codigo: "DATOS_FISCALES_INCOMPLETOS", faltantes: todos },
    });
    for (const [i, campo] of todos.entries()) {
      const borrador = { ...completo, [campo]: null } as DatosFiscalesBorrador;
      expect(inc(borrador)).toEqual({
        ok: false,
        error: { codigo: "DATOS_FISCALES_INCOMPLETOS", faltantes: [todos[i]] },
      });
    }
  });

  it("lo incompleto se informa antes que el motivo y la vigencia", () => {
    expect(
      confirmarDatosFiscales(vacio, [], {
        ahora: t(1000),
        vigenteDesde: t(0),
        motivo: "",
        confirmadaPor: GERENTE,
      }),
    ).toMatchObject({ ok: false, error: { codigo: "DATOS_FISCALES_INCOMPLETOS" } });
  });

  it("el motivo es obligatorio", () => {
    expect(
      confirmarDatosFiscales(completo, [], {
        ahora: t(1000),
        vigenteDesde: t(1000),
        motivo: " ",
        confirmadaPor: GERENTE,
      }),
    ).toEqual({ ok: false, error: "MOTIVO_OBLIGATORIO" });
  });

  it("sin vigencia retroactiva", () => {
    expect(
      confirmarDatosFiscales(completo, [], {
        ahora: t(1000),
        vigenteDesde: t(999),
        motivo: "x",
        confirmadaPor: GERENTE,
      }),
    ).toEqual({ ok: false, error: "VIGENCIA_RETROACTIVA" });
  });

  it("mezclar versiones de otro emisor es un error de programación", () => {
    const ajena = confirmar({ ...completo, emisorId: EMISOR_2 }, []);
    expect(() => confirmar(completo, [ajena])).toThrow(
      new RangeError("las versiones confirmadas son de otro emisor"),
    );
  });
});
