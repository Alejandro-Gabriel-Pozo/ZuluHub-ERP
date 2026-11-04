import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { cambiarPlanAccion } from "../app/empresas/[id]/plan/acciones";
import type { PlanDeEmpresa } from "../logica/plan-de-empresa";
import { restaurarConexion, tocar } from "../../web/ui/pruebas/ayudas";
import { CambioDePlan } from "./cambio-de-plan.cliente";

/**
 * El cambio de plan de la consola (cliente): los valores se fijan al primer toque del intento, la clave se reusa en
 * cada reintento y un doble toque envía una sola vez. Vive acá porque el proyecto de componentes (Chromium)
 * recoge las pruebas de `apps/plataforma`. La acción del servidor va simulada; no hay red ni base.
 */
vi.mock("../app/empresas/[id]/plan/acciones", () => ({ cambiarPlanAccion: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const accion = vi.mocked(cambiarPlanAccion);

type Respuesta = Awaited<ReturnType<typeof cambiarPlanAccion>>;

const TENANT = "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a";
const BASICO = "11111111-1111-4111-8111-111111111111";
const PRO = "22222222-2222-4222-8222-222222222222";
const BIEN: Respuesta = { ok: true, dato: { numero: 3, yaExistia: false } };
const INESPERADO: Respuesta = {
  ok: false,
  error: { tipo: "INESPERADO" },
  referencia: "PD-ABCD-0123",
};

const PLAN: PlanDeEmpresa = {
  empresaId: "33333333-3333-4333-8333-333333333333",
  tenantId: TENANT,
  empresa: "Panadería La Espiga",
  planActual: {
    nombreComercial: "Básico",
    planCodigo: "basico",
    versionNumero: 1,
    vigenteDesde: "2026-01-01T03:00:00.000Z",
  },
  sinPlan: false,
  programada: null,
  ultimoNumeroDeAsignacion: 2,
  modulos: [],
  perillas: [],
  empresasDelCliente: null,
  planesElegibles: [
    { versionDePlanId: BASICO, nombre: "Básico", versionNumero: 1, esActual: true },
    { versionDePlanId: PRO, nombre: "Pro", versionNumero: 2, esActual: false },
  ],
};

beforeEach(() => {
  accion.mockReset();
});
afterEach(restaurarConexion);

/** Una respuesta que el test suelta cuando quiere: sostiene un envío en vuelo. */
function puerta() {
  let soltar: (r: Respuesta) => void = () => undefined;
  const espera = new Promise<Respuesta>((resolve) => {
    soltar = resolve;
  });
  return { espera, soltar };
}
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

const guardar = () => page.getByRole("button", { name: /Guardar cambio de plan|Guardando…/ });

async function abrirYCompletar(motivo = "  Pasa al plan Pro  ") {
  await page.getByLabelText(/Cambiar a/).selectOptions(PRO);
  tocar(page.getByRole("button", { name: "Cambiar de plan…" }));
  await page.getByLabelText(/Vigente desde/).fill("2030-01-15");
  await page.getByLabelText(/Motivo del cambio/).fill(motivo);
}

type Enviado = {
  claveDeIdempotencia: string;
  versionDePlanId: string;
  vigenteDesde: string;
  motivo: string;
  numeroEsperado: number | null;
  reemplazaProgramada: boolean;
  tenantId: string;
};
const enviados = () => accion.mock.calls.map(([entrada]) => entrada as Enviado);

describe("CambioDePlan: idempotencia del intento", () => {
  it("rotula las versiones con nombre y número, y fija los valores al primer toque", async () => {
    accion.mockResolvedValue(BIEN);
    await render(<CambioDePlan plan={PLAN} />);
    await expect.element(page.getByRole("option", { name: "Pro (versión 2)" })).toBeInTheDocument();
    await expect
      .element(page.getByRole("option", { name: "Básico (versión 1, actual)" }))
      .toBeInTheDocument();
    await abrirYCompletar();
    tocar(guardar());
    await expect.element(page.getByText("Plan cambiado; rige desde 15/01/2030.")).toBeVisible();
    expect(accion).toHaveBeenCalledTimes(1);
    expect(enviados()[0]).toMatchObject({
      tenantId: TENANT,
      versionDePlanId: PRO,
      vigenteDesde: "2030-01-15",
      motivo: "Pasa al plan Pro",
      numeroEsperado: 2,
      reemplazaProgramada: false,
    });
  });

  it("la acción lanza y luego responde: reintento con la MISMA clave y los MISMOS valores; el selector y el resumen no cambian", async () => {
    const segunda = puerta();
    accion
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockReturnValueOnce(segunda.espera);
    await render(<CambioDePlan plan={PLAN} />);
    await abrirYCompletar();
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Verificando si el cambio de plan quedó registrado…");
    await expect.element(page.getByLabelText(/Cambiar a/)).toBeDisabled();
    await expect.element(page.getByLabelText(/Vigente desde/)).toBeDisabled();
    await expect
      .element(page.getByText("Se cambia a Pro (versión 2), vigente desde 15/01/2030."))
      .toBeVisible();
    segunda.soltar(BIEN);
    await expect.element(page.getByText(/Plan cambiado; rige desde/)).toBeVisible();
    const [primera, reintento] = enviados();
    expect(reintento).toEqual(primera);
  });

  it("doble toque: se envía una sola vez", async () => {
    accion.mockImplementation(async () => {
      await pausa(60);
      return BIEN;
    });
    await render(<CambioDePlan plan={PLAN} />);
    await abrirYCompletar();
    tocar(guardar());
    tocar(guardar());
    tocar(guardar());
    await expect.element(page.getByText(/Plan cambiado; rige desde/)).toBeVisible();
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("INESPERADO devuelto como valor: queda incierto (con la referencia) y el reintento usa la MISMA clave y los mismos valores", async () => {
    const segunda = puerta();
    accion.mockResolvedValueOnce(INESPERADO).mockReturnValueOnce(segunda.espera);
    await render(<CambioDePlan plan={PLAN} />);
    await abrirYCompletar();
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent(
        "Verificando si el cambio de plan quedó registrado…Código de referencia: PD-ABCD-0123",
      );
    await expect.element(page.getByLabelText(/Cambiar a/)).toBeDisabled();
    segunda.soltar(BIEN);
    await expect.element(page.getByText(/Plan cambiado; rige desde/)).toBeVisible();
    expect(accion).toHaveBeenCalledTimes(2);
    const [primera, reintento] = enviados();
    expect(reintento).toEqual(primera);
  });

  it("con un cambio programado exige la casilla y explica qué pasa según la fecha", async () => {
    accion.mockResolvedValue(BIEN);
    const conProgramada: PlanDeEmpresa = {
      ...PLAN,
      programada: {
        nombreComercial: "Pro",
        versionNumero: 2,
        vigenteDesde: "2030-03-01T03:00:00.000Z",
      },
    };
    await render(<CambioDePlan plan={conProgramada} />);
    await abrirYCompletar();
    await expect
      .element(
        page.getByText(
          /Si la nueva fecha es igual o anterior, reemplaza el cambio programado; si es posterior, se aplica después de él\./,
        ),
      )
      .toBeVisible();
    tocar(guardar());
    await expect.element(page.getByText(/Tildá la casilla/)).toBeVisible();
    expect(accion).not.toHaveBeenCalled();
    await page.getByRole("checkbox").click();
    tocar(guardar());
    await expect.element(page.getByText(/Plan cambiado; rige desde/)).toBeVisible();
    expect(enviados()[0]).toMatchObject({ reemplazaProgramada: true });
  });

  it("un motivo de más de 500 letras no se envía", async () => {
    await render(<CambioDePlan plan={PLAN} />);
    await abrirYCompletar("a".repeat(501));
    tocar(guardar());
    await expect.element(page.getByText(/hasta 500 letras/)).toBeVisible();
    expect(accion).not.toHaveBeenCalled();
  });
});
