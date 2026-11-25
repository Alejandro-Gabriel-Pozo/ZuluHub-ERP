import { describe, expect, it } from "vitest";
import { leerHostsProtegidos, MAXIMO_DE_HOSTS_PROTEGIDOS } from "./hosts-protegidos";

const LISTA_INVALIDA = { ok: false, error: "LISTA_DE_HOSTS_PROTEGIDOS_INVALIDA" };

describe("leerHostsProtegidos", () => {
  it("lee una lista separada por comas, normalizada (minúsculas, sin blancos, sin punto final)", () => {
    const r = leerHostsProtegidos(
      " Consola.Pedernal.test , app.pedernal.test. ,landing.pedernal.test",
    );
    expect(r.ok && [...r.valor]).toEqual([
      "consola.pedernal.test",
      "app.pedernal.test",
      "landing.pedernal.test",
    ]);
  });

  it("falla cerrado: vacía, con elementos vacíos, repetidos o que no son un host", () => {
    for (const texto of [
      "",
      " ",
      "a.test,",
      ",a.test",
      "a.test,,b.test",
      "a.test,A.TEST",
      "a.test,b c.test",
      "https://a.test",
      "a.test/ruta",
      "127.0.0.1",
      "*.a.test",
    ]) {
      expect(leerHostsProtegidos(texto), texto).toEqual(LISTA_INVALIDA);
    }
  });

  it("rechaza una lista más larga que el máximo", () => {
    const larga = Array.from({ length: MAXIMO_DE_HOSTS_PROTEGIDOS + 1 }, (_, i) => `h${i}.a.test`);
    expect(leerHostsProtegidos(larga.join(","))).toEqual(LISTA_INVALIDA);
    expect(leerHostsProtegidos(larga.slice(0, MAXIMO_DE_HOSTS_PROTEGIDOS).join(",")).ok).toBe(true);
  });
});
