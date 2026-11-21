import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("server-only", () => ({}));

const { exigirAcceso, crearPlan, guardarBorradorDePlan, publicarVersionDePlan, orden } = vi.hoisted(
  () => ({
    orden: [] as string[],
    exigirAcceso: vi.fn(),
    crearPlan: vi.fn(),
    guardarBorradorDePlan: vi.fn(),
    publicarVersionDePlan: vi.fn(),
  }),
);

vi.mock("../../apps/plataforma/servidor/acceso", () => ({ exigirAcceso }));

import {
  crearPlanDeConsola,
  guardarBorradorDeConsola,
  publicarVersionDeConsola,
} from "../../apps/plataforma/servidor/acciones-planes";

/**
 * Las acciones del servidor de «Planes» (frontera entre el navegador y los casos de uso): `exigirAcceso` y los casos van simulados. Se prueba lo que las acciones garantizan: autorizan antes de operar,
 * dejan pasar la redirección de Next, no dejan entrar entradas inválidas, traducen cada rechazo a su texto aprobado y no escriben el pedido en el registro del servidor.
 */

const CLAVE = "3f2b8c1e-5d4a-4b7e-9c1a-2e6f8a0b1c3d";
const PLAN = "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a";
const REDIRECCION = Object.assign(new Error("NEXT_REDIRECT"), {
  digest: "NEXT_REDIRECT;replace;/ingreso;307;",
});
const VIEJA = "La pantalla quedó vieja. Volvé a abrirla y probá de nuevo.";

const CREAR = { claveDeIdempotencia: CLAVE, codigo: "prueba" };
const GUARDAR = {
  claveDeIdempotencia: CLAVE,
  planId: PLAN,
  versionEsperada: null,
  nombreComercial: "Prueba",
  modulos: ["caja"],
  perillas: { salon: { tipo: "INTERRUPTOR", encendida: true } },
};
const PUBLICAR = { claveDeIdempotencia: CLAVE, planId: PLAN, motivo: "  Lanzamiento  " };

let registro: MockInstance<(...datos: unknown[]) => void>;

beforeEach(() => {
  orden.length = 0;
  for (const m of [exigirAcceso, crearPlan, guardarBorradorDePlan, publicarVersionDePlan])
    m.mockReset();
  exigirAcceso.mockImplementation(() => {
    orden.push("exigirAcceso");
    return Promise.resolve({ casos: { crearPlan, guardarBorradorDePlan, publicarVersionDePlan } });
  });
  crearPlan.mockImplementation(() => {
    orden.push("crearPlan");
    return Promise.resolve({ ok: true, valor: { planId: PLAN, yaExistia: false } });
  });
  guardarBorradorDePlan.mockImplementation(() => {
    orden.push("guardar");
    return Promise.resolve({ ok: true, valor: { borradorId: "b", version: 2 } });
  });
  publicarVersionDePlan.mockImplementation(() => {
    orden.push("publicar");
    return Promise.resolve({ ok: true, valor: { numero: 3 } });
  });
  registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  registro.mockRestore();
});

