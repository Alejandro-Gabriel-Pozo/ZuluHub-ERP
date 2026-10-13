import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearBaseAparte } from "./entorno";
import {
  Navegador,
  armarAutenticacionDePrueba,
  levantarProveedorLocal,
  perfilAlAzar,
  type AutenticacionDePrueba,
  type ProveedorLocal,
} from "./autenticacion-ingreso-apoyo";

/**
 * Autenticación (W3b): concurrencia REAL del ingreso y de la sesión, con una barrera: el proveedor local retiene
 * los pedidos al punto del token hasta que llegaron todos y los suelta juntos, así que TODOS los ingresos están
 * en el mismo punto (después de leer, antes de escribir) cuando empiezan a escribir. Se afirma la regla de fondo:
 * una sola cuenta y un solo usuario por identidad de Google, ninguna sesión duplicada ni huérfana, y cada pedido
 * termina en una respuesta TIPADA (la sesión abierta o una vuelta a la pantalla de ingreso con un código de la
 * lista cerrada). Perder la carrera es legítimo («probá de nuevo»); lo que no vale es un duplicado ni un fallo
 * sin nombre.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const HOST_A = "app.marca-a.test";
const HOST_B = "app.marca-b.test";
const RONDAS = 6;
const SIMULTANEOS = 8;
const CODIGOS_TIPADOS = new Set([
  "unable_to_create_user",
  "unable_to_link_account",
  "unable_to_create_session",
  "internal_server_error",
]);

describe.skipIf(base === null)("autenticación: concurrencia del ingreso y de la sesión", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let proveedor: ProveedorLocal;
  let a: AutenticacionDePrueba;
  let dueno: pg.Client;

  const n = async (texto: string, parametros: unknown[] = []): Promise<number> =>
    Number((await dueno.query<{ n: string }>(texto, parametros)).rows[0]?.n);

  /** Todos los pedidos de la ronda: una respuesta tipada (éxito o vuelta al ingreso con código conocido). */
  function tipada(ubicacion: string | null): "exito" | "perdio" {
    if (ubicacion === "/") return "exito";
    const codigo = /^\/ingreso\?error=(.+)$/.exec(ubicacion ?? "")?.[1];
    expect(CODIGOS_TIPADOS.has(codigo ?? ""), `código no tipado: ${ubicacion}`).toBe(true);
    return "perdio";
  }

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

  it(`${SIMULTANEOS} primeros ingresos simultáneos de la MISMA identidad: un usuario, una cuenta, y toda sesión abierta tiene dueño`, async () => {
    let ganadores = 0;
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const perfil = perfilAlAzar();
      // Cada navegador empieza su ingreso (el estado queda en la base) y recién ahí se suelta el retorno de todos.
      const navegadores = Array.from({ length: SIMULTANEOS }, () => new Navegador());
      const rutas = await Promise.all(
        navegadores.map((nav) => nav.empezarIngreso(a.autenticacion, HOST_A, proveedor, perfil)),
      );
      proveedor.retenerTokenHasta(SIMULTANEOS);
      const respuestas = await Promise.all(
        navegadores.map((nav, i) => nav.pedir(a.autenticacion, HOST_A, "GET", rutas[i] as string)),
      );
      const resultados = respuestas.map((r) => {
        expect(r.estado).toBe(302);
        return tipada(r.ubicacion);
      });
      const exitos = resultados.filter((x) => x === "exito").length;
      ganadores += exitos;

      // La regla de fondo.
      expect(
        await n(`select count(*) as n from autenticacion."user" where email = $1`, [perfil.email]),
      ).toBe(1);
      expect(
        await n(`select count(*) as n from autenticacion.account where "accountId" = $1`, [
          perfil.sub,
        ]),
      ).toBe(1);
      // Una sesión por cada ingreso que dijo «entraste» (ni de más ni de menos) y todas del único usuario.
      expect(
        await n(
          `select count(*) as n from autenticacion.session s join autenticacion."user" u on u.id = s."userId" where u.email = $1`,
          [perfil.email],
        ),
      ).toBe(exitos);
      expect(exitos).toBeGreaterThanOrEqual(1);
      // Cada ganador tiene una sesión que vale.
      for (let i = 0; i < navegadores.length; i++) {
        if (resultados[i] === "exito") {
          expect(
            await a.autenticacion.sesionDe(navegadores[i]!.pedidoDe(HOST_A), HOST_A),
          ).not.toBeNull();
        } else {
          expect(navegadores[i]!.cookiesDe(HOST_A)).toEqual([]);
        }
      }
    }
    expect(ganadores).toBeGreaterThanOrEqual(RONDAS);
  });

  it(`${SIMULTANEOS} ingresos simultáneos de una identidad que ya existe: todos entran, cada uno con su sesión, sin duplicar nada`, async () => {
    const perfil = perfilAlAzar();
    await new Navegador().ingresarConGoogle(a.autenticacion, HOST_A, proveedor, perfil);
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const antes = await n(
        `select count(*) as n from autenticacion.session s join autenticacion."user" u on u.id = s."userId" where u.email = $1`,
        [perfil.email],
      );
      const navegadores = Array.from({ length: SIMULTANEOS }, () => new Navegador());
      const rutas = await Promise.all(
        navegadores.map((nav) => nav.empezarIngreso(a.autenticacion, HOST_A, proveedor, perfil)),
      );
      proveedor.retenerTokenHasta(SIMULTANEOS);
      const respuestas = await Promise.all(
        navegadores.map((nav, i) => nav.pedir(a.autenticacion, HOST_A, "GET", rutas[i] as string)),
      );
      const exitos = respuestas.filter((r) => tipada(r.ubicacion) === "exito").length;
      expect(
        await n(`select count(*) as n from autenticacion."user" where email = $1`, [perfil.email]),
      ).toBe(1);
      expect(
        await n(`select count(*) as n from autenticacion.account where "accountId" = $1`, [
          perfil.sub,
        ]),
      ).toBe(1);
      expect(
        await n(
          `select count(*) as n from autenticacion.session s join autenticacion."user" u on u.id = s."userId" where u.email = $1`,
          [perfil.email],
        ),
      ).toBe(antes + exitos);
      // Para una cuenta que ya existe no hay carrera de alta: entran todos.
      expect(exitos).toBe(SIMULTANEOS);
    }
  });

  it("el mismo usuario nuevo ingresa a la vez por dos hosts: un usuario, una cuenta, dos sesiones con su host cada una", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const perfil = perfilAlAzar();
      const enA = new Navegador();
      const enB = new Navegador();
      const [rutaA, rutaB] = await Promise.all([
        enA.empezarIngreso(a.autenticacion, HOST_A, proveedor, perfil),
        enB.empezarIngreso(a.autenticacion, HOST_B, proveedor, perfil),
      ]);
      proveedor.retenerTokenHasta(2);
      const [ra, rb] = await Promise.all([
        enA.pedir(a.autenticacion, HOST_A, "GET", rutaA),
        enB.pedir(a.autenticacion, HOST_B, "GET", rutaB),
      ]);
      const resultados = [tipada(ra.ubicacion), tipada(rb.ubicacion)];
      expect(
        await n(`select count(*) as n from autenticacion."user" where email = $1`, [perfil.email]),
      ).toBe(1);
      expect(
        await n(`select count(*) as n from autenticacion.account where "accountId" = $1`, [
          perfil.sub,
        ]),
      ).toBe(1);
      const { rows } = await dueno.query<{ host: string }>(
        `select s.host from autenticacion.session s join autenticacion."user" u on u.id = s."userId" where u.email = $1 order by 1`,
        [perfil.email],
      );
      expect(rows.map((f) => f.host)).toEqual(
        [
          resultados[0] === "exito" ? HOST_A : null,
          resultados[1] === "exito" ? HOST_B : null,
        ].filter((x): x is string => x !== null),
      );
    }
  });

  it("muchos usos simultáneos de la misma sesión: todos la ven vigente y el vencimiento nunca pasa el tope de 8 horas", async () => {
    const nav = new Navegador();
    await nav.ingresarConGoogle(a.autenticacion, HOST_A, proveedor, perfilAlAzar());
    const token = decodeURIComponent(nav.cookiesDe(HOST_A)[0]?.valor ?? "").split(".")[0];
    // 7 h 50 de creada: el tope manda (a las 8 h) y no los 15 minutos del uso.
    await dueno.query(
      `update autenticacion.session set "createdAt" = now() - interval '470 minutes', "updatedAt" = now() - interval '1 minute',
              "expiresAt" = now() + interval '14 minutes' where token = $1`,
      [token],
    );
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const sesiones = await Promise.all(
        Array.from({ length: 10 }, () => a.autenticacion.sesionDe(nav.pedidoDe(HOST_A), HOST_A)),
      );
      expect(sesiones.every((s) => s !== null)).toBe(true);
    }
    const { rows } = await dueno.query<{ createdAt: Date; expiresAt: Date }>(
      `select "createdAt", "expiresAt" from autenticacion.session where token = $1`,
      [token],
    );
    expect(rows[0]?.expiresAt.getTime()).toBe(
      (rows[0]?.createdAt.getTime() ?? 0) + 8 * 60 * 60_000,
    );
  });

  it("cerrar sesión mientras se la usa: ningún pedido falla sin nombre, y la fila queda borrada", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const nav = new Navegador();
      await nav.ingresarConGoogle(a.autenticacion, HOST_A, proveedor, perfilAlAzar());
      const pedido = nav.pedidoDe(HOST_A);
      const resultados = await Promise.all([
        nav.pedir(a.autenticacion, HOST_A, "POST", "/api/auth/sign-out"),
        ...Array.from({ length: 6 }, () => a.autenticacion.sesionDe(pedido, HOST_A)),
      ]);
      expect((resultados[0] as { estado: number }).estado).toBe(200);
      expect(await a.autenticacion.sesionDe(pedido, HOST_A)).toBeNull();
    }
  });

  it("repetir el retorno de Google a la vez (la misma dirección, varias veces) abre a lo sumo una sesión", async () => {
    const perfil = perfilAlAzar();
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const nav = new Navegador();
      const ruta = await nav.empezarIngreso(a.autenticacion, HOST_A, proveedor, perfil);
      const respuestas = await Promise.all(
        Array.from({ length: 5 }, () => nav.pedir(a.autenticacion, HOST_A, "GET", ruta)),
      );
      for (const r of respuestas) {
        expect(r.estado).toBe(302);
        expect(r.ubicacion === "/" || /^\/ingreso\?error=/.test(r.ubicacion ?? "")).toBe(true);
      }
      expect(
        await n(`select count(*) as n from autenticacion."user" where email = $1`, [perfil.email]),
      ).toBe(1);
      expect(
        await n(`select count(*) as n from autenticacion.account where "accountId" = $1`, [
          perfil.sub,
        ]),
      ).toBe(1);
    }
  });
});
