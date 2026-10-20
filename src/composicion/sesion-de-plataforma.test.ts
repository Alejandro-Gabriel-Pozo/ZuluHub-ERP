import { describe, expect, it, vi } from "vitest";
import { CODIGOS_DE_PLATAFORMA } from "../capacidades/autenticacion/codigos-de-plataforma";
import { adminPlataformaId, usuarioAuthId } from "../primitivas/identificadores/marca";
import type { AdminEncontrado } from "../puertos/admins-de-plataforma";
import type { SesionAutenticada } from "../puertos/autenticacion";
import { crearContextoDePlataformaDeLaSesion } from "./sesion-de-plataforma";

/**
 * `contextoDePlataformaDeLaSesion` con un lector de administradores de mentira. La base real (el administrador leído de
 * `admin_plataforma`, la baja que corta, el segundo factor de verdad) se prueba en
 * `test/integracion/consola-contexto-de-sesion.test.ts`.
 */

const MINUTO = 60_000;
const AHORA = new Date("2026-10-20T12:00:00.000Z");
const hace = (ms: number) => new Date(AHORA.getTime() - ms);
const HOST = "consola.example.test";
const ADMIN_ID = adminPlataformaId("aaaaaaaa-0000-4000-8000-000000000011");
const EMAIL = "persona.privada@dominio-de-prueba.test";

const sesion = (cambios: Partial<SesionAutenticada> = {}): SesionAutenticada => ({
  usuarioAuth: usuarioAuthId("bbbbbbbb-0000-4000-8000-000000000001"),
  email: EMAIL,
  emailVerificado: true,
  creadaEn: hace(10 * MINUTO),
  ultimoUso: hace(1 * MINUTO),
  venceEn: new Date(AHORA.getTime() + 29 * MINUTO),
  host: HOST,
  segundoFactorEn: hace(2 * MINUTO),
  segundoFactorEnrolado: true,
  cookiesDeRespuesta: [],
  ...cambios,
});

const activo: AdminEncontrado = { id: ADMIN_ID, rol: "ADMIN", activo: true };

function armar(buscar: (email: string, ahora: Date) => Promise<AdminEncontrado | null>) {
  const buscarAdmin = vi.fn(buscar);
  const registrar = vi.fn();
  const contextoDeLaSesion = crearContextoDePlataformaDeLaSesion({
    hostDeLaConsola: HOST,
    buscarAdmin,
    reloj: () => AHORA,
    registrar,
  });
  return { contextoDeLaSesion, buscarAdmin, registrar };
}

