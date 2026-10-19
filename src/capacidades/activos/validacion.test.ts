import { describe, expect, it } from "vitest";
import {
  EOI,
  bytesDe,
  construirIco,
  construirJpeg,
  construirPng,
  construirRiff,
  datosVp8,
  datosVp8l,
  datosVp8x,
  fixture,
  fragmentoPng,
  fragmentoRiff,
  segmentoJpeg,
  webpVp8,
} from "../../../test/utilidades/imagenes";
import { analizarJpeg } from "./cabeceras";
import {
  KB,
  MEDIDA_MAXIMA_DE_LOGO,
  RANURAS_DE_ACTIVO,
  VARIANTES_DE_FOTO,
  validarArchivoDeActivo,
  validarFotoDeProducto,
  type RanuraDeActivo,
} from "./validacion";

/** Los mismos bytes con ceros al final hasta `total`: PNG, ICO, JPEG y WebP ignoran lo que sobra. */
function conPeso(bytes: Uint8Array, total: number): Uint8Array {
  const salida = new Uint8Array(total);
  salida.set(bytes);
  return salida;
}

const veredicto = (ranura: RanuraDeActivo, bytes: Uint8Array) => {
  const r = validarArchivoDeActivo(ranura, bytes);
  return r.ok ? r.valor : r.error;
};

const png = (ancho: number, alto: number) => ({ formato: "png", ancho, alto });

describe("validarArchivoDeActivo: la lista cerrada de ranuras", () => {
  it("son estas nueve, en este orden", () => {
    expect(RANURAS_DE_ACTIVO).toEqual([
      "icono_192",
      "icono_apple_180",
      "icono_512",
      "favicon_ico",
      "logo",
      "logo_sobre_primario",
      "logo_correo",
      "imagen_social",
      "imagen_de_ingreso",
    ]);
  });

  it("un kilobyte son mil bytes y la medida máxima de un logo 4096", () => {
    expect(KB).toBe(1000);
    expect(MEDIDA_MAXIMA_DE_LOGO).toBe(4096);
  });

  it("ninguna ranura acepta vacío, texto cualquiera, GIF ni HEIC", () => {
    for (const ranura of RANURAS_DE_ACTIVO) {
      for (const bytes of [
        new Uint8Array(),
        bytesDe([0x68, 0x6f, 0x6c, 0x61]),
        fixture("fotos", "foto-480.gif"),
        fixture("fotos", "foto-480.heic"),
      ]) {
        expect(veredicto(ranura, bytes)).toBe("FORMATO_NO_ADMITIDO");
      }
    }
  });

  it("ninguna ranura acepta SVG, ni siquiera disfrazado con nombre de PNG; y se dice antes que el peso", () => {
    const grande = bytesDe(
      [...new TextEncoder().encode('<svg xmlns="x">')],
      new Array<number>(1_000_000).fill(0x20),
    );
    for (const ranura of RANURAS_DE_ACTIVO) {
      expect(veredicto(ranura, fixture("activos", "logo.svg"))).toBe("SVG_NO_ADMITIDO");
      expect(veredicto(ranura, fixture("activos", "icono-192-svg-colado.png"))).toBe(
        "SVG_NO_ADMITIDO",
      );
      expect(veredicto(ranura, grande)).toBe("SVG_NO_ADMITIDO");
    }
  });
});

