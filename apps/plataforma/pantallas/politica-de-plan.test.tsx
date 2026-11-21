import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { definirPoliticaAccion } from "../app/politica-de-plan/acciones";
import { restaurarConexion, tocar, violacionesDeAccesibilidad } from "../../web/ui/pruebas/ayudas";
import type { VersionDePolitica } from "../logica/politica-de-plan";
import { PoliticaDePlan } from "./politica-de-plan.cliente";
import { TablaDePoliticas } from "./tabla-de-politicas";

/**
 * «Política de cambio de plan» de la consola (cliente): una clave de idempotencia por intento reusada en cada reintento, un doble toque que envía una sola vez, los valores y la versión vista fijados al primer
 * toque, el conflicto de versión que conserva lo escrito y quien no es ADMIN sin botón. La acción del servidor va simulada; no hay red ni base.
 */
vi.mock("../app/politica-de-plan/acciones", () => ({ definirPoliticaAccion: vi.fn() }));
const refrescar = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refrescar, push: vi.fn() }) }));

const accion = vi.mocked(definirPoliticaAccion);
type Respuesta = Awaited<ReturnType<typeof definirPoliticaAccion>>;

const BIEN: Respuesta = { ok: true, dato: { version: 2 } };
const INESPERADO: Respuesta = {
  ok: false,
  error: { tipo: "INESPERADO" },
  referencia: "PD-ABCD-0123",
};
const CONFLICTO: Respuesta = {
  ok: false,
  error: {
    tipo: "PANTALLA_VIEJA",
    texto: "Otra persona cambió la política mientras tanto. Volvé a cargarla.",
  },
};
const VIGENTE: VersionDePolitica = {
  version: 1,
  suba: 1,
  baja: 1,
  arrepentimiento: 0,
  motivo: "Política inicial",
  definidaPor: "sistema",
  creadoEn: "2026-11-01T15:00:00.000Z",
};

