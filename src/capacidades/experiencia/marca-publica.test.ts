import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ConfiguracionPublicaDeMarca } from "../../puertos/marcas";
import { marcaPublicaDe } from "./marca-publica";
import { VARIABLES_DE_MARCA, cssDeTema } from "./tema-css";

const COMPLETO = {
  primary: "#112233",
  "on-primary": "#ffffff",
  secondary: "#445566",
  accent: "#aabbcc",
} as const;
const config = (
  parcial: Partial<ConfiguracionPublicaDeMarca> = {},
): ConfiguracionPublicaDeMarca => ({
  nombre: "Hotel del Lago",
  tema: COMPLETO,
  hostCanonico: "app.hoteldellago.test",
  ...parcial,
});

describe("marcaPublicaDe", () => {
  it("una configuración completa pasa tal cual, con el host canónico como host de la app", () => {
    expect(marcaPublicaDe(config())).toEqual({
      nombre: "Hotel del Lago",
      tema: COMPLETO,
      hostDeApp: "app.hoteldellago.test",
    });
  });

  it("sin host canónico, sin host de app", () => {
    expect(marcaPublicaDe(config({ hostCanonico: null }))?.hostDeApp).toBeNull();
  });

  it("un tema incompleto queda incompleto (rigen los neutros), sin inventar tokens", () => {
    expect(marcaPublicaDe(config({ tema: { accent: "#aabbcc" } }))?.tema).toEqual({
      accent: "#aabbcc",
    });
    expect(marcaPublicaDe(config({ tema: {} }))?.tema).toEqual({});
  });

  it("descarta claves ajenas, valores que no son #rrggbb y claves heredadas", () => {
    const sucio = Object.assign(Object.create({ primary: "#010101" }) as object, {
      "on-primary": "red",
      secondary: "#445566;}body{display:none",
      accent: "#AABBCC",
      fondo: "#000000",
      __proto__x: "#000000",
    }) as ConfiguracionPublicaDeMarca["tema"];
    expect(marcaPublicaDe(config({ tema: sucio }))?.tema).toEqual({});
  });

  it.each(["", "   ", "\t\n"])("un nombre vacío (%j) no es una marca: null", (nombre) => {
    expect(marcaPublicaDe(config({ nombre }))).toBeNull();
  });

  it("el nombre no se recorta ni se altera", () => {
    expect(marcaPublicaDe(config({ nombre: "  Los Pinos " }))?.nombre).toBe("  Los Pinos ");
  });

  it("propiedad: el tema que sale es siempre un subconjunto de los cuatro tokens con #rrggbb, y el CSS lo escribe entero", () => {
    const valor = fc.oneof(
      fc.stringMatching(/^#[0-9a-f]{6}$/),
      fc.string(),
      fc.constantFrom("#FFF", "#12345g", "url(x)", "#aabbcc}"),
    );
    const clave = fc.constantFrom(...VARIABLES_DE_MARCA, "fondo", "constructor", "toString");
    fc.assert(
      fc.property(fc.dictionary(clave, valor), (tema) => {
        const marca = marcaPublicaDe(config({ tema }));
        const salida = marca?.tema ?? {};
        for (const [k, v] of Object.entries(salida)) {
          expect(VARIABLES_DE_MARCA as readonly string[]).toContain(k);
          expect(v).toMatch(/^#[0-9a-f]{6}$/);
          expect(tema[k as keyof typeof tema]).toBe(v);
        }
        // Todo token válido de la entrada sale (nada válido se pierde).
        for (const k of VARIABLES_DE_MARCA) {
          const entrada = tema[k];
          if (entrada !== undefined && /^#[0-9a-f]{6}$/.test(entrada))
            expect(salida[k]).toBe(entrada);
        }
        expect(cssDeTema(salida)).toBe(cssDeTema(tema));
      }),
    );
  });
});
