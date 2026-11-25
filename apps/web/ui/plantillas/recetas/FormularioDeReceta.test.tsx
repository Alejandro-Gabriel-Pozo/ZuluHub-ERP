import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import {
  errorDeCodigo,
  type ErrorPublico,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeReceta, type ResultadoDeConfirmar } from "./FormularioDeReceta.cliente";
import {
  armarElFormulario,
  type EntradaDelFormulario,
  type FormularioArmado,
} from "./modelo-de-formulario-de-receta";

/**
 * Crear una receta o guardar una versión nueva, en Chromium (maqueta `receta.html`, `vEditar` y confirmar): el paso de editar y el de confirmar, lo que viaja (producto, rinde, pasos y las líneas con su
 * ingrediente, bruto y merma como texto decimal canónico), agregar y quitar ingredientes, «Guardar» apagado hasta que se puede, la confirmación con costo antes, ahora y diferencia, «Volver a editar»
 * que no pierde nada, el error de confirmar y de guardar, el doble toque (un solo envío), el teclado y axe en 390 y 1280 px.
 */
const P1 = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const HARINA = "2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d";
const SAL = "3e2c9d4b-5f60-4b82-9dae-2f3a4b5c6d7e";

const NUEVA: EntradaDelFormulario = {
  producto: null,
  productos: [
    { productoId: P1, nombre: "Pizza" },
    { productoId: "1c0a7b2f-3d4e-4f60-9b8c-0d1e2f3a4b5c", nombre: "Flan" },
  ],
  productoElegido: "",
  ingredientes: [
    { productoId: HARINA, nombre: "Harina", unidadId: "KILOGRAMO" },
    { productoId: SAL, nombre: "Sal", unidadId: "GRAMO" },
  ],
  rinde: "",
  pasos: null,
  lineas: [],
  version: 0,
};
const EDITAR: EntradaDelFormulario = {
  ...NUEVA,
  producto: { id: P1, nombre: "Pizza muzzarella" },
  productos: [],
  rinde: "10.0000",
  pasos: "Hornear.",
  version: 2,
  lineas: [
    {
      ingredienteId: HARINA,
      nombre: "Harina",
      unidadId: "KILOGRAMO",
      bruto: "2.5000",
      merma: "10.0000",
    },
  ],
};

const ok: AccionDeFormulario = () => Promise.resolve({ error: null });
const sinVista: (datos: FormData) => Promise<ResultadoDeConfirmar> = () =>
  Promise.resolve({ error: null, vista: { netos: { [HARINA]: "2.2500" } } });

const formulario = (
  f: FormularioArmado,
  accion: AccionDeFormulario = ok,
  confirmar: (datos: FormData) => Promise<ResultadoDeConfirmar> = sinVista,
) => <FormularioDeReceta formulario={f} accion={accion} confirmar={confirmar} />;

const boton = (nombre: string) => page.getByRole("button", { name: nombre, exact: true });
const campo = (etiqueta: string) => page.getByLabelText(etiqueta, { exact: true });
const enviado = (mock: ReturnType<typeof vi.fn>, llamada = 0, argumento = 1) =>
  Object.fromEntries((mock.mock.calls[llamada]?.[argumento] as FormData).entries());

afterEach(async () => {
  await page.viewport(390, 844);
});

