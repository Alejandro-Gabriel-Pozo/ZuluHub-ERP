import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import {
  FormularioDeParte,
  type PropsDeFormularioDeParte,
  type ResultadoDelFormularioDeParte,
} from "./FormularioDeParte.cliente";
import { armarElFormularioDeParte } from "./modelo-de-formulario-de-parte";

/**
 * El formulario de una persona o empresa en Chromium (maqueta `directorio.html`, «Nuevo» y la ficha): el doble toque (un solo envío), el error de un campo asociado por `aria-describedby`,
 * los posibles duplicados con «Guardar igual», sin permiso «Guardar» apagado, el cambio a «Empresa» (sin apellido y solo CUIT), lo que viaja y axe en 390 y 1280 px.
 */
const TODO = { crear: true, editar: true, desactivar: true, reactivar: true };
const resultado = (extra: Partial<ResultadoDelFormularioDeParte> = {}) =>
  Promise.resolve<ResultadoDelFormularioDeParte>({
    error: null,
    guardada: false,
    duplicados: [],
    ...extra,
  });
type Accion = PropsDeFormularioDeParte["accion"];
const ok: Accion = () => resultado();
const okDeEstado: AccionDeFormulario = () => Promise.resolve({ error: null });

afterEach(async () => {
  await page.viewport(390, 844);
});

const formulario = (accion: Accion = ok, permisos = TODO) => (
  <FormularioDeParte
    formulario={armarElFormularioDeParte(null, permisos)}
    accion={accion}
    accionDeEstado={null}
  />
);
const guardar = () => page.getByRole("button", { name: "Guardar", exact: true });
const nombre = () => page.getByLabelText("Nombre", { exact: true });

