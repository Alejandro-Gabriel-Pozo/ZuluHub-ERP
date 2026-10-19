import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { useActividad, type EstadoDeSesion } from "./useActividad";

/** Límites de juguete en milisegundos: la función real recibe los de la sesión del mostrador. */
const AVISO_MS = 500;
const VENCE_MS = 1800;
const calcular = (ms: number): EstadoDeSesion =>
  ms >= VENCE_MS ? "vencida" : ms >= AVISO_MS ? "por-vencer" : "activa";

function Sonda() {
  const { estado, registrarActividad, marcarVencida } = useActividad({
    calcularEstado: calcular,
    revisarCadaMs: 20,
  });
  return (
    <>
      <output data-testid="estado">{estado}</output>
      <button type="button" onClick={registrarActividad}>
        Seguir
      </button>
      <button type="button" onClick={marcarVencida}>
        Vencer ya
      </button>
      <button type="button">Otro</button>
    </>
  );
}

const estadoActual = () => page.getByTestId("estado").element().textContent;

describe("useActividad", () => {
  it("pasa de activa a por vencer y a vencida según el tiempo sin uso, con límites del llamador", async () => {
    await render(<Sonda />);
    expect(estadoActual()).toBe("activa");
    await vi.waitFor(() => expect(estadoActual()).toBe("por-vencer"), { timeout: 3000 });
    await vi.waitFor(() => expect(estadoActual()).toBe("vencida"), { timeout: 4000 });
  });

  it("usar la pantalla antes del aviso reinicia la cuenta", async () => {
    await render(<Sonda />);
    // Más tiempo total que el del vencimiento, pero con un toque antes de cada aviso.
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 300));
      await userEvent.click(page.getByRole("button", { name: "Otro" }));
    }
    expect(estadoActual()).toBe("activa");
  });

  it("con el aviso a la vista, tocar alrededor no lo apaga: solo «Seguir»", async () => {
    await render(<Sonda />);
    await vi.waitFor(() => expect(estadoActual()).toBe("por-vencer"), { timeout: 3000 });
    await userEvent.click(page.getByRole("button", { name: "Otro" }));
    await new Promise((r) => setTimeout(r, 60));
    expect(estadoActual()).toBe("por-vencer");
    await userEvent.click(page.getByRole("button", { name: "Seguir" }));
    expect(estadoActual()).toBe("activa");
  });

  it("una sesión vencida no se revive: «Seguir» ya no sirve", async () => {
    await render(<Sonda />);
    await vi.waitFor(() => expect(estadoActual()).toBe("vencida"), { timeout: 5000 });
    await userEvent.click(page.getByRole("button", { name: "Seguir" }));
    await new Promise((r) => setTimeout(r, 60));
    expect(estadoActual()).toBe("vencida");
  });

  it("marcarVencida vence la sesión ya (el servidor dijo 401) y «Seguir» no la revive", async () => {
    await render(<Sonda />);
    expect(estadoActual()).toBe("activa");
    await userEvent.click(page.getByRole("button", { name: "Vencer ya" }));
    expect(estadoActual()).toBe("vencida");
    await userEvent.click(page.getByRole("button", { name: "Seguir" }));
    expect(estadoActual()).toBe("vencida");
  });
});
