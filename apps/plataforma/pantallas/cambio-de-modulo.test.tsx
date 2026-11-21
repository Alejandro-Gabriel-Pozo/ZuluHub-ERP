import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { cambiarModuloAccion } from "../app/empresas/[id]/plan/acciones";
import type { PlanDeEmpresa } from "../logica/plan-de-empresa";
import { restaurarConexion, tocar } from "../../web/ui/pruebas/ayudas";
import { CambioDeModulo } from "./cambio-de-modulo.cliente";
import { PanelDePlan } from "./panel-de-plan.cliente";

/**
 * Activar y desactivar módulos en la consola (cliente): la fila ofrece lo que dice `accionDelModulo`, un doble toque
 * envía una sola vez y el reintento usa la misma clave y el mismo pedido. La acción del servidor va simulada.
 */
vi.mock("../app/empresas/[id]/plan/acciones", () => ({
  cambiarModuloAccion: vi.fn(),
  cambiarPlanAccion: vi.fn(),
}));
const refrescar = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refrescar }) }));

const accion = vi.mocked(cambiarModuloAccion);
type Respuesta = Awaited<ReturnType<typeof cambiarModuloAccion>>;

const EMPRESA = "33333333-3333-4333-8333-333333333333";
const BIEN: Respuesta = { ok: true, dato: { yaEstaba: false } };
const INESPERADO: Respuesta = {
  ok: false,
  error: { tipo: "INESPERADO" },
  referencia: "PD-ABCD-0123",
};

beforeEach(() => {
  accion.mockReset();
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

type Enviado = { claveDeIdempotencia: string; empresaId: string; modulo: string; activar: boolean };
const enviados = () => accion.mock.calls.map(([entrada]) => entrada as Enviado);

const ventana = () => page.getByRole("dialog", { name: /^(Activar|Desactivar) .+ en .+$/ });
async function abrir(nombre: string) {
  tocar(page.getByRole("button", { name: nombre, exact: true }));
  await expect.element(ventana()).toBeVisible();
}
const confirmar = (nombre: string) =>
  ventana().getByRole("button", { name: new RegExp(`^${nombre}$|Confirmando…`) });

function fila(modulo: string, cambios: Partial<PlanDeEmpresa["modulos"][number]> = {}) {
  return {
    modulo,
    obligatorio: false,
    disponible: true,
    habilitadoPorElPlan: true,
    activado: false,
    estado: "NO_ACTIVO",
    requiere: [],
    faltan: [],
    ...cambios,
  };
}

const PLAN: PlanDeEmpresa = {
  empresaId: EMPRESA,
  tenantId: "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a",
  empresa: "Panadería La Espiga",
  planActual: null,
  sinPlan: true,
  programada: null,
  ultimoNumeroDeAsignacion: null,
  modulos: [],
  perillas: [],
  empresasDelCliente: null,
  planesElegibles: [],
};

describe("Módulos de la empresa: lo que se ofrece en cada fila", () => {
  it("Activar solo en lo incluido y no activado; Desactivar en lo activado; nada en obligatorio, en desarrollo ni fuera del plan", async () => {
    await render(
      <PanelDePlan
        plan={{
          ...PLAN,
          modulos: [
            fila("administracion", { obligatorio: true, activado: true, estado: "ACTIVO" }),
            fila("produccion", { disponible: false }),
            fila("caja"),
            fila("ventas", { habilitadoPorElPlan: false }),
            fila("catalogo", { activado: true, estado: "ACTIVO" }),
            fila("salon", { requiere: ["ventas", "comandas"], faltan: ["comandas"] }),
          ],
        }}
      />,
    );
    const botones = page.getByRole("button", { name: /^(Activar|Desactivar)$/ });
    await expect.element(botones).toHaveLength(3);
    await expect.element(page.getByText("Requiere: Ventas, Comandas")).toBeVisible();
    await expect.element(page.getByText("Falta activar: Comandas")).toBeVisible();
  });
});

describe("CambioDeModulo: idempotencia del intento", () => {
  it("activar: pide confirmación con el módulo y la empresa, envía una vez y vuelve a leer el plan", async () => {
    accion.mockResolvedValue(BIEN);
    await render(
      <CambioDeModulo
        empresaId={EMPRESA}
        empresa="Panadería La Espiga"
        modulo="caja"
        accion="ACTIVAR"
      />,
    );
    await abrir("Activar");
    await expect
      .element(page.getByRole("dialog", { name: "Activar Caja en Panadería La Espiga" }))
      .toBeVisible();
    tocar(confirmar("Activar"));
    await vi.waitFor(() => expect(refrescar).toHaveBeenCalled());
    expect(accion).toHaveBeenCalledTimes(1);
    expect(enviados()[0]).toMatchObject({ empresaId: EMPRESA, modulo: "caja", activar: true });
  });

  it("desactivar: avisa que los datos quedan guardados y manda activar:false", async () => {
    accion.mockResolvedValue(BIEN);
    await render(
      <CambioDeModulo
        empresaId={EMPRESA}
        empresa="Panadería La Espiga"
        modulo="caja"
        accion="DESACTIVAR"
      />,
    );
    await abrir("Desactivar");
    await expect
      .element(page.getByText("Los datos del módulo quedan guardados y vuelven al activarlo."))
      .toBeVisible();
    tocar(confirmar("Desactivar"));
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(enviados()[0]).toMatchObject({ activar: false });
  });

  it("doble toque: se envía una sola vez", async () => {
    accion.mockImplementation(async () => {
      await pausa(60);
      return BIEN;
    });
    await render(
      <CambioDeModulo
        empresaId={EMPRESA}
        empresa="Panadería La Espiga"
        modulo="caja"
        accion="ACTIVAR"
      />,
    );
    await abrir("Activar");
    tocar(confirmar("Activar"));
    tocar(confirmar("Activar"));
    tocar(confirmar("Activar"));
    await vi.waitFor(() => expect(refrescar).toHaveBeenCalled());
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("la acción lanza o devuelve INESPERADO: el reintento usa la MISMA clave y el mismo pedido", async () => {
    const tercera = puerta();
    accion
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(INESPERADO)
      .mockReturnValueOnce(tercera.espera);
    await render(
      <CambioDeModulo
        empresaId={EMPRESA}
        empresa="Panadería La Espiga"
        modulo="caja"
        accion="ACTIVAR"
      />,
    );
    await abrir("Activar");
    tocar(confirmar("Activar"));
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(3), { timeout: 10000 });
    tercera.soltar(BIEN);
    await vi.waitFor(() => expect(refrescar).toHaveBeenCalled());
    const [primera, segunda, ultima] = enviados();
    expect(segunda).toEqual(primera);
    expect(ultima).toEqual(primera);
  });

  it("un rechazo muestra el motivo y vuelve a leer el plan, sin cerrar", async () => {
    accion.mockResolvedValue({
      ok: false,
      error: { tipo: "GENERAL", texto: "Primero hay que activar Comandas." },
    });
    await render(
      <CambioDeModulo
        empresaId={EMPRESA}
        empresa="Panadería La Espiga"
        modulo="salon"
        accion="ACTIVAR"
      />,
    );
    await abrir("Activar");
    tocar(confirmar("Activar"));
    await expect.element(page.getByText("Primero hay que activar Comandas.")).toBeVisible();
    await vi.waitFor(() => expect(refrescar).toHaveBeenCalled());
  });
});
