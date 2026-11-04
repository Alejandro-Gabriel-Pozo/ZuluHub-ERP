import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { tocar, verificarFoco, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import {
  DOMICILIO_DE_PRUEBA,
  PERMITIDO,
  enArmazon,
  legibleYTocable,
  ventana,
} from "./ayudas-de-pruebas";
import { FormularioDePuntoDeVenta } from "./FormularioDePuntoDeVenta.cliente";
import type { PuntoParaConfigurar } from "./modelo-de-puntos-de-venta";

/**
 * La edición de un punto de venta con su domicilio actual precargado (pedido del dueño, 2026-11-04). Lo que se verifica: los campos
 * abren con el domicilio vigente; si no se toca no viaja (un domicilio no se edita: el mismo id con otro contenido es `ID_EN_USO`);
 * si se corrige viaja como NUEVO con un id que no es el del guardado, fijo para reintentar el MISMO envío; «Guardando…», el doble
 * toque, el error «Revisá los datos marcados.» (D-67) con su campo marcado y la versión desactualizada. La acción del servidor va
 * simulada. El resto de la edición está en `FormularioDePuntoDeVenta.test.tsx`.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const guardar = vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>();
const BIEN: Respuesta<unknown> = { ok: true, dato: { version: 8, sinCambios: false } };
const LISTA = "/configuracion-fiscal/puntos-de-venta";
const ORIGINAL: PuntoParaConfigurar = {
  id: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
  numero: 2,
  activo: true,
  ambiente: "HOMOLOGACION",
  sucursal: { id: "s-norte", nombre: "Sucursal Norte", activa: true },
  tieneDomicilio: true,
  domicilio: DOMICILIO_DE_PRUEBA,
  hayNumerosUsados: false,
  version: 7,
};
const formulario = (original: PuntoParaConfigurar) => (
  <FormularioDePuntoDeVenta
    emisorId="2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d"
    original={original}
    sucursales={[{ valor: "s-norte", etiqueta: "Sucursal Norte" }]}
    guardar={guardar}
    rutaAlTerminar={LISTA}
    rutaAlCancelar={LISTA}
    oferta={PERMITIDO}
  />
);
const guardarBoton = () => page.getByRole("button", { name: "Guardar" });
const pedidos = () => guardar.mock.calls.map(([pedido]) => pedido as Record<string, unknown>);
const valorDe = (etiqueta: string): string =>
  (page.getByLabelText(etiqueta, { exact: true }).element() as HTMLInputElement).value;
function puerta() {
  let soltar: (r: Respuesta<unknown>) => void = () => undefined;
  const espera = new Promise<Respuesta<unknown>>((resolve) => {
    soltar = resolve;
  });
  return { espera, soltar };
}

beforeEach(() => {
  guardar.mockReset();
  router.push.mockReset();
  router.refresh.mockReset();
});
afterEach(async () => {
  await page.viewport(390, 844);
});

describe("edición: el domicilio abre precargado", () => {
  it("los siete campos traen el domicilio actual, la provincia por nombre", async () => {
    await render(formulario(ORIGINAL));
    expect(valorDe("Calle")).toBe("Mitre");
    expect(valorDe("Número")).toBe("55");
    expect(valorDe("Piso")).toBe("2");
    expect(valorDe("Departamento")).toBe("B");
    expect(valorDe("Localidad")).toBe("Rosario");
    expect(valorDe("Código postal")).toBe("2000");
    const provincia = page.getByLabelText("Provincia").element() as HTMLSelectElement;
    expect(provincia.value).toBe("AR-S");
    expect(provincia.selectedOptions[0]?.textContent).toBe("Santa Fe");
  });

  it("un punto de venta sin domicilio abre con los campos del domicilio vacíos", async () => {
    await render(formulario({ ...ORIGINAL, tieneDomicilio: false, domicilio: null }));
    for (const etiqueta of [
      "Calle",
      "Número",
      "Piso",
      "Departamento",
      "Localidad",
      "Código postal",
    ]) {
      expect(valorDe(etiqueta)).toBe("");
    }
    expect((page.getByLabelText("Provincia").element() as HTMLSelectElement).value).toBe("");
  });

  it.each([390, 1280])(
    "a %i px: sin violaciones como página, legible y tocable, sin desborde lateral",
    async (ancho) => {
      await ventana(ancho);
      await render(enArmazon("Punto de venta 00002", formulario(ORIGINAL)));
      expect(valorDe("Calle")).toBe("Mitre");
      expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
      legibleYTocable();
    },
  );

  it("con teclado: el foco recorre los campos precargados y Enter guarda sin reenviar el domicilio", async () => {
    guardar.mockResolvedValue(BIEN);
    await render(formulario(ORIGINAL));
    await verificarFoco(page.getByLabelText("Número de punto de venta").element() as HTMLElement);
    await userEvent.tab();
    await userEvent.tab();
    expect(document.activeElement).toBe(page.getByLabelText("Calle").element());
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(1));
    expect(pedidos()[0]).toEqual({ puntoDeVentaId: ORIGINAL.id, versionEsperada: 7 });
  });
});

describe("edición: qué viaja del domicilio", () => {
  it("sin tocarlo no viaja; el servidor puede responder «sin cambios» y se vuelve a la lista igual", async () => {
    guardar.mockResolvedValue({ ok: true, dato: { version: 7, sinCambios: true } });
    await render(formulario(ORIGINAL));
    tocar(guardarBoton());
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    expect(pedidos()).toEqual([{ puntoDeVentaId: ORIGINAL.id, versionEsperada: 7 }]);
  });

  it("corregido viaja como NUEVO, completo, con un id que no es el del domicilio guardado ni el del punto de venta", async () => {
    guardar.mockResolvedValue(BIEN);
    await render(formulario(ORIGINAL));
    await page.getByLabelText("Calle").fill("Sarmiento");
    tocar(guardarBoton());
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    expect(pedidos()[0]).toMatchObject({
      puntoDeVentaId: ORIGINAL.id,
      versionEsperada: 7,
      domicilio: {
        tipo: "NUEVO",
        calle: "Sarmiento",
        numero: "55",
        piso: "2",
        departamento: "B",
        localidad: "Rosario",
        provincia: "AR-S",
        codigoPostal: "2000",
      },
    });
    const { domicilio } = pedidos()[0] as { domicilio: { id: string } };
    expect(domicilio.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(domicilio.id).not.toBe(DOMICILIO_DE_PRUEBA.id);
    expect(domicilio.id).not.toBe(ORIGINAL.id);
  });

  it("doble toque con el domicilio corregido: un solo envío; «Guardando…» mientras espera", async () => {
    const abierta = puerta();
    guardar.mockReturnValue(abierta.espera);
    await render(formulario(ORIGINAL));
    await page.getByLabelText("Localidad").fill("Funes");
    tocar(guardarBoton());
    tocar(guardarBoton());
    tocar(guardarBoton());
    await expect.element(page.getByRole("button", { name: "Guardando…" })).toBeVisible();
    abierta.soltar(BIEN);
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    expect(guardar).toHaveBeenCalledTimes(1);
  });

  it("la red se corta y vuelve: el reintento reenvía el MISMO domicilio con el MISMO id", async () => {
    const segunda = puerta();
    guardar
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockReturnValueOnce(segunda.espera);
    await render(formulario(ORIGINAL));
    await page.getByLabelText("Calle").fill("Sarmiento");
    tocar(guardarBoton());
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(2), { timeout: 5000 });
    segunda.soltar(BIEN);
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    expect(pedidos()[1]).toEqual(pedidos()[0]);
  });
});

describe("edición: errores del domicilio y versión desactualizada", () => {
  it("dejar la calle vacía: «Revisá los datos marcados.» con «Calle» marcada y el foco en ella", async () => {
    guardar.mockResolvedValue({
      ok: false,
      error: { ...errorDeCodigo("FISCAL_CONFIGURACION_DATOS_INVALIDOS"), campo: "domicilio.calle" },
    });
    await render(formulario(ORIGINAL));
    await page.getByLabelText("Calle").fill("");
    tocar(guardarBoton());
    const calle = page.getByLabelText("Calle");
    await expect.element(calle).toHaveAttribute("aria-invalid", "true");
    expect(
      document.getElementById(calle.element().getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe("Revisá los datos marcados.");
    await vi.waitFor(() => expect(document.activeElement).toBe(calle.element()));
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(1);
    expect(document.body.textContent).not.toContain("faltante");
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });

  it("tras un rechazo, corregir y reenviar usa el mismo id de domicilio con los valores nuevos (el rechazo no escribió nada)", async () => {
    guardar
      .mockResolvedValueOnce({
        ok: false,
        error: {
          ...errorDeCodigo("FISCAL_CONFIGURACION_DATOS_INVALIDOS"),
          campo: "domicilio.calle",
        },
      })
      .mockResolvedValueOnce(BIEN);
    await render(formulario(ORIGINAL));
    await page.getByLabelText("Calle").fill("");
    tocar(guardarBoton());
    await expect.element(page.getByLabelText("Calle")).toHaveAttribute("aria-invalid", "true");
    await page.getByLabelText("Calle").fill("Sarmiento");
    tocar(guardarBoton());
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    const [primero, segundo] = pedidos() as { domicilio: { id: string; calle: string } }[];
    expect(segundo?.domicilio).toMatchObject({ id: primero?.domicilio.id, calle: "Sarmiento" });
  });

  it("versión desactualizada: recarga y el formulario toma el domicilio de la otra persona y lo que se corrija viaja con otro id", async () => {
    guardar
      .mockResolvedValueOnce({ ok: false, error: errorDeCodigo("FISCAL_VERSION_DESACTUALIZADA") })
      .mockResolvedValueOnce(BIEN);
    const { rerender } = await render(formulario(ORIGINAL));
    await page.getByLabelText("Calle").fill("Sarmiento");
    tocar(guardarBoton());
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    const primero = pedidos()[0] as { domicilio: { id: string } };
    const deLaOtraPersona = {
      ...DOMICILIO_DE_PRUEBA,
      id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
      calle: "Belgrano",
    };
    await rerender(formulario({ ...ORIGINAL, version: 8, domicilio: deLaOtraPersona }));
    expect(valorDe("Calle")).toBe("Belgrano");
    await page.getByLabelText("Calle").fill("Alberdi");
    tocar(guardarBoton());
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(2));
    const segundo = pedidos()[1] as { versionEsperada: number; domicilio: { id: string } };
    expect(segundo.versionEsperada).toBe(8);
    expect(segundo.domicilio.id).not.toBe(primero.domicilio.id);
  });
});