describe("FormularioDeReceta, el paso de editar", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px, para una receta nueva y para una que existe", async () => {
    for (const [ancho, alto] of [
      [390, 2000],
      [1280, 1400],
    ] as const) {
      await page.viewport(ancho, alto);
      for (const entrada of [NUEVA, EDITAR]) {
        const { unmount } = await render(formulario(armarElFormulario(entrada)));
        expect(await violacionesDeAccesibilidad()).toEqual([]);
        legibleYTocable();
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(ancho);
        await unmount();
      }
    }
  });

  it("una receta nueva arranca vacía y con «Guardar» apagado", async () => {
    await render(formulario(armarElFormulario(NUEVA)));
    await expect.element(campo("Producto")).toHaveValue("");
    await expect.element(campo("Rinde")).toHaveValue("");
    await expect.element(boton("Guardar")).toBeDisabled();
  });

  it("al editar no hay selector de producto, y el campo viene cargado", async () => {
    await render(formulario(armarElFormulario(EDITAR)));
    expect(document.body.textContent).not.toContain("Sin elegir · Producto");
    await expect.element(campo("Rinde")).toHaveValue("10");
    await expect.element(campo("Pasos")).toHaveValue("Hornear.");
    await expect.element(campo("Bruto (Kilogramo)")).toHaveValue("2,5");
    await expect.element(campo("Merma (%)")).toHaveValue("10");
    await expect.element(page.getByRole("group", { name: "Harina" })).toBeVisible();
    await expect.element(boton("Guardar")).toBeEnabled();
  });

  it("«Guardar» se enciende recién con producto, rinde, un ingrediente y su bruto; un bruto en cero lo apaga", async () => {
    await render(formulario(armarElFormulario(NUEVA)));
    await userEvent.selectOptions(campo("Producto"), P1);
    await userEvent.fill(campo("Rinde"), "10");
    await expect.element(boton("Guardar")).toBeDisabled();
    await userEvent.selectOptions(campo("Ingredientes"), HARINA);
    await userEvent.click(boton("Agregar"));
    await expect.element(boton("Guardar")).toBeDisabled();
    await userEvent.fill(campo("Bruto (Kilogramo)"), "0");
    await expect.element(boton("Guardar")).toBeDisabled();
    await userEvent.fill(campo("Bruto (Kilogramo)"), "1,5");
    await expect.element(boton("Guardar")).toBeEnabled();
    await userEvent.fill(campo("Rinde"), "0");
    await expect.element(boton("Guardar")).toBeDisabled();
  });

  it("agregar sin elegir no hace nada; un ingrediente agregado deja de ofrecerse; quitar lo devuelve", async () => {
    await render(formulario(armarElFormulario(NUEVA)));
    await expect.element(boton("Agregar")).toBeDisabled();
    await userEvent.selectOptions(campo("Ingredientes"), HARINA);
    await userEvent.click(boton("Agregar"));
    await expect.element(page.getByRole("group", { name: "Harina" })).toBeVisible();
    const opciones = () =>
      page
        .getByLabelText("Ingredientes", { exact: true })
        .getByRole("option")
        .elements()
        .map((e) => e.getAttribute("value"));
    expect(opciones()).toEqual(["", SAL]);
    await userEvent.click(boton("Quitar"));
    expect(page.getByRole("group", { name: "Harina" }).elements()).toHaveLength(0);
    expect(opciones()).toEqual(["", HARINA, SAL]);
  });
});

