import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeAltaDeProducto } from "./FormularioDeAltaDeProducto.cliente";
import {
  armarElAlta,
  type AltaArmada,
  type OpcionesDelAltaDeLaPantalla,
} from "./modelo-de-alta-de-producto";

/**
 * El alta de un producto en Chromium (maqueta `productos.html`, «Nuevo producto»): los campos y su orden, los valores de partida, lo que viaja al guardar, lo que aparece y desaparece
 * según la clase, el error asociado al campo (o debajo, si no apunta a uno), el doble toque, sin permiso, el teclado y axe, tamaños y sin desborde en 390 y 1280 px.
 */
const OPCIONES: OpcionesDelAltaDeLaPantalla = {
  clases: [
    { valor: "MATERIA_PRIMA", seVende: false },
    { valor: "INSUMO", seVende: false },
    { valor: "REVENTA", seVende: true },
    { valor: "ELABORADO", seVende: false },
    { valor: "VENDIBLE", seVende: true },
  ],
  unidades: ["UNIDAD", "GRAMO", "KILOGRAMO"],
  alicuotas: ["21", "10.5", "27", "5", "2.5", "0"],
  secciones: [
    { id: "s-1", nombre: "Minutas" },
    { id: "s-2", nombre: "Bebidas" },
  ],
};
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });

afterEach(async () => {
  await page.viewport(390, 844);
});

const formulario = (
  alta: AltaArmada = armarElAlta(OPCIONES),
  accion: AccionDeFormulario = ok,
  puedeCrear = true,
) => <FormularioDeAltaDeProducto alta={alta} accion={accion} puedeCrear={puedeCrear} />;
const rechazo =
  (error: ErrorPublico): AccionDeFormulario =>
  () =>
    Promise.resolve({ error });
const campo = (etiqueta: string) => page.getByLabelText(etiqueta, { exact: true });
const guardar = () => page.getByRole("button", { name: "Guardar" });

