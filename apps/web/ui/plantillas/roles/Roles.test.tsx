import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { ArmazonDeOperacion } from "../sesion/ArmazonDeOperacion";
import { AccionDeEstadoDeRol } from "./AccionDeEstadoDeRol.cliente";
import { FormularioDeAltaDeRol } from "./FormularioDeAltaDeRol.cliente";
import { FormularioDeFichaDeRol } from "./FormularioDeFichaDeRol.cliente";
import {
  armarElFormularioDeAlta,
  armarLaFichaDeRol,
  armarLaListaDeRoles,
  type ModuloParaElegir,
  type RolParaLaPantalla,
} from "./modelo-de-roles";
import { PantallaDeListaDeRoles } from "./PantallaDeListaDeRoles";

/**
 * «Roles» en Chromium real: la lista sin violaciones graves de accesibilidad, con el archivado dicho con texto y cada fila como enlace de 48 px o más; el alta arma su pedido desde lo que se ve (y solo manda el rol de
 * origen si se eligió copiar); la ficha muestra lo cerrado con su nota, manda el conjunto de acciones SOLO si cambió y no deja tocar «Guardar» dos veces; archivar manda una sola acción.
 * Previene: un estado que solo se vea por color, una acción de piso que se pueda tildar, y un envío doble.
 */
const R = (n: number) => `0b0b0b0b-1111-4222-8333-44444444444${n}`;
const rol = (
  n: number,
  nombre: string,
  extra: Partial<RolParaLaPantalla> = {},
): RolParaLaPantalla => ({
  rolId: R(n),
  nombre,
  activo: true,
  personasActivas: 0,
  version: 3,
  acciones: [],
  ...extra,
});
const modulos: readonly ModuloParaElegir[] = [
  {
    modulo: "administracion",
    enElPlan: true,
    acciones: [
      { accion: "usuarios.invitar", piso: null },
      { accion: "usuarios.ver", piso: null },
      { accion: "roles.ver", piso: "SOLO_GERENTE" },
      { accion: "permisos.ver_propios", piso: "TODOS_LOS_ROLES" },
    ],
  },
  { modulo: "stock", enElPlan: false, acciones: [{ accion: "stock.ver", piso: null }] },
];

const conArmazon = (hijo: React.ReactNode) => (
  <ArmazonDeOperacion titulo="Roles" marca="Zulú Pan" empresa="Lácteos del Sur">
    {hijo}
  </ArmazonDeOperacion>
);

/** Una acción de servidor falsa que anota cada pedido (lo que mandó el formulario) y tarda un poco, para probar el doble toque. */
function accionQueAnota() {
  const pedidos: Record<string, string[]>[] = [];
  const accion: AccionDeFormulario = async (_previo, datos) => {
    const lectura: Record<string, string[]> = {};
    for (const [k, v] of datos.entries())
      (lectura[k] ??= []).push(typeof v === "string" ? v : "(archivo)");
    pedidos.push(lectura);
    await new Promise((r) => setTimeout(r, 150));
    return { error: null };
  };
  return { accion, pedidos };
}

describe("PantallaDeListaDeRoles", () => {
  it("sin violaciones graves de accesibilidad; el archivado lleva su texto; cada fila es un enlace a su ficha de 48 px o más", async () => {
    const roles = [
      rol(1, "Cajero", { personasActivas: 1 }),
      rol(2, "Viejo", { activo: false, personasActivas: 3 }),
    ];
    await render(
      conArmazon(<PantallaDeListaDeRoles lista={armarLaListaDeRoles(roles, {}, true)} />),
    );
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    const cajero = page.getByRole("link", { name: /Cajero/ });
    await expect.element(cajero).toHaveAttribute("href", `/cuenta/roles/${R(1)}`);
    await expect.element(cajero).toHaveTextContent("Cajero 1 persona");
    expect(cajero.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
    await expect
      .element(page.getByRole("link", { name: /Viejo/ }))
      .toHaveTextContent("Viejo 3 personas Archivado");
    await expect
      .element(page.getByRole("link", { name: "Nuevo rol" }))
      .toHaveAttribute("href", "/cuenta/roles/nuevo");
  });

  it("sin permiso de crear no se dibuja «Nuevo rol», y sin roles dice que todavía no hay", async () => {
    await render(conArmazon(<PantallaDeListaDeRoles lista={armarLaListaDeRoles([], {}, false)} />));
    await expect.element(page.getByText("Todavía no hay roles propios")).toBeVisible();
    expect(page.getByRole("link", { name: "Nuevo rol" }).elements()).toHaveLength(0);
  });
});

describe("FormularioDeAltaDeRol", () => {
  it("manda el nombre y el origen elegido; copiar otro rol manda además cuál; un doble toque es un solo envío", async () => {
    const { accion, pedidos } = accionQueAnota();
    await render(
      conArmazon(
        <FormularioDeAltaDeRol
          formulario={armarElFormularioDeAlta([{ rolId: R(1), nombre: "Cajero" }], {})}
          accion={accion}
          rutaDeLaLista="/cuenta/roles"
        />,
      ),
    );
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await page.getByLabelText("Nombre").fill("Encargado");
    await page.getByRole("radio", { name: "Copiar de otro rol" }).click();
    const guardar = page.getByRole("button", { name: "Guardar" });
    await guardar.dblClick();
    await expect.poll(() => pedidos.length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 400));
    expect(pedidos).toEqual([{ nombre: ["Encargado"], origen: ["ROL"], rolDeOrigen: [R(1)] }]);
  });

  it("con el origen por defecto manda «sin acciones» y no manda rol de origen; sin otros roles no ofrece copiar", async () => {
    const { accion, pedidos } = accionQueAnota();
    await render(
      conArmazon(
        <FormularioDeAltaDeRol
          formulario={armarElFormularioDeAlta([], {})}
          accion={accion}
          rutaDeLaLista="/cuenta/roles"
        />,
      ),
    );
    expect(page.getByRole("radio", { name: "Copiar de otro rol" }).elements()).toHaveLength(0);
    await page.getByLabelText("Nombre").fill("Mozo");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect.poll(() => pedidos.length).toBe(1);
    expect(pedidos[0]).toEqual({ nombre: ["Mozo"], origen: ["VACIO"] });
  });
});

