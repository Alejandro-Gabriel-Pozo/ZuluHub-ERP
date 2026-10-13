import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import {
  FIRMA_PNG,
  SOI,
  EOI,
  ascii,
  bytesDe,
  construirRiff,
  datosVp8,
  datosVp8x,
  enVista,
  escaneo,
  fixture,
  fragmentoRiff,
  mutaciones,
  segmentoJpeg,
  sof,
  u32le,
} from "../../../test/utilidades/imagenes";
import {
  analizarJpeg,
  analizarWebp,
  detectarFormato,
  fragmentosDeRiff,
  leerCabecera,
  leerIco,
  leerJpeg,
  leerPng,
  leerWebp,
} from "./cabeceras";
import { analizarFoto, quitarMetadatos } from "./limpieza";
import {
  RANURAS_DE_ACTIVO,
  VARIANTES_DE_FOTO,
  validarArchivoDeActivo,
  validarFotoDeProducto,
} from "./validacion";

/**
 * Propiedades de los lectores, la limpieza y los validadores de imágenes: ante bytes arbitrarios, mutados
 * o cortados NUNCA lanzan (un `DataView` fuera de rango lanza, así que «no lanza» es «no lee fuera de
 * rango»), terminan, son deterministas y no dependen de lo que haya alrededor de la vista.
 */

const CARPETAS = ["activos", "fotos"] as const;
const RAIZ = fileURLToPath(new URL("../../../test/fixtures/", import.meta.url));
const TODOS = CARPETAS.flatMap((carpeta) =>
  readdirSync(`${RAIZ}${carpeta}`)
    .sort()
    .map((nombre) => ({ carpeta, nombre, bytes: fixture(carpeta, nombre) })),
);

const CODIGOS = new Set([
  "FORMATO_NO_RECONOCIDO",
  "TRUNCADO",
  "CABECERA_INVALIDA",
  "VARIANTE_NO_ADMITIDA",
  "FORMATO_NO_ADMITIDO",
  "SVG_NO_ADMITIDO",
  "PESO_EXCEDIDO",
  "DIMENSIONES_INCORRECTAS",
  "NO_ES_OPACO",
  "ANIMADO",
]);

/** Todo lo que se le puede pedir a bytes desconocidos, con su resultado. */
function todo(bytes: Uint8Array): unknown[] {
  return [
    detectarFormato(bytes),
    leerPng(bytes),
    leerWebp(bytes),
    analizarWebp(bytes),
    fragmentosDeRiff(bytes),
    leerJpeg(bytes),
    analizarJpeg(bytes),
    leerIco(bytes),
    leerCabecera(bytes),
    analizarFoto(bytes),
    quitarMetadatos(bytes),
    ...RANURAS_DE_ACTIVO.map((r) => validarArchivoDeActivo(r, bytes)),
    validarFotoDeProducto("480", bytes),
    validarFotoDeProducto("1200", bytes),
  ];
}

const sinLanzar = (bytes: Uint8Array) => {
  const a = todo(bytes);
  expect(todo(bytes)).toEqual(a); // determinista
  expect(todo(enVista(bytes))).toEqual(a); // no depende de lo que rodea a la vista
  for (const r of a) {
    if (typeof r === "object" && r !== null && "ok" in r && r.ok === false) {
      expect(CODIGOS.has((r as unknown as { error: string }).error)).toBe(true);
    }
  }
};

// --- Generadores -----------------------------------------------------------------------------------

