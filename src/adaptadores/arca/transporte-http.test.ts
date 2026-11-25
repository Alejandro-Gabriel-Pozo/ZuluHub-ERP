import { createServer as crearServidorTcp, type Socket } from "node:net";
import { createServer as crearServidorHttps } from "node:https";
import { createServer as crearServidorTls } from "node:tls";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { credencialDePrueba } from "../../../test/utilidades/arca-credencial";
import {
  puertoCerrado,
  servidorFalso,
  type ServidorFalso,
} from "../../../test/utilidades/arca-servidor";
import {
  codigoDeError,
  crearTransporteHttp,
  DOMINIOS_DE_ARCA_CON_TLS_COMPATIBLE,
  esDominioConTlsCompatible,
} from "./transporte-http";

/**
 * El transporte real contra un servidor de loopback (127.0.0.1): nada sale de la máquina. Lo que se prueba es
 * lo que decide si un pedido «seguro no salió» o «no se sabe»: el tiempo límite que cubre también el cuerpo,
 * el corte a la mitad, la respuesta enorme y la conexión que no se abre.
 */
const abiertos: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(abiertos.splice(0).map((cerrar) => cerrar()));
});
const abrir = async (...argumentos: Parameters<typeof servidorFalso>): Promise<ServidorFalso> => {
  const servidor = await servidorFalso(...argumentos);
  abiertos.push(servidor.cerrar);
  return servidor;
};

const pedidoA = (
  url: string,
  cambios: Partial<{ accionSoap: string; cuerpo: string; limiteEnMs: number }> = {},
) => ({
  url,
  accionSoap: "http://ar.gov.afip.dif.FEV1/FEDummy",
  cuerpo: "<a>hola</a>",
  limiteEnMs: 2_000,
  ...cambios,
});

describe("una respuesta completa", () => {
  it("devuelve el estado y el cuerpo, y manda un POST SOAP con sus cabeceras", async () => {
    const servidor = await abrir((_p, r) => {
      r.writeHead(200, { "Content-Type": "text/xml" });
      r.end("<ok>1</ok>");
    });
    const respuesta = await crearTransporteHttp()(pedidoA(servidor.url));
    expect(respuesta).toEqual({ tipo: "RESPUESTA", estadoHttp: 200, cuerpo: "<ok>1</ok>" });
    expect(servidor.pedidos).toHaveLength(1);
    const [recibido] = servidor.pedidos;
    expect(recibido?.metodo).toBe("POST");
    expect(recibido?.cuerpo).toBe("<a>hola</a>");
    expect(recibido?.cabeceras["content-type"]).toBe("text/xml; charset=utf-8");
    expect(recibido?.cabeceras["soapaction"]).toBe('"http://ar.gov.afip.dif.FEV1/FEDummy"');
    expect(recibido?.cabeceras["content-length"]).toBe("11");
    expect(recibido?.cabeceras["connection"]).toBe("close");
  });

  it("WSAA lleva la cabecera SOAPAction vacía, entre comillas", async () => {
    const servidor = await abrir((_p, r) => r.end("<ok/>"));
    await crearTransporteHttp()(pedidoA(servidor.url, { accionSoap: "" }));
    expect(servidor.pedidos[0]?.cabeceras["soapaction"]).toBe('""');
  });

  it("el cuerpo viaja en UTF-8 y el largo es en bytes, no en letras", async () => {
    const servidor = await abrir((p, r) => r.end(`<eco>${p.cuerpo}</eco>`));
    const respuesta = await crearTransporteHttp()(
      pedidoA(servidor.url, { cuerpo: "<a>Débito ñ €</a>" }),
    );
    expect(respuesta).toEqual({
      tipo: "RESPUESTA",
      estadoHttp: 200,
      cuerpo: "<eco><a>Débito ñ €</a></eco>",
    });
    expect(servidor.pedidos[0]?.cabeceras["content-length"]).toBe(
      String(Buffer.byteLength("<a>Débito ñ €</a>")),
    );
  });

  it("un estado que no es 200 también es una respuesta completa (la clasificación decide)", async () => {
    const servidor = await abrir((_p, r) => {
      r.writeHead(500);
      r.end("<fault/>");
    });
    expect(await crearTransporteHttp()(pedidoA(servidor.url))).toEqual({
      tipo: "RESPUESTA",
      estadoHttp: 500,
      cuerpo: "<fault/>",
    });
  });

  it("una respuesta sin cuerpo es el texto vacío", async () => {
    const servidor = await abrir((_p, r) => {
      r.writeHead(204);
      r.end();
    });
    expect(await crearTransporteHttp()(pedidoA(servidor.url))).toEqual({
      tipo: "RESPUESTA",
      estadoHttp: 204,
      cuerpo: "",
    });
  });

  it("una respuesta grande en varias partes llega entera", async () => {
    const grande = "x".repeat(300_000);
    const servidor = await abrir((_p, r) => r.end(grande));
    const respuesta = await crearTransporteHttp()(pedidoA(servidor.url));
    expect(respuesta).toEqual({ tipo: "RESPUESTA", estadoHttp: 200, cuerpo: grande });
  });

  it("una respuesta en trozos (chunked) llega entera", async () => {
    const servidor = await abrir((_p, r) => {
      r.write("<a>");
      setTimeout(() => {
        r.write("1");
        r.end("</a>");
      }, 20);
    });
    expect(await crearTransporteHttp()(pedidoA(servidor.url))).toMatchObject({
      cuerpo: "<a>1</a>",
    });
  });
});

