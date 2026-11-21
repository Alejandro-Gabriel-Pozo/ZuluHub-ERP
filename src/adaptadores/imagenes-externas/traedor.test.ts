import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as pedirPorHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as crearServidorHttps, request as pedirPorHttps } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { servidorFalso, type ServidorFalso } from "../../../test/utilidades/arca-servidor";
import {
  BANDERA_ANIMACION,
  BANDERA_EXIF,
  BANDERA_XMP,
  ascii,
  construirPng,
  construirRiff,
  datosVp8,
  datosVp8x,
  fixture,
  fragmentoRiff,
  webpVp8,
} from "../../../test/utilidades/imagenes";
import {
  armarDestinoDeLogo,
  type DestinoValidado,
} from "../../capacidades/activos/direccion-externa";
import { direccionDeRedPermitida } from "../../capacidades/activos/red";
import {
  crearTraedor,
  crearTraedorDeProduccion,
  DEPENDENCIAS_DE_PRODUCCION,
  LIMITES_DEL_TRAEDOR,
  type DependenciasDelTraedor,
} from "./traedor";

/**
 * El traedor contra servidores de bucle local (127.0.0.1): nada sale de la máquina. La guarda de red real queda ACTIVA en las pruebas de «direcciones no
 * permitidas» (se prueba con la de producción); en las demás se la deja pasar porque el servidor de prueba ES un bucle local.
 */
const destino: DestinoValidado = (() => {
  const armado = armarDestinoDeLogo(
    {
      proveedor: "CLOUDINARY",
      cuenta: "demo",
      idPublico: "logo",
      version: "1700000000",
      extension: "png",
    },
    ["demo"],
  );
  if (!armado.ok) throw new Error("destino de prueba inválido");
  return armado.valor;
})();

const abiertos: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(abiertos.splice(0).map((cerrar) => cerrar()));
});
const servidor = async (
  manejador: (p: unknown, r: ServerResponse, q: IncomingMessage) => void,
): Promise<ServidorFalso & Readonly<{ puerto: number }>> => {
  const s = await servidorFalso(manejador);
  abiertos.push(s.cerrar);
  return { ...s, puerto: Number(new URL(s.url).port) };
};

const LIMITES_DE_PRUEBA = { pesoMaximo: 100_000, conexionMs: 150, totalMs: 500, simultaneas: 8 };
const enBucleLocal = (
  puerto: number,
  cambios: Partial<DependenciasDelTraedor> = {},
): DependenciasDelTraedor => ({
  resolver: () => Promise.resolve(["127.0.0.1"]),
  direccionPermitida: () => true,
  solicitar: pedirPorHttp,
  puerto,
  limites: { ...LIMITES_DE_PRUEBA },
  ...cambios,
});

const WEBP = webpVp8(100, 80);
const enviar = (r: ServerResponse, cuerpo: Uint8Array, tipo = "image/webp"): void => {
  r.writeHead(200, { "Content-Type": tipo, "Content-Length": String(cuerpo.length) });
  r.end(Buffer.from(cuerpo));
};

describe("una imagen buena", () => {
  it("se devuelve igual, con el destino exacto y solo las cabeceras fijas", async () => {
    const s = await servidor((_p, r) => enviar(r, WEBP));
    const r = await crearTraedor(enBucleLocal(s.puerto)).traerLogo(destino);
    expect(r).toEqual({ ok: true, valor: WEBP });
    expect(s.pedidos).toHaveLength(1);
    const [pedido] = s.pedidos;
    expect(pedido?.metodo).toBe("GET");
    expect(pedido?.ruta).toBe(
      "/demo/image/upload/c_limit,w_240,h_240,f_webp,q_80/v1700000000/logo.png",
    );
    expect(pedido?.cabeceras).toEqual({
      host: "res.cloudinary.com",
      accept: "image/webp",
      "accept-encoding": "identity",
      "user-agent": "pedernal-carta/1",
      connection: "close",
    });
  });

  it("un WebP real (con pérdida, 120 por 120) pasa tal cual", async () => {
    const real = fixture("activos", "logo-carta-120.webp");
    const s = await servidor((_p, r) => enviar(r, real));
    expect(await crearTraedor(enBucleLocal(s.puerto)).traerLogo(destino)).toEqual({
      ok: true,
      valor: real,
    });
  });

  it("acepta 240 por 240 y el tipo en mayúsculas", async () => {
    const s = await servidor((_p, r) => enviar(r, webpVp8(240, 240), "IMAGE/WEBP"));
    const r = await crearTraedor(enBucleLocal(s.puerto)).traerLogo(destino);
    expect(r.ok).toBe(true);
  });

  it("le quita EXIF y XMP", async () => {
    const conMetadatos = construirRiff([
      fragmentoRiff("VP8X", datosVp8x(BANDERA_EXIF | BANDERA_XMP, 10, 10)),
      fragmentoRiff("VP8 ", datosVp8(10, 10, [1, 2, 3, 4, 5, 6])),
      fragmentoRiff("EXIF", ascii("secreto-gps")),
      fragmentoRiff("XMP ", ascii("<x:xmpmeta/>")),
    ]);
    const s = await servidor((_p, r) => enviar(r, conMetadatos));
    const r = await crearTraedor(enBucleLocal(s.puerto)).traerLogo(destino);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const texto = Buffer.from(r.valor).toString("latin1");
    expect(texto).not.toContain("EXIF");
    expect(texto).not.toContain("secreto-gps");
    expect(texto).not.toContain("XMP ");
    expect(texto).toContain("VP8 ");
  });
});