beforeEach(() => {
  accion.mockReset();
  refrescar.mockReset();
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

const guardar = () => page.getByRole("button", { name: /Guardar versión nueva|Verificando/ });

async function abrir(vigente: VersionDePolitica = VIGENTE) {
  await render(<PoliticaDePlan vigente={vigente} puedeDefinir />);
  tocar(page.getByRole("button", { name: "Definir versión nueva" }));
  await expect.element(page.getByRole("dialog", { name: "Definir versión nueva" })).toBeVisible();
}

async function completar(motivo = "  Acuerdo con el dueño  ") {
  await page.getByLabelText("Anticipación de una suba").fill("3");
  await page.getByLabelText("Anticipación de una baja").fill("10");
  await page.getByLabelText("Plazo de arrepentimiento").fill("15");
  await page.getByLabelText("Motivo").fill(motivo);
}

type Enviado = {
  claveDeIdempotencia: string;
  versionEsperada: number;
  diasDeAnticipacionDeSuba: number;
  diasDeAnticipacionDeBaja: number;
  diasDeArrepentimiento: number;
  motivo: string;
};
const enviados = () => accion.mock.calls.map(([entrada]) => entrada as Enviado);

describe("PoliticaDePlan: lo que se ve", () => {
  it("muestra los tres números vigentes con su unidad y el pie de quién, cuándo y por qué (día argentino)", async () => {
    await render(<PoliticaDePlan vigente={VIGENTE} puedeDefinir={false} />);
    await expect.element(page.getByText("Anticipación de una suba")).toBeVisible();
    await expect.element(page.getByText("Plazo de arrepentimiento")).toBeVisible();
    await expect.element(page.getByText("0 días")).toBeVisible();
    await expect
      .element(page.getByText("Definida por sistema el 01/11/2026. Motivo: Política inicial"))
      .toBeVisible();
  });

  it("quien no es ADMIN no ve el botón de definir", async () => {
    await render(<PoliticaDePlan vigente={VIGENTE} puedeDefinir={false} />);
    await expect.element(page.getByText("Anticipación de una baja")).toBeVisible();
    expect(page.getByRole("button", { name: "Definir versión nueva" }).elements()).toHaveLength(0);
  });

  it("el formulario precarga los vigentes y muestra el resumen antes → después con la aclaración", async () => {
    await abrir();
    await expect.element(page.getByLabelText("Anticipación de una suba")).toHaveValue("1");
    await expect.element(page.getByLabelText("Plazo de arrepentimiento")).toHaveValue("0");
    await page.getByLabelText("Plazo de arrepentimiento").fill("15");
    await page.getByLabelText("Motivo").fill("Acuerdo");
    await expect
      .element(page.getByText(/^Antes: .*Plazo de arrepentimiento: 0 días\./))
      .toBeVisible();
    await expect
      .element(page.getByText(/Después: .*Plazo de arrepentimiento: 15 días\./))
      .toBeVisible();
    await expect
      .element(page.getByText("Los cambios de plan ya registrados no se modifican."))
      .toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("el historial muestra una fila por versión con sus seis columnas", async () => {
    await render(
      <TablaDePoliticas
        filas={[
          { ...VIGENTE, version: 2, suba: 3, baja: 10, arrepentimiento: 15, motivo: "Acuerdo" },
          VIGENTE,
        ]}
      />,
    );
    for (const columna of ["Fecha", "Suba", "Baja", "Arrepentimiento", "Definida por", "Motivo"])
      await expect.element(page.getByRole("columnheader", { name: columna })).toBeVisible();
    expect(page.getByRole("row").elements()).toHaveLength(3);
  });
});

describe("PoliticaDePlan: validación local", () => {
  it("un número inválido o un motivo vacío no se envían y se dicen bajo su campo", async () => {
    await abrir();
    await page.getByLabelText("Anticipación de una baja").fill("366");
    tocar(guardar());
    await expect
      .element(page.getByText("Ingresá un número entero de días entre 0 y 365."))
      .toBeVisible();
    await expect.element(page.getByText("Falta el motivo.")).toBeVisible();
    expect(accion).not.toHaveBeenCalled();
  });
});

describe("PoliticaDePlan: idempotencia del intento", () => {
  it("fija los valores y la versión vista al primer toque, y avisa que se guardó", async () => {
    accion.mockResolvedValue(BIEN);
    await abrir();
    await completar();
    tocar(guardar());
    await expect.element(page.getByText("Versión guardada.")).toBeVisible();
    expect(accion).toHaveBeenCalledTimes(1);
    expect(enviados()[0]).toMatchObject({
      versionEsperada: 1,
      diasDeAnticipacionDeSuba: 3,
      diasDeAnticipacionDeBaja: 10,
      diasDeArrepentimiento: 15,
      motivo: "Acuerdo con el dueño",
    });
    expect(enviados()[0]?.claveDeIdempotencia).toMatch(/^[0-9a-f-]{36}$/);
    await vi.waitFor(() => {
      expect(refrescar).toHaveBeenCalled();
    });
  });

  it("doble clic en guardar: se envía una sola vez y el botón queda ocupado mientras envía", async () => {
    const { espera, soltar } = puerta();
    accion.mockReturnValue(espera);
    await abrir();
    await completar();
    tocar(guardar());
    tocar(guardar());
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    await pausa(80);
    expect(accion).toHaveBeenCalledTimes(1);
    await expect.element(guardar()).toBeDisabled();
    soltar(BIEN);
    await expect.element(page.getByText("Versión guardada.")).toBeVisible();
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("la acción lanza y luego responde: reintento con la MISMA clave y los MISMOS valores", async () => {
    const segunda = puerta();
    accion
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockReturnValueOnce(segunda.espera);
    await abrir();
    await completar();
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect.element(page.getByLabelText("Plazo de arrepentimiento")).toBeDisabled();
    segunda.soltar(BIEN);
    await expect.element(page.getByText("Versión guardada.")).toBeVisible();
    const [primera, reintento] = enviados();
    expect(reintento).toEqual(primera);
  });

  it("INESPERADO devuelto como valor: queda incierto (con la referencia) y el reintento usa la MISMA clave", async () => {
    const segunda = puerta();
    accion.mockResolvedValueOnce(INESPERADO).mockReturnValueOnce(segunda.espera);
    await abrir();
    await completar();
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect.element(page.getByText("Código de referencia: PD-ABCD-0123")).toBeVisible();
    segunda.soltar(BIEN);
    await expect.element(page.getByText("Versión guardada.")).toBeVisible();
    const [primera, reintento] = enviados();
    expect(reintento).toEqual(primera);
  });
});

describe("PoliticaDePlan: dos personas a la vez", () => {
  it("ante VERSION_DESACTUALIZADA el formulario conserva lo escrito, muestra el aviso y se recarga la vigente", async () => {
    accion.mockResolvedValue(CONFLICTO);
    await abrir();
    await completar();
    tocar(guardar());
    await expect
      .element(page.getByText("Otra persona cambió la política mientras tanto. Volvé a cargarla."))
      .toBeVisible();
    await expect.element(page.getByLabelText("Anticipación de una suba")).toHaveValue("3");
    await expect.element(page.getByLabelText("Plazo de arrepentimiento")).toHaveValue("15");
    await expect.element(page.getByLabelText("Motivo")).toHaveValue("  Acuerdo con el dueño  ");
    await vi.waitFor(() => {
      expect(refrescar).toHaveBeenCalled();
    });
    expect(page.getByText("Versión guardada.").elements()).toHaveLength(0);
  });

  it("tras el conflicto, guardar de nuevo es OTRO intento: clave nueva y la versión que mostró la pantalla recargada", async () => {
    accion.mockResolvedValueOnce(CONFLICTO).mockResolvedValueOnce(BIEN);
    const vista = await render(<PoliticaDePlan vigente={VIGENTE} puedeDefinir />);
    tocar(page.getByRole("button", { name: "Definir versión nueva" }));
    await completar();
    tocar(guardar());
    await expect
      .element(page.getByText(/Otra persona cambió la política mientras tanto/))
      .toBeVisible();
    await vista.rerender(
      <PoliticaDePlan vigente={{ ...VIGENTE, version: 2, suba: 7 }} puedeDefinir />,
    );
    tocar(guardar());
    await expect.element(page.getByText("Versión guardada.")).toBeVisible();
    const [primera, segunda] = enviados();
    expect(segunda?.versionEsperada).toBe(2);
    expect(segunda?.claveDeIdempotencia).not.toBe(primera?.claveDeIdempotencia);
  });

  it("segundo factor vencido: pide el código y repite el MISMO intento", async () => {
    accion.mockResolvedValueOnce({ ok: false, error: { tipo: "SEGUNDO_FACTOR" } });
    await abrir();
    await completar();
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    await expect
      .element(page.getByRole("dialog", { name: "Confirmá que sos vos" }).last())
      .toBeVisible();
  });
});
