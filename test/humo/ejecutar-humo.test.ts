import { describe, expect, it } from "vitest";
import {
  IDENTIFICADORES_DE_CHEQUEOS,
  SQL_MANUAL_DEL_HOTEL,
  SUFIJO_DEL_HOTEL,
  VARIABLE_CODIGO_DE_CARTA,
  VARIABLE_DB_LECTURA,
  VARIABLE_URL_APP,
  VARIABLE_URL_CARTA,
  VARIABLE_URL_RETIRADA,
  VARIABLE_URL_TECNICA,
  ejecutarHumo,
  leerOrigen,
  type ContarDominios,
  type Pedir,
  type RespuestaDeHumo,
} from "../../scripts/ejecutar-humo";

/**
 * `npm run humo` (`scripts/ejecutar-humo.ts`): cada chequeo con UNA prueba que pasa en un «mundo ideal» (una app que se comporta como debe, hecha de falsos) y al menos UNA violación inyectada
 * que ese chequeo tiene que ver (y solo ese: los demás siguen pasando). Los falsos no abren ninguna red. Previene: un chequeo que pasa siempre (no detecta nada) o que cambia sin que nadie lo note.
 */

const TECNICA = "https://tecnica.ejemplo.test";
const APP = "https://app.ejemplo.test";
const CARTA = "https://carta.ejemplo.test";
const RETIRADA = "https://retirada.ejemplo.test";
const CODIGO = "carta-demo";
const CADENA = ["postgres:", "", "lector:clave-secreta-centinela@base.ejemplo.test/base"].join("/");

const ENTORNO_COMPLETO = {
  [VARIABLE_URL_TECNICA]: TECNICA,
  [VARIABLE_URL_APP]: APP,
  [VARIABLE_URL_CARTA]: CARTA,
  [VARIABLE_CODIGO_DE_CARTA]: CODIGO,
  [VARIABLE_URL_RETIRADA]: RETIRADA,
  [VARIABLE_DB_LECTURA]: CADENA,
};

const NEUTRA: RespuestaDeHumo = {
  estado: 404,
  encabezados: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" },
  cuerpo: "",
};
const html = (
  estado: number,
  cuerpo: string,
  extra: Record<string, string> = {},
): RespuestaDeHumo => ({
  estado,
  encabezados: {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": "default-src 'self'",
    ...extra,
  },
  cuerpo,
});

/** Una aplicación que se comporta como debe, por dirección. */
function mundoIdeal(url: string, encabezados: Readonly<Record<string, string>>): RespuestaDeHumo {
  const { origin, pathname } = new URL(url);
  void encabezados;
  if (origin === TECNICA) {
    if (pathname === "/api/salud") {
      return {
        estado: 200,
        encabezados: { "content-type": "application/json" },
        cuerpo: '{"ok":true}',
      };
    }
    if (pathname === "/api/trabajos/cron") return { estado: 401, encabezados: {}, cuerpo: "" };
    return NEUTRA;
  }
  if (origin === APP) {
    if (pathname === "/ingreso") return html(200, "<html>pantalla de ingreso real</html>");
    if (pathname === "/") return { estado: 307, encabezados: { location: "/ingreso" }, cuerpo: "" };
    if (pathname === "/api/sesion/renovar") return { estado: 405, encabezados: {}, cuerpo: "" };
    return html(404, "<html>No encontrado</html>", { "x-robots-tag": "noindex" });
  }
  if (origin === CARTA) {
    if (pathname === `/${CODIGO}`) return html(200, "<html>la carta activa</html>");
    return html(404, "<html>No encontrado</html>", { "x-robots-tag": "noindex" });
  }
  return NEUTRA; // la retirada y cualquier otro host
}

type Cambio = (
  url: string,
  encabezados: Readonly<Record<string, string>>,
) => RespuestaDeHumo | null;

