import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeGrupoDeOpciones } from "./FormularioDeGrupoDeOpciones.cliente";
import {
  armarElGrupo,
  type GrupoArmado,
  type GrupoParaEditarDeLaPantalla,
} from "./modelo-de-opciones";

/**
 * Un grupo de opciones en Chromium (maqueta `productos.html`, función `vGrupo`): los campos de un grupo nuevo y de uno guardado, lo que viaja al guardar (nombres, casillas y filas con el
 * recargo como texto decimal canónico), agregar y quitar opciones, el error asociado al campo de su fila, el doble toque, sin permiso, el teclado y axe, en 390 y 1280 px.
 */
const GUARDADO: GrupoParaEditarDeLaPantalla = {
  id: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
  nombre: "Milanesa",
  versionDeOpciones: 4,
  claveDelCambio: "clave",
  grupo: {
    id: "g1",
    nombre: "Salsas",
    clase: "ADICIONAL",
    esObligatorio: true,
    admiteVarias: true,
    seMuestraEnCarta: false,
    opciones: [
      { id: "o1", nombre: "Mayonesa", recargo: "500.000000" },
      { id: "o2", nombre: "Ketchup", recargo: "0.000000" },
    ],
  },
};
const NUEVO: GrupoParaEditarDeLaPantalla = { ...GUARDADO, grupo: null };
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });
const rechazo =
  (error: ErrorPublico): AccionDeFormulario =>
  () =>
    Promise.resolve({ error });
const formulario = (
  grupo: GrupoArmado = armarElGrupo(GUARDADO),
  accion: AccionDeFormulario = ok,
  puedeGuardar = true,
) => <FormularioDeGrupoDeOpciones grupo={grupo} accion={accion} puedeGuardar={puedeGuardar} />;
const guardar = () => page.getByRole("button", { name: "Guardar" });
const enviado = (accion: ReturnType<typeof vi.fn>, llamada = 0) =>
  [...(accion.mock.calls[llamada]?.[1] as FormData).entries()] as [string, string][];

afterEach(async () => {
  await page.viewport(390, 844);
});

