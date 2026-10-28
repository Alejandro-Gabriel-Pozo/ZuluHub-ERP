import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { restaurarConexion, tocar } from "../../web/ui/pruebas/ayudas";
import { guardarBorradorAccion } from "../app/submarcas/acciones";
import type { FichaDeSubmarca } from "../logica/ficha-de-submarca";
import { SIN_PROPIOS } from "../logica/submarca";
import { EditorDeSubmarca } from "./editor-de-submarca.cliente";

/**
 * El editor de la submarca (cliente): el borrador se guarda con una clave de idempotencia del INTENTO, los valores se
 * fijan al primer toque y lo que se manda es solo lo propio más lo editado. Las acciones del servidor van simuladas.
 */
vi.mock("../app/submarcas/acciones", () => ({
  guardarBorradorAccion: vi.fn(),
  confirmarVersionAccion: vi.fn(),
}));
const refrescar = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refrescar }) }));

const accion = vi.mocked(guardarBorradorAccion);
type Respuesta = Awaited<ReturnType<typeof guardarBorradorAccion>>;

const BIEN: Respuesta = { ok: true, dato: { version: 5 } };
const INESPERADO: Respuesta = {
  ok: false,
  error: { tipo: "INESPERADO" },
  referencia: "PD-ABCD-0123",
};

const CATALOGO = {
  superficies: [{ valor: "NEUTRA", fondo: "#ffffff", superficie: "#f3f5f7" }],
  pares: [
    { par: "on-primary/primary", minimo: 4.5 },
    { par: "accent/fondo", minimo: 3 },
    { par: "accent/superficie", minimo: 3 },
  ],
};

/** Una submarca con el principal y el texto propios, el acento heredado y el aspecto sin definir. */
function ficha(cambios: Partial<FichaDeSubmarca> = {}): FichaDeSubmarca {
  return {
    id: "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a",
    codigo: "sur",
    nombre: "Sur",
    estado: "ACTIVA",
    versionVigente: 1,
    numeroDeLaVersionNueva: 2,
    borrador: { version: 3 },
    hayProgramada: false,
    formulario: {
      nombreVisible: "Sur",
      colores: { primary: "#9a3412", onPrimary: "#ffffff", secondary: "", accent: "#0f766e" },
      aspecto: {
        estilo: "CLARO_CON_BORDES",
        superficie: "NEUTRA",
        esquinas: "SUAVE",
        titulos: "SANS",
        ingreso: "CENTRADO",
      },
      propio: {
        ...SIN_PROPIOS,
        colores: { primary: true, onPrimary: true, secondary: false, accent: false },
      },
    },
    formularioDeLaVigente: null,
    puedeConfirmarse: { ok: true },
    contrasteDelBorrador: null,
    catalogo: CATALOGO,
    ...cambios,
  };
}

beforeEach(() => {
  accion.mockReset();
  refrescar.mockReset();
});
afterEach(restaurarConexion);

const guardar = () => page.getByRole("button", { name: /Guardar borrador|Guardando…/ });
const nombre = () => page.getByLabelText(/Nombre visible/);
const acento = () => page.getByLabelText(/^Acento/);

function puerta() {
  let soltar: (r: Respuesta) => void = () => undefined;
  const espera = new Promise<Respuesta>((resolve) => {
    soltar = resolve;
  });
  return { espera, soltar };
}
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
const primerPedido = () => accion.mock.calls[0]?.[0] as Record<string, unknown>;

describe("EditorDeSubmarca: qué se manda", () => {
  it("editar un color manda solo lo propio más lo editado: el aspecto y lo heredado no se congelan", async () => {
    accion.mockResolvedValue(BIEN);
    await render(<EditorDeSubmarca ficha={ficha()} />);
    await page.getByLabelText(/^Secundario/).fill("#334155");
    tocar(guardar());
    await expect.element(page.getByText("Borrador guardado.")).toBeVisible();
    expect(accion).toHaveBeenCalledTimes(1);
    expect(primerPedido()).toMatchObject({
      versionEsperada: 3,
      cambios: { tema: { primary: "#9a3412", "on-primary": "#ffffff", secondary: "#334155" } },
    });
    // El acento se hereda y nadie lo tocó: no viaja. El aspecto tampoco.
    expect(JSON.stringify(primerPedido()["cambios"])).not.toContain("accent");
    expect(primerPedido()["cambios"]).not.toHaveProperty("aspecto");
    await vi.waitFor(() => expect(refrescar).toHaveBeenCalled());
  });

  it("el color se manda normalizado aunque se escriba en mayúsculas, con espacios y sin «#»", async () => {
    accion.mockResolvedValue(BIEN);
    await render(<EditorDeSubmarca ficha={ficha()} />);
    await acento().fill(" 0F766F ");
    tocar(guardar());
    await expect.element(page.getByText("Borrador guardado.")).toBeVisible();
    expect(primerPedido()).toMatchObject({ cambios: { tema: { accent: "#0f766f" } } });
  });
});

