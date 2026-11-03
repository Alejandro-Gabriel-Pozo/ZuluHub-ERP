import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { restaurarConexion, simularConexion, tocar } from "../../pruebas/ayudas";
import { FormularioDeDatosFiscales } from "./FormularioDeDatosFiscales.cliente";
import type { BorradorDeDatosFiscales } from "./modelo-de-datos-fiscales";

/**
 * El envío de «Corregir datos fiscales» en Chromium. Lo que se verifica: la idempotencia (el pedido se fija con su clave al primer
 * intento; doble toque = un solo envío; un reintento por red cortada reenvía lo MISMO, también el id del borrador y el del domicilio
 * nuevo; un INESPERADO devuelto como valor no suelta lo fijado), el texto «Guardando…» solo en el botón que se tocó, y la concurrencia
 * (D-68): ante «versión desactualizada» el formulario se abre con el id y la versión del borrador que llega. Las acciones van simuladas.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const guardar = vi.fn<(pedido: unknown) => Promise<Respuesta<{ version: number }>>>();
const confirmar = vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>();

const EMISOR = "2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d";
const LECTURA = "/configuracion-fiscal/datos-fiscales";
const BORRADOR: BorradorDeDatosFiscales = {
  id: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
  version: 4,
  razonSocial: "Distribuidora Sur SA",
  condicionIva: "RESPONSABLE_INSCRIPTO",
  domicilio: {
    id: "d1",
    calle: "Av. Rivadavia",
    numero: "1234",
    piso: null,
    departamento: null,
    localidad: "Ciudad de Buenos Aires",
    provincia: "AR-C",
    codigoPostal: "1000",
  },
  inicioActividades: "2018-03-01",
};
const OTRO: BorradorDeDatosFiscales = {
  ...BORRADOR,
  id: "1c0a7b2f-3d4e-4f60-9b8c-0d1e2f3a4b5c",
  version: 9,
  razonSocial: "Cargado en otra pestaña SA",
};

const GUARDADO = (version: number): Respuesta<{ version: number }> => ({
  ok: true,
  dato: { version },
});
const BIEN: Respuesta<unknown> = { ok: true, dato: { numero: 3 } };
const DESACTUALIZADA = {
  ok: false,
  error: errorDeCodigo("FISCAL_VERSION_DESACTUALIZADA"),
} as const;
const INESPERADO = {
  ok: false,
  error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABCD-0123" },
} as const;

const formulario = (borrador: BorradorDeDatosFiscales | null = BORRADOR) => (
  <FormularioDeDatosFiscales
    emisorId={EMISOR}
    cuit="30712345678"
    borrador={borrador}
    condicionesDeIva={[{ valor: "RESPONSABLE_INSCRIPTO", etiqueta: "IVA Responsable Inscripto" }]}
    guardar={guardar}
    confirmar={confirmar}
    rutaAlGuardar={LECTURA}
    rutaAlConfirmar={LECTURA}
    rutaAlCancelar={LECTURA}
  />
);

beforeEach(() => {
  guardar.mockReset();
  confirmar.mockReset();
  router.push.mockReset();
  router.refresh.mockReset();
});
afterEach(async () => {
  restaurarConexion();
  await page.viewport(390, 844);
});

const boton = (nombre: string) => page.getByRole("button", { name: nombre });
const pedidos = () => guardar.mock.calls.map(([pedido]) => pedido as Record<string, unknown>);
/** Una respuesta que el test suelta cuando quiere: sostiene un envío en vuelo. */
function puerta<R>() {
  let soltar: (r: R) => void = () => undefined;
  const espera = new Promise<R>((resolve) => {
    soltar = resolve;
  });
  return { espera, soltar };
}
/** Un domicilio nuevo para que el pedido lleve el id del domicilio. */
const cambiarElDomicilio = () => page.getByLabelText("Calle").fill("Av. Corrientes");