describe("el tiempo límite cubre TODO, también la lectura del cuerpo", () => {
  it("un servidor que no responde: sin respuesta completa dentro del tiempo límite", async () => {
    const servidor = await abrir(() => undefined);
    const inicio = Date.now();
    const respuesta = await crearTransporteHttp()(pedidoA(servidor.url, { limiteEnMs: 200 }));
    expect(respuesta).toEqual({ tipo: "SIN_RESPUESTA", motivo: "TIEMPO_AGOTADO" });
    expect(Date.now() - inicio).toBeLessThan(1_500);
  });

  it("un servidor que manda las cabeceras y se cuelga: también vence (los SDK de terceros esperaban para siempre)", async () => {
    const servidor = await abrir((_p, r) => {
      r.writeHead(200, { "Content-Type": "text/xml" });
      r.write("<a>");
      // Ni termina ni cierra.
    });
    const inicio = Date.now();
    const respuesta = await crearTransporteHttp()(pedidoA(servidor.url, { limiteEnMs: 250 }));
    expect(respuesta).toEqual({ tipo: "SIN_RESPUESTA", motivo: "TIEMPO_AGOTADO" });
    expect(Date.now() - inicio).toBeLessThan(1_500);
  });

  it("un servidor que gotea el cuerpo despacio: vence aunque cada parte llegue a tiempo", async () => {
    let gotero: NodeJS.Timeout | undefined;
    const servidor = await abrir((_p, r) => {
      r.writeHead(200);
      gotero = setInterval(() => r.write("x"), 30);
      r.on("close", () => clearInterval(gotero));
    });
    const respuesta = await crearTransporteHttp()(pedidoA(servidor.url, { limiteEnMs: 300 }));
    clearInterval(gotero);
    expect(respuesta).toEqual({ tipo: "SIN_RESPUESTA", motivo: "TIEMPO_AGOTADO" });
  });

  it("después de resolver ya no queda ningún temporizador esperando el límite", async () => {
    const servidor = await abrir((_p, r) => r.end("<ok/>"));
    const inicio = Date.now();
    await crearTransporteHttp()(pedidoA(servidor.url, { limiteEnMs: 60_000 }));
    expect(Date.now() - inicio).toBeLessThan(1_500);
  });
});

