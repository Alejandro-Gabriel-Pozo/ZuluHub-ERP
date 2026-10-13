import { describe, expect, it } from "vitest";
import {
  BANDERA_ALFA,
  BANDERA_ANIMACION,
  BANDERA_EXIF,
  EOI,
  FIRMA_PNG,
  SOI,
  ascii,
  bytesDe,
  construirIco,
  construirJpeg,
  construirPng,
  construirRiff,
  datosVp8,
  datosVp8l,
  datosVp8x,
  enVista,
  escaneo,
  fixture,
  fragmentoPng,
  fragmentoRiff,
  segmentoJpeg,
  sof,
  u16be,
  u16le,
  u32be,
  u32le,
  webpVp8,
} from "../../../test/utilidades/imagenes";
import {
  analizarJpeg,
  analizarWebp,
  detectarFormato,
  esOpaca,
  fragmentosDeRiff,
  leerCabecera,
  leerIco,
  leerJpeg,
  leerPng,
  leerWebp,
  pngEsOpaco,
  type CabeceraPng,
} from "./cabeceras";

const png = (ancho: number, alto: number, tipoDeColor = 6) => ({
  formato: "png" as const,
  ancho,
  alto,
  tipoDeColor,
  conTrns: false,
  animado: false,
});

describe("detectarFormato", () => {
  it("reconoce cada formato por su firma en archivos reales", () => {
    expect(detectarFormato(fixture("activos", "icono-192.png"))).toBe("png");
    expect(detectarFormato(fixture("fotos", "foto-480.jpg"))).toBe("jpeg");
    expect(detectarFormato(fixture("fotos", "foto-480.webp"))).toBe("webp");
    expect(detectarFormato(fixture("activos", "favicon-32.ico"))).toBe("ico");
    expect(detectarFormato(fixture("activos", "logo.svg"))).toBe("svg");
  });

  it("no reconoce GIF, HEIC, vacío ni texto cualquiera", () => {
    expect(detectarFormato(fixture("fotos", "foto-480.gif"))).toBe("desconocido");
    expect(detectarFormato(fixture("fotos", "foto-480.heic"))).toBe("desconocido");
    expect(detectarFormato(new Uint8Array())).toBe("desconocido");
    expect(detectarFormato(bytesDe(ascii("<html><body>hola</body></html>")))).toBe("desconocido");
  });

  it("exige la firma completa: cambiar cualquiera de los 8 bytes del PNG lo descarta", () => {
    const buena = fixture("activos", "icono-192.png");
    for (let i = 0; i < 8; i++) {
      const mala = buena.slice();
      mala[i] = (mala[i] as number) ^ 0x01;
      expect(detectarFormato(mala)).toBe("desconocido");
    }
    expect(detectarFormato(buena.subarray(0, 7))).toBe("desconocido");
    expect(detectarFormato(buena.subarray(0, 8))).toBe("png");
  });

  it("JPEG pide FF D8 FF; WebP pide RIFF y WEBP a 8 bytes; ICO pide 00 00 01 00", () => {
    expect(detectarFormato(bytesDe(0xff, 0xd8))).toBe("desconocido");
    expect(detectarFormato(bytesDe(0xff, 0xd8, 0xff))).toBe("jpeg");
    expect(detectarFormato(bytesDe(0xff, 0xd8, 0xfe))).toBe("desconocido");
    expect(detectarFormato(bytesDe(ascii("RIFF"), u32le(4), ascii("WAVE")))).toBe("desconocido");
    expect(detectarFormato(bytesDe(ascii("RIFX"), u32le(4), ascii("WEBP")))).toBe("desconocido");
    expect(detectarFormato(bytesDe(ascii("RIFF"), u32le(4), ascii("WEB")))).toBe("desconocido");
    expect(detectarFormato(bytesDe(ascii("RIFF"), u32le(4), ascii("WEBP")))).toBe("webp");
    expect(detectarFormato(bytesDe(0, 0, 1))).toBe("desconocido");
    expect(detectarFormato(bytesDe(0, 0, 2, 0))).toBe("desconocido"); // cursor
    expect(detectarFormato(bytesDe(0, 0, 1, 0))).toBe("ico");
  });

  it("marca un SVG si `<svg` está en el primer kilobyte, en mayúsculas o minúsculas", () => {
    expect(detectarFormato(bytesDe(ascii('<?xml version="1.0"?>\n<SVG xmlns="x"/>')))).toBe("svg");
    const relleno = (n: number) => new Array<number>(n).fill(0x20);
    expect(detectarFormato(bytesDe(relleno(1020), ascii("<svg")))).toBe("svg");
    expect(detectarFormato(bytesDe(relleno(1021), ascii("<svg")))).toBe("desconocido");
    expect(detectarFormato(bytesDe(ascii("<sv")))).toBe("desconocido");
  });
});

describe("leerPng con archivos reales", () => {
  it("lee medidas y tipo de color de cada archivo", () => {
    expect(leerPng(fixture("activos", "icono-192.png"))).toEqual({
      ok: true,
      valor: png(192, 192),
    });
    expect(leerPng(fixture("activos", "icono-192-191px.png"))).toEqual({
      ok: true,
      valor: png(191, 191),
    });
    expect(leerPng(fixture("activos", "icono-512.png"))).toEqual({
      ok: true,
      valor: png(512, 512),
    });
    expect(leerPng(fixture("activos", "apple-180.png"))).toEqual({
      ok: true,
      valor: png(180, 180, 2),
    });
    expect(leerPng(fixture("activos", "apple-180-rgba.png"))).toEqual({
      ok: true,
      valor: png(180, 180, 6),
    });
    expect(leerPng(fixture("activos", "apple-180-grises.png"))).toEqual({
      ok: true,
      valor: png(180, 180, 0),
    });
    expect(leerPng(fixture("activos", "apple-180-paleta.png"))).toEqual({
      ok: true,
      valor: png(180, 180, 3),
    });
    expect(leerPng(fixture("activos", "apple-180-trns.png"))).toEqual({
      ok: true,
      valor: { ...png(180, 180, 2), conTrns: true },
    });
    expect(leerPng(fixture("activos", "logo.png"))).toEqual({ ok: true, valor: png(256, 64) });
  });

  it("rechaza la firma cambiada, el SVG colado y el archivo cortado", () => {
    expect(leerPng(fixture("activos", "icono-192-firma-cambiada.png"))).toEqual({
      ok: false,
      error: "FORMATO_NO_RECONOCIDO",
    });
    expect(leerPng(fixture("activos", "icono-192-svg-colado.png"))).toEqual({
      ok: false,
      error: "FORMATO_NO_RECONOCIDO",
    });
    expect(leerPng(fixture("activos", "icono-192-truncado.png"))).toEqual({
      ok: false,
      error: "TRUNCADO",
    });
  });

  it("lee igual desde una vista con desplazamiento dentro de un buffer más grande", () => {
    const real = fixture("activos", "apple-180-trns.png");
    expect(leerPng(enVista(real))).toEqual(leerPng(real));
  });
});

