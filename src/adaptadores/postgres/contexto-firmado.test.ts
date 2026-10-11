import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { empresaId, personaId, tenantId } from "../../primitivas/identificadores/marca";
import type { Contexto } from "../../contexto/contexto";
import {
  VIGENCIA_DEL_CONTEXTO_EN_S,
  ZULUHUB_CLAVE_CONTEXTO,
  firmarCarga,
  firmarContexto,
  leerClaveDeContexto,
  rolDeContexto,
  type ClaveDeContexto,
} from "./contexto-firmado";
import { ErrorDeConfiguracion } from "./errores";

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const PERSONA = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333";
const HASH = "ab".repeat(32);
const AHORA = new Date("2026-10-11T12:00:00Z");

// Secreto de prueba: los bytes 0x00..0x1f (nada de esto es una clave real).
const SECRETO_DE_PRUEBA = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const CLAVE: ClaveDeContexto = { kid: 7, secreto: SECRETO_DE_PRUEBA };

/** Parte un token `v1.<kid>.<payloadHex>.<macHex>`. */
function partir(token: string) {
  const [version, kid, payloadHex, mac, ...resto] = token.split(".");
  expect(resto).toEqual([]);
  return {
    version,
    kid,
    payloadHex: payloadHex as string,
    mac: mac as string,
    payload: JSON.parse(Buffer.from(payloadHex as string, "hex").toString("utf8")) as Record<
      string,
      unknown
    >,
  };
}

describe("firmarCarga: formato y vector conocido", () => {
  it("coincide con un vector fijo calculado aparte con node:crypto", () => {
    const token = firmarCarga(CLAVE, {
      u: "zuluhub_app",
      e: EMPRESA,
      t: null,
      p: PERSONA,
      i: null,
      x: 1_000_000_300,
    });
    expect(token).toBe(
      "v1.7.7b2275223a227a756c756875625f617070222c2265223a2231313131313131312d313131312d343131312d383131312d313131313131313131313131222c2274223a6e756c6c2c2270223a2232323232323232322d323232322d343232322d383232322d323232323232323232323232222c2269223a6e756c6c2c2278223a313030303030303330307d.09f7c5214e6d77bbca276137734f42b756b1cf6a70e3a0ca01cb1f7c47c6d490",
    );
  });

  it("el mac es el HMAC-SHA256 hex de `v1.<kid>.<payloadHex>` con el secreto de la clave", () => {
    const { kid, payloadHex, mac } = partir(
      firmarCarga(CLAVE, { u: "zuluhub_app", e: null, t: null, p: null, i: null, x: 5 }),
    );
    expect(kid).toBe("7");
    expect(mac).toMatch(/^[0-9a-f]{64}$/);
    expect(mac).toBe(
      createHmac("sha256", SECRETO_DE_PRUEBA).update(`v1.7.${payloadHex}`).digest("hex"),
    );
  });

  it("el payload lleva exactamente u, e, t, p, i, x, en ese orden", () => {
    const { payloadHex } = partir(
      firmarCarga(CLAVE, { u: "zuluhub_app", e: null, t: null, p: null, i: null, x: 5 }),
    );
    expect(Buffer.from(payloadHex, "hex").toString("utf8")).toBe(
      '{"u":"zuluhub_app","e":null,"t":null,"p":null,"i":null,"x":5}',
    );
  });

  it("otra clave (otro secreto o otro kid) da otra firma", () => {
    const carga = { u: "zuluhub_app", e: EMPRESA, t: null, p: null, i: null, x: 5 };
    const base = firmarCarga(CLAVE, carga);
    expect(firmarCarga({ kid: 7, secreto: Buffer.alloc(32, 1) }, carga)).not.toBe(base);
    expect(firmarCarga({ kid: 8, secreto: SECRETO_DE_PRUEBA }, carga)).not.toBe(base);
  });
});