describe("no hay redirecciones ni otros estados", () => {
  it.each([301, 302, 307, 308])(
    "un %i no se sigue: el otro servidor no recibe nada",
    async (estado) => {
      const otro = await servidor((_p, r) => enviar(r, WEBP));
      const s = await servidor((_p, r) => {
        r.writeHead(estado, { Location: otro.url });
        r.end();
      });
      const r = await crearTraedor(enBucleLocal(s.puerto)).traerLogo(destino);
      expect(r).toEqual({ ok: false, error: "ESTADO_INESPERADO" });
      expect(otro.pedidos).toHaveLength(0);
    },
  );

  it.each([204, 206, 404, 500])("un %i corta", async (estado) => {
    const s = await servidor((_p, r) => {
      r.writeHead(estado, { "Content-Type": "image/webp" });
      r.end(Buffer.from(WEBP));
    });
    const r = await crearTraedor(enBucleLocal(s.puerto)).traerLogo(destino);
    expect(r).toEqual({ ok: false, error: "ESTADO_INESPERADO" });
  });
});

describe("el tipo declarado", () => {
  it.each([
    ["image/png", Buffer.from(WEBP)],
    ["image/svg+xml", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")],
    ["text/html", Buffer.from("<html></html>")],
    ["image/webp; charset=utf-8", Buffer.from(WEBP)],
    ["", Buffer.from(WEBP)],
  ])("«%s» no pasa", async (tipo, cuerpo) => {
    const s = await servidor((_p, r) => {
      r.writeHead(200, tipo === "" ? {} : { "Content-Type": tipo });
      r.end(cuerpo);
    });
    const r = await crearTraedor(enBucleLocal(s.puerto)).traerLogo(destino);
    expect(r).toEqual({ ok: false, error: "TIPO_NO_PERMITIDO" });
  });
});

describe("el tamaño se mide por lo que llega", () => {
  it("un Content-Length enorme se corta antes de leer nada", async () => {
    const s = await servidor((_p, r) => {
      r.writeHead(200, { "Content-Type": "image/webp", "Content-Length": "2000000" });
      r.write(Buffer.alloc(10));
    });
    const r = await crearTraedor(enBucleLocal(s.puerto)).traerLogo(destino);
    expect(r).toEqual({ ok: false, error: "DEMASIADO_GRANDE" });
  });

  it("justo en el tope pasa a la validación y un byte más se corta", async () => {
    const s = await servidor((_p, r) => enviar(r, Buffer.alloc(100_000, 1)));
    const igual = await crearTraedor(enBucleLocal(s.puerto)).traerLogo(destino);
    expect(igual).toEqual({ ok: false, error: "NO_ES_UNA_IMAGEN" });
    const s2 = await servidor((_p, r) => enviar(r, Buffer.alloc(100_001, 1)));
    const mas = await crearTraedor(enBucleLocal(s2.puerto)).traerLogo(destino);
    expect(mas).toEqual({ ok: false, error: "DEMASIADO_GRANDE" });
  });

  it("sin Content-Length (por trozos) se corta cuando pasa el tope", async () => {
    const s = await servidor((_p, r) => {
      r.writeHead(200, { "Content-Type": "image/webp" });
      for (let i = 0; i < 40; i += 1) r.write(Buffer.alloc(10_000, 1));
      r.end();
    });
    const r = await crearTraedor(enBucleLocal(s.puerto)).traerLogo(destino);
    expect(r).toEqual({ ok: false, error: "DEMASIADO_GRANDE" });
  });

  it("un Content-Length que miente (dice 10 KB y manda 1 MB) no entrega nada", async () => {
    const s = await servidor((_p, r) => {
      r.writeHead(200, { "Content-Type": "image/webp", "Content-Length": "10240" });
      r.end(Buffer.alloc(1_000_000, 1));
    });
    const r = await crearTraedor(enBucleLocal(s.puerto)).traerLogo(destino);
    expect(r.ok).toBe(false);
  });

  it("un Content-Length mayor que lo que llega (corte a la mitad) no entrega nada", async () => {
    const s = await servidor((_p, r) => {
      r.writeHead(200, {
        "Content-Type": "image/webp",
        "Content-Length": String(WEBP.length + 50),
      });
      r.write(Buffer.from(WEBP));
      setTimeout(() => r.destroy(), 20);
    });
    const r = await crearTraedor(enBucleLocal(s.puerto)).traerLogo(destino);
    expect(r).toEqual({ ok: false, error: "SIN_CONEXION" });
  });
});

describe("el tiempo", () => {
  it("una respuesta que se cuelga después de los encabezados se corta en el tiempo total", async () => {
    const s = await servidor((_p, r) => {
      r.writeHead(200, { "Content-Type": "image/webp", "Content-Length": "5000" });
      r.flushHeaders();
    });
    const t0 = Date.now();
    const r = await crearTraedor(enBucleLocal(s.puerto)).traerLogo(destino);
    expect(r).toEqual({ ok: false, error: "TIEMPO_AGOTADO" });
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it("un cuerpo que gotea despacio también se corta", async () => {
    const s = await servidor((_p, r) => {
      r.writeHead(200, { "Content-Type": "image/webp", "Content-Length": String(WEBP.length) });
      let i = 0;
      const gota = setInterval(() => {
        if (r.destroyed || i >= WEBP.length) return clearInterval(gota);
        r.write(Buffer.from(WEBP.subarray(i, i + 1)));
        i += 1;
      }, 100);
      r.on("close", () => clearInterval(gota));
    });
    const r = await crearTraedor(enBucleLocal(s.puerto)).traerLogo(destino);
    expect(r).toEqual({ ok: false, error: "TIEMPO_AGOTADO" });
  });

  it("un servidor que no contesta nunca se corta en el tiempo total", async () => {
    const s = await servidor(() => undefined);
    const r = await crearTraedor(enBucleLocal(s.puerto)).traerLogo(destino);
    expect(r).toEqual({ ok: false, error: "TIEMPO_AGOTADO" });
  });

  it("un puerto cerrado es «sin conexión»", async () => {
    const s = await servidor(() => undefined);
    await s.cerrar();
    const r = await crearTraedor(enBucleLocal(s.puerto)).traerLogo(destino);
    expect(r).toEqual({ ok: false, error: "SIN_CONEXION" });
  });

  /** Una solicitud de mentira cuyo socket no termina de conectar: lo único que muestra el tiempo de CONEXIÓN. */
  const conSocketDe =
    (socket: EventEmitter): DependenciasDelTraedor["solicitar"] =>
    (opciones) => {
      const solicitud = Object.assign(new EventEmitter(), {
        destroy: vi.fn(),
        end: () => {
          solicitud.emit("socket", socket);
        },
      });
      // Como la de verdad: al vencer el tiempo total, la solicitud falla.
      opciones.signal?.addEventListener("abort", () =>
        solicitud.emit("error", new Error("abortada")),
      );
      return solicitud as unknown as ReturnType<DependenciasDelTraedor["solicitar"]>;
    };

  it("una conexión que no se abre se corta en el tiempo de conexión, bastante antes que el total", async () => {
    const t0 = Date.now();
    const r = await crearTraedor(
      enBucleLocal(1, {
        solicitar: conSocketDe(new EventEmitter()),
        limites: { ...LIMITES_DE_PRUEBA, conexionMs: 80, totalMs: 5_000 },
      }),
    ).traerLogo(destino);
    expect(r).toEqual({ ok: false, error: "TIEMPO_AGOTADO" });
    expect(Date.now() - t0).toBeLessThan(1_500);
  });

  it("un socket TLS que abre el TCP pero no termina el apretón se corta; el TCP solo no alcanza", async () => {
    const socket = Object.assign(new EventEmitter(), { encrypted: true });
    setTimeout(() => socket.emit("connect"), 10);
    const r = await crearTraedor(
      enBucleLocal(1, {
        solicitar: conSocketDe(socket),
        limites: { ...LIMITES_DE_PRUEBA, conexionMs: 80, totalMs: 5_000 },
      }),
    ).traerLogo(destino);
    expect(r).toEqual({ ok: false, error: "TIEMPO_AGOTADO" });
  });

  it("un socket que sí conecta apaga el tiempo de conexión (cuenta solo el total)", async () => {
    const socket = new EventEmitter();
    setTimeout(() => socket.emit("connect"), 10);
    const r = await crearTraedor(
      enBucleLocal(1, {
        solicitar: conSocketDe(socket),
        limites: { ...LIMITES_DE_PRUEBA, conexionMs: 80, totalMs: 300 },
      }),
    ).traerLogo(destino);
    expect(r).toEqual({ ok: false, error: "TIEMPO_AGOTADO" });
  });
});

describe("lo que no es una imagen buena", () => {
  const sirve = async (cuerpo: Uint8Array, tipo = "image/webp") => {
    const s = await servidor((_p, r) => enviar(r, cuerpo, tipo));
    return crearTraedor(enBucleLocal(s.puerto)).traerLogo(destino);
  };

  it("un PNG con tipo de WebP", async () => {
    expect(await sirve(construirPng())).toEqual({ ok: false, error: "NO_ES_UNA_IMAGEN" });
  });

  it("un SVG con tipo de WebP", async () => {
    const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>");
    expect(await sirve(svg)).toEqual({ ok: false, error: "NO_ES_UNA_IMAGEN" });
  });

  it("una firma falsa (RIFF sin WEBP)", async () => {
    const falso = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.alloc(4),
      Buffer.from("WAVE"),
      Buffer.alloc(30),
    ]);
    expect(await sirve(falso)).toEqual({ ok: false, error: "NO_ES_UNA_IMAGEN" });
  });

  it("un JPEG con tipo de WebP", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xd9]);
    expect(await sirve(jpeg)).toEqual({ ok: false, error: "NO_ES_UNA_IMAGEN" });
  });

  it("un cuerpo vacío", async () => {
    expect(await sirve(new Uint8Array(0))).toEqual({ ok: false, error: "NO_ES_UNA_IMAGEN" });
  });

  it.each([
    [241, 100],
    [100, 241],
    [4000, 4000],
  ])("medidas %i por %i, fuera del lado máximo", async (ancho, alto) => {
    expect(await sirve(webpVp8(ancho, alto))).toEqual({ ok: false, error: "IMAGEN_NO_PERMITIDA" });
  });

  it("un WebP animado", async () => {
    const animado = construirRiff([
      fragmentoRiff("VP8X", datosVp8x(BANDERA_ANIMACION, 10, 10)),
      fragmentoRiff("ANIM", [0, 0, 0, 0, 0, 0]),
      fragmentoRiff("ANMF", new Array<number>(16).fill(0)),
    ]);
    expect(await sirve(animado)).toEqual({ ok: false, error: "IMAGEN_NO_PERMITIDA" });
  });
});

