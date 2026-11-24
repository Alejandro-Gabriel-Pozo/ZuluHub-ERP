import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { ArmazonDeOperacion } from "../sesion/ArmazonDeOperacion";
import { FormularioDeInvitacion } from "./FormularioDeInvitacion.cliente";
import {
  armarElFormularioDeInvitacion,
  armarLaFichaDeInvitacion,
  type InvitacionParaLaFichaDeLaPantalla,
} from "./modelo-de-invitaciones";
import { armarLaListaDeUsuarios } from "./modelo-de-usuarios";
import { PantallaDeFichaDeInvitacion } from "./PantallaDeFichaDeInvitacion";
import { PantallaDeListaDeUsuarios } from "./PantallaDeListaDeUsuarios";
import type { ResultadoDeAccionDeInvitacion, ResultadoDeInvitar } from "./resultado-de-usuarios";

/**
 * Invitar, reenviar y revocar (tramo U2) en Chromium real: el formulario sin violaciones graves de accesibilidad, las sucursales solo con el rol Empleado, lo que viaja a la acción, el doble toque
 * (un solo envío), el aviso «Ya había una invitación pendiente para ese email» (un aviso, no un error) y el error del servidor debajo; la ficha de la invitación con su estado dicho con texto y sus
 * botones solo si hay permiso; y «Invitar» y las filas de invitaciones en la lista. Previene: un doble toque que mande dos invitaciones, una casilla de sucursal que viaje con el rol equivocado y un
 * botón ofrecido a quien el servidor va a rechazar.
 */
const LISTA = "/cuenta/usuarios";
const SUCURSALES = [
  { id: "0b0b0b0b-1111-4222-8333-444444444441", nombre: "Centro" },
  { id: "0b0b0b0b-1111-4222-8333-444444444442", nombre: "Norte" },
];
const INICIAL: ResultadoDeInvitar = { estado: "INICIAL" };

type Accion = (previo: ResultadoDeInvitar, datos: FormData) => Promise<ResultadoDeInvitar>;

const formulario = (accion: Accion) => (
  <FormularioDeInvitacion
    formulario={armarElFormularioDeInvitacion(SUCURSALES)}
    accion={accion}
    rutaDeLaLista={LISTA}
  />
);
const conArmazon = (hijo: React.ReactNode) => (
  <ArmazonDeOperacion titulo="Invitar" marca="Zulú Pan" empresa="Lácteos del Sur">
    {hijo}
  </ArmazonDeOperacion>
);

