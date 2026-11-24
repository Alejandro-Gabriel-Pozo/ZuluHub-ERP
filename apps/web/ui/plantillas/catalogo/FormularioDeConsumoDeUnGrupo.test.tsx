import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeConsumoDeUnGrupo } from "./FormularioDeConsumoDeUnGrupo.cliente";
import { armarElConsumo, type ConsumoArmado, type ConsumoDeLaPantalla } from "./modelo-de-consumo";

/**
 * «Qué consume» en Chromium (maqueta `productos.html`, función `vConsumo`): las líneas de cada opción, lo que viaja al guardar (insumo, cantidad como texto decimal canónico y la escala), agregar y
 * quitar líneas, el error, el doble toque, sin permiso, sin medida, el teclado y axe en 390 y 1280 px.
 */
const CONSUMO: ConsumoDeLaPantalla = {
  id: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
  nombre: "Milanesa",
  versionDeOpciones: 4,
  grupo: { id: "g1", nombre: "Carne" },
  tieneMedida: true,
  opciones: [
    {
      id: "o1",
      nombre: "Pollo",
      lineas: [{ insumoId: "i1", cantidad: "150.0000", escalaConTamano: true }],
    },
    { id: "o2", nombre: "Carne", lineas: [] },
  ],
  insumos: [
    { id: "i1", nombre: "Pollo crudo", unidad: "g" },
    { id: "i2", nombre: "Pan rallado", unidad: "kg" },
  ],
};
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });
const rechazo =
  (error: ErrorPublico): AccionDeFormulario =>
  () =>
    Promise.resolve({ error });
const formulario = (
  consumo: ConsumoArmado = armarElConsumo(CONSUMO),
  accion: AccionDeFormulario = ok,
  puedeGuardar = true,
) => <FormularioDeConsumoDeUnGrupo consumo={consumo} accion={accion} puedeGuardar={puedeGuardar} />;
const guardar = () => page.getByRole("button", { name: "Guardar" });
const enviado = (accion: ReturnType<typeof vi.fn>) =>
  Object.fromEntries((accion.mock.calls[0]?.[1] as FormData).entries());

afterEach(async () => {
  await page.viewport(390, 844);
});

