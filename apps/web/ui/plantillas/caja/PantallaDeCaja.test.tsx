import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import {
  CAJA_ABIERTA,
  CAJA_CERRADA,
  CAJA_EN_CIERRE,
  CONTEO,
  GENERICO,
  PERMISOS_NINGUNO,
  PERMISOS_TODOS,
  accionesDelServidor,
} from "./ayudas-de-pruebas";
import type { AccionesDeLaPantallaDeCaja } from "./lista-de-caja";
import type { CajaDeLaPantalla } from "./modelo-de-la-caja";
import { PantallaDeCaja } from "./PantallaDeCaja";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import type { ConteoDeLaCaja } from "./modelo-de-conteo-de-caja";

/**
 * La pantalla «Caja» del mostrador en Chromium (maqueta `caja.html`): caja cerrada con el resumen y «Abrir caja», caja abierta con la cabecera «Jornada … · Corte …», el efectivo esperado, la lista de
 * movimientos (solo lectura), los botones apagados por permisos, la sesión en cierre con «Contar» y «Volver», y el error del servidor como texto genérico. Las acciones van simuladas; el servidor decide de verdad.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
});

const pantalla = (
  caja: CajaDeLaPantalla,
  opciones: Partial<{
    permisos: AccionesDeLaPantallaDeCaja;
    conteo: ConteoDeLaCaja | null;
    errorDelConteo: ErrorPublico | null;
    acciones: ReturnType<typeof accionesDelServidor>["acciones"];
  }> = {},
) => (
  <PantallaDeCaja
    cajas={[
      { caja, conteo: opciones.conteo ?? null, errorDelConteo: opciones.errorDelConteo ?? null },
    ]}
    permisos={opciones.permisos ?? PERMISOS_TODOS}
    acciones={opciones.acciones ?? accionesDelServidor().acciones}
    largoMaximoDelTexto={20}
  />
);

describe("caja cerrada", () => {
  it("muestra la caja, «Cerrada», el resumen de la última sesión y «Abrir caja»; es accesible", async () => {
    await render(pantalla(CAJA_CERRADA));
    await expect.element(page.getByRole("heading", { name: "Caja 1", level: 2 })).toBeVisible();
    await expect.element(page.getByText("Cerrada")).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Última sesión" })).toBeVisible();
    await expect.element(page.getByText("$ 50.800,00")).toBeVisible();
    await expect
      .element(page.getByText("Esperado $ 50.900,00 · Diferencia -$ 100,00"))
      .toBeVisible();
    await expect.element(page.getByText("Conforme", { exact: true })).toBeVisible();
    await expect.element(page.getByText("QR · Sin cuenta")).toBeVisible();
    await expect.element(page.getByText("Faltaron 100 pesos de vuelto")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Abrir caja" })).toBeEnabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin sesión anterior no hay resumen; sin permiso «Abrir caja» sale apagado", async () => {
    await render(pantalla({ ...CAJA_CERRADA, ultimaSesion: null }, { permisos: PERMISOS_NINGUNO }));
    expect(page.getByRole("heading", { name: "Última sesión" }).elements()).toHaveLength(0);
    await expect.element(page.getByRole("button", { name: "Abrir caja" })).toBeDisabled();
  });

  it("«Abrir caja» abre el formulario del fondo inicial y «Cancelar» vuelve", async () => {
    await render(pantalla(CAJA_CERRADA));
    await userEvent.click(page.getByRole("button", { name: "Abrir caja" }));
    await expect.element(page.getByRole("heading", { name: "Abrir caja" })).toBeVisible();
    await expect.element(page.getByLabelText("Fondo inicial")).toBeVisible();
    expect(page.getByText("Sugerido").elements()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    await userEvent.click(page.getByRole("button", { name: "Cancelar" }));
    await expect.element(page.getByRole("heading", { name: "Caja 1" })).toBeVisible();
  });

  it("abrir manda el fondo y el id de SU caja con una clave; el doble toque es un solo envío y recarga", async () => {
    const { acciones, mocks } = accionesDelServidor();
    let liberar: () => void = () => undefined;
    mocks.abrir.mockImplementation(
      () =>
        new Promise((resolver) => {
          liberar = () => {
            resolver({ ok: true, dato: {} });
          };
        }),
    );
    await render(pantalla(CAJA_CERRADA, { acciones }));
    await userEvent.click(page.getByRole("button", { name: "Abrir caja" }));
    await userEvent.fill(page.getByLabelText("Fondo inicial"), "15000");
    const abrir = page.getByRole("button", { name: "Abrir caja" });
    tocar(abrir);
    tocar(abrir);
    tocar(abrir);
    await vi.waitFor(() => {
      expect(mocks.abrir).toHaveBeenCalledTimes(1);
    });
    const pedido = mocks.abrir.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(pedido).toEqual({
      claveDeIdempotencia: expect.any(String) as string,
      cajaId: "caja-1",
      fondoInicial: "15000.00",
    });
    expect(router.refresh).not.toHaveBeenCalled();
    liberar();
    await vi.waitFor(() => {
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });
    expect(mocks.abrir).toHaveBeenCalledTimes(1);
  });

  it("si la respuesta no llega, reintenta con la MISMA clave y el mismo pedido", async () => {
    const { acciones, mocks } = accionesDelServidor();
    mocks.abrir.mockRejectedValueOnce(new Error("red cortada"));
    await render(pantalla(CAJA_CERRADA, { acciones }));
    await userEvent.click(page.getByRole("button", { name: "Abrir caja" }));
    await userEvent.fill(page.getByLabelText("Fondo inicial"), "100");
    tocar(page.getByRole("button", { name: "Abrir caja" }));
    await expect.element(page.getByText("Verificando si se registró…").first()).toBeVisible();
    await vi.waitFor(
      () => {
        expect(mocks.abrir).toHaveBeenCalledTimes(2);
      },
      { timeout: 6000 },
    );
    expect(mocks.abrir.mock.calls[1]?.[0]).toEqual(mocks.abrir.mock.calls[0]?.[0]);
    await vi.waitFor(() => {
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("el rechazo del servidor sale como el texto genérico y se puede volver a intentar con otra clave", async () => {
    const { acciones, mocks } = accionesDelServidor();
    mocks.abrir.mockResolvedValueOnce(GENERICO);
    await render(pantalla(CAJA_CERRADA, { acciones }));
    await userEvent.click(page.getByRole("button", { name: "Abrir caja" }));
    await userEvent.fill(page.getByLabelText("Fondo inicial"), "100");
    tocar(page.getByRole("button", { name: "Abrir caja" }));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    tocar(page.getByRole("button", { name: "Abrir caja" }));
    await vi.waitFor(() => {
      expect(mocks.abrir).toHaveBeenCalledTimes(2);
    });
    const [primero, segundo] = mocks.abrir.mock.calls.map(
      (c) => c[0] as { claveDeIdempotencia: string },
    );
    expect(segundo?.claveDeIdempotencia).not.toBe(primero?.claveDeIdempotencia);
  });

  it("el fondo vacío o sin permiso no envía", async () => {
    const { acciones, mocks } = accionesDelServidor();
    await render(pantalla(CAJA_CERRADA, { acciones }));
    await userEvent.click(page.getByRole("button", { name: "Abrir caja" }));
    await expect.element(page.getByRole("button", { name: "Abrir caja" })).toBeDisabled();
    tocar(page.getByRole("button", { name: "Abrir caja" }));
    expect(mocks.abrir).not.toHaveBeenCalled();
  });
});

describe("caja abierta", () => {
  it("la cabecera dice «Jornada 09/11/2026 · Corte 06:00», el efectivo esperado y los movimientos en solo lectura; es accesible", async () => {
    await render(pantalla(CAJA_ABIERTA));
    await expect.element(page.getByText("Abierta")).toBeVisible();
    await expect.element(page.getByText("Jornada 09/11/2026 · Corte 06:00")).toBeVisible();
    await expect.element(page.getByText("Efectivo: $ 50.900,00")).toBeVisible();
    await expect.element(page.getByText("-$ 2.500,00")).toBeVisible();
    await expect.element(page.getByText("Tarjeta de débito · Posnet 1")).toBeVisible();
    await expect.element(page.getByText("Fondo inicial", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Anulado")).toBeVisible();
    await expect.element(page.getByText("Anulación · Se cargó mal")).toBeVisible();
    expect(
      page.getByRole("button", { name: /Anular|Ingreso|Egreso|Ajuste|Abrir caja/ }).elements(),
    ).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin permiso «Cerrar caja» sale apagado", async () => {
    await render(pantalla(CAJA_ABIERTA, { permisos: PERMISOS_NINGUNO }));
    await expect.element(page.getByRole("button", { name: "Cerrar caja" })).toBeDisabled();
  });
});

describe("cerrar la caja y contar", () => {
  it("«Cerrar caja» pide iniciar el cierre (una vez aunque se toque dos veces) y recarga", async () => {
    const { acciones, mocks } = accionesDelServidor();
    await render(pantalla(CAJA_ABIERTA, { acciones }));
    const cerrar = page.getByRole("button", { name: "Cerrar caja" });
    tocar(cerrar);
    tocar(cerrar);
    await vi.waitFor(() => {
      expect(mocks.iniciarCierre).toHaveBeenCalledTimes(1);
    });
    expect(mocks.iniciarCierre.mock.calls[0]?.[0]).toEqual({ sesionId: "ses-1" });
    await vi.waitFor(() => {
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("el rechazo de iniciar el cierre sale como el genérico", async () => {
    const { acciones, mocks } = accionesDelServidor();
    mocks.iniciarCierre.mockResolvedValueOnce(GENERICO);
    await render(pantalla(CAJA_ABIERTA, { acciones }));
    tocar(page.getByRole("button", { name: "Cerrar caja" }));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("con la sesión en cierre se ve «Contar» y no hay otros botones de la caja; es accesible", async () => {
    await render(pantalla(CAJA_EN_CIERRE, { conteo: CONTEO }));
    await expect.element(page.getByRole("heading", { name: "Contar" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Cancelar cierre" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Cerrar caja" })).toBeVisible();
    expect(page.getByRole("button", { name: "Abrir caja" }).elements()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«Volver» solo vuelve a la caja (la jornada, sin nada que contar) y no cancela el cierre; «Cerrar caja» la lleva de nuevo a contar con lo escrito", async () => {
    const { acciones, mocks } = accionesDelServidor();
    await render(pantalla(CAJA_EN_CIERRE, { conteo: CONTEO, acciones }));
    await userEvent.fill(page.getByLabelText("$ 20.000", { exact: true }), "2");
    await userEvent.click(page.getByRole("button", { name: "Volver" }));
    await expect.element(page.getByRole("heading", { name: "Caja 1" })).toBeVisible();
    expect(mocks.cancelarCierre).not.toHaveBeenCalled();
    await expect.element(page.getByText("Jornada 09/11/2026 · Corte 06:00")).toBeVisible();
    tocar(page.getByRole("button", { name: "Cerrar caja" }));
    await vi.waitFor(() => {
      expect(mocks.iniciarCierre).toHaveBeenCalledTimes(1);
    });
    await expect.element(page.getByRole("heading", { name: "Contar" })).toBeVisible();
    await expect.element(page.getByLabelText("$ 20.000", { exact: true })).toHaveValue("2");
  });

  it("«Cancelar cierre» lo cancela por la sesión y recarga", async () => {
    const { acciones, mocks } = accionesDelServidor();
    await render(pantalla(CAJA_EN_CIERRE, { conteo: CONTEO, acciones }));
    tocar(page.getByRole("button", { name: "Cancelar cierre" }));
    await vi.waitFor(() => {
      expect(mocks.cancelarCierre).toHaveBeenCalledTimes(1);
    });
    expect(mocks.cancelarCierre.mock.calls[0]?.[0]).toEqual({ sesionId: "ses-1" });
    await vi.waitFor(() => {
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("si no se pudo leer lo que hay que contar, sale el error del servidor y se puede volver", async () => {
    await render(
      pantalla(CAJA_EN_CIERRE, {
        conteo: null,
        errorDelConteo: {
          codigo: "CAJA_ACCION_NO_PERMITIDA",
          clave: "caja.error.accion_no_permitida",
          presentacion: "AVISO",
        },
      }),
    );
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Volver" }));
    await expect.element(page.getByRole("heading", { name: "Caja 1" })).toBeVisible();
  });
});

describe("varias cajas", () => {
  it("un bloque por caja, cada una con su cajaId al abrir", async () => {
    const { acciones, mocks } = accionesDelServidor();
    const otra: CajaDeLaPantalla = { ...CAJA_CERRADA, cajaId: "caja-2", nombre: "Caja 2" };
    await render(
      <PantallaDeCaja
        cajas={[
          { caja: CAJA_ABIERTA, conteo: null, errorDelConteo: null },
          { caja: otra, conteo: null, errorDelConteo: null },
        ]}
        permisos={PERMISOS_TODOS}
        acciones={acciones}
        largoMaximoDelTexto={20}
      />,
    );
    await expect.element(page.getByRole("heading", { name: "Caja 1", level: 2 })).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Caja 2", level: 2 })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Abrir caja" }));
    await userEvent.fill(page.getByLabelText("Fondo inicial"), "1");
    tocar(page.getByRole("button", { name: "Abrir caja" }));
    await vi.waitFor(() => {
      expect(mocks.abrir).toHaveBeenCalledTimes(1);
    });
    expect(mocks.abrir.mock.calls[0]?.[0]).toMatchObject({ cajaId: "caja-2" });
  });
});
