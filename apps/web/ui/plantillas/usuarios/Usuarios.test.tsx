import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { ArmazonDeOperacion } from "../sesion/ArmazonDeOperacion";
import {
  armarLaFichaDeUsuario,
  armarLaListaDeUsuarios,
  type ListaDeUsuariosParaLaPantalla,
} from "./modelo-de-usuarios";
import { PantallaDeFichaDeUsuario } from "./PantallaDeFichaDeUsuario";
import { PantallaDeListaDeUsuarios } from "./PantallaDeListaDeUsuarios";

/**
 * «Usuarios» (tramo U1) en Chromium real: la lista sin violaciones graves de accesibilidad, el estado «Desactivado» y «Vencida» dichos con texto (no solo con color), las filas de personas como
 * enlaces a su ficha (de 48 px o más), el bloque de invitaciones ausente si no hay ninguna y la ficha de solo lectura sin botones. Las invitaciones y «Invitar» (tramo U2) están en `Invitaciones.test.tsx`.
 * Previene: un estado que solo se vea por color y una fila que no se pueda tocar en el celular.
 */
const P = (n: number) => `0b0b0b0b-1111-4222-8333-44444444444${n}`;
const lista: ListaDeUsuariosParaLaPantalla = {
  usuarios: [
    { personaId: P(1), email: "ana@lacteos.test", rol: "OPERADOR", activo: false },
    { personaId: P(2), email: "diego@lacteos.test", rol: "ADMINISTRADOR", activo: true },
    { personaId: P(3), email: "laura@lacteos.test", rol: "GERENTE", activo: true },
    { personaId: P(4), email: "sofia@lacteos.test", rol: "OPERADOR", activo: true },
  ],
  invitaciones: [
    {
      invitacionId: "i-1",
      email: "julia@lacteos.test",
      rol: "OPERADOR",
      venceEn: "2026-11-29T15:00:00.000Z",
      vencida: false,
    },
    {
      invitacionId: "i-2",
      email: "pablo@lacteos.test",
      rol: "ADMINISTRADOR",
      venceEn: "2026-11-21T15:00:00.000Z",
      vencida: true,
    },
  ],
};

const conArmazon = (titulo: string, hijo: React.ReactNode) => (
  <ArmazonDeOperacion titulo={titulo} marca="Zulú Pan" empresa="Lácteos del Sur">
    {hijo}
  </ArmazonDeOperacion>
);

describe("PantallaDeListaDeUsuarios", () => {
  it("sin violaciones graves de accesibilidad, con cada persona como enlace a su ficha y su rol traducido", async () => {
    await render(
      conArmazon("Usuarios", <PantallaDeListaDeUsuarios lista={armarLaListaDeUsuarios(lista)} />),
    );
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    const enlace = page.getByRole("link", { name: /laura@lacteos\.test/ });
    await expect.element(enlace).toBeVisible();
    await expect.element(enlace).toHaveAttribute("href", `/cuenta/usuarios/${P(3)}`);
    expect(enlace.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
    await expect.element(enlace).toHaveTextContent("laura@lacteos.test Gerente");
    await expect
      .element(page.getByRole("link", { name: /sofia@lacteos\.test/ }))
      .toHaveTextContent("sofia@lacteos.test Empleado");
    await expect
      .element(page.getByRole("link", { name: /diego@lacteos\.test/ }))
      .toHaveTextContent("diego@lacteos.test Administrador");
  });

  it("«Desactivado» se lee como texto en la fila de la persona desactivada y en ninguna otra", async () => {
    await render(<PantallaDeListaDeUsuarios lista={armarLaListaDeUsuarios(lista)} />);
    await expect
      .element(page.getByRole("link", { name: /ana@lacteos\.test/ }))
      .toHaveTextContent("ana@lacteos.test Empleado Desactivado");
    expect(page.getByText("Desactivado").elements()).toHaveLength(1);
  });

  it("las invitaciones: encabezado, «Vence el …» en hora de Argentina, «Vencida» y «Pendiente» como texto", async () => {
    await render(<PantallaDeListaDeUsuarios lista={armarLaListaDeUsuarios(lista)} />);
    await expect.element(page.getByRole("heading", { name: "Invitaciones" })).toBeVisible();
    await expect.element(page.getByText("Empleado · Vence el 29/11/2026")).toBeVisible();
    await expect.element(page.getByText("Administrador · Vence el 21/11/2026")).toBeVisible();
    await expect.element(page.getByText("Vencida")).toBeVisible();
    await expect.element(page.getByText("Pendiente")).toBeVisible();
  });

  it("sin invitaciones no se dibuja el bloque ni su encabezado", async () => {
    await render(
      <PantallaDeListaDeUsuarios lista={armarLaListaDeUsuarios({ ...lista, invitaciones: [] })} />,
    );
    expect(page.getByRole("heading", { name: "Invitaciones" }).elements()).toHaveLength(0);
  });

  it("sin el permiso de invitar no ofrece ningún botón ni enlace de «Invitar»", async () => {
    await render(<PantallaDeListaDeUsuarios lista={armarLaListaDeUsuarios(lista)} />);
    expect(page.getByRole("button").elements()).toHaveLength(0);
    expect(page.getByRole("link", { name: "Invitar" }).elements()).toHaveLength(0);
  });
});

describe("PantallaDeFichaDeUsuario", () => {
  it("muestra el rol y el estado como texto, sin botones y sin violaciones de accesibilidad", async () => {
    const ficha = armarLaFichaDeUsuario(lista.usuarios[3] as (typeof lista.usuarios)[number]);
    await render(conArmazon(ficha.email, <PantallaDeFichaDeUsuario ficha={ficha} />));
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await expect.element(page.getByText("Rol")).toBeVisible();
    await expect.element(page.getByText("Empleado")).toBeVisible();
    await expect.element(page.getByText("Estado")).toBeVisible();
    await expect.element(page.getByText("Activo")).toBeVisible();
    expect(page.getByRole("button").elements()).toHaveLength(0);
  });

  it("la persona desactivada figura «Desactivado» con texto", async () => {
    const ficha = armarLaFichaDeUsuario(lista.usuarios[0] as (typeof lista.usuarios)[number]);
    await render(<PantallaDeFichaDeUsuario ficha={ficha} />);
    await expect.element(page.getByText("Desactivado")).toBeVisible();
    expect(page.getByText("Activo").elements()).toHaveLength(0);
  });
});
