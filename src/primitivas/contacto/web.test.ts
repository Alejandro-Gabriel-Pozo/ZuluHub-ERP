import { describe, expect, it } from "vitest";
import {
  LARGO_MAXIMO_DE_LA_WEB,
  enlaceDeLaWeb,
  webDesdeTexto,
  webParaImprimir,
  type SitioWeb,
} from "./web";

const MALA = { ok: false, error: "WEB_INVALIDA" } as const;
const guardada = (texto: string): string => {
  const r = webDesdeTexto(texto);
  if (!r.ok) throw new Error(`debía ser válida: ${texto}`);
  return r.valor;
};

describe("web: la forma canónica (sin esquema)", () => {
  it("con o sin http:// / https://, queda sin esquema", () => {
    for (const entrada of [
      "www.hotelcentro.com",
      "http://www.hotelcentro.com",
      "https://www.hotelcentro.com",
      "HTTPS://www.hotelcentro.com",
      "Http://WWW.HotelCentro.COM",
    ]) {
      expect(webDesdeTexto(entrada), entrada).toEqual({ ok: true, valor: "www.hotelcentro.com" });
    }
  });

  it("recorta los extremos, pasa el host a minúsculas y deja la ruta como se escribió", () => {
    expect(guardada("  HOTEL.com/Centro/Menu?x=Y#Z  ")).toBe("hotel.com/Centro/Menu?x=Y#Z");
    expect(guardada("hotel.com:8080/x")).toBe("hotel.com:8080/x");
    expect(guardada("a-b.hotel1.com.ar")).toBe("a-b.hotel1.com.ar");
  });

  it("saca la barra final solo cuando no hay más que el host", () => {
    expect(guardada("https://hotel.com/")).toBe("hotel.com");
    expect(guardada("hotel.com:8080/")).toBe("hotel.com:8080");
    expect(guardada("hotel.com/centro/")).toBe("hotel.com/centro/");
    expect(guardada("hotel.com//")).toBe("hotel.com//");
    expect(guardada("hotel.com/?a=1")).toBe("hotel.com/?a=1");
  });

  it("es idempotente: lo guardado vuelve a dar lo mismo (las superficies pueden volver a pasarlo)", () => {
    for (const entrada of ["HTTPS://Hotel.com/", "hotel.com/Centro", "x.y.z:81/a?b#c"]) {
      const una = guardada(entrada);
      expect(guardada(una)).toBe(una);
    }
  });
});

describe("web: lo que se rechaza", () => {
  it("vacío, solo el esquema o sin un dominio con punto", () => {
    for (const mala of [
      "",
      "   ",
      "https://",
      "http://",
      "hotel",
      "localhost",
      "https:///x.com",
      "/x.com",
      ".com",
      "hotel..com",
      "-a.com",
      "a-.com",
    ]) {
      expect(webDesdeTexto(mala), JSON.stringify(mala)).toEqual(MALA);
    }
  });

  it("cualquier otro esquema (seguridad del enlace): ftp, javascript, data, mailto, file, vbscript, blob…", () => {
    for (const mala of [
      "ftp://hotel.com",
      "javascript:alert(1)",
      "JavaScript:alert(1)//hotel.com",
      "javascript://hotel.com/%0Aalert(1)",
      "data:text/html,<script>alert(1)</script>",
      "mailto:a@hotel.com",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
      "blob:https://hotel.com/x",
      "ws://hotel.com",
      "http:hotel.com",
      "https://https://hotel.com",
      "//hotel.com",
    ]) {
      expect(webDesdeTexto(mala), mala).toEqual(MALA);
    }
  });

  it("usuario y contraseña, puertos raros, blancos y caracteres de control", () => {
    for (const mala of [
      "https://user:pass@hotel.com",
      "user@hotel.com",
      "hotel.com:80@evil.com",
      "hotel.com:abc",
      "hotel.com:123456",
      "ho tel.com",
      "hotel.com/ruta con espacio",
      "https://hotel.com/a\nb",
      "hotel.com/a\u0085b",
      "hotel.com/a\u0000b",
      "hotel\\.com",
      "hotel.com\\evil",
      "hotéñ.com",
    ]) {
      expect(webDesdeTexto(mala), JSON.stringify(mala)).toEqual(MALA);
    }
  });
});

describe("web: el borde de largo se mide con el esquema ya quitado", () => {
  const de = (n: number) => `${"a".repeat(n - 4)}.com`;

  it("200 caracteres canónicos entran, con o sin esquema; 201 no", () => {
    expect(webDesdeTexto(de(LARGO_MAXIMO_DE_LA_WEB)).ok).toBe(true);
    expect(webDesdeTexto(`https://${de(LARGO_MAXIMO_DE_LA_WEB)}`).ok).toBe(true);
    expect(webDesdeTexto(de(LARGO_MAXIMO_DE_LA_WEB + 1))).toEqual(MALA);
    expect(webDesdeTexto(`https://${de(LARGO_MAXIMO_DE_LA_WEB + 1)}`)).toEqual(MALA);
  });

  it("la barra final sacada no cuenta: host de 200 + «/» entra", () => {
    expect(webDesdeTexto(`${de(LARGO_MAXIMO_DE_LA_WEB)}/`).ok).toBe(true);
  });
});

describe("web: cómo se muestra (D-99)", () => {
  const web = guardada("https://WWW.HotelCentro.com/") as SitioWeb;

  it("en papel va sin esquema", () => {
    expect(webParaImprimir(web)).toBe("www.hotelcentro.com");
  });

  it("donde el medio permite un enlace, es https:// + el valor (SUPUESTO: siempre https)", () => {
    expect(enlaceDeLaWeb(web)).toBe("https://www.hotelcentro.com");
    expect(enlaceDeLaWeb(guardada("http://hotel.com/Centro?x=1") as SitioWeb)).toBe(
      "https://hotel.com/Centro?x=1",
    );
  });

  it("el enlace nunca arranca con otro esquema, entre cualquier entrada válida (propiedad sobre ejemplos)", () => {
    for (const entrada of ["a.com", "HTTP://a.com/x", "a.com:81/#h"]) {
      expect(enlaceDeLaWeb(guardada(entrada) as SitioWeb)).toMatch(/^https:\/\/[a-z0-9]/);
    }
  });
});
