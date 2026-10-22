import pg from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest";
import {
  Navegador,
  levantarProveedorLocal,
  type ProveedorLocal,
} from "./autenticacion-ingreso-apoyo";
import {
  HOST_DE_LA_CONSOLA as HOST,
  type AdminDePrueba,
  altaDeAdmin,
  armarPlataformaDePrueba,
  codigoDeLaAplicacion,
  instanciaDirectaDeLaConsola,
  otroNavegadorConLaSesion,
  type PlataformaDePrueba,
} from "./autenticacion-plataforma-apoyo";
import { crearBaseAparte } from "./entorno";

/**
 * El segundo factor de la consola contra la librería REAL y una base real: G2 (un código TOTP usado no se acepta de
 * nuevo), G3 (ver el secreto, regenerar códigos y dar de baja el TOTP exigen segundo factor reciente: 403) y el límite
 * de intentos (5 fallidos en 10 minutos bloquean 15, asentado en la auditoría de plataforma sin datos sensibles).
 * Las pruebas de tiempo mueven las fechas en la base. La librería verifica el código con `Date.now()` y su paso es de 30
 * segundos: con el reloj real, un paso que cambiara en medio de una prueba (enrolar y, un instante después, pedir «el
 * anterior») la hacía fallar una de cada tantas corridas. Por eso cada prueba corre con la FECHA controlada
 * (`vi.useFakeTimers({ toFake: ["Date"] })`, los temporizadores siguen siendo reales para la base y la red): arranca en
 * la mitad de un paso y solo avanza si la prueba la mueve con `vi.setSystemTime`. Los bordes del paso se prueban
 * a propósito, con la fecha puesta en ellos (ver G2: «sin importar en qué momento del paso» y «cuando el reloj cruza»).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const MINUTO = 60_000;
const PASO = 30_000;
/** El comienzo del paso de TOTP en que cae `instante` (milisegundos). */
const comienzoDelPaso = (instante: number): number => Math.floor(instante / PASO) * PASO;
type Alta = Readonly<{ qrSvg: string; secreto: string; codigosDeRecuperacion: string[] }>;