describe("validarArchivoDeActivo: icono_192", () => {
  it("acepta el PNG de 192 x 192, con transparencia", () => {
    expect(veredicto("icono_192", fixture("activos", "icono-192.png"))).toEqual(png(192, 192));
  });

  it("rechaza la firma cambiada, el IHDR de 191 px, el truncado y otros formatos", () => {
    expect(veredicto("icono_192", fixture("activos", "icono-192-firma-cambiada.png"))).toBe(
      "FORMATO_NO_ADMITIDO",
    );
    expect(veredicto("icono_192", fixture("activos", "icono-192-191px.png"))).toBe(
      "DIMENSIONES_INCORRECTAS",
    );
    expect(veredicto("icono_192", fixture("activos", "icono-192-truncado.png"))).toBe("TRUNCADO");
    expect(veredicto("icono_192", fixture("fotos", "foto-480.jpg"))).toBe("FORMATO_NO_ADMITIDO");
    expect(veredicto("icono_192", fixture("activos", "logo.webp"))).toBe("FORMATO_NO_ADMITIDO");
    expect(veredicto("icono_192", fixture("activos", "favicon-32.ico"))).toBe(
      "FORMATO_NO_ADMITIDO",
    );
  });

  it("pide 192 exactos en cada eje", () => {
    for (const [ancho, alto] of [
      [191, 192],
      [193, 192],
      [192, 191],
      [192, 193],
      [1, 1],
    ] as const) {
      expect(veredicto("icono_192", construirPng({ ancho, alto }))).toBe("DIMENSIONES_INCORRECTAS");
    }
    expect(veredicto("icono_192", construirPng({ ancho: 192, alto: 192 }))).toEqual(png(192, 192));
  });

  it("pesa hasta 100 KB: 100 000 bytes pasa, uno más no", () => {
    const base = fixture("activos", "icono-192.png");
    expect(veredicto("icono_192", conPeso(base, 100_000))).toEqual(png(192, 192));
    expect(veredicto("icono_192", conPeso(base, 100_001))).toBe("PESO_EXCEDIDO");
  });

  it("rechaza un PNG animado", () => {
    const apng = construirPng({
      ancho: 192,
      alto: 192,
      fragmentos: [fragmentoPng("acTL", [0, 0, 0, 2, 0, 0, 0, 0]), fragmentoPng("IDAT", [1])],
    });
    expect(veredicto("icono_192", apng)).toBe("ANIMADO");
  });
});

describe("validarArchivoDeActivo: icono_apple_180 (opaco)", () => {
  it("acepta los tipos de color 2 (RGB) y 0 (grises) sin tRNS", () => {
    expect(veredicto("icono_apple_180", fixture("activos", "apple-180.png"))).toEqual(
      png(180, 180),
    );
    expect(veredicto("icono_apple_180", fixture("activos", "apple-180-grises.png"))).toEqual(
      png(180, 180),
    );
  });

  it("rechaza el tipo de color 6 (RGBA), el 3 (paleta) y el RGB con tRNS: no son opacos", () => {
    expect(veredicto("icono_apple_180", fixture("activos", "apple-180-rgba.png"))).toBe(
      "NO_ES_OPACO",
    );
    expect(veredicto("icono_apple_180", fixture("activos", "apple-180-paleta.png"))).toBe(
      "NO_ES_OPACO",
    );
    expect(veredicto("icono_apple_180", fixture("activos", "apple-180-trns.png"))).toBe(
      "NO_ES_OPACO",
    );
    expect(
      veredicto("icono_apple_180", construirPng({ ancho: 180, alto: 180, tipoDeColor: 4 })),
    ).toBe("NO_ES_OPACO");
  });

  it("pide 180 exactos, y las medidas se revisan antes que la opacidad", () => {
    expect(veredicto("icono_apple_180", construirPng({ ancho: 179, alto: 180 }))).toBe(
      "DIMENSIONES_INCORRECTAS",
    );
    expect(veredicto("icono_apple_180", construirPng({ ancho: 181, alto: 180 }))).toBe(
      "DIMENSIONES_INCORRECTAS",
    );
    expect(veredicto("icono_apple_180", construirPng({ ancho: 180, alto: 179 }))).toBe(
      "DIMENSIONES_INCORRECTAS",
    );
    expect(veredicto("icono_apple_180", construirPng({ ancho: 180, alto: 181 }))).toBe(
      "DIMENSIONES_INCORRECTAS",
    );
    expect(
      veredicto("icono_apple_180", construirPng({ ancho: 192, alto: 192, tipoDeColor: 6 })),
    ).toBe("DIMENSIONES_INCORRECTAS");
  });

  it("pesa hasta 100 KB", () => {
    const base = fixture("activos", "apple-180.png");
    expect(veredicto("icono_apple_180", conPeso(base, 100_000))).toEqual(png(180, 180));
    expect(veredicto("icono_apple_180", conPeso(base, 100_001))).toBe("PESO_EXCEDIDO");
  });

  it("las demás ranuras SÍ admiten transparencia", () => {
    expect(veredicto("icono_192", fixture("activos", "apple-180-rgba.png"))).toBe(
      "DIMENSIONES_INCORRECTAS",
    );
    expect(veredicto("icono_512", construirPng({ ancho: 512, alto: 512, tipoDeColor: 6 }))).toEqual(
      png(512, 512),
    );
    expect(veredicto("logo", fixture("activos", "logo.png"))).toEqual(png(256, 64));
  });
});

