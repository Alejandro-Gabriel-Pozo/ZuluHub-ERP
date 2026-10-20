import { describe, expect, it } from "vitest";
import { matrizDelQr, qrComoSvg, svgDeLaMatriz } from "./qr-svg";

/**
 * El QR del alta del segundo factor. La matriz de «A» (versión 1, 21 × 21, corrección «M») es un vector CONOCIDO: se la
 * decodificó con un lector independiente (OpenCV) y devuelve «A». Para el resto se prueban las propiedades que fija el
 * estándar (ISO/IEC 18004): los tres patrones de posición, los de sincronía, el módulo oscuro y que el tamaño sea
 * 17 + 4 × versión. Y que el SVG es solo dibujo: contiene la matriz y nada del texto que se codificó.
 */

const VECTOR_DE_A = [
  "#######.##.#..#######",
  "#.....#..##...#.....#",
  "#.###.#..####.#.###.#",
  "#.###.#.###...#.###.#",
  "#.###.#.###.#.#.###.#",
  "#.....#.####..#.....#",
  "#######.#.#.#.#######",
  "........#.###........",
  "#...#.###..#.#####..#",
  "..#.#...#..##..#.#.##",
  "####.##...##..#####..",
  "###....#.#...##.#.##.",
  "###.#####...###...###",
  "........#.#.###...###",
  "#######.##..##.....#.",
  "#.....#..####..#.#.#.",
  "#.###.#.####..#######",
  "#.###.#..#.##..#.#.##",
  "#.###.#....#..#####..",
  "#.....#..#...##.#.#..",
  "#######.#.#.###...#.#",
];
const comoTexto = (m: readonly (readonly boolean[])[]) =>
  m.map((f) => f.map((x) => (x ? "#" : ".")).join(""));

const DIRECCION =
  "otpauth://totp/ZuluHub%20Plataforma:admin%40example.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXPJBSW&issuer=ZuluHub%20Plataforma&digits=6&period=30";

describe("matrizDelQr", () => {
  it("el vector conocido: «A» da la matriz de la versión 1, y un lector independiente la decodifica como «A»", () => {
    expect(comoTexto(matrizDelQr("A"))).toEqual(VECTOR_DE_A);
  });

  it("es determinista: el mismo texto da la misma matriz, y otro texto, otra", () => {
    expect(comoTexto(matrizDelQr(DIRECCION))).toEqual(comoTexto(matrizDelQr(DIRECCION)));
    expect(comoTexto(matrizDelQr("A"))).not.toEqual(comoTexto(matrizDelQr("B")));
  });

  it.each([["A"], ["otpauth://totp/x:y?secret=ABCDEFGHIJKLMNOP"], [DIRECCION]])(
    "la matriz de %j es cuadrada, de lado 17 + 4 × versión, con los patrones de posición y de sincronía del estándar",
    (texto) => {
      const m = matrizDelQr(texto);
      const n = m.length;
      expect((n - 17) % 4).toBe(0);
      expect(n).toBeGreaterThanOrEqual(21);
      for (const fila of m) expect(fila).toHaveLength(n);
      const version = (n - 17) / 4;
      // Patrón de posición: borde oscuro de 7 × 7, anillo claro, centro oscuro de 3 × 3; en tres esquinas.
      const esquinas: [number, number][] = [
        [0, 0],
        [0, n - 7],
        [n - 7, 0],
      ];
      for (const [fila, columna] of esquinas) {
        for (let y = 0; y < 7; y++) {
          for (let x = 0; x < 7; x++) {
            const borde = y === 0 || y === 6 || x === 0 || x === 6;
            const centro = y >= 2 && y <= 4 && x >= 2 && x <= 4;
            expect(m[fila + y]?.[columna + x], `(${fila + y}, ${columna + x})`).toBe(
              borde || centro,
            );
          }
        }
      }
      // Separadores claros junto a los patrones de posición.
      for (let i = 0; i < 8; i++) {
        expect(m[7]?.[i]).toBe(false);
        expect(m[i]?.[7]).toBe(false);
        expect(m[7]?.[n - 1 - i]).toBe(false);
        expect(m[n - 8]?.[i]).toBe(false);
      }
      // Sincronía: la fila 6 y la columna 6 alternan oscuro y claro entre los patrones.
      for (let i = 8; i < n - 8; i++) {
        expect(m[6]?.[i], `fila 6, columna ${i}`).toBe(i % 2 === 0);
        expect(m[i]?.[6], `fila ${i}, columna 6`).toBe(i % 2 === 0);
      }
      // El módulo oscuro fijo.
      expect(m[4 * version + 9]?.[8]).toBe(true);
    },
  );

  it("una dirección más larga usa una versión mayor (más módulos)", () => {
    expect(matrizDelQr(DIRECCION).length).toBeGreaterThan(matrizDelQr("A").length);
  });
});

