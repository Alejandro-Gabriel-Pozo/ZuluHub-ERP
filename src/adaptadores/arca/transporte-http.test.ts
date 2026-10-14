import { createServer as crearServidorTcp, type Socket } from "node:net";
import { createServer as crearServidorHttps } from "node:https";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { credencialDePrueba } from "../../../test/utilidades/arca-credencial";
import {
  puertoCerrado,
  servidorFalso,
  type ServidorFalso,
} from "../../../test/utilidades/arca-servidor";
import { codigoDeError, crearTransporteHttp } from "./transporte-http";

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