const ACCIONES = [
  {
    nombre: "crear",
    correr: crearPlanDeConsola,
    entrada: CREAR,
    caso: () => crearPlan,
    malas: [
      null,
      {},
      { ...CREAR, claveDeIdempotencia: "x" },
      { ...CREAR, codigo: 5 },
      { ...CREAR, codigo: "a".repeat(65) },
    ],
  },
  {
    nombre: "guardar",
    correr: guardarBorradorDeConsola,
    entrada: GUARDAR,
    caso: () => guardarBorradorDePlan,
    malas: [
      null,
      [],
      { ...GUARDAR, planId: "no" },
      { ...GUARDAR, claveDeIdempotencia: 1 },
      { ...GUARDAR, versionEsperada: 0 },
      { ...GUARDAR, versionEsperada: 1.5 },
      { ...GUARDAR, versionEsperada: "1" },
      { ...GUARDAR, nombreComercial: 5 },
      { ...GUARDAR, nombreComercial: "n".repeat(241) },
      { ...GUARDAR, modulos: "caja" },
      { ...GUARDAR, modulos: [1] },
      { ...GUARDAR, modulos: Array.from({ length: 201 }, () => "m") },
      { ...GUARDAR, modulos: ["x".repeat(65)] },
      { ...GUARDAR, perillas: [] },
      { ...GUARDAR, perillas: { salon: true } },
      { ...GUARDAR, perillas: { salon: { tipo: "OTRO" } } },
      { ...GUARDAR, perillas: { salon: { tipo: "INTERRUPTOR", encendida: "si" } } },
      { ...GUARDAR, perillas: { cajas: { tipo: "LIMITE", limite: -1 } } },
      { ...GUARDAR, perillas: { cajas: { tipo: "LIMITE", limite: 1.5 } } },
      { ...GUARDAR, perillas: { ["k".repeat(65)]: { tipo: "INTERRUPTOR", encendida: true } } },
      {
        ...GUARDAR,
        perillas: Object.fromEntries(
          Array.from({ length: 201 }, (_, i) => [
            `p${String(i)}`,
            { tipo: "INTERRUPTOR", encendida: true },
          ]),
        ),
      },
    ],
  },
  {
    nombre: "publicar",
    correr: publicarVersionDeConsola,
    entrada: PUBLICAR,
    caso: () => publicarVersionDePlan,
    malas: [
      null,
      { ...PUBLICAR, planId: "no" },
      { ...PUBLICAR, motivo: "   " },
      { ...PUBLICAR, motivo: 5 },
      { ...PUBLICAR, motivo: "m".repeat(501) },
    ],
  },
] as const;

describe.each(ACCIONES)("acción de planes: $nombre", ({ correr, entrada, caso, malas }) => {
  it("autoriza primero y llama al caso", async () => {
    const r = await correr(entrada);
    expect(r.ok).toBe(true);
    expect(orden[0]).toBe("exigirAcceso");
    expect(caso()).toHaveBeenCalledTimes(1);
  });

  it.each(malas.map((m, i) => [i, m] as const))(
    "entrada inválida #%s: «Los datos no son válidos» y sin tocar el caso ni el acceso",
    async (_i, mala) => {
      expect(await correr(mala)).toEqual({
        ok: false,
        error: { tipo: "GENERAL", texto: "Los datos no son válidos. Revisalos." },
      });
      expect(exigirAcceso).not.toHaveBeenCalled();
      expect(caso()).not.toHaveBeenCalled();
    },
  );

  it("NEXT_REDIRECT de exigirAcceso o del caso se relanza tal cual y no se registra", async () => {
    exigirAcceso.mockRejectedValueOnce(REDIRECCION);
    await expect(correr(entrada)).rejects.toBe(REDIRECCION);
    expect(caso()).not.toHaveBeenCalled();
    caso().mockRejectedValueOnce(REDIRECCION);
    await expect(correr(entrada)).rejects.toBe(REDIRECCION);
    expect(registro).not.toHaveBeenCalled();
  });

  it("una excepción inesperada devuelve INESPERADO con referencia y no escribe el pedido en el registro", async () => {
    caso().mockRejectedValueOnce(new Error("se cayó la base"));
    const r = await correr(entrada);
    expect(r).toMatchObject({ ok: false, error: { tipo: "INESPERADO" } });
    expect(r.ok ? "" : (r.referencia ?? "")).toMatch(/^PD-/);
    expect(JSON.stringify(registro.mock.calls)).not.toContain(CLAVE);
    expect(JSON.stringify(registro.mock.calls)).not.toContain("Lanzamiento");
  });

  it("un error de persistencia (objeto sin código) es INESPERADO y no se muestra", async () => {
    caso().mockResolvedValueOnce({ ok: false, error: { tipo: "ErrorDePersistencia" } });
    expect(await correr(entrada)).toMatchObject({ ok: false, error: { tipo: "INESPERADO" } });
  });

  it("sin permiso o sin segundo factor reciente: lo que dice el guard, sin texto propio", async () => {
    caso().mockResolvedValueOnce({ ok: false, error: "SIN_PERMISO" });
    expect(await correr(entrada)).toEqual({ ok: false, error: { tipo: "OCULTAR_ACCION" } });
    caso().mockResolvedValueOnce({ ok: false, error: "segundo_factor_reciente_requerido" });
    expect(await correr(entrada)).toEqual({ ok: false, error: { tipo: "SEGUNDO_FACTOR" } });
  });
});

