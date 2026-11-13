import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeFichaDeProducto } from "./FormularioDeFichaDeProducto.cliente";
import {
  armarLaFicha,
  type FichaArmada,
  type FichaDeLaPantalla,
} from "./modelo-de-ficha-de-producto";

/**
 * La ficha de datos de un producto en Chromium (maqueta `productos.html`, solapa «Datos»): los campos y su orden, lo que viaja al guardar, el desplegable apagado que no se manda,
 * el error asociado al campo (o debajo, si no apunta a uno), el doble toque, sin permiso, el teclado y axe, tamaños y sin desborde en 390 y 1280 px.
 */
const SECCION = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const FICHA: FichaDeLaPantalla = {
  id: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
  version: 4,
  nombre: "Milanesa",
  claseDeUso: "VENDIBLE",
  unidadBaseId: "UNIDAD",
  seVende: true,
  nombreDeCocina: "MILA",
  codigo: "MIL-1",
  codigoDeBarras: "12345678",
  alicuota: "10.5",
  seccionDeCartaId: SECCION,
  alicuotas: ["21", "10.5", "27", "5", "2.5", "0"],
  secciones: [
    { id: SECCION, nombre: "Minutas" },
    { id: "otra", nombre: "Bebidas" },
  ],
};
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });

afterEach(async () => {
  await page.viewport(390, 844);
});

const formulario = (
  ficha: FichaArmada = armarLaFicha(FICHA),
  accion: AccionDeFormulario = ok,
  puedeGuardar = true,
) => <FormularioDeFichaDeProducto ficha={ficha} accion={accion} puedeGuardar={puedeGuardar} />;
const rechazo =
  (error: ErrorPublico): AccionDeFormulario =>
  () =>
    Promise.resolve({ error });
const campo = (etiqueta: string) => page.getByLabelText(etiqueta, { exact: true });
const guardar = () => page.getByRole("button", { name: "Guardar" });