describe.skipIf(base === null)("consola de plataforma: G2, G3 e intentos", () => {
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

  // La fecha queda quieta en la mitad de un paso (a lo sumo 15 s de la real, lo que no mueve ninguna ventana de minutos).
  beforeEach(() => {
    const ahora = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(comienzoDelPaso(ahora) + PASO / 2);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const pedir = (n: Navegador, metodo: "GET" | "POST", ruta: string, cuerpo?: unknown) =>
    n.pedir(p.autenticacion, HOST, metodo, ruta, cuerpo === undefined ? {} : { cuerpo });
  /** Un pedido desde otra IP con la misma sesión (el límite de pedidos de la librería es por IP y ruta). */
  const desdeOtraIp = (n: Navegador) => otroNavegadorConLaSesion(n, HOST);
  async function ingresar(admin: AdminDePrueba): Promise<Navegador> {
    const n = new Navegador();
    const r = await n.ingresarConGoogle(p.autenticacion, HOST, proveedor, admin);
    expect(r.ubicacion).toBe("/");
    // Con la fecha quieta, dos sesiones del mismo administrador tendrían el mismo `createdAt` y `sesionDe` (la más reciente
    // primero) no sabría cuál es cuál: cada ingreso avanza un milisegundo, muy lejos de mover el paso de 30 s.
    vi.setSystemTime(Date.now() + 1);
    return n;
  }
  async function enrolado() {
    const admin = await altaDeAdmin(dueno);
    const n = await ingresar(admin);
    const alta = (await pedir(n, "POST", "/api/auth/two-factor/enable", {})).json() as Alta;
    const r = await pedir(n, "POST", "/api/auth/two-factor/verify-totp", {
      code: codigoDeLaAplicacion(alta.secreto),
    });
    expect(r.estado).toBe(200);
    return { admin, n, alta };
  }
  /** Un ingreso nuevo del mismo administrador: sesión sin segundo factor, con TOTP ya enrolado. */
  const sesionNueva = (admin: AdminDePrueba) => ingresar(admin);
  const sesionDe = async (admin: AdminDePrueba) =>
    (
      await dueno.query<{ id: string; token: string; segundo_factor_en: Date | null }>(
        `select s.id, s.token, s.segundo_factor_en from autenticacion.session s
           join autenticacion."user" u on u.id = s."userId" where u.email = $1 order by s."createdAt" desc`,
        [admin.email],
      )
    ).rows;
  const usuarioId = async (admin: AdminDePrueba) =>
    (
      await dueno.query<{ id: string }>(`select id from autenticacion."user" where email = $1`, [
        admin.email,
      ])
    ).rows[0]?.id as string;
  const fallos = async (admin: AdminDePrueba) =>
    Number(
      (
        await dueno.query<{ n: string }>(
          `select count(*) as n from autenticacion.intento_segundo_factor where usuario_id = $1`,
          [await usuarioId(admin)],
        )
      ).rows[0]?.n,
    );
  const bloqueosAuditados = async (admin: AdminDePrueba) =>
    (
      await dueno.query<{
        actor: string;
        accion: string;
        entidad: string;
        entidad_id: string;
        antes: unknown;
        despues: { bloqueadoHasta: string; fallos: number };
      }>(
        `select actor, accion, entidad, entidad_id, antes, despues from auditoria_plataforma
          where accion = 'SEGUNDO_FACTOR_BLOQUEADO' and entidad_id = $1 order by id`,
        [admin.adminId],
      )
    ).rows;
  /** El mismo pedido de código malo, desde una IP nueva cada vez. */
  const malo = (n: Navegador, ruta = "/api/auth/two-factor/verify-totp", codigo = "000000") =>
    pedir(desdeOtraIp(n), "POST", ruta, { code: codigo });

  // =============================================================================================
  // G2: un código TOTP usado no se acepta de nuevo
  // =============================================================================================
  describe("G2: el código TOTP no se repite", () => {
    it("el mismo código dos veces: la primera vale y la segunda es código inválido (el mismo texto que un código malo)", async () => {
      const { admin, alta } = await enrolado();
      const n = await sesionNueva(admin);
      // Un paso adelante: el del enrolamiento (paso actual) ya está usado, y este vale aunque el reloj avance durante la prueba.
      const codigo = codigoDeLaAplicacion(alta.secreto, new Date(), 1);
      const primera = await pedir(n, "POST", "/api/auth/two-factor/verify-totp", { code: codigo });
      expect(primera.estado).toBe(200);
      const segunda = await pedir(desdeOtraIp(n), "POST", "/api/auth/two-factor/verify-totp", {
        code: codigo,
      });
      expect(segunda.estado).toBe(401);
      expect(segunda.json()).toEqual({ codigo: "codigo_invalido" });
      const equivocado = await malo(n);
      expect(equivocado.texto).toBe(segunda.texto);
    });

    it("el código con que se enrolaron vale UNA vez: en un ingreso posterior ya no sirve", async () => {
      const { admin, alta } = await enrolado();
      const n = await sesionNueva(admin);
      const r = await pedir(n, "POST", "/api/auth/two-factor/verify-totp", {
        code: codigoDeLaAplicacion(alta.secreto),
      });
      expect(r.estado).toBe(401);
      expect(r.json()).toEqual({ codigo: "codigo_invalido" });
      expect((await sesionDe(admin))[0]?.segundo_factor_en).toBeNull();
    });

    it("cada paso del reloj se usa una vez, por separado: el actual, el anterior y el siguiente valen cada uno UNA vez", async () => {
      const { admin, alta } = await enrolado();
      const n = await sesionNueva(admin);
      // El paso actual ya se gastó al enrolar; el anterior y el siguiente están libres.
      for (const desvio of [-1, 1]) {
        const codigo = codigoDeLaAplicacion(alta.secreto, new Date(), desvio);
        expect(
          (
            await pedir(desdeOtraIp(n), "POST", "/api/auth/two-factor/verify-totp", {
              code: codigo,
            })
          ).estado,
        ).toBe(200);
        expect(
          (
            await pedir(desdeOtraIp(n), "POST", "/api/auth/two-factor/verify-totp", {
              code: codigo,
            })
          ).estado,
        ).toBe(401);
      }
    });

    // Hasta 29_990: los dos ingresos de la prueba avanzan 2 ms y no llegan a cruzar (el cruce tiene su prueba, abajo).
    it.each([0, 1, 14_999, 29_990])(
      "el anterior y el siguiente valen UNA vez cada uno, sin importar en qué momento del paso se enrola (a %i ms de su comienzo)",
      async (desfase) => {
        vi.setSystemTime(comienzoDelPaso(Date.now()) + desfase);
        const { admin, alta } = await enrolado();
        const n = await sesionNueva(admin);
        for (const desvio of [-1, 1]) {
          const codigo = codigoDeLaAplicacion(alta.secreto, new Date(), desvio);
          for (const esperado of [200, 401]) {
            const r = await pedir(desdeOtraIp(n), "POST", "/api/auth/two-factor/verify-totp", {
              code: codigo,
            });
            expect(r.estado, `desvío ${desvio}, desfase ${desfase}`).toBe(esperado);
          }
        }
      },
    );

    it("el paso gastado al enrolar sigue gastado cuando el reloj cruza al paso siguiente; el nuevo y el que le sigue valen una vez", async () => {
      // El borde que antes dependía del azar: se enrola en el último milisegundo de un paso y se verifica en el siguiente.
      const siguiente = comienzoDelPaso(Date.now()) + PASO;
      vi.setSystemTime(siguiente - 2);
      const { admin, alta } = await enrolado();
      const n = await sesionNueva(admin);
      vi.setSystemTime(siguiente);
      const verificar = async (desvio: number) =>
        (
          await pedir(desdeOtraIp(n), "POST", "/api/auth/two-factor/verify-totp", {
            code: codigoDeLaAplicacion(alta.secreto, new Date(), desvio),
          })
        ).estado;
      expect(await verificar(-1), "el paso del enrolamiento ya se usó").toBe(401);
      expect(await verificar(0), "el paso nuevo está libre").toBe(200);
      expect(await verificar(0), "y se usa una sola vez").toBe(401);
      expect(await verificar(1), "el que le sigue está libre").toBe(200);
      expect(await verificar(1), "y también una sola vez").toBe(401);
    });

    it("la base guarda solo el NÚMERO de paso usado, nunca el código; y otro administrador con el mismo código no choca", async () => {
      const { admin, alta } = await enrolado();
      const filas = (
        await dueno.query<{ usuario_id: string; paso: string; usado_en: Date }>(
          `select usuario_id, paso, usado_en from autenticacion.codigo_totp_usado where usuario_id = $1`,
          [await usuarioId(admin)],
        )
      ).rows;
      expect(filas).toHaveLength(1);
      expect(Object.keys(filas[0] ?? {}).sort()).toEqual(["paso", "usado_en", "usuario_id"]);
      expect(Number(filas[0]?.paso)).toBe(Math.floor(Date.now() / 30_000));
      expect(String(filas[0]?.paso)).not.toBe(codigoDeLaAplicacion(alta.secreto));
      // Otro administrador (otro usuario) puede usar el mismo paso del reloj: la clave es (usuario, paso).
      const otro = await enrolado();
      expect(otro.n).toBeDefined();
    });

    it("un código repetido cuenta como intento fallido (se puede bloquear a quien lo reenvía)", async () => {
      const { admin, alta } = await enrolado();
      const n = await sesionNueva(admin);
      const codigo = codigoDeLaAplicacion(alta.secreto, new Date(), 1);
      await pedir(n, "POST", "/api/auth/two-factor/verify-totp", { code: codigo });
      expect(await fallos(admin)).toBe(0);
      await pedir(desdeOtraIp(n), "POST", "/api/auth/two-factor/verify-totp", { code: codigo });
      expect(await fallos(admin)).toBe(1);
    });
  });

  // =============================================================================================
  // G3: gestión del TOTP con segundo factor reciente
  // =============================================================================================
  describe("G3: regenerar códigos, ver el secreto y dar de baja exigen segundo factor reciente (≤ 5 min)", () => {
    it("regenerar los códigos SIN segundo factor verificado: 403 segundo_factor_reciente_requerido y no cambia nada", async () => {
      const { admin, alta } = await enrolado();
      const n = await sesionNueva(admin);
      const antes = (
        await dueno.query<{ b: string }>(
          `select t."backupCodes" as b from autenticacion."twoFactor" t where t."userId" = $1`,
          [await usuarioId(admin)],
        )
      ).rows[0]?.b;
      const r = await pedir(n, "POST", "/api/auth/two-factor/generate-backup-codes", {});
      expect(r.estado).toBe(403);
      expect(r.json()).toEqual({ codigo: "segundo_factor_reciente_requerido" });
      expect(r.cabeceras.getSetCookie()).toEqual([]);
      const despues = (
        await dueno.query<{ b: string }>(
          `select t."backupCodes" as b from autenticacion."twoFactor" t where t."userId" = $1`,
          [await usuarioId(admin)],
        )
      ).rows[0]?.b;
      expect(despues).toBe(antes);
      void alta;
    });

    it("con el segundo factor verificado hace unos segundos: emite diez códigos nuevos (una vez, no-store), hasheados, y los viejos dejan de valer", async () => {
      const { admin, n, alta } = await enrolado();
      const r = await pedir(n, "POST", "/api/auth/two-factor/generate-backup-codes", {});
      expect(r.estado).toBe(200);
      expect(r.cabeceras.get("cache-control")).toBe("no-store");
      const nuevos = (r.json() as { codigosDeRecuperacion: string[] }).codigosDeRecuperacion;
      expect(Object.keys(r.json() as object)).toEqual(["codigosDeRecuperacion"]);
      expect(nuevos).toHaveLength(10);
      expect(new Set(nuevos).size).toBe(10);
      const guardado = (
        await dueno.query<{ b: string }>(
          `select t."backupCodes" as b from autenticacion."twoFactor" t where t."userId" = $1`,
          [await usuarioId(admin)],
        )
      ).rows[0]?.b as string;
      for (const c of nuevos) expect(guardado).not.toContain(c);
      expect(JSON.parse(guardado)).toHaveLength(10);
      // Un código viejo ya no sirve; uno nuevo sí.
      const otra = await sesionNueva(admin);
      const viejo = await pedir(otra, "POST", "/api/auth/two-factor/verify-backup-code", {
        code: alta.codigosDeRecuperacion[0] as string,
      });
      expect(viejo.estado).toBe(401);
      const bueno = await pedir(
        desdeOtraIp(otra),
        "POST",
        "/api/auth/two-factor/verify-backup-code",
        {
          code: nuevos[0] as string,
        },
      );
      expect(bueno.estado).toBe(200);
    });

    it("el borde de los 5 minutos: a 4 minutos todavía se puede; a 6, 403", async () => {
      const { admin, n } = await enrolado();
      const id = (await sesionDe(admin))[0]?.id;
      await dueno.query(
        `update autenticacion.session set segundo_factor_en = now() - interval '4 minutes' where id = $1`,
        [id],
      );
      expect(
        (await pedir(n, "POST", "/api/auth/two-factor/generate-backup-codes", {})).estado,
      ).toBe(200);
      await dueno.query(
        `update autenticacion.session set segundo_factor_en = now() - interval '6 minutes' where id = $1`,
        [id],
      );
      const viejo = await pedir(
        desdeOtraIp(n),
        "POST",
        "/api/auth/two-factor/generate-backup-codes",
        {},
      );
      expect(viejo.estado).toBe(403);
      expect(viejo.json()).toEqual({ codigo: "segundo_factor_reciente_requerido" });
    });

    it("verificar de nuevo (código TOTP o de recuperación) renueva la ventana de la MISMA sesión, sin crear otra", async () => {
      const { admin, alta } = await enrolado();
      const n = await sesionNueva(admin);
      const sesiones = (await sesionDe(admin)).length;
      await pedir(n, "POST", "/api/auth/two-factor/verify-backup-code", {
        code: alta.codigosDeRecuperacion[0] as string,
      });
      const id = (await sesionDe(admin))[0]?.id;
      await dueno.query(
        `update autenticacion.session set segundo_factor_en = now() - interval '6 minutes' where id = $1`,
        [id],
      );
      expect(
        (await pedir(desdeOtraIp(n), "POST", "/api/auth/two-factor/generate-backup-codes", {}))
          .estado,
      ).toBe(403);
      const otra = await pedir(desdeOtraIp(n), "POST", "/api/auth/two-factor/verify-backup-code", {
        code: alta.codigosDeRecuperacion[1] as string,
      });
      expect(otra.estado).toBe(200);
      expect(
        (await pedir(desdeOtraIp(n), "POST", "/api/auth/two-factor/generate-backup-codes", {}))
          .estado,
      ).toBe(200);
      expect((await sesionDe(admin)).length).toBe(sesiones);
      expect((await sesionDe(admin))[0]?.id).toBe(id);
    });

    it("ver el secreto y dar de baja el TOTP NO tienen ruta (404), y aunque alguien la abriera la barrera de la librería los frena con 403", async () => {
      const { admin, n } = await enrolado();
      for (const ruta of ["/api/auth/two-factor/get-totp-uri", "/api/auth/two-factor/disable"]) {
        expect((await pedir(n, "POST", ruta, {})).estado, ruta).toBe(404);
      }
      const nueva = await sesionNueva(admin);
      const api = instanciaDirectaDeLaConsola(p, proveedor);
      const encabezados = nueva.pedidoDe(HOST).headers;
      for (const [nombre, cuerpo] of [
        ["getTOTPURI", {}],
        ["generateBackupCodes", {}],
        ["disableTwoFactor", {}],
      ] as const) {
        const llamar = api[nombre] as NonNullable<(typeof api)[string]>;
        await expect(llamar({ headers: encabezados, body: cuerpo }), nombre).rejects.toMatchObject({
          statusCode: 403,
          body: { code: "SEGUNDO_FACTOR_RECIENTE_REQUERIDO" },
        });
      }
      // Nada cambió: el TOTP sigue habilitado.
      const { rows } = await dueno.query<{ e: boolean }>(
        `select "twoFactorEnabled" as e from autenticacion."user" where email = $1`,
        [admin.email],
      );
      expect(rows[0]?.e).toBe(true);
    });

    it("la barrera de ver el secreto deja pasar con segundo factor reciente (y el rol no puede borrar el TOTP: dar de baja falla sin tocar la fila)", async () => {
      const { admin, n } = await enrolado();
      const api = instanciaDirectaDeLaConsola(p, proveedor);
      const encabezados = n.pedidoDe(HOST).headers;
      const uri = (await (api["getTOTPURI"] as NonNullable<(typeof api)[string]>)({
        headers: encabezados,
        body: {},
      })) as { totpURI: string };
      expect(uri.totpURI.startsWith("otpauth://totp/")).toBe(true);
      // Dar de baja necesita DELETE sobre `twoFactor`, que el rol de la librería NO tiene (0015, P2): la baja es del dueño.
      await expect(
        (api["disableTwoFactor"] as NonNullable<(typeof api)[string]>)({
          headers: encabezados,
          body: {},
        }),
      ).rejects.toBeDefined();
      const { rows } = await dueno.query(
        `select 1 from autenticacion."twoFactor" where "userId" = $1`,
        [await usuarioId(admin)],
      );
      expect(rows).toHaveLength(1);
    });

    it("sin sesión, las tres barreras responden 401 (no 403): la sesión se exige antes", async () => {
      const api = instanciaDirectaDeLaConsola(p, proveedor);
      for (const nombre of ["getTOTPURI", "generateBackupCodes", "disableTwoFactor"]) {
        await expect(
          (api[nombre] as NonNullable<(typeof api)[string]>)({ headers: new Headers(), body: {} }),
          nombre,
        ).rejects.toMatchObject({ statusCode: 401 });
      }
    });
  });

  // =============================================================================================
  // Límite de intentos
  // =============================================================================================
  describe("límite de intentos: 5 fallidos en 10 minutos bloquean 15", () => {
    it("el quinto fallo todavía es código inválido y el sexto pedido es demasiados_intentos con cuándo reintentar", async () => {
      const { admin } = await enrolado();
      const n = await sesionNueva(admin);
      for (let i = 1; i <= 5; i++) {
        const r = await malo(n);
        expect(r.estado, `fallo ${i}`).toBe(401);
        expect(r.json()).toEqual({ codigo: "codigo_invalido" });
      }
      const bloqueado = await malo(n);
      expect(bloqueado.estado).toBe(429);
      const cuerpo = bloqueado.json() as { codigo: string; reintentarEnMs: number };
      expect(cuerpo.codigo).toBe("demasiados_intentos");
      expect(cuerpo.reintentarEnMs).toBeGreaterThan(14 * MINUTO);
      expect(cuerpo.reintentarEnMs).toBeLessThanOrEqual(15 * MINUTO);
      expect(Number(bloqueado.cabeceras.get("retry-after"))).toBe(
        Math.ceil(cuerpo.reintentarEnMs / 1000),
      );
      expect(Object.keys(cuerpo).sort()).toEqual(["codigo", "reintentarEnMs"]);
      // Los pedidos rechazados por el bloqueo no se anotan como fallos.
      expect(await fallos(admin)).toBe(5);
    });

    it("durante el bloqueo NI el código correcto entra (no se dice si acertó), con el TOTP ni con uno de recuperación", async () => {
      const { admin, alta } = await enrolado();
      const n = await sesionNueva(admin);
      for (let i = 0; i < 5; i++) await malo(n);
      const bueno = await pedir(desdeOtraIp(n), "POST", "/api/auth/two-factor/verify-totp", {
        code: codigoDeLaAplicacion(alta.secreto, new Date(), 1),
      });
      expect(bueno.estado).toBe(429);
      const recuperacion = await pedir(
        desdeOtraIp(n),
        "POST",
        "/api/auth/two-factor/verify-backup-code",
        {
          code: alta.codigosDeRecuperacion[0] as string,
        },
      );
      expect(recuperacion.estado).toBe(429);
      expect((await sesionDe(admin))[0]?.segundo_factor_en).toBeNull();
    });

    it("el límite es POR USUARIO: otra sesión del mismo administrador también queda bloqueada, y otro administrador no", async () => {
      const a = await enrolado();
      const otraSesion = await sesionNueva(a.admin);
      const sesionB = await sesionNueva(a.admin);
      for (let i = 0; i < 5; i++) await malo(otraSesion);
      expect((await malo(sesionB)).estado).toBe(429);
      const b = await enrolado();
      const nb = await sesionNueva(b.admin);
      expect((await malo(nb)).estado).toBe(401);
    });

    it("los fallos del TOTP y de los códigos de recuperación suman en el mismo contador", async () => {
      const { admin } = await enrolado();
      const n = await sesionNueva(admin);
      for (let i = 0; i < 3; i++) await malo(n);
      for (let i = 0; i < 2; i++)
        await malo(n, "/api/auth/two-factor/verify-backup-code", "zzzzz-00000");
      expect((await malo(n)).estado).toBe(429);
    });

    it("un acierto borra los fallos: cuatro fallos, un acierto y otros cuatro fallos no bloquean", async () => {
      const { admin, alta } = await enrolado();
      const n = await sesionNueva(admin);
      for (let i = 0; i < 4; i++) await malo(n);
      expect(await fallos(admin)).toBe(4);
      const acierto = await pedir(desdeOtraIp(n), "POST", "/api/auth/two-factor/verify-totp", {
        code: codigoDeLaAplicacion(alta.secreto, new Date(), 1),
      });
      expect(acierto.estado).toBe(200);
      expect(await fallos(admin)).toBe(0);
      for (let i = 0; i < 4; i++) expect((await malo(n)).estado).toBe(401);
      expect((await malo(n)).estado).toBe(401); // el quinto desde el acierto: todavía no bloquea el pedido, bloquea el siguiente
      expect((await malo(n)).estado).toBe(429);
    });

    it("la ventana es de 10 minutos: cuatro fallos viejos (11 minutos) más uno nuevo no bloquean; cuatro de hace 9 más uno nuevo, sí", async () => {
      const { admin } = await enrolado();
      const n = await sesionNueva(admin);
      const id = await usuarioId(admin);
      const sembrar = async (haceMin: number) => {
        await dueno.query(
          `delete from autenticacion.intento_segundo_factor where usuario_id = $1`,
          [id],
        );
        for (let i = 0; i < 4; i++) {
          await dueno.query(
            `insert into autenticacion.intento_segundo_factor (usuario_id, fallo_en) values ($1, now() - ($2 || ' minutes')::interval)`,
            [id, String(haceMin - i * 0.01)],
          );
        }
      };
      await sembrar(11);
      expect((await malo(n)).estado).toBe(401);
      expect((await malo(n)).estado).toBe(401);
      await sembrar(9);
      expect((await malo(n)).estado).toBe(401); // el quinto de la ventana
      expect((await malo(n)).estado).toBe(429);
    });

    it("el bloqueo dura 15 minutos: a los 16 se puede de nuevo y un acierto entra", async () => {
      const { admin, alta } = await enrolado();
      const n = await sesionNueva(admin);
      for (let i = 0; i < 5; i++) await malo(n);
      expect((await malo(n)).estado).toBe(429);
      const id = await usuarioId(admin);
      // Pasan 14 minutos (queda 1): sigue bloqueado.
      await dueno.query(
        `update autenticacion.intento_segundo_factor set fallo_en = fallo_en - interval '14 minutes' where usuario_id = $1`,
        [id],
      );
      expect((await malo(n)).estado).toBe(429);
      // Pasan 2 minutos más (16): se libera.
      await dueno.query(
        `update autenticacion.intento_segundo_factor set fallo_en = fallo_en - interval '2 minutes' where usuario_id = $1`,
        [id],
      );
      const entra = await pedir(desdeOtraIp(n), "POST", "/api/auth/two-factor/verify-totp", {
        code: codigoDeLaAplicacion(alta.secreto, new Date(), 1),
      });
      expect(entra.estado).toBe(200);
      expect(await fallos(admin)).toBe(0);
    });

    it("el bloqueo queda en la auditoría de plataforma UNA vez, a nombre del sistema, con solo hasta cuándo y cuántos fallos", async () => {
      const { admin, alta } = await enrolado();
      const n = await sesionNueva(admin);
      for (let i = 0; i < 5; i++) await malo(n);
      for (let i = 0; i < 4; i++) await malo(n); // pedidos rechazados: no repiten la constancia
      const filas = await bloqueosAuditados(admin);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        actor: "sistema",
        accion: "SEGUNDO_FACTOR_BLOQUEADO",
        entidad: "admin_plataforma",
        entidad_id: admin.adminId,
        antes: null,
      });
      expect(Object.keys(filas[0]?.despues ?? {}).sort()).toEqual(["bloqueadoHasta", "fallos"]);
      expect(filas[0]?.despues.fallos).toBe(5);
      const hasta = new Date(filas[0]?.despues.bloqueadoHasta ?? "").getTime();
      expect(hasta).toBeGreaterThan(Date.now() + 14 * MINUTO);
      expect(hasta).toBeLessThanOrEqual(Date.now() + 15 * MINUTO);
      // Sin datos sensibles: ni el email, ni el código, ni el secreto, ni la dirección.
      const texto = JSON.stringify(filas);
      for (const centinela of [
        admin.email,
        "000000",
        alta.secreto,
        "otpauth",
        ...alta.codigosDeRecuperacion,
        p.secreto,
      ]) {
        expect(texto).not.toContain(centinela);
      }
    });

    it("el quinto fallo que era un acierto NO bloquea ni audita (solo se audita un bloqueo que ocurrió)", async () => {
      const { admin, alta } = await enrolado();
      const n = await sesionNueva(admin);
      for (let i = 0; i < 4; i++) await malo(n);
      const acierto = await pedir(desdeOtraIp(n), "POST", "/api/auth/two-factor/verify-totp", {
        code: codigoDeLaAplicacion(alta.secreto, new Date(), 1),
      });
      expect(acierto.estado).toBe(200);
      expect(await bloqueosAuditados(admin)).toEqual([]);
    });

    it("si la auditoría falla, el bloqueo IGUAL rige y el motivo queda en el registro del servidor (sin datos sensibles)", async () => {
      const rota = armarPlataformaDePrueba(propia.base, proveedor, {
        auditoria: {
          registrarBloqueoDeSegundoFactor: () => Promise.reject(new Error("auditoría caída")),
        },
      });
      try {
        const admin = await altaDeAdmin(dueno);
        const n = new Navegador();
        await n.ingresarConGoogle(rota.autenticacion, HOST, proveedor, admin);
        const alta = (
          await n.pedir(rota.autenticacion, HOST, "POST", "/api/auth/two-factor/enable", {
            cuerpo: {},
          })
        ).json() as Alta;
        await n.pedir(rota.autenticacion, HOST, "POST", "/api/auth/two-factor/verify-totp", {
          cuerpo: { code: codigoDeLaAplicacion(alta.secreto) },
        });
        const nuevo = new Navegador();
        await nuevo.ingresarConGoogle(rota.autenticacion, HOST, proveedor, admin);
        for (let i = 0; i < 5; i++) {
          const r = await otroNavegadorConLaSesion(nuevo, HOST).pedir(
            rota.autenticacion,
            HOST,
            "POST",
            "/api/auth/two-factor/verify-totp",
            {
              cuerpo: { code: "000000" },
            },
          );
          expect(r.estado).toBe(401);
        }
        const bloqueado = await otroNavegadorConLaSesion(nuevo, HOST).pedir(
          rota.autenticacion,
          HOST,
          "POST",
          "/api/auth/two-factor/verify-totp",
          {
            cuerpo: { code: "000000" },
          },
        );
        expect(bloqueado.estado).toBe(429);
        const registro = rota.registros.join("\n");
        expect(registro).toContain("no se pudo auditar el bloqueo del segundo factor");
        expect(registro).not.toContain(admin.email);
        expect(registro).not.toContain("000000");
      } finally {
        await rota.cerrar();
      }
    });

    it("los códigos mal formados no cuentan como intento (400 sin tocar la base): no se puede bloquear a alguien con basura", async () => {
      const { admin } = await enrolado();
      const n = await sesionNueva(admin);
      for (let i = 0; i < 8; i++) {
        const r = await pedir(desdeOtraIp(n), "POST", "/api/auth/two-factor/verify-totp", {
          code: "abc",
        });
        expect(r.estado).toBe(400);
      }
      expect(await fallos(admin)).toBe(0);
    });
  });

  // =============================================================================================
  // Los intentos y los pasos se limpian solos; el borrado de un usuario arrastra todo
  // =============================================================================================
  describe("limpieza", () => {
    it("cada intento borra lo viejo de ese usuario: fallos de más de 25 minutos y pasos de TOTP de más de un día", async () => {
      const { admin } = await enrolado();
      const n = await sesionNueva(admin);
      const id = await usuarioId(admin);
      await dueno.query(
        `insert into autenticacion.intento_segundo_factor (usuario_id, fallo_en) values ($1, now() - interval '26 minutes')`,
        [id],
      );
      await dueno.query(
        `insert into autenticacion.codigo_totp_usado (usuario_id, paso, usado_en) values ($1, 1, now() - interval '25 hours'), ($1, 2, now() - interval '23 hours')`,
        [id],
      );
      await malo(n);
      expect(await fallos(admin)).toBe(1); // el de 26 minutos se fue; quedó el nuevo
      const pasos = (
        await dueno.query<{ paso: string }>(
          `select paso from autenticacion.codigo_totp_usado where usuario_id = $1 and paso in (1, 2) order by paso`,
          [id],
        )
      ).rows;
      expect(pasos.map((x) => x.paso)).toEqual(["2"]);
    });

    it("al borrar un usuario (lo hace el dueño) se van con él su segundo factor, sus pasos y sus intentos", async () => {
      const { admin } = await enrolado();
      const n = await sesionNueva(admin);
      await malo(n);
      const id = await usuarioId(admin);
      await dueno.query(`delete from autenticacion."user" where id = $1`, [id]);
      for (const tabla of ["twoFactor", "codigo_totp_usado", "intento_segundo_factor"]) {
        const col = tabla === "twoFactor" ? `"userId"` : "usuario_id";
        const { rows } = await dueno.query(
          `select 1 from autenticacion."${tabla}" where ${col} = $1`,
          [id],
        );
        expect(rows, tabla).toEqual([]);
      }
    });
  });
});
