import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  adminPlataformaId,
  empresaId,
  personaId,
  tenantId,
  usuarioAuthId,
  type AdminPlataformaId,
  type MarcaComercialId,
  type UsuarioAuthId,
} from "../../primitivas/identificadores/marca";
import { MARCA_PRINCIPAL_DE_PRUEBA, OTRA_MARCA_DE_PRUEBA } from "../../../test/utilidades/marcas";
import type { Contexto } from "../../contexto/contexto";
import {
  ACTOR_DE_SISTEMA,
  VIGENCIA_DEL_CONTEXTO_EN_S,
  ZULUHUB_CLAVE_CONTEXTO,
  actorFirmado,
  firmarCarga,
  firmarContexto,
  leerClaveDeContexto,
  rolDeContexto,
  usuarioFirmado,
  type ClaveDeContexto,
} from "./contexto-firmado";
import { ErrorDeConfiguracion } from "./errores";

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const PERSONA = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333";
const ADMIN = "4444aaaa-4444-4444-8444-bbbbbbbbbbbb";
const HASH = "ab".repeat(32);
const USUARIO = "55555555-5555-4555-8555-555555555555";
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
      a: null,
      s: null,
    });
    expect(token).toBe(
      "v1.7.7b2275223a227a756c756875625f617070222c2265223a2231313131313131312d313131312d343131312d383131312d313131313131313131313131222c2274223a6e756c6c2c2270223a2232323232323232322d323232322d343232322d383232322d323232323232323232323232222c2269223a6e756c6c2c2278223a313030303030303330302c2261223a6e756c6c2c2273223a6e756c6c7d.8f008c52fe3fbb926db324d47d92972b281413764e0f74453fe7358fdd764b27",
    );
  });

  it("el vector con actor de plataforma también coincide con uno calculado aparte", () => {
    const token = firmarCarga(CLAVE, {
      u: "zuluhub_plataforma",
      e: null,
      t: null,
      p: null,
      i: null,
      x: 1_000_000_300,
      a: ADMIN,
      s: null,
    });
    expect(token).toBe(
      "v1.7.7b2275223a227a756c756875625f706c617461666f726d61222c2265223a6e756c6c2c2274223a6e756c6c2c2270223a6e756c6c2c2269223a6e756c6c2c2278223a313030303030303330302c2261223a2234343434616161612d343434342d343434342d383434342d626262626262626262626262222c2273223a6e756c6c7d.a98d75867d139639a741cdccbd5d3613b8842eb2123556d7a10aa87c87fb7bc2",
    );
  });

  it("el vector con usuario autenticado (claim `s`) también coincide con uno calculado aparte", () => {
    const token = firmarCarga(CLAVE, {
      u: "zuluhub_app",
      e: null,
      t: null,
      p: null,
      i: null,
      x: 1_000_000_300,
      a: null,
      s: USUARIO,
    });
    expect(token).toBe(
      "v1.7.7b2275223a227a756c756875625f617070222c2265223a6e756c6c2c2274223a6e756c6c2c2270223a6e756c6c2c2269223a6e756c6c2c2278223a313030303030303330302c2261223a6e756c6c2c2273223a2235353535353535352d353535352d343535352d383535352d353535353535353535353535227d.293eb53c8f017812f647db62b9b97e8760ed53b150d3a634673ccc10b934c0a2",
    );
  });

  it("el mac es el HMAC-SHA256 hex de `v1.<kid>.<payloadHex>` con el secreto de la clave", () => {
    const { kid, payloadHex, mac } = partir(
      firmarCarga(CLAVE, {
        u: "zuluhub_app",
        e: null,
        t: null,
        p: null,
        i: null,
        x: 5,
        a: null,
        s: null,
      }),
    );
    expect(kid).toBe("7");
    expect(mac).toMatch(/^[0-9a-f]{64}$/);
    expect(mac).toBe(
      createHmac("sha256", SECRETO_DE_PRUEBA).update(`v1.7.${payloadHex}`).digest("hex"),
    );
  });

  it("el payload lleva exactamente u, e, t, p, i, x, a, s, en ese orden", () => {
    const { payloadHex } = partir(
      firmarCarga(CLAVE, {
        u: "zuluhub_app",
        e: null,
        t: null,
        p: null,
        i: null,
        x: 5,
        a: null,
        s: null,
      }),
    );
    expect(Buffer.from(payloadHex, "hex").toString("utf8")).toBe(
      '{"u":"zuluhub_app","e":null,"t":null,"p":null,"i":null,"x":5,"a":null,"s":null}',
    );
  });

  it("el actor cambia la firma: no se puede reutilizar el token de un actor con otro", () => {
    const carga = { u: "zuluhub_plataforma", e: null, t: null, p: null, i: null, x: 5, s: null };
    const delAdmin = firmarCarga(CLAVE, { ...carga, a: ADMIN });
    const delSistema = firmarCarga(CLAVE, { ...carga, a: ACTOR_DE_SISTEMA });
    const sinActor = firmarCarga(CLAVE, { ...carga, a: null });
    expect(new Set([delAdmin, delSistema, sinActor]).size).toBe(3);
    expect(partir(delAdmin).mac).not.toBe(partir(delSistema).mac);
  });

  it("otra clave (otro secreto o otro kid) da otra firma", () => {
    const carga = {
      u: "zuluhub_app",
      e: EMPRESA,
      t: null,
      p: null,
      i: null,
      x: 5,
      a: null,
      s: null,
    };
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
        marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
        ahora: AHORA,
      }),
    ).toEqual({
      u: "zuluhub_app",
      e: EMPRESA,
      t: null,
      p: PERSONA,
      i: null,
      x: VENCE,
      a: null,
      s: null,
    });
    expect(
      payloadDe({
        tipo: "OPERATIVO",
        empresaId: empresaId(EMPRESA),
        personaId: null,
        marcaDeEntrada: null,
        ahora: AHORA,
      }),
    ).toEqual({
      u: "zuluhub_app",
      e: EMPRESA,
      t: null,
      p: null,
      i: null,
      x: VENCE,
      a: null,
      s: null,
    });
  });

  it("OPERATIVO: la marca de entrada NO viaja en el token (no es frontera de aislamiento, §B.10)", () => {
    const con = (marcaDeEntrada: MarcaComercialId | null) =>
      payloadDe({
        tipo: "OPERATIVO",
        empresaId: empresaId(EMPRESA),
        personaId: personaId(PERSONA),
        marcaDeEntrada,
        ahora: AHORA,
      });
    // Dos puertas distintas (o ninguna) dan exactamente el mismo token: sin claim `m` ni nada parecido.
    expect(con(MARCA_PRINCIPAL_DE_PRUEBA)).toEqual(con(OTRA_MARCA_DE_PRUEBA));
    expect(con(null)).toEqual(con(MARCA_PRINCIPAL_DE_PRUEBA));
    expect(Object.keys(con(MARCA_PRINCIPAL_DE_PRUEBA)).sort()).toEqual([
      "a",
      "e",
      "i",
      "p",
      "s",
      "t",
      "u",
      "x",
    ]);
  });

  it("GRUPO: rol grupo, tenant y persona; sin empresa", () => {
    expect(
      payloadDe({
        tipo: "GRUPO",
        tenantId: tenantId(TENANT),
        personaId: personaId(PERSONA),
        ahora: AHORA,
      }),
    ).toEqual({
      u: "zuluhub_grupo",
      e: null,
      t: TENANT,
      p: PERSONA,
      i: null,
      x: VENCE,
      a: null,
      s: null,
    });
  });

  it("PLATAFORMA: solo el rol y el actor firmado (el id del administrador o `sistema`)", () => {
    expect(
      payloadDe({
        tipo: "PLATAFORMA",
        actor: { tipo: "ADMIN", id: adminPlataformaId(ADMIN) },
        ahora: AHORA,
      }),
    ).toEqual({
      u: "zuluhub_plataforma",
      e: null,
      t: null,
      p: null,
      i: null,
      x: VENCE,
      a: ADMIN,
      s: null,
    });
    expect(
      payloadDe({
        tipo: "PLATAFORMA",
        actor: { tipo: "SISTEMA", proceso: "barrido-de-altas" },
        ahora: AHORA,
      }),
    ).toEqual({
      u: "zuluhub_plataforma",
      e: null,
      t: null,
      p: null,
      i: null,
      x: VENCE,
      a: "sistema",
      s: null,
    });
    // El nombre del proceso no viaja: el actor firmado es siempre el mismo texto.
    expect(ACTOR_DE_SISTEMA).toBe("sistema");
  });

  it("TRABAJOS: solo el rol, sin actor", () => {
    expect(payloadDe({ tipo: "TRABAJOS", ahora: AHORA })).toEqual({
      u: "zuluhub_trabajos",
      e: null,
      t: null,
      p: null,
      i: null,
      x: VENCE,
      a: null,
      s: null,
    });
  });

  it("un id de administrador que no es un uuid canónico en minúsculas se rechaza", () => {
    // Sin pasar por el constructor del identificador (que ya rechaza espacios): lo que se prueba
    // es la validación de la firma, que es la que protege a la base.
    const firmarAdmin = (id: string) =>
      firmarContexto(
        CLAVE,
        { tipo: "PLATAFORMA", actor: { tipo: "ADMIN", id: id as AdminPlataformaId }, ahora: AHORA },
        1,
      );
    for (const mal of [
      "sistema",
      "",
      ADMIN.toUpperCase(),
      ` ${ADMIN}`,
      `${ADMIN} `,
      `${ADMIN}0`,
      ADMIN.slice(1),
      ADMIN.replace("-", ""),
      `${ADMIN}\n`,
      "gggggggg-gggg-gggg-gggg-gggggggggggg",
      `x${ADMIN}`,
      `0${ADMIN}`,
      `${ADMIN}\n${ADMIN}`,
      `${ADMIN}-${ADMIN}`,
    ]) {
      expect(() => firmarAdmin(mal), JSON.stringify(mal)).toThrow(
        "el id del administrador debe ser un uuid canónico en minúsculas",
      );
    }
    expect(() => firmarAdmin(ADMIN)).not.toThrow();
    expect(adminPlataformaId(ADMIN)).toBe(ADMIN);
  });

  it("actorFirmado: el id del administrador, o `sistema` sin importar el nombre del proceso", () => {
    expect(actorFirmado({ tipo: "ADMIN", id: adminPlataformaId(ADMIN) })).toBe(ADMIN);
    expect(actorFirmado({ tipo: "SISTEMA", proceso: "barrido-de-altas" })).toBe(ACTOR_DE_SISTEMA);
    expect(actorFirmado({ tipo: "SISTEMA", proceso: ADMIN })).toBe("sistema");
    expect(() =>
      actorFirmado({ tipo: "ADMIN", id: ADMIN.toUpperCase() as AdminPlataformaId }),
    ).toThrow(new RangeError("el id del administrador debe ser un uuid canónico en minúsculas"));
    expect(() => actorFirmado({ tipo: "ADMIN", id: "sistema" as AdminPlataformaId })).toThrow(
      RangeError,
    );
  });

  it("INVITACION: rol app, el hash del token de invitación y (si ya ingresó) el usuario autenticado", () => {
    const sinUsuario = payloadDe({
      tipo: "INVITACION",
      tokenHash: HASH,
      usuarioAuth: null,
      ahora: AHORA,
    });
    expect(sinUsuario).toEqual({
      u: "zuluhub_app",
      e: null,
      t: null,
      p: null,
      i: HASH,
      x: VENCE,
      a: null,
      s: null,
    });
    expect(
      payloadDe({
        tipo: "INVITACION",
        tokenHash: HASH,
        usuarioAuth: usuarioAuthId(USUARIO),
        ahora: AHORA,
      }),
    ).toEqual({ ...sinUsuario, s: USUARIO });
  });

  it("SESION: rol app, solo el usuario autenticado; sin empresa, tenant, persona ni invitación", () => {
    expect(
      payloadDe({ tipo: "SESION", usuarioAuth: usuarioAuthId(USUARIO), ahora: AHORA }),
    ).toEqual({
      u: "zuluhub_app",
      e: null,
      t: null,
      p: null,
      i: null,
      x: VENCE,
      a: null,
      s: USUARIO,
    });
  });

  it("ninguna otra puerta firma `s`: sale null en operativo, grupo, plataforma y trabajos", () => {
    const contextos: Contexto[] = [
      {
        tipo: "OPERATIVO",
        empresaId: empresaId(EMPRESA),
        personaId: personaId(PERSONA),
        marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
        ahora: AHORA,
      },
      { tipo: "GRUPO", tenantId: tenantId(TENANT), personaId: personaId(PERSONA), ahora: AHORA },
      {
        tipo: "PLATAFORMA",
        actor: { tipo: "ADMIN", id: adminPlataformaId(ADMIN) },
        ahora: AHORA,
      },
      { tipo: "TRABAJOS", ahora: AHORA },
    ];
    for (const contexto of contextos) expect(payloadDe(contexto)["s"], contexto.tipo).toBeNull();
  });

  it("el usuario cambia la firma: el token de un usuario no sirve para otro", () => {
    const otro = usuarioAuthId("66666666-6666-4666-8666-666666666666");
    const de = (usuarioAuth: UsuarioAuthId) =>
      partir(firmarContexto(CLAVE, { tipo: "SESION", usuarioAuth, ahora: AHORA }, AHORA_EN_S));
    expect(de(usuarioAuthId(USUARIO)).mac).not.toBe(de(otro).mac);
    // Y el mismo contexto, la misma firma (determinista).
    expect(de(otro).mac).toBe(de(otro).mac);
  });

  it("un id de usuario que no es un uuid canónico en minúsculas no se firma (ni en sesión ni en invitación)", () => {
    const mal = [
      "",
      "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      ` ${USUARIO}`,
      `${USUARIO} `,
      `${USUARIO}0`,
      USUARIO.slice(1),
      USUARIO.replace("-", ""),
      `${USUARIO}\n`,
      "gggggggg-gggg-gggg-gggg-gggggggggggg",
      `x${USUARIO}`,
      `${USUARIO}\n${USUARIO}`,
    ];
    for (const id of mal) {
      const usuarioAuth = id as UsuarioAuthId;
      const mensaje = "el id del usuario debe ser un uuid canónico en minúsculas";
      expect(() => usuarioFirmado(usuarioAuth), JSON.stringify(id)).toThrow(mensaje);
      expect(
        () => firmarContexto(CLAVE, { tipo: "SESION", usuarioAuth, ahora: AHORA }, 1),
        JSON.stringify(id),
      ).toThrow(mensaje);
      expect(
        () =>
          firmarContexto(
            CLAVE,
            { tipo: "INVITACION", tokenHash: HASH, usuarioAuth, ahora: AHORA },
            1,
          ),
        JSON.stringify(id),
      ).toThrow(mensaje);
    }
    expect(usuarioFirmado(usuarioAuthId(USUARIO))).toBe(USUARIO);
  });

  it("un tokenHash que no es un sha256 hex de 64 caracteres se rechaza", () => {
    for (const mal of ["", "abc", "AB".repeat(32), "zz".repeat(32), `${HASH}0`]) {
      expect(() =>
        firmarContexto(
          CLAVE,
          { tipo: "INVITACION", tokenHash: mal, usuarioAuth: null, ahora: AHORA },
          1,
        ),
      ).toThrow("tokenHash debe ser un sha256 en hexadecimal minúsculo (64 caracteres)");
    }
  });

  it("el rol de base de cada puerta", () => {
    expect(rolDeContexto("OPERATIVO")).toBe("zuluhub_app");
    expect(rolDeContexto("INVITACION")).toBe("zuluhub_app");
    expect(rolDeContexto("SESION")).toBe("zuluhub_app");
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