describe("leerPng con bytes armados", () => {
  const fallo = (bytes: Uint8Array) => {
    const r = leerPng(bytes);
    return r.ok ? "ok" : r.error;
  };

  it("lee un PNG mínimo y toma ancho y alto de su lugar", () => {
    expect(leerPng(construirPng({ ancho: 300, alto: 7, tipoDeColor: 2 }))).toEqual({
      ok: true,
      valor: png(300, 7, 2),
    });
  });

  it("las medidas son enteros de 32 bits sin signo: 0 y más de 2^31-1 no valen", () => {
    expect(fallo(construirPng({ ancho: 0 }))).toBe("CABECERA_INVALIDA");
    expect(fallo(construirPng({ alto: 0 }))).toBe("CABECERA_INVALIDA");
    expect(fallo(construirPng({ ancho: 0x80000000 }))).toBe("CABECERA_INVALIDA");
    expect(fallo(construirPng({ alto: 0x80000000 }))).toBe("CABECERA_INVALIDA");
    expect(fallo(construirPng({ ancho: 0x7fffffff, alto: 0x7fffffff }))).toBe("ok");
    expect(fallo(construirPng({ ancho: 1, alto: 1 }))).toBe("ok");
    // Los 4 bytes cuentan: 0x01020304.
    expect(leerPng(construirPng({ ancho: 0x01020304, alto: 0x05060708 }))).toEqual({
      ok: true,
      valor: png(0x01020304, 0x05060708, 2),
    });
  });

  it("el IHDR tiene que ser de 13 bytes y llamarse IHDR", () => {
    const bueno = construirPng();
    const largoMalo = bueno.slice();
    largoMalo[11] = 12;
    expect(fallo(largoMalo)).toBe("CABECERA_INVALIDA");
    const largoMalo2 = bueno.slice();
    largoMalo2[11] = 14;
    expect(fallo(largoMalo2)).toBe("CABECERA_INVALIDA");
    const tipoMalo = bueno.slice();
    tipoMalo.set(ascii("IHDX"), 12);
    expect(fallo(tipoMalo)).toBe("CABECERA_INVALIDA");
  });

  it("acepta solo las combinaciones de tipo de color y profundidad del estándar", () => {
    const validas: [number, number[]][] = [
      [0, [1, 2, 4, 8, 16]],
      [2, [8, 16]],
      [3, [1, 2, 4, 8]],
      [4, [8, 16]],
      [6, [8, 16]],
    ];
    for (let tipo = 0; tipo < 8; tipo++) {
      for (const profundidad of [0, 1, 2, 3, 4, 8, 12, 16, 32]) {
        const esperado = validas.find(([t]) => t === tipo)?.[1].includes(profundidad) ?? false;
        expect(fallo(construirPng({ tipoDeColor: tipo, profundidad }))).toBe(
          esperado ? "ok" : "CABECERA_INVALIDA",
        );
      }
    }
  });

  it("compresión y filtro 0; entrelazado 0 o 1", () => {
    expect(fallo(construirPng({ compresion: 1 }))).toBe("CABECERA_INVALIDA");
    expect(fallo(construirPng({ filtro: 1 }))).toBe("CABECERA_INVALIDA");
    expect(fallo(construirPng({ entrelazado: 1 }))).toBe("ok");
    expect(fallo(construirPng({ entrelazado: 2 }))).toBe("CABECERA_INVALIDA");
  });

  it("el encabezado cortado es TRUNCADO: hasta el entrelazado hacen falta 29 bytes; y después, el IEND", () => {
    const completo = construirPng({ fragmentos: [], conIend: false });
    expect(completo.length).toBe(33);
    expect(fallo(completo.subarray(0, 28))).toBe("TRUNCADO");
    expect(fallo(completo.subarray(0, 29))).toBe("TRUNCADO"); // campos bien, falta el resto
    expect(fallo(completo)).toBe("TRUNCADO");
    expect(fallo(bytesDe(FIRMA_PNG))).toBe("TRUNCADO");
    // Con 29 bytes ya se lee el IHDR: un campo malo se dice como tal, no como corte.
    const malo = construirPng({ compresion: 1, fragmentos: [], conIend: false });
    expect(fallo(malo.subarray(0, 29))).toBe("CABECERA_INVALIDA");
    expect(fallo(malo.subarray(0, 28))).toBe("TRUNCADO");
  });

  it("recorre los fragmentos hasta IEND: cada uno entero y con IDAT antes", () => {
    expect(fallo(construirPng({ fragmentos: [] }))).toBe("CABECERA_INVALIDA"); // sin IDAT
    expect(fallo(construirPng({ conIend: false }))).toBe("TRUNCADO"); // sin IEND
    const bueno = construirPng();
    // IEND al ras del final: ok; un byte menos: TRUNCADO.
    expect(fallo(bueno)).toBe("ok");
    expect(fallo(bueno.subarray(0, bueno.length - 1))).toBe("TRUNCADO");
    // Un fragmento que declara un largo que se pasa del archivo, justo por 1, o enorme.
    const pasado = (largo: number) =>
      construirPng({ fragmentos: [[...u32be(largo), ...ascii("IDAT"), 1, 2, 3, 0, 0, 0, 0]] });
    expect(fallo(pasado(3))).toBe("ok"); // el fragmento entra justo
    expect(fallo(pasado(4))).toBe("TRUNCADO");
    expect(fallo(pasado(0xffffffff))).toBe("TRUNCADO");
    // Un IEND que declara más de lo que hay también es un corte.
    expect(
      fallo(bytesDe(construirPng({ conIend: false }), [0, 0, 0, 5], ascii("IEND"), [0, 0, 0, 0])),
    ).toBe("TRUNCADO");
    // Sin IDAT no hay imagen, aunque haya otros fragmentos.
    expect(fallo(construirPng({ fragmentos: [fragmentoPng("teXt", [1])] }))).toBe(
      "CABECERA_INVALIDA",
    );
    // Fragmentos desconocidos se saltean; lo que sobra después de IEND se ignora.
    const conOtros = construirPng({
      fragmentos: [
        fragmentoPng("teXt", [1, 2, 3, 4, 5]),
        fragmentoPng("IDAT", [9]),
        fragmentoPng("zTXt"),
      ],
    });
    expect(fallo(conOtros)).toBe("ok");
    expect(fallo(bytesDe(bueno, [1, 2, 3]))).toBe("ok");
  });

  it("un fragmento de largo cero y uno de 12 bytes de encabezado sin datos cuentan bien", () => {
    // pos + 12 > largo: el último fragmento (IEND) mide justo 12.
    const r = leerPng(construirPng({ fragmentos: [fragmentoPng("IDAT")] }));
    expect(r.ok).toBe(true);
  });

  it("marca tRNS y acTL donde estén, antes o después de los datos", () => {
    const con = (...fr: number[][]) => leerPng(construirPng({ fragmentos: fr }));
    expect(con(fragmentoPng("tRNS", [1, 2]), fragmentoPng("IDAT", [1]))).toMatchObject({
      ok: true,
      valor: { conTrns: true, animado: false },
    });
    expect(con(fragmentoPng("IDAT", [1]), fragmentoPng("tRNS", [1]))).toMatchObject({
      ok: true,
      valor: { conTrns: true },
    });
    expect(
      con(fragmentoPng("acTL", [0, 0, 0, 2, 0, 0, 0, 0]), fragmentoPng("IDAT", [1])),
    ).toMatchObject({
      ok: true,
      valor: { conTrns: false, animado: true },
    });
    expect(con(fragmentoPng("IDAT", [1]))).toMatchObject({
      ok: true,
      valor: { conTrns: false, animado: false },
    });
  });
});