describe("el destino del nombre (S3 a S6)", () => {
  const publica = "8.8.8.8";
  const peligrosas = [
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd00:ec2::254",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:10.0.0.1",
    "64:ff9b::7f00:1",
  ];

  /** Un `solicitar` que registra a qué se quiso conectar y no conecta a ninguna parte. */
  const espia = () => {
    const llamadas: Record<string, unknown>[] = [];
    const solicitar = ((opciones: Record<string, unknown>) => {
      llamadas.push(opciones);
      const solicitud = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn() });
      return solicitud;
    }) as unknown as DependenciasDelTraedor["solicitar"];
    return { llamadas, solicitar };
  };

  it.each(peligrosas)("%s no se pide jamás (con la guarda de producción)", async (ip) => {
    const { llamadas, solicitar } = espia();
    const r = await crearTraedor({
      ...DEPENDENCIAS_DE_PRODUCCION,
      resolver: () => Promise.resolve([ip]),
      solicitar,
    }).traerLogo(destino);
    expect(r).toEqual({ ok: false, error: "DIRECCION_NO_PERMITIDA" });
    expect(llamadas).toHaveLength(0);
  });

  it("una sola dirección privada entre varias públicas basta para rechazar el nombre", async () => {
    const { llamadas, solicitar } = espia();
    for (const lista of [
      [publica, "10.0.0.1"],
      ["10.0.0.1", publica],
    ]) {
      const r = await crearTraedor({
        ...DEPENDENCIAS_DE_PRODUCCION,
        resolver: () => Promise.resolve(lista),
        solicitar,
      }).traerLogo(destino);
      expect(r).toEqual({ ok: false, error: "DIRECCION_NO_PERMITIDA" });
    }
    expect(llamadas).toHaveLength(0);
  });

  it("sin direcciones, o con el DNS caído, no hay a dónde ir", async () => {
    const { llamadas, solicitar } = espia();
    for (const resolver of [
      () => Promise.resolve([] as string[]),
      () => Promise.reject(new Error("ENOTFOUND")),
    ]) {
      const r = await crearTraedor({
        ...DEPENDENCIAS_DE_PRODUCCION,
        resolver,
        solicitar,
      }).traerLogo(destino);
      expect(r).toEqual({ ok: false, error: "SIN_DIRECCION" });
    }
    expect(llamadas).toHaveLength(0);
  });

  it("un DNS que no contesta se corta en el tiempo total", async () => {
    const { solicitar } = espia();
    const r = await crearTraedor({
      ...DEPENDENCIAS_DE_PRODUCCION,
      resolver: () => new Promise(() => undefined),
      solicitar,
      limites: { ...LIMITES_DE_PRUEBA, totalMs: 100 },
    }).traerLogo(destino);
    expect(r).toEqual({ ok: false, error: "TIEMPO_AGOTADO" });
  });

  it("reenlace de DNS: se resuelve UNA vez y se conecta a esa dirección, con el nombre solo para SNI y Host", async () => {
    const { llamadas, solicitar } = espia();
    const respuestas = [[publica], ["127.0.0.1"], ["127.0.0.1"]];
    const resolver = vi.fn(() => Promise.resolve(respuestas.shift() ?? ["127.0.0.1"]));
    void crearTraedor({
      ...DEPENDENCIAS_DE_PRODUCCION,
      resolver,
      solicitar,
      limites: { ...LIMITES_DE_PRUEBA, totalMs: 60 },
    }).traerLogo(destino);
    await vi.waitFor(() => expect(llamadas).toHaveLength(1));
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith("res.cloudinary.com");
    expect(llamadas[0]).toMatchObject({
      host: publica,
      port: 443,
      servername: "res.cloudinary.com",
      path: destino.ruta,
      method: "GET",
      agent: false,
    });
    expect((llamadas[0]?.headers as Record<string, string>).Host).toBe("res.cloudinary.com");
  });
});