describe("FormularioDeFichaDeRol", () => {
  const ficha = (extra: Partial<RolParaLaPantalla> = {}) =>
    armarLaFichaDeRol(
      rol(1, "Cajero", { acciones: ["usuarios.ver", "stock.ver"], ...extra }),
      modulos,
      {},
      { editar: true },
    );

  it("muestra lo cerrado con su nota (solo gerente, fuera del plan), tilda lo que el rol tiene y lo que todo rol lleva, y no deja tocar lo cerrado", async () => {
    const { accion } = accionQueAnota();
    await render(
      conArmazon(
        <FormularioDeFichaDeRol ficha={ficha()} accion={accion} rutaDeLaLista="/cuenta/roles" />,
      ),
    );
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await expect.element(page.getByText("Solo el gerente")).toBeVisible();
    await expect.element(page.getByText("No incluida en el plan")).toBeVisible();
    await expect.element(page.getByRole("checkbox", { name: /Ver los usuarios/ })).toBeChecked();
    await expect
      .element(page.getByRole("checkbox", { name: /Invitar usuarios/ }))
      .not.toBeChecked();
    await expect.element(page.getByRole("checkbox", { name: /Ver los roles/ })).toBeDisabled();
    await expect
      .element(
        page.getByRole("checkbox", { name: /Ver los productos|Ver el stock|Ver las existencias/ }),
      )
      .toBeDisabled();
  });

  it("renombrar NO manda el conjunto de acciones (no pierde las de un módulo fuera del plan); cambiar una casilla sí, con el conjunto final", async () => {
    const { accion, pedidos } = accionQueAnota();
    await render(
      conArmazon(
        <FormularioDeFichaDeRol ficha={ficha()} accion={accion} rutaDeLaLista="/cuenta/roles" />,
      ),
    );
    await page.getByLabelText("Nombre").fill("Cajero 2");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect.poll(() => pedidos.length).toBe(1);
    expect(pedidos[0]).toEqual({ nombre: ["Cajero 2"] });

    await new Promise((r) => setTimeout(r, 300));
    await page.getByRole("checkbox", { name: /Invitar usuarios/ }).click();
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect.poll(() => pedidos.length).toBe(2);
    expect(pedidos[1]?.["conjunto"]).toEqual(["1"]);
    expect([...(pedidos[1]?.["acciones"] ?? [])].sort()).toEqual(
      ["permisos.ver_propios", "usuarios.invitar", "usuarios.ver"].sort(),
    );
  });

  it("un doble toque en «Guardar» es un solo envío", async () => {
    const { accion, pedidos } = accionQueAnota();
    await render(
      conArmazon(
        <FormularioDeFichaDeRol ficha={ficha()} accion={accion} rutaDeLaLista="/cuenta/roles" />,
      ),
    );
    await page.getByRole("button", { name: "Guardar" }).dblClick();
    await new Promise((r) => setTimeout(r, 500));
    expect(pedidos).toHaveLength(1);
  });

  it("un rol archivado se ve pero no se edita: sin «Guardar» y con su insignia; solo ofrece «Reactivar» a quien puede editar", async () => {
    const { accion } = accionQueAnota();
    const archivada = armarLaFichaDeRol(
      rol(1, "Viejo", { activo: false }),
      modulos,
      {},
      { editar: true },
    );
    expect(archivada.reactivar).toBe("Reactivar");
    expect(archivada.archivar).toBeNull();
    await render(
      conArmazon(
        <FormularioDeFichaDeRol ficha={archivada} accion={accion} rutaDeLaLista="/cuenta/roles" />,
      ),
    );
    expect(page.getByRole("button", { name: "Guardar" }).elements()).toHaveLength(0);
    const sinPermiso = armarLaFichaDeRol(
      rol(1, "Viejo", { activo: false }),
      modulos,
      {},
      { editar: false },
    );
    expect(sinPermiso.reactivar).toBeNull();
    expect(sinPermiso.archivar).toBeNull();
  });
});

describe("AccionDeEstadoDeRol", () => {
  it("«Archivar» envía una sola acción aunque se toque dos veces seguidas", async () => {
    const { accion, pedidos } = accionQueAnota();
    await render(conArmazon(<AccionDeEstadoDeRol accion={accion} texto="Archivar" />));
    await page.getByRole("button", { name: "Archivar" }).dblClick();
    await new Promise((r) => setTimeout(r, 500));
    expect(pedidos).toHaveLength(1);
  });
});
