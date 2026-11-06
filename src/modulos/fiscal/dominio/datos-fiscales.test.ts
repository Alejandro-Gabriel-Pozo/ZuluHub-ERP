import { describe, expect, it } from "vitest";
import { LARGO_MAXIMO_DEL_NOMBRE_O_RAZON_SOCIAL } from "../../../primitivas/texto/nombre-o-razon-social";
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
  nuevoBorrador,
  pedidoNoCambiaLoGuardado,
  type CambiosDeBorrador,
  type DatosFiscalesBorrador,
  type DatosFiscalesConfirmados,
} from "./datos-fiscales";

// 2026-10-12 12:00 en Argentina (UTC-3 = 15:00Z): el reloj del contexto que se le pasa al dominio.
const AHORA = new Date("2026-10-12T15:00:00Z");
const HOY = "2026-10-12";

const vacio = nuevoBorrador({
  id: VERSION_1,
  empresaId: EMPRESA,
  emisorId: EMISOR_1,
  creadoPor: GERENTE,
});

function editado(cambios: CambiosDeBorrador, desde: DatosFiscalesBorrador = vacio) {
  const r = editarBorrador(desde, cambios, AHORA);
  if (!r.ok) throw new Error(`se esperaba un borrador válido y dio ${JSON.stringify(r.error)}`);
  return r.valor;
}

const completo = editado({
  razonSocial: "Hotel Sur SA",
  condicionIva: "RESPONSABLE_INSCRIPTO",
  domicilioFiscalId: DOMICILIO_1,
  inicioActividades: "2015-03-01",
  iibbNumero: "901-123456-7",
});

