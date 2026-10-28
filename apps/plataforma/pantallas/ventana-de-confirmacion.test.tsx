import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { restaurarConexion, tocar } from "../../web/ui/pruebas/ayudas";
import { confirmarVersionAccion } from "../app/submarcas/acciones";
import { fechaMinimaDeVigencia } from "../logica/vigencia";
import { VentanaDeConfirmacion } from "./ventana-de-confirmacion.cliente";

/**
 * La ventana de «Confirmar versión» (cliente): la fecha, el motivo y la casilla se fijan al primer toque junto con la
 * clave, y el segundo factor se pide en otra ventana. Las acciones y el pedido del código van simulados.
 */
vi.mock("../app/submarcas/acciones", () => ({
  guardarBorradorAccion: vi.fn(),
  confirmarVersionAccion: vi.fn(),
}));
const refrescar = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refrescar }) }));
const pedirCodigo = vi.fn<() => Promise<boolean>>();
vi.mock("./ventana-de-codigo.cliente", () => ({
  useVentanaDeCodigo: () => ({ pedirCodigo, ventana: null }),
}));

const accion = vi.mocked(confirmarVersionAccion);
type Respuesta = Awaited<ReturnType<typeof confirmarVersionAccion>>;

const BIEN: Respuesta = { ok: true, dato: { numero: 2 } };
const INESPERADO: Respuesta = {
  ok: false,
  error: { tipo: "INESPERADO" },
  referencia: "PD-ABCD-0123",
};
const PIDE_CODIGO: Respuesta = { ok: false, error: { tipo: "SEGUNDO_FACTOR" } };
const MARCA = "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a";

beforeEach(() => {
  accion.mockReset();
  refrescar.mockReset();
  pedirCodigo.mockReset();
});
afterEach(restaurarConexion);

function ventana(hayProgramada = false, versionDelBorrador: number | null = 3) {
  return (
    <VentanaDeConfirmacion
      abierta
      alCerrar={() => undefined}
      marcaId={MARCA}
      nombre="Sur"
      numero={2}
      hayProgramada={hayProgramada}
      versionDelBorrador={versionDelBorrador}
    />
  );
}

async function completar() {
  await page.getByLabelText(/Vigente desde/).fill(fechaMinimaDeVigencia(new Date()));
  await page.getByLabelText(/Motivo del cambio/).fill("Cambio de imagen");
}

const confirmar = () => page.getByRole("button", { name: /^Confirmar versión$|Confirmando…/ });
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
function puerta() {
  let soltar: (r: Respuesta) => void = () => undefined;
  const espera = new Promise<Respuesta>((resolve) => {
    soltar = resolve;
  });
  return { espera, soltar };
}
const pedidos = () => accion.mock.calls.map(([pedido]) => pedido as Record<string, unknown>);