describe("un corte a la mitad no se confunde con una respuesta", () => {
  it("el servidor corta la conexión después de mandar parte del cuerpo", async () => {
    const servidor = await abrir((_p, r) => {
      r.writeHead(200, { "Content-Length": "1000" });
      r.write("<a>parte");
      setTimeout(() => r.destroy(), 30);
    });
    const respuesta = await crearTransporteHttp()(pedidoA(servidor.url));
    expect(respuesta.tipo).toBe("SIN_RESPUESTA");
  });

  it("el servidor corta una respuesta en trozos sin el trozo final", async () => {
    const servidor = await abrir((_p, r) => {
      r.writeHead(200);
      r.write("<a>parte");
      setTimeout(() => r.destroy(), 30);
    });
    expect((await crearTransporteHttp()(pedidoA(servidor.url))).tipo).toBe("SIN_RESPUESTA");
  });

  it("el servidor cierra la conexión sin contestar", async () => {
    const servidor = await abrir((_p, _r, peticion) => peticion.socket.destroy());
    expect((await crearTransporteHttp()(pedidoA(servidor.url))).tipo).toBe("SIN_RESPUESTA");
  });

  it("una respuesta más grande que el tope se descarta como sin respuesta completa", async () => {
    const servidor = await abrir((_p, r) => r.end("x".repeat(5_000)));
    const respuesta = await crearTransporteHttp({ maximoDeBytes: 1_000 })(pedidoA(servidor.url));
    expect(respuesta).toEqual({ tipo: "SIN_RESPUESTA", motivo: "RESPUESTA_DEMASIADO_GRANDE" });
  });

  it("una respuesta justo del tamaño del tope sí se acepta", async () => {
    const servidor = await abrir((_p, r) => r.end("x".repeat(1_000)));
    const respuesta = await crearTransporteHttp({ maximoDeBytes: 1_000 })(pedidoA(servidor.url));
    expect(respuesta).toMatchObject({ tipo: "RESPUESTA", estadoHttp: 200 });
  });
});

describe("lo que seguro no salió: la conexión no se abrió", () => {
  it("conexión rechazada: NO_SALIO", async () => {
    const puerto = await puertoCerrado();
    expect(await crearTransporteHttp()(pedidoA(`http://127.0.0.1:${puerto}/`))).toEqual({
      tipo: "NO_SALIO",
      motivo: "ECONNREFUSED",
    });
  });

  it("un TLS que no completa (el servidor acepta la conexión TCP y calla): NO_SALIO por el tiempo de conexión", async () => {
    const sockets = new Set<Socket>();
    const mudo = crearServidorTcp((s) => {
      sockets.add(s);
    });
    await new Promise<void>((r) => mudo.listen(0, "127.0.0.1", r));
    abiertos.push(
      () =>
        new Promise<void>((r) => {
          for (const s of sockets) s.destroy();
          mudo.close(() => r());
        }),
    );
    const { port } = mudo.address() as AddressInfo;
    const inicio = Date.now();
    const respuesta = await crearTransporteHttp({ conexionEnMs: 200 })(
      pedidoA(`https://127.0.0.1:${port}/`, { limiteEnMs: 5_000 }),
    );
    expect(respuesta).toEqual({ tipo: "NO_SALIO", motivo: "TIEMPO_DE_CONEXION" });
    expect(Date.now() - inicio).toBeLessThan(2_000);
  });

  it("un certificado que no es de confianza: NO_SALIO, sin aflojar la verificación", async () => {
    const { credencial } = await credencialDePrueba();
    const servidor = crearServidorHttps(
      { key: credencial.clavePrivada.revelar(), cert: credencial.certificadoPem },
      (_p, r) => r.end("<ok/>"),
    );
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    abiertos.push(() => new Promise<void>((r) => servidor.close(() => r())));
    const { port } = servidor.address() as AddressInfo;
    const respuesta = await crearTransporteHttp()(pedidoA(`https://127.0.0.1:${port}/`));
    expect(respuesta.tipo).toBe("NO_SALIO");
    expect(respuesta.tipo === "NO_SALIO" && /^[A-Z0-9_]+$/.test(respuesta.motivo)).toBe(true);
  });

  it("después de conectar, un tiempo agotado ya es sin respuesta: el pedido pudo llegar", async () => {
    const servidor = await abrir(() => undefined);
    const respuesta = await crearTransporteHttp({ conexionEnMs: 100 })(
      pedidoA(servidor.url, { limiteEnMs: 300 }),
    );
    expect(respuesta.tipo).toBe("SIN_RESPUESTA");
  });
});

