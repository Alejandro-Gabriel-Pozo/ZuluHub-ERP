import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { FormularioDeAlta } from "./formulario-de-alta.cliente";
import { altaDeEmpresaAccion } from "../app/empresas/acciones";
import { restaurarConexion, tocar } from "../../web/ui/pruebas/ayudas";

/**
 * El alta de la consola (cliente): la clave de idempotencia es del INTENTO y los valores se fijan al primer toque.
 * Vive acá porque el proyecto de componentes (Chromium) solo recoge pruebas de `apps/web/ui`. La acción del
 * servidor va simulada; no hay red ni base.
 */
vi.mock("../app/empresas/acciones", () => ({ altaDeEmpresaAccion: vi.fn() }));

const accion = vi.mocked(altaDeEmpresaAccion);

type Respuesta = Awaited<ReturnType<typeof altaDeEmpresaAccion>>;

const SUBMARCA = "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a";
const BIEN: Respuesta = { ok: true, dato: { empresaId: "e-1", yaExistia: false } };
const INESPERADO: Respuesta = {
  ok: false,
  error: { tipo: "INESPERADO" },
  referencia: "PD-ABCD-0123",
};
const PIDE_CODIGO: Respuesta = { ok: false, error: { tipo: "SEGUNDO_FACTOR" } };

beforeEach(() => {
  accion.mockReset();
});
afterEach(restaurarConexion);

const submarcas = [
  {
    id: SUBMARCA,
    nombre: "Panadería",
    elegible: true,
    motivoSiNo: null,
    planPorDefecto: null,
    modulosIniciales: [],
  },
];

async function completar(razonSocial = "Panadería La Espiga S.A.") {
  await page.getByLabelText(/Nombre de la empresa/).fill(razonSocial);
  await page.getByLabelText(/CUIT/).fill("30-71234567-1");
  await page.getByLabelText(/Submarca/).selectOptions(SUBMARCA);
  await page.getByLabelText(/Email del primer gerente/).fill("gerente@laespiga.com.ar");
}

const darDeAlta = () => page.getByRole("button", { name: /Dar de alta|Dando de alta…/ });
/** Una respuesta que el test suelta cuando quiere: sostiene un envío en vuelo. */
function puerta() {
  let soltar: (r: Respuesta) => void = () => undefined;
  const espera = new Promise<Respuesta>((resolve) => {
    soltar = resolve;
  });
  return { espera, soltar };
}
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("FormularioDeAlta: idempotencia del intento", () => {
  it("la acción lanza y luego responde: reintento con la MISMA clave y los MISMOS valores, y el formulario queda bloqueado", async () => {
    const segunda = puerta();
    accion
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockReturnValueOnce(segunda.espera);
    await render(<FormularioDeAlta submarcas={submarcas} planes={[]} />);
    await completar();
    tocar(darDeAlta());
    // El reintento automático queda en vuelo (la puerta lo sostiene): el estado incierto se puede mirar con calma.
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Verificando si el alta quedó registrada…");
    await expect.element(page.getByLabelText(/Nombre de la empresa/)).toBeDisabled();
    await expect.element(page.getByLabelText(/CUIT/)).toBeDisabled();
    segunda.soltar(BIEN);
    await expect.element(page.getByText("Empresa dada de alta")).toBeVisible();
    expect(accion).toHaveBeenCalledTimes(2);
    const [primera, reintento] = accion.mock.calls.map(
      ([entrada]) => entrada as { claveDeIdempotencia: string },
    );
    expect(reintento).toEqual(primera);
    expect(reintento).toMatchObject({ razonSocial: "Panadería La Espiga S.A." });
  });

  it("doble toque: se envía una sola vez", async () => {
    accion.mockImplementation(async () => {
      await pausa(60);
      return BIEN;
    });
    await render(<FormularioDeAlta submarcas={submarcas} planes={[]} />);
    await completar();
    tocar(darDeAlta());
    tocar(darDeAlta());
    tocar(darDeAlta());
    await expect.element(page.getByText("Empresa dada de alta")).toBeVisible();
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("cancelar el código de segundo factor limpia lo fijado: el próximo intento toma los valores nuevos y otra clave", async () => {
    accion.mockResolvedValueOnce(PIDE_CODIGO).mockResolvedValue(BIEN);
    await render(<FormularioDeAlta submarcas={submarcas} planes={[]} />);
    await completar();
    tocar(darDeAlta());
    await expect.element(page.getByText("Confirmá que sos vos")).toBeVisible();
    tocar(page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).last());
    await expect
      .element(page.getByText("Cancelaste la confirmación. La empresa no se dio de alta."))
      .toBeVisible();
    // Terminó el intento: se puede editar y el nuevo intento no arrastra lo anterior.
    await page.getByLabelText(/Nombre de la empresa/).fill("Otra Razón S.R.L.");
    tocar(darDeAlta());
    await expect.element(page.getByText("Empresa dada de alta")).toBeVisible();
    expect(accion).toHaveBeenCalledTimes(2);
    const [primera, segunda] = accion.mock.calls.map(
      ([entrada]) => entrada as { claveDeIdempotencia: string },
    );
    expect(segunda).toMatchObject({ razonSocial: "Otra Razón S.R.L." });
    expect(segunda?.claveDeIdempotencia).not.toBe(primera?.claveDeIdempotencia);
  });

  it("INESPERADO devuelto como valor: queda incierto (con la referencia) y el reintento usa la MISMA clave y los mismos valores", async () => {
    const segunda = puerta();
    accion.mockResolvedValueOnce(INESPERADO).mockReturnValueOnce(segunda.espera);
    await render(<FormularioDeAlta submarcas={submarcas} planes={[]} />);
    await completar();
    tocar(darDeAlta());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent(
        "Verificando si el alta quedó registrada…Código de referencia: PD-ABCD-0123",
      );
    await expect.element(page.getByLabelText(/Nombre de la empresa/)).toBeDisabled();
    segunda.soltar(BIEN);
    await expect.element(page.getByText("Empresa dada de alta")).toBeVisible();
    expect(accion).toHaveBeenCalledTimes(2);
    const [primera, reintento] = accion.mock.calls.map(
      ([entrada]) => entrada as { claveDeIdempotencia: string },
    );
    expect(reintento).toEqual(primera);
  });

  it("el aviso de éxito dice «Le vamos a enviar una invitación»", async () => {
    accion.mockResolvedValue(BIEN);
    await render(<FormularioDeAlta submarcas={submarcas} planes={[]} />);
    await completar();
    tocar(darDeAlta());
    await expect
      .element(page.getByText(/Le vamos a enviar una invitación a gerente@laespiga\.com\.ar/))
      .toBeVisible();
  });
});
