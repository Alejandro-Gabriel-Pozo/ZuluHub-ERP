import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  Navegador,
  levantarProveedorLocal,
  perfilAlAzar,
  type ProveedorLocal,
} from "./autenticacion-ingreso-apoyo";
import {
  HOST_DE_LA_CONSOLA as HOST,
  altaDeAdmin,
  armarPlataformaDePrueba,
  codigoDeLaAplicacion,
  otroNavegadorConLaSesion,
  type AdminDePrueba,
  type PlataformaDePrueba,
} from "./autenticacion-plataforma-apoyo";
import { crearBaseAparte } from "./entorno";

/**
 * Concurrencia REAL del segundo factor de la consola contra la librería y una base reales: lo que se afirma es la regla
 * de fondo, no el orden en que llegan los pedidos (que no se controla). G2: de ocho pedidos simultáneos con el mismo
 * código TOTP gana UNO. Los códigos de recuperación se gastan una sola vez. El límite de intentos no se esquiva pidiendo
 * en paralelo: ni uno más de cinco fallos se anotan. Y ningún pedido termina en un fallo sin nombre (5xx).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const RONDAS = 4;
const SIMULTANEOS = 8;
type Alta = Readonly<{ qrSvg: string; secreto: string; codigosDeRecuperacion: string[] }>;

describe.skipIf(base === null)("consola de plataforma: concurrencia del segundo factor", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let proveedor: ProveedorLocal;
  let p: PlataformaDePrueba;

  beforeAll(async () => {
    if (base === null) return;
    vi.stubEnv("NODE_ENV", "production");
    proveedor = await levantarProveedorLocal();
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    p = armarPlataformaDePrueba(propia.base, proveedor);
  });
  afterAll(async () => {
    expect(proveedor.intentosExternos(), "nada salió a internet").toEqual([]);
    await p.cerrar();
    await dueno.end();
    await propia.destruir();
    await proveedor.cerrar();
    vi.unstubAllEnvs();
  });

  const pedir = (n: Navegador, metodo: "GET" | "POST", ruta: string, cuerpo?: unknown) =>
    n.pedir(p.autenticacion, HOST, metodo, ruta, cuerpo === undefined ? {} : { cuerpo });
  async function ingresar(admin: AdminDePrueba): Promise<Navegador> {
    const n = new Navegador();
    expect((await n.ingresarConGoogle(p.autenticacion, HOST, proveedor, admin)).ubicacion).toBe(
      "/",
    );
    return n;
  }
  /** Un administrador enrolado y, aparte, una sesión nueva suya (sin segundo factor) lista para verificar. */
  async function listo() {
    const admin = await altaDeAdmin(dueno);
    const inicial = await ingresar(admin);
    const alta = (await pedir(inicial, "POST", "/api/auth/two-factor/enable", {})).json() as Alta;
    const v = await pedir(inicial, "POST", "/api/auth/two-factor/verify-totp", {
      code: codigoDeLaAplicacion(alta.secreto),
    });
    expect(v.estado).toBe(200);
    const n = await ingresar(admin);
    return { admin, alta, n };
  }
  const usuarioId = async (admin: AdminDePrueba) =>
    (
      await dueno.query<{ id: string }>(`select id from autenticacion."user" where email = $1`, [
        admin.email,
      ])
    ).rows[0]?.id as string;
  const contar = async (texto: string, parametros: unknown[]) =>
    Number((await dueno.query<{ n: string }>(texto, parametros)).rows[0]?.n);
  /** Ocho navegadores (otras IP) con la misma sesión. */
  const dispositivos = (n: Navegador, cuantos = SIMULTANEOS) =>
    Array.from({ length: cuantos }, () => otroNavegadorConLaSesion(n, HOST));

  /** Todo pedido termina en una respuesta tipada: nunca un 5xx ni una excepción. */
  const TIPADAS = new Set(["codigo_invalido", "demasiados_intentos"]);
  function exigirTipadas(respuestas: { estado: number; json: () => unknown }[]) {
    for (const r of respuestas) {
      if (r.estado === 200) continue;
      expect([401, 429], `estado ${r.estado}`).toContain(r.estado);
      expect(TIPADAS.has((r.json() as { codigo: string }).codigo)).toBe(true);
    }
  }

  it(`G2: ${SIMULTANEOS} pedidos simultáneos con el MISMO código TOTP: gana uno, el paso queda usado una sola vez y la sesión se marca`, async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { admin, alta, n } = await listo();
      // El paso que sigue: la ventana lo acepta siempre y todavía no se usó (el enrolamiento gastó el actual, aunque el reloj avance).
      const codigo = codigoDeLaAplicacion(alta.secreto, new Date(), 1);
      const respuestas = await Promise.all(
        dispositivos(n).map((d) =>
          pedir(d, "POST", "/api/auth/two-factor/verify-totp", { code: codigo }),
        ),
      );
      expect(
        respuestas.filter((r) => r.estado === 200),
        `ronda ${ronda}`,
      ).toHaveLength(1);
      exigirTipadas(respuestas);
      const id = await usuarioId(admin);
      // Dos pasos usados en total: el del enrolamiento y este.
      expect(
        await contar(
          `select count(*) as n from autenticacion.codigo_totp_usado where usuario_id = $1`,
          [id],
        ),
      ).toBe(2);
      const { rows } = await dueno.query<{ segundo_factor_en: Date | null }>(
        `select s.segundo_factor_en from autenticacion.session s where s."userId" = $1 order by s."createdAt" desc limit 1`,
        [id],
      );
      expect(rows[0]?.segundo_factor_en).not.toBeNull();
      // Los perdedores son los que dicen «código inválido» (o el bloqueo si fueron muchos): ninguno entró.
      const ganadores = await contar(
        `select count(*) as n from autenticacion.session where "userId" = $1 and segundo_factor_en is not null`,
        [id],
      );
      expect(ganadores).toBe(2); // la del enrolamiento (rotada) y esta
    }
  });

  it(`un código de recuperación se gasta UNA vez aunque lleguen ${SIMULTANEOS} pedidos simultáneos con él`, async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { admin, alta, n } = await listo();
      const codigo = alta.codigosDeRecuperacion[ronda] as string;
      const respuestas = await Promise.all(
        dispositivos(n).map((d) =>
          pedir(d, "POST", "/api/auth/two-factor/verify-backup-code", { code: codigo }),
        ),
      );
      expect(
        respuestas.filter((r) => r.estado === 200),
        `ronda ${ronda}`,
      ).toHaveLength(1);
      exigirTipadas(respuestas);
      const { rows } = await dueno.query<{ b: string }>(
        `select t."backupCodes" as b from autenticacion."twoFactor" t where t."userId" = $1`,
        [await usuarioId(admin)],
      );
      expect(JSON.parse(rows[0]?.b ?? "[]")).toHaveLength(9);
    }
  });

  it("20 pedidos simultáneos con un código malo: se anotan EXACTAMENTE cinco fallos (el resto lo frena el bloqueo) y se audita UN bloqueo", async () => {
    const { admin, n } = await listo();
    const respuestas = await Promise.all(
      dispositivos(n, 20).map((d) =>
        pedir(d, "POST", "/api/auth/two-factor/verify-totp", { code: "000000" }),
      ),
    );
    exigirTipadas(respuestas);
    expect(respuestas.filter((r) => r.estado === 401)).toHaveLength(5);
    expect(respuestas.filter((r) => r.estado === 429)).toHaveLength(15);
    const id = await usuarioId(admin);
    expect(
      await contar(
        `select count(*) as n from autenticacion.intento_segundo_factor where usuario_id = $1`,
        [id],
      ),
    ).toBe(5);
    expect(
      await contar(
        `select count(*) as n from auditoria_plataforma where accion = 'SEGUNDO_FACTOR_BLOQUEADO' and entidad_id = $1`,
        [admin.adminId],
      ),
    ).toBe(1);
  });

  it("códigos de recuperación malos y TOTP malos a la vez comparten el límite: cinco fallos en total", async () => {
    const { admin, n } = await listo();
    const respuestas = await Promise.all(
      dispositivos(n, 16).map((d, i) =>
        i % 2 === 0
          ? pedir(d, "POST", "/api/auth/two-factor/verify-totp", { code: "000000" })
          : pedir(d, "POST", "/api/auth/two-factor/verify-backup-code", { code: "zzzzz-00000" }),
      ),
    );
    exigirTipadas(respuestas);
    expect(respuestas.filter((r) => r.estado === 401)).toHaveLength(5);
    expect(
      await contar(
        `select count(*) as n from autenticacion.intento_segundo_factor where usuario_id = $1`,
        [await usuarioId(admin)],
      ),
    ).toBe(5);
  });

  it("mezcla de pedidos buenos y malos a la vez: nunca más de cinco fallos anotados, a lo sumo un acierto del mismo código y ningún 5xx", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { admin, alta, n } = await listo();
      const bueno = codigoDeLaAplicacion(alta.secreto, new Date(), 1);
      const ds = dispositivos(n, 10);
      const respuestas = await Promise.all(
        ds.map((d, i) =>
          pedir(d, "POST", "/api/auth/two-factor/verify-totp", {
            code: i % 3 === 0 ? bueno : "000000",
          }),
        ),
      );
      exigirTipadas(respuestas);
      expect(respuestas.filter((r) => r.estado === 200).length).toBeLessThanOrEqual(1);
      expect(
        await contar(
          `select count(*) as n from autenticacion.intento_segundo_factor where usuario_id = $1`,
          [await usuarioId(admin)],
        ),
      ).toBeLessThanOrEqual(5);
    }
  });

  it("administradores distintos verificando a la vez no se pisan: todos entran, y cada uno marca SU sesión", async () => {
    const equipo: Awaited<ReturnType<typeof listo>>[] = [];
    // Se arman de a uno: la conexión del dueño de la prueba es una sola.
    for (let i = 0; i < 5; i++) equipo.push(await listo());
    const respuestas = await Promise.all(
      equipo.map(({ alta, n }) =>
        pedir(n, "POST", "/api/auth/two-factor/verify-totp", {
          code: codigoDeLaAplicacion(alta.secreto, new Date(), 1),
        }),
      ),
    );
    for (const r of respuestas) expect(r.estado).toBe(200);
    for (const { admin } of equipo) {
      const { rows } = await dueno.query<{ n: string }>(
        `select count(*) as n from autenticacion.session where "userId" = $1 and segundo_factor_en is not null`,
        [await usuarioId(admin)],
      );
      expect(Number(rows[0]?.n)).toBe(2);
    }
  });

  it("enrolar seis veces a la vez (doble clic): queda UNA fila de segundo factor y toda respuesta es un alta válida o un error tipado, nunca un 5xx", async () => {
    for (let ronda = 0; ronda < 3; ronda++) {
      const admin = await altaDeAdmin(dueno);
      const n = await ingresar(admin);
      const resultados = await Promise.allSettled(
        dispositivos(n, 6).map((d) => pedir(d, "POST", "/api/auth/two-factor/enable", {})),
      );
      const altas: Alta[] = [];
      for (const r of resultados) {
        if (r.status === "rejected") {
          // `manejar` convierte un fallo interno en un error sin detalle (lo traduce la puerta con su referencia).
          expect(String((r.reason as Error).name)).toBe("ErrorInternoDeIngreso");
          continue;
        }
        if (r.value.estado === 200) altas.push(r.value.json() as Alta);
        else expect([400, 403, 429]).toContain(r.value.estado);
      }
      expect(altas.length, `ronda ${ronda}`).toBeGreaterThanOrEqual(1);
      expect(
        await contar(`select count(*) as n from autenticacion."twoFactor" where "userId" = $1`, [
          await usuarioId(admin),
        ]),
      ).toBe(1);
      // Exactamente uno de los secretos mostrados es el que quedó guardado: el que sirve para verificar.
      const buenos: boolean[] = [];
      for (const alta of altas) {
        const r = await pedir(
          otroNavegadorConLaSesion(n, HOST),
          "POST",
          "/api/auth/two-factor/verify-totp",
          {
            code: codigoDeLaAplicacion(alta.secreto),
          },
        );
        buenos.push(r.estado === 200);
        if (r.estado === 200) break;
        // Cada secreto equivocado cuenta como un fallo (a los cinco, bloqueo): se limpian para probar los seis sin que el
        // límite de intentos —que otra prueba ya cubre— tape cuál era el bueno.
        await dueno.query(
          `delete from autenticacion.intento_segundo_factor where usuario_id = $1`,
          [await usuarioId(admin)],
        );
      }
      expect(buenos.some(Boolean), `ronda ${ronda}: ningún secreto mostrado sirve`).toBe(true);
    }
  });

  it(`${SIMULTANEOS} primeros ingresos simultáneos del MISMO administrador: un usuario, una cuenta, una sesión por cada «entraste» y toda respuesta tipada`, async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const admin = await altaDeAdmin(dueno);
      const navegadores = Array.from({ length: SIMULTANEOS }, () => new Navegador());
      const rutas = await Promise.all(
        navegadores.map((x) => x.empezarIngreso(p.autenticacion, HOST, proveedor, admin)),
      );
      proveedor.retenerTokenHasta(SIMULTANEOS);
      const respuestas = await Promise.all(
        navegadores.map((x, i) => x.pedir(p.autenticacion, HOST, "GET", rutas[i] as string)),
      );
      let exitos = 0;
      for (const r of respuestas) {
        expect(r.estado).toBe(302);
        if (r.ubicacion === "/") exitos += 1;
        else
          expect(r.ubicacion, "el que pierde la carrera vuelve con el código genérico").toBe(
            "/ingreso?error=no_habilitado",
          );
      }
      expect(exitos).toBeGreaterThanOrEqual(1);
      expect(
        await contar(`select count(*) as n from autenticacion."user" where email = $1`, [
          admin.email,
        ]),
      ).toBe(1);
      expect(
        await contar(`select count(*) as n from autenticacion.account where "accountId" = $1`, [
          admin.sub,
        ]),
      ).toBe(1);
      expect(
        await contar(
          `select count(*) as n from autenticacion.session s join autenticacion."user" u on u.id = s."userId" where u.email = $1`,
          [admin.email],
        ),
      ).toBe(exitos);
    }
  });

  it("una cuenta que NO es personal, con ocho ingresos simultáneos, no deja nada y todos vuelven con el mismo código", async () => {
    const perfil = perfilAlAzar();
    const navegadores = Array.from({ length: SIMULTANEOS }, () => new Navegador());
    const rutas = await Promise.all(
      navegadores.map((x) => x.empezarIngreso(p.autenticacion, HOST, proveedor, perfil)),
    );
    proveedor.retenerTokenHasta(SIMULTANEOS);
    const respuestas = await Promise.all(
      navegadores.map((x, i) => x.pedir(p.autenticacion, HOST, "GET", rutas[i] as string)),
    );
    for (const r of respuestas) {
      expect(r.estado).toBe(302);
      expect(r.ubicacion).toBe("/ingreso?error=no_habilitado");
    }
    expect(
      await contar(`select count(*) as n from autenticacion."user" where email = $1`, [
        perfil.email,
      ]),
    ).toBe(0);
    expect(
      await contar(`select count(*) as n from autenticacion.account where "accountId" = $1`, [
        perfil.sub,
      ]),
    ).toBe(0);
    for (const x of navegadores) expect(x.cookiesDe(HOST)).toEqual([]);
  });
});