/** Lo mismo pero «No contribuyente» (D-115/D-116): sin número. */
const completoNoContribuyente = editado({ iibbCondicion: "NO_CONTRIBUYENTE" }, completo);

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
      }),
    ).toEqual({
      ...vacio,
      razonSocial: "Hotel Sur SA",
      condicionIva: "MONOTRIBUTO",
      domicilioFiscalId: DOMICILIO_2,
      inicioActividades: "2020-02-29",
      iibbNumero: "123",
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

  it("elegir el número descarta «No contribuyente» y elegir «No contribuyente» descarta el número", () => {
    const sinNumero = editado({ iibbNumero: "55" }, completoNoContribuyente);
    expect(sinNumero.iibbNumero).toBe("55");
    expect(sinNumero.iibbCondicion).toBeNull();
    const sinCondicion = editado({ iibbCondicion: "NO_CONTRIBUYENTE" }, completo);
    expect(sinCondicion.iibbNumero).toBeNull();
    expect(sinCondicion.iibbCondicion).toBe("NO_CONTRIBUYENTE");
  });

  it("borrar uno no toca el otro", () => {
    expect(editado({ iibbNumero: null }, completoNoContribuyente).iibbCondicion).toBe(
      "NO_CONTRIBUYENTE",
    );
    expect(editado({ iibbCondicion: null }, completo).iibbNumero).toBe("901-123456-7");
  });

  it("mandar un número y «No contribuyente» juntos es un error y no cambia nada", () => {
    expect(
      editarBorrador(completo, { iibbNumero: "55", iibbCondicion: "NO_CONTRIBUYENTE" }, AHORA),
    ).toEqual({ ok: false, error: "IIBB_CONDICION_INVALIDA" });
    // Número vacío más «No contribuyente» no son dos elecciones: es borrar el número y elegir la condición.
    expect(editado({ iibbNumero: " ", iibbCondicion: "NO_CONTRIBUYENTE" }, completo)).toMatchObject(
      {
        iibbNumero: null,
        iibbCondicion: "NO_CONTRIBUYENTE",
      },
    );
  });

  it("las tres condiciones anteriores ya no se aceptan al editar, y un borrador que las trae las pierde", () => {
    for (const vieja of ["LOCAL", "CONVENIO_MULTILATERAL", "EXENTO"]) {
      expect(editarBorrador(vacio, { iibbCondicion: vieja }, AHORA)).toEqual({
        ok: false,
        error: "IIBB_CONDICION_INVALIDA",
      });
      const heredado = { ...completo, iibbCondicion: vieja } as DatosFiscalesBorrador;
      expect(editado({}, heredado).iibbCondicion).toBeNull();
    }
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
    ["razón social con arroba", { razonSocial: "Kiosco @ Mendoza" }, "RAZON_SOCIAL_INVALIDA"],
    ["razón social con emoji", { razonSocial: "Hotel & Spa ✨" }, "RAZON_SOCIAL_INVALIDA"],
    ["razón social con porcentaje", { razonSocial: "50% Off SRL" }, "RAZON_SOCIAL_INVALIDA"],
    ["razón social sin ninguna letra", { razonSocial: "30-71234567-1" }, "RAZON_SOCIAL_INVALIDA"],
    ["razón social que empieza con guion", { razonSocial: "-Norte SA" }, "RAZON_SOCIAL_INVALIDA"],
    ["razón social de otro alfabeto", { razonSocial: "小林商事" }, "RAZON_SOCIAL_INVALIDA"],
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
    [
      "«No contribuyente» en minúsculas",
      { iibbCondicion: "no_contribuyente" },
      "IIBB_CONDICION_INVALIDA",
    ],
  ];

  it.each(casos)("%s", (_nombre, cambios, error) => {
    expect(editarBorrador(vacio, cambios, AHORA)).toEqual({ ok: false, error });
  });

  it("los límites exactos entran", () => {
    expect(LIMITES_DE_DATOS_FISCALES).toEqual({ razonSocial: 200, iibbNumero: 30 });
    expect(editado({ razonSocial: "a".repeat(200) }).razonSocial).toHaveLength(200);
    expect(editado({ iibbNumero: "1".repeat(30) }).iibbNumero).toHaveLength(30);
  });

  it("la razón social usa la regla del dato «nombre o razón social» (Q10): una sola fuente para tope y caracteres", () => {
    expect(LIMITES_DE_DATOS_FISCALES.razonSocial).toBe(LARGO_MAXIMO_DEL_NOMBRE_O_RAZON_SOCIAL);
    expect(editado({ razonSocial: "  Pérez   &  Hijos S.A. " }).razonSocial).toBe(
      "Pérez & Hijos S.A.",
    );
    expect(editado({ razonSocial: "Cafe\u0301 Ñandú S.R.L." }).razonSocial).toBe(
      "Café Ñandú S.R.L.",
    );
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
      expect(editarBorrador(vacio, cambios, AHORA)).toEqual({ ok: false, error });
      cambios = { ...cambios, ...arreglos[i] };
    }
  });

  it("un error no modifica el borrador original", () => {
    editarBorrador(completo, { razonSocial: "" }, AHORA);
    expect(completo.razonSocial).toBe("Hotel Sur SA");
  });
});

describe("condiciones de IIBB", () => {
  it("son las que la base puede tener: las tres anteriores (solo para leer) y «No contribuyente»", () => {
    expect(CONDICIONES_DE_IIBB).toEqual([
      "LOCAL",
      "CONVENIO_MULTILATERAL",
      "EXENTO",
      "NO_CONTRIBUYENTE",
    ]);
    for (const c of CONDICIONES_DE_IIBB) expect(esCondicionDeIibb(c)).toBe(true);
    expect(esCondicionDeIibb("local")).toBe(false);
    expect(esCondicionDeIibb("")).toBe(false);
  });
});

