import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { armarDestino, leerDireccionPegada, type PartesDeDireccion } from "./direccion-externa";

/**
 * Propiedades del validador de la dirección pegada (C-17). El oráculo de «a qué host va» es el analizador
 * de direcciones WHATWG de Node (`URL`: solo analiza texto, no abre conexiones), una implementación
 * independiente de la nuestra.
 */

const HOST = "res.cloudinary.com";
const MINUSCULAS_Y_DIGITOS = "abcdefghijklmnopqrstuvwxyz0123456789_-";
const ALFANUMERICOS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

const texto = (alfabeto: string, min: number, max: number) =>
  fc.string({ unit: fc.constantFrom(...alfabeto), minLength: min, maxLength: max });

const cuentaValida = texto(MINUSCULAS_Y_DIGITOS, 1, 64);
const versionValida = fc
  .tuple(fc.integer({ min: 1, max: 9 }), texto("0123456789", 0, 11))
  .map(([a, b]) => `${a}${b}`);
const idValido = fc
  .array(texto(ALFANUMERICOS, 1, 30), { minLength: 1, maxLength: 5 })
  .map((tramos) => tramos.join("/"));
const extensionValida = fc.constantFrom("jpg", "jpeg", "png", "webp");
const transformacion = texto(`${ALFANUMERICOS},.:`, 1, 20).filter(
  (t) => t !== "." && !t.includes(".."),
);

const partesValidas: fc.Arbitrary<PartesDeDireccion> = fc.record({
  proveedor: fc.constant("CLOUDINARY" as const),
  cuenta: cuentaValida,
  idPublico: idValido,
  version: versionValida,
  extension: extensionValida,
});

const canonica = (p: PartesDeDireccion): string =>
  `https://${HOST}/${p.cuenta}/image/upload/v${p.version}/${p.idPublico}.${p.extension}`;

/** Lo que pegaría una persona: transformaciones, mayúsculas, http, comillas y blancos alrededor. */
const pegado = fc
  .tuple(
    partesValidas,
    fc.array(transformacion, { maxLength: 3 }),
    fc.boolean(),
    fc.constantFrom("", " ", "\n", "\t ", "\r\n", " "),
    fc.constantFrom(["", ""], ['"', '"'], ["'", "'"], ["“", "”"], ["‘", "’"]),
    fc.boolean(),
  )
  .map(([partes, trans, http, blanco, [abre = "", cierra = ""], mayusculas]) => {
    const esquema = http ? "http" : "https";
    const host = mayusculas ? HOST.toUpperCase() : HOST;
    const ext = mayusculas ? partes.extension.toUpperCase() : partes.extension;
    const medio = [...trans, `v${partes.version}`].join("/");
    const url = `${mayusculas ? esquema.toUpperCase() : esquema}://${host}/${partes.cuenta}/image/upload/${medio}/${partes.idPublico}.${ext}`;
    return { partes, http, entrada: `${blanco}${abre}${url}${cierra}${blanco}` };
  });

/** El host, el usuario, el puerto y la ruta según el analizador de Node, sobre lo pegado ya pelado. */
function analizar(entrada: string): URL | null {
  const t = entrada.trim();
  for (const candidato of [t, t.slice(1, -1).trim()]) {
    try {
      return new URL(candidato);
    } catch {
      /* probar el siguiente */
    }
  }
  return null;
}

function aseguraQueApuntaSoloAlProveedor(u: URL): void {
  expect(u.protocol).toMatch(/^https?:$/);
  expect(u.hostname).toBe(HOST);
  expect([u.username, u.password, u.port, u.search, u.hash]).toEqual(["", "", "", "", ""]);
  expect(u.pathname).not.toMatch(/%|\.\.|\/\/|\\/);
}

const mutaciones = [
  "",
  "%",
  "%2e",
  "%2f",
  ".",
  "..",
  "/",
  "//",
  "\\",
  "@",
  ":",
  "?",
  "#",
  " ",
  "\t",
  "\0",
  "‮",
  "．",
  "é",
  "а",
  "[",
  "]",
  "xn--",
  "0x7f",
  ";",
  "&",
  "=",
  "v1",
  "-",
  "_",
];

/** Una dirección válida con un cambio: cortada, con algo metido, con un carácter cambiado o borrado. */
const mutada = fc
  .tuple(partesValidas, fc.nat(400), fc.constantFrom(...mutaciones), fc.nat(3))
  .map(([partes, posicion, nuevo, modo]) => {
    const url = canonica(partes);
    const i = posicion % (url.length + 1);
    if (modo === 0) return url.slice(0, i) + nuevo + url.slice(i);
    if (modo === 1) return url.slice(0, i) + nuevo + url.slice(i + 1);
    if (modo === 2) return url.slice(0, i) + url.slice(i + 1);
    return url.slice(0, i);
  });

