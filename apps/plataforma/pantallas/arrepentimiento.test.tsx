import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { cambiarPlanAccion } from "../app/empresas/[id]/plan/acciones";
import type { UltimoCambioVista } from "../logica/arrepentimiento";
import type { PlanDeEmpresa } from "../logica/plan-de-empresa";
import { restaurarConexion, tocar, violacionesDeAccesibilidad } from "../../web/ui/pruebas/ayudas";
import { Arrepentimiento, type PropsDeArrepentimiento } from "./arrepentimiento.cliente";
import { CambioDePlan } from "./cambio-de-plan.cliente";

/**
 * Deshacer por arrepentimiento y fecha mínima del cambio de plan (cliente): una clave de idempotencia por intento reusada en cada reintento, un doble toque que envía una sola vez, quien no es ADMIN sin botón,
 * lo que el servidor decidió mostrado tal cual (el día límite, suba o baja, a qué plan vuelve) y la fecha mínima que cambia con la opción elegida. Las acciones del servidor van simuladas; no hay red ni base.
 */
vi.mock("../app/empresas/[id]/plan/acciones", () => ({
  cambiarPlanAccion: vi.fn(),
  cambiarModuloAccion: vi.fn(),
}));
const refrescar = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refrescar }) }));

const accion = vi.fn<PropsDeArrepentimiento["accion"]>();
const cambiar = vi.mocked(cambiarPlanAccion);
type Respuesta = Awaited<ReturnType<PropsDeArrepentimiento["accion"]>>;

const TENANT = "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a";
const BASICO = "11111111-1111-4111-8111-111111111111";
const PRO = "22222222-2222-4222-8222-222222222222";
const BIEN: Respuesta = { ok: true, dato: { numero: 3 } };
const INESPERADO: Respuesta = {
  ok: false,
  error: { tipo: "INESPERADO" },
  referencia: "PD-ABCD-0123",
};
const CAMBIO: UltimoCambioVista = {
  numero: 2,
  sentido: "BAJA",
  arrepentimientoHasta: "2026-11-23",
  yaArrepentido: false,
  puedeDeshacerHoy: true,
  vuelveA: { nombreComercial: "Pro", versionNumero: 2 },
  deshizoElCambioDel: null,
};

beforeEach(() => {
  accion.mockReset();
  cambiar.mockReset();
  refrescar.mockReset();
});
afterEach(restaurarConexion);

function puerta() {
  let soltar: (r: Respuesta) => void = () => undefined;
  const espera = new Promise<Respuesta>((resolve) => {
    soltar = resolve;
  });
  return { espera, soltar };
}
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

const deshacer = () =>
  page
    .getByRole("dialog", { name: "Deshacer por arrepentimiento" })
    .getByRole("button", { name: /Deshacer por arrepentimiento|Verificando/ });

async function abrir(cambio: UltimoCambioVista = CAMBIO, puede = true) {
  await render(
    <Arrepentimiento
      tenantId={TENANT}
      cambio={cambio}
      hoy="2026-11-20"
      puedeArrepentir={puede}
      accion={accion}
    />,
  );
  tocar(page.getByRole("button", { name: "Deshacer por arrepentimiento" }));
  await expect
    .element(page.getByRole("dialog", { name: "Deshacer por arrepentimiento" }))
    .toBeVisible();
}