describe("firmarContexto: qué campos lleva cada puerta", () => {
  const AHORA_EN_S = 1_000_000_000;
  const VENCE = AHORA_EN_S + VIGENCIA_DEL_CONTEXTO_EN_S;
  const payloadDe = (contexto: Contexto) =>
    partir(firmarContexto(CLAVE, contexto, AHORA_EN_S)).payload;

  it("OPERATIVO: rol app, empresa y persona (o null si lo hace el sistema)", () => {
    expect(
      payloadDe({
        tipo: "OPERATIVO",
        empresaId: empresaId(EMPRESA),
        personaId: personaId(PERSONA),
        ahora: AHORA,
      }),
    ).toEqual({ u: "zuluhub_app", e: EMPRESA, t: null, p: PERSONA, i: null, x: VENCE });
    expect(
      payloadDe({
        tipo: "OPERATIVO",
        empresaId: empresaId(EMPRESA),
        personaId: null,
        ahora: AHORA,
      }),
    ).toEqual({ u: "zuluhub_app", e: EMPRESA, t: null, p: null, i: null, x: VENCE });
  });

  it("GRUPO: rol grupo, tenant y persona; sin empresa", () => {
    expect(
      payloadDe({
        tipo: "GRUPO",
        tenantId: tenantId(TENANT),
        personaId: personaId(PERSONA),
        ahora: AHORA,
      }),
    ).toEqual({ u: "zuluhub_grupo", e: null, t: TENANT, p: PERSONA, i: null, x: VENCE });
  });

  it("PLATAFORMA y TRABAJOS: solo el rol; el administrador no viaja en el token", () => {
    expect(payloadDe({ tipo: "PLATAFORMA", administrador: "admin", ahora: AHORA })).toEqual({
      u: "zuluhub_plataforma",
      e: null,
      t: null,
      p: null,
      i: null,
      x: VENCE,
    });
    expect(payloadDe({ tipo: "TRABAJOS", ahora: AHORA })).toEqual({
      u: "zuluhub_trabajos",
      e: null,
      t: null,
      p: null,
      i: null,
      x: VENCE,
    });
  });

  it("INVITACION: rol app, solo el hash del token de invitación", () => {
    expect(payloadDe({ tipo: "INVITACION", tokenHash: HASH, ahora: AHORA })).toEqual({
      u: "zuluhub_app",
      e: null,
      t: null,
      p: null,
      i: HASH,
      x: VENCE,
    });
  });

  it("un tokenHash que no es un sha256 hex de 64 caracteres se rechaza", () => {
    for (const mal of ["", "abc", "AB".repeat(32), "zz".repeat(32), `${HASH}0`]) {
      expect(() =>
        firmarContexto(CLAVE, { tipo: "INVITACION", tokenHash: mal, ahora: AHORA }, 1),
      ).toThrow(RangeError);
    }
  });

  it("el rol de base de cada puerta", () => {
    expect(rolDeContexto("OPERATIVO")).toBe("zuluhub_app");
    expect(rolDeContexto("INVITACION")).toBe("zuluhub_app");
    expect(rolDeContexto("GRUPO")).toBe("zuluhub_grupo");
    expect(rolDeContexto("TRABAJOS")).toBe("zuluhub_trabajos");
    expect(rolDeContexto("PLATAFORMA")).toBe("zuluhub_plataforma");
  });
});

describe("vencimiento", () => {
  it("se calcula desde el reloj que recibe la función pura, no desde `contexto.ahora`", () => {
    const contexto: Contexto = { tipo: "TRABAJOS", ahora: new Date("1999-01-01T00:00:00Z") };
    for (const ahoraEnSegundos of [0, 1_000, 1_800_000_000]) {
      expect(partir(firmarContexto(CLAVE, contexto, ahoraEnSegundos)).payload["x"]).toBe(
        ahoraEnSegundos + 300,
      );
    }
    expect(VIGENCIA_DEL_CONTEXTO_EN_S).toBe(300);
  });

  it("dos instantes distintos dan tokens distintos (se firma de nuevo en cada intento)", () => {
    const contexto: Contexto = { tipo: "TRABAJOS", ahora: AHORA };
    expect(firmarContexto(CLAVE, contexto, 10)).not.toBe(firmarContexto(CLAVE, contexto, 11));
  });
});

describe("leerClaveDeContexto", () => {
  const HEX_64 = "0a".repeat(32);

  it("lee `<kid>:<hex>` válido", () => {
    const clave = leerClaveDeContexto(`12:${HEX_64}`);
    expect(clave.kid).toBe(12);
    expect(clave.secreto.toString("hex")).toBe(HEX_64);
    expect(leerClaveDeContexto(`1:${"AB".repeat(40)}`).secreto).toHaveLength(40);
    expect(leerClaveDeContexto(`32767:${HEX_64}\n`).kid).toBe(32767);
  });

  it("el nombre de la variable es ZULUHUB_CLAVE_CONTEXTO", () => {
    expect(ZULUHUB_CLAVE_CONTEXTO).toBe("ZULUHUB_CLAVE_CONTEXTO");
  });

  // Valores inválidos con un "secreto" reconocible: el mensaje de error jamás debe contenerlo.
  const MARCA = "deadbeefcafebabe";
  const invalidos: Array<[string, string | undefined]> = [
    ["faltante", undefined],
    ["vacío", ""],
    ["solo espacios", "   "],
    ["sin separador", `7${MARCA.repeat(8)}`],
    ["separadores de más", `7:${MARCA.repeat(8)}:1`],
    ["kid no numérico", `siete:${MARCA.repeat(8)}`],
    ["kid cero", `0:${MARCA.repeat(8)}`],
    ["kid negativo", `-1:${MARCA.repeat(8)}`],
    ["kid con ceros a la izquierda", `007:${MARCA.repeat(8)}`],
    ["kid fuera de smallint", `32768:${MARCA.repeat(8)}`],
    ["kid decimal", `1.5:${MARCA.repeat(8)}`],
    ["hex corto (31 bytes)", `7:${MARCA.repeat(3)}${"ab".repeat(7)}`],
    ["hex no hexadecimal", `7:${MARCA.repeat(7)}${"zz".repeat(8)}`],
    ["hex impar", `7:${MARCA.repeat(8)}a`],
    ["hex vacío", "7:"],
  ];

  it.each(invalidos)("rechaza %s con ErrorDeConfiguracion y sin filtrar el valor", (_, valor) => {
    let error: unknown;
    try {
      leerClaveDeContexto(valor);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErrorDeConfiguracion);
    const mensaje = (error as Error).message;
    expect(mensaje).toContain(ZULUHUB_CLAVE_CONTEXTO);
    expect(mensaje).not.toContain(MARCA);
    if (valor !== undefined && valor.trim() !== "") expect(mensaje).not.toContain(valor.trim());
  });
});