const firmas = [
  FIRMA_PNG,
  [0xff, 0xd8, 0xff],
  [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")],
  [0, 0, 1, 0],
  ascii("<svg"),
];

/** Bytes cualesquiera, o con la firma de un formato y cola al azar para llegar más adentro. */
const bytesCualesquiera = fc.oneof(
  fc.uint8Array({ maxLength: 120 }),
  fc
    .tuple(fc.constantFrom(...firmas), fc.uint8Array({ maxLength: 200 }))
    .map(([firma, cola]) => bytesDe(firma, cola)),
);

/**
 * Secuencias hechas de piezas que importan en cada formato (marcadores, tamaños pequeños y enormes), con
 * la firma de cada uno: llegan a los bucles de recorrido mucho más seguido que los bytes uniformes.
 */
const piezasJpeg = fc.constantFrom(
  0xff,
  0xff,
  0x00,
  0xd8,
  0xd9,
  0xd0,
  0xd7,
  0xc0,
  0xc2,
  0xc4,
  0xda,
  0xe1,
  0xed,
  0x01,
  0x02,
  0x08,
  0x10,
  0x03,
  0x11,
  0x20,
);
const jpegsCrudos = fc
  .array(piezasJpeg, { maxLength: 80 })
  .map((c) => bytesDe([0xff, 0xd8, 0xff], c));

const piezasRiff = fc.constantFrom(
  ...[0, 1, 2, 3, 4, 8, 10, 0xff, 0x2f, 0x9d, 0x2a, 0x10].map((n) => [n]),
  ascii("VP8 "),
  ascii("VP8L"),
  ascii("VP8X"),
  ascii("EXIF"),
  ascii("XMP "),
  ascii("ALPH"),
  u32le(10),
  u32le(0xffffffff),
);
const riffsCrudos = fc
  .tuple(fc.nat({ max: 120 }), fc.array(piezasRiff, { maxLength: 40 }))
  .map(([tamano, piezas]) => bytesDe(ascii("RIFF"), u32le(tamano), ascii("WEBP"), piezas.flat()));

const piezasPng = fc.constantFrom(
  [0],
  [0, 0, 0, 13],
  ascii("IHDR"),
  ascii("IDAT"),
  ascii("IEND"),
  ascii("tRNS"),
  ascii("acTL"),
  [8],
  [2],
  [6],
  [0, 0, 0, 1],
  [0xff, 0xff, 0xff, 0xff],
);
const pngsCrudos = fc
  .array(piezasPng, { maxLength: 30 })
  .map((piezas) => bytesDe(FIRMA_PNG, piezas.flat()));

const icosCrudos = fc
  .array(fc.constantFrom(0, 1, 2, 16, 22, 32, 0xff), { maxLength: 60 })
  .map((c) => bytesDe([0, 0, 1, 0], c));

const archivoReal = fc.constantFrom(...TODOS);

// Las mutaciones parten de archivos de hasta 8 KB: más grandes agregan tiempo y ninguna rama nueva.
const archivoMutado = fc
  .constantFrom(...TODOS.filter((f) => f.bytes.length <= 8000))
  .chain((f) => mutaciones(f.bytes));

describe("ningún lector ni validador lanza, se cuelga o depende de lo que rodea a los bytes", () => {
  it("con bytes cualesquiera", () => {
    fc.assert(fc.property(bytesCualesquiera, sinLanzar));
  });

  it("con JPEG, WebP, PNG e ICO crudos hechos de piezas de las cabeceras", () => {
    fc.assert(fc.property(jpegsCrudos, sinLanzar));
    fc.assert(fc.property(riffsCrudos, sinLanzar));
    fc.assert(fc.property(pngsCrudos, sinLanzar));
    fc.assert(fc.property(icosCrudos, sinLanzar));
  });

  it("con los archivos reales y sus versiones mutadas", () => {
    for (const f of TODOS) sinLanzar(f.bytes);
    fc.assert(fc.property(archivoMutado, sinLanzar), { numRuns: 150 });
  });

  it("con cada archivo real cortado en cada largo posible", () => {
    for (const f of TODOS) {
      const paso = Math.max(1, Math.floor(f.bytes.length / 150));
      for (let n = 0; n < f.bytes.length; n += paso) sinLanzar(f.bytes.subarray(0, n));
      sinLanzar(f.bytes.subarray(0, f.bytes.length - 1));
    }
  });

  it("un archivo real cortado antes de su final nunca se acepta como entero", () => {
    // (JPEG, WebP, PNG e ICO válidos: un prefijo propio no puede ser un archivo completo.)
    for (const f of TODOS) {
      const completo = leerCabecera(f.bytes).ok || leerIco(f.bytes).ok;
      if (!completo) continue;
      const paso = Math.max(1, Math.floor(f.bytes.length / 150));
      for (let n = 1; n < f.bytes.length; n += paso) {
        const corto = f.bytes.subarray(0, n);
        const r = leerCabecera(corto);
        const i = leerIco(corto);
        expect(r.ok || i.ok, `${f.nombre} cortado en ${n}`).toBe(false);
      }
      const casiEntero = f.bytes.subarray(0, f.bytes.length - 1);
      expect(
        leerCabecera(casiEntero).ok || leerIco(casiEntero).ok,
        `${f.nombre} sin su último byte`,
      ).toBe(false);
    }
  });
});

describe("lo que los lectores aceptan trae medidas coherentes", () => {
  const medidasValidas = (v: { ancho: number; alto: number }, maximo: number) => {
    expect(Number.isInteger(v.ancho) && Number.isInteger(v.alto)).toBe(true);
    expect(v.ancho).toBeGreaterThanOrEqual(1);
    expect(v.alto).toBeGreaterThanOrEqual(1);
    expect(v.ancho).toBeLessThanOrEqual(maximo);
    expect(v.alto).toBeLessThanOrEqual(maximo);
  };

  it("PNG hasta 2^31-1, WebP hasta 2^24, JPEG hasta 65535, ICO hasta 256", () => {
    const todosLosCrudos = fc.oneof(
      archivoMutado,
      jpegsCrudos,
      riffsCrudos,
      pngsCrudos,
      icosCrudos,
    );
    fc.assert(
      fc.property(todosLosCrudos, (bytes) => {
        const png = leerPng(bytes);
        if (png.ok) medidasValidas(png.valor, 0x7fffffff);
        const webp = leerWebp(bytes);
        if (webp.ok) medidasValidas(webp.valor, 0x1000000);
        const jpeg = leerJpeg(bytes);
        if (jpeg.ok) medidasValidas(jpeg.valor, 65535);
        const ico = leerIco(bytes);
        if (ico.ok) for (const i of ico.valor.imagenes) medidasValidas(i, 256);
      }),
    );
  });
});

describe("la limpieza de metadatos", () => {
  const fotos = fc.oneof(
    archivoReal.filter((f) => leerCabecera(f.bytes).ok).map((f) => f.bytes),
    archivoMutado,
    jpegsCrudos,
    riffsCrudos,
  );

  it("nunca lanza; si acepta, es idempotente, no agranda, no devuelve la entrada y conserva la cabecera", () => {
    fc.assert(
      fc.property(fotos, (bytes) => {
        const r = quitarMetadatos(bytes);
        const a = analizarFoto(bytes);
        expect(r.ok).toBe(a.ok);
        if (!r.ok || !a.ok) return;
        const salida = r.valor;
        expect(salida.length).toBeLessThanOrEqual(bytes.length);
        expect(salida).not.toBe(bytes);
        expect(quitarMetadatos(salida)).toEqual({ ok: true, valor: salida });
        const otra = analizarFoto(salida);
        expect(otra.ok && otra.valor.cabecera).toEqual(a.valor.cabecera);
        expect(a.valor.bytes).toEqual(salida);
      }),
    );
  });

  it("no deja APP1 ni APP13 en un JPEG, ni EXIF, XMP ni sus banderas en un WebP", () => {
    fc.assert(
      fc.property(fotos, (bytes) => {
        const r = quitarMetadatos(bytes);
        if (!r.ok) return;
        const jpeg = analizarJpeg(r.valor);
        if (jpeg.ok) {
          const marcadores = jpeg.valor.segmentos.map((s) => s.marcador);
          expect(marcadores).not.toContain(0xe1);
          expect(marcadores).not.toContain(0xed);
        }
        const webp = analizarWebp(r.valor);
        if (webp.ok) {
          const tipos = [webp.valor.primero, ...webp.valor.siguientes].map((f) => f.tipo);
          expect(tipos).not.toContain("EXIF");
          expect(tipos).not.toContain("XMP ");
          if (webp.valor.primero.tipo === "VP8X") expect(r.valor[20]! & 0x0c).toBe(0);
        }
      }),
    );
  });

  // Modelo: un JPEG armado con segmentos al azar sale como el mismo armado sin los APP1 y APP13.
  const segmento = fc.record({
    marcador: fc.constantFrom(0xe0, 0xe1, 0xe2, 0xed, 0xee, 0xfe, 0xdb, 0xc4),
    datos: fc.array(fc.nat({ max: 255 }), { maxLength: 20 }),
  });
  const entropia = fc
    .array(
      fc.oneof(
        fc.integer({ min: 0, max: 254 }).map((x) => [x]),
        fc.constant([0xff, 0x00]),
        fc.integer({ min: 0xd0, max: 0xd7 }).map((r) => [0xff, r]),
      ),
      { maxLength: 15 },
    )
    .map((p) => p.flat());

  it("modelo JPEG: sale como el mismo JPEG sin sus APP1 y APP13, sin tocar el resto", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(segmento, fc.nat({ max: 2 })), { maxLength: 6 }),
        fc.array(segmento, { maxLength: 4 }),
        fc.boolean(),
        entropia,
        entropia,
        fc.uint8Array({ maxLength: 10 }),
        (antes, entre, segundoEscaneo, e1, e2, cola) => {
          const esMeta = (s: { marcador: number }) => s.marcador === 0xe1 || s.marcador === 0xed;
          const armar = (conMeta: boolean, conRelleno: boolean) =>
            bytesDe(
              SOI,
              antes
                .filter(([s]) => conMeta || !esMeta(s))
                .map(([s, relleno]) => [
                  ...(conRelleno ? new Array<number>(relleno).fill(0xff) : []),
                  ...segmentoJpeg(s.marcador, s.datos),
                ])
                .flat(),
              sof(40, 30),
              escaneo(e1),
              entre
                .filter((s) => conMeta || !esMeta(s))
                .map((s) => segmentoJpeg(s.marcador, s.datos))
                .flat(),
              segundoEscaneo ? escaneo(e2) : [],
              EOI,
              conMeta ? cola : [],
            );
          // Los segmentos entre escaneos no pueden llevar los marcadores de tablas sin más... el lector no
          // los distingue: todos son segmentos con largo.
          expect(quitarMetadatos(armar(true, true))).toEqual({
            ok: true,
            valor: armar(false, false),
          });
        },
      ),
    );
  });

  // Modelo: un WebP extendido con fragmentos al azar sale sin EXIF ni XMP, con las banderas bajas y el tamaño recalculado.
  const fragmentoAjeno = fc.record({
    tipo: fc.constantFrom("ICCP", "EXIF", "XMP ", "ZZZZ", "ANIM", "ALPH"),
    datos: fc.array(fc.nat({ max: 255 }), { maxLength: 9 }),
  });
  const metadato = (f: { tipo: string }) => f.tipo === "EXIF" || f.tipo === "XMP ";

  it("modelo WebP extendido: sale sin EXIF ni XMP, con banderas bajas y tamaño recalculado", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0x3c }).filter((b) => (b & 0x02) === 0),
        fc.array(fragmentoAjeno, { maxLength: 4 }),
        fc.array(fragmentoAjeno, { maxLength: 4 }),
        fc.uint8Array({ maxLength: 8 }),
        (banderas, antes, despues, cola) => {
          const vp8 = fragmentoRiff("VP8 ", datosVp8(33, 17, [1, 2, 3]));
          const armar = (b: number, filtrar: boolean, conCola: boolean) =>
            construirRiff(
              [
                fragmentoRiff("VP8X", datosVp8x(b, 33, 17)),
                ...(filtrar ? antes.filter((f) => !metadato(f)) : antes).map((f) =>
                  fragmentoRiff(f.tipo, f.datos),
                ),
                vp8,
                ...(filtrar ? despues.filter((f) => !metadato(f)) : despues).map((f) =>
                  fragmentoRiff(f.tipo, f.datos),
                ),
              ],
              undefined,
              conCola ? [...cola] : [],
            );
          expect(quitarMetadatos(armar(banderas, false, true))).toEqual({
            ok: true,
            valor: armar(banderas & ~0x0c, true, false),
          });
        },
      ),
    );
  });

  it("modelo WebP simple: pierde los EXIF y XMP sueltos y no cambia el resto", () => {
    fc.assert(
      fc.property(fc.array(fragmentoAjeno, { maxLength: 5 }), (extras) => {
        const vp8 = fragmentoRiff("VP8 ", datosVp8(33, 17, [1, 2, 3, 4]));
        const armar = (filtrar: boolean) =>
          construirRiff([
            vp8,
            ...(filtrar ? extras.filter((f) => !metadato(f)) : extras).map((f) =>
              fragmentoRiff(f.tipo, f.datos),
            ),
          ]);
        expect(quitarMetadatos(armar(false))).toEqual({ ok: true, valor: armar(true) });
      }),
    );
  });
});

