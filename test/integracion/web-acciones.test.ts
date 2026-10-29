import { ENCABEZADO_DE_IP } from "../../src/capacidades/autenticacion/host-de-autenticacion";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { ok } from "../../src/primitivas/resultado/resultado";
import { crearBarrera } from "./entorno";
import { emailAlAzar } from "./fixtures-identidad";
import { crearMundoDeMarca } from "./marcas-apoyo";
import { ipUnica, perfilAlAzar } from "./autenticacion-ingreso-apoyo";
import {
  HOST_A,
  HOST_B,
  armarMundoWeb,
  empresaDeLaMarca,
  ingresarEn,
  invitar,
  personaVinculada,
  type Ingresado,
  type MundoWeb,
} from "./web-apoyo";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

import type * as ModuloDeAcciones from "../../apps/web/servidor/acciones";
import type * as ModuloDeRenovacion from "../../apps/web/servidor/renovar-sesion";

/**
 * W5, lo que HACEN las acciones del servidor y las rutas, y lo que PINTAN las páginas, con la base real y
 * sesiones de verdad. Next se reemplaza por lo mínimo (los encabezados, las cookies y las redirecciones del
 * pedido) y la puerta por un falso de dos marcas; todo lo demás es el código real: el traductor, la lógica
 * de sesión y empresa, los casos de uso y la autenticación. No hay `next start` en el CI todavía: lo que
 * queda para el e2e está en el informe.
 *
 *  - P-7: toda acción rechaza un `Origin` de otro host y, rechazada, no cambia NADA; la cookie es SameSite=Lax.
 *  - P-6: la cookie de A en el host B lleva a la pantalla de ingreso.
 *  - P-1: nada de la marca B en una página de A.
 *  - P-10: sesión vencida (se mueve `expiresAt`) -> a ingresar; cerrar sesión borra la fila.
 */
vi.mock("server-only", () => ({}));

class Redireccion extends Error {
  constructor(readonly destino: string) {
    super(`redirect:${destino}`);
  }
}
const esNoEncontrada = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "digest" in error &&
  String(error.digest).includes("404");
const noEncontrada = () =>
  Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });

const estado = vi.hoisted(() => ({
  mundo: null as MundoWeb | null,
  encabezados: new Headers(),
  jar: new Map<string, string>(),
  escrituras: [] as { nombre: string; valor: string; opciones: Record<string, unknown> }[],
  borrados: [] as string[],
  nombres: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(estado.encabezados),
  cookies: () =>
    Promise.resolve({
      get: (nombre: string) => {
        const valor = estado.jar.get(nombre);
        return valor === undefined ? undefined : { name: nombre, value: valor };
      },
      set: (nombre: string, valor: string, opciones: Record<string, unknown> = {}) => {
        estado.escrituras.push({ nombre, valor, opciones });
        estado.jar.set(nombre, valor);
      },
      delete: (nombre: string) => {
        estado.borrados.push(nombre);
        estado.jar.delete(nombre);
      },
    }),
}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Redireccion(destino);
  },
  notFound: () => {
    throw noEncontrada();
  },
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    autenticacion: () => estado.mundo?.dependencias.autenticacion(),
    consultasDeSesion: () => estado.mundo?.dependencias.consultasDeSesion(),
    casosDeUsoDeIdentidad: () => estado.mundo?.dependencias.casosDeUsoDeIdentidad(),
    consultasDeEmpresas: () => estado.mundo?.dependencias.consultasDeEmpresas(),
  },
}));
vi.mock("../../apps/web/servidor/fuente-de-puertas", () => ({
  fuenteDePuertas: {
    consultarHost: (host: string, superficie: string) => {
      const m = estado.mundo;
      if (m === null) return Promise.resolve(ok(null));
      if (superficie !== "APP") return Promise.resolve(ok(null));
      if (host === HOST_A) return Promise.resolve(ok({ marcaId: m.marcaA }));
      if (host === HOST_B) return Promise.resolve(ok({ marcaId: m.marcaB }));
      return Promise.resolve(ok(null));
    },
    leerMarca: (marcaId: string) => {
      const nombre = estado.nombres.get(marcaId);
      return Promise.resolve(nombre === undefined ? null : { nombre, tema: {}, hostDeApp: null });
    },
  },
}));

type PropsDePagina = { searchParams: Promise<Record<string, string | string[] | undefined>> };
type Pagina = (props?: PropsDePagina) => unknown;

/**
 * Carga una página de la aplicación por ruta variable. Las páginas importan componentes de cliente que
 * usan el DOM, y el tsconfig de las pruebas (Node) no lo tiene: una importación estática arrastraría al
 * compilador hasta ellos. En ejecución es la misma importación.
 */
const cargar = (ruta: string): Promise<{ default: Pagina }> =>
  import(/* @vite-ignore */ ruta) as Promise<{ default: Pagina }>;

