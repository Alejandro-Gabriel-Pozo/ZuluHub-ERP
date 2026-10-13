import { describe, expect, it } from "vitest";
import {
  LARGO_DEL_SUFIJO,
  LARGO_DEL_SUFIJO_ALARGADO,
  LARGO_MAXIMO_DEL_SLUG,
  SLUG_POR_DEFECTO,
  direccionDeProducto,
  direccionesDeCarta,
  huellaDeProducto,
  resolverProductoPorSegmento,
  slugDeNombre,
} from "./direccion";

const CARTA = "00000003-0000-4000-8000-000000000001";
const OTRA_CARTA = "00000003-0000-4000-8000-000000000002";
const P1 = "00000001-0000-4000-8000-000000000001";
const P2 = "00000001-0000-4000-8000-000000000002";
// Dos productos REALES de CARTA cuyo sufijo de 8 caracteres es el mismo (buscados por fuerza bruta).
const CHOCAN_A = "000000c0-0000-4000-8000-00000000295b";
const CHOCAN_B = "000000c0-0000-4000-8000-000000011b1d";

describe("slugDeNombre (§3.3)", () => {
  it.each([
    ["Café con leche", "cafe-con-leche"],
    ["  Ñoquis de calabaza  ", "noquis-de-calabaza"],
    ["Medialunas (3)", "medialunas-3"],
    ["¡Tostado --- completo!", "tostado-completo"],
    ["CAPUCHINO", "capuchino"],
    ["Crème brûlée", "creme-brulee"],
    ["ＡＢＣ １２３", "abc-123"],
    ["İstanbul", "istanbul"],
    ["Pan 100% integral", "pan-100-integral"],
    ["a_b/c\\d.e", "a-b-c-d-e"],
  ])("%j → %j", (nombre, esperado) => {
    expect(slugDeNombre(nombre)).toBe(esperado);
  });

  it.each(["", "   ", "🍕", "***", "---", "日本語"])("%j no deja nada: es «producto»", (nombre) => {
    expect(slugDeNombre(nombre)).toBe(SLUG_POR_DEFECTO);
    expect(SLUG_POR_DEFECTO).toBe("producto");
  });

  it("corta en 60 caracteres y no deja un guion colgado", () => {
    expect(LARGO_MAXIMO_DEL_SLUG).toBe(60);
    const sesenta = "a".repeat(60);
    expect(slugDeNombre(sesenta)).toBe(sesenta);
    expect(slugDeNombre(`${sesenta}b`)).toBe(sesenta);
    // El guion cae justo en el caracter 61: el corte deja 60 letras y no hay guion al final.
    expect(slugDeNombre(`${sesenta} cde`)).toBe(sesenta);
    // El guion cae en el 60: se quita.
    const conGuion = `${"a".repeat(59)} b`;
    expect(slugDeNombre(conGuion)).toBe("a".repeat(59));
  });

  it("es idempotente en los casos de borde", () => {
    for (const nombre of ["Café con leche", "", "🍕", `${"a".repeat(59)} b`, "İİİ"]) {
      expect(slugDeNombre(slugDeNombre(nombre))).toBe(slugDeNombre(nombre));
    }
  });
});

describe("huellaDeProducto", () => {
  it("golden: los primeros caracteres de SHA-256(«producto-de-carta:» ‖ carta ‖ producto)", () => {
    expect(huellaDeProducto(CARTA, P1)).toBe("989b7d2c");
    expect(huellaDeProducto(CARTA, P1, LARGO_DEL_SUFIJO)).toBe("989b7d2c");
    expect(huellaDeProducto(CARTA, P1, LARGO_DEL_SUFIJO_ALARGADO)).toBe("989b7d2ce175");
    expect(huellaDeProducto(CARTA, P2)).toBe("1fca518a");
    expect(huellaDeProducto(OTRA_CARTA, P1)).toBe("814c2e57");
  });

  it("los largos son 8 y 12", () => {
    expect(LARGO_DEL_SUFIJO).toBe(8);
    expect(LARGO_DEL_SUFIJO_ALARGADO).toBe(12);
  });
});