describe("lo que cada acción le pasa al caso y lo que devuelve", () => {
  it("crear: el código recortado y la clave del navegador", async () => {
    expect(await crearPlanDeConsola({ ...CREAR, codigo: " prueba " })).toEqual({
      ok: true,
      dato: { planId: PLAN, yaExistia: false },
    });
    expect(crearPlan).toHaveBeenCalledWith({ claveDeIdempotencia: CLAVE, codigo: "prueba" });
    crearPlan.mockResolvedValueOnce({ ok: true, valor: { planId: PLAN, yaExistia: true } });
    expect(await crearPlanDeConsola(CREAR)).toEqual({
      ok: true,
      dato: { planId: PLAN, yaExistia: true },
    });
  });

  it("guardar: el contenido entero y la versión esperada", async () => {
    expect(await guardarBorradorDeConsola({ ...GUARDAR, versionEsperada: 4 })).toEqual({
      ok: true,
      dato: { borradorId: "b", version: 2 },
    });
    expect(guardarBorradorDePlan).toHaveBeenCalledWith({ ...GUARDAR, versionEsperada: 4 });
  });

  it("publicar: el motivo recortado", async () => {
    expect(await publicarVersionDeConsola(PUBLICAR)).toEqual({ ok: true, dato: { numero: 3 } });
    expect(publicarVersionDePlan).toHaveBeenCalledWith({
      claveDeIdempotencia: CLAVE,
      planId: PLAN,
      motivo: "Lanzamiento",
    });
  });
});

describe("cada rechazo se dice con su texto aprobado", () => {
  const SIN_BORRADOR =
    "Esta versión ya no tiene borrador: otra persona la publicó antes. Revisá las versiones del plan.";
  it.each([
    ["SIN_BORRADOR", { tipo: "PANTALLA_VIEJA", texto: SIN_BORRADOR }],
    ["VERSION_DESACTUALIZADA", { tipo: "PANTALLA_VIEJA", texto: VIEJA }],
    ["PLAN_NO_ENCONTRADO", { tipo: "PANTALLA_VIEJA", texto: VIEJA }],
    ["ID_INVALIDO", { tipo: "PANTALLA_VIEJA", texto: VIEJA }],
    ["MOTIVO_DEMASIADO_LARGO", { tipo: "PANTALLA_VIEJA", texto: VIEJA }],

    [
      { tipo: "ConcurrenciaAgotada" },
      { tipo: "GENERAL", texto: "Se estaba guardando otro cambio a la vez. Probá de nuevo." },
    ],
    [
      { codigo: "MODULO_DESCONOCIDO", modulo: "x" },
      { tipo: "PANTALLA_VIEJA", texto: VIEJA },
    ],
    [
      { codigo: "REQUIERE_FALTANTE", modulo: "a", requiere: "b" },
      { tipo: "PANTALLA_VIEJA", texto: VIEJA },
    ],
    [
      { codigo: "PERILLA_DESCONOCIDA", perilla: "x" },
      { tipo: "PANTALLA_VIEJA", texto: VIEJA },
    ],
    [
      { codigo: "VALOR_DE_PERILLA_INVALIDO", perilla: "x" },
      { tipo: "PANTALLA_VIEJA", texto: VIEJA },
    ],
    [
      { codigo: "PERILLA_REQUIERE_OTRA", perilla: "x", requiere: "y" },
      { tipo: "PANTALLA_VIEJA", texto: VIEJA },
    ],
    ["MOTIVO_OBLIGATORIO", { tipo: "CAMPO", campo: "motivo", texto: "Falta el motivo." }],
    [
      { codigo: "NOMBRE_DE_PLAN_INVALIDO" },
      { tipo: "GENERAL", texto: "Falta el nombre comercial." },
    ],
    ["CODIGO_DE_PLAN_INVALIDO", { tipo: "GENERAL", texto: "El código no es válido." }],
    ["PLAN_RETIRADO", { tipo: "GENERAL", texto: "Esta acción no está permitida" }],
  ])("%j", async (codigo, esperado) => {
    publicarVersionDePlan.mockResolvedValueOnce({ ok: false, error: codigo });
    expect(await publicarVersionDeConsola(PUBLICAR)).toEqual({ ok: false, error: esperado });
  });
});