function armar(
  cambio: Cambio | null = null,
  entorno: Record<string, string | undefined> = ENTORNO_COMPLETO,
  conteo = 0,
) {
  const pedidos: { url: string; encabezados: Readonly<Record<string, string>> }[] = [];
  const lineas: string[] = [];
  const cadenas: string[] = [];
  const pedir: Pedir = (url, encabezados = {}) => {
    pedidos.push({ url, encabezados });
    const cambiada = cambio?.(url, encabezados) ?? null;
    return Promise.resolve(cambiada ?? mundoIdeal(url, encabezados));
  };
  const contarDominios: ContarDominios = (cadena) => {
    cadenas.push(cadena);
    return Promise.resolve(conteo);
  };
  return {
    pedidos,
    lineas,
    cadenas,
    correr: () => ejecutarHumo({ entorno, pedir, contarDominios, salida: (l) => lineas.push(l) }),
    texto: () => lineas.join("\n"),
    de: (id: string) => lineas.find((l) => l.includes(` ${id} `)) ?? "",
  };
}

const estadoDe = (linea: string): string => linea.split(" ")[0] ?? "";

describe("el mundo ideal", () => {
  it("todos los chequeos pasan, el código de salida es 0 y se vieron todos los identificadores", async () => {
    const t = armar();
    expect(await t.correr()).toBe(0);
    for (const id of IDENTIFICADORES_DE_CHEQUEOS) expect(estadoDe(t.de(id)), id).toBe("PASA");
    expect(t.texto()).toContain("0 fallan, 0 omitidos");
  });

  it("solo pide por GET sin cuerpo (el tipo de `pedir` no deja otra cosa), nunca manda un secreto y el cron se pide sin secreto", async () => {
    const t = armar();
    await t.correr();
    const aCron = t.pedidos.filter((p) => p.url.endsWith("/api/trabajos/cron"));
    expect(aCron).toHaveLength(2);
    expect(aCron[0]?.encabezados).toEqual({});
    expect(Object.keys(aCron[1]?.encabezados ?? {})).toEqual(["authorization"]);
    for (const p of t.pedidos) {
      for (const [nombre, valor] of Object.entries(p.encabezados)) {
        expect([
          "authorization",
          "x-pd-nonce",
          "x-pd-marca",
          "x-pd-empresa",
          "x-forwarded-host",
        ]).toContain(nombre);
        expect(valor).not.toContain(CADENA);
      }
    }
  });

  it("la salida nombra chequeos y estados, nunca direcciones, hosts ni la cadena de lectura", async () => {
    const t = armar();
    await t.correr();
    const todo = t.texto();
    for (const prohibido of ["https://", "ejemplo.test", "clave-secreta-centinela", CODIGO]) {
      expect(todo).not.toContain(prohibido);
    }
  });
});

