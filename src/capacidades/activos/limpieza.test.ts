import { describe, expect, it } from "vitest";
import {
  BANDERA_ALFA,
  BANDERA_ANIMACION,
  BANDERA_EXIF,
  BANDERA_XMP,
  EOI,
  SOI,
  ascii,
  bytesDe,
  construirJpeg,
  construirRiff,
  datosVp8,
  datosVp8x,
  enVista,
  escaneo,
  fixture,
  fragmentoRiff,
  segmentoJpeg,
  sof,
  webpVp8,
} from "../../../test/utilidades/imagenes";
import { analizarJpeg, leerJpeg, leerWebp } from "./cabeceras";
import { analizarFoto, quitarMetadatos } from "./limpieza";

const limpiar = (bytes: Uint8Array) => {
  const r = quitarMetadatos(bytes);
  if (!r.ok) throw new Error(`no se pudo limpiar: ${r.error}`);
  return r.valor;
};

const marcadoresDe = (bytes: Uint8Array) => {
  const r = analizarJpeg(bytes);
  if (!r.ok) throw new Error(r.error);
  return r.valor.segmentos.map((s) => s.marcador);
};

describe("quitarMetadatos de un JPEG", () => {
  it("golden: quita APP1 y APP13, deja el resto y descarta lo que sigue al EOI", () => {
    const entrada = bytesDe(
      [0xff, 0xd8],
      [0xff, 0xe0, 0x00, 0x05, 0x4a, 0x46, 0x49], // APP0 «JFI»
      [0xff, 0xe1, 0x00, 0x07, 0x45, 0x78, 0x69, 0x66, 0x00], // APP1 Exif
      [0xff, 0xed, 0x00, 0x06, 0x38, 0x42, 0x49, 0x4d], // APP13 «8BIM»
      [0xff, 0xfe, 0x00, 0x05, 0x61, 0x62, 0x63], // comentario «abc»
      [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x20, 0x01, 0x01, 0x11, 0x00], // SOF0 32x16
      [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00], // SOS
      [0x12, 0xff, 0x00, 0x34], // datos con relleno de byte
      [0xff, 0xd9], // EOI
      [0x99, 0x99, 0x99], // basura posterior
    );
    const esperado = bytesDe(
      [0xff, 0xd8],
      [0xff, 0xe0, 0x00, 0x05, 0x4a, 0x46, 0x49],
      [0xff, 0xfe, 0x00, 0x05, 0x61, 0x62, 0x63],
      [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x20, 0x01, 0x01, 0x11, 0x00],
      [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00],
      [0x12, 0xff, 0x00, 0x34],
      [0xff, 0xd9],
    );
    expect(limpiar(entrada)).toEqual(esperado);
  });

  it("el archivo real con EXIF (GPS), XMP e IPTC queda idéntico al mismo sin metadatos", () => {
    const sucio = fixture("fotos", "foto-480-exif.jpg");
    expect(marcadoresDe(sucio).slice(0, 4)).toEqual([0xe0, 0xe1, 0xe1, 0xed]);
    expect(limpiar(sucio)).toEqual(fixture("fotos", "foto-480.jpg"));
  });

  it("un archivo ya limpio sale igual, pero en un arreglo nuevo", () => {
    const limpio = fixture("fotos", "foto-480.jpg");
    const salida = limpiar(limpio);
    expect(salida).toEqual(limpio);
    expect(salida).not.toBe(limpio);
    salida[0] = 0;
    expect(limpio[0]).toBe(0xff);
  });

  it("también en un progresivo con varios escaneos", () => {
    const limpio = fixture("fotos", "foto-480-progresiva.jpg");
    expect(limpiar(limpio)).toEqual(limpio);
  });

  it("quita APP1 y APP13 donde estén: antes de todo, entre escaneos y repetidos", () => {
    const e1 = segmentoJpeg(0xe1, [1, 2, 3]);
    const e13 = segmentoJpeg(0xed, [4, 5]);
    const bytes = bytesDe(
      SOI,
      e1,
      segmentoJpeg(0xe0, [9]),
      e13,
      e1,
      sof(5, 6, { marcador: 0xc2 }),
      escaneo(),
      e1,
      e13,
      segmentoJpeg(0xc4, [7]),
      escaneo([8, 8]),
      EOI,
    );
    const salida = limpiar(bytes);
    expect(marcadoresDe(salida)).toEqual([0xe0, 0xc2, 0xda, 0xc4, 0xda, 0xd9]);
    expect(salida).toEqual(
      bytesDe(
        SOI,
        segmentoJpeg(0xe0, [9]),
        sof(5, 6, { marcador: 0xc2 }),
        escaneo(),
        segmentoJpeg(0xc4, [7]),
        escaneo([8, 8]),
        EOI,
      ),
    );
  });

  it("deja los demás segmentos de aplicación (perfil de color, Adobe) y los comentarios", () => {
    const resto = [
      segmentoJpeg(0xe0, [1]),
      segmentoJpeg(0xe2, [2]),
      segmentoJpeg(0xe3, [3]),
      segmentoJpeg(0xe4, [3]),
      segmentoJpeg(0xec, [4]),
      segmentoJpeg(0xee, [5]),
      segmentoJpeg(0xef, [5]),
      segmentoJpeg(0xfe, [6]),
      segmentoJpeg(0xe1 - 1, [6]),
      segmentoJpeg(0xed + 1, [6]),
    ].flat();
    const bytes = construirJpeg({ antes: resto });
    expect(limpiar(bytes)).toEqual(bytes);
  });

  it("un APP1 del largo máximo (65 533 bytes de datos) se quita entero", () => {
    const gigante = segmentoJpeg(0xe1, new Array<number>(0xffff - 2).fill(0x41));
    expect(gigante.length).toBe(2 + 0xffff);
    const sucio = construirJpeg({ antes: gigante });
    const limpio = construirJpeg();
    expect(sucio.length).toBe(limpio.length + gigante.length);
    expect(limpiar(sucio)).toEqual(limpio);
  });

  it("un APP1 que declara más de lo que hay no se lee fuera de rango: error y no excepción", () => {
    const r = quitarMetadatos(fixture("fotos", "foto-480-app1-gigante.jpg"));
    expect(r).toEqual({ ok: false, error: "TRUNCADO" });
  });

  it("los FF de relleno entre segmentos y los bytes después del EOI no pasan", () => {
    const bytes = bytesDe(
      SOI,
      [0xff, 0xff],
      segmentoJpeg(0xe0, [1]),
      [0xff],
      sof(5, 6),
      escaneo(),
      EOI,
      [1, 2, 3],
    );
    expect(limpiar(bytes)).toEqual(
      bytesDe(SOI, segmentoJpeg(0xe0, [1]), sof(5, 6), escaneo(), EOI),
    );
  });

  it("el relleno que sigue a los datos de un escaneo se queda con ellos (no se distingue de los datos)", () => {
    const bytes = bytesDe(SOI, sof(5, 6), escaneo([1, 0xff, 0xff]), EOI);
    expect(limpiar(bytes)).toEqual(bytes);
  });

  it("los bytes FF E1 dentro de los datos del escaneo (FF 00 E1) no se toman por un marcador", () => {
    const bytes = construirJpeg({ antes: segmentoJpeg(0xe1, [1]) });
    const conDatos = bytesDe(
      SOI,
      sof(5, 6),
      escaneo([0xff, 0x00, 0xe1, 0x00, 0xff, 0x00, 0xed]),
      EOI,
    );
    expect(limpiar(conDatos)).toEqual(conDatos);
    expect(limpiar(bytes)).toEqual(construirJpeg());
  });

  it("no cambia las medidas ni lo que el lector acepta", () => {
    const sucio = fixture("fotos", "foto-480-exif.jpg");
    expect(leerJpeg(limpiar(sucio))).toEqual(leerJpeg(sucio));
  });

  it("limpia igual desde una vista con desplazamiento", () => {
    const sucio = fixture("fotos", "foto-480-exif.jpg");
    expect(limpiar(enVista(sucio))).toEqual(limpiar(sucio));
  });
});