describe("contextoDePlataformaDeLaSesion", () => {
  it("con todo en orden arma el contexto de plataforma del administrador (claim a = su id) con la hora del pedido", async () => {
    const { contextoDeLaSesion, buscarAdmin } = armar(() => Promise.resolve(activo));
    const r = await contextoDeLaSesion(sesion());
    expect(r).toEqual({
      ok: true,
      valor: {
        contexto: { tipo: "PLATAFORMA", actor: { tipo: "ADMIN", id: ADMIN_ID }, ahora: AHORA },
        admin: { id: ADMIN_ID, rol: "ADMIN" },
        segundoFactorEn: hace(2 * MINUTO),
        segundoFactorRecienteHastaMs: 3 * MINUTO,
        ahora: AHORA,
      },
    });
    // Se busca por el email de la sesión, con la hora del pedido.
    expect(buscarAdmin).toHaveBeenCalledExactlyOnceWith(EMAIL, AHORA);
  });

  it("el rol sale de la base: SOPORTE se informa como SOPORTE", async () => {
    const { contextoDeLaSesion } = armar(() => Promise.resolve({ ...activo, rol: "SOPORTE" }));
    const r = await contextoDeLaSesion(sesion());
    expect(r.ok && r.valor.admin.rol).toBe("SOPORTE");
  });

  it("sin sesión: sesion_vencida, y no se lee la base", async () => {
    const { contextoDeLaSesion, buscarAdmin } = armar(() => Promise.resolve(activo));
    expect(await contextoDeLaSesion(null)).toEqual({ ok: false, error: "sesion_vencida" });
    expect(buscarAdmin).not.toHaveBeenCalled();
  });

  it.each([
    ["otro host", { host: "app.example.test" }],
    ["sin host", { host: "" }],
    ["inactiva más de 30 minutos", { ultimoUso: hace(31 * MINUTO) }],
    ["de más de 8 horas", { creadaEn: hace(8 * 60 * MINUTO) }],
    ["vencida en la base", { venceEn: hace(1) }],
  ] as const)("una sesión %s es sesion_vencida y no lee la base", async (_cual, cambios) => {
    const { contextoDeLaSesion, buscarAdmin } = armar(() => Promise.resolve(activo));
    expect(await contextoDeLaSesion(sesion(cambios))).toEqual({
      ok: false,
      error: "sesion_vencida",
    });
    expect(buscarAdmin).not.toHaveBeenCalled();
  });

  it("el email sin verificar es no_habilitado y no lee la base", async () => {
    const { contextoDeLaSesion, buscarAdmin } = armar(() => Promise.resolve(activo));
    expect(await contextoDeLaSesion(sesion({ emailVerificado: false }))).toEqual({
      ok: false,
      error: "no_habilitado",
    });
    expect(buscarAdmin).not.toHaveBeenCalled();
  });

  it("quien no es administrador, o está dado de baja, recibe el mismo no_habilitado", async () => {
    const inexistente = armar(() => Promise.resolve(null));
    const deBaja = armar(() => Promise.resolve({ ...activo, activo: false }));
    expect(await inexistente.contextoDeLaSesion(sesion())).toEqual({
      ok: false,
      error: "no_habilitado",
    });
    expect(await deBaja.contextoDeLaSesion(sesion())).toEqual({
      ok: false,
      error: "no_habilitado",
    });
  });

  it("sin segundo factor en esa sesión no arma contexto: verificar o enrolar según tenga TOTP", async () => {
    const { contextoDeLaSesion } = armar(() => Promise.resolve(activo));
    expect(
      await contextoDeLaSesion(sesion({ segundoFactorEn: null, segundoFactorEnrolado: true })),
    ).toEqual({ ok: false, error: "segundo_factor_requerido" });
    expect(
      await contextoDeLaSesion(sesion({ segundoFactorEn: null, segundoFactorEnrolado: false })),
    ).toEqual({ ok: false, error: "segundo_factor_a_enrolar" });
  });

  it("un fallo de la lectura se rechaza con no_habilitado (nada deja entrar por un error) y se registra SOLO el nombre del error", async () => {
    class ErrorDeLaBase extends Error {
      constructor() {
        super(`falló la lectura de ${EMAIL}: password authentication failed`);
        this.name = "ErrorDeLaBase";
      }
    }
    const { contextoDeLaSesion, registrar } = armar(() => Promise.reject(new ErrorDeLaBase()));
    expect(await contextoDeLaSesion(sesion())).toEqual({ ok: false, error: "no_habilitado" });
    expect(registrar).toHaveBeenCalledExactlyOnceWith(
      "[consola] no se pudo leer al administrador: ErrorDeLaBase",
    );
    expect(JSON.stringify(registrar.mock.calls)).not.toContain(EMAIL);
    // Algo que no es un Error también falla cerrado.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- justamente: algo que no es un Error
    const raro = armar(() => Promise.reject("texto suelto"));
    expect(await raro.contextoDeLaSesion(sesion())).toEqual({ ok: false, error: "no_habilitado" });
    expect(raro.registrar).toHaveBeenCalledExactlyOnceWith(
      "[consola] no se pudo leer al administrador: error",
    );
  });

  it("un registro que falla no tapa el rechazo, y sin registro tampoco se rompe", async () => {
    const conRegistroRoto = crearContextoDePlataformaDeLaSesion({
      hostDeLaConsola: HOST,
      buscarAdmin: () => Promise.reject(new Error("x")),
      reloj: () => AHORA,
      registrar: () => {
        throw new Error("el registro está roto");
      },
    });
    expect(await conRegistroRoto(sesion())).toEqual({ ok: false, error: "no_habilitado" });
    const sinRegistro = crearContextoDePlataformaDeLaSesion({
      hostDeLaConsola: HOST,
      buscarAdmin: () => Promise.reject(new Error("x")),
      reloj: () => AHORA,
    });
    expect(await sinRegistro(sesion())).toEqual({ ok: false, error: "no_habilitado" });
  });

  it("un reloj inválido no arma nada ni lanza: sesion_vencida", async () => {
    const roto = crearContextoDePlataformaDeLaSesion({
      hostDeLaConsola: HOST,
      buscarAdmin: () => Promise.resolve(activo),
      reloj: () => new Date("no es una fecha"),
    });
    expect(await roto(sesion())).toEqual({ ok: false, error: "sesion_vencida" });
  });

  it("cualquier rechazo es uno de los 7 códigos públicos, y nunca incluye el contexto", async () => {
    const casos = [
      sesion({ host: "otro" }),
      sesion({ emailVerificado: false }),
      sesion({ segundoFactorEn: null }),
      sesion({ segundoFactorEn: null, segundoFactorEnrolado: false }),
    ];
    const { contextoDeLaSesion } = armar(() => Promise.resolve(activo));
    for (const s of casos) {
      const r = await contextoDeLaSesion(s);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(CODIGOS_DE_PLATAFORMA).toContain(r.error);
        expect(Object.keys(r)).toEqual(["ok", "error"]);
      }
    }
  });
});