describe("pngEsOpaco", () => {
  const cabecera = (tipoDeColor: number, conTrns: boolean): CabeceraPng => ({
    ...png(1, 1, tipoDeColor),
    conTrns,
  });

  it("solo los tipos 0 y 2, y sin tRNS", () => {
    expect(pngEsOpaco(cabecera(0, false))).toBe(true);
    expect(pngEsOpaco(cabecera(2, false))).toBe(true);
    expect(pngEsOpaco(cabecera(3, false))).toBe(false);
    expect(pngEsOpaco(cabecera(4, false))).toBe(false);
    expect(pngEsOpaco(cabecera(6, false))).toBe(false);
    expect(pngEsOpaco(cabecera(0, true))).toBe(false);
    expect(pngEsOpaco(cabecera(2, true))).toBe(false);
  });
});

describe("fragmentosDeRiff", () => {
  it("parte el contenedor y calcula el relleno a par", () => {
    const bytes = construirRiff([
      fragmentoRiff("AAAA", [1, 2, 3]),
      fragmentoRiff("BBBB", [1, 2]),
      fragmentoRiff("CCCC", []),
    ]);
    expect(fragmentosDeRiff(bytes)).toEqual({
      ok: true,
      valor: [
        { tipo: "AAAA", inicio: 12, largo: 3, fin: 24 },
        { tipo: "BBBB", inicio: 24, largo: 2, fin: 34 },
        { tipo: "CCCC", inicio: 34, largo: 0, fin: 42 },
      ],
    });
  });

  it("el tamaño declarado no puede pasar de los bytes: justo ok, uno más TRUNCADO", () => {
    const fr = [fragmentoRiff("AAAA", [1, 2])];
    expect(fragmentosDeRiff(construirRiff(fr)).ok).toBe(true);
    expect(fragmentosDeRiff(construirRiff(fr, 4 + 10 + 1))).toEqual({
      ok: false,
      error: "TRUNCADO",
    });
    expect(fragmentosDeRiff(construirRiff(fr, 0xffffffff))).toEqual({
      ok: false,
      error: "TRUNCADO",
    });
  });

  it("los bytes que sobran después del tamaño declarado no se leen", () => {
    const bytes = construirRiff([fragmentoRiff("AAAA", [1, 2])], undefined, [9, 9, 9, 9, 9]);
    expect(fragmentosDeRiff(bytes)).toEqual({
      ok: true,
      valor: [{ tipo: "AAAA", inicio: 12, largo: 2, fin: 22 }],
    });
  });

  it("un fragmento tiene que entrar entero, con su relleno, en el tamaño declarado", () => {
    // Datos que se pasan por 1; relleno que falta (largo impar sin el byte de relleno); encabezado partido.
    expect(
      fragmentosDeRiff(
        bytesDe(
          ascii("RIFF"),
          u32le(4 + 8 + 2),
          ascii("WEBP"),
          ascii("AAAA"),
          u32le(3),
          1,
          2,
          3,
          0,
        ),
      ).ok,
    ).toBe(false);
    expect(
      fragmentosDeRiff(
        bytesDe(ascii("RIFF"), u32le(4 + 8 + 3), ascii("WEBP"), ascii("AAAA"), u32le(3), 1, 2, 3),
      ),
    ).toEqual({ ok: false, error: "TRUNCADO" });
    expect(
      fragmentosDeRiff(bytesDe(ascii("RIFF"), u32le(4 + 7), ascii("WEBP"), ascii("AAAA"), 0, 0, 0)),
    ).toEqual({ ok: false, error: "TRUNCADO" });
    expect(
      fragmentosDeRiff(
        bytesDe(ascii("RIFF"), u32le(4 + 8), ascii("WEBP"), ascii("AAAA"), u32le(0)),
      ),
    ).toMatchObject({ ok: true });
    // Un largo enorme no desborda.
    expect(
      fragmentosDeRiff(
        bytesDe(ascii("RIFF"), u32le(4 + 8), ascii("WEBP"), ascii("AAAA"), u32le(0xffffffff)),
      ),
    ).toEqual({ ok: false, error: "TRUNCADO" });
  });

  it("sin fragmentos devuelve la lista vacía; sin firma, FORMATO_NO_RECONOCIDO", () => {
    expect(fragmentosDeRiff(construirRiff([]))).toEqual({ ok: true, valor: [] });
    expect(fragmentosDeRiff(bytesDe(ascii("RIFF"), u32le(0), ascii("WEBP")))).toEqual({
      ok: true,
      valor: [],
    });
    expect(fragmentosDeRiff(bytesDe(ascii("RIFF"), u32le(4), ascii("WAVE")))).toEqual({
      ok: false,
      error: "FORMATO_NO_RECONOCIDO",
    });
    expect(fragmentosDeRiff(bytesDe(ascii("RIFX"), u32le(4), ascii("WEBP")))).toEqual({
      ok: false,
      error: "FORMATO_NO_RECONOCIDO",
    });
  });
});

