import { describe, expect, it } from "vitest";
import {
  numeroDeLaProximaVersion,
  validarVersionDePlantilla,
  type ContextoDePlantilla,
} from "./plantillas";

const MODULOS: Record<string, string> = {
  "ventas.ver": "ventas",
  "ventas.crear": "ventas",
  "cajas.crear": "caja",
  "permisos.ver_propios": "administracion",
};
const contexto: ContextoDePlantilla = {
  moduloDeLaAccion: (a) => MODULOS[a] ?? null,
  pisos: { "cajas.crear": "SOLO_GERENTE", "permisos.ver_propios": "TODOS_LOS_ROLES" },
};
const BASE = "permisos.ver_propios";

describe("versiones de plantilla", () => {
  it("una versión del administrador que incluye lo del operador es válida y vuelve ordenada", () => {
    expect(
      validarVersionDePlantilla(
        {
          clave: "ADMINISTRADOR",
          acciones: ["ventas.ver", BASE, "ventas.crear"],
          otraVigente: [BASE, "ventas.ver"],
        },
        contexto,
      ),
    ).toEqual({ ok: true, valor: [BASE, "ventas.crear", "ventas.ver"] });
  });

  it("una versión del operador contenida en el administrador es válida", () => {
    expect(
      validarVersionDePlantilla(
        {
          clave: "OPERADOR",
          acciones: [BASE, "ventas.ver"],
          otraVigente: [BASE, "ventas.ver", "ventas.crear"],
        },
        contexto,
      ).ok,
    ).toBe(true);
  });

  it("el operador no puede tener algo que el administrador vigente no tiene (I16)", () => {
    expect(
      validarVersionDePlantilla(
        { clave: "OPERADOR", acciones: [BASE, "ventas.crear"], otraVigente: [BASE] },
        contexto,
      ),
    ).toEqual({
      ok: false,
      error: [{ accion: "ventas.crear", motivo: "ROMPE_EL_ORDEN_JERARQUICO" }],
    });
  });

  it("al sacarle algo al administrador, no puede quedar por debajo del operador vigente (I16)", () => {
    expect(
      validarVersionDePlantilla(
        { clave: "ADMINISTRADOR", acciones: [BASE], otraVigente: [BASE, "ventas.ver"] },
        contexto,
      ),
    ).toEqual({
      ok: false,
      error: [{ accion: "ventas.ver", motivo: "ROMPE_EL_ORDEN_JERARQUICO" }],
    });
  });

  it("una plantilla no puede llevar una acción reservada al gerente ni faltarle un piso de todos (I5)", () => {
    expect(
      validarVersionDePlantilla(
        { clave: "ADMINISTRADOR", acciones: ["cajas.crear"], otraVigente: [] },
        contexto,
      ),
    ).toEqual({
      ok: false,
      error: [
        { accion: "cajas.crear", motivo: "RESERVADA_AL_GERENTE" },
        { accion: BASE, motivo: "FALTA_OBLIGATORIA" },
      ],
    });
  });

  it("una plantilla no tiene techo de plan: acepta acciones de cualquier módulo del catálogo", () => {
    expect(
      validarVersionDePlantilla(
        { clave: "ADMINISTRADOR", acciones: [BASE, "ventas.ver"], otraVigente: [] },
        contexto,
      ).ok,
    ).toBe(true);
  });

  it("junta los problemas del conjunto con los del orden", () => {
    const r = validarVersionDePlantilla(
      { clave: "OPERADOR", acciones: ["inventada.x", "ventas.crear"], otraVigente: [] },
      contexto,
    );
    expect(r).toEqual({
      ok: false,
      error: [
        { accion: "inventada.x", motivo: "ACCION_DESCONOCIDA" },
        { accion: BASE, motivo: "FALTA_OBLIGATORIA" },
        { accion: "inventada.x", motivo: "ROMPE_EL_ORDEN_JERARQUICO" },
        { accion: "ventas.crear", motivo: "ROMPE_EL_ORDEN_JERARQUICO" },
      ],
    });
  });

  it("los problemas de orden salen ordenados por acción, sea cual sea el orden de la propuesta", () => {
    const r = validarVersionDePlantilla(
      { clave: "OPERADOR", acciones: [BASE, "ventas.ver", "ventas.crear"], otraVigente: [BASE] },
      contexto,
    );
    expect(r).toEqual({
      ok: false,
      error: [
        { accion: "ventas.crear", motivo: "ROMPE_EL_ORDEN_JERARQUICO" },
        { accion: "ventas.ver", motivo: "ROMPE_EL_ORDEN_JERARQUICO" },
      ],
    });
  });

  it("las versiones no tienen saltos: empiezan en 1 y siguen de a una", () => {
    expect(numeroDeLaProximaVersion(null)).toBe(1);
    expect(numeroDeLaProximaVersion(1)).toBe(2);
    expect(numeroDeLaProximaVersion(41)).toBe(42);
  });
});