const base = inject("baseDePruebas");
const NOMBRE_A = "Hotel del Lago";
const NOMBRE_B = "Panadería Los Pinos";
const html = (nodo: unknown): string => renderToStaticMarkup(nodo as ReactNode);

/** Un pedido al servidor desde el navegador de `ingresado` en `host`: sus cookies y, si se pide, un `Origin`. */
function comoNavegador(host: string, origen: string | null = `https://${host}`): void {
  const cookies = [...estado.jar].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; ");
  estado.encabezados = new Headers({
    host,
    [ENCABEZADO_DE_IP]: ipUnica(),
    ...(cookies === "" ? {} : { cookie: cookies }),
    ...(origen === null ? {} : { origin: origen }),
  });
  estado.escrituras.length = 0;
  estado.borrados.length = 0;
}

/** Le da al «navegador» (la jarra de cookies) las cookies de la sesión que nació en `host`. */
function conSesionDe(ingresado: Ingresado, host: string): void {
  estado.jar.clear();
  for (const c of ingresado.navegador.cookiesDe(host)) {
    estado.jar.set(c.nombre, decodeURIComponent(c.valor));
  }
}

async function redirigeA(trabajo: () => unknown): Promise<string | null> {
  try {
    await trabajo();
    return null;
  } catch (e) {
    if (e instanceof Redireccion) return e.destino;
    throw e;
  }
}