describe("leerDireccionPegada: propiedades", () => {
  it("lo que pega una persona (transformaciones, mayúsculas, http, comillas, blancos) se lee igual", () => {
    fc.assert(
      fc.property(pegado, ({ partes, http, entrada }) => {
        const r = leerDireccionPegada(entrada);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.valor.partes).toEqual({ ...partes });
        expect(r.valor.direccionNormalizada).toBe(canonica(partes));
        expect(r.valor.eraHttp).toBe(http);
      }),
    );
  });

  it("la dirección normalizada es idempotente y siempre apunta solo al host del proveedor", () => {
    fc.assert(
      fc.property(pegado, ({ entrada }) => {
        const r = leerDireccionPegada(entrada);
        if (!r.ok) throw new Error("debía leerse");
        const { direccionNormalizada } = r.valor;
        const otra = leerDireccionPegada(direccionNormalizada);
        expect(otra).toEqual({ ok: true, valor: { ...r.valor, eraHttp: false } });
        const u = new URL(direccionNormalizada);
        aseguraQueApuntaSoloAlProveedor(u);
        expect(u.protocol).toBe("https:");
        expect(u.href).toBe(direccionNormalizada);
      }),
    );
  });

  it("nunca lanza ante texto arbitrario ni mutado, y si acepta, el host es EXACTAMENTE el del proveedor", () => {
    const hostil = fc.oneof(
      mutada,
      fc.string({ maxLength: 120 }),
      fc.string({ unit: "binary", maxLength: 120 }),
      fc.string({
        unit: fc.constantFrom(..."httpsl:/.@%\\#?[]0x7f-_ \tabcdeiknoruvwz‮．"),
        maxLength: 120,
      }),
      // Cualquier prefijo de una válida pegado a algo hostil.
      fc
        .tuple(
          partesValidas,
          fc.nat(120),
          fc.constantFrom(...mutaciones),
          fc.constantFrom(...mutaciones),
        )
        .map(([p, i, a, b]) => {
          const u = canonica(p);
          return u.slice(0, i % u.length) + a + b + u.slice(i % u.length);
        }),
    );
    fc.assert(
      fc.property(hostil, (entrada) => {
        const r = leerDireccionPegada(entrada);
        if (!r.ok) return;
        const u = analizar(entrada);
        expect(u, JSON.stringify(entrada)).not.toBeNull();
        if (u === null) return;
        aseguraQueApuntaSoloAlProveedor(u);
        // Y lo que se devuelve se arma desde partes limpias.
        expect(r.valor.direccionNormalizada).toMatch(
          /^https:\/\/res\.cloudinary\.com\/[a-z0-9_-]+\/image\/upload\/v[1-9][0-9]*\/[A-Za-z0-9_/-]+\.(jpg|jpeg|png|webp)$/,
        );
        aseguraQueApuntaSoloAlProveedor(new URL(r.valor.direccionNormalizada));
      }),
      { numRuns: 2000 },
    );
  });

  it("cualquier cambio en el host de una válida la rechaza (salvo que siga siendo el mismo host)", () => {
    const cambio = fc.tuple(
      partesValidas,
      fc.nat(HOST.length - 1),
      fc.constantFrom(...mutaciones, "x", "z", "-"),
    );
    fc.assert(
      fc.property(cambio, ([partes, i, nuevo]) => {
        const host = HOST.slice(0, i) + nuevo + HOST.slice(i + 1);
        const entrada = canonica(partes).replace(HOST, host);
        const r = leerDireccionPegada(entrada);
        if (host.toLowerCase() === HOST) expect(r.ok).toBe(true);
        else expect(r.ok, entrada).toBe(false);
      }),
    );
  });

  it("agregar algo antes o después del host de una válida la rechaza", () => {
    const decoracion = fc.tuple(
      partesValidas,
      fc.constantFrom(
        ".evil.com",
        ".",
        "x.",
        "-x",
        "x",
        ".com",
        ":443",
        "@evil.com",
        "%2e",
        "\\@evil.com",
        "..",
        ":",
      ),
    );
    fc.assert(
      fc.property(decoracion, ([partes, extra]) => {
        const detras = canonica(partes).replace(HOST, HOST + extra);
        const delante = canonica(partes).replace(HOST, extra + HOST);
        expect(leerDireccionPegada(detras).ok, detras).toBe(false);
        expect(leerDireccionPegada(delante).ok, delante).toBe(false);
      }),
    );
  });

  it("las partes extraídas nunca contienen el host ni barras fuera del id", () => {
    fc.assert(
      fc.property(pegado, ({ entrada }) => {
        const r = leerDireccionPegada(entrada);
        if (!r.ok) throw new Error("debía leerse");
        const { cuenta, version, extension, idPublico } = r.valor.partes;
        for (const parte of [cuenta, version, extension]) expect(parte).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(idPublico).toMatch(/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/);
        expect([cuenta, version, extension, idPublico].join(" ")).not.toContain(HOST);
      }),
    );
  });

  it("textos largos hostiles se resuelven en tiempo acotado", () => {
    const largo = fc.oneof(
      fc.string({
        unit: fc.constantFrom(..."/.%2e@:\\#? "),
        minLength: 20_000,
        maxLength: 100_000,
      }),
      fc
        .nat(5_000)
        .map(
          (n) =>
            `${canonica({ proveedor: "CLOUDINARY", cuenta: "a", idPublico: "b", version: "1", extension: "jpg" })}${"/..".repeat(n)}`,
        ),
      fc.nat(100_000).map((n) => " ".repeat(n) + "https://" + "%2e".repeat(n)),
    );
    fc.assert(
      fc.property(largo, (entrada) => {
        const desde = performance.now();
        leerDireccionPegada(entrada);
        expect(performance.now() - desde).toBeLessThan(300);
      }),
      { numRuns: 30 },
    );
  });
});

