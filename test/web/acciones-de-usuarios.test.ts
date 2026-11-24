import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` de «Usuarios» (`apps/web/app/s/app/acciones-de-usuarios.ts`, tramos U2 y U3): fino a propósito. Exporta seis funciones asíncronas y delega en `servidor/usuarios.ts`.
 * El id de la invitación o de la persona llega del `.bind` (Next lo cifra), NO del formulario: aunque el formulario traiga otro, se usa el ligado. Las de invitaciones no redirigen; desactivar tampoco
 * (se queda en la pantalla y vuelve a pedirla) y no acepta ni rol ni email del navegador.
 */
vi.mock("server-only", () => ({}));
const delegadas = vi.hoisted(() => ({ llamadas: [] as unknown[][] }));
vi.mock("../../apps/web/servidor/usuarios", () => ({
  invitarAUnUsuario: (...args: unknown[]) => {
    delegadas.llamadas.push(["invitar", ...args]);
    return Promise.resolve({ estado: "HECHO" });
  },
  reenviarUnaInvitacion: (...args: unknown[]) => {
    delegadas.llamadas.push(["reenviar", ...args]);
    return Promise.resolve({ estado: "HECHO", ruta: "/cuenta/usuarios/invitaciones/nueva" });
  },
  revocarUnaInvitacion: (...args: unknown[]) => {
    delegadas.llamadas.push(["revocar", ...args]);
    return Promise.resolve({ estado: "HECHO", ruta: "/cuenta/usuarios" });
  },
  desactivarElUsuario: (...args: unknown[]) => {
    delegadas.llamadas.push(["desactivar", ...args]);
    return Promise.resolve({ error: null });
  },
  reactivarAUnUsuario: (...args: unknown[]) => {
    delegadas.llamadas.push(["reactivar", ...args]);
    return Promise.resolve({ estado: "HECHO" });
  },
  guardarLasSucursalesDeUnEmpleado: (...args: unknown[]) => {
    delegadas.llamadas.push(["sucursales", ...args]);
    return Promise.resolve({ error: null });
  },
}));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("ninguna acción de Usuarios redirige");
  },
}));

import * as acciones from "../../apps/web/app/s/app/acciones-de-usuarios";

const INICIAL = { estado: "INICIAL" } as const;

describe("las acciones de servidor de «Usuarios» expuestas a Next", () => {
  it("exporta solo las seis, asíncronas", () => {
    expect(Object.keys(acciones).sort()).toEqual([
      "asignarSucursalesAccion",
      "desactivarUsuarioAccion",
      "invitarUsuarioAccion",
      "reactivarUsuarioAccion",
      "reenviarInvitacionAccion",
      "revocarInvitacionAccion",
    ]);
    for (const f of Object.values(acciones)) expect(f.constructor.name).toBe("AsyncFunction");
  });

  it("invitar delega con el formulario tal cual (la lista blanca está en la composición)", async () => {
    const datos = new FormData();
    datos.set("email", "a@x.test");
    datos.set("empresaId", "otra");
    delegadas.llamadas.length = 0;
    expect(await acciones.invitarUsuarioAccion(INICIAL, datos)).toEqual({ estado: "HECHO" });
    expect(delegadas.llamadas).toEqual([["invitar", datos]]);
  });

  it("reenviar y revocar usan el id ligado con `.bind`, no uno que venga en el formulario", async () => {
    const datos = new FormData();
    datos.set("invitacionId", "el-del-formulario");
    delegadas.llamadas.length = 0;
    const reenviar = acciones.reenviarInvitacionAccion.bind(null, "el-ligado");
    const revocar = acciones.revocarInvitacionAccion.bind(null, "el-ligado");
    expect(await reenviar(INICIAL, datos)).toEqual({
      estado: "HECHO",
      ruta: "/cuenta/usuarios/invitaciones/nueva",
    });
    expect(await revocar(INICIAL, datos)).toEqual({ estado: "HECHO", ruta: "/cuenta/usuarios" });
    expect(delegadas.llamadas).toEqual([
      ["reenviar", "el-ligado"],
      ["revocar", "el-ligado"],
    ]);
  });

  it("desactivar delega SOLO con el id que ligó la página, sin el estado anterior", async () => {
    delegadas.llamadas.length = 0;
    const previo = { error: null };
    expect(await acciones.desactivarUsuarioAccion("persona-1", previo)).toEqual({ error: null });
    expect(delegadas.llamadas).toEqual([["desactivar", "persona-1"]]);
  });

  it("desactivar con .bind (como la arma la página): lo único que falta es el estado anterior", async () => {
    delegadas.llamadas.length = 0;
    const accion = acciones.desactivarUsuarioAccion.bind(null, "persona-2");
    await accion({ error: null });
    expect(delegadas.llamadas).toEqual([["desactivar", "persona-2"]]);
  });

  it("asignar sucursales (U4) usa la persona ligada con `.bind` y el formulario tal cual, sin el estado anterior", async () => {
    const datos = new FormData();
    datos.append("sucursales", "s-1");
    datos.set("personaId", "la-del-formulario");
    delegadas.llamadas.length = 0;
    const accion = acciones.asignarSucursalesAccion.bind(null, "la-ligada");
    expect(await accion({ error: null }, datos)).toEqual({ error: null });
    expect(delegadas.llamadas).toEqual([["sucursales", "la-ligada", datos]]);
  });

  it("reactivar (U3, parte B) usa la persona ligada con `.bind` y NO acepta email ni rol del formulario: lo delega tal cual para que el servidor tome solo las sucursales", async () => {
    const datos = new FormData();
    datos.set("email", "otro@x.test");
    datos.set("rol", "ADMINISTRADOR");
    datos.set("personaId", "la-del-formulario");
    datos.append("sucursales", "s-1");
    delegadas.llamadas.length = 0;
    const accion = acciones.reactivarUsuarioAccion.bind(null, "la-ligada");
    expect(await accion(INICIAL, datos)).toEqual({ estado: "HECHO" });
    expect(delegadas.llamadas).toEqual([["reactivar", "la-ligada", datos]]);
  });
});