describe.skipIf(base === null)("web: acciones, rutas y páginas de sesión y empresa", () => {
  let mundo: MundoWeb;
  let acciones: typeof ModuloDeAcciones;
  let renovar: typeof ModuloDeRenovacion;

  beforeAll(async () => {
    if (base === null) return;
    vi.stubEnv("VERCEL_ENV", "preview");
    mundo = await armarMundoWeb(base);
    estado.mundo = mundo;
    estado.nombres.set(mundo.marcaA, NOMBRE_A);
    estado.nombres.set(mundo.marcaB, NOMBRE_B);
    acciones = await import("../../apps/web/servidor/acciones");
    renovar = await import("../../apps/web/servidor/renovar-sesion");
  });
  afterAll(async () => {
    expect(mundo.proveedor.intentosExternos(), "nada salió a internet").toEqual([]);
    await mundo.cerrar();
    estado.mundo = null;
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    estado.jar.clear();
    estado.escrituras.length = 0;
    estado.borrados.length = 0;
    mundo.registros.length = 0;
  });

  const filasDeSesion = async (ingresado: Ingresado) =>
    (
      await mundo.dueno.query(`select 1 from autenticacion.session where "userId" = $1`, [
        ingresado.sesion.usuarioAuth,
      ])
    ).rowCount;

  describe("P-7: las acciones rechazan un origen de otro host y no cambian nada", () => {
    it.each([
      ["otro sitio", "https://sitio-malo.test"],
      ["el mismo nombre en http", `http://${HOST_A}`],
      ["el de la otra marca", `https://${HOST_B}`],
      ["null", "null"],
    ])(
      "con Origin de %s: SIN_PERMISO en cada acción, sin cookies ni cambios",
      async (_n, origen) => {
        const yo = await ingresarEn(mundo, HOST_A);
        const persona = await personaVinculada(mundo, yo.sesion);
        const e = await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE");
        const m = await crearMundoDeMarca(mundo.dueno, {
          marca: mundo.marcaA,
          estado: "PROVISIONING",
        });
        const { token } = await invitar(
          mundo,
          m.tenant,
          [{ empresa: m.empresa, rol: "GERENTE" }],
          yo.sesion.email,
          "ALTA_GERENTE",
        );
        conSesionDe(yo, HOST_A);
        comoNavegador(HOST_A, origen);

        const ingreso = await acciones.ingresarConGoogle(new FormData());
        const entrada = await acciones.entrarALaEmpresa(
          Object.assign(new FormData(), {}) &&
            (() => {
              const f = new FormData();
              f.set("empresaId", e.empresa);
              return f;
            })(),
        );
        const cierre = await acciones.cerrarLaSesion();
        const aceptacion = await acciones.aceptarLaInvitacion({ token, clave: "k" });

        for (const r of [ingreso, entrada, cierre]) {
          expect(r.error?.codigo).toBe("SIN_PERMISO");
        }
        expect(aceptacion).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
        expect(estado.escrituras).toEqual([]);
        expect(estado.borrados).toEqual([]);
        // La sesión sigue en la base y la invitación sin aceptar.
        expect(await filasDeSesion(yo)).toBe(1);
        expect(
          (
            await mundo.dueno.query("select estado from invitacion where token_hash = $1", [
              mundo.tokens.hash(token),
            ])
          ).rows[0],
        ).toEqual({ estado: "PENDIENTE" });
      },
    );

    it("en un host que no es de la aplicación, la acción es un «no existe» (404), no un fallo con referencia", async () => {
      comoNavegador("desconocido.test");
      const f = new FormData();
      f.set("empresaId", "x");
      for (const intento of [
        () => acciones.ingresarConGoogle(new FormData()),
        () => acciones.entrarALaEmpresa(f),
        () => acciones.cerrarLaSesion(),
        () => acciones.aceptarLaInvitacion({ token: "t", clave: "k" }),
      ]) {
        await expect(intento()).rejects.toSatisfy(esNoEncontrada);
      }
      expect(mundo.registros).toEqual([]);
    });

    it("sin Origin (un cliente que no es un navegador) se deja pasar: lo cubre SameSite=Lax", async () => {
      const yo = await ingresarEn(mundo, HOST_A);
      const persona = await personaVinculada(mundo, yo.sesion);
      const e = await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE");
      conSesionDe(yo, HOST_A);
      comoNavegador(HOST_A, null);
      const f = new FormData();
      f.set("empresaId", e.empresa);
      expect(await redirigeA(() => acciones.entrarALaEmpresa(f))).toBe("/");
    });

    it("la cookie de sesión es HttpOnly, Secure, SameSite=Lax y sin Domain (solo del host)", async () => {
      const yo = await ingresarEn(mundo, HOST_A);
      const cookie = yo.navegador.cookiesDe(HOST_A).find((c) => c.nombre.endsWith("session_token"));
      expect(cookie?.atributos).toMatch(/HttpOnly/i);
      expect(cookie?.atributos).toMatch(/Secure/i);
      expect(cookie?.atributos).toMatch(/SameSite=Lax/i);
      expect(cookie?.atributos).not.toMatch(/Domain=/i);
    });
  });

  describe("entrar a la empresa", () => {
    it("fija pd_empresa (HttpOnly, Secure, Lax, sin Domain) y vuelve al inicio", async () => {
      const yo = await ingresarEn(mundo, HOST_A);
      const persona = await personaVinculada(mundo, yo.sesion);
      const e = await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE");
      conSesionDe(yo, HOST_A);
      comoNavegador(HOST_A);
      const f = new FormData();
      f.set("empresaId", e.empresa);
      expect(await redirigeA(() => acciones.entrarALaEmpresa(f))).toBe("/");
      expect(estado.escrituras).toEqual([
        {
          nombre: "__Host-pd_empresa",
          valor: e.empresa,
          opciones: { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 2_592_000 },
        },
      ]);
    });

    it("una empresa de otra marca (o inventada) es SIN_PERMISO y no fija nada (P-1)", async () => {
      const yo = await ingresarEn(mundo, HOST_B);
      const persona = await personaVinculada(mundo, yo.sesion);
      const deA = await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE");
      conSesionDe(yo, HOST_B);
      for (const empresaId of [deA.empresa, "inventada", ""]) {
        comoNavegador(HOST_B);
        const f = new FormData();
        f.set("empresaId", empresaId);
        const r = await acciones.entrarALaEmpresa(f);
        expect(r.error?.codigo, empresaId).toBe("SIN_PERMISO");
        expect(estado.escrituras, empresaId).toEqual([]);
      }
      comoNavegador(HOST_B);
      expect((await acciones.entrarALaEmpresa(new FormData())).error?.codigo).toBe("SIN_PERMISO");
    });

    it("sin sesión: SESION_VENCIDA", async () => {
      comoNavegador(HOST_A);
      const f = new FormData();
      f.set("empresaId", "x");
      const r = await acciones.entrarALaEmpresa(f);
      expect(r.error?.codigo).toBe("SESION_VENCIDA");
    });

    it("CONCURRENCIA: doble toque en «Entrar a la empresa» = un solo efecto (la misma cookie, nada más)", async () => {
      const yo = await ingresarEn(mundo, HOST_A);
      const persona = await personaVinculada(mundo, yo.sesion);
      const e = await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE");
      conSesionDe(yo, HOST_A);
      comoNavegador(HOST_A);
      const antes = JSON.stringify(
        (await mundo.dueno.query("select * from membresia where empresa_id = $1", [e.empresa]))
          .rows,
      );
      const barrera = crearBarrera(2);
      const f = () => {
        const d = new FormData();
        d.set("empresaId", e.empresa);
        return d;
      };
      const destinos = await Promise.all(
        [0, 1].map(async () => {
          await barrera();
          return redirigeA(() => acciones.entrarALaEmpresa(f()));
        }),
      );
      expect(destinos).toEqual(["/", "/"]);
      expect(new Set(estado.escrituras.map((x) => `${x.nombre}=${x.valor}`))).toEqual(
        new Set([`__Host-pd_empresa=${e.empresa}`]),
      );
      expect(
        JSON.stringify(
          (await mundo.dueno.query("select * from membresia where empresa_id = $1", [e.empresa]))
            .rows,
        ),
      ).toBe(antes);
    });
  });

  describe("cerrar sesión (P-10)", () => {
    it("borra la fila, las cookies (sesión, empresa e invitación) y vuelve a /ingreso", async () => {
      const yo = await ingresarEn(mundo, HOST_A);
      const persona = await personaVinculada(mundo, yo.sesion);
      await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE");
      conSesionDe(yo, HOST_A);
      estado.jar.set("__Host-pd_empresa", "una-empresa");
      estado.jar.set("__Host-pd_invitacion", "un-token");
      comoNavegador(HOST_A);
      expect(await filasDeSesion(yo)).toBe(1);
      expect(await redirigeA(() => acciones.cerrarLaSesion())).toBe("/ingreso");
      expect(await filasDeSesion(yo)).toBe(0);
      // Las `__Host-` no se borran con `delete(nombre)` (sin `Secure` el navegador lo rechaza): se vencen vacías
      // y con los atributos con que se fijaron (el detalle exacto: test/web/cerrar-sesion-cookies.test.ts).
      expect(estado.borrados).toEqual([]);
      for (const nombre of ["__Host-pd_empresa", "__Host-pd_invitacion"]) {
        const vencida = estado.escrituras.find((x) => x.nombre === nombre);
        expect(vencida?.valor, nombre).toBe("");
        expect(vencida?.opciones, nombre).toMatchObject({
          maxAge: 0,
          secure: true,
          httpOnly: true,
          path: "/",
        });
        expect(vencida?.opciones["domain"], nombre).toBeUndefined();
      }
      // La cookie de sesión se escribió vacía y vencida (el navegador la borra).
      const sesion = estado.escrituras.find((x) => x.nombre.endsWith("session_token"));
      expect(sesion?.valor).toBe("");
      expect(sesion?.opciones["maxAge"]).toBe(0);
      expect(
        await mundo.auth.autenticacion.sesionDe(yo.navegador.pedidoDe(HOST_A), HOST_A),
      ).toBeNull();
    });
  });

  describe("ingresar con Google", () => {
    it("manda a Google con las cookies del estado, y vuelve a la ruta pedida (validada)", async () => {
      comoNavegador(HOST_A);
      const f = new FormData();
      f.set("volver", "/cuenta");
      const destino = await redirigeA(() => acciones.ingresarConGoogle(f));
      expect(destino).not.toBeNull();
      const url = new URL(destino as string);
      expect(url.hostname).toBe("accounts.google.com");
      expect(url.searchParams.get("redirect_uri")).toBe(
        `https://${HOST_A}/api/auth/callback/google`,
      );
      expect(estado.escrituras.length).toBeGreaterThan(0);
      expect(estado.escrituras.every((x) => x.opciones["httpOnly"] === true)).toBe(true);
      const guardado = await mundo.dueno.query<{ value: string }>(
        `select value from autenticacion.verification order by "createdAt" desc limit 1`,
      );
      expect(guardado.rows[0]?.value).toContain('"callbackURL":"/cuenta"');
    });

    it.each([
      "https://sitio-ajeno.test/",
      "//sitio-ajeno.test",
      "/\\sitio-ajeno.test",
      "/api/auth/sign-out",
    ])("una ruta de retorno ajena (%s) vuelve al inicio", async (volver) => {
      comoNavegador(HOST_A);
      const f = new FormData();
      f.set("volver", volver);
      await redirigeA(() => acciones.ingresarConGoogle(f));
      const guardado = await mundo.dueno.query<{ value: string }>(
        `select value from autenticacion.verification order by "createdAt" desc limit 1`,
      );
      expect(guardado.rows[0]?.value).toContain('"callbackURL":"/"');
    });

    it("con una invitación: el token queda en una cookie del servidor (no en la dirección de retorno) y vuelve a /invitacion", async () => {
      comoNavegador(HOST_A);
      const f = new FormData();
      f.set("invitacion", "token-de-la-invitacion");
      await redirigeA(() => acciones.ingresarConGoogle(f));
      const cookie = estado.escrituras.find((x) => x.nombre === "__Host-pd_invitacion");
      expect(cookie).toEqual({
        nombre: "__Host-pd_invitacion",
        valor: "token-de-la-invitacion",
        opciones: { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 900 },
      });
      const guardado = await mundo.dueno.query<{ value: string }>(
        `select value from autenticacion.verification order by "createdAt" desc limit 1`,
      );
      expect(guardado.rows[0]?.value).toContain('"callbackURL":"/invitacion"');
      expect(guardado.rows[0]?.value).not.toContain("token-de-la-invitacion");
    });
  });

  describe("aceptar la invitación", () => {
    it("acepta con la cuenta que ingresó, borra la cookie del enlace y solo devuelve lo que la pantalla muestra", async () => {
      const m = await crearMundoDeMarca(mundo.dueno, {
        marca: mundo.marcaA,
        estado: "PROVISIONING",
      });
      const email = emailAlAzar("gerente");
      const { token } = await invitar(
        mundo,
        m.tenant,
        [{ empresa: m.empresa, rol: "GERENTE" }],
        email,
        "ALTA_GERENTE",
      );
      const yo = await ingresarEn(mundo, HOST_A, perfilAlAzar({ email }));
      conSesionDe(yo, HOST_A);
      estado.jar.set("__Host-pd_invitacion", token);
      comoNavegador(HOST_A);
      const primera = await acciones.aceptarLaInvitacion({ token, clave: "intento-1" });
      expect(primera).toEqual({ ok: true, dato: { yaEstabaAceptada: false } });
      expect(estado.borrados).toEqual(["__Host-pd_invitacion"]);
      // Repetida (reintento con la MISMA clave, o con otra): el mismo resultado exitoso y una sola membresía.
      comoNavegador(HOST_A);
      const segunda = await acciones.aceptarLaInvitacion({ token, clave: "intento-1" });
      expect(segunda).toEqual({ ok: true, dato: { yaEstabaAceptada: true } });
      expect(
        (await mundo.dueno.query("select 1 from membresia where empresa_id = $1", [m.empresa]))
          .rowCount,
      ).toBe(1);
    });

    it("un error de negocio sale con su código; sin sesión, SESION_VENCIDA", async () => {
      const yo = await ingresarEn(mundo, HOST_A);
      conSesionDe(yo, HOST_A);
      comoNavegador(HOST_A);
      expect(await acciones.aceptarLaInvitacion({ token: "no-existe", clave: "k" })).toMatchObject({
        ok: false,
        error: { codigo: "INVITACION_NO_ENCONTRADA" },
      });
      estado.jar.clear();
      comoNavegador(HOST_A);
      expect(await acciones.aceptarLaInvitacion({ token: "x", clave: "k" })).toMatchObject({
        ok: false,
        error: { codigo: "SESION_VENCIDA" },
      });
    });

    it("CONCURRENCIA: dos toques a la vez en «Aceptar invitación» dejan una sola membresía", async () => {
      const m = await crearMundoDeMarca(mundo.dueno, {
        marca: mundo.marcaA,
        estado: "PROVISIONING",
      });
      const email = emailAlAzar("doble");
      const { token } = await invitar(
        mundo,
        m.tenant,
        [{ empresa: m.empresa, rol: "GERENTE" }],
        email,
        "ALTA_GERENTE",
      );
      const yo = await ingresarEn(mundo, HOST_A, perfilAlAzar({ email }));
      conSesionDe(yo, HOST_A);
      comoNavegador(HOST_A);
      const barrera = crearBarrera(2);
      const resultados = await Promise.all(
        [0, 1].map(async () => {
          await barrera();
          return acciones.aceptarLaInvitacion({ token, clave: "misma-clave" });
        }),
      );
      expect(resultados.some((r) => r.ok)).toBe(true);
      for (const r of resultados) if (!r.ok) expect(r.error.codigo).toBe("ERROR_INTERNO");
      expect(
        (await mundo.dueno.query("select 1 from membresia where empresa_id = $1", [m.empresa]))
          .rowCount,
      ).toBe(1);
    });
  });

  describe("la ruta de renovación (el «Seguir»)", () => {
    const pedido = (host: string, origen: string | null = `https://${host}`) =>
      new Request(`https://interno.test/api/sesion/renovar`, {
        method: "POST",
        headers: {
          ...Object.fromEntries(estado.encabezados),
          host,
          ...(origen === null ? {} : { origin: origen }),
        },
        body: "{}",
      });

    it("renueva y devuelve la cookie renovada; de otro origen, 403; sin sesión, 401", async () => {
      const yo = await ingresarEn(mundo, HOST_A);
      conSesionDe(yo, HOST_A);
      comoNavegador(HOST_A);
      const bien = await renovar.atenderRenovacion(pedido(HOST_A));
      expect(bien.status).toBe(200);
      expect(bien.headers.getSetCookie().some((c) => /session_token=.*Max-Age=900/i.test(c))).toBe(
        true,
      );
      const ajena = await renovar.atenderRenovacion(pedido(HOST_A, "https://sitio-malo.test"));
      expect(ajena.status).toBe(403);
      expect(ajena.headers.getSetCookie()).toEqual([]);
      estado.jar.clear();
      comoNavegador(HOST_A);
      expect((await renovar.atenderRenovacion(pedido(HOST_A))).status).toBe(401);
    });

    it("P-6: la cookie de A en el host B es 401; en un host desconocido, el 404 neutro", async () => {
      const yo = await ingresarEn(mundo, HOST_A);
      conSesionDe(yo, HOST_A);
      comoNavegador(HOST_B);
      const enB = await renovar.atenderRenovacion(pedido(HOST_B));
      expect(enB.status).toBe(401);
      expect(enB.headers.getSetCookie()).toEqual([]);
      comoNavegador("desconocido.test");
      const neutra = await renovar.atenderRenovacion(pedido("desconocido.test"));
      expect(neutra.status).toBe(404);
      expect(await neutra.text()).toBe("");
    });
  });

  describe("las páginas", () => {
    async function pagina<T>(host: string, ruta: string): Promise<T> {
      void host;
      return (await import(ruta)) as T;
    }
    void pagina;

    const consulta = (c: Record<string, string | string[] | undefined> = {}) => Promise.resolve(c);

    it("/ingreso sin sesión: el botón de Google, con el error traducido por clave (nunca el código técnico)", async () => {
      const { default: Ingreso } = await cargar("../../apps/web/app/s/app/(entrada)/ingreso/page");
      comoNavegador(HOST_A);
      const limpio = html(await Ingreso({ searchParams: consulta() }));
      expect(limpio).toContain("Ingresá a Hotel del Lago");
      expect(limpio).toContain("Ingresar con Google");
      expect(limpio).not.toContain('role="alert"');
      const conError = html(await Ingreso({ searchParams: consulta({ error: "access_denied" }) }));
      expect(conError).toContain("Cancelaste el ingreso con Google");
      expect(conError).not.toContain("access_denied");
      const raro = html(await Ingreso({ searchParams: consulta({ error: "<script>x</script>" }) }));
      expect(raro).toContain("No se pudo ingresar. Podés reintentar.");
      expect(raro).not.toContain("<script>x");
      const volver = html(
        await Ingreso({ searchParams: consulta({ volver: "https://ajeno.test" }) }),
      );
      expect(volver).toContain('name="volver" value="/"');
    });

    it("/ingreso con sesión vigente en ESTE host: sigue a donde iba; con la cookie de otro host (P-6): pantalla de ingreso", async () => {
      const { default: Ingreso } = await cargar("../../apps/web/app/s/app/(entrada)/ingreso/page");
      const yo = await ingresarEn(mundo, HOST_A);
      conSesionDe(yo, HOST_A);
      comoNavegador(HOST_A);
      expect(
        await redirigeA(() => Ingreso({ searchParams: consulta({ volver: "/cuenta" }) })),
      ).toBe("/cuenta");
      comoNavegador(HOST_B);
      const enB = html(await Ingreso({ searchParams: consulta() }));
      expect(enB).toContain("Ingresá a Panadería Los Pinos");
      expect(enB).not.toContain("Hotel del Lago");
    });

    it("/invitacion: sin enlace, sin sesión (token en el formulario) y con sesión (aceptar)", async () => {
      const { default: Invitacion } = await cargar(
        "../../apps/web/app/s/app/(entrada)/invitacion/page",
      );
      comoNavegador(HOST_A);
      expect(html(await Invitacion({ searchParams: consulta() }))).toContain(
        "Falta el enlace de la invitación",
      );
      const sinSesion = html(await Invitacion({ searchParams: consulta({ t: "tok-123" }) }));
      expect(sinSesion).toContain("primero ingresá con la cuenta de Google");
      expect(sinSesion).toContain('name="invitacion" value="tok-123"');
      // El token también puede venir de la cookie del servidor (después de pasar por Google).
      estado.jar.set("__Host-pd_invitacion", "tok-cookie");
      comoNavegador(HOST_A);
      expect(html(await Invitacion({ searchParams: consulta() }))).toContain('value="tok-cookie"');
      const yo = await ingresarEn(mundo, HOST_A);
      conSesionDe(yo, HOST_A);
      comoNavegador(HOST_A);
      const conSesion = html(await Invitacion({ searchParams: consulta({ t: "tok-123" }) }));
      expect(conSesion).toContain("Aceptar invitación");
      // Abrir la página NO acepta nada: no hay ninguna escritura.
      expect(estado.escrituras).toEqual([]);
      // Un token enorme es como si no hubiera enlace.
      expect(html(await Invitacion({ searchParams: consulta({ t: "x".repeat(600) }) }))).toContain(
        "Falta el enlace de la invitación",
      );
    });

    it("/empresa: SOLO las empresas de la marca del host, o el vacío con el texto de la marca (P-1)", async () => {
      const { default: Empresa } = await cargar("../../apps/web/app/s/app/(entrada)/empresa/page");
      const enA = await ingresarEn(mundo, HOST_A);
      const persona = await personaVinculada(mundo, enA.sesion);
      const deA1 = await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE");
      const deA2 = await empresaDeLaMarca(mundo, mundo.marcaA, persona, "OPERADOR");
      const deB = await empresaDeLaMarca(mundo, mundo.marcaB, persona, "GERENTE");
      conSesionDe(enA, HOST_A);
      comoNavegador(HOST_A);
      const paginaA = html(await Empresa());
      for (const id of [deA1.empresa, deA2.empresa]) expect(paginaA).toContain(id);
      expect(paginaA).not.toContain(deB.empresa);
      expect(paginaA).not.toContain(NOMBRE_B);
      expect(paginaA).toContain("Entrar a la empresa");
      expect(paginaA).toContain("Gerente");
      expect(paginaA).toContain("Operador");

      // La misma persona por B ve solo la suya; otra persona sin vínculo, el vacío.
      const enB = await ingresarEn(mundo, HOST_B, enA.perfil);
      conSesionDe(enB, HOST_B);
      comoNavegador(HOST_B);
      const paginaB = html(await Empresa());
      expect(paginaB).toContain(deB.empresa);
      expect(paginaB).not.toContain(deA1.empresa);
      expect(paginaB).not.toContain(NOMBRE_A);

      const sinNada = await ingresarEn(mundo, HOST_A);
      conSesionDe(sinNada, HOST_A);
      comoNavegador(HOST_A);
      const vacia = html(await Empresa());
      expect(vacia).toContain(
        "No tenés empresas en Hotel del Lago. Si te invitaron, abrí el enlace del mail.",
      );
      expect(vacia).toContain("Cerrar sesión");
    });

    it("/empresa sin sesión (o con la sesión vencida): a ingresar", async () => {
      const { default: Empresa } = await cargar("../../apps/web/app/s/app/(entrada)/empresa/page");
      comoNavegador(HOST_A);
      expect(await redirigeA(() => Empresa())).toBe("/ingreso");
      const yo = await ingresarEn(mundo, HOST_A);
      conSesionDe(yo, HOST_A);
      await mundo.dueno.query(
        `update autenticacion.session set "expiresAt" = now() - interval '1 minute' where "userId" = $1`,
        [yo.sesion.usuarioAuth],
      );
      comoNavegador(HOST_A);
      expect(await redirigeA(() => Empresa())).toBe("/ingreso");
    });

    it("/ (inicio): una empresa entra directo; varias mandan a elegir; ninguna, también; la cookie de otra marca, sin permiso", async () => {
      const { default: Inicio } = await cargar("../../apps/web/app/s/app/(operacion)/page");
      const yo = await ingresarEn(mundo, HOST_A);
      const persona = await personaVinculada(mundo, yo.sesion);
      const e1 = await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE");
      conSesionDe(yo, HOST_A);
      comoNavegador(HOST_A);
      const directo = html(await Inicio());
      expect(directo).toContain("Estás en");
      expect(directo).toContain("Hotel del Lago");
      expect(directo).toContain("No hay nada pendiente por ahora.");
      expect(directo).toContain("Sesión activa");
      expect(directo).not.toContain(NOMBRE_B);
      // Tres destinos: inicio, empresa y cuenta; el actual marcado.
      expect(directo).toContain('aria-current="page"');
      expect([...directo.matchAll(/<li class="[^"]*destino/g)]).toHaveLength(3);

      // Con una segunda empresa y sin cookie: a elegir.
      await empresaDeLaMarca(mundo, mundo.marcaA, persona, "OPERADOR");
      comoNavegador(HOST_A);
      expect(await redirigeA(() => Inicio())).toBe("/empresa");
      // Con la cookie de la primera: entra a esa.
      estado.jar.set("__Host-pd_empresa", e1.empresa);
      comoNavegador(HOST_A);
      expect(html((await Inicio()) as ReactNode)).toContain("Estás en");

      // La cookie de una empresa de la otra marca: «sin permiso», nada de la otra marca.
      const deB = await empresaDeLaMarca(mundo, mundo.marcaB, persona, "GERENTE");
      estado.jar.set("__Host-pd_empresa", deB.empresa);
      comoNavegador(HOST_A);
      const sinPermiso = html(await Inicio());
      expect(sinPermiso).toContain("Sin permiso");
      expect(sinPermiso).toContain("No tiene permiso para hacer esto.");
      expect(sinPermiso).toContain("Cambiar de empresa");
      expect(sinPermiso).not.toContain(deB.empresa);
      expect(sinPermiso).not.toContain(NOMBRE_B);
    });

    it("el layout del mostrador sin sesión, o con la cookie de otro host (P-6), manda a /ingreso; con sesión vigente, envuelve", async () => {
      const { default: Pagina } = await cargar("../../apps/web/app/s/app/(operacion)/layout");
      const Layout = Pagina as unknown as (props: { children: ReactNode }) => unknown;
      const hijos = "contenido del mostrador";
      comoNavegador(HOST_A);
      expect(await redirigeA(() => Layout({ children: hijos }))).toBe("/ingreso");
      const yo = await ingresarEn(mundo, HOST_A);
      // La cookie de A viaja al host B (lo que haría quien la copia): no vale.
      conSesionDe(yo, HOST_A);
      comoNavegador(HOST_B);
      expect(await redirigeA(() => Layout({ children: hijos }))).toBe("/ingreso");
      comoNavegador(HOST_A);
      expect(html(await Layout({ children: hijos }))).toContain(hijos);
    });

    it("/ sin sesión: a ingresar; con una persona sin empresas: a elegir (donde está el vacío)", async () => {
      const { default: Inicio } = await cargar("../../apps/web/app/s/app/(operacion)/page");
      comoNavegador(HOST_A);
      expect(await redirigeA(() => Inicio())).toBe("/ingreso");
      const yo = await ingresarEn(mundo, HOST_A);
      conSesionDe(yo, HOST_A);
      comoNavegador(HOST_A);
      expect(await redirigeA(() => Inicio())).toBe("/empresa");
    });

    it("una empresa suspendida entra, pero el inicio dice por qué no opera", async () => {
      const { default: Inicio } = await cargar("../../apps/web/app/s/app/(operacion)/page");
      const yo = await ingresarEn(mundo, HOST_A);
      const persona = await personaVinculada(mundo, yo.sesion);
      await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE", { estado: "SUSPENDED" });
      conSesionDe(yo, HOST_A);
      comoNavegador(HOST_A);
      expect(html((await Inicio()) as ReactNode)).toContain("La empresa está suspendida.");
    });

    it("/cuenta: el gerente ve sus sucursales; el operador no ve el selector; ninguno ve datos de la otra marca", async () => {
      const { default: Cuenta } = await cargar("../../apps/web/app/s/app/(operacion)/cuenta/page");
      const gerente = await ingresarEn(mundo, HOST_A);
      const personaG = await personaVinculada(mundo, gerente.sesion);
      const eG = await empresaDeLaMarca(mundo, mundo.marcaA, personaG, "GERENTE");
      await mundo.dueno.query(
        "insert into sucursal (empresa_id, nombre) values ($1, 'Sucursal Norte')",
        [eG.empresa],
      );
      conSesionDe(gerente, HOST_A);
      comoNavegador(HOST_A);
      const paginaG = html(await Cuenta());
      expect(paginaG).toContain("Casa central");
      expect(paginaG).toContain("Sucursal Norte");
      expect(paginaG).toContain("Cerrar sesión");
      expect(paginaG).toContain("Gerente");

      const operador = await ingresarEn(mundo, HOST_A);
      const personaO = await personaVinculada(mundo, operador.sesion);
      await empresaDeLaMarca(mundo, mundo.marcaA, personaO, "OPERADOR");
      conSesionDe(operador, HOST_A);
      comoNavegador(HOST_A);
      const paginaO = html(await Cuenta());
      expect(paginaO).not.toContain("Casa central");
      expect(paginaO).toContain("Operador");
    });

    it("un fallo de la base en una página sale con referencia y sin detalle; el detalle va al registro", async () => {
      const { default: Inicio } = await cargar("../../apps/web/app/s/app/(operacion)/page");
      const yo = await ingresarEn(mundo, HOST_A);
      const persona = await personaVinculada(mundo, yo.sesion);
      await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE");
      conSesionDe(yo, HOST_A);
      comoNavegador(HOST_A);
      const original = estado.mundo;
      const registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
      estado.mundo = {
        ...mundo,
        dependencias: {
          ...mundo.dependencias,
          consultasDeSesion: () => {
            throw new Error("password authentication failed for user pedernal_app");
          },
        },
      };
      try {
        const cuerpo = html(await Inicio());
        expect(cuerpo).toContain("No se pudo completar. Podés reintentar");
        expect(cuerpo).toMatch(/Referencia: PD-[0-9A-F]{4}-[0-9A-F]{4}/);
        expect(cuerpo).not.toMatch(/password|pedernal_app/);
        // El detalle fue al registro del servidor (la salida de errores de la función), con la misma referencia.
        const registrado = registro.mock.calls.map((c) => String(c[0]));
        const referencia = /PD-[0-9A-F]{4}-[0-9A-F]{4}/.exec(cuerpo)?.[0] as string;
        expect(
          registrado.some(
            (r) => r.includes(referencia) && r.includes("password authentication failed"),
          ),
        ).toBe(true);
      } finally {
        registro.mockRestore();
        estado.mundo = original;
      }
    });
  });

  describe("el 404 de la aplicación", () => {
    it("lleva la marca de ESTE host y nada de la otra", async () => {
      const { default: NoEncontrada } = await cargar("../../apps/web/app/s/app/not-found");
      comoNavegador(HOST_A);
      const cuerpo = html(await NoEncontrada());
      expect(cuerpo).toContain("Hotel del Lago");
      expect(cuerpo).toContain("No encontrado");
      expect(cuerpo).not.toContain(NOMBRE_B);
    });
  });
});