describe("TLS de verdad (certificado autofirmado de prueba)", () => {
  const certificadoPara = (nombre: string) => {
    const carpeta = mkdtempSync(join(tmpdir(), "traedor-tls-"));
    try {
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-days",
          "1",
          "-subj",
          `/CN=${nombre}`,
          "-addext",
          `subjectAltName=DNS:${nombre}`,
          "-keyout",
          join(carpeta, "k.pem"),
          "-out",
          join(carpeta, "c.pem"),
        ],
        { stdio: "ignore" },
      );
      return {
        key: readFileSync(join(carpeta, "k.pem"), "utf8"),
        cert: readFileSync(join(carpeta, "c.pem"), "utf8"),
      };
    } finally {
      rmSync(carpeta, { recursive: true, force: true });
    }
  };
  const conTls = async (nombre: string) => {
    const par = certificadoPara(nombre);
    const visto: { sni?: string | false; huella?: string }[] = [];
    const s = crearServidorHttps(
      {
        ...par,
        SNICallback: (n, cb) => {
          visto.push({ sni: n });
          cb(null, undefined);
        },
      },
      (_q, r) => enviar(r, WEBP),
    );
    await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
    abiertos.push(
      () =>
        new Promise<void>((ok) => {
          s.closeAllConnections();
          s.close(() => ok());
        }),
    );
    return { puerto: (s.address() as AddressInfo).port, par, visto };
  };
  const confiando =
    (cert: string): DependenciasDelTraedor["solicitar"] =>
    (o, cb) =>
      pedirPorHttps({ ...o, ca: cert }, cb);

  it("el certificado se verifica contra el NOMBRE del proveedor, aunque se conecte a la dirección", async () => {
    const t = await conTls("res.cloudinary.com");
    const r = await crearTraedor(
      enBucleLocal(t.puerto, { solicitar: confiando(t.par.cert) }),
    ).traerLogo(destino);
    expect(r).toEqual({ ok: true, valor: WEBP });
    expect(t.visto.map((v) => v.sni)).toEqual(["res.cloudinary.com"]);
  });

  it("un certificado de otro nombre no pasa, aunque esté firmado por quien se confía", async () => {
    const t = await conTls("otro.example.com");
    const r = await crearTraedor(
      enBucleLocal(t.puerto, { solicitar: confiando(t.par.cert) }),
    ).traerLogo(destino);
    expect(r).toEqual({ ok: false, error: "SIN_CONEXION" });
  });

  it("sin confiar en el certificado, el traedor de producción no lo acepta", async () => {
    const t = await conTls("res.cloudinary.com");
    const r = await crearTraedor({
      ...DEPENDENCIAS_DE_PRODUCCION,
      resolver: () => Promise.resolve(["127.0.0.1"]),
      direccionPermitida: () => true,
      puerto: t.puerto,
      limites: { ...LIMITES_DE_PRUEBA },
    }).traerLogo(destino);
    expect(r).toEqual({ ok: false, error: "SIN_CONEXION" });
  });
});