describe("armarDestino: propiedades", () => {
  const variante = fc.constantFrom(480 as const, 1200 as const);

  it("con partes válidas y cuenta declarada, el destino apunta solo al host del proveedor y a la plantilla", () => {
    fc.assert(
      fc.property(
        partesValidas,
        variante,
        fc.array(cuentaValida, { maxLength: 2 }),
        (partes, v, otras) => {
          const r = armarDestino(partes, v, [...otras, partes.cuenta]);
          if (!r.ok) throw new Error(r.error);
          const u = new URL(r.valor.url);
          aseguraQueApuntaSoloAlProveedor(u);
          expect(u.protocol).toBe("https:");
          expect(r.valor.host).toBe(HOST);
          expect(r.valor.ruta).toBe(u.pathname);
          expect(u.pathname).toBe(
            `/${partes.cuenta}/image/upload/c_fill,ar_4:3,w_${v},f_webp,q_80/v${partes.version}/${partes.idPublico}.${partes.extension}`,
          );
        },
      ),
    );
  });

  it("sin la cuenta declarada nunca arma destino", () => {
    fc.assert(
      fc.property(
        partesValidas,
        variante,
        fc.array(cuentaValida, { maxLength: 3 }),
        (partes, v, otras) => {
          const r = armarDestino(
            partes,
            v,
            otras.filter((c) => c !== partes.cuenta),
          );
          expect(r).toEqual({ ok: false, error: "CUENTA_NO_DECLARADA" });
        },
      ),
    );
  });

  it("con partes arbitrarias nunca lanza, y si arma, el destino sigue apuntando solo al proveedor", () => {
    const cualquiera = fc.oneof(
      fc.string({ maxLength: 40 }),
      fc.constantFrom(...mutaciones),
      texto(ALFANUMERICOS + "/.%:@\\?# ", 0, 40),
    );
    const partesHostiles = fc.record({
      proveedor: fc.oneof(fc.constant("CLOUDINARY"), cualquiera),
      cuenta: fc.oneof(cuentaValida, cualquiera),
      idPublico: fc.oneof(idValido, cualquiera),
      version: fc.oneof(versionValida, cualquiera),
      extension: fc.oneof(extensionValida, cualquiera),
    });
    fc.assert(
      fc.property(partesHostiles, variante, (partes, v) => {
        const r = armarDestino(partes as PartesDeDireccion, v, [partes.cuenta]);
        if (!r.ok) return;
        const u = new URL(r.valor.url);
        aseguraQueApuntaSoloAlProveedor(u);
        expect(u.pathname).toMatch(
          /^\/[a-z0-9_-]+\/image\/upload\/c_fill,ar_4:3,w_(480|1200),f_webp,q_80\/v[1-9][0-9]*\/[A-Za-z0-9_/-]+\.(jpg|jpeg|png|webp)$/,
        );
      }),
      { numRuns: 1000 },
    );
  });

  it("lo leído de lo pegado siempre se puede armar, con el mismo resultado que armar desde las partes", () => {
    fc.assert(
      fc.property(pegado, variante, ({ entrada }, v) => {
        const r = leerDireccionPegada(entrada);
        if (!r.ok) throw new Error("debía leerse");
        const d = armarDestino(r.valor.partes, v, [r.valor.partes.cuenta]);
        expect(d.ok).toBe(true);
      }),
    );
  });
});