/** Cada chequeo con sus violaciones: el cambio que se inyecta y qué dirección toca. */
const VIOLACIONES: readonly (readonly [id: string, que: string, cambio: Cambio])[] = [
  [
    "H0-01",
    "la dirección técnica sirve una página",
    (u) => (u === `${TECNICA}/` ? html(200, "<html>marca</html>") : null),
  ],
  [
    "H0-01",
    "la neutra trae cuerpo",
    (u) => (u === `${TECNICA}/ingreso` ? { ...NEUTRA, cuerpo: "No encontrado" } : null),
  ],
  [
    "H0-01",
    "la neutra sin noindex",
    (u) =>
      u === `${TECNICA}/` ? { ...NEUTRA, encabezados: { "content-type": "text/html" } } : null,
  ],
  [
    "H0-01",
    "la neutra pone cookies",
    (u) =>
      u === `${TECNICA}/`
        ? { ...NEUTRA, encabezados: { ...NEUTRA.encabezados, "set-cookie": "a=1" } }
        : null,
  ],
  [
    "H0-02",
    "el cron sin secreto contesta 200",
    (u, e) =>
      u.endsWith("/cron") && e["authorization"] === undefined
        ? { estado: 200, encabezados: {}, cuerpo: "{}" }
        : null,
  ],
  [
    "H0-02",
    "el cron con un secreto inventado da pistas",
    (u, e) =>
      u.endsWith("/cron") && e["authorization"] !== undefined
        ? { estado: 401, encabezados: {}, cuerpo: "secreto inválido" }
        : null,
  ],
  [
    "H0-02",
    "el cron da 403",
    (u) => (u.endsWith("/cron") ? { estado: 403, encabezados: {}, cuerpo: "" } : null),
  ],
  [
    "H0-03",
    "la salud no es JSON",
    (u) => (u.endsWith("/api/salud") ? { estado: 200, encabezados: {}, cuerpo: "ok" } : null),
  ],
  [
    "H0-03",
    "la salud dice más de lo que debe",
    (u) =>
      u.endsWith("/api/salud")
        ? { estado: 200, encabezados: {}, cuerpo: '{"ok":true,"version":"1"}' }
        : null,
  ],
  [
    "H0-03",
    "la salud responde 503",
    (u) =>
      u.endsWith("/api/salud") ? { estado: 503, encabezados: {}, cuerpo: '{"ok":false}' } : null,
  ],
  [
    "H0-04",
    "la entrada de la aplicación no es HTML",
    (u) =>
      u === `${APP}/ingreso`
        ? { estado: 200, encabezados: { "content-type": "application/json" }, cuerpo: "{}" }
        : null,
  ],
  [
    "H0-04",
    "la entrada de la aplicación sin política de contenido",
    (u) =>
      u === `${APP}/ingreso`
        ? { estado: 200, encabezados: { "content-type": "text/html" }, cuerpo: "<html></html>" }
        : null,
  ],
  ["H0-04", "la entrada de la aplicación da 404", (u) => (u === `${APP}/ingreso` ? NEUTRA : null)],
  [
    "H1-01",
    "vuelve un encabezado interno",
    (u, e) =>
      u === `${TECNICA}/` && e["x-pd-nonce"] !== undefined
        ? { ...NEUTRA, encabezados: { ...NEUTRA.encabezados, "x-pd-marca": "x" } }
        : null,
  ],
  [
    "H1-01",
    "vuelve un encabezado del middleware",
    (u, e) =>
      u === `${TECNICA}/` && e["x-pd-nonce"] !== undefined
        ? { ...NEUTRA, encabezados: { ...NEUTRA.encabezados, "x-middleware-rewrite": "/s/neutra" } }
        : null,
  ],
  [
    "H1-01",
    "el host reenviado cambia la respuesta",
    (u, e) =>
      u === `${TECNICA}/` && e["x-forwarded-host"] !== undefined
        ? html(200, "<html>otra marca</html>")
        : null,
  ],
  [
    "H1-02",
    "la ruta interna sirve la pantalla real",
    (u) =>
      u === `${APP}/s/app/ingreso` ? html(200, "<html>pantalla de ingreso real</html>") : null,
  ],
  [
    "H1-02",
    "la ruta interna da 200",
    (u) => (u === `${APP}/s/app/ingreso` ? html(200, "<html>otra cosa</html>") : null),
  ],
  [
    "H1-03",
    "la raíz da un error de servidor",
    (u) => (u === `${APP}/` ? { estado: 500, encabezados: {}, cuerpo: "" } : null),
  ],
  [
    "H1-03",
    "la raíz redirige a otro sitio",
    (u) =>
      u === `${APP}/`
        ? { estado: 302, encabezados: { location: "https://otro.ejemplo.test/" }, cuerpo: "" }
        : null,
  ],
  [
    "H1-03",
    "la raíz redirige con barra doble",
    (u) =>
      u === `${APP}/`
        ? { estado: 302, encabezados: { location: "//otro.ejemplo.test/" }, cuerpo: "" }
        : null,
  ],
  [
    "H1-03",
    "la raíz pone cookies sin sesión",
    (u) =>
      u === `${APP}/`
        ? { estado: 307, encabezados: { location: "/ingreso", "set-cookie": "s=1" }, cuerpo: "" }
        : null,
  ],
  [
    "H1-03",
    "la renovación de sesión acepta sin sesión",
    (u) =>
      u === `${APP}/api/sesion/renovar` ? { estado: 200, encabezados: {}, cuerpo: "{}" } : null,
  ],
  [
    "H1-03",
    "la renovación de sesión da un error de servidor",
    (u) =>
      u === `${APP}/api/sesion/renovar` ? { estado: 500, encabezados: {}, cuerpo: "" } : null,
  ],
  [
    "H12-01",
    "la carta activa no se sirve",
    (u) => (u === `${CARTA}/${CODIGO}` ? html(404, "<html>No encontrado</html>") : null),
  ],
  [
    "H12-01",
    "un código inexistente devuelve la carta activa",
    (u) =>
      u.endsWith("/humo-codigo-que-no-existe") && new URL(u).origin === CARTA
        ? html(200, "<html>la carta activa</html>")
        : null,
  ],
  [
    "H12-01",
    "un código inexistente da 200 con otra cosa",
    (u) =>
      u.endsWith("/humo-codigo-que-no-existe") && new URL(u).origin === CARTA
        ? html(200, "<html>otra</html>")
        : null,
  ],
  [
    "H12-02",
    "la ruta interna de la carta se sirve",
    (u) => (u === `${CARTA}/s/carta/${CODIGO}` ? html(200, "<html>la carta activa</html>") : null),
  ],
  [
    "H12-03",
    "el host retirado sirve la carta",
    (u) => (u === `${RETIRADA}/${CODIGO}` ? html(200, "<html>la carta activa</html>") : null),
  ],
  [
    "H12-03",
    "el host retirado tiene cuerpo",
    (u) => (u === `${RETIRADA}/` ? { ...NEUTRA, cuerpo: "No encontrado" } : null),
  ],
  [
    "H12-03",
    "el host retirado sin noindex",
    (u) => (u === `${RETIRADA}/` ? { ...NEUTRA, encabezados: {} } : null),
  ],
  [
    "H0-05",
    "una respuesta es un 503",
    (u) =>
      u === `${APP}/api/sesion/renovar` ? { estado: 503, encabezados: {}, cuerpo: "" } : null,
  ],
  [
    "H0-05",
    "una respuesta dice «En mantenimiento»",
    (u) =>
      u === `${CARTA}/${CODIGO}` ? html(200, "<html><h1>En mantenimiento</h1></html>") : null,
  ],
];