describe("leerWebp con archivos reales", () => {
  it("lee las medidas de un WebP con pérdida (VP8) y uno sin pérdida (VP8L)", () => {
    expect(leerWebp(fixture("fotos", "foto-480.webp"))).toEqual({
      ok: true,
      valor: { formato: "webp", ancho: 480, alto: 360, conAlfa: false, animado: false },
    });
    expect(leerWebp(fixture("fotos", "foto-1200.webp"))).toMatchObject({
      ok: true,
      valor: { ancho: 1200, alto: 900 },
    });
    expect(leerWebp(fixture("activos", "logo.webp"))).toMatchObject({
      ok: true,
      valor: { ancho: 256, alto: 64, animado: false },
    });
    expect(leerWebp(fixture("activos", "logo-con-perdida.webp"))).toMatchObject({
      ok: true,
      valor: { ancho: 256, alto: 64, conAlfa: false },
    });
  });

  it("lee un VP8X con EXIF y XMP y uno animado", () => {
    expect(leerWebp(fixture("fotos", "foto-480-exif.webp"))).toEqual({
      ok: true,
      valor: { formato: "webp", ancho: 480, alto: 360, conAlfa: false, animado: false },
    });
    expect(leerWebp(fixture("fotos", "foto-480-animada.webp"))).toMatchObject({
      ok: true,
      valor: { ancho: 480, alto: 360, animado: true },
    });
  });

  it("rechaza la firma cambiada y el archivo cortado", () => {
    expect(leerWebp(fixture("fotos", "foto-480-firma-cambiada.webp"))).toEqual({
      ok: false,
      error: "FORMATO_NO_RECONOCIDO",
    });
    expect(leerWebp(fixture("fotos", "foto-480-truncada.webp"))).toEqual({
      ok: false,
      error: "TRUNCADO",
    });
  });

  it("lee igual desde una vista con desplazamiento", () => {
    const real = fixture("fotos", "foto-480-exif.webp");
    expect(leerWebp(enVista(real))).toEqual(leerWebp(real));
  });
});