describe("validarArchivoDeActivo: icono_512", () => {
  it("acepta 512 x 512 y pide los dos ejes exactos", () => {
    expect(veredicto("icono_512", fixture("activos", "icono-512.png"))).toEqual(png(512, 512));
    expect(veredicto("icono_512", construirPng({ ancho: 511, alto: 512 }))).toBe(
      "DIMENSIONES_INCORRECTAS",
    );
    expect(veredicto("icono_512", construirPng({ ancho: 512, alto: 513 }))).toBe(
      "DIMENSIONES_INCORRECTAS",
    );
    expect(veredicto("icono_512", fixture("activos", "icono-192.png"))).toBe(
      "DIMENSIONES_INCORRECTAS",
    );
  });

  it("pesa hasta 200 KB", () => {
    const base = fixture("activos", "icono-512.png");
    expect(veredicto("icono_512", conPeso(base, 200_000))).toEqual(png(512, 512));
    expect(veredicto("icono_512", conPeso(base, 200_001))).toBe("PESO_EXCEDIDO");
  });
});

describe("validarArchivoDeActivo: favicon_ico", () => {
  it("acepta un ICO de 32 x 32 o de 16 + 32, en cualquier orden, y devuelve el lado mayor", () => {
    expect(veredicto("favicon_ico", fixture("activos", "favicon-32.ico"))).toEqual({
      formato: "ico",
      ancho: 32,
      alto: 32,
    });
    expect(veredicto("favicon_ico", fixture("activos", "favicon-16-32.ico"))).toEqual({
      formato: "ico",
      ancho: 32,
      alto: 32,
    });
    const alReves = construirIco(
      [
        { ancho: 32, alto: 32, tamano: 4, desde: 38 },
        { ancho: 16, alto: 16, tamano: 4, desde: 42 },
      ],
      8,
    );
    expect(veredicto("favicon_ico", alReves)).toEqual({ formato: "ico", ancho: 32, alto: 32 });
  });

  it("rechaza otros tamaños, medidas no cuadradas, repetidos y un solo 16", () => {
    const uno = (ancho: number, alto: number) =>
      construirIco([{ ancho, alto, tamano: 4, desde: 22 }], 4);
    expect(veredicto("favicon_ico", fixture("activos", "favicon-48.ico"))).toBe(
      "DIMENSIONES_INCORRECTAS",
    );
    expect(veredicto("favicon_ico", uno(16, 16))).toBe("DIMENSIONES_INCORRECTAS");
    expect(veredicto("favicon_ico", uno(32, 16))).toBe("DIMENSIONES_INCORRECTAS");
    expect(veredicto("favicon_ico", uno(16, 32))).toBe("DIMENSIONES_INCORRECTAS");
    expect(veredicto("favicon_ico", uno(33, 33))).toBe("DIMENSIONES_INCORRECTAS");
    const repetido = construirIco(
      [
        { ancho: 32, alto: 32, tamano: 4, desde: 38 },
        { ancho: 32, alto: 32, tamano: 4, desde: 42 },
      ],
      8,
    );
    expect(veredicto("favicon_ico", repetido)).toBe("DIMENSIONES_INCORRECTAS");
    const tres = construirIco(
      [16, 32, 32].map((l, i) => ({ ancho: l, alto: l, tamano: 4, desde: 54 + 4 * i })),
      12,
    );
    expect(veredicto("favicon_ico", tres)).toBe("DIMENSIONES_INCORRECTAS");
    const sinCuadrar = construirIco(
      [
        { ancho: 32, alto: 32, tamano: 4, desde: 38 },
        { ancho: 16, alto: 32, tamano: 4, desde: 42 },
      ],
      8,
    );
    expect(veredicto("favicon_ico", sinCuadrar)).toBe("DIMENSIONES_INCORRECTAS");
  });

  it("solo ICO; el resto es otro formato, y un ICO roto da el error del lector", () => {
    expect(veredicto("favicon_ico", fixture("activos", "icono-192.png"))).toBe(
      "FORMATO_NO_ADMITIDO",
    );
    expect(veredicto("favicon_ico", fixture("fotos", "foto-480.jpg"))).toBe("FORMATO_NO_ADMITIDO");
    expect(
      veredicto("favicon_ico", construirIco([{ ancho: 32, alto: 32, tamano: 99, desde: 22 }], 4)),
    ).toBe("TRUNCADO");
  });

  it("pesa hasta 20 KB", () => {
    const base = fixture("activos", "favicon-32.ico");
    expect(veredicto("favicon_ico", conPeso(base, 20_000))).toMatchObject({ formato: "ico" });
    expect(veredicto("favicon_ico", conPeso(base, 20_001))).toBe("PESO_EXCEDIDO");
  });
});