describe("inicio de actividades: entre 1900 y hoy en Argentina (Q17, Q18, Q20)", () => {
  // Reemplaza a la copia de `fechaCivilValida` que vivía acá: el calendario lo prueba `fecha-civil.test.ts`.
  it.each(["1900-01-01", "2015-03-01", "2024-02-29", "2026-10-11", HOY])("%s entra", (f) => {
    expect(editado({ inicioActividades: f }).inicioActividades).toBe(f);
  });

  it.each([
    ["mañana", "2026-10-13"],
    ["un año adelante", "2027-10-12"],
    ["anterior a 1900", "1899-12-31"],
    ["año 0001", "0001-01-01"],
    ["29 de febrero que no existe", "2023-02-29"],
  ])("%s se rechaza", (_nombre, f) => {
    expect(editarBorrador(vacio, { inicioActividades: f }, AHORA)).toEqual({
      ok: false,
      error: "INICIO_DE_ACTIVIDADES_INVALIDO",
    });
  });

  it("el «hoy» es el de Argentina: pasada la medianoche de Buenos Aires el día nuevo ya entra", () => {
    const antes = new Date("2026-10-13T02:59:00Z");
    const despues = new Date("2026-10-13T03:00:00Z");
    expect(editarBorrador(vacio, { inicioActividades: "2026-10-13" }, antes).ok).toBe(false);
    expect(editarBorrador(vacio, { inicioActividades: "2026-10-13" }, despues).ok).toBe(true);
  });

  it("sin reloj válido no se acepta ninguna fecha (cierra)", () => {
    const r = editarBorrador(vacio, { inicioActividades: "2015-03-01" }, new Date(Number.NaN));
    expect(r).toEqual({ ok: false, error: "INICIO_DE_ACTIVIDADES_INVALIDO" });
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
      iibbCondicion: null,
      vigenteDesde: t(5000),
      confirmadaEn: t(1000),
      confirmadaPor: GERENTE,
      motivo: "alta inicial",
      version: 1,
    });
  });

  it("Ingresos Brutos es obligatorio: el número o «No contribuyente» (D-115/D-116)", () => {
    const porNumero = confirmar(completo, []);
    expect(porNumero.iibbNumero).toBe("901-123456-7");
    expect(porNumero.iibbCondicion).toBeNull();
    const porCondicion = confirmar(completoNoContribuyente, []);
    expect(porCondicion.iibbNumero).toBeNull();
    expect(porCondicion.iibbCondicion).toBe("NO_CONTRIBUYENTE");
  });

  it("sin número ni «No contribuyente» no se confirma, y lo único que falta es Ingresos Brutos", () => {
    const sinIibb = editado({ iibbNumero: null, iibbCondicion: null }, completo);
    expect(
      confirmarDatosFiscales(sinIibb, [], {
        ahora: t(1),
        vigenteDesde: t(1),
        motivo: "x",
        confirmadaPor: GERENTE,
      }),
    ).toEqual({
      ok: false,
      error: { codigo: "DATOS_FISCALES_INCOMPLETOS", faltantes: ["ingresosBrutos"] },
    });
  });

  it("un borrador con las dos elecciones (armado a mano) no se confirma: falla cerrado", () => {
    const ambos = { ...completo, iibbCondicion: "NO_CONTRIBUYENTE" } as DatosFiscalesBorrador;
    expect(
      confirmarDatosFiscales(ambos, [], {
        ahora: t(1),
        vigenteDesde: t(1),
        motivo: "x",
        confirmadaPor: GERENTE,
      }),
    ).toMatchObject({ ok: false, error: { faltantes: ["ingresosBrutos"] } });
  });

  it("una condición anterior (LOCAL, CONVENIO_MULTILATERAL, EXENTO) no cuenta como elección ni se confirma", () => {
    for (const vieja of ["LOCAL", "CONVENIO_MULTILATERAL", "EXENTO"]) {
      const sinNumero = {
        ...completo,
        iibbNumero: null,
        iibbCondicion: vieja,
      } as DatosFiscalesBorrador;
      expect(
        confirmarDatosFiscales(sinNumero, [], {
          ahora: t(1),
          vigenteDesde: t(1),
          motivo: "x",
          confirmadaPor: GERENTE,
        }),
      ).toMatchObject({ ok: false, error: { faltantes: ["ingresosBrutos"] } });
      const conNumero = { ...completo, iibbCondicion: vieja } as DatosFiscalesBorrador;
      expect(confirmar(conNumero, []).iibbCondicion).toBeNull();
    }
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
    const obligatorios = ["razonSocial", "condicionIva", "domicilioFiscalId", "inicioActividades"];
    const todos = [...obligatorios, "ingresosBrutos"];
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
    for (const [i, campo] of obligatorios.entries()) {
      const borrador = { ...completo, [campo]: null } as DatosFiscalesBorrador;
      expect(inc(borrador)).toEqual({
        ok: false,
        error: { codigo: "DATOS_FISCALES_INCOMPLETOS", faltantes: [obligatorios[i]] },
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

describe("pedidoNoCambiaLoGuardado: el reintento sobre lo ya confirmado compara contra lo guardado", () => {
  // Una razón social que se aceptó con reglas anteriores (doble espacio y arroba): hoy no pasaría la lista de permitidos.
  const legado = { ...completo, razonSocial: "Kiosco  @ Mendoza" };

  it("el valor guardado (recortado) es «no cambia», aunque hoy no se aceptaría", () => {
    expect(editarBorrador(legado, { razonSocial: "Kiosco  @ Mendoza" }, AHORA).ok).toBe(false);
    expect(pedidoNoCambiaLoGuardado(legado, { razonSocial: "Kiosco  @ Mendoza" })).toBe(true);
    expect(pedidoNoCambiaLoGuardado(legado, { razonSocial: "  Kiosco  @ Mendoza\n" })).toBe(true);
  });

  it("también un inicio de actividades guardado que hoy se rechazaría (futuro)", () => {
    const futuro = { ...completo, inicioActividades: "2030-01-01" };
    expect(editarBorrador(futuro, { inicioActividades: "2030-01-01" }, AHORA).ok).toBe(false);
    expect(pedidoNoCambiaLoGuardado(futuro, { inicioActividades: "2030-01-01" })).toBe(true);
  });

  it("un pedido vacío o con todo igual a lo guardado no cambia nada", () => {
    expect(pedidoNoCambiaLoGuardado(completo, {})).toBe(true);
    expect(
      pedidoNoCambiaLoGuardado(completo, {
        razonSocial: "Hotel Sur SA",
        condicionIva: "RESPONSABLE_INSCRIPTO",
        domicilioFiscalId: DOMICILIO_1,
        inicioActividades: "2015-03-01",
        iibbNumero: " 901-123456-7 ",
      }),
    ).toBe(true);
  });

  it.each([
    ["otra razón social", { razonSocial: "Otra SA" }],
    ["razón social en blanco", { razonSocial: "   " }],
    ["otra condición de IVA", { condicionIva: "MONOTRIBUTO" }],
    ["otro domicilio", { domicilioFiscalId: DOMICILIO_2 }],
    ["otro inicio de actividades", { inicioActividades: "2015-03-02" }],
    ["otro número de IIBB", { iibbNumero: "1" }],
    ["borrar el número de IIBB que hay", { iibbNumero: null }],
    ["borrar el número de IIBB con un blanco", { iibbNumero: "  " }],
    ["elegir «No contribuyente» habiendo número", { iibbCondicion: "NO_CONTRIBUYENTE" }],
  ])("%s sí cambia", (_nombre, cambios) => {
    expect(pedidoNoCambiaLoGuardado(completo, cambios)).toBe(false);
  });

  it("borrar lo que ya no hay no cambia nada; poner lo que hay, tampoco", () => {
    expect(pedidoNoCambiaLoGuardado(completo, { iibbCondicion: null })).toBe(true);
    expect(pedidoNoCambiaLoGuardado(completo, { iibbCondicion: " " })).toBe(true);
    expect(pedidoNoCambiaLoGuardado(completoNoContribuyente, { iibbNumero: null })).toBe(true);
    expect(
      pedidoNoCambiaLoGuardado(completoNoContribuyente, { iibbCondicion: "NO_CONTRIBUYENTE" }),
    ).toBe(true);
    expect(pedidoNoCambiaLoGuardado(completoNoContribuyente, { iibbNumero: "5" })).toBe(false);
  });

  it("basta que un campo cambie para que el pedido cambie", () => {
    expect(
      pedidoNoCambiaLoGuardado(completo, {
        razonSocial: "Hotel Sur SA",
        inicioActividades: "2016-01-01",
      }),
    ).toBe(false);
  });
});