describe("codigoDeError: nunca el texto de la excepción", () => {
  it("un código de red de Node se conserva", () => {
    expect(codigoDeError({ code: "ECONNRESET" })).toBe("ECONNRESET");
    expect(codigoDeError({ code: "ERR_TLS_CERT_ALTNAME_INVALID" })).toBe(
      "ERR_TLS_CERT_ALTNAME_INVALID",
    );
    expect(codigoDeError({ code: "AB" })).toBe("AB");
  });

  it("todo lo demás es una falla de red genérica", () => {
    expect(codigoDeError(new Error("postgres://u:clave@host"))).toBe("FALLA_DE_RED");
    expect(codigoDeError({ code: "con espacios y <token>" })).toBe("FALLA_DE_RED");
    expect(codigoDeError({ code: "minuscula" })).toBe("FALLA_DE_RED");
    expect(codigoDeError({ code: "A" })).toBe("FALLA_DE_RED");
    expect(codigoDeError({ code: "A".repeat(61) })).toBe("FALLA_DE_RED");
    expect(codigoDeError({ code: 42 })).toBe("FALLA_DE_RED");
    expect(codigoDeError(null)).toBe("FALLA_DE_RED");
    expect(codigoDeError(undefined)).toBe("FALLA_DE_RED");
    expect(codigoDeError("texto")).toBe("FALLA_DE_RED");
  });

  it("60 caracteres es el máximo", () => {
    expect(codigoDeError({ code: "A".repeat(60) })).toBe("A".repeat(60));
  });
});

describe("codigoDeError: el motivo de OpenSSL de un EPROTO", () => {
  const eproto = (extra: Record<string, unknown>) => ({ code: "EPROTO", ...extra });

  it("con library y reason, el motivo queda normalizado", () => {
    expect(
      codigoDeError(
        eproto({ library: "SSL routines", reason: "unsafe legacy renegotiation disabled" }),
      ),
    ).toBe("EPROTO_UNSAFE_LEGACY_RENEGOTIATION_DISABLED");
    expect(codigoDeError(eproto({ reason: "dh key too small" }))).toBe("EPROTO_DH_KEY_TOO_SMALL");
    expect(codigoDeError(eproto({ reason: "wrong.version_number" }))).toBe(
      "EPROTO_WRONG_VERSION_NUMBER",
    );
  });

  it("sin reason ni texto de OpenSSL queda EPROTO a secas", () => {
    expect(codigoDeError(eproto({}))).toBe("EPROTO");
    expect(codigoDeError(eproto({ library: "SSL routines" }))).toBe("EPROTO");
    expect(codigoDeError(eproto({ reason: 42 }))).toBe("EPROTO");
    expect(codigoDeError(eproto({ reason: "" }))).toBe("EPROTO");
    expect(codigoDeError(eproto({ reason: "..." }))).toBe("EPROTO");
  });

  it("un reason con caracteres raros, demasiado largo o que intenta meter un token o una URL: EPROTO", () => {
    expect(codigoDeError(eproto({ reason: "motivo\nnuevo línea" }))).toBe("EPROTO");
    expect(codigoDeError(eproto({ reason: "<script>alert(1)</script>" }))).toBe("EPROTO");
    expect(codigoDeError(eproto({ reason: "https://usuario:clave@host/ruta?token=abc" }))).toBe(
      "EPROTO",
    );
    expect(codigoDeError(eproto({ reason: "token=abc;sign=def" }))).toBe("EPROTO");
    expect(codigoDeError(eproto({ reason: "postgres://u:clave@host" }))).toBe("EPROTO");
    expect(codigoDeError(eproto({ reason: "a".repeat(101) }))).toBe("EPROTO");
  });

  it("el código completo nunca pasa de 60 caracteres y cumple la forma de código", () => {
    const codigo = codigoDeError(eproto({ reason: "palabra ".repeat(12).trim() }));
    expect(codigo.length).toBeLessThanOrEqual(60);
    expect(codigo).toMatch(/^[A-Z0-9_]{2,60}$/);
    expect(codigo.startsWith("EPROTO_PALABRA_PALABRA")).toBe(true);
    expect(codigo.endsWith("_")).toBe(false);
  });

  it("el reason solo se usa en un EPROTO: otro código se conserva tal cual", () => {
    expect(codigoDeError({ code: "ECONNRESET", reason: "dh key too small" })).toBe("ECONNRESET");
  });

  it("sin la propiedad reason, el motivo se saca del texto de OpenSSL y el texto no sale", () => {
    const mensaje =
      "write EPROTO 80F7F0A7C47F0000:error:0A000152:SSL routines::unsafe legacy renegotiation disabled:../deps/openssl/openssl/ssl/statem/extensions.c:922:\n";
    const codigo = codigoDeError(eproto({ message: mensaje }));
    expect(codigo).toBe("EPROTO_UNSAFE_LEGACY_RENEGOTIATION_DISABLED");
    expect(codigo).not.toContain("80F7F0A7C47F0000");
    expect(codigo).not.toContain("DEPS");
    expect(
      codigoDeError(
        eproto({
          message:
            "write EPROTO x:error:0A00042E:SSL routines:ssl3_read_bytes:tlsv1 alert protocol version:../d/x.c:1:",
        }),
      ),
    ).toBe("EPROTO_TLSV1_ALERT_PROTOCOL_VERSION");
  });

  it("un texto que no tiene la forma de OpenSSL, o con un motivo fuera de la lista: EPROTO", () => {
    expect(codigoDeError(eproto({ message: "write EPROTO postgres://u:clave@host" }))).toBe(
      "EPROTO",
    );
    expect(
      codigoDeError(
        eproto({ message: "error:0A000152:SSL routines::https://a.b/c?token=zzz:../deps/x.c:1:" }),
      ),
    ).toBe("EPROTO");
  });
});