describe.each(["logo", "logo_sobre_primario"] as const)("validarArchivoDeActivo: %s", (ranura) => {
  it("acepta PNG y WebP (con o sin pérdida) de alto 64 o más", () => {
    expect(veredicto(ranura, fixture("activos", "logo.png"))).toEqual(png(256, 64));
    expect(veredicto(ranura, fixture("activos", "logo.webp"))).toEqual({
      formato: "webp",
      ancho: 256,
      alto: 64,
    });
    expect(veredicto(ranura, fixture("activos", "logo-con-perdida.webp"))).toEqual({
      formato: "webp",
      ancho: 256,
      alto: 64,
    });
  });

  it("pide alto de al menos 64 y de a lo sumo 4096; ancho de 1 a 4096", () => {
    expect(veredicto(ranura, fixture("activos", "logo-alto-63.png"))).toBe(
      "DIMENSIONES_INCORRECTAS",
    );
    const medidas = (ancho: number, alto: number) =>
      veredicto(ranura, construirPng({ ancho, alto }));
    expect(medidas(100, 63)).toBe("DIMENSIONES_INCORRECTAS");
    expect(medidas(100, 64)).toEqual(png(100, 64));
    expect(medidas(100, 4096)).toEqual(png(100, 4096));
    expect(medidas(100, 4097)).toBe("DIMENSIONES_INCORRECTAS");
    expect(medidas(1, 64)).toEqual(png(1, 64));
    expect(medidas(0x7fffffff, 64)).toBe("DIMENSIONES_INCORRECTAS");
    expect(medidas(4096, 64)).toEqual(png(4096, 64));
    expect(medidas(4097, 64)).toBe("DIMENSIONES_INCORRECTAS");
    const webp = (ancho: number, alto: number) =>
      veredicto(ranura, construirRiff([fragmentoRiff("VP8L", datosVp8l(ancho, alto))]));
    expect(webp(4096, 4096)).toEqual({ formato: "webp", ancho: 4096, alto: 4096 });
    expect(webp(4097, 64)).toBe("DIMENSIONES_INCORRECTAS");
    expect(webp(64, 63)).toBe("DIMENSIONES_INCORRECTAS");
  });

  it("no acepta JPEG, ICO ni animados", () => {
    expect(veredicto(ranura, fixture("fotos", "foto-480.jpg"))).toBe("FORMATO_NO_ADMITIDO");
    expect(veredicto(ranura, fixture("activos", "favicon-32.ico"))).toBe("FORMATO_NO_ADMITIDO");
    expect(veredicto(ranura, fixture("fotos", "foto-480-animada.webp"))).toBe("ANIMADO");
  });

  it("pesa hasta 100 KB", () => {
    expect(veredicto(ranura, conPeso(fixture("activos", "logo.png"), 100_000))).toEqual(
      png(256, 64),
    );
    expect(veredicto(ranura, conPeso(fixture("activos", "logo.png"), 100_001))).toBe(
      "PESO_EXCEDIDO",
    );
    expect(veredicto(ranura, conPeso(fixture("activos", "logo.webp"), 100_000))).toMatchObject({
      formato: "webp",
    });
    expect(veredicto(ranura, conPeso(fixture("activos", "logo.webp"), 100_001))).toBe(
      "PESO_EXCEDIDO",
    );
  });
});

