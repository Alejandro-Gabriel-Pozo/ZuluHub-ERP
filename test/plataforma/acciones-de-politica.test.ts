import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("server-only", () => ({}));

const { exigirAcceso, definirPoliticaDeCambioDePlan, verPoliticaDeCambioDePlan, orden } =
  vi.hoisted(() => ({
    orden: [] as string[],
    exigirAcceso: vi.fn(),
    definirPoliticaDeCambioDePlan: vi.fn(),
    verPoliticaDeCambioDePlan: vi.fn(),
  }));

vi.mock("../../apps/plataforma/servidor/acceso", () => ({ exigirAcceso }));

import { definirPoliticaDeConsola } from "../../apps/plataforma/servidor/acciones-politica";
import { politicaDeCambioDePlan } from "../../apps/plataforma/servidor/politica";

/**
 * Las acciones del servidor de «Política de cambio de plan» (frontera entre el navegador y los casos de uso): `exigirAcceso` y los casos van simulados. Se prueba lo que garantizan: autorizan antes de operar,
 * dejan pasar la redirección de Next, no dejan entrar entradas inválidas, traducen cada rechazo a su texto aprobado y no escriben el pedido en el registro del servidor. La lectura ofrece «definir» solo al ADMIN
 * (ayuda de la pantalla: el guard del caso de uso lo exige igual).
 */

const CLAVE = "3f2b8c1e-5d4a-4b7e-9c1a-2e6f8a0b1c3d";
const REDIRECCION = Object.assign(new Error("NEXT_REDIRECT"), {
  digest: "NEXT_REDIRECT;replace;/ingreso;307;",
});
const PEDIDO = {
  claveDeIdempotencia: CLAVE,
  versionEsperada: 1,
  diasDeAnticipacionDeSuba: 3,
  diasDeAnticipacionDeBaja: 10,
  diasDeArrepentimiento: 15,
  motivo: "  Acuerdo  ",
};
const GUARDADA = (version: number) => ({
  version,
  diasDeAnticipacionDeSuba: 1,
  diasDeAnticipacionDeBaja: 1,
  diasDeArrepentimiento: 0,
  motivo: "Inicial",
  definidaPor: "sistema",
  creadoEn: new Date("2026-11-01T12:00:00Z"),
});

let registro: MockInstance<(...datos: unknown[]) => void>;

beforeEach(() => {
  orden.length = 0;
  for (const m of [exigirAcceso, definirPoliticaDeCambioDePlan, verPoliticaDeCambioDePlan])
    m.mockReset();
  exigirAcceso.mockImplementation(() => {
    orden.push("exigirAcceso");
    return Promise.resolve({
      admin: { rol: "ADMIN" },
      casos: { definirPoliticaDeCambioDePlan },
      consultas: { verPoliticaDeCambioDePlan },
    });
  });
  definirPoliticaDeCambioDePlan.mockImplementation(() => {
    orden.push("definir");
    return Promise.resolve({ ok: true, valor: { version: 2, repetida: false } });
  });
  verPoliticaDeCambioDePlan.mockResolvedValue({
    ok: true,
    valor: { vigente: GUARDADA(2), historial: [GUARDADA(2), GUARDADA(1)] },
  });
  registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  registro.mockRestore();
});

