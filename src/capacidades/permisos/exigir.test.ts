import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS, type ClaveAccion, type ClaveModulo } from "../modulos/catalogo";
import { PERMISOS_DE_EMPRESA, REGLAS_DE_EMPRESA, type ReglasDeEmpresa } from "./empresa";
import { exigirAccion, type ActorCargado } from "./exigir";
import { ROLES_DE_EMPRESA } from "./roles";

/**
 * `exigirAccion` es el primer paso de cada caso de uso: carga al actor UNA vez, arma los módulos
 * activos con lo que la empresa activó y deja decidir al guard. Sin base de datos ni puertos.
 */

const cargaDe = (actor: ActorCargado) => {
  let llamadas = 0;
  const cargar = () => {
    llamadas += 1;
    return Promise.resolve(actor);
  };
  return { cargar, llamadas: () => llamadas };
};

const administracionComo = (
  estado: "disponible" | "en_desarrollo",
  obligatorio: boolean,
): ReglasDeEmpresa => ({
  catalogo: {
    administracion: {
      estado,
      obligatorio,
      acciones: CATALOGO_DE_MODULOS.administracion.acciones,
    },
  },
  permisos: PERMISOS_DE_EMPRESA,
});

describe("exigirAccion", () => {
  it("deja pasar al rol que la matriz incluye, y rechaza con SIN_PERMISO al que no", async () => {
    for (const rol of ROLES_DE_EMPRESA) {
      for (const accion of Object.keys(PERMISOS_DE_EMPRESA) as ClaveAccion[]) {
        const puede = (PERMISOS_DE_EMPRESA[accion] as readonly string[]).includes(rol);
        const { cargar } = cargaDe({ rol, modulosActivados: [] });
        expect(await exigirAccion(REGLAS_DE_EMPRESA, accion, cargar), `${rol} ${accion}`).toEqual(
          puede ? { ok: true, valor: null } : { ok: false, error: "SIN_PERMISO" },
        );
      }
    }
  });

  it("sin rol (sin persona, sin membresía activa o persona suspendida) da SIN_PERMISO", async () => {
    const { cargar } = cargaDe({ rol: null, modulosActivados: [] });
    expect(await exigirAccion(REGLAS_DE_EMPRESA, "gerencia.ver_traspaso", cargar)).toEqual({
      ok: false,
      error: "SIN_PERMISO",
    });
  });

  it("carga al actor exactamente una vez por llamada, y cada llamada vuelve a cargarlo", async () => {
    const carga = cargaDe({ rol: "GERENTE", modulosActivados: [] });
    await exigirAccion(REGLAS_DE_EMPRESA, "usuarios.invitar", carga.cargar);
    expect(carga.llamadas()).toBe(1);
    await exigirAccion(REGLAS_DE_EMPRESA, "usuarios.invitar", carga.cargar);
    expect(carga.llamadas()).toBe(2);
  });

  it("no guarda nada entre llamadas: si el actor cambia, cambia el resultado", async () => {
    let actor: ActorCargado = { rol: "GERENTE", modulosActivados: [] };
    const cargar = () => Promise.resolve(actor);
    expect(await exigirAccion(REGLAS_DE_EMPRESA, "usuarios.apagar", cargar)).toEqual({
      ok: true,
      valor: null,
    });
    actor = { rol: null, modulosActivados: [] };
    expect(await exigirAccion(REGLAS_DE_EMPRESA, "usuarios.apagar", cargar)).toEqual({
      ok: false,
      error: "SIN_PERMISO",
    });
  });

  it("un módulo no obligatorio y no activado da MODULO_NO_ACTIVO, aunque el rol alcance", async () => {
    const { cargar } = cargaDe({ rol: "GERENTE", modulosActivados: [] });
    expect(
      await exigirAccion(administracionComo("disponible", false), "usuarios.invitar", cargar),
    ).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
  });

  it("un módulo que la empresa activó pasa; uno que activó otro módulo, no", async () => {
    const reglas = administracionComo("disponible", false);
    const activado = cargaDe({ rol: "GERENTE", modulosActivados: ["administracion"] });
    expect(await exigirAccion(reglas, "usuarios.invitar", activado.cargar)).toEqual({
      ok: true,
      valor: null,
    });
    const otro = cargaDe({ rol: "GERENTE", modulosActivados: ["otro"] });
    expect(await exigirAccion(reglas, "usuarios.invitar", otro.cargar)).toEqual({
      ok: false,
      error: "MODULO_NO_ACTIVO",
    });
  });

  it("un módulo en desarrollo da MODULO_EN_DESARROLLO", async () => {
    const { cargar } = cargaDe({ rol: "GERENTE", modulosActivados: ["administracion"] });
    expect(
      await exigirAccion(administracionComo("en_desarrollo", true), "usuarios.invitar", cargar),
    ).toEqual({ ok: false, error: "MODULO_EN_DESARROLLO" });
  });

  it("si la carga falla, el error se propaga (no se autoriza por omisión)", async () => {
    await expect(
      exigirAccion(REGLAS_DE_EMPRESA, "usuarios.invitar", () => Promise.reject(new Error("caída"))),
    ).rejects.toThrow("caída");
  });

  it("una acción que el catálogo no declara no compila", () => {
    const { cargar } = cargaDe({ rol: "GERENTE", modulosActivados: [] });
    const noSeEjecuta = () =>
      // @ts-expect-error la acción no existe en el catálogo
      exigirAccion(REGLAS_DE_EMPRESA, "usuarios.borrar_todo", cargar);
    expect(noSeEjecuta).toBeTypeOf("function");
    const claves: ClaveModulo[] = ["administracion"];
    expect(claves).toEqual(Object.keys(CATALOGO_DE_MODULOS));
  });
});