describe("los pedidos a la vez", () => {
  it("20 pedidos juntos: a lo sumo 8 conexiones, el resto se rechaza sin conectar, y después todo vuelve a andar", async () => {
    let enCurso = 0;
    let maximo = 0;
    const s = await servidor((_p, r) => {
      enCurso += 1;
      maximo = Math.max(maximo, enCurso);
      setTimeout(() => {
        enCurso -= 1;
        enviar(r, WEBP);
      }, 120);
    });
    const traedor = crearTraedor(enBucleLocal(s.puerto));
    const resultados = await Promise.all(
      Array.from({ length: 20 }, () => traedor.traerLogo(destino)),
    );
    expect(resultados.filter((r) => r.ok)).toHaveLength(8);
    expect(resultados.filter((r) => !r.ok && r.error === "OCUPADO")).toHaveLength(12);
    expect(maximo).toBeLessThanOrEqual(8);
    expect(s.pedidos).toHaveLength(8);
    expect((await traedor.traerLogo(destino)).ok).toBe(true);
  });

  it("un pedido que falla o se corta libera su lugar", async () => {
    const s = await servidor(() => undefined);
    const traedor = crearTraedor(
      enBucleLocal(s.puerto, { limites: { ...LIMITES_DE_PRUEBA, simultaneas: 1, totalMs: 80 } }),
    );
    for (let i = 0; i < 3; i += 1) {
      expect(await traedor.traerLogo(destino)).toEqual({ ok: false, error: "TIEMPO_AGOTADO" });
    }
  });
});

describe("la configuración de producción", () => {
  it("es la que dice el diseño: puerto 443, https, la guarda real y los límites del spec", () => {
    expect(DEPENDENCIAS_DE_PRODUCCION.puerto).toBe(443);
    expect(DEPENDENCIAS_DE_PRODUCCION.solicitar).toBe(pedirPorHttps);
    expect(DEPENDENCIAS_DE_PRODUCCION.direccionPermitida).toBe(direccionDeRedPermitida);
    expect(DEPENDENCIAS_DE_PRODUCCION.limites).toEqual({
      pesoMaximo: 100_000,
      conexionMs: 2_000,
      totalMs: 4_000,
      simultaneas: 8,
    });
    expect(LIMITES_DEL_TRAEDOR).toEqual(DEPENDENCIAS_DE_PRODUCCION.limites);
    expect(typeof crearTraedorDeProduccion().traerLogo).toBe("function");
  });

  it("el DNS de producción rechaza un nombre que no existe sin lanzar", async () => {
    const r = await DEPENDENCIAS_DE_PRODUCCION.resolver("no-existe.invalid").then(
      () => "resolvió",
      () => "falló",
    );
    expect(r).toBe("falló");
  });
});