describe("validarArchivoDeActivo: logo_correo (solo PNG)", () => {
  it("acepta PNG de ancho hasta 600", () => {
    expect(veredicto("logo_correo", fixture("activos", "logo-correo.png"))).toEqual(png(600, 100));
    expect(veredicto("logo_correo", construirPng({ ancho: 1, alto: 1 }))).toEqual(png(1, 1));
    expect(veredicto("logo_correo", construirPng({ ancho: 600, alto: 4096 }))).toEqual(
      png(600, 4096),
    );
  });

  it("rechaza ancho 601, alto 4097, WebP y JPEG", () => {
    expect(veredicto("logo_correo", fixture("activos", "logo-correo-601.png"))).toBe(
      "DIMENSIONES_INCORRECTAS",
    );
    expect(veredicto("logo_correo", construirPng({ ancho: 600, alto: 4097 }))).toBe(
      "DIMENSIONES_INCORRECTAS",
    );
    expect(veredicto("logo_correo", fixture("activos", "logo.webp"))).toBe("FORMATO_NO_ADMITIDO");
    expect(veredicto("logo_correo", fixture("fotos", "foto-480.jpg"))).toBe("FORMATO_NO_ADMITIDO");
  });

  it("pesa hasta 50 KB", () => {
    const base = fixture("activos", "logo-correo.png");
    expect(veredicto("logo_correo", conPeso(base, 50_000))).toEqual(png(600, 100));
    expect(veredicto("logo_correo", conPeso(base, 50_001))).toBe("PESO_EXCEDIDO");
  });
});

describe("validarArchivoDeActivo: imagen_social (PNG o JPEG de 1200 x 630)", () => {
  it("acepta el PNG y el JPEG", () => {
    expect(veredicto("imagen_social", fixture("activos", "imagen-social.png"))).toEqual(
      png(1200, 630),
    );
    expect(veredicto("imagen_social", fixture("activos", "imagen-social.jpg"))).toEqual({
      formato: "jpeg",
      ancho: 1200,
      alto: 630,
    });
  });

  it("pide los dos ejes exactos y rechaza WebP", () => {
    for (const [ancho, alto] of [
      [1199, 630],
      [1201, 630],
      [1200, 629],
      [1200, 631],
    ] as const) {
      expect(veredicto("imagen_social", construirPng({ ancho, alto }))).toBe(
        "DIMENSIONES_INCORRECTAS",
      );
      expect(veredicto("imagen_social", construirJpeg({ ancho, alto }))).toBe(
        "DIMENSIONES_INCORRECTAS",
      );
    }
    expect(veredicto("imagen_social", fixture("activos", "logo.webp"))).toBe("FORMATO_NO_ADMITIDO");
  });

  it("pesa hasta 300 KB: 300 000 bytes pasa, uno más no", () => {
    for (const nombre of ["imagen-social.png", "imagen-social.jpg"]) {
      const base = fixture("activos", nombre);
      expect(veredicto("imagen_social", conPeso(base, 300_000))).toMatchObject({ ancho: 1200 });
      expect(veredicto("imagen_social", conPeso(base, 300_001))).toBe("PESO_EXCEDIDO");
    }
  });
});

describe("validarArchivoDeActivo: imagen_de_ingreso (JPEG o WebP, de 800 x 600 a 1600 x 1200, hasta 500 KB)", () => {
  const jpeg = (ancho: number, alto: number) => ({ formato: "jpeg", ancho, alto });
  const webp = (ancho: number, alto: number) => ({ formato: "webp", ancho, alto });

  it("acepta un JPEG y un WebP dentro del rango", () => {
    expect(veredicto("imagen_de_ingreso", construirJpeg({ ancho: 1200, alto: 900 }))).toEqual(
      jpeg(1200, 900),
    );
    expect(veredicto("imagen_de_ingreso", webpVp8(1200, 900))).toEqual(webp(1200, 900));
  });

  it("las medidas de los cuatro bordes del rango pasan, y también las esquinas opuestas", () => {
    for (const [ancho, alto] of [
      [800, 600],
      [1600, 1200],
      [800, 1200],
      [1600, 600],
    ] as const) {
      expect(veredicto("imagen_de_ingreso", construirJpeg({ ancho, alto }))).toEqual(
        jpeg(ancho, alto),
      );
      expect(veredicto("imagen_de_ingreso", webpVp8(ancho, alto))).toEqual(webp(ancho, alto));
    }
  });

  it("un píxel fuera del rango, en cualquiera de los dos ejes y de los dos lados, se rechaza", () => {
    for (const [ancho, alto] of [
      [799, 600],
      [1601, 600],
      [800, 599],
      [800, 1201],
      [799, 1200],
      [1601, 1200],
      [1600, 599],
      [1600, 1201],
    ] as const) {
      expect(
        veredicto("imagen_de_ingreso", construirJpeg({ ancho, alto })),
        `${ancho}x${alto}`,
      ).toBe("DIMENSIONES_INCORRECTAS");
      expect(veredicto("imagen_de_ingreso", webpVp8(ancho, alto)), `${ancho}x${alto}`).toBe(
        "DIMENSIONES_INCORRECTAS",
      );
    }
  });

  it("rechaza PNG, ICO, GIF y HEIC: solo JPEG o WebP", () => {
    expect(veredicto("imagen_de_ingreso", construirPng({ ancho: 1200, alto: 900 }))).toBe(
      "FORMATO_NO_ADMITIDO",
    );
    expect(veredicto("imagen_de_ingreso", fixture("activos", "imagen-social.png"))).toBe(
      "FORMATO_NO_ADMITIDO",
    );
    expect(veredicto("imagen_de_ingreso", fixture("activos", "favicon-32.ico"))).toBe(
      "FORMATO_NO_ADMITIDO",
    );
    expect(veredicto("imagen_de_ingreso", fixture("fotos", "foto-480.gif"))).toBe(
      "FORMATO_NO_ADMITIDO",
    );
    expect(veredicto("imagen_de_ingreso", fixture("fotos", "foto-480.heic"))).toBe(
      "FORMATO_NO_ADMITIDO",
    );
  });

  it("pesa hasta 500 KB: 500 000 bytes pasa, uno más no", () => {
    for (const base of [construirJpeg({ ancho: 1200, alto: 900 }), webpVp8(1200, 900)]) {
      expect(veredicto("imagen_de_ingreso", conPeso(base, 500_000))).toMatchObject({ ancho: 1200 });
      expect(veredicto("imagen_de_ingreso", conPeso(base, 500_001))).toBe("PESO_EXCEDIDO");
    }
  });

  it("un WebP animado se rechaza antes de mirar las medidas", () => {
    const animada = construirRiff([fragmentoRiff("VP8X", datosVp8x(0x02, 1200, 900))]);
    expect(veredicto("imagen_de_ingreso", animada)).toBe("ANIMADO");
  });

  it("un JPEG con la cabecera rota da el error del lector", () => {
    expect(veredicto("imagen_de_ingreso", construirJpeg({ ancho: 0 }))).toBe("CABECERA_INVALIDA");
  });
});