describe("violaciones inyectadas: cada chequeo detecta lo suyo", () => {
  it.each(VIOLACIONES)("%s: %s", async (id, _que, cambio) => {
    const t = armar(cambio);
    expect(await t.correr()).toBe(1);
    expect(estadoDe(t.de(id)), t.de(id)).toBe("FALLA");
  });

  it("cada chequeo tiene al menos una violación inyectada", () => {
    const cubiertos = new Set(VIOLACIONES.map(([id]) => id));
    const conOtraPrueba = new Set(["HDN-01"]); // tiene las suyas abajo, con el conteo de la base
    expect(
      IDENTIFICADORES_DE_CHEQUEOS.filter((id) => !cubiertos.has(id) && !conOtraPrueba.has(id)),
    ).toEqual([]);
  });

  it("una violación de un chequeo no hace fallar a los demás (salvo «nunca en mantenimiento», que mira todo lo visto)", async () => {
    for (const [id, _que, cambio] of VIOLACIONES.filter(([i]) => i !== "H0-05")) {
      const t = armar(cambio);
      await t.correr();
      const fallan = IDENTIFICADORES_DE_CHEQUEOS.filter((i) => estadoDe(t.de(i)) === "FALLA");
      expect(fallan, `${id}: ${_que}`).toContain(id);
      // Los chequeos que miran las mismas respuestas pueden coincidir; ningún otro grupo cae por esto.
      for (const otro of fallan)
        expect(otro.split("-")[0], `${id}: ${_que}`).toBe(id.split("-")[0]);
    }
  });

  it("una falla de red o un tiempo vencido es una FALLA, nunca un «pasa», y la salida no repite el mensaje de la red", async () => {
    const t = armar();
    const rota: Pedir = () =>
      Promise.reject(Object.assign(new Error(`ECONNREFUSED ${TECNICA}`), { name: "TypeError" }));
    const codigo = await ejecutarHumo({
      entorno: ENTORNO_COMPLETO,
      pedir: rota,
      salida: (l) => t.lineas.push(l),
    });
    expect(codigo).toBe(1);
    expect(estadoDe(t.de("H0-01"))).toBe("FALLA");
    expect(t.de("H0-01")).toContain("no se pudo comprobar (TypeError)");
    expect(t.texto()).not.toContain("ECONNREFUSED");
    expect(t.texto()).not.toContain("ejemplo.test");
  });

  it("H0-05 no «pasa» si no se vio ninguna respuesta: queda omitido", async () => {
    const t = armar();
    const codigo = await ejecutarHumo({
      entorno: {},
      pedir: () => Promise.reject(new Error("no se tendría que pedir nada")),
      salida: (l) => t.lineas.push(l),
    });
    expect(codigo).toBe(2);
    expect(t.lineas.some((l) => l.includes("H0-05"))).toBe(false);
    const sinRespuestas = armar();
    await ejecutarHumo({
      entorno: { PEDERNAL_HUMO_URL_TECNICA: TECNICA },
      pedir: () => Promise.reject(new Error("red")),
      salida: (l) => sinRespuestas.lineas.push(l),
    });
    expect(estadoDe(sinRespuestas.de("H0-05"))).toBe("OMITIDO");
  });
});

