import { describe, expect, it } from "vitest";
import { MODULOS_DE_PRUEBA } from "../../../../test/utilidades/planes";
import { CATALOGO_DE_MODULOS } from "../../../capacidades/modulos/catalogo";
import { decidirActivacion, decidirDesactivacion, type PedidoDeActivacion } from "./activacion";

const activar = (extra: Partial<PedidoDeActivacion<keyof typeof MODULOS_DE_PRUEBA>> = {}) =>
  decidirActivacion({
    catalogo: MODULOS_DE_PRUEBA,
    modulo: "caja",
    activados: [],
    habilitados: ["caja", "ventas", "cuentas", "reservas"],
    ...extra,
  });

const desactivar = (extra: Partial<Parameters<typeof decidirDesactivacion>[0]> = {}) =>
  decidirDesactivacion({
    catalogo: MODULOS_DE_PRUEBA,
    modulo: "caja",
    activados: ["caja"],
    ...extra,
  });

describe("decidirActivacion", () => {
  it("activa un módulo disponible, dentro del techo y sin requisitos", () => {
    expect(activar()).toEqual({ ok: true, valor: { yaEstabaActivo: false } });
  });

  it("activa uno cuyos requisitos están activos (obligatorio o activado dentro del techo)", () => {
    expect(activar({ modulo: "ventas", activados: ["caja"] })).toEqual({
      ok: true,
      valor: { yaEstabaActivo: false },
    });
    // `reservas` requiere un módulo obligatorio: siempre está activo.
    expect(activar({ modulo: "reservas" })).toEqual({ ok: true, valor: { yaEstabaActivo: false } });
  });

  it("repetir no es un error: si ya está activado, ok sin escribir", () => {
    expect(activar({ activados: ["caja"] })).toEqual({ ok: true, valor: { yaEstabaActivo: true } });
  });

  it("ya estaba activado aunque la baja de plan lo dejó fuera del techo (no se reactiva ni se rechaza)", () => {
    expect(activar({ activados: ["caja"], habilitados: [] })).toEqual({
      ok: true,
      valor: { yaEstabaActivo: true },
    });
  });

  it("módulo desconocido (también un nombre heredado de Object)", () => {
    for (const modulo of ["fantasma", "constructor", ""]) {
      expect(activar({ modulo })).toEqual({ ok: false, error: { codigo: "MODULO_DESCONOCIDO" } });
    }
  });

  it("módulo obligatorio: no se guarda, siempre está", () => {
    expect(activar({ modulo: "nucleo", habilitados: ["nucleo"] })).toEqual({
      ok: false,
      error: { codigo: "MODULO_OBLIGATORIO" },
    });
  });

  it("módulo en desarrollo", () => {
    expect(activar({ modulo: "comandas", habilitados: ["comandas"] })).toEqual({
      ok: false,
      error: { codigo: "MODULO_EN_DESARROLLO" },
    });
  });

  it("fuera del techo del plan", () => {
    expect(activar({ habilitados: [] })).toEqual({
      ok: false,
      error: { codigo: "MODULO_FUERA_DEL_PLAN" },
    });
    expect(activar({ habilitados: ["ventas"] })).toEqual({
      ok: false,
      error: { codigo: "MODULO_FUERA_DEL_PLAN" },
    });
  });

  it("requiere inactivo: nombra el requisito que falta (el primero en el orden del catálogo del módulo)", () => {
    expect(activar({ modulo: "ventas" })).toEqual({
      ok: false,
      error: { codigo: "REQUIERE_INACTIVO", modulo: "caja" },
    });
    expect(activar({ modulo: "cuentas", activados: ["caja"] })).toEqual({
      ok: false,
      error: { codigo: "REQUIERE_INACTIVO", modulo: "ventas" },
    });
  });

  it("un requisito en solo lectura (activado pero fuera del techo) no cuenta como activo", () => {
    expect(activar({ modulo: "ventas", activados: ["caja"], habilitados: ["ventas"] })).toEqual({
      ok: false,
      error: { codigo: "REQUIERE_INACTIVO", modulo: "caja" },
    });
  });

  it("orden: desconocido, obligatorio, en desarrollo, ya activado, fuera del techo, requiere", () => {
    // Un obligatorio también «está activado» pero se rechaza antes.
    expect(activar({ modulo: "nucleo", activados: ["nucleo"] })).toMatchObject({
      error: { codigo: "MODULO_OBLIGATORIO" },
    });
    expect(activar({ modulo: "comandas", activados: ["comandas"] })).toMatchObject({
      error: { codigo: "MODULO_EN_DESARROLLO" },
    });
    // Fuera del techo gana a requiere inactivo.
    expect(activar({ modulo: "ventas", habilitados: [] })).toMatchObject({
      error: { codigo: "MODULO_FUERA_DEL_PLAN" },
    });
  });

  it("funciona con el catálogo real: administración es obligatoria", () => {
    expect(
      decidirActivacion({
        catalogo: CATALOGO_DE_MODULOS,
        modulo: "administracion",
        activados: [],
        habilitados: [],
      }),
    ).toEqual({ ok: false, error: { codigo: "MODULO_OBLIGATORIO" } });
  });

  it("no modifica sus entradas", () => {
    const activados = ["caja"];
    const habilitados = ["caja", "ventas"];
    activar({ modulo: "ventas", activados, habilitados });
    expect(activados).toEqual(["caja"]);
    expect(habilitados).toEqual(["caja", "ventas"]);
  });
});

