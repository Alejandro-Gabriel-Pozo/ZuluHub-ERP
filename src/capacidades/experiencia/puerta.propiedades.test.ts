import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { nonceDe } from "./cabeceras";
import {
  HOST_DESCONOCIDO,
  HOST_NO_DISPONIBLE,
  SUPERFICIES_SERVIBLES,
  decidirPuerta,
  type EstadoDeLaResolucion,
} from "./puerta";

/**
 * Propiedades de la puerta (P-2 y P-5, parte pura): lo que decide NO depende de los valores de los
 * encabezados del cliente, una resolución que no es una marca servible termina siempre en la neutra, y
 * ninguna ruta, por rara que sea, llega a un prefijo interno con tramos que suban de nivel.
 */
const NONCE = nonceDe(new Uint8Array(16).fill(9));

const resolucion = fc.oneof(
  fc.constant<EstadoDeLaResolucion>(HOST_DESCONOCIDO),
  fc.constant<EstadoDeLaResolucion>(HOST_NO_DISPONIBLE),
  fc.constantFrom(...SUPERFICIES_SERVIBLES).map((superficie): EstadoDeLaResolucion => ({
    tipo: "RESUELTA",
    puerta: {
      host: "x.test",
      superficie,
      marcaId: "m",
      marca: { nombre: "M", tema: {}, hostDeApp: null },
    },
  })),
);

// Alfabeto chico y rico en lo peligroso para las rutas.
const trozo = fc.constantFrom(
  "/",
  "s",
  "S",
  "api",
  "..",
  ".",
  "%2e",
  "%2E",
  "%73",
  "%",
  "\\",
  "a",
  "é",
  "?",
  "#",
  "%00",
  "%zz",
);
const ruta = fc.array(trozo, { maxLength: 8 }).map((t) => t.join(""));
const nombreDeEncabezado = fc.constantFrom(
  "x-zh-marca",
  "X-ZH-Nonce",
  "x-zh-superficie",
  "x-forwarded-host",
  "host",
  "accept",
  "cookie",
  "x-zh-",
  "x-zhx",
);
const encabezados = fc.array(fc.tuple(nombreDeEncabezado, fc.string({ maxLength: 12 })), {
  maxLength: 6,
});

const aHeaders = (pares: [string, string][]): Headers => {
  const h = new Headers();
  for (const [n, v] of pares) h.append(n, v.replace(/[^\x20-\x7e]/g, "x").trim());
  return h;
};

const decidir = (pares: [string, string][], r: string, res: EstadoDeLaResolucion, prod: boolean) =>
  decidirPuerta({
    encabezados: aHeaders(pares),
    ruta: r,
    resolucion: res,
    produccion: prod,
    nonce: NONCE,
  });

describe("decidirPuerta (propiedades)", () => {
  it("no depende de los valores de los encabezados del cliente", () => {
    fc.assert(
      fc.property(encabezados, ruta, resolucion, fc.boolean(), (pares, r, res, prod) => {
        const con = decidir(pares, r, res, prod);
        const sin = decidir([], r, res, prod);
        expect(con.accion).toBe(sin.accion);
        expect(con.rutaInterna).toBe(sin.rutaInterna);
        expect(con.estado).toBe(sin.estado);
        expect(con.superficie).toBe(sin.superficie);
        expect(con.encabezadosDeRespuesta).toEqual(sin.encabezadosDeRespuesta);
      }),
    );
  });

  it("al pedido que sigue no llega ningún x-zh-* del cliente: solo el nonce propio", () => {
    fc.assert(
      fc.property(encabezados, ruta, resolucion, (pares, r, res) => {
        const d = decidir(pares, r, res, false);
        const internos = [...d.encabezadosDePedido.keys()].filter((n) => n.startsWith("x-zh-"));
        expect(internos).toEqual(["x-zh-nonce"]);
        expect(d.encabezadosDePedido.get("x-zh-nonce")).toBe(NONCE);
      }),
    );
  });

  it("sin una marca servible, siempre la neutra con 404 (503 si la base falló)", () => {
    fc.assert(
      fc.property(
        encabezados,
        ruta,
        fc.constantFrom(HOST_DESCONOCIDO, HOST_NO_DISPONIBLE),
        fc.boolean(),
        (pares, r, res, prod) => {
          const d = decidir(pares, r, res, prod);
          expect(d.rutaInterna).toBe("/s/neutra");
          expect(d.estado).toBe(res.tipo === "NO_DISPONIBLE" ? 503 : 404);
          expect(d.encabezadosDeRespuesta["X-Robots-Tag"]).toBe("noindex");
        },
      ),
    );
  });

  it("toda ruta interna elegida es el prefijo de la superficie del host y sin tramos que suban", () => {
    fc.assert(
      fc.property(ruta, resolucion, (r, res) => {
        const d = decidir([], r, res, false);
        if (d.rutaInterna === null) {
          expect(d.accion).toBe("SEGUIR");
          expect(res.tipo === "RESUELTA" && res.puerta.superficie === "APP").toBe(true);
          expect(r === "/api" || r.startsWith("/api/")).toBe(true);
          return;
        }
        expect(d.rutaInterna.startsWith("/s/")).toBe(true);
        expect(d.rutaInterna).not.toContain("//");
        let real = d.rutaInterna;
        try {
          real = decodeURIComponent(d.rutaInterna);
        } catch {
          // Una codificación inválida solo llega hasta la neutra, que no tiene rastro del pedido.
          expect(d.rutaInterna).toBe("/s/neutra");
        }
        expect(real.split("/")).not.toContain("..");
        expect(real.split("/")).not.toContain(".");
        if (d.superficie === "NEUTRA") expect(d.rutaInterna).toBe("/s/neutra");
        else expect(d.rutaInterna.startsWith(`/s/${d.superficie.toLowerCase()}`)).toBe(true);
      }),
    );
  });

  it("nunca se entra por una ruta interna pedida desde afuera", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("/s", "/S", "/s/", "/s/app", "/%73/x", "/%53", "/s/../s/app"),
        fc.oneof(
          fc.constant(""),
          fc.string({ maxLength: 6 }).map((t) => `/${t}`),
        ),
        resolucion,
        (base, cola, res) => {
          const d = decidir([], `${base}${cola}`, res, true);
          expect(d.rutaInterna).toBe("/s/neutra");
        },
      ),
    );
  });
});
