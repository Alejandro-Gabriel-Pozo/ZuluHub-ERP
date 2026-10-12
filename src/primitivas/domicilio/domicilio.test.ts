import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import {
  FORMATO_DE_CODIGO_POSTAL,
  LIMITES_DE_DOMICILIO,
  domicilioDesdeDatos,
  formatearDomicilio,
  type DatosDeDomicilio,
  type Domicilio,
  type ErrorDeDomicilio,
} from "./domicilio";
import { PROVINCIAS } from "./provincias";

const base: DatosDeDomicilio = {
  calle: "Av. Corrientes",
  numero: "1234",
  piso: "5",
  departamento: "B",
  localidad: "Rosario",
  provincia: "AR-S",
  codigoPostal: "S2000",
};

const con = (cambios: Partial<Record<keyof DatosDeDomicilio, string | null | undefined>>) =>
  ({ ...base, ...cambios }) as DatosDeDomicilio;

function valido(datos: DatosDeDomicilio): Domicilio {
  const r = domicilioDesdeDatos(datos);
  if (!r.ok) throw new Error(`se esperaba un domicilio válido y dio ${r.error}`);
  return r.valor;
}

describe("domicilio: caso válido y normalización", () => {
  it("arma el domicilio completo", () => {
    expect(valido(base)).toEqual({
      calle: "Av. Corrientes",
      numero: "1234",
      piso: "5",
      departamento: "B",
      localidad: "Rosario",
      provincia: "AR-S",
      codigoPostal: "S2000",
    });
  });

  it("los opcionales pueden faltar, ser nulos o estar en blanco: quedan en null", () => {
    const sinOpcionales = { calle: "Mitre", numero: "S/N", localidad: "Salta", provincia: "AR-A" };
    const esperado = {
      calle: "Mitre",
      numero: "S/N",
      piso: null,
      departamento: null,
      localidad: "Salta",
      provincia: "AR-A",
      codigoPostal: null,
    };
    expect(valido(sinOpcionales)).toEqual(esperado);
    expect(
      valido({ ...sinOpcionales, piso: null, departamento: null, codigoPostal: null }),
    ).toEqual(esperado);
    expect(valido({ ...sinOpcionales, piso: "  ", departamento: "", codigoPostal: " " })).toEqual(
      esperado,
    );
  });

  it("recorta blancos, pasa el número y el código postal a mayúsculas", () => {
    expect(
      valido({
        calle: "  San Martín ",
        numero: " s/n ",
        piso: " PB ",
        departamento: " 2 ",
        localidad: " Tandil\t",
        provincia: " AR-B ",
        codigoPostal: " b7000abc ",
      }),
    ).toEqual({
      calle: "San Martín",
      numero: "S/N",
      piso: "PB",
      departamento: "2",
      localidad: "Tandil",
      provincia: "AR-B",
      codigoPostal: "B7000ABC",
    });
  });

  it("acepta una calle con espacios, puntos y acentos en el medio", () => {
    expect(valido(con({ calle: "Gral. José de San Martín" })).calle).toBe(
      "Gral. José de San Martín",
    );
  });
});