describe("FormularioDeGrupoDeOpciones", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px, con un grupo guardado y con uno nuevo", async () => {
    for (const [ancho, alto] of [
      [390, 1600],
      [1280, 1000],
    ] as const) {
      await page.viewport(ancho, alto);
      for (const g of [GUARDADO, NUEVO]) {
        const { unmount } = await render(formulario(armarElGrupo(g)));
        expect(await violacionesDeAccesibilidad()).toEqual([]);
        legibleYTocable();
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(ancho);
        await unmount();
      }
    }
  });

  it("un grupo guardado: el título «Editar», el nombre, la clase para leer, las reglas marcadas y una fila por opción", async () => {
    await render(formulario());
    await expect.element(page.getByRole("heading", { name: "Editar" })).toBeVisible();
    await expect
      .element(page.getByLabelText("Nombre", { exact: true }).first())
      .toHaveValue("Salsas");
    await expect.element(page.getByText("Adicional")).toBeVisible();
    expect(page.getByRole("checkbox", { name: "Adicional" }).elements()).toHaveLength(0);
    await expect.element(page.getByRole("checkbox", { name: "Obligatorio" })).toBeChecked();
    await expect
      .element(page.getByRole("checkbox", { name: "Se puede elegir más de una" }))
      .toBeChecked();
    await expect
      .element(page.getByRole("checkbox", { name: "No figura en la carta" }))
      .toBeChecked();
    const nombres = page.getByLabelText("Nombre", { exact: true });
    expect(nombres.elements().map((e) => (e as HTMLInputElement).value)).toEqual([
      "Salsas",
      "Mayonesa",
      "Ketchup",
    ]);
    const recargos = page.getByLabelText("Recargo", { exact: true });
    expect(recargos.elements().map((e) => (e as HTMLInputElement).value)).toEqual([
      "500,00",
      "0,00",
    ]);
  });

  it("un grupo nuevo: «Agregar grupo», la casilla «Adicional» sin marcar y una fila vacía", async () => {
    await render(formulario(armarElGrupo(NUEVO)));
    await expect.element(page.getByRole("heading", { name: "Agregar grupo" })).toBeVisible();
    await expect.element(page.getByRole("checkbox", { name: "Adicional" })).not.toBeChecked();
    expect(page.getByLabelText("Nombre", { exact: true }).elements()).toHaveLength(2);
    expect(page.getByRole("button", { name: "Quitar" }).elements()).toHaveLength(1);
  });

  it("al guardar manda los nombres, las casillas marcadas y cada fila por su clave, con el recargo como texto decimal canónico", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarElGrupo(GUARDADO), accion));
    await userEvent.fill(page.getByLabelText("Nombre", { exact: true }).first(), "Salsas caseras");
    await userEvent.click(page.getByRole("checkbox", { name: "Obligatorio" }));
    await userEvent.fill(page.getByLabelText("Recargo", { exact: true }).first(), "1234,5");
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries(enviado(accion))).toEqual({
      nombre: "Salsas caseras",
      admiteVarias: "on",
      fueraDeLaCarta: "on",
      opcion_e0_nombre: "Mayonesa",
      opcion_e0_recargo: "1234.50",
      opcion_e1_nombre: "Ketchup",
      opcion_e1_recargo: "0.00",
    });
  });

  it("«Agregar opción» suma una fila nueva con su clave y «Quitar» la saca del envío; las demás conservan lo escrito", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarElGrupo(GUARDADO), accion));
    await userEvent.click(page.getByRole("button", { name: "Agregar opción" }));
    await userEvent.click(page.getByRole("button", { name: "Agregar opción" }));
    const nombres = page.getByLabelText("Nombre", { exact: true });
    expect(nombres.elements()).toHaveLength(5);
    await userEvent.fill(nombres.nth(3), "Alioli");
    await userEvent.fill(nombres.nth(4), "Barbacoa");
    // Se quita la primera existente (Mayonesa) y la nueva «Alioli».
    await userEvent.click(page.getByRole("button", { name: "Quitar" }).first());
    await userEvent.click(page.getByRole("button", { name: "Quitar" }).nth(1));
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(enviado(accion).map(([k, v]) => `${k}=${v}`)).toEqual([
      "nombre=Salsas",
      "esObligatorio=on",
      "admiteVarias=on",
      "fueraDeLaCarta=on",
      "opcion_e1_nombre=Ketchup",
      "opcion_e1_recargo=0.00",
      "opcion_n1_nombre=Barbacoa",
      "opcion_n1_recargo=0.00",
    ]);
  });

  it("las filas nuevas no repiten clave aunque se agregue después de quitar", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarElGrupo(NUEVO), accion));
    await userEvent.click(page.getByRole("button", { name: "Agregar opción" }));
    await userEvent.click(page.getByRole("button", { name: "Quitar" }).first());
    await userEvent.click(page.getByRole("button", { name: "Agregar opción" }));
    const nombres = page.getByLabelText("Nombre", { exact: true });
    await userEvent.fill(nombres.nth(1), "Uno");
    await userEvent.fill(nombres.nth(2), "Dos");
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const claves = enviado(accion)
      .map(([k]) => k)
      .filter((k) => k.endsWith("_nombre"));
    expect(new Set(claves).size).toBe(claves.length);
    expect(claves).toEqual(["opcion_n1_nombre", "opcion_n2_nombre"]);
  });

  it("un grupo nuevo manda «Adicional» solo si se marca", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarElGrupo(NUEVO), accion));
    await userEvent.fill(page.getByLabelText("Nombre", { exact: true }).first(), "Extras");
    await userEvent.click(page.getByRole("checkbox", { name: "Adicional" }));
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries(enviado(accion))).toMatchObject({
      nombre: "Extras",
      esAdicional: "on",
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
    await render(formulario(armarElGrupo(GUARDADO), accion));
    tocar(guardar());
    await expect.element(guardar()).toHaveAttribute("aria-busy", "true");
    tocar(guardar());
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(guardar()).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("«Falta el nombre» del grupo se asocia a su campo y no se repite debajo", async () => {
    await render(
      formulario(
        armarElGrupo(GUARDADO),
        rechazo({
          codigo: "CATALOGO_FALTA_EL_NOMBRE",
          clave: "catalogo.error.falta_el_nombre",
          presentacion: "AVISO",
          campo: "nombre",
        }),
      ),
    );
    tocar(guardar());
    await expect.element(page.getByText("Falta el nombre")).toBeVisible();
    expect(document.body.textContent?.match(/Falta el nombre/g)).toHaveLength(1);
    const entrada = page.getByLabelText("Nombre", { exact: true }).first().element();
    expect(entrada.getAttribute("aria-invalid")).toBe("true");
    expect(
      document.getElementById(entrada.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toContain("Falta el nombre");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«Falta el nombre» de una opción se asocia al campo de ESA fila", async () => {
    await render(
      formulario(
        armarElGrupo(GUARDADO),
        rechazo({
          codigo: "CATALOGO_FALTA_EL_NOMBRE",
          clave: "catalogo.error.falta_el_nombre",
          presentacion: "AVISO",
          campo: "opcion_e1_nombre",
        }),
      ),
    );
    tocar(guardar());
    await expect.element(page.getByText("Falta el nombre")).toBeVisible();
    expect(document.body.textContent?.match(/Falta el nombre/g)).toHaveLength(1);
    const nombres = page.getByLabelText("Nombre", { exact: true }).elements();
    expect(nombres.map((e) => e.getAttribute("aria-invalid"))).toEqual([null, null, "true"]);
  });

  it("«Una opción incluida no lleva recargo» y el genérico salen debajo con el patrón común; ningún campo queda inválido", async () => {
    for (const [codigo, clave, texto] of [
      [
        "CATALOGO_INCLUIDA_CON_RECARGO",
        "catalogo.error.incluida_con_recargo",
        "Una opción incluida no lleva recargo",
      ],
      [
        "CATALOGO_ACCION_NO_PERMITIDA",
        "catalogo.error.accion_no_permitida",
        "Esta acción no está permitida",
      ],
    ] as const) {
      const { unmount } = await render(
        formulario(
          armarElGrupo(GUARDADO),
          rechazo({ codigo, clave, presentacion: "AVISO", campo: "recargo" }),
        ),
      );
      tocar(guardar());
      await expect.element(page.getByText(texto)).toBeVisible();
      expect(document.querySelector("[aria-invalid=true]")).toBeNull();
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      await unmount();
    }
  });

  it("el motivo del guard sale debajo como «por qué no puedo»", async () => {
    await render(
      formulario(
        armarElGrupo(GUARDADO),
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
    await render(formulario(armarElGrupo(GUARDADO), accion, false));
    await expect.element(guardar()).toBeDisabled();
    tocar(guardar());
    expect(accion).not.toHaveBeenCalled();
  });

  it("las casillas se marcan tocándolas o tocando su texto, y la fila alcanza el objetivo mínimo de 48 px de alto", async () => {
    await render(formulario(armarElGrupo(NUEVO)));
    const casilla = page.getByRole("checkbox", { name: "Obligatorio" });
    await expect.element(casilla).not.toBeChecked();
    await userEvent.click(page.getByText("Obligatorio"));
    await expect.element(casilla).toBeChecked();
    await userEvent.click(casilla);
    await expect.element(casilla).not.toBeChecked();
    expect(
      page.getByText("Obligatorio").element().parentElement?.getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(48);
  });

  it("el teclado recorre el nombre, las casillas, las filas y llega a «Guardar»", async () => {
    await render(formulario(armarElGrupo(NUEVO)));
    await userEvent.click(page.getByLabelText("Nombre", { exact: true }).first());
    const orden: string[] = [];
    for (let i = 0; i < 9; i += 1) {
      await userEvent.tab();
      const activo = document.activeElement;
      orden.push(
        activo instanceof HTMLInputElement && activo.type === "checkbox"
          ? "casilla"
          : (activo?.textContent ?? activo?.tagName ?? ""),
      );
    }
    expect(orden.at(-1)).toBe("Guardar");
    expect(orden.filter((x) => x === "casilla")).toHaveLength(4);
    // La casilla enfocada muestra el anillo de foco y se marca con la barra espaciadora.
    await userEvent.click(page.getByLabelText("Nombre", { exact: true }).first());
    await userEvent.tab();
    const primera = document.activeElement as HTMLInputElement;
    expect(primera.type).toBe("checkbox");
    expect(getComputedStyle(primera).outlineStyle).toBe("solid");
    await userEvent.keyboard(" ");
    expect(primera.checked).toBe(true);
  });
});
