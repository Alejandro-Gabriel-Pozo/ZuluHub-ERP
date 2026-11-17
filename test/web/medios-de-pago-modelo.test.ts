import { describe, expect, it } from "vitest";
import { TIPOS_DE_MEDIO } from "../../src/modulos/caja/publico";
import {
  RUTAS_DE_MEDIOS,
  TIPOS_DE_MEDIO_CON_TEXTO,
  armarLaListaDeMedios,
  opcionesDeTipo,
  rutaDeUnMedio,
  type MedioDeLaLista,
} from "../../apps/web/ui/plantillas/caja/modelo-de-medios-de-pago";

/**
 * El modelo de vista de «Medios de pago» (maqueta `medios.html`, 09/11/2026), con los textos reales del catálogo: cada tarjeta dice lo que la maqueta dice, el
 * efectivo no se desactiva, y el selector del alta no ofrece el efectivo. Previene: un tipo de medio nuevo en el dominio sin su texto en la pantalla.
 */
const medio = (cambios: Partial<MedioDeLaLista> = {}): MedioDeLaLista => ({
  id: "0b0b0b0b-1111-4222-8333-444444444444",
  tipo: "QR",
  nombre: null,
  activo: true,
  version: 3,
  ...cambios,
});

describe("los tipos de medio de la pantalla coinciden con los del dominio de caja", () => {
  it("la misma lista, en el mismo orden", () => {
    expect([...TIPOS_DE_MEDIO_CON_TEXTO]).toEqual([...TIPOS_DE_MEDIO]);
  });
});

describe("armarLaListaDeMedios", () => {
  it("un medio sin nombre propio se llama como su tipo y solo dice la cuenta de cobro", () => {
    const [fila] = armarLaListaDeMedios([medio({ tipo: "TARJETA_DEBITO" })]);
    expect(fila).toMatchObject({
      titulo: "Tarjeta de débito",
      detalle: "Cuenta de cobro: opcional",
    });
  });

  it("un medio con nombre propio lleva su nombre y, en el detalle, el tipo y la cuenta", () => {
    const [fila] = armarLaListaDeMedios([medio({ nombre: "Mercado Pago" })]);
    expect(fila).toMatchObject({
      titulo: "Mercado Pago",
      detalle: "QR · Cuenta de cobro: opcional",
    });
  });

  it("el efectivo no lleva cuenta de cobro y no se puede desactivar; los demás sí", () => {
    const [efectivo, otro] = armarLaListaDeMedios([
      medio({ tipo: "EFECTIVO" }),
      medio({ id: "otro", tipo: "TRANSFERENCIA" }),
    ]);
    expect(efectivo).toMatchObject({
      titulo: "Efectivo",
      detalle: "Cuenta de cobro: no lleva",
      sePuedeDesactivar: false,
    });
    expect(otro).toMatchObject({ detalle: "Cuenta de cobro: opcional", sePuedeDesactivar: true });
  });

  it("el estado: Activo en verde, Desactivado como aviso", () => {
    const [activo, apagado] = armarLaListaDeMedios([
      medio(),
      medio({ id: "apagado", activo: false }),
    ]);
    expect(activo).toMatchObject({ activo: true, estado: { texto: "Activo", tono: "exito" } });
    expect(apagado).toMatchObject({
      activo: false,
      estado: { texto: "Desactivado", tono: "aviso" },
    });
  });

  it("lleva el id, la versión y la dirección de su pantalla; conserva el orden que llegó", () => {
    const filas = armarLaListaDeMedios([medio({ id: "b", version: 9 }), medio({ id: "a" })]);
    expect(filas.map((f) => [f.id, f.version, f.href])).toEqual([
      ["b", 9, "/caja/medios-de-pago/b"],
      ["a", 3, "/caja/medios-de-pago/a"],
    ]);
  });

  it("un tipo que la pantalla no conoce se dice con su propio valor (no se esconde el medio)", () => {
    const [fila] = armarLaListaDeMedios([medio({ tipo: "CRIPTO" })]);
    expect(fila).toMatchObject({ titulo: "CRIPTO", detalle: "Cuenta de cobro: opcional" });
  });

  it("una lista vacía es vacía", () => {
    expect(armarLaListaDeMedios([])).toEqual([]);
  });
});

describe("opcionesDeTipo", () => {
  it("en el alta ofrece todos los tipos menos el efectivo, con su texto y en el orden de la maqueta", () => {
    expect(opcionesDeTipo(null)).toEqual([
      { valor: "TARJETA_DEBITO", etiqueta: "Tarjeta de débito" },
      { valor: "TARJETA_CREDITO", etiqueta: "Tarjeta de crédito" },
      { valor: "TRANSFERENCIA", etiqueta: "Transferencia" },
      { valor: "QR", etiqueta: "QR" },
      { valor: "OTRO", etiqueta: "Otro" },
    ]);
  });

  it("en la edición ofrece solo el tipo del medio (no se cambia), también el efectivo", () => {
    expect(opcionesDeTipo(medio({ tipo: "EFECTIVO" }))).toEqual([
      { valor: "EFECTIVO", etiqueta: "Efectivo" },
    ]);
    expect(opcionesDeTipo(medio({ tipo: "QR" }))).toEqual([{ valor: "QR", etiqueta: "QR" }]);
  });
});

describe("las direcciones", () => {
  it("la lista, el alta y un medio", () => {
    expect(RUTAS_DE_MEDIOS).toEqual({
      lista: "/caja/medios-de-pago",
      nuevo: "/caja/medios-de-pago/nuevo",
    });
    expect(rutaDeUnMedio("x")).toBe("/caja/medios-de-pago/x");
  });
});
