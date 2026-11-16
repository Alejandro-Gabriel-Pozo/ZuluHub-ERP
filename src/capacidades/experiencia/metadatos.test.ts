import { describe, expect, it } from "vitest";
import {
  LARGO_MAXIMO_DEL_LUGAR_DE_CARTA,
  LARGO_MAXIMO_DEL_NOMBRE_DE_CARTA,
  LARGO_MAXIMO_DEL_RUBRO_DE_CARTA,
} from "../../primitivas/texto/datos-de-carta-publica";
import {
  ANCHO_MINIMO_DE_IMAGEN_PARA_COMPARTIR,
  LARGO_DE_LA_DESCRIPCION_DE_PAGINA,
  LARGO_DEL_TITULO_DE_PAGINA,
  acortar,
  metadatosDePagina,
  type EntradaDeMetadatos,
} from "./metadatos";

const CARTA = {
  tipo: "CARTA",
  nombre: "Los Andecitos",
  rubro: "Cafetería de especialidad",
  lugar: "Huinganco, Neuquén",
} as const;

const base = (cambios: Partial<EntradaDeMetadatos> = {}): EntradaDeMetadatos => ({
  pagina: CARTA,
  sitio: "Hostería Los Andes",
  host: "carta.hosteriaandes.com.ar",
  ruta: "/q7H2xk9Pq7H2xk9Pq7H2xk",
  superficieIndexable: false,
  imagen: null,
  ...cambios,
});

describe("metadatosDePagina: carta", () => {
  it("título «nombre · sitio» y descripción con rubro y lugar (maqueta seo-y-metadatos)", () => {
    const m = metadatosDePagina(base());
    expect(m.titulo).toBe("Los Andecitos · Hostería Los Andes");
    expect(m.descripcion).toBe(
      "Carta de Los Andecitos, Cafetería de especialidad en Huinganco, Neuquén.",
    );
    expect(m.canonica).toBe("https://carta.hosteriaandes.com.ar/q7H2xk9Pq7H2xk9Pq7H2xk");
    expect(m.idioma).toBe("es_AR");
  });

  it.each([
    [null, null, "Carta de Los Andecitos."],
    ["Parrilla", null, "Carta de Los Andecitos, Parrilla."],
    [null, "Huinganco", "Carta de Los Andecitos en Huinganco."],
    ["  ", "  ", "Carta de Los Andecitos."],
  ])("rubro %j y lugar %j: %s", (rubro, lugar, esperado) => {
    expect(metadatosDePagina(base({ pagina: { ...CARTA, rubro, lugar } })).descripcion).toBe(
      esperado,
    );
  });

  it("con los topes de la primitiva, el título y la descripción nunca pasan lo que muestra Google", () => {
    const pagina = {
      tipo: "CARTA",
      nombre: "N".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_CARTA),
      rubro: "R".repeat(LARGO_MAXIMO_DEL_RUBRO_DE_CARTA),
      lugar: "L".repeat(LARGO_MAXIMO_DEL_LUGAR_DE_CARTA),
    } as const;
    const m = metadatosDePagina(base({ pagina }));
    expect([...m.titulo].length).toBe(LARGO_DEL_TITULO_DE_PAGINA);
    expect(m.titulo.endsWith("…")).toBe(true);
    expect([...(m.descripcion ?? "")].length).toBe(LARGO_DE_LA_DESCRIPCION_DE_PAGINA);
  });

  it("no corta un carácter fuera del plano básico a la mitad", () => {
    const corto = acortar("😀".repeat(10), 5);
    expect([...corto]).toEqual([..."😀😀😀😀", "…"]);
  });

  it("la canónica sale del host y la ruta dados, sin consulta", () => {
    expect(metadatosDePagina(base({ host: "otra.test", ruta: "/" })).canonica).toBe(
      "https://otra.test/",
    );
  });
});

describe("metadatosDePagina: indexable", () => {
  it("la carta toma lo que decide la única regla (esIndexable); no lo inventa", () => {
    expect(metadatosDePagina(base({ superficieIndexable: false })).indexable).toBe(false);
    expect(metadatosDePagina(base({ superficieIndexable: true })).indexable).toBe(true);
  });

  it("un producto nunca se indexa, aunque la superficie lo permita, y no trae descripción", () => {
    const m = metadatosDePagina(
      base({
        pagina: {
          tipo: "PRODUCTO",
          nombreDelProducto: "Milanesa",
          nombreDeLaCarta: "Los Andecitos",
        },
        superficieIndexable: true,
      }),
    );
    expect(m.indexable).toBe(false);
    expect(m.titulo).toBe("Milanesa · Los Andecitos");
    expect(m.descripcion).toBeNull();
  });
});

describe("metadatosDePagina: imagen para compartir", () => {
  const logo = (ancho: number, url = "https://carta.hosteriaandes.com.ar/logo.png") => ({
    url,
    ancho,
  });

  it("el logo que llega al ancho mínimo se usa", () => {
    const l = logo(ANCHO_MINIMO_DE_IMAGEN_PARA_COMPARTIR);
    expect(metadatosDePagina(base({ imagen: l })).imagen).toEqual(l);
  });

  it.each([
    ["una de ancho menor al mínimo", logo(ANCHO_MINIMO_DE_IMAGEN_PARA_COMPARTIR - 1)],
    ["una de ancho no entero", logo(300.5)],
    ["una que no es https", logo(600, "http://x.test/logo.png")],
    ["una con consulta", logo(600, "https://x.test/logo.png?v=1")],
    ["una que no es una dirección", logo(600, "logo.png")],
    ["ninguna", null],
  ])("sin imagen cuando hay %s", (_motivo, imagen) => {
    expect(metadatosDePagina(base({ imagen })).imagen).toBeNull();
  });
});

describe("metadatosDePagina: aislamiento por empresa", () => {
  it("solo usa lo que recibe: dos cartas en el mismo despliegue no se mezclan", () => {
    const a = metadatosDePagina(
      base({
        pagina: { ...CARTA, nombre: "Carta A", rubro: "RubroA", lugar: "LugarA" },
        sitio: "MarcaA",
        host: "a.test",
      }),
    );
    const b = metadatosDePagina(
      base({
        pagina: { ...CARTA, nombre: "Carta B", rubro: "RubroB", lugar: "LugarB" },
        sitio: "MarcaB",
        host: "b.test",
      }),
    );
    const textoDeA = JSON.stringify(a);
    for (const ajeno of ["Carta B", "RubroB", "LugarB", "MarcaB", "b.test"]) {
      expect(textoDeA).not.toContain(ajeno);
    }
    expect(JSON.stringify(b)).not.toContain("A.");
  });

  it("es una función pura: la misma entrada da lo mismo", () => {
    expect(metadatosDePagina(base())).toEqual(metadatosDePagina(base()));
  });
});
