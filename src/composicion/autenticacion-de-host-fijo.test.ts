import { describe, expect, it, vi } from "vitest";
import { SIN_SESION_DE_PLATAFORMA } from "../capacidades/autenticacion/estado-de-sesion-de-plataforma";
import type { AutenticacionDePlataforma, SesionAutenticada } from "../puertos/autenticacion";
import { conHostFijo } from "./autenticacion-de-host-fijo";

/**
 * La autenticación de la consola atada a un host: con el host fijo delega TAL CUAL; con cualquier otro, «acá no hay
 * nada» y la de abajo ni se entera. Los dobles de la autenticación son espías: lo que se prueba es que no se los llama.
 */

const HOST = "consola.pedernal.test";
const OTROS = [
  "otra-consola.pedernal.test",
  "Consola.Pedernal.Test",
  "consola.pedernal.test.",
  "consola.pedernal.test:8443",
  "www.consola.pedernal.test",
  "pedernal.test",
  " consola.pedernal.test",
  "",
];

const SESION = { email: "admin@dominio-de-prueba.test" } as unknown as SesionAutenticada;
const ESTADO = {
  vigente: true,
  venceEnMs: 1234,
  motivo: "INACTIVIDAD",
  segundoFactorRecienteHastaMs: 0,
} as const;

function armar() {
  const respuesta = new Response("de la de abajo", { status: 200 });
  const base = {
    sesionDe: vi.fn(() => Promise.resolve(SESION)),
    manejar: vi.fn(() => Promise.resolve(respuesta)),
    estadoDeSesion: vi.fn(() => Promise.resolve(ESTADO)),
  } satisfies AutenticacionDePlataforma;
  return { base, respuesta, fija: conHostFijo(base, HOST) };
}

describe("conHostFijo: el host de la consola pasa tal cual", () => {
  it("sesionDe, manejar y estadoDeSesion delegan con el mismo pedido y el mismo host, y devuelven lo suyo", async () => {
    const { base, respuesta, fija } = armar();
    const pedido = { headers: new Headers({ cookie: "x=y" }) };
    const request = new Request(`https://${HOST}/api/auth/get-session`);

    expect(await fija.sesionDe(pedido, HOST)).toBe(SESION);
    expect(base.sesionDe).toHaveBeenCalledTimes(1);
    expect(base.sesionDe).toHaveBeenCalledWith(pedido, HOST);

    expect(await fija.manejar(request, HOST)).toBe(respuesta);
    expect(base.manejar).toHaveBeenCalledTimes(1);
    expect(base.manejar).toHaveBeenCalledWith(request, HOST);

    expect(await fija.estadoDeSesion(pedido, HOST)).toBe(ESTADO);
    expect(base.estadoDeSesion).toHaveBeenCalledTimes(1);
    expect(base.estadoDeSesion).toHaveBeenCalledWith(pedido, HOST);
  });
});

describe("conHostFijo: cualquier otro host recibe «acá no hay nada»", () => {
  it.each(OTROS)(
    "%j: ninguna sesión, ni estado, ni nada que atender; la de abajo no se llama",
    async (otro) => {
      const { base, fija } = armar();
      const pedido = { headers: new Headers({ cookie: "x=y" }) };

      expect(await fija.sesionDe(pedido, otro)).toBeNull();
      expect(await fija.estadoDeSesion(pedido, otro)).toEqual(SIN_SESION_DE_PLATAFORMA);

      const neutra = await fija.manejar(new Request(`https://${HOST}/api/auth/get-session`), otro);
      expect(neutra.status).toBe(404);
      expect(await neutra.text()).toBe("");
      expect(neutra.headers.get("cache-control")).toBe("private, no-store");
      expect(neutra.headers.get("x-robots-tag")).toBe("noindex");
      expect(neutra.headers.getSetCookie()).toEqual([]);

      expect(base.sesionDe).not.toHaveBeenCalled();
      expect(base.manejar).not.toHaveBeenCalled();
      expect(base.estadoDeSesion).not.toHaveBeenCalled();
    },
  );

  it("el host fijo es el de CADA armado: dos consolas con hosts distintos no se pisan", async () => {
    const { base } = armar();
    const otra = conHostFijo(base, "otra-consola.pedernal.test");
    expect(await otra.sesionDe({ headers: new Headers() }, HOST)).toBeNull();
    expect(await otra.sesionDe({ headers: new Headers() }, "otra-consola.pedernal.test")).toBe(
      SESION,
    );
  });
});