describe("FormularioDeFichaDeProducto", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px", async () => {
    for (const [ancho, alto] of [
      [390, 1600],
      [1280, 1100],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(formulario());
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      await unmount();
    }
  });

  it("trae los datos guardados; la clase y la unidad se ven pero no son campos", async () => {
    await render(formulario());
    await expect.element(campo("Nombre")).toHaveValue("Milanesa");
    await expect.element(campo("Nombre de cocina")).toHaveValue("MILA");
    await expect.element(campo("Código interno")).toHaveValue("MIL-1");
    await expect.element(campo("Código de barras")).toHaveValue("12345678");
    await expect.element(campo("Alícuota de IVA")).toHaveValue("10.5");
    await expect.element(campo("Sección de la carta")).toHaveValue(SECCION);
    await expect.element(page.getByText("Producto vendible")).toBeVisible();
    await expect.element(page.getByText("UNIDAD")).toBeVisible();
    expect(document.querySelector("[name=clase], [name=unidad]")).toBeNull();
  });

  it("la alícuota ofrece «Sin elegir» y las seis, sin «Exento» ni «No gravado»", async () => {
    await render(formulario());
    const opciones = campo("Alícuota de IVA").elements()[0]?.querySelectorAll("option");
    expect([...(opciones ?? [])].map((o) => o.textContent)).toEqual([
      "Sin elegir",
      "21 %",
      "10,5 %",
      "27 %",
      "5 %",
      "2,5 %",
      "0 %",
    ]);
  });

  it("el teclado recorre los campos en el orden de la maqueta y llega a «Guardar»", async () => {
    await render(formulario());
    await userEvent.click(campo("Nombre"));
    const recorrido: string[] = [];
    for (let i = 0; i < 6; i++) {
      await userEvent.tab();
      recorrido.push(
        document.activeElement?.getAttribute("name") ?? document.activeElement?.textContent ?? "?",
      );
    }
    expect(recorrido).toEqual([
      "nombreDeCocina",
      "codigo",
      "codigoDeBarras",
      "alicuota",
      "seccionDeCartaId",
      "Guardar",
    ]);
  });

  it("al guardar manda los seis campos por su nombre, con lo editado", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarLaFicha(FICHA), accion));
    await userEvent.fill(campo("Nombre"), "Milanesa napolitana");
    await userEvent.fill(campo("Código de barras"), "87654321");
    await userEvent.selectOptions(campo("Alícuota de IVA"), "21");
    await userEvent.selectOptions(campo("Sección de la carta"), "otra");
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(datos.entries())).toEqual({
      nombre: "Milanesa napolitana",
      nombreDeCocina: "MILA",
      codigo: "MIL-1",
      codigoDeBarras: "87654321",
      alicuota: "21",
      seccionDeCartaId: "otra",
    });
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
    await render(formulario(armarLaFicha(FICHA), accion));
    tocar(guardar());
    await expect.element(guardar()).toHaveAttribute("aria-busy", "true");
    tocar(guardar());
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(guardar()).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("un producto que no se vende no ofrece nombre de cocina, alícuota ni sección", async () => {
    await render(
      formulario(
        armarLaFicha({
          ...FICHA,
          claseDeUso: "INSUMO",
          seVende: false,
          nombreDeCocina: null,
          alicuota: null,
          seccionDeCartaId: null,
        }),
      ),
    );
    await expect.element(campo("Nombre")).toBeVisible();
    await expect.element(campo("Código de barras")).toBeVisible();
    expect(document.querySelector("[name=nombreDeCocina], [name=alicuota], select")).toBeNull();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("una alícuota guardada que no se ofrece sale apagada, a la vista, y no viaja (el servidor la conserva)", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarLaFicha({ ...FICHA, alicuota: "EXENTO" }), accion));
    await expect.element(campo("Alícuota de IVA")).toBeDisabled();
    await expect.element(campo("Alícuota de IVA")).toHaveValue("EXENTO");
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(datos.has("alicuota")).toBe(false);
    expect(datos.has("seccionDeCartaId")).toBe(true);
  });

  it("un error que apunta a un campo se asocia a él (aria-invalid y aria-describedby) y no se repite debajo", async () => {
    await render(
      formulario(
        armarLaFicha(FICHA),
        rechazo({
          codigo: "CATALOGO_NOMBRE_REPETIDO",
          clave: "catalogo.error.nombre_repetido",
          presentacion: "AVISO",
          campo: "nombre",
        }),
      ),
    );
    tocar(guardar());
    const mensaje = page.getByText("Ya existe un producto con ese nombre");
    await expect.element(mensaje).toBeVisible();
    expect(document.body.textContent?.match(/Ya existe un producto con ese nombre/g)).toHaveLength(
      1,
    );
    const entrada = campo("Nombre").element();
    expect(entrada.getAttribute("aria-invalid")).toBe("true");
    const descrito = entrada.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(descrito)?.textContent).toContain(
      "Ya existe un producto con ese nombre",
    );
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it.each([
    [
      "CATALOGO_CODIGO_REPETIDO",
      "catalogo.error.codigo_repetido",
      "codigo",
      "Código interno",
      "Ya existe un producto con ese código",
    ],
    [
      "CATALOGO_CODIGO_DE_BARRAS_INVALIDO",
      "catalogo.error.codigo_de_barras_invalido",
      "codigoDeBarras",
      "Código de barras",
      "El código de barras debe tener de 8 a 14 dígitos",
    ],
    [
      "CATALOGO_ELEGI_LA_ALICUOTA",
      "catalogo.error.elegi_la_alicuota",
      "alicuota",
      "Alícuota de IVA",
      "Elegí la alícuota",
    ],
  ] as const)(
    "%s se asocia al campo «%s»",
    async (codigo, clave, campoDelError, etiqueta, mensaje) => {
      await render(
        formulario(
          armarLaFicha(FICHA),
          rechazo({ codigo, clave, presentacion: "AVISO", campo: campoDelError }),
        ),
      );
      tocar(guardar());
      await expect.element(page.getByText(mensaje)).toBeVisible();
      await expect.element(campo(etiqueta)).toHaveAttribute("aria-invalid", "true");
      expect(await violacionesDeAccesibilidad()).toEqual([]);
    },
  );

  it("un error sin campo (el genérico) sale debajo con el patrón común y ningún campo queda inválido", async () => {
    await render(
      formulario(
        armarLaFicha(FICHA),
        rechazo({
          codigo: "CATALOGO_ACCION_NO_PERMITIDA",
          clave: "catalogo.error.accion_no_permitida",
          presentacion: "AVISO",
        }),
      ),
    );
    tocar(guardar());
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(document.querySelector("[aria-invalid=true]")).toBeNull();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("un error con un campo que la pantalla no muestra con error propio sale debajo (no se pierde)", async () => {
    await render(
      formulario(
        armarLaFicha(FICHA),
        rechazo({
          codigo: "CATALOGO_ACCION_NO_PERMITIDA",
          clave: "catalogo.error.accion_no_permitida",
          presentacion: "AVISO",
          campo: "nombreDeCocina",
        }),
      ),
    );
    tocar(guardar());
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
  });

  it("el motivo del guard sale debajo como «por qué no puedo»", async () => {
    await render(
      formulario(
        armarLaFicha(FICHA),
        rechazo({
          codigo: "SIN_PERMISO",
          clave: "motivo.sin_permiso",
          presentacion: "POR_QUE_NO_PUEDO",
        }),
      ),
    );
    tocar(guardar());
    await expect.element(page.getByText("No tenés permiso para hacer esto.")).toBeVisible();
  });

  it("sin permiso, «Guardar» sale apagado y no envía", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarLaFicha(FICHA), accion, false));
    await expect.element(guardar()).toBeDisabled();
    tocar(guardar());
    expect(accion).not.toHaveBeenCalled();
  });
});