describe("direccionDeProducto", () => {
  it("arma <slug>-<h8>", () => {
    expect(direccionDeProducto(CARTA, { productoId: P1, nombre: "Café con leche" })).toEqual({
      slug: "cafe-con-leche",
      h8: "989b7d2c",
      segmento: "cafe-con-leche-989b7d2c",
    });
  });

  it("el sufijo no cambia con el nombre (estable ante un renombre)", () => {
    const antes = direccionDeProducto(CARTA, { productoId: P1, nombre: "Café con leche" });
    const despues = direccionDeProducto(CARTA, { productoId: P1, nombre: "Café con leche grande" });
    expect(despues.h8).toBe(antes.h8);
    expect(despues.slug).not.toBe(antes.slug);
  });

  it("el mismo producto en otra carta tiene otro sufijo", () => {
    expect(direccionDeProducto(OTRA_CARTA, { productoId: P1, nombre: "x" }).h8).not.toBe(
      "989b7d2c",
    );
  });

  it("no lleva ningún id interno", () => {
    const { segmento } = direccionDeProducto(CARTA, { productoId: P1, nombre: "Café" });
    expect(segmento).not.toContain(P1);
    expect(segmento).not.toContain(CARTA);
    expect(segmento).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

describe("direccionesDeCarta: choques de sufijo", () => {
  it("sin choque, todas llevan el sufijo de 8 y respetan el orden", () => {
    const d = direccionesDeCarta(CARTA, [
      { productoId: P1, nombre: "Café" },
      { productoId: P2, nombre: "Café" },
    ]);
    expect(d.map((x) => x.segmento)).toEqual(["cafe-989b7d2c", "cafe-1fca518a"]);
  });

  it("dos productos que comparten sufijo de 8 (choque real) se alargan a 12 los DOS", () => {
    expect(huellaDeProducto(CARTA, CHOCAN_A)).toBe(huellaDeProducto(CARTA, CHOCAN_B));
    const d = direccionesDeCarta(CARTA, [
      { productoId: CHOCAN_A, nombre: "Pan" },
      { productoId: P1, nombre: "Pan" },
      { productoId: CHOCAN_B, nombre: "Pan" },
    ]);
    expect(d.map((x) => x.h8)).toEqual([
      "1ad235dffd68".replace("fd68", "87c4"),
      "989b7d2c",
      "1ad235dffd68",
    ]);
    expect(new Set(d.map((x) => x.segmento)).size).toBe(3);
  });

  it("una carta vacía no tiene direcciones", () => {
    expect(direccionesDeCarta(CARTA, [])).toEqual([]);
  });
});

describe("resolverProductoPorSegmento (resolución por sufijo)", () => {
  const productos = [
    { productoId: P1, nombre: "Café con leche" },
    { productoId: P2, nombre: "Tostado" },
  ];

  it("encuentra el producto por su dirección actual, sin redirigir", () => {
    const r = resolverProductoPorSegmento(CARTA, productos, "cafe-con-leche-989b7d2c");
    expect(r).toEqual({
      ok: true,
      valor: {
        productoId: P1,
        direccion: { slug: "cafe-con-leche", h8: "989b7d2c", segmento: "cafe-con-leche-989b7d2c" },
        redirigir: false,
      },
    });
  });

  it("un enlace viejo (otro slug) resuelve el mismo producto y pide 307 a la dirección actual", () => {
    const r = resolverProductoPorSegmento(CARTA, productos, "cafe-989b7d2c");
    expect(r.ok && r.valor.productoId).toBe(P1);
    expect(r.ok && r.valor.redirigir).toBe(true);
    expect(r.ok && r.valor.direccion.segmento).toBe("cafe-con-leche-989b7d2c");
  });

  it("el slug no decide: con cualquier slug y el mismo sufijo es el mismo producto", () => {
    const r = resolverProductoPorSegmento(CARTA, productos, "nada-que-ver-1fca518a");
    expect(r.ok && r.valor.productoId).toBe(P2);
  });

  it("acepta el sufijo de 12 aunque la dirección actual sea de 8, y redirige", () => {
    const r = resolverProductoPorSegmento(CARTA, productos, "cafe-con-leche-989b7d2ce175");
    expect(r.ok && r.valor.productoId).toBe(P1);
    expect(r.ok && r.valor.redirigir).toBe(true);
  });

  it("un sufijo que no es de ninguno es producto no encontrado", () => {
    expect(resolverProductoPorSegmento(CARTA, productos, "cafe-00000000")).toEqual({
      ok: false,
      error: "PRODUCTO_NO_ENCONTRADO",
    });
  });

  it("el sufijo de otra carta no resuelve", () => {
    expect(resolverProductoPorSegmento(OTRA_CARTA, productos, "cafe-989b7d2c")).toEqual({
      ok: false,
      error: "PRODUCTO_NO_ENCONTRADO",
    });
  });

  it.each([
    "",
    "cafe",
    "989b7d2c",
    "-989b7d2c-",
    "cafe-989b7d2",
    "cafe-989b7d2c0",
    "cafe-989b7d2ce17",
    "cafe-989B7D2C",
    "cafe-989b7d2g",
    "cafe-989b7d2c\n",
  ])("%j no tiene forma de dirección", (segmento) => {
    expect(resolverProductoPorSegmento(CARTA, productos, segmento)).toEqual({
      ok: false,
      error: "SEGMENTO_INVALIDO",
    });
  });

  it("un slug raro en el pedido no engaña: se resuelve por el sufijo y se redirige a la dirección limpia", () => {
    const r = resolverProductoPorSegmento(CARTA, productos, "../CAFE <b>-989b7d2c");
    expect(r.ok && r.valor.productoId).toBe(P1);
    expect(r.ok && r.valor.redirigir).toBe(true);
    expect(r.ok && r.valor.direccion.segmento).toBe("cafe-con-leche-989b7d2c");
  });

  it("el slug puede tener guiones y números sin confundir el sufijo", () => {
    const r = resolverProductoPorSegmento(CARTA, productos, "pan-12345678-989b7d2c");
    expect(r.ok && r.valor.productoId).toBe(P1);
  });

  it("con un choque de 8, el sufijo corto es ambiguo (no se adivina) y el de 12 sí resuelve", () => {
    const dos = [
      { productoId: CHOCAN_A, nombre: "Pan" },
      { productoId: CHOCAN_B, nombre: "Pan" },
    ];
    expect(resolverProductoPorSegmento(CARTA, dos, "pan-1ad235df")).toEqual({
      ok: false,
      error: "PRODUCTO_NO_ENCONTRADO",
    });
    const r = resolverProductoPorSegmento(CARTA, dos, "pan-1ad235dffd68");
    expect(r.ok && r.valor.productoId).toBe(CHOCAN_B);
    expect(r.ok && r.valor.redirigir).toBe(false);
  });

  it("una carta sin productos no resuelve nada", () => {
    expect(resolverProductoPorSegmento(CARTA, [], "cafe-989b7d2c")).toEqual({
      ok: false,
      error: "PRODUCTO_NO_ENCONTRADO",
    });
  });
});
