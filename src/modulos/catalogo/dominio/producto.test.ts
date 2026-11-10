import { describe, expect, it } from "vitest";
import { CLASES_DE_USO, seConsumeLaClase, vendeLaClase, type ClaseDeUso } from "./clases";
import { validarFicha, type EntradaDeFicha } from "./producto";

const SECCION = "11111111-1111-4111-8111-111111111111";
const base: EntradaDeFicha = { nombre: "Milanesa" };

describe("D1: lo que pide y lo que prohíbe cada clase (en el dominio)", () => {
  it.each(CLASES_DE_USO)("%s: la tabla de verdad de §3.3", (clase) => {
    const vende = vendeLaClase(clase);
    const completa: EntradaDeFicha = {
      ...base,
      alicuota: "21",
      seccionDeCartaId: SECCION,
      nombreDeCocina: "Mila",
      descripcionEnCarta: "Con papas",
    };
    // Solo el nombre: pasa siempre salvo que la clase venda y se exija la alícuota.
    expect(validarFicha(clase, base, false).ok).toBe(true);
    expect(validarFicha(clase, base, true)).toEqual(
      vende ? { ok: false, error: "ALICUOTA_REQUERIDA" } : expect.objectContaining({ ok: true }),
    );
    const todo = validarFicha(clase, completa, true);
    if (vende)
      expect(todo).toMatchObject({
        ok: true,
        valor: { alicuota: "21", seccionDeCartaId: SECCION },
      });
    else
      expect(todo).toEqual({
        ok: false,
        error: { error: "CAMPO_NO_ADMITIDO_POR_LA_CLASE", campo: "alicuota" },
      });
    // Cada campo «de venta» suelto en una clase que no vende se rechaza nombrándolo.
    if (!vende) {
      for (const [campo, extra] of [
        ["alicuota", { alicuota: "21" }],
        ["seccionDeCartaId", { seccionDeCartaId: SECCION }],
        ["nombreDeCocina", { nombreDeCocina: "Mila" }],
        ["descripcionEnCarta", { descripcionEnCarta: "Rica" }],
      ] as const) {
        expect(validarFicha(clase, { ...base, ...extra }, false)).toEqual({
          ok: false,
          error: { error: "CAMPO_NO_ADMITIDO_POR_LA_CLASE", campo },
        });
      }
    }
  });

  it("solo materia prima, insumo y reventa se consumen; solo reventa y vendible se venden", () => {
    const quienes = (f: (c: ClaseDeUso) => boolean) => CLASES_DE_USO.filter(f);
    expect(quienes(vendeLaClase)).toEqual(["REVENTA", "VENDIBLE"]);
    expect(quienes(seConsumeLaClase)).toEqual(["MATERIA_PRIMA", "INSUMO", "REVENTA"]);
  });
});

describe("validarFicha: forma de cada dato", () => {
  it("normaliza: vacío o blancos = no tiene; nombre canónico y su clave", () => {
    expect(
      validarFicha(
        "VENDIBLE",
        { nombre: "  Café  con leche ", codigo: " ", nombreDeCocina: "", alicuota: "10.5" },
        true,
      ),
    ).toEqual({
      ok: true,
      valor: {
        nombre: "Café con leche",
        nombreClave: "café con leche",
        nombreDeCocina: null,
        descripcionEnCarta: null,
        codigo: null,
        codigoDeBarras: null,
        alicuota: "10.5",
        seccionDeCartaId: null,
      },
    });
  });
  it("cada error con su nombre", () => {
    const con = (extra: Partial<EntradaDeFicha>) =>
      validarFicha("VENDIBLE", { ...base, alicuota: "21", ...extra }, true);
    expect(validarFicha("VENDIBLE", { nombre: "" }, true)).toEqual({
      ok: false,
      error: "NOMBRE_DE_PRODUCTO_INVALIDO",
    });
    expect(con({ nombreDeCocina: "12" })).toEqual({
      ok: false,
      error: "NOMBRE_DE_COCINA_INVALIDO",
    });
    expect(con({ descripcionEnCarta: "<x>" })).toEqual({
      ok: false,
      error: "DESCRIPCION_INVALIDA",
    });
    expect(con({ codigo: "con espacio" })).toEqual({ ok: false, error: "CODIGO_INVALIDO" });
    expect(con({ codigoDeBarras: "123" })).toEqual({
      ok: false,
      error: "CODIGO_DE_BARRAS_INVALIDO",
    });
    expect(con({ alicuota: "20" })).toEqual({ ok: false, error: "ALICUOTA_INVALIDA" });
    expect(con({ seccionDeCartaId: "no-es-uuid" })).toEqual({
      ok: false,
      error: "SECCION_NO_ENCONTRADA",
    });
  });
  it("las ocho alícuotas pasan, y sin valor por defecto", () => {
    for (const a of ["0", "2.5", "5", "10.5", "21", "27", "EXENTO", "NO_GRAVADO"]) {
      expect(validarFicha("REVENTA", { ...base, alicuota: a }, true).ok, a).toBe(true);
    }
    expect(validarFicha("REVENTA", base, true)).toEqual({ ok: false, error: "ALICUOTA_REQUERIDA" });
  });
});