describe("un handshake TLS real rechazado: el motivo sale normalizado y el texto no", () => {
  it("un servidor que solo habla TLS 1.1 contra el cliente por defecto: NO_SALIO con el motivo de OpenSSL", async () => {
    const { credencial } = await credencialDePrueba();
    const servidor = crearServidorTls(
      {
        key: credencial.clavePrivada.revelar(),
        cert: credencial.certificadoPem,
        minVersion: "TLSv1",
        maxVersion: "TLSv1.1",
        ciphers: "DEFAULT:@SECLEVEL=0",
      },
      (conexion) => conexion.end(),
    );
    servidor.on("tlsClientError", () => undefined);
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    abiertos.push(() => new Promise<void>((r) => servidor.close(() => r())));
    const { port } = servidor.address() as AddressInfo;

    const respuesta = await crearTransporteHttp()(pedidoA(`https://127.0.0.1:${port}/`));

    expect(respuesta.tipo).toBe("NO_SALIO");
    if (respuesta.tipo !== "NO_SALIO") return;
    expect(respuesta.motivo).toBe("EPROTO_TLSV1_ALERT_PROTOCOL_VERSION");
    expect(respuesta.motivo).toMatch(/^[A-Z0-9_]{2,60}$/);
    // Ni el texto de la excepción ni su ruta interna ni su identificador de error.
    expect(respuesta.motivo).not.toMatch(/WRITE|DEPS|OPENSSL|0A0/);
  });
});

describe("codigoDeError: el texto de OpenSSL solo cuenta con su forma completa", () => {
  it("un motivo sin el archivo y la línea que siguen en un texto real de OpenSSL: EPROTO", () => {
    expect(
      codigoDeError({ code: "EPROTO", message: "error:0A000152:SSL routines::https:otra cosa" }),
    ).toBe("EPROTO");
    expect(
      codigoDeError({ code: "EPROTO", message: "error:0A000152:SSL routines::dh key too small:" }),
    ).toBe("EPROTO");
  });
});