describe("los validadores sobre bytes arbitrarios", () => {
  const casi = fc.oneof(archivoMutado, bytesCualesquiera, jpegsCrudos, riffsCrudos);

  it("una foto aceptada trae las medidas de su variante, no pesa de más y sus bytes son los limpios", () => {
    fc.assert(
      fc.property(casi, fc.constantFrom("480", "1200"), (bytes, variante) => {
        const r = validarFotoDeProducto(variante, bytes);
        if (!r.ok) return;
        const regla = VARIANTES_DE_FOTO[variante];
        expect(r.valor.ancho).toBe(regla.ancho);
        expect(r.valor.alto).toBe(regla.alto);
        expect(bytes.length).toBeLessThanOrEqual(regla.pesoMaximo);
        expect(["jpeg", "webp"]).toContain(r.valor.formato);
        expect(quitarMetadatos(bytes)).toEqual({ ok: true, valor: r.valor.bytes });
      }),
    );
  });

  it("un archivo de activo aceptado no pesa de más y su formato es el de su firma", () => {
    fc.assert(
      fc.property(casi, fc.constantFrom(...RANURAS_DE_ACTIVO), (bytes, ranura) => {
        const r = validarArchivoDeActivo(ranura, bytes);
        if (!r.ok) return;
        expect(r.valor.formato).toBe(detectarFormato(bytes));
        expect(r.valor.ancho).toBeGreaterThanOrEqual(1);
      }),
    );
  });

  it("con los reales: cada fixture se acepta o se rechaza igual cuantas veces se pregunte", () => {
    for (const f of TODOS) {
      for (const ranura of RANURAS_DE_ACTIVO) {
        expect(validarArchivoDeActivo(ranura, f.bytes)).toEqual(
          validarArchivoDeActivo(ranura, f.bytes),
        );
      }
    }
  });
});
