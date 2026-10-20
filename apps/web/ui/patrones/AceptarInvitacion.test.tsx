import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import type { Respuesta } from "../../../../src/capacidades/experiencia/respuesta";
import {
  restaurarConexion,
  simularConexion,
  tocar,
  violacionesDeAccesibilidad,
} from "../pruebas/ayudas";
import { AceptarInvitacion } from "./AceptarInvitacion.cliente";

/**
 * «Aceptar invitación» (P-11): el envío incierto con LA MISMA clave y un solo efecto, el doble toque, la falta de
 * conexión y los rechazos traducidos. El servidor es un falso que cuenta cuántas veces se aplicó el efecto: la
 * regla natural de la invitación (la segunda vez devuelve «ya estaba aceptada») es la que evita el duplicado.
 */
afterEach(() => {
  restaurarConexion();
});

type Dato = Readonly<{ yaEstabaAceptada: boolean }>;

function servidorFalso() {
  const pedidos: string[] = [];
  let efectos = 0;
  const control = { respuestasPerdidas: 0, demoraMs: 0 };
  const aceptar = async (clave: string): Promise<Respuesta<Dato>> => {
    pedidos.push(clave);
    if (control.demoraMs > 0) await new Promise((r) => setTimeout(r, control.demoraMs));
    const yaEstaba = efectos > 0;
    if (!yaEstaba) efectos += 1;
    if (control.respuestasPerdidas > 0) {
      control.respuestasPerdidas -= 1;
      throw new TypeError("Failed to fetch");
    }
    return { ok: true, dato: { yaEstabaAceptada: yaEstaba } };
  };
  return { aceptar, pedidos, efectos: () => efectos, control };
}

const aceptarBoton = () => page.getByRole("button", { name: /Aceptar invitación|Aceptando…/ });

describe("AceptarInvitacion", () => {
  it("camino feliz: un pedido, un efecto, «Listo» y el enlace para continuar", async () => {
    const s = servidorFalso();
    await render(<AceptarInvitacion aceptar={s.aceptar} rutaDeContinuar="/" />);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    tocar(aceptarBoton());
    await expect.element(page.getByText("Listo, ya sos parte de la empresa.")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Continuar" }))
      .toHaveAttribute("href", "/");
    expect(s.pedidos).toHaveLength(1);
    expect(s.efectos()).toBe(1);
  });

  it("doble toque: un solo envío y un solo efecto", async () => {
    const s = servidorFalso();
    s.control.demoraMs = 40;
    await render(<AceptarInvitacion aceptar={s.aceptar} rutaDeContinuar="/" />);
    tocar(aceptarBoton());
    tocar(aceptarBoton());
    tocar(aceptarBoton());
    await expect.element(page.getByText("Listo, ya sos parte de la empresa.")).toBeVisible();
    expect(s.pedidos).toHaveLength(1);
    expect(s.efectos()).toBe(1);
  });

  it("P-11: el servidor aceptó y el navegador no se enteró -> «Verificando…», reintento con LA MISMA clave, un solo efecto y el resultado «ya estaba aceptada»", async () => {
    const s = servidorFalso();
    s.control.respuestasPerdidas = 1;
    await render(<AceptarInvitacion aceptar={s.aceptar} rutaDeContinuar="/" />);
    tocar(aceptarBoton());
    await expect.element(page.getByRole("status")).toHaveTextContent("Verificando si se registró…");
    // Mientras no se sabe, no se puede empezar otro intento.
    await expect.element(aceptarBoton()).toBeDisabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    await expect.element(page.getByText("Esta invitación ya estaba aceptada.")).toBeVisible();
    expect(s.pedidos).toHaveLength(2);
    expect(s.pedidos[1]).toBe(s.pedidos[0]);
    expect(s.efectos()).toBe(1);
  });

  it("sin conexión: el botón queda deshabilitado con su motivo y no se manda nada", async () => {
    const s = servidorFalso();
    await render(<AceptarInvitacion aceptar={s.aceptar} rutaDeContinuar="/" />);
    simularConexion(false);
    await expect.element(aceptarBoton()).toBeDisabled();
    await expect
      .element(aceptarBoton())
      .toHaveAccessibleDescription("No se puede enviar sin conexión.");
    tocar(aceptarBoton());
    expect(s.pedidos).toHaveLength(0);
    simularConexion(true);
    await expect.element(aceptarBoton()).toBeEnabled();
  });

  it("un rechazo de negocio se muestra traducido, con su código, sin «Reintentar» (repetirlo no lo cambia)", async () => {
    const aceptar = vi.fn((): Promise<Respuesta<Dato>> =>
      Promise.resolve({
        ok: false,
        error: {
          codigo: "INVITACION_VENCIDA",
          clave: "error.invitacion_vencida",
          presentacion: "AVISO",
        },
      }),
    );
    await render(<AceptarInvitacion aceptar={aceptar} rutaDeContinuar="/" />);
    tocar(aceptarBoton());
    await expect.element(page.getByText("Esa invitación venció. Pedí una nueva.")).toBeVisible();
    await expect.element(page.getByText("INVITACION_VENCIDA")).toBeVisible();
    expect(page.getByRole("button", { name: "Reintentar" }).query()).toBeNull();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("un fallo inesperado del servidor muestra la referencia PD-… y «Reintentar»; no hay ningún detalle", async () => {
    const aceptar = vi
      .fn<(clave: string) => Promise<Respuesta<Dato>>>()
      .mockResolvedValueOnce({
        ok: false,
        error: {
          codigo: "ERROR_INTERNO",
          clave: "error.inesperado",
          presentacion: "INESPERADO",
          referencia: "PD-ABCD-0123",
        },
      })
      .mockResolvedValue({ ok: true, dato: { yaEstabaAceptada: false } });
    await render(<AceptarInvitacion aceptar={aceptar} rutaDeContinuar="/" />);
    tocar(aceptarBoton());
    await expect.element(page.getByText("Referencia: PD-ABCD-0123")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    tocar(page.getByRole("button", { name: "Reintentar" }));
    await expect.element(page.getByText("Listo, ya sos parte de la empresa.")).toBeVisible();
    expect(aceptar).toHaveBeenCalledTimes(2);
  });
});
