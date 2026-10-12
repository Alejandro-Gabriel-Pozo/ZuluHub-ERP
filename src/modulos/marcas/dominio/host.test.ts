import { describe, expect, it } from "vitest";
import { normalizarHost } from "./host";

const INVALIDO = { ok: false, error: "HOST_INVALIDO" } as const;
const valido = (host: string) => ({ ok: true, valor: host });

describe("normalizarHost: lo que acepta", () => {
  it.each([
    ["micalendario.com", "micalendario.com"],
    ["app.micalendario.com", "app.micalendario.com"],
    ["localhost", "localhost"],
    ["a", "a"],
    ["a.b.c.d.e.f", "a.b.c.d.e.f"],
    ["mi-calendario.com", "mi-calendario.com"],
    ["a-b-c.d-e.com", "a-b-c.d-e.com"],
    ["1abc.com", "1abc.com"],
    ["123abc.com", "123abc.com"],
    ["1.a", "1.a"],
    ["xn--cala-9qa.com", "xn--cala-9qa.com"],
    ["xn--mi-calendario-x1b.xn--p1ai", "xn--mi-calendario-x1b.xn--p1ai"],
    ["a.1a", "a.1a"],
    ["a.0xg", "a.0xg"],
    ["a.com.ar", "a.com.ar"],
  ])("%s", (entrada, esperado) => {
    expect(normalizarHost(entrada)).toEqual(valido(esperado));
  });

  it("pasa a minúsculas", () => {
    expect(normalizarHost("MiCalendario.COM")).toEqual(valido("micalendario.com"));
    expect(normalizarHost("XN--CALA-9QA.COM")).toEqual(valido("xn--cala-9qa.com"));
    expect(normalizarHost("ABCXYZ.Z9")).toEqual(valido("abcxyz.z9"));
  });

  it("quita el puerto", () => {
    expect(normalizarHost("micalendario.com:3000")).toEqual(valido("micalendario.com"));
    expect(normalizarHost("micalendario.com:443")).toEqual(valido("micalendario.com"));
    expect(normalizarHost("micalendario.com:8")).toEqual(valido("micalendario.com"));
    expect(normalizarHost("localhost:0")).toEqual(valido("localhost"));
    expect(normalizarHost("localhost:00080")).toEqual(valido("localhost"));
  });

  it("el puerto llega hasta 65535, ni uno más", () => {
    expect(normalizarHost("a.com:65535")).toEqual(valido("a.com"));
    expect(normalizarHost("a.com:65536")).toEqual(INVALIDO);
    expect(normalizarHost("a.com:99999")).toEqual(INVALIDO);
    expect(normalizarHost("a.com:100000")).toEqual(INVALIDO);
  });

  it("quita UN punto final, con o sin puerto", () => {
    expect(normalizarHost("micalendario.com.")).toEqual(valido("micalendario.com"));
    expect(normalizarHost("micalendario.com.:443")).toEqual(valido("micalendario.com"));
    expect(normalizarHost("MICALENDARIO.COM.:443")).toEqual(valido("micalendario.com"));
  });

  it("no quita www.: es otro nombre (un alias, si se quiere)", () => {
    expect(normalizarHost("www.micalendario.com")).toEqual(valido("www.micalendario.com"));
  });

  it("una etiqueta de 63 caracteres pasa; de 64, no", () => {
    expect(normalizarHost(`${"a".repeat(63)}.com`)).toEqual(valido(`${"a".repeat(63)}.com`));
    expect(normalizarHost(`${"a".repeat(64)}.com`)).toEqual(INVALIDO);
    expect(normalizarHost(`a.${"b".repeat(64)}`)).toEqual(INVALIDO);
    expect(normalizarHost("a".repeat(64))).toEqual(INVALIDO);
  });

  it("el host entero llega hasta 253 caracteres, ni uno más", () => {
    const de253 = [63, 63, 63, 61].map((n) => "a".repeat(n)).join(".");
    expect(de253).toHaveLength(253);
    expect(normalizarHost(de253)).toEqual(valido(de253));
    expect(normalizarHost(`${de253}.`)).toEqual(valido(de253));
    const de254 = [63, 63, 63, 62].map((n) => "a".repeat(n)).join(".");
    expect(de254).toHaveLength(254);
    expect(normalizarHost(de254)).toEqual(INVALIDO);
  });
});

