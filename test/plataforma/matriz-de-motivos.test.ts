import { describe, expect, it } from "vitest";
import { exigirAccion } from "../../src/capacidades/permisos/exigir";
import {
  PERMISOS_DE_PLATAFORMA,
  REGLAS_DE_PLATAFORMA,
  ROLES_DE_PLATAFORMA,
  type ClaveAccionDePlataforma,
  type RolDePlataforma,
} from "../../src/capacidades/permisos/plataforma";
import { rolVigenteDeAdmin } from "../../src/plataforma/dominio/admin";

/**
 * Matriz de motivos de plataforma (H5 §D): cada acción × {ADMIN, SOPORTE, inactivo, inexistente}
 * da "permitido" o `SIN_PERMISO`, y NUNCA otro motivo. Va por el camino real de un caso de uso:
 * `rolVigenteDeAdmin` (el administrador leído dentro de la transacción) → `exigirAccion`.
 */
const acciones = Object.keys(PERMISOS_DE_PLATAFORMA) as ClaveAccionDePlataforma[];

type Actor = { nombre: string; admin: { rol: RolDePlataforma; activo: boolean } | null };

const actores: Actor[] = [
  { nombre: "ADMIN", admin: { rol: "ADMIN", activo: true } },
  { nombre: "SOPORTE", admin: { rol: "SOPORTE", activo: true } },
  { nombre: "ADMIN inactivo", admin: { rol: "ADMIN", activo: false } },
  { nombre: "SOPORTE inactivo", admin: { rol: "SOPORTE", activo: false } },
  { nombre: "inexistente", admin: null },
];

describe("plataforma: acción × actor → permitido o SIN_PERMISO", () => {
  it("hay 32 acciones y 5 actores: 160 combinaciones", () => {
    expect(acciones.length * actores.length).toBe(160);
  });

  it("solo un administrador ACTIVO con un rol que la matriz incluye puede; todo el resto es SIN_PERMISO", async () => {
    for (const accion of acciones) {
      for (const { nombre, admin } of actores) {
        const rol = rolVigenteDeAdmin(admin);
        const resultado = await exigirAccion(REGLAS_DE_PLATAFORMA, accion, () =>
          Promise.resolve({ rol, modulosActivados: [], modulosHabilitados: [] }),
        );
        const puede =
          admin !== null &&
          admin.activo &&
          (PERMISOS_DE_PLATAFORMA[accion] as readonly string[]).includes(admin.rol);
        expect(resultado, `${nombre} ${accion}`).toEqual(
          puede ? { ok: true, valor: null } : { ok: false, error: "SIN_PERMISO" },
        );
      }
    }
  });

  it("un administrador inactivo o inexistente no puede ninguna acción, ni siquiera ver", async () => {
    for (const accion of acciones) {
      for (const admin of [null, { rol: "ADMIN", activo: false }] as const) {
        const resultado = await exigirAccion(REGLAS_DE_PLATAFORMA, accion, () =>
          Promise.resolve({
            rol: rolVigenteDeAdmin(admin),
            modulosActivados: [],
            modulosHabilitados: [],
          }),
        );
        expect(resultado, accion).toEqual({ ok: false, error: "SIN_PERMISO" });
      }
    }
  });

  it("los roles de este test son los de plataforma", () => {
    expect(actores.filter((a) => a.admin?.activo === true).map((a) => a.admin?.rol)).toEqual([
      ...ROLES_DE_PLATAFORMA,
    ]);
  });
});