describe("domicilio: cada regla con su caso inválido", () => {
  const casos: [string, Parameters<typeof con>[0], ErrorDeDomicilio][] = [
    ["calle vacía", { calle: "" }, "CALLE_INVALIDA"],
    ["calle en blanco", { calle: "   " }, "CALLE_INVALIDA"],
    ["calle con salto de línea", { calle: "Mitre\nSur" }, "CALLE_INVALIDA"],
    ["calle con tabulación", { calle: "Mitre\tSur" }, "CALLE_INVALIDA"],
    ["calle demasiado larga", { calle: "a".repeat(101) }, "CALLE_INVALIDA"],
    ["número vacío", { numero: "" }, "NUMERO_INVALIDO"],
    ["número en blanco", { numero: "  " }, "NUMERO_INVALIDO"],
    ["número con letras", { numero: "12a" }, "NUMERO_INVALIDO"],
    ["número con letra al principio", { numero: "a12" }, "NUMERO_INVALIDO"],
    ["número negativo", { numero: "-1" }, "NUMERO_INVALIDO"],
    ["número con decimales", { numero: "1.5" }, "NUMERO_INVALIDO"],
    ["número de siete dígitos", { numero: "1234567" }, "NUMERO_INVALIDO"],
    ["número con espacio en el medio", { numero: "12 3" }, "NUMERO_INVALIDO"],
    ["sin número mal escrito", { numero: "SN" }, "NUMERO_INVALIDO"],
    ["sin número con algo más", { numero: "S/N1" }, "NUMERO_INVALIDO"],
    ["sin número con algo antes", { numero: "1S/N" }, "NUMERO_INVALIDO"],
    ["piso con salto de línea", { piso: "1\n2" }, "PISO_INVALIDO"],
    ["piso demasiado largo", { piso: "1".repeat(21) }, "PISO_INVALIDO"],
    ["departamento con salto de línea", { departamento: "A\nB" }, "DEPARTAMENTO_INVALIDO"],
    ["departamento demasiado largo", { departamento: "A".repeat(21) }, "DEPARTAMENTO_INVALIDO"],
    ["localidad vacía", { localidad: "" }, "LOCALIDAD_INVALIDA"],
    ["localidad en blanco", { localidad: " \t " }, "LOCALIDAD_INVALIDA"],
    ["localidad con salto de línea", { localidad: "Villa\nMaría" }, "LOCALIDAD_INVALIDA"],
    ["localidad demasiado larga", { localidad: "a".repeat(101) }, "LOCALIDAD_INVALIDA"],
    ["provincia vacía", { provincia: "" }, "PROVINCIA_INVALIDA"],
    ["provincia que no existe", { provincia: "AR-I" }, "PROVINCIA_INVALIDA"],
    ["provincia en minúsculas", { provincia: "ar-s" }, "PROVINCIA_INVALIDA"],
    ["provincia por nombre", { provincia: "Santa Fe" }, "PROVINCIA_INVALIDA"],
    ["código postal corto", { codigoPostal: "999" }, "CODIGO_POSTAL_INVALIDO"],
    ["código postal largo", { codigoPostal: "123456789" }, "CODIGO_POSTAL_INVALIDO"],
    ["código postal con guion", { codigoPostal: "S-2000" }, "CODIGO_POSTAL_INVALIDO"],
    ["código postal con espacio en el medio", { codigoPostal: "S 2000" }, "CODIGO_POSTAL_INVALIDO"],
    ["código postal con acento", { codigoPostal: "Ñ2000" }, "CODIGO_POSTAL_INVALIDO"],
  ];

  it.each(casos)("%s", (_nombre, cambios, error) => {
    expect(domicilioDesdeDatos(con(cambios))).toEqual({ ok: false, error });
  });

  it("un piso o un departamento en blanco NO es un error: es un opcional vacío", () => {
    expect(valido(con({ piso: "   " })).piso).toBeNull();
    expect(valido(con({ departamento: "   " })).departamento).toBeNull();
  });
});

describe("domicilio: límites exactos", () => {
  it("los límites son los declarados", () => {
    expect(LIMITES_DE_DOMICILIO).toEqual({
      calle: 100,
      localidad: 100,
      piso: 20,
      departamento: 20,
    });
  });

  it("el largo máximo entra y uno más no", () => {
    expect(valido(con({ calle: "a".repeat(100) })).calle).toHaveLength(100);
    expect(valido(con({ localidad: "a".repeat(100) })).localidad).toHaveLength(100);
    expect(valido(con({ piso: "1".repeat(20) })).piso).toHaveLength(20);
    expect(valido(con({ departamento: "A".repeat(20) })).departamento).toHaveLength(20);
  });

  it("el largo se mide después de recortar", () => {
    expect(valido(con({ calle: ` ${"a".repeat(100)} ` })).calle).toHaveLength(100);
  });

  it("número: de uno a seis dígitos, ceros a la izquierda incluidos", () => {
    expect(valido(con({ numero: "0" })).numero).toBe("0");
    expect(valido(con({ numero: "123456" })).numero).toBe("123456");
    expect(valido(con({ numero: "000123" })).numero).toBe("000123");
  });

  it("código postal: de cuatro a ocho caracteres alfanuméricos", () => {
    expect(valido(con({ codigoPostal: "1000" })).codigoPostal).toBe("1000");
    expect(valido(con({ codigoPostal: "12345678" })).codigoPostal).toBe("12345678");
    expect(FORMATO_DE_CODIGO_POSTAL.test("1000")).toBe(true);
    expect(FORMATO_DE_CODIGO_POSTAL.test("100")).toBe(false);
  });
});

describe("domicilio: orden de los errores", () => {
  it("gana el primer error en el orden calle, número, piso, departamento, localidad, provincia, código postal", () => {
    let datos: DatosDeDomicilio = {
      calle: "",
      numero: "x",
      piso: "a\nb",
      departamento: "a\nb",
      localidad: "",
      provincia: "ZZ",
      codigoPostal: "!",
    };
    const esperados: ErrorDeDomicilio[] = [
      "CALLE_INVALIDA",
      "NUMERO_INVALIDO",
      "PISO_INVALIDO",
      "DEPARTAMENTO_INVALIDO",
      "LOCALIDAD_INVALIDA",
      "PROVINCIA_INVALIDA",
      "CODIGO_POSTAL_INVALIDO",
    ];
    const arreglos: Partial<DatosDeDomicilio>[] = [
      { calle: "Mitre" },
      { numero: "1" },
      { piso: null },
      { departamento: null },
      { localidad: "Salta" },
      { provincia: "AR-A" },
    ];
    for (const [i, esperado] of esperados.entries()) {
      expect(domicilioDesdeDatos(datos)).toEqual({ ok: false, error: esperado });
      datos = { ...datos, ...arreglos[i] };
    }
    expect(domicilioDesdeDatos({ ...datos, codigoPostal: "S2000" }).ok).toBe(true);
  });
});

