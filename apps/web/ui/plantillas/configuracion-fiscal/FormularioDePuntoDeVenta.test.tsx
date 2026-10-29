import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import {
  restaurarConexion,
  simularConexion,
  tocar,
  verificarFoco,
  violacionesDeAccesibilidad,
} from "../../pruebas/ayudas";
import { enArmazon, legibleYTocable, ventana } from "./ayudas-de-pruebas";
import { FormularioDePuntoDeVenta } from "./FormularioDePuntoDeVenta.cliente";
import type { PuntoParaConfigurar } from "./modelo-de-puntos-de-venta";

/**
 * El formulario de alta y edición de un punto de venta en Chromium. Lo que se verifica: la idempotencia (el `id` del punto de venta y
 * el del domicilio se generan una vez y se fijan con los valores en el primer envío; doble toque = un solo alta; un reintento
 * reenvía lo mismo; un INESPERADO devuelto como valor no borra lo fijado), el control de versión de la edición, los errores marcados
 * en su campo (asociados por `aria-describedby`, con el foco en el primero) y la accesibilidad en celular y escritorio. La acción del
 * servidor va simulada.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const guardar = vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>();

const BIEN: Respuesta<unknown> = { ok: true, dato: { puntoDeVentaId: "x", version: 1 } };
const conCampo = (
  codigo: Parameters<typeof errorDeCodigo>[0],
  campo: string,
): Respuesta<unknown> => ({ ok: false, error: { ...errorDeCodigo(codigo), campo } });
const INESPERADO: Respuesta<unknown> = {
  ok: false,
  error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABCD-0123" },
};

const SUCURSALES = [
  { valor: "s-norte", etiqueta: "Sucursal Norte" },
  { valor: "s-centro", etiqueta: "Casa central" },
];
const EMISOR = "2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d";
const LISTA = "/configuracion-fiscal/puntos-de-venta";

const ORIGINAL: PuntoParaConfigurar = {
  id: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
  numero: 2,
  activo: true,
  ambiente: "HOMOLOGACION",
  sucursal: { id: "s-norte", nombre: "Sucursal Norte", activa: true },
  tieneDomicilio: true,
  hayNumerosUsados: false,
  version: 7,
};

const formulario = (original: PuntoParaConfigurar | null = null) => (
  <FormularioDePuntoDeVenta
    emisorId={EMISOR}
    original={original}
    sucursales={SUCURSALES}
    guardar={guardar}
    rutaAlTerminar={LISTA}
    rutaAlCancelar={LISTA}
  />
);

beforeEach(() => {
  guardar.mockReset();
  router.push.mockReset();
  router.refresh.mockReset();
});
afterEach(async () => {
  restaurarConexion();
  await page.viewport(390, 844);
});

async function completar(numero = "4") {
  await page.getByLabelText("Número de punto de venta").fill(numero);
  await page.getByLabelText("Sucursal").selectOptions("s-centro");
  await page.getByLabelText("Calle").fill("Av. Rivadavia");
  await page.getByLabelText("Número", { exact: true }).fill("1234");
  await page.getByLabelText("Localidad").fill("Ciudad de Buenos Aires");
  await page.getByLabelText("Provincia").selectOptions("AR-C");
  await page.getByLabelText("Código postal").fill("1000");
}
const guardarBoton = () => page.getByRole("button", { name: "Guardar" });
const pedidos = () => guardar.mock.calls.map(([pedido]) => pedido as Record<string, unknown>);
/** Una respuesta que el test suelta cuando quiere: sostiene un envío en vuelo. */
function puerta() {
  let soltar: (r: Respuesta<unknown>) => void = () => undefined;
  const espera = new Promise<Respuesta<unknown>>((resolve) => {
    soltar = resolve;
  });
  return { espera, soltar };
}