describe("VentanaDeConfirmacion: idempotencia del intento", () => {
  it("doble toque: se envía una sola vez", async () => {
    accion.mockImplementation(async () => {
      await pausa(60);
      return BIEN;
    });
    await render(ventana());
    await completar();
    tocar(confirmar());
    tocar(confirmar());
    tocar(confirmar());
    await expect.element(page.getByText(/Versión 2 confirmada/)).toBeVisible();
    expect(accion).toHaveBeenCalledTimes(1);
    expect(pedidos()[0]).toMatchObject({
      marcaId: MARCA,
      versionEsperada: 3,
      motivo: "Cambio de imagen",
    });
  });

  it("muestra la versión del borrador que se va a confirmar", async () => {
    await render(ventana());
    await expect.element(page.getByText("Vas a confirmar el borrador n.º 3.")).toBeVisible();
  });

  it("la versión viaja FIJADA: si la ficha de atrás cambia durante un intento incierto, el reintento manda la misma", async () => {
    const segunda = puerta();
    accion
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockReturnValueOnce(segunda.espera);
    const pantalla = await render(ventana(false, 3));
    await completar();
    tocar(confirmar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1), { timeout: 5000 });
    await pantalla.rerender(ventana(false, 4));
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect.element(page.getByText("Vas a confirmar el borrador n.º 3.")).toBeVisible();
    segunda.soltar(BIEN);
    await expect.element(page.getByText(/Versión 2 confirmada/)).toBeVisible();
    expect(pedidos()[1]).toEqual(pedidos()[0]);
    expect(pedidos()[1]).toMatchObject({ versionEsperada: 3 });
  });

  it("sin borrador no se puede confirmar: no se envía nada", async () => {
    await render(ventana(false, null));
    await completar();
    await expect.element(confirmar()).toBeDisabled();
    expect(accion).not.toHaveBeenCalled();
  });

  it("la acción lanza y luego responde: reintento con la MISMA clave y los MISMOS valores, y los campos quedan bloqueados", async () => {
    const segunda = puerta();
    accion
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockReturnValueOnce(segunda.espera);
    await render(ventana());
    await completar();
    tocar(confirmar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Verificando si la confirmación quedó registrada…");
    await expect.element(page.getByLabelText(/Motivo del cambio/)).toBeDisabled();
    segunda.soltar(BIEN);
    await expect.element(page.getByText(/Versión 2 confirmada/)).toBeVisible();
    expect(pedidos()[1]).toEqual(pedidos()[0]);
  });

  it("INESPERADO devuelto como valor: queda incierto (con la referencia) y el reintento usa la MISMA clave y los mismos valores", async () => {
    const segunda = puerta();
    accion.mockResolvedValueOnce(INESPERADO).mockReturnValueOnce(segunda.espera);
    await render(ventana());
    await completar();
    tocar(confirmar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent(
        "Verificando si la confirmación quedó registrada…Código de referencia: PD-ABCD-0123",
      );
    await expect.element(page.getByLabelText(/Motivo del cambio/)).toBeDisabled();
    segunda.soltar(BIEN);
    await expect.element(page.getByText(/Versión 2 confirmada/)).toBeVisible();
    expect(pedidos()[1]).toEqual(pedidos()[0]);
  });

  it("segundo factor: pide el código y repite con la MISMA clave y los mismos valores", async () => {
    accion.mockResolvedValueOnce(PIDE_CODIGO).mockResolvedValueOnce(BIEN);
    pedirCodigo.mockResolvedValue(true);
    await render(ventana());
    await completar();
    tocar(confirmar());
    await expect.element(page.getByText(/Versión 2 confirmada/)).toBeVisible();
    expect(pedirCodigo).toHaveBeenCalledTimes(1);
    expect(accion).toHaveBeenCalledTimes(2);
    expect(pedidos()[1]).toEqual(pedidos()[0]);
  });

  it("cancelar el código: no se confirma, se avisa y el próximo intento usa otra clave", async () => {
    accion.mockResolvedValueOnce(PIDE_CODIGO).mockResolvedValueOnce(BIEN);
    pedirCodigo.mockResolvedValue(false);
    await render(ventana());
    await completar();
    tocar(confirmar());
    await expect
      .element(page.getByText("Cancelaste la confirmación. La versión no se confirmó."))
      .toBeVisible();
    expect(accion).toHaveBeenCalledTimes(1);
    tocar(confirmar());
    await expect.element(page.getByText(/Versión 2 confirmada/)).toBeVisible();
    expect(pedidos()[1]?.["claveDeIdempotencia"]).not.toBe(pedidos()[0]?.["claveDeIdempotencia"]);
  });
});

describe("VentanaDeConfirmacion: errores del servidor", () => {
  it("cambio programado que la pantalla no mostraba: texto claro y «Recargar»", async () => {
    accion.mockResolvedValue({
      ok: false,
      error: { tipo: "PANTALLA_VIEJA", texto: "Hay un cambio programado nuevo. Recargala." },
    });
    await render(ventana());
    await completar();
    tocar(confirmar());
    await expect
      .element(page.getByText("Hay un cambio programado nuevo. Recargala."))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Recargar" })).toBeVisible();
  });

  it("borrador cambiado por otra persona: rechazo definitivo, «Recargar», y el próximo intento sale con otra clave", async () => {
    accion.mockResolvedValueOnce({
      ok: false,
      error: {
        tipo: "PANTALLA_VIEJA",
        texto: "Alguien más cambió el borrador. Recargá para ver la última versión.",
      },
    });
    const pantalla = await render(ventana(false, 3));
    await completar();
    tocar(confirmar());
    await expect
      .element(
        page.getByText("Alguien más cambió el borrador. Recargá para ver la última versión."),
      )
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Recargar" })).toBeVisible();
    // Definitivo: no queda incierto, no hay «Reintentar» y los campos siguen editables.
    await expect.element(page.getByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
    await expect.element(page.getByLabelText(/Motivo del cambio/)).toBeEnabled();
    // Se limpió lo fijado: con la ficha recargada, el nuevo intento toma la versión nueva y otra clave.
    await pantalla.rerender(ventana(false, 5));
    accion.mockResolvedValueOnce(BIEN);
    tocar(confirmar());
    await expect.element(page.getByText(/Versión 2 confirmada/)).toBeVisible();
    expect(pedidos()[1]).toMatchObject({ versionEsperada: 5 });
    expect(pedidos()[1]?.["claveDeIdempotencia"]).not.toBe(pedidos()[0]?.["claveDeIdempotencia"]);
  });

  it("marca retirada: texto claro, sin «Recargar» y sin poder reintentar", async () => {
    accion.mockResolvedValue({
      ok: false,
      error: { tipo: "MARCA_RETIRADA", texto: "Esta submarca está retirada. No se confirma." },
    });
    await render(ventana());
    await completar();
    tocar(confirmar());
    await expect
      .element(page.getByText("Esta submarca está retirada. No se confirma."))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Recargar" })).not.toBeInTheDocument();
    await expect.element(confirmar()).toBeDisabled();
  });
});

describe("VentanaDeConfirmacion: validación local", () => {
  it("sin fecha ni motivo no se envía nada y se dice qué falta", async () => {
    await render(ventana());
    tocar(confirmar());
    await expect.element(page.getByText("Elegí desde qué fecha rige.")).toBeVisible();
    await expect.element(page.getByText("Escribí el motivo del cambio.")).toBeVisible();
    expect(accion).not.toHaveBeenCalled();
  });

  it("con un cambio programado hay que tildar la casilla, y se manda que reemplaza", async () => {
    accion.mockResolvedValue(BIEN);
    await render(ventana(true));
    await completar();
    tocar(confirmar());
    await expect
      .element(page.getByText("Tildá la casilla para reemplazar el cambio programado."))
      .toBeVisible();
    expect(accion).not.toHaveBeenCalled();
    await page.getByRole("checkbox").click();
    tocar(confirmar());
    await expect.element(page.getByText(/Versión 2 confirmada/)).toBeVisible();
    expect(pedidos()[0]).toMatchObject({ reemplazaProgramada: true });
  });
});