describe("validarArchivoDeActivo: orden de las comprobaciones y pasaje de errores", () => {
  it("el peso se revisa antes de leer la cabecera y antes que las medidas", () => {
    expect(
      veredicto(
        "icono_192",
        conPeso(bytesDe([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 150_000),
      ),
    ).toBe("PESO_EXCEDIDO");
    expect(veredicto("icono_192", conPeso(construirPng({ ancho: 5, alto: 5 }), 150_000))).toBe(
      "PESO_EXCEDIDO",
    );
    expect(veredicto("favicon_ico", conPeso(bytesDe([0, 0, 1, 0]), 25_000))).toBe("PESO_EXCEDIDO");
  });

  it("el animado se dice antes que las medidas", () => {
    expect(
      veredicto(
        "icono_192",
        construirPng({
          ancho: 5,
          alto: 5,
          fragmentos: [fragmentoPng("acTL"), fragmentoPng("IDAT")],
        }),
      ),
    ).toBe("ANIMADO");
    const animada = construirRiff([fragmentoRiff("VP8X", datosVp8x(0x02, 5, 5))]);
    expect(veredicto("logo", animada)).toBe("ANIMADO");
  });

  it("un archivo con firma buena y cabecera rota da el error del lector", () => {
    expect(veredicto("icono_192", construirPng({ ancho: 0 }))).toBe("CABECERA_INVALIDA");
    expect(veredicto("logo", construirRiff([fragmentoRiff("VP8 ", datosVp8(10, 10))], 9999))).toBe(
      "TRUNCADO",
    );
    expect(veredicto("imagen_social", construirJpeg({ ancho: 0 }))).toBe("CABECERA_INVALIDA");
  });

  it("un WebP con alfa pero sin la exigencia de opacidad pasa", () => {
    expect(
      veredicto("logo", construirRiff([fragmentoRiff("VP8L", datosVp8l(100, 64, true))])),
    ).toEqual({
      formato: "webp",
      ancho: 100,
      alto: 64,
    });
  });
});

describe("validarFotoDeProducto", () => {
  const veredictoFoto = (variante: "480" | "1200", bytes: Uint8Array) => {
    const r = validarFotoDeProducto(variante, bytes);
    return r.ok ? r.valor : r.error;
  };

  it("las dos variantes son 480 x 360 (80 KB) y 1200 x 900 (300 KB)", () => {
    expect(VARIANTES_DE_FOTO).toEqual({
      "480": { ancho: 480, alto: 360, pesoMaximo: 80_000 },
      "1200": { ancho: 1200, alto: 900, pesoMaximo: 300_000 },
    });
  });

  it("acepta JPEG y WebP de la variante, y devuelve los bytes sin metadatos", () => {
    const jpg = fixture("fotos", "foto-480.jpg");
    expect(veredictoFoto("480", jpg)).toEqual({
      formato: "jpeg",
      ancho: 480,
      alto: 360,
      bytes: jpg,
    });
    const webp = fixture("fotos", "foto-480.webp");
    expect(veredictoFoto("480", webp)).toEqual({
      formato: "webp",
      ancho: 480,
      alto: 360,
      bytes: webp,
    });
    expect(veredictoFoto("480", fixture("fotos", "foto-480-progresiva.jpg"))).toMatchObject({
      formato: "jpeg",
    });
    expect(veredictoFoto("1200", fixture("fotos", "foto-1200.jpg"))).toMatchObject({
      formato: "jpeg",
      ancho: 1200,
      alto: 900,
    });
    expect(veredictoFoto("1200", fixture("fotos", "foto-1200.webp"))).toMatchObject({
      formato: "webp",
      ancho: 1200,
      alto: 900,
    });
  });

  it("JPEG con GPS en el EXIF: lo guardado no tiene APP1 ni APP13", () => {
    const r = validarFotoDeProducto("480", fixture("fotos", "foto-480-exif.jpg"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const analisis = analizarJpeg(r.valor.bytes);
    expect(analisis.ok && analisis.valor.segmentos.map((s) => s.marcador)).not.toContain(0xe1);
    expect(analisis.ok && analisis.valor.segmentos.map((s) => s.marcador)).not.toContain(0xed);
    expect(r.valor.bytes).toEqual(fixture("fotos", "foto-480.jpg"));
  });

  it("WebP con fragmento EXIF: se quita", () => {
    const r = validarFotoDeProducto("480", fixture("fotos", "foto-480-exif.webp"));
    expect(r).toEqual({
      ok: true,
      valor: {
        formato: "webp",
        ancho: 480,
        alto: 360,
        bytes: fixture("fotos", "foto-480-exif.limpia.webp"),
      },
    });
  });

  it("firma cambiada, PNG, GIF, HEIC, ICO y vacío: formato no admitido", () => {
    for (const nombre of [
      "foto-480-firma-cambiada.jpg",
      "foto-480-firma-cambiada.webp",
      "foto-480.png",
      "foto-480.gif",
      "foto-480.heic",
    ]) {
      expect(veredictoFoto("480", fixture("fotos", nombre))).toBe("FORMATO_NO_ADMITIDO");
    }
    expect(veredictoFoto("480", fixture("activos", "favicon-32.ico"))).toBe("FORMATO_NO_ADMITIDO");
    expect(veredictoFoto("480", new Uint8Array())).toBe("FORMATO_NO_ADMITIDO");
  });

  it("SVG: rechazado con su propio motivo, aunque pese poco o mucho", () => {
    expect(veredictoFoto("480", fixture("fotos", "foto.svg"))).toBe("SVG_NO_ADMITIDO");
    expect(veredictoFoto("1200", conPeso(fixture("fotos", "foto.svg"), 900_000))).toBe(
      "SVG_NO_ADMITIDO",
    );
  });

  it("pide las medidas exactas de la variante: 481, 1201 y la variante cruzada fallan", () => {
    expect(veredictoFoto("480", fixture("fotos", "foto-481.jpg"))).toBe("DIMENSIONES_INCORRECTAS");
    expect(veredictoFoto("480", fixture("fotos", "foto-481.webp"))).toBe("DIMENSIONES_INCORRECTAS");
    expect(veredictoFoto("1200", fixture("fotos", "foto-1201.jpg"))).toBe(
      "DIMENSIONES_INCORRECTAS",
    );
    expect(veredictoFoto("1200", fixture("fotos", "foto-480.jpg"))).toBe("DIMENSIONES_INCORRECTAS");
    expect(veredictoFoto("480", fixture("fotos", "foto-1200.jpg"))).toBe("DIMENSIONES_INCORRECTAS");
    for (const [ancho, alto] of [
      [479, 360],
      [480, 359],
      [480, 361],
      [481, 360],
      [360, 480],
    ] as const) {
      expect(veredictoFoto("480", construirJpeg({ ancho, alto }))).toBe("DIMENSIONES_INCORRECTAS");
      expect(veredictoFoto("480", webpVp8(ancho, alto))).toBe("DIMENSIONES_INCORRECTAS");
    }
    expect(veredictoFoto("1200", construirJpeg({ ancho: 1200, alto: 901 }))).toBe(
      "DIMENSIONES_INCORRECTAS",
    );
    expect(veredictoFoto("1200", construirJpeg({ ancho: 1199, alto: 900 }))).toBe(
      "DIMENSIONES_INCORRECTAS",
    );
    expect(veredictoFoto("1200", construirJpeg({ ancho: 1200, alto: 900 }))).toMatchObject({
      ancho: 1200,
    });
  });

  it("peso de la variante 480: 80 000 bytes pasa, 80 001 no; se mide sobre lo recibido", () => {
    const jpg = fixture("fotos", "foto-480.jpg");
    expect(veredictoFoto("480", conPeso(jpg, 80_000))).toMatchObject({ formato: "jpeg" });
    expect(veredictoFoto("480", conPeso(jpg, 80_001))).toBe("PESO_EXCEDIDO");
    const webp = fixture("fotos", "foto-480.webp");
    expect(veredictoFoto("480", conPeso(webp, 80_000))).toMatchObject({ formato: "webp" });
    expect(veredictoFoto("480", conPeso(webp, 80_001))).toBe("PESO_EXCEDIDO");
  });

  it("peso de la variante 1200: 300 000 pasa, 301 000 no", () => {
    const jpg = fixture("fotos", "foto-1200.jpg");
    expect(veredictoFoto("1200", conPeso(jpg, 300_000))).toMatchObject({ ancho: 1200 });
    expect(veredictoFoto("1200", conPeso(jpg, 300_001))).toBe("PESO_EXCEDIDO");
    expect(veredictoFoto("1200", conPeso(jpg, 301_000))).toBe("PESO_EXCEDIDO");
  });

  it("el peso que cuenta es el recibido: un APP1 gigante que hace pasar el límite se rechaza", () => {
    const gigante = segmentoJpeg(0xe1, new Array<number>(0xffff - 2).fill(0x41));
    const sucio = construirJpeg({ ancho: 480, alto: 360, antes: [...gigante, ...gigante] });
    expect(sucio.length).toBeGreaterThan(80_000);
    expect(veredictoFoto("480", sucio)).toBe("PESO_EXCEDIDO");
    // Con uno solo entra en el límite y se limpia.
    const unico = construirJpeg({ ancho: 480, alto: 360, antes: gigante });
    expect(unico.length).toBeLessThan(80_000);
    expect(veredictoFoto("480", unico)).toMatchObject({
      bytes: construirJpeg({ ancho: 480, alto: 360 }),
    });
  });

  it("archivos cortados o con un APP1 que declara de más: error con nombre", () => {
    expect(veredictoFoto("480", fixture("fotos", "foto-480-truncada.jpg"))).toBe("TRUNCADO");
    expect(veredictoFoto("480", fixture("fotos", "foto-480-truncada.webp"))).toBe("TRUNCADO");
    expect(veredictoFoto("480", fixture("fotos", "foto-480-app1-gigante.jpg"))).toBe("TRUNCADO");
  });

  it("rechaza el WebP animado y se dice antes que las medidas", () => {
    expect(veredictoFoto("480", fixture("fotos", "foto-480-animada.webp"))).toBe("ANIMADO");
    expect(veredictoFoto("1200", fixture("fotos", "foto-480-animada.webp"))).toBe("ANIMADO");
  });

  it("acepta un WebP con alfa (una foto puede tenerlo)", () => {
    const conAlfa = construirRiff([
      fragmentoRiff("VP8X", datosVp8x(0x10, 480, 360)),
      fragmentoRiff("VP8L", datosVp8l(480, 360, true)),
    ]);
    expect(veredictoFoto("480", conAlfa)).toMatchObject({ formato: "webp", ancho: 480 });
  });

  it("un JPEG acepta cola detrás del EOI pero la devuelve sin ella", () => {
    const conCola = construirJpeg({ cola: [1, 2, 3, 4, 5] });
    const r = veredictoFoto("480", conCola);
    expect(r).toMatchObject({ bytes: bytesDe(construirJpeg(), []) });
    expect(EOI).toEqual([0xff, 0xd9]);
  });
});