describe("alta de un punto de venta: accesibilidad y medidas", () => {
  it.each([390, 1280])(
    "a %i px: sin violaciones como página, legible y tocable, sin desborde lateral",
    async (ancho) => {
      await ventana(ancho);
      await render(enArmazon("Agregar punto de venta", formulario()));
      expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
      legibleYTocable();
    },
  );

  it("cada campo tiene su etiqueta, el domicilio es un grupo con su leyenda y las provincias son las 24 por nombre", async () => {
    await render(formulario());
    for (const etiqueta of [
      "Número de punto de venta",
      "Sucursal",
      "Calle",
      "Piso",
      "Departamento",
      "Localidad",
      "Provincia",
      "Código postal",
    ]) {
      await expect.element(page.getByLabelText(etiqueta, { exact: true })).toBeVisible();
    }
    await expect
      .element(page.getByRole("group", { name: "Domicilio del punto de venta" }))
      .toBeVisible();
    const provincias = (page.getByLabelText("Provincia").element() as HTMLSelectElement).options;
    // La opción vacía y las 24 jurisdicciones; se ve el nombre y se manda el código.
    expect(provincias).toHaveLength(25);
    expect(provincias[provincias.length - 1]?.textContent).toBe("Tucumán");
    expect(provincias[provincias.length - 1]?.value).toBe("AR-T");
  });

  it("con teclado: Tab recorre los campos en orden con el foco visible y Enter guarda", async () => {
    guardar.mockResolvedValue(BIEN);
    await render(formulario());
    await verificarFoco(page.getByLabelText("Número de punto de venta").element() as HTMLElement);
    await userEvent.keyboard("7");
    await userEvent.tab();
    expect(document.activeElement).toBe(page.getByLabelText("Sucursal").element());
    await userEvent.tab();
    expect(document.activeElement).toBe(page.getByLabelText("Calle").element());
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(1));
  });
});

