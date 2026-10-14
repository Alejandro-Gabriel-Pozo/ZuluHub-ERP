import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { violacionesDeAccesibilidad, tocar } from "../pruebas/ayudas";
import { leerBorrador } from "./borrador";
import { IndicadorDeSesion } from "./IndicadorDeSesion.cliente";
import { ProveedorDeSesion } from "./ProveedorDeSesion.cliente";

/**
 * El estado de la sesión en la pantalla (armazón web §4.5, P-10): el aviso a los 12 minutos, el vencimiento a
 * los 15, lo tipeado que no se pierde, y la renovación de la cookie mientras se usa. Con relojes falsos: nadie
 * espera 12 minutos. El pedido de renovación es un `fetch` falso que cuenta y responde lo que se le diga.
 */
const MINUTO = 60_000;
const nombreDelBorrador = () => `pagina:${window.location.pathname}`;

let respuesta: { status: number } | "red";
let pedidos: { url: string; init: RequestInit | undefined }[];
let navegaciones: string[];

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  respuesta = { status: 200 };
  pedidos = [];
  navegaciones = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      pedidos.push({ url, init });
      if (respuesta === "red") return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.resolve(new Response("{}", { status: respuesta.status }));
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const pasar = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
/** Un toque de la persona en la pantalla (cuenta como uso). */
const usar = async () => {
  await act(async () => {
    window.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
  });
};

function Pantalla({ campo = true }: Readonly<{ campo?: boolean }>) {
  const [nota, setNota] = useState("");
  return (
    <ProveedorDeSesion
      rutaDeRenovacion="/api/sesion/renovar"
      rutaDeIngreso="/ingreso"
      navegar={(direccion) => navegaciones.push(direccion)}
    >
      <header>
        <IndicadorDeSesion />
      </header>
      <main>
        {campo ? (
          <form>
            <label>
              Nota
              <input name="nota" value={nota} onChange={(e) => setNota(e.target.value)} />
            </label>
            <input
              aria-label="Clave de acceso"
              name="clave_de_acceso"
              defaultValue="no-se-guarda"
            />
            <input aria-label="Contraseña" name="password" type="password" defaultValue="tampoco" />
            <input name="oculto" type="hidden" defaultValue="ni-esto" />
          </form>
        ) : (
          <p>Sin campos</p>
        )}
      </main>
    </ProveedorDeSesion>
  );
}