describe("idempotencia del intento", () => {
  it("doble toque en «Confirmar»: un solo guardado y una sola confirmación", async () => {
    const abierta = puerta<Respuesta<{ version: number }>>();
    guardar.mockReturnValue(abierta.espera);
    confirmar.mockResolvedValue(BIEN);
    await render(formulario());
    await cambiarElDomicilio();
    tocar(boton("Confirmar"));
    tocar(boton("Confirmar"));
    tocar(boton("Confirmar"));
    abierta.soltar(GUARDADO(5));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LECTURA));
    expect(guardar).toHaveBeenCalledTimes(1);
    expect(confirmar).toHaveBeenCalledTimes(1);
    const pedido = pedidos()[0] as { borradorId: string; domicilio: { id: string } };
    expect(pedido.borradorId).toBe(BORRADOR.id);
    expect(pedido.domicilio.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("toques en los dos botones a la vez: gana el primero, no se mezclan", async () => {
    const abierta = puerta<Respuesta<{ version: number }>>();
    guardar.mockReturnValue(abierta.espera);
    await render(formulario());
    tocar(boton("Guardar borrador"));
    tocar(boton("Confirmar"));
    tocar(boton("Guardar borrador"));
    abierta.soltar(GUARDADO(5));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LECTURA));
    expect(guardar).toHaveBeenCalledTimes(1);
    expect(confirmar).not.toHaveBeenCalled();
  });

  it("la red se corta y vuelve: el reintento reenvía el MISMO pedido (mismo id de borrador y de domicilio) y el formulario queda bloqueado", async () => {
    const segunda = puerta<Respuesta<{ version: number }>>();
    guardar
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockReturnValueOnce(segunda.espera);
    confirmar.mockResolvedValue(BIEN);
    await render(formulario(null));
    await page.getByLabelText("Razón social").fill("Mi Empresa SRL");
    await page.getByLabelText("Calle").fill("Mitre");
    tocar(boton("Confirmar"));
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect.element(page.getByRole("status")).toHaveTextContent("Verificando si se registró…");
    await expect.element(page.getByLabelText("Razón social")).toBeDisabled();
    await expect.element(page.getByLabelText("Calle")).toBeDisabled();
    segunda.soltar(GUARDADO(1));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LECTURA));
    expect(guardar).toHaveBeenCalledTimes(2);
    expect(pedidos()[1]).toEqual(pedidos()[0]);
    // Empezando de cero el id del borrador lo puso el formulario: una vez, y sin versión.
    expect(pedidos()[0]?.["borradorId"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(pedidos()[0]).not.toHaveProperty("versionEsperada");
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(confirmar.mock.calls[0]?.[0]).toMatchObject({
      borradorId: pedidos()[0]?.["borradorId"],
      versionEsperada: 1,
    });
  });

  it("si lo que se corta es la confirmación, el reintento repite el guardado (el servidor responde «ya estaba» con la versión) y confirma lo mismo", async () => {
    guardar.mockResolvedValueOnce(GUARDADO(5)).mockResolvedValueOnce(GUARDADO(5));
    confirmar.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(BIEN);
    await render(formulario());
    await cambiarElDomicilio();
    tocar(boton("Confirmar"));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LECTURA), { timeout: 5000 });
    expect(guardar).toHaveBeenCalledTimes(2);
    expect(pedidos()[1]).toEqual(pedidos()[0]);
    expect(confirmar).toHaveBeenCalledTimes(2);
    expect(confirmar.mock.calls[1]?.[0]).toEqual(confirmar.mock.calls[0]?.[0]);
  });

  it("un INESPERADO devuelto como valor no es definitivo: queda incierto (con la referencia) y reintenta lo MISMO sin soltar lo fijado", async () => {
    const segunda = puerta<Respuesta<{ version: number }>>();
    guardar.mockResolvedValueOnce(INESPERADO).mockReturnValueOnce(segunda.espera);
    await render(formulario());
    await cambiarElDomicilio();
    tocar(boton("Guardar borrador"));
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect.element(page.getByText("PD-ABCD-0123", { exact: false })).toBeVisible();
    await expect.element(page.getByLabelText("Calle")).toBeDisabled();
    expect((page.getByLabelText("Calle").element() as HTMLInputElement).value).toBe(
      "Av. Corrientes",
    );
    segunda.soltar(GUARDADO(5));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LECTURA));
    expect(pedidos()[1]).toEqual(pedidos()[0]);
  });

  it("sin conexión no se fija ni se envía nada: los botones se apagan y, al volver, se envía lo que está escrito", async () => {
    guardar.mockResolvedValue(GUARDADO(5));
    confirmar.mockResolvedValue(BIEN);
    await render(formulario());
    await cambiarElDomicilio();
    simularConexion(false);
    await expect.element(boton("Confirmar")).toBeDisabled();
    await expect.element(boton("Guardar borrador")).toBeDisabled();
    expect(guardar).not.toHaveBeenCalled();
    simularConexion(true);
    await expect.element(boton("Confirmar")).toBeEnabled();
    tocar(boton("Confirmar"));
    await vi.waitFor(() => expect(confirmar).toHaveBeenCalledTimes(1));
  });

  it("tras un rechazo definitivo, corregir y reenviar usa el mismo id de borrador con los valores nuevos", async () => {
    guardar
      .mockResolvedValueOnce({
        ok: false,
        error: { ...errorDeCodigo("FISCAL_CONFIGURACION_DATOS_INVALIDOS"), campo: "razonSocial" },
      })
      .mockResolvedValueOnce(GUARDADO(5));
    await render(formulario(null));
    tocar(boton("Guardar borrador"));
    await expect
      .element(page.getByLabelText("Razón social"))
      .toHaveAttribute("aria-invalid", "true");
    await page.getByLabelText("Razón social").fill("Mi Empresa SRL");
    tocar(boton("Guardar borrador"));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LECTURA));
    expect(pedidos()[1]?.["borradorId"]).toBe(pedidos()[0]?.["borradorId"]);
    expect(pedidos()[1]).toMatchObject({ razonSocial: "Mi Empresa SRL" });
  });
});