describe("alta: idempotencia del intento", () => {
  it("doble toque: un solo alta, con el id del punto de venta y el del domicilio", async () => {
    const abierta = puerta();
    guardar.mockReturnValue(abierta.espera);
    await render(formulario());
    await completar();
    tocar(guardarBoton());
    tocar(guardarBoton());
    tocar(guardarBoton());
    abierta.soltar(BIEN);
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    expect(guardar).toHaveBeenCalledTimes(1);
    expect(pedidos()[0]).toMatchObject({
      emisorId: EMISOR,
      sucursalId: "s-centro",
      numero: "4",
      domicilio: {
        tipo: "NUEVO",
        calle: "Av. Rivadavia",
        numero: "1234",
        localidad: "Ciudad de Buenos Aires",
        provincia: "AR-C",
        codigoPostal: "1000",
      },
    });
    const pedido = pedidos()[0] as { id: string; domicilio: { id: string } };
    expect(pedido.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(pedido.domicilio.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(pedido.id).not.toBe(pedido.domicilio.id);
  });

  it("la red se corta y vuelve: el reintento reenvía el MISMO id y los MISMOS valores, y el formulario queda bloqueado", async () => {
    const segunda = puerta();
    guardar
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockReturnValueOnce(segunda.espera);
    await render(formulario());
    await completar();
    tocar(guardarBoton());
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect.element(page.getByRole("status")).toHaveTextContent("Verificando si se registró…");
    await expect.element(page.getByLabelText("Número de punto de venta")).toBeDisabled();
    await expect.element(page.getByLabelText("Calle")).toBeDisabled();
    segunda.soltar(BIEN);
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    expect(guardar).toHaveBeenCalledTimes(2);
    expect(pedidos()[1]).toEqual(pedidos()[0]);
  });

  it("un INESPERADO devuelto como valor no es definitivo: queda incierto (con la referencia) y reintenta lo MISMO sin borrar lo fijado", async () => {
    const segunda = puerta();
    guardar.mockResolvedValueOnce(INESPERADO).mockReturnValueOnce(segunda.espera);
    await render(formulario());
    await completar();
    tocar(guardarBoton());
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await expect.element(page.getByText("PD-ABCD-0123", { exact: false })).toBeVisible();
    await expect.element(page.getByLabelText("Número de punto de venta")).toBeDisabled();
    // Los valores siguen donde estaban.
    expect((page.getByLabelText("Calle").element() as HTMLInputElement).value).toBe(
      "Av. Rivadavia",
    );
    segunda.soltar(BIEN);
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    expect(guardar).toHaveBeenCalledTimes(2);
    expect(pedidos()[1]).toEqual(pedidos()[0]);
  });

  it("sin conexión no se fija ni se envía nada: el botón dice por qué y, al volver, se envía lo que está escrito", async () => {
    guardar.mockResolvedValue(BIEN);
    await render(formulario());
    await completar();
    simularConexion(false);
    await expect.element(guardarBoton()).toBeDisabled();
    expect(guardar).not.toHaveBeenCalled();
    await expect.element(page.getByLabelText("Calle")).toBeEnabled();
    simularConexion(true);
    await expect.element(guardarBoton()).toBeEnabled();
    tocar(guardarBoton());
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(1));
  });

  it("tras un rechazo definitivo, corregir y reenviar usa los mismos ids con los valores nuevos", async () => {
    guardar
      .mockResolvedValueOnce(conCampo("FISCAL_PUNTO_DE_VENTA_DUPLICADO", "numero"))
      .mockResolvedValueOnce(BIEN);
    await render(formulario());
    await completar("1");
    tocar(guardarBoton());
    await expect
      .element(page.getByText("Ya existe un punto de venta con ese número."))
      .toBeVisible();
    await page.getByLabelText("Número de punto de venta").fill("9");
    tocar(guardarBoton());
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    const [primero, segundo] = pedidos() as { id: string; numero: string }[];
    expect(segundo).toMatchObject({ id: primero?.id, numero: "9" });
  });
});

describe("errores marcados en su campo", () => {
  it("«Ya existe un punto de venta con ese número.» marca el número, queda asociado por aria-describedby y recibe el foco", async () => {
    guardar.mockResolvedValue(conCampo("FISCAL_PUNTO_DE_VENTA_DUPLICADO", "numero"));
    await render(formulario());
    await completar("1");
    tocar(guardarBoton());
    const campo = page.getByLabelText("Número de punto de venta");
    await expect.element(campo).toHaveAttribute("aria-invalid", "true");
    const descripcion = campo.element().getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(descripcion)?.textContent).toBe(
      "Ya existe un punto de venta con ese número.",
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(campo.element()));
    // Un solo error: ningún otro campo queda marcado y no hay aviso repetido arriba.
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(1);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });

  it.each([
    ["domicilio.calle", "Calle"],
    ["domicilio.numero", "Número"],
    ["domicilio.localidad", "Localidad"],
    ["domicilio.provincia", "Provincia"],
    ["domicilio.codigoPostal", "Código postal"],
    ["sucursalId", "Sucursal"],
  ] as const)(
    "«Revisá los datos marcados.» con el campo %s marca «%s»",
    async (campo, etiqueta) => {
      guardar.mockResolvedValue(conCampo("FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo));
      await render(formulario());
      await completar();
      tocar(guardarBoton());
      const marcado = page.getByLabelText(etiqueta, { exact: true });
      await expect.element(marcado).toHaveAttribute("aria-invalid", "true");
      expect(
        document.getElementById(marcado.element().getAttribute("aria-describedby") ?? "")
          ?.textContent,
      ).toBe("Revisá los datos marcados.");
    },
  );

  it("al volver a escribir en un campo marcado, el error se va", async () => {
    guardar.mockResolvedValue(conCampo("FISCAL_PUNTO_DE_VENTA_NUMERO_INMUTABLE", "numero"));
    await render(formulario());
    await completar();
    tocar(guardarBoton());
    await expect
      .element(
        page.getByText(
          "Este punto de venta ya emitió comprobantes: el número no se puede cambiar.",
        ),
      )
      .toBeVisible();
    await page.getByLabelText("Número de punto de venta").fill("5");
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });

  it("un error sin campo (sin permiso) se dice arriba con su texto y sin el código", async () => {
    guardar.mockResolvedValue({ ok: false, error: errorDeCodigo("SIN_PERMISO") });
    await render(formulario());
    await completar();
    tocar(guardarBoton());
    await expect.element(page.getByText("No tiene permiso para hacer esto.")).toBeVisible();
    expect(document.body.textContent).not.toContain("SIN_PERMISO");
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });

  it("«servicio no disponible» también es de presentación inesperada: queda incierto y se reintenta, no se da por rechazado", async () => {
    guardar.mockResolvedValue({ ok: false, error: errorDeCodigo("NO_DISPONIBLE") });
    await render(formulario());
    await completar();
    tocar(guardarBoton());
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(2), { timeout: 5000 });
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("edición", () => {
  it("abre con el número en cinco dígitos y la sucursal; sin cambios manda solo la versión que vio la pantalla", async () => {
    guardar.mockResolvedValue(BIEN);
    await render(formulario(ORIGINAL));
    expect(
      (page.getByLabelText("Número de punto de venta").element() as HTMLInputElement).value,
    ).toBe("00002");
    expect((page.getByLabelText("Sucursal").element() as HTMLSelectElement).value).toBe("s-norte");
    tocar(guardarBoton());
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    expect(pedidos()).toEqual([{ puntoDeVentaId: ORIGINAL.id, versionEsperada: 7 }]);
  });

  it("manda solo lo que cambió, con un domicilio nuevo (con su id) si se escribió", async () => {
    guardar.mockResolvedValue(BIEN);
    await render(formulario(ORIGINAL));
    await page.getByLabelText("Sucursal").selectOptions("s-centro");
    await page.getByLabelText("Calle").fill("Mitre");
    await page.getByLabelText("Número", { exact: true }).fill("55");
    await page.getByLabelText("Localidad").fill("Rosario");
    await page.getByLabelText("Provincia").selectOptions("AR-S");
    tocar(guardarBoton());
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(1));
    expect(pedidos()[0]).toMatchObject({
      puntoDeVentaId: ORIGINAL.id,
      versionEsperada: 7,
      sucursalId: "s-centro",
      domicilio: { tipo: "NUEVO", calle: "Mitre", numero: "55", provincia: "AR-S" },
    });
    expect(pedidos()[0]).not.toHaveProperty("numero");
  });

  it("versión desactualizada: avisa, recarga lo último y el formulario toma los valores nuevos y la versión nueva", async () => {
    guardar
      .mockResolvedValueOnce({ ok: false, error: errorDeCodigo("FISCAL_VERSION_DESACTUALIZADA") })
      .mockResolvedValueOnce(BIEN);
    const { rerender } = await render(formulario(ORIGINAL));
    await page.getByLabelText("Número de punto de venta").fill("00003");
    tocar(guardarBoton());
    await expect
      .element(
        page.getByText(
          "Los datos cambiaron mientras los miraba. Actualice la pantalla e intente de nuevo.",
        ),
      )
      .toBeVisible();
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    // Llega lo último del servidor: otra persona cambió el número a 8 y la versión es 8.
    await rerender(formulario({ ...ORIGINAL, numero: 8, version: 8 }));
    expect(
      (page.getByLabelText("Número de punto de venta").element() as HTMLInputElement).value,
    ).toBe("00008");
    tocar(guardarBoton());
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(2));
    expect(pedidos()[1]).toEqual({ puntoDeVentaId: ORIGINAL.id, versionEsperada: 8 });
  });

  it("«Cancelar» vuelve sin enviar nada", async () => {
    await render(formulario(ORIGINAL));
    tocar(page.getByRole("button", { name: "Cancelar" }));
    expect(router.push).toHaveBeenCalledWith(LISTA);
    expect(guardar).not.toHaveBeenCalled();
  });
});
