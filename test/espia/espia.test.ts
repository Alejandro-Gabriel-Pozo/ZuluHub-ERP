import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as pkijs from "pkijs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Grabadora, importe } from "../../scripts/espia/arca";
import {
  aPem,
  armarTra,
  certificadoDePrueba,
  desdePem,
  firmarTra,
  generarPedido,
  verificarCms,
} from "../../scripts/espia/cms";
import {
  ErrorDeConfiguracion,
  VARIABLES,
  configuracionReal,
  configuracionSeca,
  ejecutarEspia,
} from "../../scripts/espia/espia";
import { SecretoEnLaSalida, exigirSinSecretos, sanear } from "../../scripts/espia/saneamiento";
import { levantarServidorFalso, type ServidorFalso } from "../../scripts/espia/servidor-falso";
import { enviar } from "../../scripts/espia/transporte";
import { correrVerificaciones } from "../../scripts/espia/verificaciones";
import { XmlInseguro, desescapar, leerXml, textoDe } from "../../scripts/espia/xml";

/**
 * Pruebas del espía (F0, rama descartable) contra el ARCA FALSO local: la firma CMS y el CSR con pkijs, el lector de
 * XML (sin entidades, todo texto), el saneamiento de credenciales, el tiempo límite propio (servidor que no responde
 * y servidor que manda las cabeceras y se cuelga) y una corrida entera en modo seco que no deja ninguna credencial en
 * la salida. Sin red: todo contra 127.0.0.1.
 */

vi.setConfig({ testTimeout: 60_000 });

const AHORA = new Date("2026-10-14T13:00:00Z");

async function aliasDePrueba() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const cert = await certificadoDePrueba(
    privateKey,
    new Uint8Array(publicKey.export({ format: "der", type: "spki" })),
    "20111111112",
  );
  return { cert, clave: privateKey };
}

describe("CMS y CSR con pkijs", () => {
  it.each(["SHA-256", "SHA-1"] as const)(
    "firma el TRA con %s: SignedData con el TRA adentro, el certificado y una firma que verifica",
    async (hash) => {
      const { cert, clave } = await aliasDePrueba();
      const tra = armarTra(AHORA);
      const cms = await firmarTra(tra, cert, clave, hash, AHORA);
      const r = await verificarCms(cms);
      expect(r).toMatchObject({ valida: true, contenido: tra, hash });
      expect(tra).toContain("<service>wsfe</service>");
      expect(tra).toContain("<generationTime>2026-10-14T09:58:00-03:00</generationTime>");
      expect(tra).toContain("<expirationTime>2026-10-14T10:10:00-03:00</expirationTime>");
    },
  );

  it("un CMS alterado no verifica", async () => {
    const { cert, clave } = await aliasDePrueba();
    const cms = Buffer.from(
      await firmarTra(armarTra(AHORA), cert, clave, "SHA-256", AHORA),
      "base64",
    );
    const i = cms.indexOf(Buffer.from("wsfe"));
    cms[i] = "x".charCodeAt(0);
    expect((await verificarCms(cms.toString("base64"))).valida).toBe(false);
  });

  it("E1: el CSR lleva C=AR, O, CN=alias y serialNumber=CUIT, y su firma verifica", async () => {
    const { pedidoPem } = await generarPedido({
      organizacion: "Panadería Zulú",
      alias: "zuluhub2",
      cuit: "20111111112",
    });
    const pedido = pkijs.CertificationRequest.fromBER(desdePem(pedidoPem, "CERTIFICATE REQUEST"));
    expect(await pedido.verify()).toBe(true);
    const sujeto = pedido.subject.typesAndValues.map((t) => [t.type, t.value.valueBlock.value]);
    expect(sujeto).toEqual([
      ["2.5.4.6", "AR"],
      ["2.5.4.10", "Panadería Zulú"],
      ["2.5.4.3", "zuluhub2"],
      ["2.5.4.5", "CUIT 20111111112"],
    ]);
    expect(pedidoPem).not.toContain("PRIVATE KEY");
    expect(aPem(new Uint8Array([1, 2, 3]), "X")).toBe("-----BEGIN X-----\nAQID\n-----END X-----\n");
  });
});

describe("XML: sin entidades y todo como texto", () => {
  it("un CAE que empieza con 0 y un importe quedan como texto (nunca number)", () => {
    const x = leerXml(
      "<a><CAE>07400000000001</CAE><ImpTotal>121.50</ImpTotal><CbteNro>0042</CbteNro></a>",
    );
    expect(textoDe(x, "CAE")).toBe("07400000000001");
    expect(textoDe(x, "ImpTotal")).toBe("121.50");
    expect(textoDe(x, "CbteNro")).toBe("0042");
  });

  it("rechaza un DOCTYPE o una declaración de entidades, y no expande entidades", () => {
    expect(() => leerXml('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>')).toThrow(XmlInseguro);
    expect(() => leerXml('<a><!ENTITY x "y"></a>')).toThrow(XmlInseguro);
    expect(() => leerXml('<!DOCTYPE a SYSTEM "file:///etc/passwd"><a/>')).toThrow(XmlInseguro);
    expect(textoDe(leerXml("<a><b>&amp;lt;</b></a>"), "b")).toBe("&amp;lt;");
    expect(desescapar("&lt;t&gt;&amp;&quot;&apos;&#65;&#x42;")).toBe(`<t>&"'AB`);
  });

  it("los importes se escriben desde centavos, sin pasar por number", () => {
    expect([importe(23_150n), importe(5n), importe(0n), importe(-150n)]).toEqual([
      "231.50",
      "0.05",
      "0.00",
      "-1.50",
    ]);
  });
});