describe("leerWebp con bytes armados", () => {
  const leer = (bytes: Uint8Array) => {
    const r = leerWebp(bytes);
    return r.ok ? r.valor : r.error;
  };

  it("VP8: medidas de 14 bits (los 2 bits altos son escala) en su lugar", () => {
    expect(leer(webpVp8(480, 360))).toEqual({
      formato: "webp",
      ancho: 480,
      alto: 360,
      conAlfa: false,
      animado: false,
    });
    expect(
      leer(construirRiff([fragmentoRiff("VP8 ", datosVp8(0xc000 | 100, 0x4000 | 200))])),
    ).toMatchObject({
      ancho: 100,
      alto: 200,
    });
    expect(leer(webpVp8(16383, 16383))).toMatchObject({ ancho: 16383, alto: 16383 });
    expect(leer(webpVp8(0x0102, 0x0304))).toMatchObject({ ancho: 0x0102, alto: 0x0304 });
  });

  it("VP8 incoherente: cuadro no clave, código de arranque, datos cortos, medida cero", () => {
    const con = (datos: number[]) => leer(construirRiff([fragmentoRiff("VP8 ", datos)]));
    const base = datosVp8(10, 10);
    expect(con([0x11, ...base.slice(1)])).toBe("CABECERA_INVALIDA"); // bit 0 = 1: cuadro intermedio
    expect(con([0x10, 0x03, 0xff, ...base.slice(3)])).toMatchObject({ ancho: 10 }); // el resto de la etiqueta no importa
    expect(con([...base.slice(0, 3), 0x9c, 0x01, 0x2a, ...base.slice(6)])).toBe(
      "CABECERA_INVALIDA",
    );
    expect(con([...base.slice(0, 3), 0x9d, 0x00, 0x2a, ...base.slice(6)])).toBe(
      "CABECERA_INVALIDA",
    );
    expect(con([...base.slice(0, 3), 0x9d, 0x01, 0x2b, ...base.slice(6)])).toBe(
      "CABECERA_INVALIDA",
    );
    expect(con(base.slice(0, 9))).toBe("CABECERA_INVALIDA");
    expect(con(base)).toMatchObject({ ancho: 10, alto: 10 });
    expect(con(datosVp8(0, 10))).toBe("CABECERA_INVALIDA");
    expect(con(datosVp8(10, 0))).toBe("CABECERA_INVALIDA");
    expect(con(datosVp8(0x4000, 10))).toBe("CABECERA_INVALIDA"); // solo escala: medida 0
    expect(con(datosVp8(10, 0xc000))).toBe("CABECERA_INVALIDA");
  });

  it("VP8L: medidas-1 en 14 bits, alfa en el bit 28 y versión 0", () => {
    const con = (datos: number[]) => leer(construirRiff([fragmentoRiff("VP8L", datos)]));
    expect(con(datosVp8l(256, 64))).toEqual({
      formato: "webp",
      ancho: 256,
      alto: 64,
      conAlfa: false,
      animado: false,
    });
    expect(con(datosVp8l(1, 1, true))).toMatchObject({ ancho: 1, alto: 1, conAlfa: true });
    expect(con(datosVp8l(16384, 16384))).toMatchObject({ ancho: 16384, alto: 16384 });
    expect(con(datosVp8l(0x0102, 0x0304))).toMatchObject({ ancho: 0x0102, alto: 0x0304 });
    expect(con(datosVp8l(10, 10, false, 1))).toBe("CABECERA_INVALIDA");
    expect(con(datosVp8l(10, 10, true, 7))).toBe("CABECERA_INVALIDA");
    expect(con([0x2e, ...datosVp8l(10, 10).slice(1)])).toBe("CABECERA_INVALIDA");
    expect(con(datosVp8l(10, 10).slice(0, 4))).toBe("CABECERA_INVALIDA");
    expect(con(datosVp8l(10, 10).slice(0, 5))).toMatchObject({ ancho: 10 });
  });

  it("VP8X estático: el lienzo (24 bits) tiene que coincidir con el fragmento de imagen", () => {
    const x = (banderas: number, ancho: number, alto: number, ...fr: number[][]) =>
      leer(construirRiff([fragmentoRiff("VP8X", datosVp8x(banderas, ancho, alto)), ...fr]));
    const vp8 = fragmentoRiff("VP8 ", datosVp8(480, 360));
    expect(x(0, 480, 360, vp8)).toEqual({
      formato: "webp",
      ancho: 480,
      alto: 360,
      conAlfa: false,
      animado: false,
    });
    expect(x(0, 481, 360, vp8)).toBe("CABECERA_INVALIDA");
    expect(x(0, 480, 361, vp8)).toBe("CABECERA_INVALIDA");
    expect(x(0, 480, 360)).toBe("CABECERA_INVALIDA"); // sin imagen
    expect(x(0, 480, 360, fragmentoRiff("EXIF", [1, 2]))).toBe("CABECERA_INVALIDA");
    expect(x(0, 480, 360, fragmentoRiff("VP8 ", datosVp8(0, 360)))).toBe("CABECERA_INVALIDA");
    // El primer fragmento de imagen manda, aunque haya otros antes.
    expect(
      x(0, 480, 360, fragmentoRiff("ICCP", [1]), fragmentoRiff("EXIF", [1, 2]), vp8),
    ).toMatchObject({
      ancho: 480,
    });
    expect(x(0, 16, 16, fragmentoRiff("VP8L", datosVp8l(16, 16)))).toMatchObject({ ancho: 16 });
  });

  it("VP8X: la bandera de alfa, un fragmento ALPH o el alfa de VP8L marcan conAlfa", () => {
    const x = (banderas: number, ...fr: number[][]) =>
      leer(construirRiff([fragmentoRiff("VP8X", datosVp8x(banderas, 16, 16)), ...fr]));
    const vp8 = fragmentoRiff("VP8 ", datosVp8(16, 16));
    expect(x(0, vp8)).toMatchObject({ conAlfa: false });
    expect(x(BANDERA_ALFA, vp8)).toMatchObject({ conAlfa: true });
    expect(x(0, fragmentoRiff("ALPH", [1, 2, 3]), vp8)).toMatchObject({ conAlfa: true });
    expect(x(0, fragmentoRiff("VP8L", datosVp8l(16, 16, true)))).toMatchObject({ conAlfa: true });
    expect(x(0, fragmentoRiff("VP8L", datosVp8l(16, 16, false)))).toMatchObject({ conAlfa: false });
    expect(x(BANDERA_EXIF | 0x04 | 0x20, vp8)).toMatchObject({ conAlfa: false, animado: false });
  });

  it("VP8X animado: no pide fragmento de imagen y devuelve las medidas del lienzo", () => {
    const x = (...fr: number[][]) =>
      leer(
        construirRiff([
          fragmentoRiff("VP8X", datosVp8x(BANDERA_ANIMACION, 0x123456, 0x654321)),
          ...fr,
        ]),
      );
    expect(x(fragmentoRiff("ANIM", [0, 0, 0, 0, 0, 0]))).toEqual({
      formato: "webp",
      ancho: 0x123456,
      alto: 0x654321,
      conAlfa: false,
      animado: true,
    });
    expect(
      leer(
        construirRiff([fragmentoRiff("VP8X", datosVp8x(BANDERA_ANIMACION | BANDERA_ALFA, 2, 2))]),
      ),
    ).toMatchObject({ conAlfa: true, animado: true });
  });

  it("VP8X con un tamaño distinto de 10 es inválido", () => {
    const datos = datosVp8x(0, 16, 16);
    const x = (d: number[]) =>
      leer(construirRiff([fragmentoRiff("VP8X", d), fragmentoRiff("VP8 ", datosVp8(16, 16))]));
    expect(x(datos)).toMatchObject({ ancho: 16 });
    expect(x([...datos, 0, 0])).toBe("CABECERA_INVALIDA");
    expect(x(datos.slice(0, 9))).toBe("CABECERA_INVALIDA");
  });

  it("el primer fragmento tiene que ser VP8X, VP8 o VP8L; sin fragmentos es inválido", () => {
    expect(leer(construirRiff([]))).toBe("CABECERA_INVALIDA");
    expect(
      leer(construirRiff([fragmentoRiff("EXIF", [1, 2]), fragmentoRiff("VP8 ", datosVp8(10, 10))])),
    ).toBe("CABECERA_INVALIDA");
    expect(leer(construirRiff([fragmentoRiff("ALPH", [1, 2])]))).toBe("CABECERA_INVALIDA");
    // Aunque sus datos parezcan los de un VP8L o un VP8, el tipo manda.
    expect(leer(construirRiff([fragmentoRiff("ZZZZ", datosVp8l(10, 10))]))).toBe(
      "CABECERA_INVALIDA",
    );
    expect(leer(construirRiff([fragmentoRiff("ZZZZ", datosVp8(10, 10))]))).toBe(
      "CABECERA_INVALIDA",
    );
  });

  it("los errores de contenedor pasan tal cual", () => {
    expect(leer(bytesDe(ascii("RIFF"), u32le(4), ascii("WAVE")))).toBe("FORMATO_NO_RECONOCIDO");
    expect(leer(construirRiff([fragmentoRiff("VP8 ", datosVp8(1, 1))], 1000))).toBe("TRUNCADO");
  });
});

