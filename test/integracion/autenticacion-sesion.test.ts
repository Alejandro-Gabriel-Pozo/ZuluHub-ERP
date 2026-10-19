import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearBaseAparte } from "./entorno";
import {
  Navegador,
  armarAutenticacionDePrueba,
  levantarProveedorLocal,
  perfilAlAzar,
  type AutenticacionDePrueba,
  type PerfilDePrueba,
  type ProveedorLocal,
} from "./autenticacion-ingreso-apoyo";

/**
 * Autenticación (W3b): la sesión. Atada al host (G4, P-6: una cookie de la marca A no vale en la B), vencimiento
 * de 15 minutos sin uso (decisión del dueño) y tope de 8 horas aunque haya actividad (G5), renovación en cada uso,
 * revocación inmediata y cierre de sesión. El paso del tiempo se simula moviendo las fechas de la fila en la base
 * (como el spike del ADR-013) y, para el reloj de la decisión, con un reloj inyectado.
 */

const base = inject("baseDePruebas");
const HOST_A = "app.marca-a.test";
const HOST_B = "app.marca-b.test";
const MINUTO = 60_000;

describe.skipIf(base === null)(
  "autenticación: la sesión por host, su vencimiento y su cierre",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let proveedor: ProveedorLocal;
    let a: AutenticacionDePrueba;
    let dueno: pg.Client;

    type Fila = {
      id: string;
      host: string;
      createdAt: Date;
      updatedAt: Date;
      expiresAt: Date;
      token: string;
    };

    async function ingresado(host = HOST_A, perfil: PerfilDePrueba = perfilAlAzar()) {
      const n = new Navegador();
      const r = await n.ingresarConGoogle(a.autenticacion, host, proveedor, perfil);
      expect(r.estado).toBe(302);
      expect(r.ubicacion).toBe("/");
      return { n, perfil };
    }
    async function filaDe(n: Navegador, host = HOST_A): Promise<Fila | undefined> {
      const cookie = n.cookiesDe(host).find((c) => c.nombre.endsWith("session_token"));
      const token = decodeURIComponent(cookie?.valor ?? "").split(".")[0];
      const { rows } = await dueno.query<Fila>(
        `select * from autenticacion.session where token = $1`,
        [token],
      );
      return rows[0];
    }
    /** Mueve las fechas de la sesión: cada una en minutos respecto de AHORA (negativo = hace tanto). */
    async function moverFechas(
      n: Navegador,
      fechas: { creada?: number; usada?: number; vence?: number },
      host = HOST_A,
    ): Promise<void> {
      const fila = await filaDe(n, host);
      const en = (m: number) => `now() + interval '${m * 60} seconds'`;
      const cambios = [
        ...(fechas.creada === undefined ? [] : [`"createdAt" = ${en(fechas.creada)}`]),
        ...(fechas.usada === undefined ? [] : [`"updatedAt" = ${en(fechas.usada)}`]),
        ...(fechas.vence === undefined ? [] : [`"expiresAt" = ${en(fechas.vence)}`]),
      ];
      await dueno.query(`update autenticacion.session set ${cambios.join(", ")} where id = $1`, [
        fila?.id,
      ]);
    }
    const sesionDe = (n: Navegador, host = HOST_A) =>
      a.autenticacion.sesionDe(n.pedidoDe(host), host);

    beforeAll(async () => {
      if (base === null) return;
      vi.stubEnv("NODE_ENV", "production");
      propia = await crearBaseAparte(base);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      proveedor = await levantarProveedorLocal();
      a = armarAutenticacionDePrueba(propia.base, proveedor);
    });
    afterAll(async () => {
      expect(proveedor.intentosExternos(), "nada salió a internet").toEqual([]);
      await a.cerrar();
      await dueno.end();
      await proveedor.cerrar();
      await propia.destruir();
      vi.unstubAllEnvs();
    });

    describe("sesión atada al host (G4, P-6)", () => {
      it("la cookie de la marca A reenviada al host de la marca B no vale; en A, sí", async () => {
        const { n } = await ingresado(HOST_A);
        expect(await sesionDe(n, HOST_A)).not.toBeNull();

        const ladron = new Navegador();
        n.copiarCookiesA(ladron, HOST_A, HOST_B);
        expect(await a.autenticacion.sesionDe(ladron.pedidoDe(HOST_B), HOST_B)).toBeNull();
        // La misma cookie, en el host donde nació, sigue valiendo.
        expect(await sesionDe(n, HOST_A)).not.toBeNull();
      });

      it("tampoco en la ruta de la propia librería: get-session en B con la cookie de A responde 401", async () => {
        const { n } = await ingresado(HOST_A);
        const ladron = new Navegador();
        n.copiarCookiesA(ladron, HOST_A, HOST_B);
        for (const ruta of ["/api/auth/get-session", "/api/auth/get-session?disableRefresh=true"]) {
          const r = await ladron.pedir(a.autenticacion, HOST_B, "GET", ruta);
          expect(r.estado, ruta).toBe(401);
          expect(r.json(), ruta).toEqual({ codigo: "SESION_NO_VIGENTE" });
          expect(r.cabeceras.getSetCookie(), ruta).toEqual([]);
        }
      });

      it("el intento desde otro host no toca la sesión: ni la renueva ni la borra", async () => {
        const { n } = await ingresado(HOST_A);
        await moverFechas(n, { usada: -5, vence: 10 });
        const antes = await filaDe(n);
        const ladron = new Navegador();
        n.copiarCookiesA(ladron, HOST_A, HOST_B);
        await a.autenticacion.sesionDe(ladron.pedidoDe(HOST_B), HOST_B);
        await ladron.pedir(a.autenticacion, HOST_B, "GET", "/api/auth/get-session");
        await ladron.pedir(
          a.autenticacion,
          HOST_B,
          "GET",
          "/api/auth/get-session?disableRefresh=true",
        );
        const despues = await filaDe(n);
        expect(despues).toEqual(antes);
      });

      it("la misma persona ingresa en las dos marcas por separado: dos sesiones, una por host, cada cookie solo en el suyo", async () => {
        const perfil = perfilAlAzar();
        const enA = await ingresado(HOST_A, perfil);
        const enB = await ingresado(HOST_B, perfil);
        const { rows } = await dueno.query<{ host: string }>(
          `select s.host from autenticacion.session s join autenticacion."user" u on u.id = s."userId"
          where u.email = $1 order by s.host`,
          [perfil.email],
        );
        expect(rows.map((f) => f.host)).toEqual([HOST_A, HOST_B]);
        const usuarios = await dueno.query(`select 1 from autenticacion."user" where email = $1`, [
          perfil.email,
        ]);
        expect(usuarios.rowCount).toBe(1);
        // Cruzadas, ninguna vale.
        const cruzado = new Navegador();
        enA.n.copiarCookiesA(cruzado, HOST_A, HOST_B);
        expect(await a.autenticacion.sesionDe(cruzado.pedidoDe(HOST_B), HOST_B)).toBeNull();
        const cruzado2 = new Navegador();
        enB.n.copiarCookiesA(cruzado2, HOST_B, HOST_A);
        expect(await a.autenticacion.sesionDe(cruzado2.pedidoDe(HOST_A), HOST_A)).toBeNull();
        // Cada una en el suyo, sí; y cerrar la de A no cierra la de B.
        expect(await sesionDe(enA.n, HOST_A)).not.toBeNull();
        expect(await sesionDe(enB.n, HOST_B)).not.toBeNull();
        await enA.n.pedir(a.autenticacion, HOST_A, "POST", "/api/auth/sign-out");
        expect(await sesionDe(enA.n, HOST_A)).toBeNull();
        expect(await sesionDe(enB.n, HOST_B)).not.toBeNull();
      });

      it("lo que decide es el host guardado en la base, no la cookie: si la fila dice otro host, la cookie no vale", async () => {
        const { n } = await ingresado(HOST_A);
        const fila = await filaDe(n);
        await dueno.query(`update autenticacion.session set host = $2 where id = $1`, [
          fila?.id,
          HOST_B,
        ]);
        expect(await sesionDe(n, HOST_A)).toBeNull();
        const enB = new Navegador();
        n.copiarCookiesA(enB, HOST_A, HOST_B);
        expect(await a.autenticacion.sesionDe(enB.pedidoDe(HOST_B), HOST_B)).not.toBeNull();
      });
    });

    describe("15 minutos sin uso", () => {
      it("a los 14 minutos sigue vigente y el uso renueva el vencimiento a 15 minutos desde ahora", async () => {
        const { n } = await ingresado();
        await moverFechas(n, { usada: -14, vence: 1 });
        const s = await sesionDe(n);
        expect(s).not.toBeNull();
        const fila = await filaDe(n);
        const hastaElVencimiento = (fila?.expiresAt.getTime() ?? 0) - Date.now();
        expect(hastaElVencimiento).toBeGreaterThan(15 * MINUTO - 5000);
        expect(hastaElVencimiento).toBeLessThanOrEqual(15 * MINUTO);
        expect(Date.now() - (fila?.updatedAt.getTime() ?? 0)).toBeLessThan(5000);
        // La respuesta lleva la cookie renovada para que el navegador la fije.
        expect(s?.cookiesDeRespuesta.join("\n")).toMatch(/session_token=.*Max-Age=900/);
        expect(s?.venceEn.getTime()).toBe(fila?.expiresAt.getTime());
      });

      it("a los 16 minutos sin uso está vencida: no hay sesión (y get-session responde 401 y borra la fila)", async () => {
        const { n } = await ingresado();
        await moverFechas(n, { usada: -16, vence: -1 });
        expect(await sesionDe(n)).toBeNull();
        const n2 = (await ingresado()).n;
        await moverFechas(n2, { usada: -16, vence: -1 });
        const r = await n2.pedir(a.autenticacion, HOST_A, "GET", "/api/auth/get-session");
        expect(r.estado).toBe(401);
        expect(r.json()).toEqual({ codigo: "SESION_NO_VIGENTE" });
        expect(await filaDe(n2)).toBeUndefined();
      });

      it("aunque el vencimiento guardado siga en el futuro, 16 minutos sin uso la vencen (no se confía en una sola fecha)", async () => {
        const { n } = await ingresado();
        await moverFechas(n, { usada: -16, vence: 10 });
        expect(await sesionDe(n)).toBeNull();
      });

      it("y al revés: si el vencimiento guardado ya pasó, no vale aunque el último uso sea reciente", async () => {
        const { n } = await ingresado();
        await moverFechas(n, { usada: -1, vence: -1 });
        expect(await sesionDe(n)).toBeNull();
      });

      it("el reloj que decide es el inyectado: adelantado 16 minutos, la sesión recién creada está vencida", async () => {
        let desfase = 0;
        const conReloj = armarAutenticacionDePrueba(propia.base, proveedor, {
          reloj: () => new Date(Date.now() + desfase),
        });
        try {
          const n = new Navegador();
          await n.ingresarConGoogle(conReloj.autenticacion, HOST_A, proveedor, perfilAlAzar());
          expect(await conReloj.autenticacion.sesionDe(n.pedidoDe(HOST_A), HOST_A)).not.toBeNull();
          desfase = 16 * MINUTO;
          expect(await conReloj.autenticacion.sesionDe(n.pedidoDe(HOST_A), HOST_A)).toBeNull();
        } finally {
          await conReloj.cerrar();
        }
      });
    });

    describe("8 horas absolutas (G5)", () => {
      it("a las 8 h 01 de creada está vencida aunque haya actividad ahora mismo", async () => {
        const { n } = await ingresado();
        await moverFechas(n, { creada: -(8 * 60 + 1), usada: 0, vence: 10 });
        expect(await sesionDe(n)).toBeNull();
      });

      it("tampoco se la puede resucitar por get-session, ni con disableRefresh", async () => {
        const { n } = await ingresado();
        await moverFechas(n, { creada: -(8 * 60 + 1), usada: 0, vence: 10 });
        const r = await n.pedir(
          a.autenticacion,
          HOST_A,
          "GET",
          "/api/auth/get-session?disableRefresh=true",
        );
        expect(r.estado).toBe(401);
        expect(await filaDe(n)).toBeUndefined();
      });

      it("a las 7 h 50 con actividad sigue vigente pero su vencimiento se corta en las 8 horas de creada", async () => {
        const { n } = await ingresado();
        await moverFechas(n, { creada: -(7 * 60 + 50), usada: -1, vence: 14 });
        const s = await sesionDe(n);
        expect(s).not.toBeNull();
        const fila = await filaDe(n);
        const tope = (fila?.createdAt.getTime() ?? 0) + 8 * 60 * MINUTO;
        expect(fila?.expiresAt.getTime()).toBe(tope);
        expect(s?.venceEn.getTime()).toBe(tope);
        // Y usarla otra vez no la corre más allá del tope.
        await sesionDe(n);
        expect((await filaDe(n))?.expiresAt.getTime()).toBe(tope);
      });

      it("a las 7 h 59 min 55 s sigue vigente; el uso no estira el vencimiento más de 5 segundos", async () => {
        const { n } = await ingresado();
        await dueno.query(
          `update autenticacion.session set "createdAt" = now() - interval '${8 * 3600 - 5} seconds',
                "updatedAt" = now(), "expiresAt" = now() + interval '10 minutes' where id = $1`,
          [(await filaDe(n))?.id],
        );
        expect(await sesionDe(n)).not.toBeNull();
        const fila = await filaDe(n);
        expect((fila?.expiresAt.getTime() ?? 0) - Date.now()).toBeLessThanOrEqual(5000);
      });
    });

    describe("cerrar sesión y revocar", () => {
      it("cerrar sesión borra la fila, borra la cookie y la sesión deja de valer; repetirlo no falla", async () => {
        const { n } = await ingresado();
        const copia = new Navegador();
        n.copiarCookiesA(copia, HOST_A, HOST_A);
        const fila = await filaDe(n);
        const r = await n.pedir(a.autenticacion, HOST_A, "POST", "/api/auth/sign-out");
        expect(r.estado).toBe(200);
        expect(r.cabeceras.getSetCookie().join("\n")).toMatch(/session_token=;.*Max-Age=0/);
        expect(n.cookiesDe(HOST_A)).toEqual([]);
        const { rows } = await dueno.query(`select 1 from autenticacion.session where id = $1`, [
          fila?.id,
        ]);
        expect(rows).toEqual([]);
        // Quien tenía copiada la cookie tampoco entra: la revocación es inmediata.
        expect(await a.autenticacion.sesionDe(copia.pedidoDe(HOST_A), HOST_A)).toBeNull();
        const otra = await n.pedir(a.autenticacion, HOST_A, "POST", "/api/auth/sign-out");
        expect(otra.estado).toBe(200);
      });

      it("borrar la fila en la base corta la sesión en el pedido siguiente (sin caché de sesión)", async () => {
        const { n } = await ingresado();
        expect(await sesionDe(n)).not.toBeNull();
        await dueno.query(`delete from autenticacion.session where id = $1`, [
          (await filaDe(n))?.id,
        ]);
        expect(await sesionDe(n)).toBeNull();
      });

      it("si el email del usuario deja de estar verificado en la base, la sesión deja de valer", async () => {
        const { n, perfil } = await ingresado();
        expect(await sesionDe(n)).not.toBeNull();
        await dueno.query(
          `update autenticacion."user" set "emailVerified" = false where email = $1`,
          [perfil.email],
        );
        expect(await sesionDe(n)).toBeNull();
      });
    });

    describe("cookies que no son de ninguna sesión", () => {
      it("sin cookie, con la firma alterada, sin firma o con un token que no existe: no hay sesión", async () => {
        const { n } = await ingresado();
        const cookie = n.cookiesDe(HOST_A).find((c) => c.nombre.endsWith("session_token"));
        const valor = decodeURIComponent(cookie?.valor ?? "");
        const [token = "", firma = ""] = valor.split(".");
        const pedido = (v: string | null) => ({
          headers: new Headers(
            v === null ? {} : { cookie: `${cookie?.nombre}=${encodeURIComponent(v)}` },
          ),
        });
        expect(await a.autenticacion.sesionDe(pedido(null), HOST_A)).toBeNull();
        expect(
          await a.autenticacion.sesionDe(pedido(`${token}.${firma.slice(0, -4)}AAAA`), HOST_A),
        ).toBeNull();
        expect(await a.autenticacion.sesionDe(pedido(token), HOST_A)).toBeNull();
        expect(await a.autenticacion.sesionDe(pedido(`inventado.${firma}`), HOST_A)).toBeNull();
        expect(await a.autenticacion.sesionDe(pedido(""), HOST_A)).toBeNull();
        // La verdadera sigue andando.
        expect(await a.autenticacion.sesionDe(pedido(valor), HOST_A)).not.toBeNull();
      });

      it("una cookie firmada con el secreto de otra instalación no vale aunque el token exista", async () => {
        const { n } = await ingresado();
        const otra = armarAutenticacionDePrueba(propia.base, proveedor);
        try {
          expect(await otra.autenticacion.sesionDe(n.pedidoDe(HOST_A), HOST_A)).toBeNull();
        } finally {
          await otra.cerrar();
        }
      });

      it("la cookie de sesión de un prefijo distinto (la de la consola, por ejemplo) no se toma por la de la aplicación", async () => {
        const { n } = await ingresado();
        const cookie = n.cookiesDe(HOST_A)[0];
        const renombrada = {
          headers: new Headers({ cookie: `__Host-zh_plat.session_token=${cookie?.valor}` }),
        };
        expect(await a.autenticacion.sesionDe(renombrada, HOST_A)).toBeNull();
      });
    });
  },
);
