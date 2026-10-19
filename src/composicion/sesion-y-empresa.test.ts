import { describe, expect, it } from "vitest";
import { ENCABEZADO_DE_IP } from "../capacidades/autenticacion/host-de-autenticacion";
import type { Autenticacion } from "../puertos/autenticacion";
import { cerrarSesion, type DependenciasDeSesion } from "./sesion-y-empresa";

/**
 * S3: qué encabezados del pedido de la persona llegan a la librería de ingreso. La IP de su límite de
 * intentos sale SOLO del encabezado de confianza; `x-forwarded-for` (que un cliente puede falsear) no se copia.
 */
describe("encabezados que se copian al pedido de la librería", () => {
  async function loQueRecibeLaLibreria(entrada: Record<string, string>): Promise<Headers> {
    let recibido: Headers | null = null;
    const autenticacion: Autenticacion = {
      sesionDe: () => Promise.resolve(null),
      manejar: (pedido) => {
        recibido = pedido.headers;
        return Promise.resolve(new Response(null, { status: 200 }));
      },
    };
    const d = { autenticacion: () => autenticacion } as unknown as DependenciasDeSesion;
    await cerrarSesion(d, { host: "app.marca-a.test", encabezados: new Headers(entrada) });
    if (recibido === null) throw new Error("la librería no recibió el pedido");
    return recibido;
  }

  it("copia la cookie, el agente y el encabezado de IP de confianza", async () => {
    const h = await loQueRecibeLaLibreria({
      cookie: "a=b",
      "user-agent": "navegador",
      [ENCABEZADO_DE_IP]: "198.51.100.7",
    });
    expect(h.get("cookie")).toBe("a=b");
    expect(h.get("user-agent")).toBe("navegador");
    expect(h.get(ENCABEZADO_DE_IP)).toBe("198.51.100.7");
  });

  it("no copia x-forwarded-for ni otros encabezados de IP que manda el cliente", async () => {
    const h = await loQueRecibeLaLibreria({
      cookie: "a=b",
      "x-forwarded-for": "203.0.113.9",
      "x-real-ip": "203.0.113.9",
      "x-forwarded-host": "ajeno.test",
    });
    expect(h.has("x-forwarded-for")).toBe(false);
    expect(h.has("x-real-ip")).toBe(false);
    expect(h.has("x-forwarded-host")).toBe(false);
    expect(h.get("origin")).toBe("https://app.marca-a.test");
  });
});