describe("normalizarHost: lo que rechaza", () => {
  it.each([
    ["vacío", ""],
    ["solo un punto", "."],
    ["dos puntos", ".."],
    ["etiqueta vacía en el medio", "a..b"],
    ["etiqueta vacía al principio", ".a.com"],
    ["dos puntos finales", "a.com.."],
    ["solo puerto", ":80"],
    ["guion al principio", "-a.com"],
    ["guion al final", "a-.com"],
    ["guion al principio de otra etiqueta", "a.-b.com"],
    ["solo un guion", "-"],
    ["espacio en el medio", "a b.com"],
    ["espacio al principio", " a.com"],
    ["espacio al final", "a.com "],
    ["salto de línea al final", "a.com\n"],
    ["tabulación", "a.com\t"],
    ["nulo", "a\u0000.com"],
    ["guion bajo", "a_b.com"],
    ["eñe", "ñandu.com"],
    ["tilde", "café.com"],
    ["diéresis", "münchen.de"],
    ["ideogramas", "日本.jp"],
    ["signo Kelvin, que al bajar de caja es una k", "Kalendar.com"],
    ["i con punto, que al bajar de caja se descompone", "İstanbul.com"],
    ["letra de ancho completo", "ａ.com"],
    ["ese larga", "ſecret.com"],
    ["punto ideográfico", "a。com"],
    ["ancho cero", "a​.com"],
    ["emoji", "😀.com"],
    ["puerto vacío", "a.com:"],
    ["puerto con letras", "a.com:abc"],
    ["puerto con letras y dígitos", "a.com:80a"],
    ["puerto negativo", "a.com:-1"],
    ["dos puertos", "a.com:80:80"],
    ["dos puntos seguidos", "a.com::80"],
    ["punto después del puerto", "a.com:80."],
    ["barra", "a.com/"],
    ["ruta", "a.com/ruta"],
    ["protocolo", "http://a.com"],
    ["usuario", "usuario@a.com"],
    ["consulta", "a.com?x=1"],
    ["fragmento", "a.com#x"],
    ["comodín", "*.a.com"],
    ["comodín solo", "*"],
    ["coma (dos hosts)", "a.com,b.com"],
    ["punto y coma", "a.com;b.com"],
    ["barra invertida", "a.com\\b"],
    ["paréntesis", "a(b).com"],
  ])("%s", (_nombre, entrada) => {
    expect(normalizarHost(entrada)).toEqual(INVALIDO);
  });

  it.each([
    ["IPv6 de bucle", "::1"],
    ["IPv6 entre corchetes", "[::1]"],
    ["IPv6 entre corchetes y puerto", "[::1]:3000"],
    ["IPv6 completa", "2001:db8:85a3::8a2e:370:7334"],
    ["IPv6 con IPv4 incrustada", "[::ffff:192.168.0.1]"],
    ["IPv4", "127.0.0.1"],
    ["IPv4 con puerto", "127.0.0.1:3000"],
    ["IPv4 con punto final", "192.168.0.1."],
    ["IPv4 de ceros", "0.0.0.0"],
    ["IPv4 de unos", "255.255.255.255"],
    ["IPv4 corta de tres partes", "1.2.3"],
    ["IPv4 corta de dos partes", "127.1"],
    ["IPv4 en un solo número decimal", "2130706433"],
    ["un número cualquiera", "12345"],
    ["cero", "0"],
    ["IPv4 en hexadecimal", "0x7f.0.0.1"],
    ["IPv4 con la última parte hexadecimal", "127.0.0.0x1"],
    ["IPv4 en un solo número hexadecimal", "0x7f000001"],
    ["hexadecimal en mayúsculas", "0X7F.1"],
    ["hexadecimal sin dígitos", "a.0x"],
    ["hexadecimal con letras", "a.0xdeadbeef"],
    ["nombre con la última etiqueta numérica", "a.com.1"],
    ["nombre cuyo final es 'un número'", "mi-sitio.123"],
  ])("rechaza el literal IP o numérico: %s", (_nombre, entrada) => {
    expect(normalizarHost(entrada)).toEqual(INVALIDO);
  });

  it("solo la ÚLTIMA etiqueta decide si parece un número", () => {
    expect(normalizarHost("1.2.3.com")).toEqual(valido("1.2.3.com"));
    expect(normalizarHost("0x7f.com")).toEqual(valido("0x7f.com"));
    expect(normalizarHost("1.a")).toEqual(valido("1.a"));
    expect(normalizarHost("a.1a")).toEqual(valido("a.1a"));
    expect(normalizarHost("a.0xfg")).toEqual(valido("a.0xfg"));
    expect(normalizarHost("a.x0x1")).toEqual(valido("a.x0x1"));
  });

  it("no confunde un dominio parecido con otro: el sufijo y el prefijo cuentan", () => {
    expect(normalizarHost("micalendario.com.otro.net")).toEqual(
      valido("micalendario.com.otro.net"),
    );
    expect(normalizarHost("x.micalendario.com")).toEqual(valido("x.micalendario.com"));
    expect(normalizarHost("micalendario.com.otro.net")).not.toEqual(valido("micalendario.com"));
  });

  it("la salida ya normalizada se normaliza a sí misma", () => {
    const una = normalizarHost("MiCalendario.COM.:443");
    expect(una).toEqual(valido("micalendario.com"));
    expect(una.ok && normalizarHost(una.valor)).toEqual(una);
  });
});