describe("FormularioDeAltaDeProducto", () => {
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

  it("abre con los valores de la maqueta: producto vendible, unidad, y todo lo demás vacío (la alícuota sin elegir)", async () => {
    await render(formulario());
    await expect.element(campo("¿Qué es?")).toHaveValue("VENDIBLE");
    await expect.element(campo("Unidad")).toHaveValue("UNIDAD");
    await expect.element(campo("Nombre")).toHaveValue("");
    await expect.element(campo("Nombre de cocina")).toHaveValue("");
    await expect.element(campo("Código interno")).toHaveValue("");
    await expect.element(campo("Código de barras")).toHaveValue("");
    await expect.element(campo("Alícuota de IVA")).toHaveValue("");
    await expect.element(campo("Sección de la carta")).toHaveValue("");
  });

  it("la clase ofrece las cinco, sin «Sin elegir»; la alícuota, «Sin elegir» y las seis", async () => {
    await render(formulario());
    const textos = (etiqueta: string) =>
      [...(campo(etiqueta).elements()[0]?.querySelectorAll("option") ?? [])].map(
        (o) => o.textContent,
      );
    expect(textos("¿Qué es?")).toEqual([
      "Materia prima",
      "Insumo",
      "Reventa",
      "Elaborado",
      "Producto vendible",
    ]);
    expect(textos("Alícuota de IVA")).toEqual([
      "Sin elegir",
      "21 %",
      "10,5 %",
      "27 %",
      "5 %",
      "2,5 %",
      "0 %",
    ]);
    expect(textos("Unidad")).toEqual(["UNIDAD", "GRAMO", "KILOGRAMO"]);
  });

  it("no hay «Se controla el stock» ni ningún campo de más: cada campo es uno de los declarados", async () => {
    await render(formulario());
    const nombres = [...document.querySelectorAll("input, select, textarea")].map((e) =>
      e.getAttribute("name"),
    );
    expect(nombres).toEqual([
      "claseDeUso",
      "nombre",
      "nombreDeCocina",
      "codigo",
      "codigoDeBarras",
      "unidadBaseId",
      "alicuota",
      "seccionDeCartaId",
    ]);
    expect(document.querySelector("input[type=checkbox]")).toBeNull();
  });

  it("el teclado recorre los campos en el orden de la maqueta y llega a «Guardar»", async () => {
    await render(formulario());
    campo("¿Qué es?").element().focus();
    const recorrido: string[] = [];
    for (let i = 0; i < 7; i++) {
      await userEvent.tab();
      recorrido.push(
        document.activeElement?.getAttribute("name") ?? document.activeElement?.textContent ?? "?",
      );
    }
    expect(recorrido).toEqual([
      "nombre",
      "nombreDeCocina",
      "codigo",
      "codigoDeBarras",
      "unidadBaseId",
      "alicuota",
      "seccionDeCartaId",
    ]);
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe("Guardar");
  });

  it("al guardar manda los campos por su nombre, con lo escrito y elegido", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarElAlta(OPCIONES), accion));
    await userEvent.fill(campo("Nombre"), "Milanesa");
    await userEvent.fill(campo("Nombre de cocina"), "MILA");
    await userEvent.fill(campo("Código interno"), "MIL-1");
    await userEvent.fill(campo("Código de barras"), "12345678");
    await userEvent.selectOptions(campo("Unidad"), "KILOGRAMO");
    await userEvent.selectOptions(campo("Alícuota de IVA"), "10.5");
    await userEvent.selectOptions(campo("Sección de la carta"), "s-2");
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(datos.entries())).toEqual({
      claseDeUso: "VENDIBLE",
      nombre: "Milanesa",
      nombreDeCocina: "MILA",
      codigo: "MIL-1",
      codigoDeBarras: "12345678",
      unidadBaseId: "KILOGRAMO",
      alicuota: "10.5",
      seccionDeCartaId: "s-2",
    });
  });

  it("una clase que no se vende oculta nombre de cocina, alícuota y sección, y no los manda; al volver a una que se vende reaparecen", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarElAlta(OPCIONES), accion));
    await userEvent.fill(campo("Nombre de cocina"), "MILA");
    await userEvent.selectOptions(campo("Alícuota de IVA"), "21");
    await userEvent.selectOptions(campo("¿Qué es?"), "INSUMO");
    expect(
      document.querySelector("[name=nombreDeCocina], [name=alicuota], [name=seccionDeCartaId]"),
    ).toBeNull();
    await userEvent.fill(campo("Nombre"), "Servilletas");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(datos.entries())).toEqual({
      claseDeUso: "INSUMO",
      nombre: "Servilletas",
      codigo: "",
      codigoDeBarras: "",
      unidadBaseId: "UNIDAD",
    });
    await userEvent.selectOptions(campo("¿Qué es?"), "REVENTA");
    await expect.element(campo("Alícuota de IVA")).toBeVisible();
    await expect.element(campo("Nombre de cocina")).toHaveValue("MILA");
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
    await render(formulario(armarElAlta(OPCIONES), accion));
    tocar(guardar());
    await expect.element(guardar()).toHaveAttribute("aria-busy", "true");
    tocar(guardar());
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(guardar()).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("un error que apunta a un campo se asocia a él (aria-invalid y aria-describedby), no se repite debajo y lo escrito se conserva", async () => {
    await render(
      formulario(
        armarElAlta(OPCIONES),
        rechazo({
          codigo: "CATALOGO_NOMBRE_REPETIDO",
          clave: "catalogo.error.nombre_repetido",
          presentacion: "AVISO",
          campo: "nombre",
        }),
      ),
    );
    await userEvent.fill(campo("Nombre"), "Milanesa");
    tocar(guardar());
    await expect.element(page.getByText("Ya existe un producto con ese nombre")).toBeVisible();
    expect(document.body.textContent?.match(/Ya existe un producto con ese nombre/g)).toHaveLength(
      1,
    );
    const entrada = campo("Nombre").element();
    expect(entrada.getAttribute("aria-invalid")).toBe("true");
    const descrito = entrada.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(descrito)?.textContent).toContain(
      "Ya existe un producto con ese nombre",
    );
    await expect.element(campo("Nombre")).toHaveValue("Milanesa");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it.each([
    [
      "CATALOGO_FALTA_EL_NOMBRE",
      "catalogo.error.falta_el_nombre",
      "nombre",
      "Nombre",
      "Falta el nombre",
    ],
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
          armarElAlta(OPCIONES),
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
        armarElAlta(OPCIONES),
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

  it("el motivo del guard sale debajo como «por qué no puedo»", async () => {
    await render(
      formulario(
        armarElAlta(OPCIONES),
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
    await render(formulario(armarElAlta(OPCIONES), accion, false));
    await expect.element(guardar()).toBeDisabled();
    tocar(guardar());
    expect(accion).not.toHaveBeenCalled();
  });
});
