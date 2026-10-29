import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cerrar sesión vence las cookies `__Host-` de empresa e invitación con los MISMOS atributos con que se fijan.
 * Fallo que previene: `delete(nombre)` no manda `Secure`, el navegador rechaza tocar una cookie `__Host-` sin él y
 * la cookie sigue viva tras cerrar sesión. Sin base de datos: la composición y Next son falsos; el resto es real.
 */
vi.mock("server-only", () => ({}));

const estado = vi.hoisted(() => ({
  escrituras: [] as { nombre: string; valor: string; opciones: Record<string, unknown> }[],
  borrados: [] as string[],
}));

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ host: "app.prueba", origin: "https://app.prueba" })),
  cookies: () =>
    Promise.resolve({
      set: (nombre: string, valor: string, opciones: Record<string, unknown> = {}) => {
        estado.escrituras.push({ nombre, valor, opciones });
      },
      delete: (nombre: string) => {
        estado.borrados.push(nombre);
      },
    }),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../../apps/web/servidor/pedido", () => ({
  exigirPuerta: () => Promise.resolve({ host: "app.prueba", marcaId: "marca" }),
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: { respuesta: {} },
  sesionDelPedido: () =>
    Promise.resolve({ sesion: {}, puerta: { host: "app.prueba", marcaId: "marca" } }),
}));
vi.mock("../../src/composicion/a-respuesta", () => ({ aRespuestaDeExcepcion: vi.fn() }));
vi.mock("../../src/composicion/sesion-y-empresa", () => ({
  aceptarInvitacionDeLaSesion: () =>
    Promise.resolve({ ok: true, dato: { yaEstabaAceptada: false } }),
  elegirEmpresa: vi.fn(),
  iniciarIngresoConGoogle: vi.fn(),
  cerrarSesion: () => Promise.resolve({ ok: true, dato: { cookies: [] } }),
}));

import {
  COOKIE_DE_EMPRESA,
  COOKIE_DE_INVITACION,
  OPCIONES_DE_COOKIE_DE_EMPRESA,
  OPCIONES_DE_COOKIE_DE_INVITACION,
  vencerCookie,
} from "../../apps/web/servidor/cookies";
import { aceptarLaInvitacion, cerrarLaSesion } from "../../apps/web/servidor/acciones";

beforeEach(() => {
  estado.escrituras.length = 0;
  estado.borrados.length = 0;
});

describe.each([
  ["empresa", COOKIE_DE_EMPRESA, OPCIONES_DE_COOKIE_DE_EMPRESA],
  ["invitación", COOKIE_DE_INVITACION, OPCIONES_DE_COOKIE_DE_INVITACION],
])("cerrar sesión: la cookie de %s", (_nombre, cookie, opcionesDeFijado) => {
  it("se vence vacía, con maxAge 0 y los atributos del fijado (Secure, Path=/, HttpOnly, sin Domain, SameSite)", async () => {
    await cerrarLaSesion();
    const vencida = estado.escrituras.find((x) => x.nombre === cookie);
    expect(vencida).toBeDefined();
    expect(vencida?.valor).toBe("");
    expect(vencida?.opciones).toEqual({ ...opcionesDeFijado, maxAge: 0 });
    // El fijado es Secure: sin eso el navegador rechaza el cambio de una `__Host-`.
    expect(vencida?.opciones["secure"]).toBe(true);
    expect(vencida?.opciones["domain"]).toBeUndefined();
    expect(estado.borrados).not.toContain(cookie);
  });
});

describe("vencerCookie", () => {
  it.each([
    ["empresa", COOKIE_DE_EMPRESA, OPCIONES_DE_COOKIE_DE_EMPRESA],
    ["invitación", COOKIE_DE_INVITACION, OPCIONES_DE_COOKIE_DE_INVITACION],
  ])("%s: vacía, maxAge 0 y el resto de los atributos del fijado", (_n, cookie, opciones) => {
    vencerCookie(
      {
        set: (n: string, v: string, o: Record<string, unknown>) =>
          void estado.escrituras.push({ nombre: n, valor: v, opciones: { ...o } }),
      } as unknown as Parameters<typeof vencerCookie>[0],
      cookie,
      opciones,
    );
    const [escritura] = estado.escrituras;
    expect(escritura?.nombre).toBe(cookie);
    expect(escritura?.valor).toBe("");
    expect(escritura?.opciones).toEqual({ ...opciones, maxAge: 0 });
    expect(escritura?.opciones["secure"]).toBe(true);
    expect(escritura?.opciones["httpOnly"]).toBe(true);
    expect(escritura?.opciones["path"]).toBe("/");
    expect(escritura?.opciones["sameSite"]).toBe(opciones.sameSite);
    expect(escritura?.opciones["domain"]).toBeUndefined();
  });
});

describe("aceptar la invitación", () => {
  it("vence la cookie del enlace con los atributos del fijado, sin delete(nombre)", async () => {
    const r = await aceptarLaInvitacion({ token: "t", clave: "c" });
    expect(r.ok).toBe(true);
    const vencida = estado.escrituras.find((x) => x.nombre === COOKIE_DE_INVITACION);
    expect(vencida?.valor).toBe("");
    expect(vencida?.opciones).toEqual({ ...OPCIONES_DE_COOKIE_DE_INVITACION, maxAge: 0 });
    expect(estado.borrados).toEqual([]);
  });
});