describe("svgDeLaMatriz", () => {
  it("la matriz ida y vuelta: el dibujo (tramos horizontales) reconstruye EXACTAMENTE la matriz, con 4 módulos de margen", () => {
    for (const texto of ["A", DIRECCION]) {
      const m = matrizDelQr(texto);
      const svg = svgDeLaMatriz(m);
      const lado = m.length + 8;
      expect(svg).toContain(`viewBox="0 0 ${lado} ${lado}"`);
      const camino = /<path d="([^"]*)"/.exec(svg)?.[1] ?? "";
      const leida = Array.from({ length: m.length }, () =>
        Array.from({ length: m.length }, () => false),
      );
      let resto = camino;
      for (const t of camino.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
        const [, x, y, ancho, deVuelta] = t.map(Number) as [number, number, number, number, number];
        expect(deVuelta).toBe(ancho);
        for (let i = 0; i < ancho; i++) (leida[y - 4] as boolean[])[x - 4 + i] = true;
        resto = resto.replace(t[0], "");
      }
      expect(resto, "el camino no trae nada más que tramos").toBe("");
      expect(leida).toEqual(m.map((f) => [...f]));
    }
  });

  it("une los módulos oscuros consecutivos de una fila en un solo tramo y no dibuja los claros", () => {
    const svg = svgDeLaMatriz([
      [true, true, false, true],
      [false, false, false, false],
      [true, false, true, true],
      [false, true, true, false],
    ]);
    expect(/<path d="([^"]*)"/.exec(svg)?.[1]).toBe(
      "M4 4h2v1h-2z" + "M7 4h1v1h-1z" + "M4 6h1v1h-1z" + "M6 6h2v1h-2z" + "M5 7h2v1h-2z",
    );
    expect(svg).toContain('viewBox="0 0 12 12"');
  });

  it("una matriz sin módulos oscuros da un camino vacío (sin romper)", () => {
    expect(svgDeLaMatriz([[false, false]])).toContain('<path d="" ');
  });

  it("es solo dibujo: fondo blanco, módulos negros y una etiqueta fija; ningún texto codificado ni elemento activo", () => {
    const svg = qrComoSvg(DIRECCION);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" ')).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Código QR para la aplicación autenticadora"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('fill="#000000"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    // Nada del texto del QR: ni la dirección, ni el esquema, ni el secreto, ni el email, ni el emisor.
    for (const pedazo of [
      "otpauth",
      "JBSWY3DP",
      "admin",
      "example.test",
      "ZuluHub",
      "secret",
      "issuer",
      "http",
    ]) {
      expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', ""), pedazo).not.toContain(pedazo);
    }
    expect(svg).not.toMatch(/<script|<foreignObject|<image|<text|<title|<desc|href=|on\w+=/i);
    expect([...new Set([...svg.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1]))].sort()).toEqual([
      "path",
      "rect",
      "svg",
    ]);
  });

  it("qrComoSvg es la matriz dibujada", () => {
    expect(qrComoSvg("A")).toBe(svgDeLaMatriz(matrizDelQr("A")));
    expect(qrComoSvg("A")).not.toBe(qrComoSvg("B"));
  });
});