describe("FormularioDeParte", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px, como persona y como empresa", async () => {
    for (const [ancho, alto] of [
      [390, 900],
      [1280, 800],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(formulario());
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      await userEvent.selectOptions(page.getByLabelText("Persona / Empresa"), "JURIDICA");
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      await unmount();
    }
  });

  it("al guardar manda lo escrito con los nombres del servidor; la empresa, la clave y los roles inventados no viajan", async () => {
    const accion = vi.fn((_previo: ResultadoDelFormularioDeParte, datos: FormData) => {
      void datos;
      return resultado();
    });
    await render(formulario(accion));
    await userEvent.fill(nombre(), "Marta");
    await userEvent.fill(page.getByLabelText("Apellido (opcional)"), "Gómez");
    await userEvent.selectOptions(page.getByLabelText("Tipo de documento"), "DNI");
    await userEvent.fill(page.getByLabelText("Número (opcional)").first(), "28123456");
    await page.getByLabelText("Proveedor").click();
    await userEvent.fill(page.getByLabelText("Nota (opcional)"), "Paga al contado");
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = Object.fromEntries((accion.mock.calls[0]?.[1] as FormData).entries());
    expect(datos).toMatchObject({
      naturaleza: "HUMANA",
      nombre: "Marta",
      apellido: "Gómez",
      documentoTipo: "DNI",
      documentoNumero: "28.123.456",
      rolProveedor: "on",
      nota: "Paga al contado",
    });
    expect(datos).not.toHaveProperty("rolCliente");
    expect(datos).not.toHaveProperty("roles");
    expect(datos).not.toHaveProperty("idempotencia");
    expect(datos).not.toHaveProperty("empresaId");
    expect(datos).not.toHaveProperty("documentoPais");
  });

  it("DOBLE ENVÍO: el segundo toque no manda un segundo envío", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(async (_previo: ResultadoDelFormularioDeParte, datos: FormData) => {
      void datos;
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null, guardada: false, duplicados: [] };
    });
    await render(formulario(accion));
    await userEvent.fill(nombre(), "Ana");
    tocar(guardar());
    await expect.element(guardar()).toHaveAttribute("aria-busy", "true");
    tocar(guardar());
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(guardar()).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("el error de un campo sale en ese campo, asociado por `aria-describedby`", async () => {
    const error: ErrorPublico = {
      codigo: "CLIENTES_FALTA_EL_NOMBRE",
      clave: "clientes.error.falta_el_nombre",
      presentacion: "AVISO",
      campo: "nombre",
    };
    await render(formulario(() => resultado({ error })));
    tocar(guardar());
    await expect.element(page.getByText("Falta el nombre")).toBeVisible();
    const id = nombre().element().getAttribute("aria-describedby");
    expect(id).not.toBeNull();
    expect(document.getElementById(id ?? "")?.textContent).toContain("Falta el nombre");
    expect(nombre().element().getAttribute("aria-invalid")).toBe("true");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("un error sin campo (el genérico) sale debajo y una sola vez", async () => {
    const error: ErrorPublico = {
      codigo: "CLIENTES_ACCION_NO_PERMITIDA",
      clave: "clientes.error.sin_permiso",
      presentacion: "AVISO",
    };
    await render(formulario(() => resultado({ error })));
    tocar(guardar());
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(document.body.textContent?.split("Esta acción no está permitida").length).toBe(2);
  });

  it("con posibles duplicados se muestran, el botón pasa a «Guardar igual» y el reenvío lo dice", async () => {
    const accion = vi.fn(
      (
        _previo: ResultadoDelFormularioDeParte,
        datos: FormData,
      ): Promise<ResultadoDelFormularioDeParte> => {
        const igual = datos.get("guardarIgual") === "1";
        return resultado(
          igual
            ? {}
            : {
                duplicados: [
                  { parteId: "p1", nombre: "Ana Pérez" },
                  { parteId: "p2", nombre: "Ana Pérez SA" },
                ],
              },
        );
      },
    );
    await render(formulario(accion));
    await userEvent.fill(nombre(), "Ana");
    tocar(guardar());
    await expect.element(page.getByText("Posibles duplicados")).toBeVisible();
    await expect.element(page.getByText("Ana Pérez", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Ana Pérez SA")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    const igual = page.getByRole("button", { name: "Guardar igual" });
    await expect.element(igual).toBeVisible();
    tocar(igual);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2));
    expect((accion.mock.calls[0]?.[1] as FormData).get("guardarIgual")).toBeNull();
    expect((accion.mock.calls[1]?.[1] as FormData).get("guardarIgual")).toBe("1");
  });

  it("sin permiso «Guardar» sale apagado", async () => {
    await render(formulario(ok, { ...TODO, crear: false }));
    await expect.element(guardar()).toBeDisabled();
  });

  it("cambiar a «Empresa» oculta «Apellido», cambia el rótulo y deja solo CUIT", async () => {
    await render(formulario());
    await expect.element(page.getByLabelText("Apellido (opcional)")).toBeVisible();
    await userEvent.selectOptions(page.getByLabelText("Tipo de documento"), "DNI");
    await userEvent.selectOptions(page.getByLabelText("Persona / Empresa"), "JURIDICA");
    expect(document.querySelector('[name="apellido"]')).toBeNull();
    await expect.element(page.getByLabelText("Razón social")).toBeVisible();
    const tipo = page.getByLabelText("Tipo de documento").element() as HTMLSelectElement;
    expect([...tipo.options].map((o) => o.value)).toEqual(["CUIT"]);
    expect(tipo.value).toBe("CUIT");
  });

  it("el país solo aparece con Pasaporte", async () => {
    await render(formulario());
    expect(document.querySelector('[name="documentoPais"]')).toBeNull();
    await userEvent.selectOptions(page.getByLabelText("Tipo de documento"), "PASAPORTE");
    await expect.element(page.getByLabelText("País")).toBeVisible();
    await userEvent.selectOptions(page.getByLabelText("Tipo de documento"), "DNI");
    expect(document.querySelector('[name="documentoPais"]')).toBeNull();
  });

  it("al editar, «Desactivar» ofrece el cambio de estado y sin permiso sale apagado", async () => {
    const ficha = {
      id: "p1",
      version: 3,
      naturaleza: "HUMANA" as const,
      nombre: "Marta",
      apellido: "Gómez",
      alias: null,
      documento: null,
      condicionIva: null,
      email: null,
      telefono: null,
      domicilio: null,
      nota: null,
      activa: true,
      roles: ["CUSTOMER"],
    };
    const conPermiso = await render(
      <FormularioDeParte
        formulario={armarElFormularioDeParte(ficha, TODO)}
        accion={ok}
        accionDeEstado={okDeEstado}
      />,
    );
    await expect.element(page.getByRole("button", { name: "Desactivar" })).toBeEnabled();
    await conPermiso.unmount();
    await render(
      <FormularioDeParte
        formulario={armarElFormularioDeParte(ficha, { ...TODO, desactivar: false })}
        accion={ok}
        accionDeEstado={okDeEstado}
      />,
    );
    await expect.element(page.getByRole("button", { name: "Desactivar" })).toBeDisabled();
  });
});