describe("saneamiento", () => {
  it("oculta token, sign y el CMS (con prefijo, en mayúsculas y escapados dentro de otro XML) y las claves PEM", () => {
    const sucio =
      "<ar:Auth><ar:Token>T0K3N-SECRETO</ar:Token><ar:Sign>F1RMA</ar:Sign></ar:Auth>" +
      "<wsaa:in0>Q01TLWZpcm1hZG8=</wsaa:in0>" +
      "&lt;credentials&gt;&lt;token&gt;OTRO-T0K3N&lt;/token&gt;&lt;sign&gt;OTRA&lt;/sign&gt;&lt;/credentials&gt;" +
      "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----";
    const limpio = sanear(sucio);
    for (const secreto of [
      "T0K3N-SECRETO",
      "F1RMA",
      "Q01TLWZpcm1hZG8=",
      "OTRO-T0K3N",
      "OTRA",
      "AAAA",
    ]) {
      expect(limpio).not.toContain(secreto);
    }
    expect(limpio).toContain("<ar:Token>[OCULTO]</ar:Token>");
    expect(limpio).toContain("&lt;token&gt;[OCULTO]&lt;/token&gt;");
  });

  it("la verificación final frena un secreto conocido (entero o un pedazo) y cualquier clave privada", () => {
    const token = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ";
    expect(() => exigirSinSecretos(`hola ${token}`, [token], "x")).toThrow(SecretoEnLaSalida);
    expect(() => exigirSinSecretos(`hola ${token.slice(-24)}`, [token], "x")).toThrow(
      SecretoEnLaSalida,
    );
    expect(() => exigirSinSecretos("RSA PRIVATE KEY", [], "x")).toThrow(SecretoEnLaSalida);
    expect(() => exigirSinSecretos("nada", [token], "x")).not.toThrow();
  });
});

describe("tiempo límite propio (cubre conexión, envío y lectura del cuerpo)", () => {
  let falso: ServidorFalso;
  beforeAll(async () => {
    falso = await levantarServidorFalso();
  });
  afterAll(async () => {
    await falso.cerrar();
  });

  it("un servidor que no responde: TIEMPO_AGOTADO dentro del límite, después de enviar", async () => {
    const inicio = Date.now();
    const r = await enviar(`${falso.url}/colgado`, "<a/>", {}, { totalMs: 300 });
    expect(r).toMatchObject({
      ok: false,
      falla: { motivo: "TIEMPO_AGOTADO", fase: "DESPUES_DE_ENVIAR" },
    });
    expect(Date.now() - inicio).toBeLessThan(3_000);
  });

  it("un servidor que manda las cabeceras y se cuelga (goteo): también TIEMPO_AGOTADO", async () => {
    const r = await enviar(`${falso.url}/goteo`, "<a/>", {}, { totalMs: 300 });
    expect(r).toMatchObject({
      ok: false,
      falla: { motivo: "TIEMPO_AGOTADO", fase: "DESPUES_DE_ENVIAR" },
    });
  });

  it("una conexión rechazada es ANTES de enviar (el pedido seguro no salió)", async () => {
    const r = await enviar("http://127.0.0.1:1/x", "<a/>", {}, { totalMs: 2_000 });
    expect(r).toMatchObject({
      ok: false,
      falla: { fase: "ANTES_DE_ENVIAR", motivo: "ECONNREFUSED" },
    });
  });

  it("una respuesta más grande que el tope se corta", async () => {
    const r = await enviar(
      `${falso.url}/wsfev1/service.asmx`,
      "<a/>",
      { SOAPAction: '"x/FEDummy"' },
      { totalMs: 2_000, maximoDeBytes: 10 },
    );
    expect(r).toMatchObject({ ok: false, falla: { motivo: "RESPUESTA_DEMASIADO_GRANDE" } });
  });
});