describe("modo compatible: qué dominios son elegibles", () => {
  const elegible = (host: string) =>
    esDominioConTlsCompatible(`https://${host}/wsfev1/service.asmx`);

  it("la lista de dominios es exactamente la declarada", () => {
    expect(DOMINIOS_DE_ARCA_CON_TLS_COMPATIBLE).toEqual(["afip.gov.ar", "arca.gob.ar"]);
  });

  it("el dominio y sus subdominios sí", () => {
    for (const host of [
      "servicios1.afip.gov.ar",
      "wsaa.afip.gov.ar",
      "aws.afip.gov.ar",
      "servicios1.arca.gob.ar",
      "afip.gov.ar",
      "arca.gob.ar",
      "SERVICIOS1.AFIP.GOV.AR",
      "servicios1.afip.gov.ar:443",
      "usuario:clave@servicios1.afip.gov.ar",
    ]) {
      expect(elegible(host), host).toBe(true);
    }
  });

  it("todo lo demás no (violaciones inyectadas)", () => {
    for (const host of [
      "afip.gov.ar.evil.com",
      "evilafip.gov.ar",
      "xafip.gov.ar",
      "afip.gov.ar@evil.com",
      "afip.gov.ar.",
      "servicios1.afip.gov.ar.",
      "localhost",
      "127.0.0.1",
      "example.com",
      "gov.ar",
      "ar",
      "afip.gov.ar.arca.gob.ar.evil.com",
      "wsaahomo.afip.gov.ar.evil.com",
    ]) {
      expect(elegible(host), host).toBe(false);
    }
  });

  it("no es elegible una URL sin https ni una ilegible: falla cerrado", () => {
    expect(esDominioConTlsCompatible("http://servicios1.afip.gov.ar/")).toBe(false);
    expect(esDominioConTlsCompatible("no es una url")).toBe(false);
    expect(esDominioConTlsCompatible("")).toBe(false);
  });
});

/**
 * Parámetros DH de 1024 bits (públicos, generados con `openssl dhparam 1024` solo para esta prueba): el servidor de
 * ARCA ofrece un DH de ese tamaño. Node 24 (OpenSSL 3.5) lo rechaza por defecto con «dh key too small»; Node 22 lo acepta.
 */
const DH_DE_1024_BITS = [
  "-----BEGIN DH PARAMETERS-----",
  "MIGHAoGBAMre8jV7gu/mONv3G/bnmCMfm3K0KtLK02BEIKpvmOYXti4kqB0/2k38",
  "sVb4XyEIQYeYhXBOqA8fzE5nAaiMKVMY9qw2M+1OB9s+v3uOXY+48jRlXtdLje7I",
  "sZhjVmJRiiuv0Lr+Mwcm9UN/CVTMvSW/t3R3rZToSyvXvbgxrCFvAgEC",
  "-----END DH PARAMETERS-----",
].join("\n");