describe("Arrepentimiento: lo que se ve", () => {
  it("dentro del plazo muestra el día límite y si fue una baja, y el botón para quien puede", async () => {
    await render(
      <Arrepentimiento
        tenantId={TENANT}
        cambio={CAMBIO}
        hoy="2026-11-20"
        puedeArrepentir
        accion={accion}
      />,
    );
    await expect.element(page.getByText("Se puede deshacer hasta el 23/11/2026.")).toBeVisible();
    await expect.element(page.getByText("Baja", { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Deshacer por arrepentimiento" }))
      .toBeVisible();
  });

  it("quien no es ADMIN ve la información pero no el botón", async () => {
    await render(
      <Arrepentimiento
        tenantId={TENANT}
        cambio={CAMBIO}
        hoy="2026-11-20"
        puedeArrepentir={false}
        accion={accion}
      />,
    );
    await expect.element(page.getByText("Se puede deshacer hasta el 23/11/2026.")).toBeVisible();
    expect(
      page.getByRole("button", { name: "Deshacer por arrepentimiento" }).elements(),
    ).toHaveLength(0);
  });

  it("si el servidor dice que hoy no se puede (vencido, alta, etc.) no se ve nada, ni botón", async () => {
    const r = await render(
      <Arrepentimiento
        tenantId={TENANT}
        cambio={{ ...CAMBIO, puedeDeshacerHoy: false }}
        hoy="2026-11-20"
        puedeArrepentir
        accion={accion}
      />,
    );
    expect(r.container.textContent).toBe("");
  });

  it("un cambio que nació de un arrepentimiento lo dice y no ofrece deshacerlo de nuevo", async () => {
    await render(
      <Arrepentimiento
        tenantId={TENANT}
        cambio={{ ...CAMBIO, puedeDeshacerHoy: false, deshizoElCambioDel: "2026-11-20" }}
        hoy="2026-11-20"
        puedeArrepentir
        accion={accion}
      />,
    );
    await expect.element(page.getByText("Deshecho por arrepentimiento")).toBeVisible();
    await expect.element(page.getByText("Arrepentimiento del cambio del 20/11/2026")).toBeVisible();
    expect(page.getByRole("button").elements()).toHaveLength(0);
  });

  it("la confirmación dice a qué plan vuelve y desde cuándo, la consecuencia según el sentido y que no se repite", async () => {
    await abrir();
    await expect
      .element(page.getByText("La empresa vuelve al plan Pro desde el 20/11/2026."))
      .toBeVisible();
    await expect
      .element(page.getByText("La baja no se aplica: la empresa sigue con el plan que tiene."))
      .toBeVisible();
    await expect
      .element(page.getByText("Un cambio deshecho no se puede deshacer de nuevo."))
      .toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("de una suba, la consecuencia es la de la suba", async () => {
    await abrir({ ...CAMBIO, sentido: "SUBA" });
    await expect
      .element(
        page.getByText(
          "La suba no se aplica: la empresa vuelve al plan anterior y los módulos nuevos quedan en solo lectura con lo cargado.",
        ),
      )
      .toBeVisible();
  });
});

describe("Arrepentimiento: idempotencia del intento", () => {
  it("sin motivo no se envía y dice «Falta el motivo.»", async () => {
    await abrir();
    tocar(deshacer());
    await expect.element(page.getByText("Falta el motivo.")).toBeVisible();
    expect(accion).not.toHaveBeenCalled();
  });

  it("fija el pedido al primer toque: el cambio visto, el último visto y el motivo recortado", async () => {
    accion.mockResolvedValue(BIEN);
    await abrir();
    await page.getByLabelText("Motivo").fill("  El cliente se arrepintió  ");
    tocar(deshacer());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(accion.mock.calls[0]?.[0]).toMatchObject({
      tenantId: TENANT,
      numero: 2,
      numeroEsperado: 2,
      motivo: "El cliente se arrepintió",
    });
    await vi.waitFor(() => {
      expect(refrescar).toHaveBeenCalled();
    });
  });

  it("doble clic en deshacer: se envía una sola vez y el botón queda ocupado", async () => {
    const { espera, soltar } = puerta();
    accion.mockReturnValue(espera);
    await abrir();
    await page.getByLabelText("Motivo").fill("Se arrepintió");
    tocar(deshacer());
    tocar(deshacer());
    tocar(deshacer());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    await pausa(80);
    expect(accion).toHaveBeenCalledTimes(1);
    await expect.element(deshacer()).toBeDisabled();
    soltar(BIEN);
    await vi.waitFor(() => {
      expect(refrescar).toHaveBeenCalled();
    });
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("la acción lanza y luego responde: reintento con la MISMA clave y los MISMOS valores", async () => {
    const segunda = puerta();
    accion
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockReturnValueOnce(segunda.espera);
    await abrir();
    await page.getByLabelText("Motivo").fill("Se arrepintió");
    tocar(deshacer());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect.element(page.getByLabelText("Motivo")).toBeDisabled();
    segunda.soltar(BIEN);
    await vi.waitFor(() => {
      expect(refrescar).toHaveBeenCalled();
    });
    const [a, b] = accion.mock.calls.map(([e]) => e);
    expect(b).toEqual(a);
  });

  it("INESPERADO devuelto como valor: queda incierto con la referencia y reintenta con la MISMA clave", async () => {
    const segunda = puerta();
    accion.mockResolvedValueOnce(INESPERADO).mockReturnValueOnce(segunda.espera);
    await abrir();
    await page.getByLabelText("Motivo").fill("Se arrepintió");
    tocar(deshacer());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect.element(page.getByText("Código de referencia: PD-ABCD-0123")).toBeVisible();
    segunda.soltar(BIEN);
    await vi.waitFor(() => {
      expect(refrescar).toHaveBeenCalled();
    });
    const [a, b] = accion.mock.calls.map(([e]) => e);
    expect(b).toEqual(a);
  });

  it("un rechazo del servidor (plazo vencido) se dice con su texto y se puede cerrar", async () => {
    accion.mockResolvedValue({
      ok: false,
      error: { tipo: "GENERAL", texto: "Venció el plazo para deshacer este cambio." },
    });
    await abrir();
    await page.getByLabelText("Motivo").fill("Se arrepintió");
    tocar(deshacer());
    await expect
      .element(page.getByText("Venció el plazo para deshacer este cambio."))
      .toBeVisible();
  });

  it("segundo factor vencido: pide el código y repite el MISMO intento", async () => {
    accion.mockResolvedValueOnce({ ok: false, error: { tipo: "SEGUNDO_FACTOR" } });
    await abrir();
    await page.getByLabelText("Motivo").fill("Se arrepintió");
    tocar(deshacer());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    await expect
      .element(page.getByRole("dialog", { name: "Confirmá que sos vos" }).last())
      .toBeVisible();
  });
});

describe("CambioDePlan: la fecha mínima sale de lo que mandó el servidor para la opción elegida", () => {
  const PLAN: PlanDeEmpresa = {
    empresaId: "33333333-3333-4333-8333-333333333333",
    tenantId: TENANT,
    empresa: "Panadería La Espiga",
    planActual: {
      nombreComercial: "Intermedio",
      planCodigo: "intermedio",
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
      { versionDePlanId: BASICO, nombre: "Básico", versionNumero: 1, esActual: false },
      { versionDePlanId: PRO, nombre: "Pro", versionNumero: 2, esActual: false },
    ],
    condiciones: {
      hoy: "2026-11-20",
      ultimoCambio: null,
      opciones: [
        {
          versionDePlanId: BASICO,
          sentido: "BAJA",
          primeraFechaValida: "2026-12-05",
          diasDeAnticipacion: 15,
        },
        {
          versionDePlanId: PRO,
          sentido: "SUBA",
          primeraFechaValida: "2026-11-23",
          diasDeAnticipacion: 3,
        },
      ],
    },
  };

  async function abrirCambio(elegir: string) {
    await render(<CambioDePlan plan={PLAN} />);
    await page.getByLabelText(/Cambiar a/).selectOptions(elegir);
    tocar(page.getByRole("button", { name: "Cambiar de plan…" }));
  }

  it("una suba y una baja muestran fechas y explicaciones distintas", async () => {
    await abrirCambio(PRO);
    await expect
      .element(page.getByText("Fecha mínima: hoy más 3 días de anticipación de suba."))
      .toBeVisible();
    await page.getByRole("button", { name: "Cerrar" }).first().click();
    await page.getByLabelText(/Cambiar a/).selectOptions(BASICO);
    tocar(page.getByRole("button", { name: "Cambiar de plan…" }));
    await expect
      .element(
        page.getByText(
          "Fecha mínima: hoy más 15 días (el mayor entre la anticipación de baja y el plazo de arrepentimiento).",
        ),
      )
      .toBeVisible();
  });

  it("antes de la fecha mínima de la opción no se envía y dice la primera fecha posible", async () => {
    await abrirCambio(BASICO);
    await page.getByLabelText(/Vigente desde/).fill("2026-12-04");
    await page.getByLabelText(/Motivo del cambio/).fill("Baja pedida");
    tocar(page.getByRole("button", { name: "Guardar cambio de plan" }));
    await expect
      .element(page.getByText("Falta anticipación. La primera fecha posible es el 05/12/2026."))
      .toBeVisible();
    expect(cambiar).not.toHaveBeenCalled();
  });

  it("en la fecha mínima exacta de la opción sí se envía", async () => {
    cambiar.mockResolvedValue({ ok: true, dato: { numero: 3, yaExistia: false } });
    await abrirCambio(BASICO);
    await page.getByLabelText(/Vigente desde/).fill("2026-12-05");
    await page.getByLabelText(/Motivo del cambio/).fill("Baja pedida");
    tocar(page.getByRole("button", { name: "Guardar cambio de plan" }));
    await vi.waitFor(() => expect(cambiar).toHaveBeenCalledTimes(1));
    expect(cambiar.mock.calls[0]?.[0]).toMatchObject({
      vigenteDesde: "2026-12-05",
      versionDePlanId: BASICO,
    });
  });

  it("sin la lectura nueva (el servidor no la mandó) el formulario cae al comportamiento de siempre y el servidor igual decide: dice la primera fecha posible (T-33)", async () => {
    const SIN_LECTURA: PlanDeEmpresa = {
      ...PLAN,
      condiciones: undefined,
      puedeArrepentir: undefined,
    };
    cambiar.mockResolvedValue({
      ok: false,
      error: {
        tipo: "GENERAL",
        texto: "Falta anticipación. La primera fecha posible es el 05/12/2026.",
      },
    });
    await render(<CambioDePlan plan={SIN_LECTURA} />);
    await page.getByLabelText(/Cambiar a/).selectOptions(BASICO);
    tocar(page.getByRole("button", { name: "Cambiar de plan…" }));
    // Sin fecha dictada por el servidor: la ayuda de siempre, «desde mañana», y ninguna de las de suba o baja.
    await expect.element(page.getByText(/^Desde mañana \(/)).toBeVisible();
    expect(page.getByText(/Fecha mínima: hoy más/).elements()).toHaveLength(0);
    await page.getByLabelText(/Vigente desde/).fill("2099-01-15");
    await page.getByLabelText(/Motivo del cambio/).fill("Baja pedida");
    tocar(page.getByRole("button", { name: "Guardar cambio de plan" }));
    await vi.waitFor(() => expect(cambiar).toHaveBeenCalledTimes(1));
    await expect
      .element(page.getByText("Falta anticipación. La primera fecha posible es el 05/12/2026."))
      .toBeVisible();
  });
});
