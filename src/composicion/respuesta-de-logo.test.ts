import { describe, expect, it } from "vitest";
import {
  CABECERAS_DEL_LOGO_SERVIDO,
  respuestaDeFalloDelLogo,
  respuestaDelLogo,
} from "./respuesta-de-logo";

const cabecerasDe = (r: Response): Record<string, string> =>
  Object.fromEntries(r.headers.entries());

describe("respuestaDelLogo", () => {
  it("con los bytes: 200, la imagen tal cual y solo las cabeceras del logo servido", async () => {
    const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3]);
    const r = respuestaDelLogo(bytes);
    expect(r.status).toBe(200);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes);
    expect(cabecerasDe(r)).toEqual({
      "content-type": "image/webp",
      "x-content-type-options": "nosniff",
      "cache-control": "public, max-age=86400",
      "content-length": "7",
    });
  });

  it("las cabeceras del logo servido son las del spec (un día de caché; el tipo no se adivina)", () => {
    expect(CABECERAS_DEL_LOGO_SERVIDO).toEqual({
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=86400",
    });
  });

  it("sin bytes: 404 plano, sin cuerpo, que nadie guarda y sin ninguna pista", async () => {
    const r = respuestaDelLogo(null);
    expect(r.status).toBe(404);
    expect(await r.text()).toBe("");
    expect(cabecerasDe(r)).toEqual({ "cache-control": "private, no-store" });
  });

  it("el largo es el de los bytes, no el de un texto", () => {
    expect(cabecerasDe(respuestaDelLogo(new Uint8Array(1_234)))["content-length"]).toBe("1234");
  });

  it("un fallo es un 500 sin cuerpo y sin guardarse (no se disfraza de «no está»)", async () => {
    const r = respuestaDeFalloDelLogo();
    expect(r.status).toBe(500);
    expect(await r.text()).toBe("");
    expect(cabecerasDe(r)).toEqual({ "cache-control": "private, no-store" });
  });

  it("solo el 200 de la imagen es guardable: ninguna otra respuesta lleva `public`", () => {
    for (const r of [respuestaDelLogo(null), respuestaDeFalloDelLogo()]) {
      expect(r.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(respuestaDelLogo(new Uint8Array(1)).headers.get("cache-control")).toBe(
      "public, max-age=86400",
    );
    for (const r of [
      respuestaDelLogo(null),
      respuestaDelLogo(new Uint8Array(1)),
      respuestaDeFalloDelLogo(),
    ]) {
      expect(r.headers.has("set-cookie")).toBe(false);
      expect(r.headers.has("vary")).toBe(false);
    }
  });
});
