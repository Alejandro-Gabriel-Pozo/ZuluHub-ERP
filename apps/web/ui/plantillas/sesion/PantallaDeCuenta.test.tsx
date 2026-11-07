import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { ArmazonDeOperacion } from "./ArmazonDeOperacion";
import { PantallaDeCuenta } from "./PantallaDeCuenta";

/**
 * El renglón «Configuración fiscal» de Cuenta (respuesta del dueño, 2026-10-29): solo existe si el servidor se lo pasa (la persona
 * tiene el permiso de esa pantalla); es un enlace a la lista, accesible y de 48 px o más. Previene: ofrecer la entrada a quien no
 * puede usarla, y un renglón que no se pueda tocar en el celular.
 */
const accionVacia = () => Promise.resolve({ error: null });

const cuenta = (conRenglon: boolean, conContacto = false) => (
  <ArmazonDeOperacion
    titulo="Cuenta"
    actual="cuenta"
    marca="Hotel del Lago"
    empresa="Café del Puerto"
  >
    <PantallaDeCuenta
      empresa={{
        empresaId: "e-1",
        nombre: "Café del Puerto",
        rol: "GERENTE",
        estadoEfectivo: "OPERA",
      }}
      sucursales={[]}
      {...(conRenglon
        ? { configuracionFiscal: { texto: "Configuración fiscal", href: "/configuracion-fiscal" } }
        : {})}
      {...(conContacto
        ? {
            contactoDeLaSucursal: {
              texto: "Contacto de la sucursal",
              href: "/cuenta/contacto-de-la-sucursal",
            },
          }
        : {})}
      accionDeCerrarSesion={accionVacia}
    />
  </ArmazonDeOperacion>
);

describe("Cuenta y Configuración fiscal", () => {
  it("con el permiso: un enlace a la lista, sin violaciones de accesibilidad y de 48 px o más", async () => {
    await render(cuenta(true));
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    const enlace = page.getByRole("link", { name: "Configuración fiscal" });
    await expect.element(enlace).toBeVisible();
    await expect.element(enlace).toHaveAttribute("href", "/configuracion-fiscal");
    expect(enlace.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
  });

  it("sin el permiso: no hay renglón", async () => {
    await render(cuenta(false));
    expect(page.getByRole("link", { name: "Configuración fiscal" }).elements()).toHaveLength(0);
    await expect.element(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  });
});

/**
 * El renglón «Contacto de la sucursal» (D-113): igual que el de Configuración fiscal, solo existe si el servidor se lo pasa (la persona
 * puede editar sucursales). Previene: ofrecer la entrada a quien no puede usarla y un renglón que no se pueda tocar en el celular.
 */
describe("Cuenta y Contacto de la sucursal", () => {
  it("con el permiso: un enlace a la pantalla, sin violaciones de accesibilidad y de 48 px o más", async () => {
    await render(cuenta(false, true));
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    const enlace = page.getByRole("link", { name: "Contacto de la sucursal" });
    await expect.element(enlace).toBeVisible();
    await expect.element(enlace).toHaveAttribute("href", "/cuenta/contacto-de-la-sucursal");
    expect(enlace.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
  });

  it("sin el permiso: no hay renglón", async () => {
    await render(cuenta(true, false));
    expect(page.getByRole("link", { name: "Contacto de la sucursal" }).elements()).toHaveLength(0);
    await expect.element(page.getByRole("link", { name: "Configuración fiscal" })).toBeVisible();
  });

  it("con los dos permisos, los dos renglones; cada uno con su enlace", async () => {
    await render(cuenta(true, true));
    await expect
      .element(page.getByRole("link", { name: "Configuración fiscal" }))
      .toHaveAttribute("href", "/configuracion-fiscal");
    await expect
      .element(page.getByRole("link", { name: "Contacto de la sucursal" }))
      .toHaveAttribute("href", "/cuenta/contacto-de-la-sucursal");
  });
});
