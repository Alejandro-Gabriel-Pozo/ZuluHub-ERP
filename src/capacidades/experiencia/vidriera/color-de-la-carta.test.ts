import { describe, expect, it } from "vitest";
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COLOR_POR_DEFECTO_DE_LA_CARTA,
  CONTRASTE_MINIMO_DE_LA_CARTA,
  PALETAS_DE_LA_CARTA,
  colorDeLaCarta,
} from "./color-de-la-carta";
import { COLOR_RRGGBB } from "../../../primitivas/color/contraste";

const dar = (c: unknown) => {
  const r = colorDeLaCarta(c);
  if (!r.ok) throw new Error("se esperaba un color válido");
  return r.valor;
};

describe("colorDeLaCarta: valores exactos", () => {
  it("el mínimo de la carta es 7 a 1 (CYN 101 y 107)", () => {
    expect(CONTRASTE_MINIMO_DE_LA_CARTA).toBe(7);
  });

  it("negro y blanco: contraste máximo y texto opuesto, sin ajustar", () => {
    expect(dar("#000000")).toEqual({
      hex: "#000000",
      textoSobreColor: "BLANCO",
      ajustado: false,
      contraste: 21,
    });
    expect(dar("#ffffff")).toEqual({
      hex: "#ffffff",
      textoSobreColor: "NEGRO",
      ajustado: false,
      contraste: 21,
    });
  });

  it("un color oscuro que ya llega no cambia (Azul de la paleta)", () => {
    const r = dar("#1f4e79");
    expect(r.hex).toBe("#1f4e79");
    expect(r.ajustado).toBe(false);
    expect(r.textoSobreColor).toBe("BLANCO");
    expect(r.contraste).toBeGreaterThanOrEqual(7);
  });

  it("normaliza mayúsculas a minúsculas sin marcarlo como ajuste", () => {
    expect(dar("#1F4E79")).toEqual(dar("#1f4e79"));
  });

  it("el ejemplo del aviso (#0e7490) no llega a 7:1: se oscurece, conserva el tono y queda en 7 o más", () => {
    const r = dar("#0e7490");
    expect(r.ajustado).toBe(true);
    expect(r.hex).not.toBe("#0e7490");
    expect(r.textoSobreColor).toBe("BLANCO");
    expect(r.contraste).toBeGreaterThanOrEqual(7);
  });

  it("amarillo puro ya se lee con texto negro (19 a 1): no se toca", () => {
    const r = dar("#ffff00");
    expect(r.ajustado).toBe(false);
    expect(r.textoSobreColor).toBe("NEGRO");
    expect(r.contraste).toBeGreaterThanOrEqual(7);
  });

  it("un gris medio (#808080) no llega con ninguno de los dos textos: se oscurece y pasa a texto blanco", () => {
    const r = dar("#808080");
    expect(r.ajustado).toBe(true);
    expect(r.textoSobreColor).toBe("BLANCO");
    expect(r.contraste).toBeGreaterThanOrEqual(7);
  });

  it("el contraste informado se trunca, no se redondea hacia arriba", () => {
    // gris medio: 7,00 exacto no existe; el informado nunca supera al real.
    const r = dar("#595959");
    expect(r.contraste).toBeLessThanOrEqual(7.0 + 0.5);
    expect(Number.isFinite(r.contraste)).toBe(true);
  });
});

describe("colorDeLaCarta: lo que no es `#` + 6 hexadecimales se rechaza (lista de permitidos)", () => {
  const invalidos: unknown[] = [
    "",
    "#fff",
    "fff",
    "1f4e79",
    "#1f4e7",
    "#1f4e790",
    "#1f4e7g",
    " #1f4e79",
    "#1f4e79 ",
    "#1f4e79\n",
    "rgb(1,2,3)",
    "url(x)",
    "red",
    "#ÀÀÀÀÀÀ",
    "＃1f4e79",
    "#1f4e79\u0000",
    null,
    undefined,
    123,
    {},
    [],
    true,
  ];
  it.each(invalidos.map((v) => [JSON.stringify(v) ?? String(v), v] as const))(
    "rechaza %s",
    (_n, v) => {
      expect(colorDeLaCarta(v)).toEqual({
        ok: false,
        error: { codigo: "COLOR_DE_CARTA_INVALIDO" },
      });
    },
  );

  it("no lanza con entradas hostiles", () => {
    expect(() => colorDeLaCarta(Symbol("x"))).not.toThrow();
    expect(() => colorDeLaCarta("İİİİİİİ")).not.toThrow();
    expect(() => colorDeLaCarta("K".repeat(7))).not.toThrow();
  });
});

describe("PALETAS_DE_LA_CARTA: las seis de la maqueta carta.html", () => {
  it("son exactamente esas seis, en ese orden, con su clave y su color", () => {
    expect(PALETAS_DE_LA_CARTA).toEqual([
      { clave: "azul", hex: "#1f4e79" },
      { clave: "verde", hex: "#17562f" },
      { clave: "bordo", hex: "#7a1f2b" },
      { clave: "tostado", hex: "#6b3f1d" },
      { clave: "negro", hex: "#1b1f24" },
      { clave: "violeta", hex: "#4b2e83" },
    ]);
  });

  it("cada color tiene la forma #rrggbb, llega al contraste mínimo tal cual (no se ajusta) y ninguna se repite", () => {
    for (const { clave, hex } of PALETAS_DE_LA_CARTA) {
      expect(COLOR_RRGGBB.test(hex), clave).toBe(true);
      expect(dar(hex), clave).toMatchObject({ hex, ajustado: false });
    }
    expect(new Set(PALETAS_DE_LA_CARTA.map((p) => p.hex)).size).toBe(6);
    expect(new Set(PALETAS_DE_LA_CARTA.map((p) => p.clave)).size).toBe(6);
  });
});

describe("COLOR_POR_DEFECTO_DE_LA_CARTA: una regla, un lugar", () => {
  it("es el primer color de las paletas (el azul de la maqueta)", () => {
    expect(COLOR_POR_DEFECTO_DE_LA_CARTA).toBe(PALETAS_DE_LA_CARTA[0].hex);
    expect(COLOR_POR_DEFECTO_DE_LA_CARTA).toBe("#1f4e79");
  });

  it("el azul `#1f4e79` está escrito UNA sola vez en el código de la carta (no se repite en otro archivo ni en la plantilla): sale de la lista de paletas", () => {
    const RAIZ = join(import.meta.dirname, "../../../..");
    const archivos = [
      ...globSync("src/capacidades/experiencia/vidriera/*.ts", { cwd: RAIZ }),
      ...globSync("apps/web/ui/plantillas/carta/*.{ts,tsx}", { cwd: RAIZ }),
      ...globSync("apps/web/ui/plantillas/vidriera/*.{ts,tsx}", { cwd: RAIZ }),
    ].filter((archivo) => !/\.test\.tsx?$/.test(archivo) && !archivo.endsWith("datosDePrueba.ts"));
    const escritos = archivos.filter((archivo) =>
      readFileSync(join(RAIZ, archivo), "utf8").includes("#1f4e79"),
    );
    expect(escritos.sort()).toEqual(["src/capacidades/experiencia/vidriera/color-de-la-carta.ts"]);
    // Una vez en la lista; las otras son los comentarios que lo nombran.
    expect(
      readFileSync(join(RAIZ, escritos[0] as string), "utf8")
        .split("\n")
        .filter((linea) => linea.includes('"#1f4e79"')),
    ).toHaveLength(1);
  });
});