describe("EditorDeSubmarca: idempotencia del intento", () => {
  it("doble toque: se envía una sola vez", async () => {
    accion.mockImplementation(async () => {
      await pausa(60);
      return BIEN;
    });
    await render(<EditorDeSubmarca ficha={ficha()} />);
    await nombre().fill("Sur Nuevo");
    tocar(guardar());
    tocar(guardar());
    tocar(guardar());
    await expect.element(page.getByText("Borrador guardado.")).toBeVisible();
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("la acción lanza y luego responde: reintento con la MISMA clave y los MISMOS valores, y la edición queda bloqueada", async () => {
    const segunda = puerta();
    accion
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockReturnValueOnce(segunda.espera);
    await render(<EditorDeSubmarca ficha={ficha()} />);
    await nombre().fill("Sur Nuevo");
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Verificando si el borrador quedó guardado…");
    await expect.element(nombre()).toBeDisabled();
    segunda.soltar(BIEN);
    await expect.element(page.getByText("Borrador guardado.")).toBeVisible();
    expect(accion.mock.calls[1]?.[0]).toEqual(accion.mock.calls[0]?.[0]);
  });

  it("INESPERADO devuelto como valor: queda incierto (con la referencia) y el reintento usa la MISMA clave y los mismos valores", async () => {
    const segunda = puerta();
    accion.mockResolvedValueOnce(INESPERADO).mockReturnValueOnce(segunda.espera);
    await render(<EditorDeSubmarca ficha={ficha()} />);
    await nombre().fill("Sur Nuevo");
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent(
        "Verificando si el borrador quedó guardado…Código de referencia: PD-ABCD-0123",
      );
    await expect.element(nombre()).toBeDisabled();
    segunda.soltar(BIEN);
    await expect.element(page.getByText("Borrador guardado.")).toBeVisible();
    expect(accion.mock.calls[1]?.[0]).toEqual(accion.mock.calls[0]?.[0]);
  });
});

describe("EditorDeSubmarca: errores del servidor", () => {
  it("conflicto de versión: avisa que alguien más cambió el borrador y ofrece «Recargar»", async () => {
    accion.mockResolvedValue({
      ok: false,
      error: { tipo: "PANTALLA_VIEJA", texto: "Alguien más cambió el borrador. Recargá." },
    });
    await render(<EditorDeSubmarca ficha={ficha()} />);
    await nombre().fill("Sur Nuevo");
    tocar(guardar());
    await expect.element(page.getByText("Alguien más cambió el borrador. Recargá.")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Recargar" })).toBeVisible();
    expect(primerPedido()).toMatchObject({ versionEsperada: 3 });
  });

  it("marca retirada que llega del servidor: bloquea la edición y no dice que la pantalla quedó vieja", async () => {
    accion.mockResolvedValue({
      ok: false,
      error: { tipo: "MARCA_RETIRADA", texto: "Esta submarca está retirada. Ya no se modifica." },
    });
    await render(<EditorDeSubmarca ficha={ficha()} />);
    await nombre().fill("Sur Nuevo");
    tocar(guardar());
    await expect
      .element(page.getByText("Esta submarca está retirada. Ya no se modifica."))
      .toBeVisible();
    await expect.element(nombre()).toBeDisabled();
    await expect.element(acento()).toBeDisabled();
    await expect.element(page.getByText(/quedó vieja/)).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Recargar" })).not.toBeInTheDocument();
  });

  it("marca retirada según la ficha: todo bloqueado desde el principio, con un texto claro", async () => {
    await render(<EditorDeSubmarca ficha={ficha({ estado: "RETIRADA" })} />);
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent(
        "Submarca retiradaEsta submarca está retirada. Se puede ver, pero ya no se puede modificar ni confirmar.",
      );
    await expect.element(nombre()).toBeDisabled();
    await expect.element(page.getByLabelText(/^Principal/)).toBeDisabled();
    await expect.element(page.getByLabelText(/^Estilo/)).toBeDisabled();
  });
});

describe("EditorDeSubmarca: contraste y vista previa", () => {
  it("mide el color ya normalizado: «9A3500 » sobre el principal no se lee", async () => {
    await render(<EditorDeSubmarca ficha={ficha()} />);
    await page.getByLabelText(/^Texto sobre principal/).fill("  9A3500 ");
    await expect
      .element(page.getByText(/El texto no se lee sobre el color principal/))
      .toBeVisible();
  });
});

describe("EditorDeSubmarca: Enter en el formulario", () => {
  it("no envía el borrador (el formulario tiene varios campos de texto y ningún botón de envío)", async () => {
    accion.mockResolvedValue(BIEN);
    await render(<EditorDeSubmarca ficha={ficha()} />);
    await nombre().fill("Sur Nuevo");
    await userEvent.keyboard("{Enter}");
    await pausa(150);
    expect(accion).not.toHaveBeenCalled();
  });
});