describe("modo compatible contra un servidor TLS local con DH de 1024 bits", () => {
  /** Servidor que solo ofrece DHE (para que el DH cuente) y cuenta las conexiones TCP que recibe. */
  const abrirServidorDeDh1024 = async () => {
    const { credencial } = await credencialDePrueba();
    const servidor = crearServidorTls(
      {
        key: credencial.clavePrivada.revelar(),
        cert: credencial.certificadoPem,
        maxVersion: "TLSv1.2",
        ciphers: "DHE-RSA-AES128-SHA256:@SECLEVEL=0",
        dhparam: DH_DE_1024_BITS,
      },
      (conexion) => conexion.end(),
    );
    servidor.on("tlsClientError", () => undefined);
    const conexiones = { total: 0 };
    servidor.on("connection", () => {
      conexiones.total += 1;
    });
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    abiertos.push(() => new Promise<void>((r) => servidor.close(() => r())));
    const { port } = servidor.address() as AddressInfo;
    return { url: `https://127.0.0.1:${port}/`, conexiones };
  };

  it("un host que no es de ARCA: un solo intento y sin log, aunque falle por el DH", async () => {
    const { url, conexiones } = await abrirServidorDeDh1024();
    const avisos: string[] = [];
    const respuesta = await crearTransporteHttp({ registrar: (a) => avisos.push(a) })(pedidoA(url));
    expect(respuesta.tipo).toBe("NO_SALIO");
    expect(conexiones.total).toBe(1);
    expect(avisos).toEqual([]);
  });

  it("un host de ARCA con el motivo de la lista: UN reintento (nunca un tercero), con su línea de log", async () => {
    const { url, conexiones } = await abrirServidorDeDh1024();
    // El estricto: ¿este Node rechaza el DH de 1024 por defecto? (Node 24 sí; Node 22 no).
    const estricto = await crearTransporteHttp({ dominiosConTlsCompatible: [] })(pedidoA(url));
    const rechazaElDh =
      estricto.tipo === "NO_SALIO" && estricto.motivo === "EPROTO_DH_KEY_TOO_SMALL";
    conexiones.total = 0;

    const avisos: string[] = [];
    const respuesta = await crearTransporteHttp({
      dominiosConTlsCompatible: ["127.0.0.1"],
      registrar: (a) => avisos.push(a),
    })(pedidoA(url));

    if (!rechazaElDh) {
      // Node que acepta el DH de 1024 por defecto: no hay fallo del que reintentar, ni reintento, ni log.
      expect(conexiones.total).toBe(1);
      expect(avisos).toEqual([]);
      return;
    }
    // Se intentó estricto y UNA vez más, no más.
    expect(conexiones.total).toBe(2);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatch(
      /^\[arca\] TLS en modo compatible \(SECLEVEL=1\) con 127\.0\.0\.1 por EPROTO_DH_KEY_TOO_SMALL: /,
    );
    // Con la opción el handshake PASÓ el DH: lo que lo frena ahora es el certificado autofirmado del servidor de
    // prueba (que NO se aflojó), y el log lo dice. Como tampoco salió, se devuelve el error ORIGINAL.
    expect(avisos[0]).toContain("tampoco salió (");
    expect(avisos[0]).not.toMatch(/tampoco salió \(EPROTO_DH_KEY_TOO_SMALL\)/);
    expect(respuesta).toEqual({ tipo: "NO_SALIO", motivo: "EPROTO_DH_KEY_TOO_SMALL" });
  });

  it("un motivo que no está en la lista no reintenta, aunque el host sea de ARCA", async () => {
    const { credencial } = await credencialDePrueba();
    const servidor = crearServidorHttps(
      { key: credencial.clavePrivada.revelar(), cert: credencial.certificadoPem },
      (_p, r) => r.end("<ok/>"),
    );
    const conexiones = { total: 0 };
    servidor.on("connection", () => {
      conexiones.total += 1;
    });
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    abiertos.push(() => new Promise<void>((r) => servidor.close(() => r())));
    const { port } = servidor.address() as AddressInfo;
    const avisos: string[] = [];
    const respuesta = await crearTransporteHttp({
      dominiosConTlsCompatible: ["127.0.0.1"],
      registrar: (a) => avisos.push(a),
    })(pedidoA(`https://127.0.0.1:${port}/`));
    // Certificado que no es de confianza: otro motivo, un solo intento, sin log.
    expect(respuesta.tipo).toBe("NO_SALIO");
    expect(respuesta.tipo === "NO_SALIO" && respuesta.motivo.startsWith("EPROTO_DH")).toBe(false);
    expect(conexiones.total).toBe(1);
    expect(avisos).toEqual([]);
  });

  it("un registro que lanza no cambia lo que se devuelve", async () => {
    const { url } = await abrirServidorDeDh1024();
    const respuesta = await crearTransporteHttp({
      dominiosConTlsCompatible: ["127.0.0.1"],
      registrar: () => {
        throw new Error("registro caído");
      },
    })(pedidoA(url));
    expect(respuesta.tipo).toBe("NO_SALIO");
  });
});