describe("quitarMetadatos de un WebP", () => {
  it("golden: quita EXIF y XMP, baja sus banderas, conserva el resto y reescribe el tamaño", () => {
    const entrada = bytesDe(
      ascii("RIFF"),
      [0x4e, 0, 0, 0], // 78 = 4 + 18 (VP8X) + 24 (VP8) + 12 (EXIF y su relleno) + 10 (XMP) + 10 (ICCP)
      ascii("WEBP"),
      ascii("VP8X"),
      [0x0a, 0, 0, 0],
      [0x1c, 0, 0, 0, 0x0f, 0, 0, 0x0f, 0, 0], // alfa + EXIF + XMP, lienzo 16x16
      ascii("VP8 "),
      [0x10, 0, 0, 0],
      [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, 0x10, 0x00, 0x10, 0x00, 1, 2, 3, 4, 5, 6],
      ascii("EXIF"),
      [0x03, 0, 0, 0],
      [0xaa, 0xbb, 0xcc, 0x00], // largo impar con su relleno
      ascii("XMP "),
      [0x02, 0, 0, 0],
      [0xdd, 0xee],
      ascii("ICCP"),
      [0x01, 0, 0, 0],
      [0x77, 0x00],
      [0x55, 0x55, 0x55], // basura posterior al tamaño declarado
    );
    const esperado = bytesDe(
      ascii("RIFF"),
      [0x38, 0, 0, 0], // 56 = 4 + 18 + 24 + 10
      ascii("WEBP"),
      ascii("VP8X"),
      [0x0a, 0, 0, 0],
      [0x10, 0, 0, 0, 0x0f, 0, 0, 0x0f, 0, 0], // queda solo el alfa
      ascii("VP8 "),
      [0x10, 0, 0, 0],
      [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, 0x10, 0x00, 0x10, 0x00, 1, 2, 3, 4, 5, 6],
      ascii("ICCP"),
      [0x01, 0, 0, 0],
      [0x77, 0x00],
    );
    expect(limpiar(entrada)).toEqual(esperado);
  });

  it("el archivo real con EXIF y XMP queda como el golden calculado aparte", () => {
    expect(limpiar(fixture("fotos", "foto-480-exif.webp"))).toEqual(
      fixture("fotos", "foto-480-exif.limpia.webp"),
    );
  });

  it("un WebP simple sin metadatos sale igual, en un arreglo nuevo", () => {
    const limpio = fixture("fotos", "foto-480.webp");
    const salida = limpiar(limpio);
    expect(salida).toEqual(limpio);
    expect(salida).not.toBe(limpio);
    const sinVp8x = webpVp8(32, 16);
    expect(limpiar(sinVp8x)).toEqual(sinVp8x);
  });

  it("solo baja las banderas de EXIF y XMP: las de ICC, alfa y animación quedan", () => {
    for (const banderas of [
      0x00,
      0x20,
      BANDERA_ALFA,
      BANDERA_ANIMACION,
      0x20 | BANDERA_ALFA | BANDERA_ANIMACION,
    ]) {
      for (const metadatos of [0, BANDERA_EXIF, BANDERA_XMP, BANDERA_EXIF | BANDERA_XMP]) {
        const construir = (b: number) =>
          construirRiff([
            fragmentoRiff("VP8X", datosVp8x(b, 16, 16)),
            fragmentoRiff("VP8 ", datosVp8(16, 16)),
          ]);
        expect(limpiar(construir(banderas | metadatos))).toEqual(construir(banderas));
      }
    }
  });

  it("quita los fragmentos EXIF y XMP donde estén, varias veces, y deja un orden estable", () => {
    const vp8x = fragmentoRiff("VP8X", datosVp8x(0, 16, 16));
    const vp8 = fragmentoRiff("VP8 ", datosVp8(16, 16, [1, 2, 3]));
    const exif = fragmentoRiff("EXIF", [1, 2, 3, 4, 5]);
    const xmp = fragmentoRiff("XMP ", [9, 9]);
    const otro = fragmentoRiff("ZZZZ", [7]);
    const sucio = construirRiff([vp8x, exif, otro, vp8, xmp, exif, xmp, otro]);
    expect(limpiar(sucio)).toEqual(construirRiff([vp8x, otro, vp8, otro]));
  });

  it("un WebP simple con un EXIF suelto lo pierde sin tocar los datos de la imagen", () => {
    const vp8 = fragmentoRiff("VP8 ", datosVp8(16, 16, [1, 2, 3, 4, 5, 6, 7]));
    const sucio = construirRiff([vp8, fragmentoRiff("EXIF", [1, 2, 3])]);
    expect(limpiar(sucio)).toEqual(construirRiff([vp8]));
  });

  it("un VP8X que no es el primero no se toca (es un fragmento desconocido)", () => {
    const vp8 = fragmentoRiff("VP8 ", datosVp8(16, 16));
    const intruso = fragmentoRiff("VP8X", datosVp8x(BANDERA_EXIF | BANDERA_XMP, 16, 16));
    const bytes = construirRiff([vp8, intruso]);
    expect(limpiar(bytes)).toEqual(bytes);
  });

  it("el tamaño del RIFF se reescribe en little-endian, con 4 bytes", () => {
    const grande = construirRiff([
      fragmentoRiff("VP8 ", datosVp8(16, 16, new Array<number>(400).fill(3))),
      fragmentoRiff("EXIF", new Array<number>(300).fill(1)),
    ]);
    const salida = limpiar(grande);
    const tamano = salida[4]! + salida[5]! * 256 + salida[6]! * 65536 + salida[7]! * 16777216;
    expect(tamano).toBe(salida.length - 8);
    expect(salida.length).toBe(12 + 8 + 410);
  });

  it("no cambia las medidas ni lo que el lector acepta", () => {
    const sucio = fixture("fotos", "foto-480-exif.webp");
    expect(leerWebp(limpiar(sucio))).toEqual(leerWebp(sucio));
  });

  it("limpia igual desde una vista con desplazamiento", () => {
    const sucio = fixture("fotos", "foto-480-exif.webp");
    expect(limpiar(enVista(sucio))).toEqual(limpiar(sucio));
  });

  it("el animado conserva sus fragmentos de animación", () => {
    const real = fixture("fotos", "foto-480-animada.webp");
    expect(limpiar(real)).toEqual(real);
  });
});