describe("FormularioDeReceta, la confirmación", () => {
  const completar = async () => {
    await userEvent.selectOptions(campo("Producto"), P1);
    await userEvent.fill(campo("Rinde"), "10");
    await userEvent.fill(campo("Pasos"), "Hornear.");
    await userEvent.selectOptions(campo("Ingredientes"), HARINA);
    await userEvent.click(boton("Agregar"));
    await userEvent.fill(campo("Bruto (Kilogramo)"), "2,5");
    await userEvent.fill(campo("Merma (%)"), "10");
  };

  it("«Guardar» pide la confirmación al servidor con lo escrito, como texto decimal canónico y sin la unidad", async () => {
    const confirmar = vi.fn(sinVista);
    await render(formulario(armarElFormulario(NUEVA), ok, confirmar));
    await completar();
    await userEvent.click(boton("Guardar"));
    await expect.element(boton("Guardar como versión 1")).toBeVisible();
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries((confirmar.mock.calls[0]?.[0] as FormData).entries())).toEqual({
      producto: P1,
      rinde: "10",
      pasos: "Hornear.",
      receta_l0_ingrediente: HARINA,
      receta_l0_bruto: "2.5",
      receta_l0_merma: "10",
    });
  });

  it("muestra la receta final con el neto y, con costos, antes, ahora y diferencia (a 2 decimales); «Volver a editar» no pierde nada", async () => {
    const confirmar = (): Promise<ResultadoDeConfirmar> =>
      Promise.resolve({
        error: null,
        vista: {
          netos: { [HARINA]: "2.2500" },
          costos: { antes: "1000.000000", ahora: "1234.565000", diferencia: "234.565000" },
        },
      });
    await render(formulario(armarElFormulario(EDITAR), ok, confirmar));
    await userEvent.click(boton("Guardar"));
    await expect.element(boton("Guardar como versión 3")).toBeVisible();
    const cuerpo = document.body.textContent ?? "";
    expect(cuerpo).toContain("Rinde10");
    expect(cuerpo).toContain("Costo antes$ 1.000,00");
    expect(cuerpo).toContain("Costo ahora$ 1.234,57");
    expect(cuerpo).toContain("Diferencia$ 234,57");
    expect(cuerpo).toContain("Bruto 2,5 Kilogramo · Merma 10 % · Neto 2,25 Kilogramo");
    expect(cuerpo).toContain("Hornear.");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    await userEvent.click(boton("Volver a editar"));
    await expect.element(campo("Rinde")).toHaveValue("10");
    await expect.element(campo("Bruto (Kilogramo)")).toHaveValue("2,5");
    await expect.element(campo("Merma (%)")).toHaveValue("10");
  });

  it("sin costos (un operador) la confirmación no muestra ningún importe", async () => {
    await render(formulario(armarElFormulario(EDITAR)));
    await userEvent.click(boton("Guardar"));
    await expect.element(boton("Guardar como versión 3")).toBeVisible();
    expect(document.body.textContent).not.toMatch(/\$|Costo/);
  });

  it("«Guardar como versión N» envía lo mismo que se confirmó, una sola vez aunque se toque dos veces", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(
      () =>
        new Promise<{ error: null }>((resolver) => {
          liberar = () => {
            resolver({ error: null });
          };
        }),
    );
    await render(formulario(armarElFormulario(NUEVA), accion));
    await completar();
    await userEvent.click(boton("Guardar"));
    const confirmarVersion = boton("Guardar como versión 1");
    await expect.element(confirmarVersion).toBeVisible();
    tocar(confirmarVersion);
    tocar(confirmarVersion);
    await vi.waitFor(() => {
      expect(accion).toHaveBeenCalledTimes(1);
    });
    expect(enviado(accion as unknown as ReturnType<typeof vi.fn>)).toEqual({
      producto: P1,
      rinde: "10",
      pasos: "Hornear.",
      receta_l0_ingrediente: HARINA,
      receta_l0_bruto: "2.5",
      receta_l0_merma: "10",
    });
    liberar();
  });

  it("un rechazo del servidor al guardar sale como el genérico debajo, sin perder lo escrito", async () => {
    const error: ErrorPublico = errorDeCodigo("RECETA_ACCION_NO_PERMITIDA");
    await render(formulario(armarElFormulario(EDITAR), () => Promise.resolve({ error })));
    await userEvent.click(boton("Guardar"));
    await userEvent.click(boton("Guardar como versión 3"));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    await expect.element(boton("Guardar como versión 3")).toBeVisible();
  });

  it("un error al pedir la confirmación sale debajo y se sigue en el paso de editar", async () => {
    const error = errorDeCodigo("RECETA_ACCION_NO_PERMITIDA");
    await render(formulario(armarElFormulario(EDITAR), ok, () => Promise.resolve({ error })));
    await userEvent.click(boton("Guardar"));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    await expect.element(campo("Rinde")).toHaveValue("10");
    expect(boton("Guardar como versión 3").elements()).toHaveLength(0);
  });

  it("si el servidor no pudo calcular, igual muestra la receta para confirmar (sin neto ni costos)", async () => {
    await render(
      formulario(armarElFormulario(EDITAR), ok, () =>
        Promise.resolve({ error: null, vista: null }),
      ),
    );
    await userEvent.click(boton("Guardar"));
    await expect.element(boton("Guardar como versión 3")).toBeVisible();
    expect(document.body.textContent).toContain("Bruto 2,5 Kilogramo · Merma 10 %");
    expect(document.body.textContent).not.toContain("Neto");
  });
});