describe("aislamiento del hotel (HDN-01)", () => {
  it("con la cadena de lectura y 0 dominios del hotel, pasa; la cadena solo se le pasa a la lectura", async () => {
    const t = armar(null, ENTORNO_COMPLETO, 0);
    expect(await t.correr()).toBe(0);
    expect(estadoDe(t.de("HDN-01"))).toBe("PASA");
    expect(t.cadenas).toEqual([CADENA]);
  });

  it.each([1, 2, 40])(
    "%i dominio(s) del hotel en la base compartida: FALLA, y la salida no trae la cadena",
    async (n) => {
      const t = armar(null, ENTORNO_COMPLETO, n);
      expect(await t.correr()).toBe(1);
      expect(estadoDe(t.de("HDN-01"))).toBe("FALLA");
      expect(t.de("HDN-01")).toContain(`${n} dominio(s) ACTIVO(s)`);
      expect(t.texto()).not.toContain("clave-secreta-centinela");
    },
  );

  it("si la lectura falla, es una FALLA sin el mensaje (podría traer la cadena)", async () => {
    const t = armar();
    const contarDominios: ContarDominios = () =>
      Promise.reject(new Error(`password authentication failed ${CADENA}`));
    const codigo = await ejecutarHumo({
      entorno: ENTORNO_COMPLETO,
      pedir: (u, e) => Promise.resolve(mundoIdeal(u, e ?? {})),
      contarDominios,
      salida: (l) => t.lineas.push(l),
    });
    expect(codigo).toBe(1);
    expect(estadoDe(t.de("HDN-01"))).toBe("FALLA");
    expect(t.texto()).not.toContain("clave-secreta-centinela");
    expect(t.texto()).not.toContain("authentication");
  });

  it("sin cadena de lectura se OMITE y dice el paso manual con su SQL", async () => {
    const t = armar(null, { ...ENTORNO_COMPLETO, [VARIABLE_DB_LECTURA]: undefined });
    expect(await t.correr()).toBe(0);
    expect(estadoDe(t.de("HDN-01"))).toBe("OMITIDO");
    expect(t.de("HDN-01")).toContain(SQL_MANUAL_DEL_HOTEL);
    expect(t.cadenas).toEqual([]);
    expect(SQL_MANUAL_DEL_HOTEL).toContain(SUFIJO_DEL_HOTEL);
  });
});

