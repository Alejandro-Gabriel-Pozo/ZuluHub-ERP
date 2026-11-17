import { describe, expect, it } from "vitest";
import {
  formaDeFamilia,
  MAXIMO_DE_COLUMNAS_DE_TABLA,
  type MiembroParaForma,
} from "./forma-de-familia";

const SECCION = "00000000-0000-4000-8000-0000000000a1";
const OTRA = "00000000-0000-4000-8000-0000000000a2";
const medida = (nombre: string, orden: number, precio: string | null = "2000") => ({
  nombre,
  orden,
  precio,
});
const miembro = (id: string, extra: Partial<MiembroParaForma> = {}): MiembroParaForma => ({
  productoId: id,
  seccionId: SECCION,
  activo: true,
  oculto: false,
  medidas: [],
  precio: "2200",
  ...extra,
});
const cafe = (id: string, extra: Partial<MiembroParaForma> = {}) =>
  miembro(id, {
    precio: null,
    medidas: [medida("Chico", 0), medida("Mediano", 1), medida("Grande", 2)],
    ...extra,
  });
const entrada = (miembros: MiembroParaForma[], extra = {}) => ({
  familiaActiva: true,
  agruparEnCarta: true,
  miembros,
  ...extra,
});

describe("formaDeFamilia: cómo sale una familia en la carta", () => {
  it("con medidas (hasta 3) sale tabla, con las columnas por orden de medida", () => {
    const r = formaDeFamilia(entrada([cafe("a"), cafe("b")]));
    expect(r).toEqual({
      forma: "TABLA",
      medidas: ["Chico", "Mediano", "Grande"],
      productos: ["a", "b"],
    });
  });

  it("con más medidas que columnas sale lista (el límite es exacto)", () => {
    expect(MAXIMO_DE_COLUMNAS_DE_TABLA).toBe(3);
    const cuatro = [
      medida("Chico", 0),
      medida("Mediano", 1),
      medida("Grande", 2),
      medida("Jarra", 3),
    ];
    const r = formaDeFamilia(
      entrada([cafe("a", { medidas: cuatro }), cafe("b", { medidas: cuatro })]),
    );
    expect(r.forma).toBe("LISTA");
    expect(formaDeFamilia(entrada([cafe("a"), cafe("b")])).forma).toBe("TABLA");
  });

  it("las medidas se juntan por nombre sin distinguir mayúsculas y una que falta no impide la tabla", () => {
    const r = formaDeFamilia(
      entrada([cafe("a"), cafe("b", { medidas: [medida("CHICO", 0), medida("mediano", 1)] })]),
    );
    expect(r).toEqual({
      forma: "TABLA",
      medidas: ["Chico", "Mediano", "Grande"],
      productos: ["a", "b"],
    });
  });

  it("el orden de las columnas es el de la medida y no el de los nombres ni el de llegada", () => {
    const r = formaDeFamilia(
      entrada([
        cafe("a", { medidas: [medida("Grande", 2), medida("Chico", 0)] }),
        cafe("b", { medidas: [medida("Mediano", 1)] }),
      ]),
    );
    expect(r).toMatchObject({ forma: "TABLA", medidas: ["Chico", "Mediano", "Grande"] });
  });

  it("la medida que un producto no ofrece (sin precio) no cuenta como suya", () => {
    const r = formaDeFamilia(
      entrada([cafe("a"), cafe("b", { medidas: [medida("Chico", 0), medida("Grande", 2, null)] })]),
    );
    expect(r).toMatchObject({ forma: "TABLA", medidas: ["Chico", "Mediano", "Grande"] });
    const sola = formaDeFamilia(
      entrada([
        cafe("a", { medidas: [medida("Chico", 0)] }),
        cafe("b", { medidas: [medida("Chico", 0), medida("Grande", 2, null)] }),
      ]),
    );
    expect(sola).toMatchObject({ forma: "TABLA", medidas: ["Chico"] });
  });

  it("sin medidas y todos al mismo precio sale una línea (el precio se compara como número)", () => {
    const r = formaDeFamilia(
      entrada([miembro("a", { precio: "2200" }), miembro("b", { precio: "2200.000000" })]),
    );
    expect(r).toEqual({ forma: "LINEA", precio: "2200.000000", productos: ["a", "b"] });
  });

  it("sin medidas y con precios distintos salen sueltos", () => {
    expect(formaDeFamilia(entrada([miembro("a"), miembro("b", { precio: "2300" })]))).toEqual({
      forma: "SUELTOS",
      motivo: "PRECIOS_DISTINTOS",
      productos: ["a", "b"],
    });
  });

  it("con medidas, si alguno no las tiene salen sueltos", () => {
    expect(formaDeFamilia(entrada([cafe("a"), miembro("b")]))).toEqual({
      forma: "SUELTOS",
      motivo: "ALGUNO_SIN_MEDIDAS",
      productos: ["a", "b"],
    });
  });

  it("«Agrupar en la carta» apagado o familia desactivada: sueltos (con los vigentes)", () => {
    const miembros = [cafe("a"), cafe("b", { oculto: true }), cafe("c")];
    expect(formaDeFamilia(entrada(miembros, { agruparEnCarta: false }))).toEqual({
      forma: "SUELTOS",
      motivo: "CARTA_APAGADA",
      productos: ["a", "c"],
    });
    expect(formaDeFamilia(entrada(miembros, { familiaActiva: false }))).toMatchObject({
      motivo: "FAMILIA_APAGADA",
    });
  });

  it("un miembro desactivado, oculto o sin precio queda fuera; con menos de dos no se agrupa", () => {
    expect(formaDeFamilia(entrada([cafe("a"), cafe("b", { activo: false })]))).toEqual({
      forma: "SUELTOS",
      motivo: "MENOS_DE_DOS",
      productos: ["a"],
    });
    expect(formaDeFamilia(entrada([cafe("a"), cafe("b", { oculto: true })]))).toMatchObject({
      motivo: "MENOS_DE_DOS",
    });
    expect(formaDeFamilia(entrada([miembro("a"), miembro("b", { precio: null })]))).toMatchObject({
      motivo: "MENOS_DE_DOS",
      productos: ["a"],
    });
    expect(
      formaDeFamilia(entrada([cafe("a"), cafe("b", { medidas: [medida("Chico", 0, null)] })])),
    ).toMatchObject({ motivo: "MENOS_DE_DOS", productos: ["a"] });
    expect(formaDeFamilia(entrada([]))).toMatchObject({ motivo: "MENOS_DE_DOS", productos: [] });
  });

  it("miembros vigentes de secciones distintas salen sueltos; uno no vigente de otra sección no estorba", () => {
    expect(formaDeFamilia(entrada([cafe("a"), cafe("b", { seccionId: OTRA })]))).toMatchObject({
      forma: "SUELTOS",
      motivo: "SECCIONES_DISTINTAS",
    });
    expect(
      formaDeFamilia(
        entrada([cafe("a"), cafe("b"), cafe("c", { seccionId: OTRA, activo: false })]),
      ),
    ).toMatchObject({ forma: "TABLA" });
  });

  it("un precio que no se puede leer no cuenta como precio (todo nace cerrado)", () => {
    expect(formaDeFamilia(entrada([miembro("a"), miembro("b", { precio: "abc" })]))).toMatchObject({
      motivo: "MENOS_DE_DOS",
      productos: ["a"],
    });
    expect(formaDeFamilia(entrada([miembro("a"), miembro("b", { precio: "-5" })]))).toMatchObject({
      motivo: "MENOS_DE_DOS",
    });
  });

  it("una medida repetida dentro de un producto no duplica la columna", () => {
    const r = formaDeFamilia(
      entrada([
        cafe("a", { medidas: [medida("Chico", 0), medida("CHICO", 5)] }),
        cafe("b", { medidas: [medida("Chico", 0)] }),
      ]),
    );
    expect(r).toMatchObject({ forma: "TABLA", medidas: ["Chico"] });
  });

  it("una medida que aparece con distinto lugar en dos productos va en el menor; con el mismo lugar, en el orden en que se vio", () => {
    const r = formaDeFamilia(
      entrada([
        cafe("a", { medidas: [medida("Grande", 5), medida("Chico", 3)] }),
        cafe("b", { medidas: [medida("Grande", 2)] }),
        cafe("c", { medidas: [medida("Grande", 9)] }),
      ]),
    );
    expect(r).toMatchObject({ forma: "TABLA", medidas: ["Grande", "Chico"] });
    const empate = formaDeFamilia(
      entrada([
        cafe("a", { medidas: [medida("Uno", 1), medida("Dos", 1)] }),
        cafe("b", { medidas: [medida("Dos", 1), medida("Uno", 1)] }),
      ]),
    );
    expect(empate).toMatchObject({ medidas: ["Uno", "Dos"] });
  });

  it("los miembros conservan el orden de la familia", () => {
    const r = formaDeFamilia(entrada([cafe("z"), cafe("a"), cafe("m")]));
    expect(r.productos).toEqual(["z", "a", "m"]);
  });
});