describe("ProveedorDeSesion", () => {
  it("activa: el indicador dice «Sesión activa» y no hay aviso", async () => {
    await render(<Pantalla />);
    await expect.element(page.getByText("Sesión activa")).toBeVisible();
    expect(page.getByRole("dialog").query()).toBeNull();
  });

  it("a los 12 minutos sin uso: «¿Seguís ahí?» y el indicador pasa a «por vencer»", async () => {
    await render(<Pantalla />);
    await pasar(12 * MINUTO - 6000);
    expect(page.getByRole("dialog").query()).toBeNull();
    await pasar(6000);
    await expect.element(page.getByRole("dialog", { name: "¿Seguís ahí?" })).toBeVisible();
    await expect.element(page.getByText("Sesión por vencer")).toBeVisible();
  });

  it("«Seguir» renueva la sesión por POST a la ruta de renovación (con la cookie del mismo origen) y cierra el aviso", async () => {
    await render(<Pantalla />);
    await pasar(12 * MINUTO);
    tocar(page.getByRole("button", { name: "Seguir" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe("/api/sesion/renovar");
    expect(pedidos[0]?.init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(page.getByRole("dialog").query()).toBeNull();
    await expect.element(page.getByText("Sesión activa")).toBeVisible();
  });

  it("«Seguir» sin conexión no da por renovada la sesión: el aviso sigue a la vista", async () => {
    await render(<Pantalla />);
    await pasar(12 * MINUTO);
    respuesta = "red";
    tocar(page.getByRole("button", { name: "Seguir" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(pedidos).toHaveLength(1);
    await expect.element(page.getByRole("dialog", { name: "¿Seguís ahí?" })).toBeVisible();
  });

  it("si al seguir el servidor dice 401, la sesión ya venció: «Ingresar de nuevo» lleva a /ingreso?volver=<la página>", async () => {
    await render(<Pantalla />);
    await pasar(12 * MINUTO);
    respuesta = { status: 401 };
    tocar(page.getByRole("button", { name: "Seguir" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await expect.element(page.getByRole("dialog", { name: "Tu sesión venció" })).toBeVisible();
    await expect.element(page.getByText("Sesión vencida")).toBeVisible();
    tocar(page.getByRole("button", { name: "Ingresar de nuevo" }));
    expect(navegaciones).toEqual([
      `/ingreso?volver=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`,
    ]);
  });

  it("a los 15 minutos vence sola, y lo tipeado queda a salvo en esta pestaña (sin claves, sin contraseñas, sin campos ocultos)", async () => {
    const { container } = await render(<Pantalla />);
    const nota = container.querySelector<HTMLInputElement>("input[name=nota]");
    const natural = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      natural?.call(nota, "dos medialunas para la mesa 4");
      nota?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await pasar(15 * MINUTO);
    await expect.element(page.getByRole("dialog", { name: "Tu sesión venció" })).toBeVisible();
    expect(leerBorrador(nombreDelBorrador())).toEqual({ nota: "dos medialunas para la mesa 4" });
    expect(sessionStorage.getItem(`zh:borrador:${nombreDelBorrador()}`)).not.toMatch(
      /no-se-guarda|tampoco|ni-esto/,
    );
  });

  it("al volver de ingresar, lo guardado vuelve al campo y se descarta (se usa una sola vez)", async () => {
    sessionStorage.setItem(
      `zh:borrador:${nombreDelBorrador()}`,
      JSON.stringify({ nota: "dos medialunas para la mesa 4" }),
    );
    const { container } = await render(<Pantalla />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(container.querySelector<HTMLInputElement>("input[name=nota]")?.value).toBe(
      "dos medialunas para la mesa 4",
    );
    expect(leerBorrador(nombreDelBorrador())).toBeNull();
  });

  it("sin nada tipeado, vence igual y no guarda ningún borrador vacío", async () => {
    await render(<Pantalla campo={false} />);
    await pasar(15 * MINUTO);
    await expect.element(page.getByRole("dialog", { name: "Tu sesión venció" })).toBeVisible();
    expect(leerBorrador(nombreDelBorrador())).toEqual({});
  });

  it("renueva la cookie mientras se usa la pantalla: una vez cada 5 minutos como mucho, y solo si hubo uso", async () => {
    await render(<Pantalla />);
    // Sin uso no hay renovación silenciosa (el aviso llega a los 12 minutos).
    await pasar(4 * MINUTO);
    expect(pedidos).toHaveLength(0);
    await usar();
    await pasar(MINUTO); // 5 minutos desde que se montó
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe("/api/sesion/renovar");
    // Otro uso enseguida: todavía no pasaron 5 minutos desde la última renovación.
    await usar();
    await pasar(3 * MINUTO);
    expect(pedidos).toHaveLength(1);
    await pasar(2 * MINUTO);
    expect(pedidos).toHaveLength(2);
    // Sin uso desde entonces, no renueva más.
    await pasar(5 * MINUTO);
    expect(pedidos).toHaveLength(2);
  });

  it("si la renovación silenciosa recibe 401, la sesión ya no vale: aviso de vencida", async () => {
    await render(<Pantalla />);
    await usar();
    respuesta = { status: 401 };
    await pasar(5 * MINUTO);
    await expect.element(page.getByRole("dialog", { name: "Tu sesión venció" })).toBeVisible();
  });

  it("una renovación que falla por la red se reintenta en la vuelta siguiente (sin dar nada por renovado)", async () => {
    await render(<Pantalla />);
    await usar();
    respuesta = "red";
    await pasar(5 * MINUTO);
    expect(pedidos).toHaveLength(1);
    await usar();
    respuesta = { status: 200 };
    await pasar(MINUTO);
    expect(pedidos).toHaveLength(2);
  });

  it("la pantalla con el indicador de sesión no tiene violaciones de accesibilidad", async () => {
    vi.useRealTimers();
    await render(<Pantalla />);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});