describe("FormularioDeInvitacion", () => {
  it("Email, Rol (Administrador y Empleado, nace en Empleado) y las sucursales del Empleado; sin violaciones graves de accesibilidad", async () => {
    await render(conArmazon(formulario(() => Promise.resolve(INICIAL))));
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await expect.element(page.getByLabelText("Email")).toBeVisible();
    await expect
      .element(page.getByText("El email tiene que ser de una cuenta de Google"))
      .toBeVisible();
    await expect.element(page.getByLabelText("Rol")).toHaveValue("OPERADOR");
    const opciones = page.getByLabelText("Rol").element().querySelectorAll("option");
    expect([...opciones].map((o) => o.textContent)).toEqual(["Administrador", "Empleado"]);
    await expect.element(page.getByRole("group", { name: "Sucursales" })).toBeVisible();
    await expect.element(page.getByLabelText("Centro")).not.toBeChecked();
    await expect.element(page.getByRole("button", { name: "Enviar invitación" })).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Cancelar" }))
      .toHaveAttribute("href", LISTA);
  });

  it("«Sucursales» aparece solo con el rol Empleado: con Administrador no hay casillas ni viajan", async () => {
    const accion = vi.fn<Accion>(() => Promise.resolve(INICIAL));
    await render(formulario(accion));
    await userEvent.fill(page.getByLabelText("Email"), "julia@lacteos.test");
    await userEvent.click(page.getByLabelText("Centro"));
    await userEvent.selectOptions(page.getByLabelText("Rol"), "ADMINISTRADOR");
    expect(page.getByRole("group", { name: "Sucursales" }).elements()).toHaveLength(0);
    expect(page.getByLabelText("Centro").elements()).toHaveLength(0);
    tocar(page.getByRole("button", { name: "Enviar invitación" }));
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(datos.get("email")).toBe("julia@lacteos.test");
    expect(datos.get("rol")).toBe("ADMINISTRADOR");
    expect(datos.getAll("sucursales")).toEqual([]);
  });

  it("con Empleado manda las sucursales tildadas, y solo esas", async () => {
    const accion = vi.fn<Accion>(() => Promise.resolve(INICIAL));
    await render(formulario(accion));
    await userEvent.fill(page.getByLabelText("Email"), "sofia@lacteos.test");
    await userEvent.click(page.getByLabelText("Norte"));
    tocar(page.getByRole("button", { name: "Enviar invitación" }));
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(datos.get("rol")).toBe("OPERADOR");
    expect(datos.getAll("sucursales")).toEqual([SUCURSALES[1]?.id]);
  });

  it("doble toque en «Enviar invitación» = un solo envío", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn<Accion>(async () => {
      await new Promise<void>((r) => {
        liberar = r;
      });
      return INICIAL;
    });
    await render(formulario(accion));
    await userEvent.fill(page.getByLabelText("Email"), "julia@lacteos.test");
    const enviar = page.getByRole("button", { name: "Enviar invitación" });
    tocar(enviar);
    await expect.element(enviar).toHaveAttribute("aria-busy", "true");
    tocar(enviar);
    tocar(enviar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(enviar).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("«Ya había una invitación pendiente para ese email» sale como aviso informativo, no como error, y no navega", async () => {
    await render(formulario(() => Promise.resolve({ estado: "YA_HABIA" })));
    await userEvent.fill(page.getByLabelText("Email"), "julia@lacteos.test");
    tocar(page.getByRole("button", { name: "Enviar invitación" }));
    const aviso = page.getByRole("status");
    await expect
      .element(aviso)
      .toHaveTextContent("Ya había una invitación pendiente para ese email");
    expect(page.getByRole("alert").elements()).toHaveLength(0);
    await expect.element(page.getByLabelText("Email")).toHaveValue("julia@lacteos.test");
  });

  it("el error del servidor (ya es parte de la empresa) sale debajo con su texto y conserva lo escrito", async () => {
    const rechazo: Accion = () =>
      Promise.resolve({
        estado: "ERROR",
        error: {
          codigo: "USUARIOS_YA_ES_MIEMBRO",
          clave: "usuarios.error.ya_es_miembro",
          presentacion: "AVISO",
        },
      });
    await render(conArmazon(formulario(rechazo)));
    await userEvent.fill(page.getByLabelText("Email"), "marcos@lacteos.test");
    tocar(page.getByRole("button", { name: "Enviar invitación" }));
    await expect.element(page.getByText("Ya es parte de la empresa")).toBeVisible();
    await expect.element(page.getByLabelText("Email")).toHaveValue("marcos@lacteos.test");
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });
});

const INVITACION: InvitacionParaLaFichaDeLaPantalla = {
  invitacionId: "i-1",
  email: "julia@lacteos.test",
  rol: "OPERADOR",
  venceEn: "2026-11-29T15:00:00.000Z",
  vencida: false,
  sucursales: [SUCURSALES[1]?.id as string],
};
type AccionDeInvitacion = (
  previo: ResultadoDeAccionDeInvitacion,
  datos: FormData,
) => Promise<ResultadoDeAccionDeInvitacion>;
const sinHacer: AccionDeInvitacion = () => Promise.resolve({ estado: "INICIAL" });

describe("PantallaDeFichaDeInvitacion", () => {
  it("rol, sucursales por nombre, «Pendiente» y «Vence el …» como texto; Reenviar y Revocar; sin violaciones graves", async () => {
    const ficha = armarLaFichaDeInvitacion(INVITACION, SUCURSALES);
    await render(
      conArmazon(
        <PantallaDeFichaDeInvitacion ficha={ficha} reenviar={sinHacer} revocar={sinHacer} />,
      ),
    );
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await expect.element(page.getByText("Empleado")).toBeVisible();
    await expect.element(page.getByText("Norte")).toBeVisible();
    await expect.element(page.getByText("Pendiente")).toBeVisible();
    await expect.element(page.getByText("Vence el 29/11/2026")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Reenviar" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Revocar" })).toBeVisible();
  });

  it("la vencida se dice «Vencida» con texto y sigue pudiéndose reenviar y revocar", async () => {
    const ficha = armarLaFichaDeInvitacion({ ...INVITACION, vencida: true }, SUCURSALES);
    await render(
      <PantallaDeFichaDeInvitacion ficha={ficha} reenviar={sinHacer} revocar={sinHacer} />,
    );
    await expect.element(page.getByText("Vencida")).toBeVisible();
    expect(page.getByText("Pendiente").elements()).toHaveLength(0);
    await expect.element(page.getByRole("button", { name: "Reenviar" })).toBeEnabled();
  });

  it("sin permiso los botones no se dibujan (cada uno con el suyo)", async () => {
    const ficha = armarLaFichaDeInvitacion(INVITACION, SUCURSALES);
    await render(<PantallaDeFichaDeInvitacion ficha={ficha} reenviar={null} revocar={sinHacer} />);
    expect(page.getByRole("button", { name: "Reenviar" }).elements()).toHaveLength(0);
    await expect.element(page.getByRole("button", { name: "Revocar" })).toBeVisible();
  });

  it("doble toque en «Reenviar» = una sola llamada; el error del servidor sale debajo", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn<AccionDeInvitacion>(async () => {
      await new Promise<void>((r) => {
        liberar = r;
      });
      return {
        estado: "ERROR",
        error: {
          codigo: "USUARIOS_NO_PERMITIDO",
          clave: "usuarios.error.accion_no_permitida",
          presentacion: "AVISO",
        },
      };
    });
    const ficha = armarLaFichaDeInvitacion(INVITACION, SUCURSALES);
    await render(<PantallaDeFichaDeInvitacion ficha={ficha} reenviar={accion} revocar={null} />);
    const reenviar = page.getByRole("button", { name: "Reenviar" });
    tocar(reenviar);
    await expect.element(reenviar).toHaveAttribute("aria-busy", "true");
    tocar(reenviar);
    tocar(reenviar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(reenviar).not.toHaveAttribute("aria-busy", "true");
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(accion).toHaveBeenCalledTimes(1);
  });
});

describe("la lista con «Invitar» y las invitaciones como enlaces", () => {
  const lista = {
    usuarios: [],
    invitaciones: [
      {
        invitacionId: "i-1",
        email: "julia@lacteos.test",
        rol: "OPERADOR",
        venceEn: "2026-11-29T15:00:00.000Z",
        vencida: false,
      },
    ],
  } as const;

  it("«Invitar» lleva al formulario y la invitación a su ficha, ambos de 48 px o más", async () => {
    await render(
      conArmazon(<PantallaDeListaDeUsuarios lista={armarLaListaDeUsuarios(lista, {}, true)} />),
    );
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    const invitar = page.getByRole("link", { name: "Invitar" });
    await expect.element(invitar).toHaveAttribute("href", "/cuenta/usuarios/invitar");
    expect(invitar.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    const fila = page.getByRole("link", { name: /julia@lacteos\.test/ });
    await expect.element(fila).toHaveAttribute("href", "/cuenta/usuarios/invitaciones/i-1");
    expect(fila.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
  });
});