describe("FormularioDeConsumoDeUnGrupo", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px, con y sin medida", async () => {
    for (const [ancho, alto] of [
      [390, 1600],
      [1280, 1000],
    ] as const) {
      await page.viewport(ancho, alto);
      for (const c of [CONSUMO, { ...CONSUMO, tieneMedida: false }]) {
        const { unmount } = await render(formulario(armarElConsumo(c)));
        expect(await violacionesDeAccesibilidad()).toEqual([]);
        legibleYTocable();
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(ancho);
        await unmount();
      }
    }
  });

  it("el título, una tarjeta por opción y la línea guardada: insumo elegido, cantidad con la unidad del insumo y la escala marcada", async () => {
    await render(formulario());
    await expect.element(page.getByRole("heading", { name: "Qué consume · Carne" })).toBeVisible();
    expect(
      page
        .getByRole("region")
        .elements()
        .map((e) => e.getAttribute("aria-label")),
    ).toEqual(["Pollo", "Carne"]);
    await expect.element(page.getByLabelText("Insumo", { exact: true })).toHaveValue("i1");
    await expect.element(page.getByLabelText("Cantidad (g)", { exact: true })).toHaveValue("150");
    await expect
      .element(page.getByRole("checkbox", { name: "Escala con la medida" }))
      .toBeChecked();
  });

  it("la unidad del rótulo sigue al insumo elegido", async () => {
    await render(formulario());
    await userEvent.selectOptions(page.getByLabelText("Insumo", { exact: true }), "i2");
    await expect.element(page.getByLabelText("Cantidad (kg)", { exact: true })).toBeVisible();
  });

  it("al guardar manda el insumo, la cantidad como texto decimal canónico y la escala por el nombre de cada línea", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarElConsumo(CONSUMO), accion));
    await userEvent.fill(page.getByLabelText("Cantidad (g)", { exact: true }), "175,5");
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(enviado(accion)).toEqual({
      consumo_0_l0_insumo: "i1",
      consumo_0_l0_cantidad: "175.5",
      consumo_0_l0_escala: "on",
    });
  });

  it("«Agregar insumo» suma una línea en SU opción con el primer insumo y cantidad vacía; «Quitar» la saca del envío; las claves no se repiten", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarElConsumo(CONSUMO), accion));
    await userEvent.click(page.getByRole("button", { name: "Agregar insumo" }).nth(1));
    await userEvent.click(page.getByRole("button", { name: "Agregar insumo" }).nth(1));
    expect(page.getByLabelText("Insumo", { exact: true }).elements()).toHaveLength(3);
    await userEvent.fill(page.getByLabelText("Cantidad (g)", { exact: true }).nth(1), "2");
    await userEvent.click(page.getByRole("button", { name: "Quitar" }).nth(2));
    await userEvent.click(page.getByRole("button", { name: "Quitar" }).first());
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(enviado(accion)).toEqual({
      consumo_1_l1_insumo: "i1",
      consumo_1_l1_cantidad: "2",
    });
  });

  it("sin medida no hay casilla de escala y no viaja", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarElConsumo({ ...CONSUMO, tieneMedida: false }), accion));
    expect(page.getByRole("checkbox").elements()).toHaveLength(0);
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(Object.keys(enviado(accion)).some((k) => k.endsWith("_escala"))).toBe(false);
  });

  it("sin insumos que ofrecer «Agregar insumo» sale apagado", async () => {
    await render(
      formulario(
        armarElConsumo({
          ...CONSUMO,
          insumos: [],
          opciones: [{ id: "o", nombre: "Pollo", lineas: [] }],
        }),
      ),
    );
    await expect.element(page.getByRole("button", { name: "Agregar insumo" })).toBeDisabled();
  });

  it("el segundo toque no manda un segundo envío", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(async (_previo: unknown, datos: FormData) => {
      void datos;
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(formulario(armarElConsumo(CONSUMO), accion));
    tocar(guardar());
    await expect.element(guardar()).toHaveAttribute("aria-busy", "true");
    tocar(guardar());
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(guardar()).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("los errores con texto propio y el genérico salen debajo con el patrón común", async () => {
    for (const [codigo, clave, textoVisible] of [
      [
        "CATALOGO_CONSUMO_REPETIDO",
        "catalogo.error.insumo_ya_cargado",
        "Ese insumo ya está cargado",
      ],
      [
        "CATALOGO_CANTIDAD_INVALIDA",
        "catalogo.error.cantidad_mayor_que_cero",
        "La cantidad tiene que ser mayor que cero",
      ],
      [
        "CATALOGO_ACCION_NO_PERMITIDA",
        "catalogo.error.accion_no_permitida",
        "Esta acción no está permitida",
      ],
    ] as const) {
      const { unmount } = await render(
        formulario(armarElConsumo(CONSUMO), rechazo({ codigo, clave, presentacion: "AVISO" })),
      );
      tocar(guardar());
      await expect.element(page.getByText(textoVisible)).toBeVisible();
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      await unmount();
    }
  });

  it("sin permiso, «Guardar» sale apagado y no envía", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarElConsumo(CONSUMO), accion, false));
    await expect.element(guardar()).toBeDisabled();
    tocar(guardar());
    expect(accion).not.toHaveBeenCalled();
  });

  it("el teclado recorre insumo, cantidad, escala y «Quitar» de la línea, y sigue con «Agregar insumo»", async () => {
    await render(formulario());
    const visto: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      await userEvent.tab();
      const activo = document.activeElement as HTMLInputElement | null;
      visto.push(
        activo?.tagName === "SELECT"
          ? "SELECT"
          : activo?.type === "checkbox"
            ? "casilla"
            : ((activo?.textContent || activo?.tagName) ?? ""),
      );
    }
    expect(visto).toEqual(
      expect.arrayContaining(["SELECT", "INPUT", "casilla", "Quitar", "Agregar insumo"]),
    );
    expect(visto.indexOf("SELECT")).toBeLessThan(visto.indexOf("INPUT"));
    expect(visto.indexOf("INPUT")).toBeLessThan(visto.indexOf("casilla"));
    expect(visto.indexOf("casilla")).toBeLessThan(visto.indexOf("Quitar"));
    expect(visto.indexOf("Quitar")).toBeLessThan(visto.indexOf("Agregar insumo"));
  });
});