describe("variables y omisiones", () => {
  it("solo la dirección técnica: corre H0 y la salud, y OMITE lo que necesita otra variable (sin fingir que pasó)", async () => {
    const t = armar(null, { [VARIABLE_URL_TECNICA]: TECNICA });
    expect(await t.correr()).toBe(0);
    for (const id of ["H0-01", "H0-02", "H0-03", "H1-01", "H0-05"])
      expect(estadoDe(t.de(id)), id).toBe("PASA");
    for (const id of ["H0-04", "H1-02", "H1-03", "H12-01", "H12-02", "H12-03", "HDN-01"]) {
      expect(estadoDe(t.de(id)), id).toBe("OMITIDO");
    }
    expect(t.pedidos.every((p) => new URL(p.url).origin === TECNICA)).toBe(true);
  });

  it("sin la dirección técnica: código 2, nombra la variable y no pide nada", async () => {
    const t = armar(null, { ...ENTORNO_COMPLETO, [VARIABLE_URL_TECNICA]: undefined });
    expect(await t.correr()).toBe(2);
    expect(t.texto()).toContain(VARIABLE_URL_TECNICA);
    expect(t.pedidos).toEqual([]);
  });

  it.each([
    ["con ruta", `${TECNICA}/ruta`],
    ["con consulta", `${TECNICA}/?a=1`],
    ["con credenciales", "https://usuario:clave@tecnica.ejemplo.test"],
    ["sin https", "http://tecnica.ejemplo.test"],
    ["que no es una dirección", "no-es-una-direccion"],
  ])(
    "una dirección %s se rechaza (código 2), sin repetir su valor y sin pedir nada",
    async (_nombre, valor) => {
      const t = armar(null, { ...ENTORNO_COMPLETO, [VARIABLE_URL_APP]: valor });
      expect(await t.correr()).toBe(2);
      expect(t.texto()).toContain(VARIABLE_URL_APP);
      expect(t.texto()).not.toContain(valor);
      expect(t.pedidos).toEqual([]);
    },
  );

  it("un código de carta con forma inválida se rechaza", async () => {
    const t = armar(null, { ...ENTORNO_COMPLETO, [VARIABLE_CODIGO_DE_CARTA]: "../etc/passwd" });
    expect(await t.correr()).toBe(2);
    expect(t.texto()).toContain(VARIABLE_CODIGO_DE_CARTA);
    expect(t.pedidos).toEqual([]);
  });

  it("la carta sin su código (o el código sin la carta) se omite", async () => {
    const sinCodigo = armar(null, { ...ENTORNO_COMPLETO, [VARIABLE_CODIGO_DE_CARTA]: undefined });
    await sinCodigo.correr();
    expect(estadoDe(sinCodigo.de("H12-01"))).toBe("OMITIDO");
    const sinCarta = armar(null, { ...ENTORNO_COMPLETO, [VARIABLE_URL_CARTA]: undefined });
    await sinCarta.correr();
    expect(estadoDe(sinCarta.de("H12-02"))).toBe("OMITIDO");
  });
});

describe("leerOrigen", () => {
  it.each([
    ["https://app.ejemplo.test", "https://app.ejemplo.test"],
    ["  https://app.ejemplo.test/  ", "https://app.ejemplo.test"],
    ["https://app.ejemplo.test:8443", "https://app.ejemplo.test:8443"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["http://127.0.0.1:3000", "http://127.0.0.1:3000"],
  ])("%s es un origen válido", (entrada, esperado) => {
    expect(leerOrigen(entrada)).toBe(esperado);
  });

  it.each([
    undefined,
    "",
    "   ",
    "http://app.ejemplo.test",
    "ftp://app.ejemplo.test",
    "https://app.ejemplo.test/ruta",
    "https://app.ejemplo.test/?q=1",
    "https://app.ejemplo.test/#x",
    "https://u:p@app.ejemplo.test",
    "app.ejemplo.test",
  ])("%j no lo es", (entrada) => {
    expect(leerOrigen(entrada)).toBeNull();
  });
});
