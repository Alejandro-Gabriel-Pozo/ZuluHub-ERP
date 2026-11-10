import { describe, expect, it } from "vitest";
import { validarConjuntoDeOpciones, type GrupoPedido, type OpcionPedida } from "./opciones";

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const opcion = (extra: Partial<OpcionPedida> = {}): OpcionPedida => ({
  id: uuid(),
  nombre: `Opcion ${String.fromCharCode(97 + (n % 26))}${String.fromCharCode(97 + ((n / 26) | 0))}`,
  recargo: "0",
  orden: 0,
  activa: true,
  ...extra,
});
const grupo = (extra: Partial<GrupoPedido> = {}): GrupoPedido => ({
  id: uuid(),
  clase: "ADICIONAL",
  nombre: `Grupo ${String.fromCharCode(97 + (n % 26))}${String.fromCharCode(97 + ((n / 26) | 0))}`,
  esObligatorio: false,
  admiteVarias: true,
  seMuestraEnCarta: true,
  orden: 0,
  activo: true,
  opciones: [opcion()],
  ...extra,
});
const error = (grupos: GrupoPedido[]) => {
  const r = validarConjuntoDeOpciones(grupos);
  return r.ok ? null : r.error;
};

describe("validar el conjunto final de opciones", () => {
  it("un conjunto sano pasa y se normaliza (recargo a 6 decimales)", () => {
    const r = validarConjuntoDeOpciones([grupo({ opciones: [opcion({ recargo: "600" })] })]);
    expect(r).toMatchObject({
      ok: true,
      valor: [{ opciones: [{ recargo: "600.000000", factorDeTamano: "1.0000" }] }],
    });
  });
  it("una variante se fija obligatoria, de una sola elección y visible", () => {
    const r = validarConjuntoDeOpciones([
      grupo({
        clase: "VARIANTE",
        esObligatorio: false,
        admiteVarias: true,
        seMuestraEnCarta: false,
      }),
    ]);
    expect(r).toMatchObject({
      ok: true,
      valor: [{ esObligatorio: true, admiteVarias: false, seMuestraEnCarta: true }],
    });
  });
  it("a lo sumo una variante ACTIVA (138); una desactivada no cuenta", () => {
    expect(error([grupo({ clase: "VARIANTE" }), grupo({ clase: "VARIANTE" })])).toBe(
      "SEGUNDA_VARIANTE",
    );
    expect(
      error([grupo({ clase: "VARIANTE" }), grupo({ clase: "VARIANTE", activo: false })]),
    ).toBeNull();
  });
  it("sin recargo en incluidas ni en la variante; sin recargo en una elección oculta (82)", () => {
    expect(error([grupo({ clase: "INCLUIDA", opciones: [opcion({ recargo: "1" })] })])).toBe(
      "INCLUIDA_CON_RECARGO",
    );
    expect(error([grupo({ clase: "VARIANTE", opciones: [opcion({ recargo: "1" })] })])).toBe(
      "INCLUIDA_CON_RECARGO",
    );
    expect(error([grupo({ seMuestraEnCarta: false, opciones: [opcion({ recargo: "1" })] })])).toBe(
      "ELECCION_OCULTA_CON_PRECIO",
    );
    expect(
      error([grupo({ seMuestraEnCarta: false, opciones: [opcion({ recargo: "0" })] })]),
    ).toBeNull();
  });
  it("recargo decimal exacto ≥ 0", () => {
    for (const malo of ["", "-1", "1,5", "abc", "1.1234567"]) {
      expect(error([grupo({ opciones: [opcion({ recargo: malo })] })]), malo).toBe(
        "RECARGO_INVALIDO",
      );
    }
  });
  it("nombres inválidos y duplicados (grupos entre sí, opciones en su grupo; por clave, sin distinguir mayúsculas)", () => {
    expect(error([grupo({ nombre: "" })])).toBe("NOMBRE_DE_GRUPO_INVALIDO");
    expect(error([grupo({ opciones: [opcion({ nombre: "<x>" })] })])).toBe(
      "NOMBRE_DE_OPCION_INVALIDO",
    );
    expect(error([grupo({ nombre: "Salsas" }), grupo({ nombre: "SALSAS" })])).toBe(
      "GRUPO_DUPLICADO",
    );
    expect(
      error([grupo({ opciones: [opcion({ nombre: "Queso" }), opcion({ nombre: "queso" })] })]),
    ).toBe("OPCION_DUPLICADA");
    // La misma opción en dos grupos distintos sí se puede.
    expect(
      error([
        grupo({ opciones: [opcion({ nombre: "Queso" })] }),
        grupo({ opciones: [opcion({ nombre: "Queso" })] }),
      ]),
    ).toBeNull();
  });
  it("un grupo activo necesita al menos una opción activa; uno desactivado no", () => {
    expect(error([grupo({ opciones: [] })])).toBe("GRUPO_SIN_OPCIONES");
    expect(error([grupo({ opciones: [opcion({ activa: false })] })])).toBe("GRUPO_SIN_OPCIONES");
    expect(error([grupo({ activo: false, opciones: [] })])).toBeNull();
  });
  it("factor de tamaño: solo en la variante de tamaño, de más de 0 a 100", () => {
    const tam = (factorDeTamano: string | undefined, esTamano = true) =>
      error([grupo({ clase: "VARIANTE", esTamano, opciones: [opcion({ factorDeTamano })] })]);
    expect(tam("1.5")).toBeNull();
    expect(tam("100")).toBeNull();
    for (const malo of ["0", "100.0001", "-1", "x"])
      expect(tam(malo), malo).toBe("FACTOR_DE_TAMANO_INVALIDO");
    expect(tam("1.5", false)).toBe("FACTOR_DE_TAMANO_INVALIDO");
    expect(error([grupo({ opciones: [opcion({ factorDeTamano: "2" })] })])).toBe(
      "FACTOR_DE_TAMANO_INVALIDO",
    );
    expect(error([grupo({ esTamano: true })])).toBe("TAMANO_SOLO_EN_VARIANTE");
  });
  it("ids, clase y orden", () => {
    expect(error([grupo({ id: "x" })])).toBe("IDENTIFICADOR_INVALIDO");
    expect(error([grupo({ opciones: [opcion({ id: "x" })] })])).toBe("IDENTIFICADOR_INVALIDO");
    const g = grupo();
    expect(error([g, { ...grupo(), id: g.id }])).toBe("ID_REPETIDO");
    expect(error([grupo({ clase: "OTRA" })])).toBe("CLASE_DE_GRUPO_INVALIDA");
    expect(error([grupo({ orden: -1 })])).toBe("ORDEN_INVALIDO");
    expect(error([grupo({ orden: 1.5 })])).toBe("ORDEN_INVALIDO");
  });
});