describe("una corrida entera en modo seco", () => {
  let falso: ServidorFalso;
  let salida: string;
  beforeAll(async () => {
    falso = await levantarServidorFalso();
    salida = mkdtempSync(join(tmpdir(), "espia-"));
  });
  afterAll(async () => {
    await falso.cerrar();
    rmSync(salida, { recursive: true, force: true });
  });

  it("E1-E14 con su estado, y NINGUNA credencial de la corrida en ningún archivo de la salida", async () => {
    const c = await configuracionSeca(falso.url, salida, () => AHORA);
    const g = new Grabadora(salida);
    const resultados = await correrVerificaciones(c, g);
    expect(resultados.map((r) => [r.id, r.estado])).toEqual([
      ["E1", "APROBADA"],
      ["E2", "APROBADA"],
      ["E3", "APROBADA"],
      ["E4", "INFORMATIVA"],
      ["E5", "APROBADA"],
      ["E6", "APROBADA"],
      ["E7", "APROBADA"],
      ["E8", "APROBADA"],
      ["E9", "INFORMATIVA"],
      ["E10", "APROBADA"],
      ["E11", "INFORMATIVA"],
      ["E12", "APROBADA"],
      ["E13", "PENDIENTE"],
      ["E14", "INFORMATIVA"],
    ]);
    // Hubo credenciales (dos tickets: alias 1 y alias 2, más los CMS) y ninguna quedó escrita.
    expect(g.secretos.length).toBeGreaterThanOrEqual(6);
    const archivos = readdirSync(join(salida, "grabaciones")).map((a) =>
      join(salida, "grabaciones", a),
    );
    expect(archivos.length).toBeGreaterThan(30);
    for (const archivo of [...archivos, join(salida, "tablas-de-arca.json")]) {
      const contenido = readFileSync(archivo, "utf8");
      expect(() => exigirSinSecretos(contenido, g.secretos, archivo)).not.toThrow();
    }
    // Las grabaciones de WSFE muestran el Auth tapado.
    const pedido = archivos.find(
      (a) => a.includes("FECAESolicitar") || a.includes("E7-factura-B-pedido"),
    );
    expect(readFileSync(pedido ?? "", "utf8")).toContain("<ar:Token>[OCULTO]</ar:Token>");
    // E11: el reenvío del número de E7 llegó al falso dos veces más, y las dos se rechazaron (10016).
    expect(falso.autorizaciones.get("1|6|1")).toBe(3);
  });

  it("ejecutarEspia --seco escribe el informe y no muestra credenciales en pantalla", async () => {
    const pantalla: string[] = [];
    const otra = mkdtempSync(join(tmpdir(), "espia-"));
    try {
      const r = await ejecutarEspia(
        ["--seco"],
        { [VARIABLES.salida]: otra },
        (l) => pantalla.push(l),
        () => AHORA,
      );
      expect(r.codigo).toBe(0);
      expect(r.informe).toContain("## E13. TLS desde el entorno de Vercel gru1 — ⏳ pendiente");
      expect(readFileSync(join(otra, "informe.md"), "utf8")).toBe(r.informe);
      expect(pantalla.join("\n")).not.toMatch(/PRIVATE KEY|<token>|<sign>/i);
    } finally {
      rmSync(otra, { recursive: true, force: true });
    }
  });

  it("un argumento desconocido muestra el uso y sale con 2", async () => {
    const pantalla: string[] = [];
    expect((await ejecutarEspia(["--aplicar"], {}, (l) => pantalla.push(l))).codigo).toBe(2);
    expect(pantalla).toEqual(["uso: npm run espia [-- --seco]"]);
  });
});

describe("configuración real (variables de entorno)", () => {
  it("nombra la variable que falta y no lee nada más", () => {
    expect(() => configuracionReal({}, () => AHORA)).toThrow(
      new ErrorDeConfiguracion("falta la variable ZULUHUB_ESPIA_CUIT"),
    );
  });

  it("valida el CUIT y el punto de venta", () => {
    const base = {
      [VARIABLES.cuit]: "20-11111111-2",
      [VARIABLES.cuitReceptor]: "30500010912",
      [VARIABLES.puntoDeVenta]: "1",
    };
    expect(() => configuracionReal(base, () => AHORA)).toThrow(
      /ZULUHUB_ESPIA_CUIT tiene que ser un CUIT de 11 dígitos/,
    );
    expect(() =>
      configuracionReal(
        { ...base, [VARIABLES.cuit]: "20111111112", [VARIABLES.puntoDeVenta]: "0" },
        () => AHORA,
      ),
    ).toThrow(/PUNTO_DE_VENTA/);
  });

  it("la clave nueva de E1 nunca dentro de la carpeta de salida ni pisando un archivo", () => {
    const salida = mkdtempSync(join(tmpdir(), "espia-"));
    try {
      const base = {
        [VARIABLES.cuit]: "20111111112",
        [VARIABLES.cuitReceptor]: "30500010912",
        [VARIABLES.puntoDeVenta]: "1",
        [VARIABLES.salida]: salida,
        [VARIABLES.aliasNuevo]: "zuluhub2",
      };
      expect(() =>
        configuracionReal(
          { ...base, [VARIABLES.claveNueva]: join(salida, "clave.key") },
          () => AHORA,
        ),
      ).toThrow(/dentro de la carpeta de salida/);
      expect(() =>
        configuracionReal({ ...base, [VARIABLES.claveNueva]: join(salida, "..") }, () => AHORA),
      ).toThrow(/ya existe/);
    } finally {
      rmSync(salida, { recursive: true, force: true });
    }
  });
});