describe("analizarWebp", () => {
  it("separa el primer fragmento de los siguientes", () => {
    const r = analizarWebp(fixture("fotos", "foto-480-exif.webp"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.primero.tipo).toBe("VP8X");
    expect(r.valor.siguientes.map((f) => f.tipo)).toEqual(["VP8 ", "EXIF", "XMP "]);
  });
});

describe("leerJpeg con archivos reales", () => {
  it("lee medidas de baseline, progresivo, y de uno con EXIF, XMP e IPTC", () => {
    const esperado = (ancho: number, alto: number) => ({
      ok: true,
      valor: { formato: "jpeg", ancho, alto, animado: false },
    });
    expect(leerJpeg(fixture("fotos", "foto-480.jpg"))).toEqual(esperado(480, 360));
    expect(leerJpeg(fixture("fotos", "foto-480-progresiva.jpg"))).toEqual(esperado(480, 360));
    expect(leerJpeg(fixture("fotos", "foto-480-exif.jpg"))).toEqual(esperado(480, 360));
    expect(leerJpeg(fixture("fotos", "foto-1200.jpg"))).toEqual(esperado(1200, 900));
    expect(leerJpeg(fixture("fotos", "foto-481.jpg"))).toEqual(esperado(481, 360));
    expect(leerJpeg(fixture("activos", "imagen-social.jpg"))).toEqual(esperado(1200, 630));
  });

  it("encuentra los segmentos de metadatos del archivo con EXIF", () => {
    const r = analizarJpeg(fixture("fotos", "foto-480-exif.jpg"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const marcadores = r.valor.segmentos.map((s) => s.marcador);
    expect(marcadores.slice(0, 4)).toEqual([0xe0, 0xe1, 0xe1, 0xed]);
    expect(marcadores.at(-1)).toBe(0xd9);
  });

  it("rechaza la firma cambiada, el archivo cortado y el APP1 que declara más de lo que hay", () => {
    expect(leerJpeg(fixture("fotos", "foto-480-firma-cambiada.jpg"))).toEqual({
      ok: false,
      error: "FORMATO_NO_RECONOCIDO",
    });
    expect(leerJpeg(fixture("fotos", "foto-480-truncada.jpg"))).toEqual({
      ok: false,
      error: "TRUNCADO",
    });
    expect(leerJpeg(fixture("fotos", "foto-480-app1-gigante.jpg"))).toEqual({
      ok: false,
      error: "TRUNCADO",
    });
  });

  it("lee igual desde una vista con desplazamiento", () => {
    const real = fixture("fotos", "foto-480-exif.jpg");
    expect(leerJpeg(enVista(real))).toEqual(leerJpeg(real));
  });
});

describe("leerJpeg con bytes armados", () => {
  const leer = (bytes: Uint8Array) => {
    const r = leerJpeg(bytes);
    return r.ok ? r.valor : r.error;
  };

  it("el alto va antes que el ancho, ambos de 16 bits grandes primero", () => {
    expect(leer(construirJpeg({ ancho: 0x0102, alto: 0x0304 }))).toEqual({
      formato: "jpeg",
      ancho: 0x0102,
      alto: 0x0304,
      animado: false,
    });
    expect(leer(construirJpeg({ ancho: 65535, alto: 1 }))).toMatchObject({ ancho: 65535, alto: 1 });
  });

  it("admite SOF0 y SOF2 de 8 bits con 1 a N componentes; ninguna otra variante", () => {
    const con = (cuadro: number[]) => leer(bytesDe(SOI, cuadro, escaneo(), EOI));
    expect(con(sof(5, 6, { marcador: 0xc0 }))).toMatchObject({ ancho: 5, alto: 6 });
    expect(con(sof(5, 6, { marcador: 0xc2 }))).toMatchObject({ ancho: 5, alto: 6 });
    expect(con(sof(5, 6, { componentes: 1 }))).toMatchObject({ ancho: 5 });
    expect(con(sof(5, 6, { componentes: 4 }))).toMatchObject({ ancho: 5 });
    for (const marcador of [0xc1, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]) {
      expect(con(sof(5, 6, { marcador }))).toBe("VARIANTE_NO_ADMITIDA");
    }
    expect(con(sof(5, 6, { precision: 12 }))).toBe("CABECERA_INVALIDA");
    expect(con(sof(5, 6, { precision: 0 }))).toBe("CABECERA_INVALIDA");
    expect(con(sof(0, 6))).toBe("CABECERA_INVALIDA");
    expect(con(sof(5, 0))).toBe("CABECERA_INVALIDA");
    expect(con(sof(5, 6, { componentes: 0 }))).toBe("CABECERA_INVALIDA");
  });

  it("el largo del SOF tiene que ser 8 + 3 por componente", () => {
    const con = (cuadro: number[]) => leer(bytesDe(SOI, cuadro, escaneo(), EOI));
    const bien = sof(5, 6);
    const largo = (n: number) => [bien[0], bien[1], ...u16be(n), ...bien.slice(4)] as number[];
    expect(con(largo(8 + 9))).toMatchObject({ ancho: 5 });
    expect(con(largo(8 + 9 + 1))).toBe("CABECERA_INVALIDA");
    expect(con(largo(8 + 9 - 1))).toBe("CABECERA_INVALIDA");
    // Segmento bien armado por dentro pero con más (o menos) bytes de componentes que los declarados.
    const conDatos = (componentes: number, bytesDeComponentes: number) =>
      con(
        segmentoJpeg(0xc0, [
          8,
          ...u16be(6),
          ...u16be(5),
          componentes,
          ...new Array<number>(bytesDeComponentes).fill(1),
        ]),
      );
    expect(conDatos(3, 9)).toMatchObject({ ancho: 5 });
    expect(conDatos(3, 12)).toBe("CABECERA_INVALIDA");
    expect(conDatos(4, 9)).toBe("CABECERA_INVALIDA");
    expect(conDatos(1, 3)).toMatchObject({ ancho: 5 });
    expect(conDatos(1, 6)).toBe("CABECERA_INVALIDA");
    // Un segmento SOF más corto que el mínimo no se lee fuera de su lugar.
    expect(con(segmentoJpeg(0xc0, [8, 0, 5, 0]))).toBe("CABECERA_INVALIDA");
    expect(con(segmentoJpeg(0xc0, [8, 0, 5, 0, 6]))).toBe("CABECERA_INVALIDA");
    expect(con(segmentoJpeg(0xc0, [8, 0, 5, 0, 6, 1]))).toBe("CABECERA_INVALIDA");
  });

  it("dos cuadros son medidas ambiguas", () => {
    expect(leer(bytesDe(SOI, sof(5, 6), sof(7, 8), escaneo(), EOI))).toBe("CABECERA_INVALIDA");
    expect(leer(bytesDe(SOI, sof(5, 6), sof(7, 8, { marcador: 0xc1 }), escaneo(), EOI))).toBe(
      "VARIANTE_NO_ADMITIDA",
    );
  });

  it("los marcadores DHT (C4), JPG (C8) y DAC (CC) son segmentos comunes, no cuadros", () => {
    for (const marcador of [0xc4, 0xc8, 0xcc]) {
      expect(
        leer(bytesDe(SOI, segmentoJpeg(marcador, [1, 2, 3]), sof(5, 6), escaneo(), EOI)),
      ).toMatchObject({
        ancho: 5,
      });
    }
  });

  it("el largo de un segmento: mínimo 2, big-endian, y tiene que entrar en los bytes", () => {
    const con = (antes: number[]) => leer(bytesDe(SOI, antes, sof(5, 6), escaneo(), EOI));
    expect(con([0xff, 0xe0, 0, 2])).toMatchObject({ ancho: 5 }); // vacío
    expect(con([0xff, 0xe0, 0, 1])).toBe("CABECERA_INVALIDA");
    expect(con([0xff, 0xe0, 0, 0])).toBe("CABECERA_INVALIDA");
    expect(con(segmentoJpeg(0xe0, new Array<number>(256).fill(7)))).toMatchObject({ ancho: 5 }); // 0x0102
    // Un largo que se pasa de los bytes que quedan.
    expect(leer(bytesDe(SOI, [0xff, 0xe0, 0xff, 0xff, 1, 2, 3]))).toBe("TRUNCADO");
    const justo = bytesDe(SOI, sof(5, 6), escaneo(), EOI);
    expect(leer(justo)).toMatchObject({ ancho: 5 });
  });

  it("el escaneo termina en el primer marcador de verdad: ignora FF00, RSTn y FF de relleno", () => {
    const con = (entropia: number[]) => leer(bytesDe(SOI, sof(5, 6), escaneo(entropia), EOI));
    expect(con([])).toMatchObject({ ancho: 5 });
    expect(con([0x01, 0xff, 0x00, 0xff, 0x00, 0x02])).toMatchObject({ ancho: 5 });
    for (let r = 0xd0; r <= 0xd7; r++) expect(con([0xff, r, 0x01])).toMatchObject({ ancho: 5 });
    expect(con([0x01, 0xff, 0xff, 0xff])).toMatchObject({ ancho: 5 });
    // Los datos acaban sin EOI o en un FF suelto.
    expect(leer(bytesDe(SOI, sof(5, 6), escaneo([1, 2, 3])))).toBe("TRUNCADO");
    expect(leer(bytesDe(SOI, sof(5, 6), escaneo([1, 2, 0xff])))).toBe("TRUNCADO");
    expect(leer(bytesDe(SOI, sof(5, 6), escaneo([1, 2, 0xff, 0x00])))).toBe("TRUNCADO");
    expect(leer(bytesDe(SOI, sof(5, 6), escaneo([1, 2, 0xff, 0xd3])))).toBe("TRUNCADO");
    expect(leer(bytesDe(SOI, sof(5, 6), escaneo([1, 2, 0xff, 0xff])))).toBe("TRUNCADO");
  });

  it("varios escaneos (progresivo) y segmentos entre ellos se recorren todos", () => {
    const bytes = bytesDe(
      SOI,
      sof(5, 6, { marcador: 0xc2 }),
      escaneo(),
      segmentoJpeg(0xe1, [1, 2, 3]),
      segmentoJpeg(0xc4, [1]),
      escaneo([9, 9]),
      EOI,
    );
    const r = analizarJpeg(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.segmentos.map((s) => s.marcador)).toEqual([0xc2, 0xda, 0xe1, 0xc4, 0xda, 0xd9]);
    // Contiguos y sin salirse: cada segmento empieza donde terminó el anterior.
    expect(r.valor.segmentos.at(-1)?.fin).toBe(bytes.length);
  });

  it("los FF de relleno antes de un marcador se admiten y no son parte del segmento", () => {
    const bytes = bytesDe(
      SOI,
      [0xff, 0xff, 0xff],
      segmentoJpeg(0xe0, [1]),
      sof(5, 6),
      escaneo(),
      [0xff],
      EOI,
    );
    const r = analizarJpeg(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.segmentos[0]).toEqual({ marcador: 0xe0, inicio: 5, fin: 5 + 2 + 3 });
  });

  it("marcadores fuera de lugar, antes del cuadro o sin escaneo son inválidos", () => {
    const con = (...partes: number[][]) => leer(bytesDe(SOI, ...partes));
    expect(con(sof(5, 6), EOI)).toBe("CABECERA_INVALIDA"); // sin escaneo
    expect(con(EOI)).toBe("CABECERA_INVALIDA");
    expect(con(escaneo(), sof(5, 6), EOI)).toBe("CABECERA_INVALIDA"); // SOS antes del cuadro
    for (const marcador of [0x00, 0x01, 0xd0, 0xd3, 0xd7, 0xd8]) {
      expect(con([0xff, marcador], sof(5, 6), escaneo(), EOI)).toBe("CABECERA_INVALIDA");
    }
    expect(con(segmentoJpeg(0xe0, [1]), [0x12, 0x34])).toBe("CABECERA_INVALIDA"); // no empieza con FF
    // El marcador 02 sí tiene largo (reservado, se salta como cualquiera).
    expect(con(segmentoJpeg(0x02, [1]), sof(5, 6), escaneo(), EOI)).toMatchObject({ ancho: 5 });
    expect(con(segmentoJpeg(0xdc, [1]), sof(5, 6), escaneo(), EOI)).toMatchObject({ ancho: 5 });
  });

  it("cortes en cada punto: nunca lee de más, siempre dice TRUNCADO o nada", () => {
    const completo = construirJpeg({ antes: segmentoJpeg(0xe1, [1, 2, 3, 4]) });
    expect(leer(completo)).toMatchObject({ ancho: 480 });
    for (let n = 0; n < completo.length; n++) {
      expect(["TRUNCADO", "FORMATO_NO_RECONOCIDO"]).toContain(leer(completo.subarray(0, n)));
    }
  });

  it("lo que sigue al EOI no cuenta", () => {
    expect(leer(construirJpeg({ cola: [1, 2, 3, 0xff, 0xe1, 0xff, 0xff] }))).toMatchObject({
      ancho: 480,
    });
    const r = analizarJpeg(construirJpeg({ cola: [1, 2, 3] }));
    expect(r.ok && r.valor.segmentos.at(-1)?.marcador).toBe(0xd9);
  });

  it("el error de contenido gana al de corte cuando el segmento termina justo en el final", () => {
    // Largo 1 con el encabezado del segmento terminando al ras del archivo.
    expect(leer(bytesDe(SOI, [0xff, 0xe0, 0x00, 0x01]))).toBe("CABECERA_INVALIDA");
    // Un cuadro mal formado o no admitido, al ras del final.
    expect(leer(bytesDe(SOI, sof(0, 6)))).toBe("CABECERA_INVALIDA");
    expect(leer(bytesDe(SOI, sof(5, 6, { marcador: 0xc1 })))).toBe("VARIANTE_NO_ADMITIDA");
    expect(leer(bytesDe(SOI, sof(5, 6)))).toBe("TRUNCADO");
  });

  it("un SOS con largo 0 o 1 es inválido, con o sin cuadro antes", () => {
    for (const largo of [0, 1]) {
      expect(leer(bytesDe(SOI, sof(5, 6), [0xff, 0xda, 0x00, largo, 0x12, 0x34], EOI))).toBe(
        "CABECERA_INVALIDA",
      );
    }
    expect(leer(bytesDe(SOI, sof(5, 6), [0xff, 0xda, 0x00, 0x02, 0x12, 0x34], EOI))).toMatchObject({
      ancho: 5,
    });
  });

  it("un escaneo antes del cuadro es inválido aunque después vengan un cuadro y otro escaneo", () => {
    expect(leer(bytesDe(SOI, escaneo(), sof(5, 6), escaneo(), EOI))).toBe("CABECERA_INVALIDA");
  });

  it("un marcador al final sin su largo es TRUNCADO", () => {
    expect(leer(bytesDe(SOI, [0xff, 0xe0]))).toBe("TRUNCADO");
    expect(leer(bytesDe(SOI, [0xff, 0xe0, 0x00]))).toBe("TRUNCADO");
    expect(leer(bytesDe(SOI, [0xff]))).toBe("TRUNCADO");
    expect(leer(bytesDe(SOI, [0xff, 0xff]))).toBe("TRUNCADO");
    expect(leer(bytesDe(SOI))).toBe("FORMATO_NO_RECONOCIDO");
    expect(leer(bytesDe(SOI, [0xff, 0xe0, 0x00, 0x02]))).toBe("TRUNCADO");
  });
});

describe("leerIco", () => {
  const leer = (bytes: Uint8Array) => {
    const r = leerIco(bytes);
    return r.ok ? r.valor.imagenes : r.error;
  };

  it("lee el directorio de archivos reales", () => {
    expect(leer(fixture("activos", "favicon-32.ico"))).toEqual([{ ancho: 32, alto: 32 }]);
    expect(leer(fixture("activos", "favicon-16-32.ico"))).toEqual([
      { ancho: 16, alto: 16 },
      { ancho: 32, alto: 32 },
    ]);
    expect(leer(fixture("activos", "favicon-48.ico"))).toEqual([{ ancho: 48, alto: 48 }]);
  });

  it("0 en una medida es 256; ancho y alto salen de bytes distintos", () => {
    expect(leer(construirIco([{ ancho: 256, alto: 7, tamano: 4, desde: 22 }], 4))).toEqual([
      { ancho: 256, alto: 7 },
    ]);
    expect(leer(construirIco([{ ancho: 9, alto: 256, tamano: 4, desde: 22 }], 4))).toEqual([
      { ancho: 9, alto: 256 },
    ]);
  });

  it("los datos de cada imagen tienen que estar enteros y después del directorio", () => {
    const e = (tamano: number, desde: number) => [{ ancho: 16, alto: 16, tamano, desde }];
    expect(leer(construirIco(e(10, 22), 10))).toEqual([{ ancho: 16, alto: 16 }]); // justo
    expect(leer(construirIco(e(11, 22), 10))).toBe("TRUNCADO");
    expect(leer(construirIco(e(10, 23), 10))).toBe("TRUNCADO");
    expect(leer(construirIco(e(10, 21), 10))).toBe("CABECERA_INVALIDA"); // dentro del directorio
    expect(leer(construirIco(e(0, 22), 10))).toBe("CABECERA_INVALIDA");
    expect(leer(construirIco(e(0xffffffff, 22), 10))).toBe("TRUNCADO");
    expect(leer(construirIco(e(10, 0xffffffff), 10))).toBe("TRUNCADO");
  });

  it("devuelve el formato y las imágenes", () => {
    expect(leerIco(fixture("activos", "favicon-32.ico"))).toEqual({
      ok: true,
      valor: { formato: "ico", imagenes: [{ ancho: 32, alto: 32 }] },
    });
  });

  it("un directorio que ocupa todo el archivo no tiene datos: se dice según la entrada", () => {
    const solo = (tamano: number, desde: number) =>
      construirIco([{ ancho: 16, alto: 16, tamano, desde }], 0);
    expect(leer(solo(0, 22))).toBe("CABECERA_INVALIDA");
    expect(leer(solo(10, 0))).toBe("CABECERA_INVALIDA");
    expect(leer(solo(10, 22))).toBe("TRUNCADO");
  });

  it("el directorio entero tiene que estar: cantidad cero o mayor a lo que hay", () => {
    expect(leer(bytesDe([0, 0, 1, 0], u16le(0)))).toBe("CABECERA_INVALIDA");
    expect(leer(bytesDe([0, 0, 1, 0], u16le(1), new Array<number>(15).fill(0)))).toBe("TRUNCADO");
    expect(leer(bytesDe([0, 0, 1, 0], u16le(65535)))).toBe("TRUNCADO");
    expect(leer(bytesDe([0, 0, 1, 0]))).toBe("TRUNCADO");
    expect(leer(bytesDe([0, 0, 1, 0, 1]))).toBe("TRUNCADO");
  });

  it("un cursor o un archivo cualquiera no se reconoce", () => {
    expect(leer(bytesDe([0, 0, 2, 0], u16le(1)))).toBe("FORMATO_NO_RECONOCIDO");
    expect(leer(fixture("activos", "icono-192.png"))).toBe("FORMATO_NO_RECONOCIDO");
  });

  it("lee igual desde una vista con desplazamiento", () => {
    const real = fixture("activos", "favicon-16-32.ico");
    expect(leerIco(enVista(real))).toEqual(leerIco(real));
  });
});

describe("leerCabecera", () => {
  it("despacha por la firma", () => {
    expect(leerCabecera(fixture("activos", "icono-192.png"))).toEqual({
      ok: true,
      valor: png(192, 192),
    });
    expect(leerCabecera(fixture("fotos", "foto-480.webp"))).toMatchObject({
      ok: true,
      valor: { formato: "webp", ancho: 480 },
    });
    expect(leerCabecera(fixture("fotos", "foto-480.jpg"))).toMatchObject({
      ok: true,
      valor: { formato: "jpeg", alto: 360 },
    });
  });

  it("el ICO, el SVG y lo desconocido no tienen lector de medidas planas", () => {
    for (const bytes of [
      fixture("activos", "favicon-32.ico"),
      fixture("activos", "logo.svg"),
      fixture("fotos", "foto-480.heic"),
      new Uint8Array(),
    ]) {
      expect(leerCabecera(bytes)).toEqual({ ok: false, error: "FORMATO_NO_RECONOCIDO" });
    }
  });

  it("pasa el error del lector", () => {
    expect(leerCabecera(fixture("activos", "icono-192-truncado.png"))).toEqual({
      ok: false,
      error: "TRUNCADO",
    });
  });
});

describe("esOpaca", () => {
  it("PNG: tipos 0 y 2 sin tRNS; WebP: sin alfa; JPEG siempre", () => {
    expect(esOpaca(png(1, 1, 2))).toBe(true);
    expect(esOpaca(png(1, 1, 6))).toBe(false);
    expect(esOpaca({ formato: "webp", ancho: 1, alto: 1, conAlfa: false, animado: false })).toBe(
      true,
    );
    expect(esOpaca({ formato: "webp", ancho: 1, alto: 1, conAlfa: true, animado: false })).toBe(
      false,
    );
    expect(esOpaca({ formato: "jpeg", ancho: 1, alto: 1, animado: false })).toBe(true);
  });
});
