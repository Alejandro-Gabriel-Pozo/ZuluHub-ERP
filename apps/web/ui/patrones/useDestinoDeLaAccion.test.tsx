import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useDestinoDeLaAccion } from "./useDestinoDeLaAccion.cliente";

/** Lo que hace un formulario cuando su acción trae adónde ir: lo abre el navegador y pide la pantalla de nuevo, una sola vez; sin destino no navega. */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function Formulario({ destino }: Readonly<{ destino: string | undefined }>) {
  useDestinoDeLaAccion(destino);
  return <p>formulario</p>;
}

beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
});

describe("useDestinoDeLaAccion", () => {
  it("con destino: abre ese destino y pide la pantalla de nuevo, una sola vez aunque se vuelva a dibujar", async () => {
    const { rerender } = await render(<Formulario destino="/catalogo/productos/p1" />);
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith("/catalogo/productos/p1"));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await rerender(<Formulario destino="/catalogo/productos/p1" />);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("sin destino no navega ni refresca", async () => {
    await render(<Formulario destino={undefined} />);
    await new Promise((r) => setTimeout(r, 100));
    expect(router.push).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