describe("formatearDomicilio", () => {
  it("línea completa", () => {
    expect(formatearDomicilio(valido(base))).toBe(
      "Av. Corrientes 1234, piso 5, depto B, Rosario, Santa Fe (CP S2000)",
    );
  });

  it("sin piso, sin departamento y sin código postal", () => {
    const d = valido({ calle: "Mitre", numero: "S/N", localidad: "Salta", provincia: "AR-C" });
    expect(formatearDomicilio(d)).toBe("Mitre S/N, Salta, Ciudad Autónoma de Buenos Aires");
  });

  it("solo piso", () => {
    expect(formatearDomicilio(valido(con({ departamento: null, codigoPostal: null })))).toBe(
      "Av. Corrientes 1234, piso 5, Rosario, Santa Fe",
    );
  });

  it("solo departamento", () => {
    expect(formatearDomicilio(valido(con({ piso: null, codigoPostal: null })))).toBe(
      "Av. Corrientes 1234, depto B, Rosario, Santa Fe",
    );
  });

  it("una provincia fuera del catálogo es un error de programación y se lanza", () => {
    const roto = { ...valido(base), provincia: "AR-I" } as unknown as Domicilio;
    expect(() => formatearDomicilio(roto)).toThrow(new RangeError("provincia desconocida: AR-I"));
  });
});

describe("domicilio: propiedades", () => {
  const letras = "abcdefghijklmnopqrstuvwxyzáéíóúñABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,-'";
  const textoValido = (maximo: number) =>
    fc
      .array(fc.constantFrom(...letras.split("")), { minLength: 1, maxLength: maximo })
      .map((cs) => cs.join(""))
      .filter((t) => t.trim() !== "");
  const blancos = fc.constantFrom("", " ", "  ", "\t", "  ");
  const provincia = fc.constantFrom(...PROVINCIAS.map((p) => p.codigo as string));
  const numero = fc.oneof(
    fc.integer({ min: 0, max: 999_999 }).map(String),
    fc.constant("S/N"),
    fc.constant("s/n"),
  );
  const codigoPostal = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc
      .array(fc.constantFrom(..."abcxyzABCXYZ0123456789".split("")), { minLength: 4, maxLength: 8 })
      .map((cs) => cs.join("")),
  );
  const datos = fc.record({
    calle: textoValido(100),
    numero,
    piso: fc.option(textoValido(20), { nil: undefined }),
    departamento: fc.option(textoValido(20), { nil: null }),
    localidad: textoValido(100),
    provincia,
    codigoPostal,
  }) as fc.Arbitrary<DatosDeDomicilio>;

  it("todo dato bien formado da un domicilio, con los blancos de los extremos ignorados", () => {
    fc.assert(
      fc.property(datos, blancos, blancos, (d, antes, despues) => {
        const sucio: DatosDeDomicilio = {
          ...d,
          calle: antes + d.calle + despues,
          localidad: antes + d.localidad + despues,
          numero: antes + d.numero + despues,
        };
        const limpio = domicilioDesdeDatos(d);
        expect(limpio.ok).toBe(true);
        expect(domicilioDesdeDatos(sucio)).toEqual(limpio);
      }),
    );
  });

  it("normalizar es idempotente: normalizar un domicilio ya normalizado no cambia nada", () => {
    fc.assert(
      fc.property(datos, (d) => {
        const una = valido(d);
        expect(valido(una)).toEqual(una);
      }),
    );
  });

  it("un número que no es de uno a seis dígitos ni S/N se rechaza", () => {
    const malo = fc
      .string({ maxLength: 12 })
      .filter((t) => !/^[0-9]{1,6}$/.test(t.trim()) && t.trim().toUpperCase() !== "S/N");
    fc.assert(
      fc.property(malo, (n) => {
        expect(domicilioDesdeDatos({ ...base, numero: n })).toEqual({
          ok: false,
          error: "NUMERO_INVALIDO",
        });
      }),
    );
  });

  it("una provincia que no está en el catálogo se rechaza", () => {
    const codigos = new Set(PROVINCIAS.map((p) => p.codigo as string));
    fc.assert(
      fc.property(
        fc.string({ maxLength: 8 }).filter((t) => !codigos.has(t.trim())),
        (p) => {
          expect(domicilioDesdeDatos({ ...base, provincia: p })).toEqual({
            ok: false,
            error: "PROVINCIA_INVALIDA",
          });
        },
      ),
    );
  });

  it("el resultado nunca tiene blancos en los extremos ni opcionales vacíos", () => {
    fc.assert(
      fc.property(datos, (d) => {
        const r = valido(d);
        for (const t of [r.calle, r.localidad, r.piso, r.departamento, r.codigoPostal]) {
          if (t !== null) {
            expect(t).toBe(t.trim());
            expect(t).not.toBe("");
          }
        }
      }),
    );
  });
});