describe("definirPoliticaDeConsola", () => {
  it("autoriza antes de operar y le pasa al caso la entrada validada (sin las claves que sobran)", async () => {
    const r = await definirPoliticaDeConsola({ ...PEDIDO, rol: "ADMIN" });
    expect(r).toEqual({ ok: true, dato: { version: 2 } });
    expect(orden).toEqual(["exigirAcceso", "definir"]);
    expect(definirPoliticaDeCambioDePlan).toHaveBeenCalledExactlyOnceWith(PEDIDO);
  });

  it.each([
    ["no es un objeto", "x"],
    ["clave que no es UUID", { ...PEDIDO, claveDeIdempotencia: "abc" }],
    ["versión 0", { ...PEDIDO, versionEsperada: 0 }],
    ["días decimales", { ...PEDIDO, diasDeAnticipacionDeSuba: 1.5 }],
  ])("una entrada inválida (%s) no llega al caso ni toca el acceso", async (_n, entrada) => {
    const r = await definirPoliticaDeConsola(entrada);
    expect(r).toEqual({
      ok: false,
      error: { tipo: "GENERAL", texto: "Los datos no son válidos. Revisalos." },
    });
    expect(exigirAcceso).not.toHaveBeenCalled();
    expect(definirPoliticaDeCambioDePlan).not.toHaveBeenCalled();
  });

  it("la redirección de Next (sin sesión) sigue su camino: no se traga", async () => {
    exigirAcceso.mockRejectedValue(REDIRECCION);
    await expect(definirPoliticaDeConsola(PEDIDO)).rejects.toBe(REDIRECCION);
    expect(definirPoliticaDeCambioDePlan).not.toHaveBeenCalled();
  });

  it.each([
    [
      "VERSION_DESACTUALIZADA",
      "PANTALLA_VIEJA",
      "Otra persona cambió la política mientras tanto. Volvé a cargarla.",
    ],
    ["MOTIVO_OBLIGATORIO", "CAMPO", "Falta el motivo."],
    ["DIAS_DE_POLITICA_INVALIDOS", "GENERAL", "Ingresá un número entero de días entre 0 y 365."],
  ])("el rechazo %s sale con su texto aprobado", async (codigo, tipo, texto) => {
    definirPoliticaDeCambioDePlan.mockResolvedValue({ ok: false, error: { codigo } });
    const r = await definirPoliticaDeConsola(PEDIDO);
    expect(r).toMatchObject({ ok: false, error: { tipo, texto } });
  });

  it("sin permiso y sin segundo factor se traducen (la pantalla oculta la acción o pide el código)", async () => {
    definirPoliticaDeCambioDePlan.mockResolvedValue({ ok: false, error: "SIN_PERMISO" });
    expect(await definirPoliticaDeConsola(PEDIDO)).toEqual({
      ok: false,
      error: { tipo: "OCULTAR_ACCION" },
    });
    definirPoliticaDeCambioDePlan.mockResolvedValue({
      ok: false,
      error: "segundo_factor_reciente_requerido",
    });
    expect(await definirPoliticaDeConsola(PEDIDO)).toEqual({
      ok: false,
      error: { tipo: "SEGUNDO_FACTOR" },
    });
  });

  it("lo inesperado sale con referencia y sin el pedido en el registro del servidor", async () => {
    definirPoliticaDeCambioDePlan.mockRejectedValue(new Error("conexión caída 'Acuerdo'"));
    const r = await definirPoliticaDeConsola(PEDIDO);
    expect(r).toMatchObject({ ok: false, error: { tipo: "INESPERADO" } });
    expect(r.ok ? "" : r.referencia).toMatch(/^PD-/);
    expect(JSON.stringify(registro.mock.calls)).not.toContain(CLAVE);
  });
});

describe("politicaDeCambioDePlan (lectura)", () => {
  it("devuelve la vigente, el historial con la más nueva primero y las fechas en ISO", async () => {
    const r = await politicaDeCambioDePlan();
    expect(r).toMatchObject({
      ok: true,
      puedeDefinir: true,
      vigente: {
        version: 2,
        suba: 1,
        baja: 1,
        arrepentimiento: 0,
        creadoEn: "2026-11-01T12:00:00.000Z",
      },
    });
    expect(r.ok ? r.historial.map((v) => v.version) : []).toEqual([2, 1]);
  });

  it("solo el ADMIN ve el botón de definir; el SOPORTE lee; un rol desconocido no define (todo nace cerrado)", async () => {
    for (const [rol, esperado] of [
      ["ADMIN", true],
      ["SOPORTE", false],
      ["OTRO", false],
    ] as const) {
      exigirAcceso.mockResolvedValue({
        admin: { rol },
        casos: {},
        consultas: { verPoliticaDeCambioDePlan },
      });
      expect(await politicaDeCambioDePlan()).toMatchObject({ ok: true, puedeDefinir: esperado });
    }
  });

  it("una lectura rechazada sale con su traducción, sin datos crudos", async () => {
    verPoliticaDeCambioDePlan.mockResolvedValue({ ok: false, error: "SIN_PERMISO" });
    expect(await politicaDeCambioDePlan()).toEqual({
      ok: false,
      error: { tipo: "OCULTAR_ACCION" },
    });
  });
});