describe("el texto de espera", () => {
  it("«Guardar borrador» dice «Guardando…» y «Confirmar» sigue diciendo «Confirmar»", async () => {
    const abierta = puerta<Respuesta<{ version: number }>>();
    guardar.mockReturnValue(abierta.espera);
    await render(formulario());
    tocar(boton("Guardar borrador"));
    const enEspera = boton("Guardando…");
    await expect.element(enEspera).toBeVisible();
    expect(enEspera.element().textContent).toBe("Guardando…");
    expect(boton("Confirmar").element().textContent).toBe("Confirmar");
    await expect.element(boton("Confirmar")).toHaveAttribute("aria-disabled", "true");
    abierta.soltar(GUARDADO(5));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LECTURA));
  });

  it("«Confirmar» dice «Guardando…» y «Guardar borrador» conserva su texto; «Cancelar» no hace nada mientras tanto", async () => {
    const abierta = puerta<Respuesta<{ version: number }>>();
    guardar.mockReturnValue(abierta.espera);
    confirmar.mockResolvedValue(BIEN);
    await render(formulario());
    tocar(boton("Confirmar"));
    await expect.element(boton("Guardando…")).toBeVisible();
    expect(boton("Guardar borrador").element().textContent).toBe("Guardar borrador");
    tocar(boton("Cancelar"));
    expect(router.push).not.toHaveBeenCalled();
    abierta.soltar(GUARDADO(5));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LECTURA));
  });
});

describe("concurrencia (D-68): el borrador es de la empresa, no de la pestaña", () => {
  it("versión desactualizada con borrador: avisa, recarga y el formulario se abre con SU id y SU versión y sus valores", async () => {
    guardar.mockResolvedValueOnce(DESACTUALIZADA).mockResolvedValueOnce(GUARDADO(10));
    const { rerender } = await render(formulario());
    await page.getByLabelText("Razón social").fill("Mi versión");
    tocar(boton("Guardar borrador"));
    await expect
      .element(
        page.getByText(
          "Los datos cambiaron mientras los miraba. Actualice la pantalla e intente de nuevo.",
        ),
      )
      .toBeVisible();
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    // Llega el borrador que ya existía: otro id, otra versión, otros datos.
    await rerender(formulario(OTRO));
    expect((page.getByLabelText("Razón social").element() as HTMLInputElement).value).toBe(
      "Cargado en otra pestaña SA",
    );
    tocar(boton("Guardar borrador"));
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(2));
    expect(pedidos()[1]).toMatchObject({
      borradorId: OTRO.id,
      versionEsperada: 9,
      razonSocial: "Cargado en otra pestaña SA",
    });
    // Usó su propio id (el del borrador de la otra pestaña), no el que tenía antes.
    expect(pedidos()[0]).toMatchObject({ borradorId: BORRADOR.id, versionEsperada: 4 });
  });

  it("empezando de cero y otra pestaña ya creó el borrador (YA_HAY_BORRADOR sale como versión desactualizada): se abre ese", async () => {
    guardar.mockResolvedValueOnce(DESACTUALIZADA).mockResolvedValueOnce(GUARDADO(10));
    const { rerender } = await render(formulario(null));
    await page.getByLabelText("Razón social").fill("Mi Empresa SRL");
    tocar(boton("Guardar borrador"));
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    await rerender(formulario(OTRO));
    tocar(boton("Guardar borrador"));
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(2));
    expect(pedidos()[1]).toMatchObject({ borradorId: OTRO.id, versionEsperada: 9 });
    expect(pedidos()[0]).not.toHaveProperty("versionEsperada");
  });

  it("versión desactualizada al confirmar (alguien cambió el borrador entre el guardado y la confirmación): se recarga y no se confirma otra cosa", async () => {
    guardar.mockResolvedValue(GUARDADO(5));
    confirmar.mockResolvedValue(DESACTUALIZADA);
    await render(formulario());
    tocar(boton("Confirmar"));
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(router.push).not.toHaveBeenCalled();
    expect(confirmar).toHaveBeenCalledTimes(1);
  });
});

describe("el límite de «Verificando…»", () => {
  it("tras el intento y 3 reintentos inciertos seguidos ya no reintenta solo y queda en «Verificando…», bloqueado (límite conocido de `useEnvioConClave`)", async () => {
    guardar.mockRejectedValue(new TypeError("Failed to fetch"));
    await render(formulario());
    tocar(boton("Guardar borrador"));
    await vi.waitFor(() => expect(guardar.mock.calls.length).toBeGreaterThanOrEqual(4), {
      timeout: 12000,
    });
    await expect.element(page.getByRole("status")).toHaveTextContent("Verificando si se registró…");
    await expect.element(boton("Confirmar")).toBeDisabled();
    await new Promise((resolver) => setTimeout(resolver, 2500));
    // El intento y sus 3 reintentos automáticos: ni uno más.
    expect(guardar).toHaveBeenCalledTimes(4);
    expect(router.push).not.toHaveBeenCalled();
  });
});