describe("decidirDesactivacion", () => {
  it("desactiva un módulo que ninguno activado requiere", () => {
    expect(desactivar()).toEqual({ ok: true, valor: { yaEstabaInactivo: false } });
    expect(desactivar({ modulo: "ventas", activados: ["caja", "ventas"] })).toEqual({
      ok: true,
      valor: { yaEstabaInactivo: false },
    });
  });

  it("repetir no es un error: si no está activado, ok sin escribir", () => {
    expect(desactivar({ activados: [] })).toEqual({ ok: true, valor: { yaEstabaInactivo: true } });
    // Aunque otro módulo activado lo requiera (inconsistencia previa): no hay nada que desactivar.
    expect(desactivar({ activados: ["ventas"] })).toEqual({
      ok: true,
      valor: { yaEstabaInactivo: true },
    });
  });

  it("módulo desconocido y módulo obligatorio", () => {
    expect(desactivar({ modulo: "fantasma" })).toEqual({
      ok: false,
      error: { codigo: "MODULO_DESCONOCIDO" },
    });
    expect(desactivar({ modulo: "constructor" })).toEqual({
      ok: false,
      error: { codigo: "MODULO_DESCONOCIDO" },
    });
    expect(desactivar({ modulo: "nucleo", activados: ["nucleo"] })).toEqual({
      ok: false,
      error: { codigo: "MODULO_OBLIGATORIO" },
    });
  });

  it("es requerido por otro activado: nombra al primero, en el orden del catálogo", () => {
    expect(desactivar({ activados: ["cuentas", "ventas", "caja"] })).toEqual({
      ok: false,
      error: { codigo: "ES_REQUERIDO_POR", modulo: "ventas" },
    });
    expect(desactivar({ modulo: "ventas", activados: ["ventas", "cuentas"] })).toEqual({
      ok: false,
      error: { codigo: "ES_REQUERIDO_POR", modulo: "cuentas" },
    });
  });

  it("un dependiente que quedó en solo lectura sigue impidiendo desactivar a quien necesita", () => {
    // `ventas` está activado aunque el plan ya no lo incluya: el pedido no mira el plan.
    expect(desactivar({ activados: ["caja", "ventas"] })).toMatchObject({
      error: { codigo: "ES_REQUERIDO_POR", modulo: "ventas" },
    });
  });

  it("un módulo que lo requiere pero no está activado no impide", () => {
    expect(desactivar({ activados: ["caja", "reservas"] })).toEqual({
      ok: true,
      valor: { yaEstabaInactivo: false },
    });
  });

  it("orden: desconocido, obligatorio, ya inactivo, requerido por", () => {
    expect(desactivar({ modulo: "nucleo", activados: [] })).toMatchObject({
      error: { codigo: "MODULO_OBLIGATORIO" },
    });
  });

  it("no modifica sus entradas", () => {
    const activados = ["caja", "ventas"];
    desactivar({ activados });
    expect(activados).toEqual(["caja", "ventas"]);
  });
});
