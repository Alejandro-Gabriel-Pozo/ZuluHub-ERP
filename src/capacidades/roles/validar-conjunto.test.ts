import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PisosDeAcciones } from "./pisos";
import {
  MAXIMO_DE_ACCIONES_POR_CONJUNTO,
  validarConjuntoDeAcciones,
  type ContextoDeValidacion,
} from "./validar-conjunto";

const MODULOS: Record<string, string> = {
  "ventas.ver": "ventas",
  "ventas.crear": "ventas",
  "compras.ver": "compras",
  "cajas.crear": "caja",
  "permisos.ver_propios": "administracion",
  "gerencia.ver_traspaso": "administracion",
};
const PISOS: PisosDeAcciones = {
  "cajas.crear": "SOLO_GERENTE",
  "permisos.ver_propios": "TODOS_LOS_ROLES",
  "gerencia.ver_traspaso": "TODOS_LOS_ROLES",
};
const OBLIGATORIAS = ["gerencia.ver_traspaso", "permisos.ver_propios"];

function contexto(sobre: Partial<ContextoDeValidacion> = {}): ContextoDeValidacion {
  return {
    moduloDeLaAccion: (a) => MODULOS[a] ?? null,
    modulosDelPlan: new Set(["ventas", "administracion", "caja"]),
    pisos: PISOS,
    ...sobre,
  };
}

describe("validar un conjunto de acciones", () => {
  it("el tope es el del CHECK de la base (DEC-0630)", () => {
    const sql = readFileSync(
      join(import.meta.dirname, "../../../migraciones/0094_permisos_configurables.sql"),
      "utf8",
    );
    expect(sql).toContain(`cardinality(p_acciones) <= ${MAXIMO_DE_ACCIONES_POR_CONJUNTO}`);
  });

  it("un conjunto válido vuelve ordenado", () => {
    const r = validarConjuntoDeAcciones(
      ["ventas.ver", ...OBLIGATORIAS, "ventas.crear"],
      contexto(),
    );
    expect(r).toEqual({
      ok: true,
      valor: ["gerencia.ver_traspaso", "permisos.ver_propios", "ventas.crear", "ventas.ver"],
    });
  });

  it("solo los pisos obligatorios es un conjunto válido (el rol que nace cerrado)", () => {
    expect(validarConjuntoDeAcciones(OBLIGATORIAS, contexto())).toEqual({
      ok: true,
      valor: OBLIGATORIAS,
    });
  });

  it("rechaza una acción que el catálogo no declara", () => {
    const r = validarConjuntoDeAcciones([...OBLIGATORIAS, "inventada.x"], contexto());
    expect(r).toEqual({
      ok: false,
      error: [{ accion: "inventada.x", motivo: "ACCION_DESCONOCIDA" }],
    });
  });

  it("rechaza una acción repetida, una sola vez por repetición", () => {
    const r = validarConjuntoDeAcciones([...OBLIGATORIAS, "ventas.ver", "ventas.ver"], contexto());
    expect(r).toEqual({ ok: false, error: [{ accion: "ventas.ver", motivo: "ACCION_REPETIDA" }] });
  });

  it("rechaza una acción de un módulo que el plan no incluye (techo, I3)", () => {
    const r = validarConjuntoDeAcciones([...OBLIGATORIAS, "compras.ver"], contexto());
    expect(r).toEqual({
      ok: false,
      error: [{ accion: "compras.ver", motivo: "MODULO_FUERA_DEL_PLAN" }],
    });
  });

  it("sin plan (una plantilla) no hay techo de módulos", () => {
    const r = validarConjuntoDeAcciones(
      [...OBLIGATORIAS, "compras.ver"],
      contexto({ modulosDelPlan: null }),
    );
    expect(r.ok).toBe(true);
  });

  it("rechaza una acción reservada al gerente (piso, I5)", () => {
    const r = validarConjuntoDeAcciones([...OBLIGATORIAS, "cajas.crear"], contexto());
    expect(r).toEqual({
      ok: false,
      error: [{ accion: "cajas.crear", motivo: "RESERVADA_AL_GERENTE" }],
    });
  });

  it("exige cada acción de los pisos de todos los roles, y vacío también falla", () => {
    expect(validarConjuntoDeAcciones(["permisos.ver_propios"], contexto())).toEqual({
      ok: false,
      error: [{ accion: "gerencia.ver_traspaso", motivo: "FALTA_OBLIGATORIA" }],
    });
    expect(validarConjuntoDeAcciones([], contexto())).toEqual({
      ok: false,
      error: OBLIGATORIAS.map((accion) => ({ accion, motivo: "FALTA_OBLIGATORIA" })),
    });
  });

  it("devuelve todos los problemas juntos, en el orden en que aparecen", () => {
    const r = validarConjuntoDeAcciones(
      ["compras.ver", "cajas.crear", "inventada.x", "compras.ver", "permisos.ver_propios"],
      contexto(),
    );
    expect(r).toEqual({
      ok: false,
      error: [
        { accion: "compras.ver", motivo: "MODULO_FUERA_DEL_PLAN" },
        { accion: "cajas.crear", motivo: "RESERVADA_AL_GERENTE" },
        { accion: "inventada.x", motivo: "ACCION_DESCONOCIDA" },
        { accion: "compras.ver", motivo: "ACCION_REPETIDA" },
        { accion: "gerencia.ver_traspaso", motivo: "FALTA_OBLIGATORIA" },
      ],
    });
  });

  it("una acción desconocida no suma además otros motivos", () => {
    const r = validarConjuntoDeAcciones(
      [...OBLIGATORIAS, "inventada.x"],
      contexto({ pisos: { ...PISOS, "inventada.x": "SOLO_GERENTE" } }),
    );
    expect(r).toEqual({
      ok: false,
      error: [{ accion: "inventada.x", motivo: "ACCION_DESCONOCIDA" }],
    });
  });

  it("rechaza más acciones que el tope y avisa sin acción asociada", () => {
    const muchas = Array.from({ length: MAXIMO_DE_ACCIONES_POR_CONJUNTO + 1 }, (_, i) => `x.a${i}`);
    const r = validarConjuntoDeAcciones(muchas, contexto({ moduloDeLaAccion: () => "ventas" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]).toEqual({ accion: null, motivo: "DEMASIADAS_ACCIONES" });
  });

  it("justo en el tope no se rechaza por cantidad", () => {
    const justo = Array.from({ length: MAXIMO_DE_ACCIONES_POR_CONJUNTO }, (_, i) => `x.a${i}`);
    const r = validarConjuntoDeAcciones(
      [...justo, ...OBLIGATORIAS].slice(0, MAXIMO_DE_ACCIONES_POR_CONJUNTO),
      contexto({ moduloDeLaAccion: () => "ventas", pisos: {} }),
    );
    expect(r.ok).toBe(true);
  });
});