describe("quitarMetadatos con lo que no es una foto", () => {
  it("devuelve un error con nombre para PNG, SVG, ICO, vacío y firmas cambiadas", () => {
    for (const bytes of [
      fixture("activos", "icono-192.png"),
      fixture("activos", "logo.svg"),
      fixture("activos", "favicon-32.ico"),
      fixture("fotos", "foto-480.gif"),
      new Uint8Array(),
      fixture("fotos", "foto-480-firma-cambiada.jpg"),
      fixture("fotos", "foto-480-firma-cambiada.webp"),
    ]) {
      expect(quitarMetadatos(bytes)).toEqual({ ok: false, error: "FORMATO_NO_RECONOCIDO" });
    }
  });

  it("devuelve el error del lector para archivos cortados o incoherentes", () => {
    expect(quitarMetadatos(fixture("fotos", "foto-480-truncada.jpg"))).toEqual({
      ok: false,
      error: "TRUNCADO",
    });
    expect(quitarMetadatos(fixture("fotos", "foto-480-truncada.webp"))).toEqual({
      ok: false,
      error: "TRUNCADO",
    });
    expect(quitarMetadatos(construirRiff([fragmentoRiff("EXIF", [1, 2])]))).toEqual({
      ok: false,
      error: "CABECERA_INVALIDA",
    });
  });
});

describe("analizarFoto", () => {
  it("entrega la cabecera y los bytes sin metadatos en una sola pasada", () => {
    const r = analizarFoto(fixture("fotos", "foto-480-exif.jpg"));
    expect(r).toEqual({
      ok: true,
      valor: {
        cabecera: { formato: "jpeg", ancho: 480, alto: 360, animado: false },
        bytes: fixture("fotos", "foto-480.jpg"),
      },
    });
    const w = analizarFoto(fixture("fotos", "foto-480-exif.webp"));
    expect(w).toMatchObject({
      ok: true,
      valor: { cabecera: { formato: "webp", ancho: 480, alto: 360 } },
    });
  });

  it("pasa el error del lector y nombra lo que no es JPEG ni WebP", () => {
    expect(analizarFoto(fixture("fotos", "foto-480-truncada.jpg"))).toEqual({
      ok: false,
      error: "TRUNCADO",
    });
    expect(analizarFoto(fixture("fotos", "foto-480-truncada.webp"))).toEqual({
      ok: false,
      error: "TRUNCADO",
    });
    expect(analizarFoto(fixture("fotos", "foto-480.png"))).toEqual({
      ok: false,
      error: "FORMATO_NO_RECONOCIDO",
    });
  });
});
