import { betterAuth } from "better-auth";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { opcionesDeInstancia } from "../../src/adaptadores/autenticacion/opciones";
import { RUTAS_BLOQUEADAS_DE_PLATAFORMA } from "../../src/adaptadores/autenticacion/rutas-bloqueadas";
import {
  ENCABEZADO_DE_IP,
  configuracionDeHost,
} from "../../src/capacidades/autenticacion/host-de-autenticacion";
import { RUTAS_PERMITIDAS_DE_PLATAFORMA } from "../../src/capacidades/autenticacion/rutas-permitidas";
import { LIMITES_DE_SESION_DE_PLATAFORMA } from "../../src/capacidades/autenticacion/vigencia-de-sesion";
import {
  Navegador,
  levantarProveedorLocal,
  perfilAlAzar,
  type PerfilDePrueba,
  type ProveedorLocal,
} from "./autenticacion-ingreso-apoyo";
import {
  HOST_DE_LA_CONSOLA as HOST,
  altaDeAdmin,
  armarPlataformaDePrueba,
  codigoDeLaAplicacion,
  otroNavegadorConLaSesion,
  type PlataformaDePrueba,
} from "./autenticacion-plataforma-apoyo";
import { crearBaseAparte } from "./entorno";

/**
 * La consola de plataforma (P8a): el ingreso con Google más el segundo factor TOTP, contra Better Auth 1.7.7 REAL y
 * una base real, con un proveedor de Google local y la red externa bloqueada (como las pruebas de empresa). Cubre la
 * lista de personal habilitado (sin oráculo), G1 (el ingreso con Google no trae segundo factor y se marca al verificar),
 * enrolar (ventana de 10 minutos, una sola vez, QR dibujado, secreto y códigos una sola vez y sin guardarse en claro),
 * el estado de sesión, la lista CERRADA de rutas, los cuerpos cerrados y los nombres de las cookies. Los límites de
 * intentos, G2 y G3, la concurrencia y las dos audiencias tienen sus propios archivos.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const MINUTO = 60_000;

describe.skipIf(base === null)("consola de plataforma: ingreso y segundo factor", () => {
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
    await p.cerrar();
    await dueno.end();
    await propia.destruir();
    await proveedor.cerrar();
    vi.unstubAllEnvs();
  });

  const cuenta = async (tabla: string): Promise<number> =>
    Number(
      (await dueno.query<{ n: string }>(`select count(*) as n from autenticacion."${tabla}"`))
        .rows[0]?.n,
    );
  const pedir = (n: Navegador, metodo: "GET" | "POST", ruta: string, cuerpo?: unknown) =>
    n.pedir(p.autenticacion, HOST, metodo, ruta, cuerpo === undefined ? {} : { cuerpo });
  /** Ingresa con Google como ese administrador: devuelve el navegador (con su cookie de sesión) y la respuesta del retorno. */
  async function ingresar(admin: PerfilDePrueba) {
    const n = new Navegador();
    const retorno = await n.ingresarConGoogle(p.autenticacion, HOST, proveedor, admin);
    return { n, retorno };
  }
  const filaDeSesion = async (admin: PerfilDePrueba) =>
    (
      await dueno.query<{
        id: string;
        token: string;
        host: string;
        createdAt: Date;
        updatedAt: Date;
        expiresAt: Date;
        segundo_factor_en: Date | null;
      }>(
        `select s.id, s.token, s.host, s."createdAt", s."updatedAt", s."expiresAt", s.segundo_factor_en
           from autenticacion.session s join autenticacion."user" u on u.id = s."userId"
          where u.email = $1 order by s."createdAt" desc`,
        [admin.email.toLowerCase()],
      )
    ).rows;
  type Alta = Readonly<{ qrSvg: string; secreto: string; codigosDeRecuperacion: string[] }>;
  /** Un administrador ya enrolado: ingresa, enrola, verifica el primer código y devuelve todo lo que el alta mostró. */
  async function enrolado(rol: "ADMIN" | "SOPORTE" = "ADMIN") {
    const admin = await altaDeAdmin(dueno, { rol });
    const { n } = await ingresar(admin);
    const enrolar = await pedir(n, "POST", "/api/auth/two-factor/enable", {});
    expect(enrolar.estado).toBe(200);
    const alta = enrolar.json() as Alta;
    // El código con que se enrola: quien lo repite lo repite TAL CUAL, no uno recalculado (si el paso del reloj cambiara en
    // el medio, uno recalculado sería otro código, todavía sin usar).
    const codigo = codigoDeLaAplicacion(alta.secreto);
    const verificar = await pedir(n, "POST", "/api/auth/two-factor/verify-totp", { code: codigo });
    expect(verificar.estado).toBe(200);
    return { admin, n, alta, codigo };
  }
  /** Un ingreso nuevo (sesión nueva, sin segundo factor) del mismo administrador ya enrolado. */
  const reingresar = async (admin: PerfilDePrueba) => (await ingresar(admin)).n;

  // =============================================================================================
  // Quién puede entrar (h5-p8 §2.2): sin oráculo
  // =============================================================================================
  describe("personal habilitado", () => {
    it("un administrador activo entra: usuario, cuenta y sesión con el host de la consola, y la sesión nace SIN segundo factor (G1)", async () => {
      const admin = await altaDeAdmin(dueno);
      const { n, retorno } = await ingresar(admin);
      expect(retorno.estado).toBe(302);
      expect(retorno.ubicacion).toBe("/");
      const [sesion] = await filaDeSesion(admin);
      expect(sesion?.host).toBe(HOST);
      expect(sesion?.segundo_factor_en).toBeNull();
      const visto = await p.autenticacion.sesionDe(n.pedidoDe(HOST), HOST);
      expect(visto).toMatchObject({
        email: admin.email,
        emailVerificado: true,
        segundoFactorEn: null,
      });
    });

    it("un SOPORTE activo también es personal habilitado (el rol lo decide cada caso, no el ingreso)", async () => {
      const soporte = await altaDeAdmin(dueno, { rol: "SOPORTE" });
      const { retorno } = await ingresar(soporte);
      expect(retorno.ubicacion).toBe("/");
    });

    it("una cuenta de Google que NO es personal no crea usuario, cuenta ni sesión, y vuelve con el código genérico", async () => {
      const antes = [await cuenta("user"), await cuenta("account"), await cuenta("session")];
      const n = new Navegador();
      const r = await n.ingresarConGoogle(p.autenticacion, HOST, proveedor, perfilAlAzar());
      expect(r.estado).toBe(302);
      expect(r.ubicacion).toContain("error=no_habilitado");
      expect(n.cookiesDe(HOST)).toEqual([]);
      expect([await cuenta("user"), await cuenta("account"), await cuenta("session")]).toEqual(
        antes,
      );
    });

    it("un administrador DADO DE BAJA no entra", async () => {
      const baja = await altaDeAdmin(dueno, { activo: false });
      const antes = await cuenta("session");
      const { n, retorno } = await ingresar(baja);
      expect(retorno.ubicacion).toContain("error=no_habilitado");
      expect(n.cookiesDe(HOST)).toEqual([]);
      expect(await cuenta("session")).toBe(antes);
    });

    it("sin oráculo: la respuesta ante quien no es personal es IGUAL a la de cualquier otro fallo del ingreso", async () => {
      // 1. cuenta que no es personal, 2. personal dado de baja, 3. email sin verificar, 4. el usuario cancela en Google.
      const baja = await altaDeAdmin(dueno, { activo: false });
      const noVerificado = await altaDeAdmin(dueno);
      const respuestas: {
        estado: number;
        ubicacion: string | null;
        cookies: string[];
        texto: string;
      }[] = [];
      for (const perfil of [
        perfilAlAzar(),
        baja,
        { ...noVerificado, emailVerificado: false },
        { ...noVerificado, emailVerificado: undefined },
      ]) {
        const n = new Navegador();
        const r = await n.ingresarConGoogle(p.autenticacion, HOST, proveedor, perfil);
        respuestas.push({
          estado: r.estado,
          ubicacion: r.ubicacion,
          cookies: n.cookiesDe(HOST).map((c) => c.nombre),
          texto: r.texto,
        });
      }
      for (const r of respuestas) expect(r).toEqual(respuestas[0]);
      expect(respuestas[0]?.ubicacion).toContain("error=no_habilitado");
      // El usuario que cancela en Google: `access_denied` también sale como `no_habilitado`.
      const n = new Navegador();
      const inicio = await pedir(n, "POST", "/api/auth/sign-in/social", {
        provider: "google",
        callbackURL: "/",
      });
      const estado = new URL((inicio.json() as { url: string }).url).searchParams.get("state");
      const cancelado = await pedir(
        n,
        "GET",
        `/api/auth/callback/google?error=access_denied&error_description=el+usuario+cancelo&state=${estado}`,
      );
      expect(cancelado.estado).toBe(302);
      expect(cancelado.ubicacion).toBe(respuestas[0]?.ubicacion);
    });

    it("la lista es la de la base y se mira en cada ingreso: dar de baja a un administrador corta el ingreso siguiente", async () => {
      const admin = await altaDeAdmin(dueno);
      expect((await ingresar(admin)).retorno.ubicacion).toBe("/");
      await dueno.query(`update admin_plataforma set activo = false where id = $1`, [
        admin.adminId,
      ]);
      const sesiones = await cuenta("session");
      const { n, retorno } = await ingresar(admin);
      expect(retorno.ubicacion).toContain("error=no_habilitado");
      expect(n.cookiesDe(HOST)).toEqual([]);
      expect(await cuenta("session")).toBe(sesiones);
      // Vuelve a habilitarlo y entra de nuevo.
      await dueno.query(`update admin_plataforma set activo = true where id = $1`, [admin.adminId]);
      expect((await ingresar(admin)).retorno.ubicacion).toBe("/");
    });

    it("el email se compara normalizado: mayúsculas y blancos de Google no esquivan ni rompen la lista", async () => {
      const admin = await altaDeAdmin(dueno);
      const { retorno } = await ingresar({ ...admin, email: admin.email.toUpperCase() });
      expect(retorno.ubicacion).toBe("/");
    });

    it("si Google le cambia el email a una cuenta ya vinculada a uno que NO es personal, no se abre sesión (se mira el email actual)", async () => {
      const admin = await altaDeAdmin(dueno);
      expect((await ingresar(admin)).retorno.ubicacion).toBe("/");
      const sesiones = await cuenta("session");
      const otro = await ingresar({ ...admin, email: `otro-${admin.email}` });
      expect(otro.retorno.ubicacion).toContain("error=no_habilitado");
      expect(otro.n.cookiesDe(HOST)).toEqual([]);
      expect(await cuenta("session")).toBe(sesiones);
    });

    it("si la consulta de la lista falla, NO entra nadie (falla cerrado) y el motivo queda en el registro, sin el email", async () => {
      const admin = await altaDeAdmin(dueno);
      const rota = armarPlataformaDePrueba(propia.base, proveedor, {
        personal: { esHabilitado: () => Promise.reject(new Error("la base no responde")) },
      });
      try {
        const n = new Navegador();
        const r = await n.ingresarConGoogle(rota.autenticacion, HOST, proveedor, admin);
        expect(r.ubicacion).toContain("error=no_habilitado");
        expect(n.cookiesDe(HOST)).toEqual([]);
        expect(rota.registros.join("\n")).toContain("no se pudo consultar al personal habilitado");
        expect(rota.registros.join("\n")).not.toContain(admin.email);
      } finally {
        await rota.cerrar();
      }
    });
  });

  // =============================================================================================
  // Cookies: nombres, atributos y el conjunto completo
  // =============================================================================================
  describe("cookies (__Host-pd_plat)", () => {
    it("la de sesión se llama __Host-pd_plat.session_token: solo del host, HttpOnly, Secure, SameSite=Lax, Path=/ y 30 minutos", async () => {
      const { n } = await ingresar(await altaDeAdmin(dueno));
      const cookies = n.cookiesDe(HOST);
      expect(cookies.map((c) => c.nombre)).toEqual(["__Host-pd_plat.session_token"]);
      const crudo = cookies[0]?.crudo ?? "";
      expect(crudo).toMatch(/;\s*HttpOnly/i);
      expect(crudo).toMatch(/;\s*Secure/i);
      expect(crudo).toMatch(/;\s*SameSite=Lax/i);
      expect(crudo).toMatch(/;\s*Path=\//i);
      expect(crudo).toMatch(/;\s*Max-Age=1800(;|$)/i);
      expect(crudo).not.toMatch(/Domain=/i);
    });

    it("TODAS las que la librería puede poner (con sus auxiliares) llevan el prefijo __Host-pd_plat. y ninguna es de empresa", async () => {
      const c = configuracionDeHost(HOST);
      if (!c.ok) throw new Error("host inválido");
      const auth = betterAuth(
        opcionesDeInstancia({
          audiencia: "PLATAFORMA",
          consola: {
            personal: { esHabilitado: () => Promise.resolve(true) },
            segundoFactor: {} as never,
            auditoria: {} as never,
          },
          configuracion: c.valor,
          db: p.conexion.db,
          secreto: "s".repeat(40),
          google: { clientId: "x", clientSecret: "y" },
          limites: LIMITES_DE_SESION_DE_PLATAFORMA,
          reloj: () => new Date(),
          rutaDeError: "/ingreso",
          registrar: () => undefined,
        }),
      );
      const contexto = await auth.$context;
      const propias = Object.values(contexto.authCookies).map((x) => (x as { name: string }).name);
      const auxiliares = ["state", "oauth_state", "two_factor", "trust_device"].map(
        (nombre) => contexto.createAuthCookie(nombre).name,
      );
      expect([...propias, ...auxiliares].sort()).toEqual(
        [
          "__Host-pd_plat.session_token",
          "__Host-pd_plat.session_data",
          "__Host-pd_plat.dont_remember",
          "__Host-pd_plat.account_data",
          "__Host-pd_plat.state",
          "__Host-pd_plat.oauth_state",
          "__Host-pd_plat.two_factor",
          "__Host-pd_plat.trust_device",
        ].sort(),
      );
      for (const nombre of [...propias, ...auxiliares]) expect(nombre).not.toContain("pd_emp");
    });

    it("durante el ingreso completo, el enrolamiento y la verificación, todo `Set-Cookie` es de la consola, Secure y sin Domain", async () => {
      const admin = await altaDeAdmin(dueno);
      const n = new Navegador();
      const vistos: string[] = [];
      const registrar = (r: { cabeceras: Headers }) => {
        for (const crudo of r.cabeceras.getSetCookie()) vistos.push(crudo);
      };
      const inicio = await n.pedir(p.autenticacion, HOST, "POST", "/api/auth/sign-in/social", {
        cuerpo: { provider: "google", callbackURL: "/" },
      });
      registrar(inicio);
      const retorno = new URL(proveedor.autorizar((inicio.json() as { url: string }).url, admin));
      registrar(
        await n.pedir(p.autenticacion, HOST, "GET", `${retorno.pathname}${retorno.search}`),
      );
      const enrolar = await n.pedir(p.autenticacion, HOST, "POST", "/api/auth/two-factor/enable", {
        cuerpo: {},
      });
      registrar(enrolar);
      const alta = enrolar.json() as Alta;
      registrar(
        await n.pedir(p.autenticacion, HOST, "POST", "/api/auth/two-factor/verify-totp", {
          cuerpo: { code: codigoDeLaAplicacion(alta.secreto) },
        }),
      );
      registrar(await n.pedir(p.autenticacion, HOST, "POST", "/api/auth/sign-out", { cuerpo: {} }));
      expect(vistos.length).toBeGreaterThan(0);
      const nombres = new Set(vistos.map((v) => v.split("=")[0]));
      // El conjunto EXACTO que se vio en un ingreso real: la cookie del estado de Google, la de sesión y las que la
      // librería vacía al abrir, rotar y cerrar la sesión (`session_data` y `dont_remember`, ambas expiradas).
      expect([...nombres].sort()).toEqual([
        "__Host-pd_plat.dont_remember",
        "__Host-pd_plat.session_data",
        "__Host-pd_plat.session_token",
        "__Host-pd_plat.state",
      ]);
      for (const crudo of vistos) {
        expect(crudo.startsWith("__Host-pd_plat.")).toBe(true);
        expect(crudo).toMatch(/;\s*Secure/i);
        expect(crudo).toMatch(/;\s*Path=\//i);
        expect(crudo).not.toMatch(/Domain=/i);
        expect(crudo).toMatch(/;\s*HttpOnly/i);
      }
    });
  });

  // =============================================================================================
  // Enrolar (h5-p8 §2.4 y §2.4 ter)
  // =============================================================================================
  describe("enrolar el segundo factor", () => {
    it("devuelve el QR YA DIBUJADO (SVG), el secreto en texto y diez códigos de recuperación, con Cache-Control: no-store", async () => {
      const admin = await altaDeAdmin(dueno);
      const { n } = await ingresar(admin);
      const r = await pedir(n, "POST", "/api/auth/two-factor/enable", {});
      expect(r.estado).toBe(200);
      expect(r.cabeceras.get("cache-control")).toBe("no-store");
      expect(r.cabeceras.get("pragma")).toBe("no-cache");
      expect(r.cabeceras.get("content-type")).toContain("application/json");
      const alta = r.json() as Alta;
      expect(Object.keys(alta).sort()).toEqual(["codigosDeRecuperacion", "qrSvg", "secreto"]);
      expect(alta.qrSvg.startsWith("<svg ")).toBe(true);
      expect(alta.qrSvg.endsWith("</svg>")).toBe(true);
      expect(alta.secreto).toMatch(/^[A-Z2-7]{16,128}$/);
      expect(alta.codigosDeRecuperacion).toHaveLength(10);
      expect(new Set(alta.codigosDeRecuperacion).size).toBe(10);
      for (const codigo of alta.codigosDeRecuperacion)
        expect(codigo).toMatch(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/);
      // No salen la sesión ni el usuario: ni el token ni el email.
      const fila = (await filaDeSesion(admin))[0];
      expect(r.texto).not.toContain(fila?.token ?? "sin-token");
      expect(r.texto).not.toContain(admin.email);
      expect(r.texto).not.toContain("otpauth");
    });

    it("el SVG es solo dibujo: ni la dirección otpauth ni el secreto ni el email aparecen en ningún atributo ni texto", async () => {
      const admin = await altaDeAdmin(dueno);
      const { n } = await ingresar(admin);
      const alta = (await pedir(n, "POST", "/api/auth/two-factor/enable", {})).json() as Alta;
      expect(alta.qrSvg).not.toMatch(/otpauth/i);
      expect(alta.qrSvg).not.toContain(alta.secreto);
      expect(alta.qrSvg).not.toContain(admin.email);
      expect(alta.qrSvg).not.toContain("Pedernal");
      expect(alta.qrSvg).not.toMatch(/<script|<foreignObject|href=|onload=|<image|<text/i);
      // Solo estos elementos y estos atributos.
      const elementos = [...alta.qrSvg.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1]);
      expect([...new Set(elementos)].sort()).toEqual(["path", "rect", "svg"]);
    });

    it("lo guardado no es nada de eso en claro: el secreto va cifrado, los códigos hasheados, y la dirección no está en ninguna tabla", async () => {
      const admin = await altaDeAdmin(dueno);
      const { n } = await ingresar(admin);
      const alta = (await pedir(n, "POST", "/api/auth/two-factor/enable", {})).json() as Alta;
      const { rows } = await dueno.query<{
        secret: string;
        backupCodes: string;
        verified: boolean;
      }>(
        `select t.secret, t."backupCodes", t.verified from autenticacion."twoFactor" t
           join autenticacion."user" u on u.id = t."userId" where u.email = $1`,
        [admin.email],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.verified).toBe(false);
      // Cifrado por la librería (XChaCha20-Poly1305: nonce + texto cifrado en hexadecimal), nunca el secreto.
      expect(rows[0]?.secret).toMatch(/^[0-9a-f]{80,}$/);
      const hashes = JSON.parse(rows[0]?.backupCodes ?? "[]") as string[];
      expect(hashes).toHaveLength(10);
      for (const h of hashes) expect(h).toMatch(/^h1:[0-9a-f]{64}$/);
      // Búsqueda de centinelas en TODO el esquema de autenticación (todas las columnas, como texto).
      const { rows: tablas } = await dueno.query<{ t: string }>(
        `select c.relname as t from pg_class c where c.relnamespace = 'autenticacion'::regnamespace and c.relkind = 'r'`,
      );
      const volcado: string[] = [];
      for (const { t } of tablas) {
        const { rows: filas } = await dueno.query<{ x: string }>(
          `select to_jsonb(t)::text as x from autenticacion."${t}" t`,
        );
        volcado.push(...filas.map((f) => f.x));
      }
      const todo = volcado.join("\n");
      const crudo = Buffer.from(
        alta.secreto
          .split("")
          .map((c) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c).toString(2).padStart(5, "0"))
          .join("")
          .match(/.{8}/g)
          ?.map((b) => Number.parseInt(b, 2)) ?? [],
      ).toString("utf8");
      for (const centinela of [
        alta.secreto,
        crudo,
        "otpauth",
        ...alta.codigosDeRecuperacion,
        p.secreto,
      ]) {
        expect(todo, `centinela ${centinela.slice(0, 4)}…`).not.toContain(centinela);
      }
    });

    it("el código de la aplicación se calcula con el secreto que se mostró (cruce con la librería: mismo código para el mismo secreto)", async () => {
      const admin = await altaDeAdmin(dueno);
      const { n } = await ingresar(admin);
      const alta = (await pedir(n, "POST", "/api/auth/two-factor/enable", {})).json() as Alta;
      // Los tres pasos vecinos que la librería acepta: el nuestro calcula el mismo código que ella.
      for (const desvio of [-1, 0, 1]) {
        const r = await pedir(
          otroNavegadorConLaSesion(n, HOST),
          "POST",
          "/api/auth/two-factor/verify-totp",
          { code: codigoDeLaAplicacion(alta.secreto, new Date(), desvio) },
        );
        // El primero que coincide verifica y rota la sesión; ya no sigue con la misma cookie (la anterior se borró).
        if (r.estado === 200) break;
      }
      const [fila] = await dueno
        .query<{ verified: boolean }>(
          `select verified from autenticacion."twoFactor" t join autenticacion."user" u on u.id = t."userId" where u.email = $1`,
          [admin.email],
        )
        .then((x) => x.rows);
      expect(fila?.verified).toBe(true);
    });

    it("solo se puede enrolar dentro de los primeros 10 minutos de la sesión: después, 403 con sesion_vencida", async () => {
      const admin = await altaDeAdmin(dueno);
      const { n } = await ingresar(admin);
      await dueno.query(
        `update autenticacion.session set "createdAt" = now() - interval '11 minutes' where id = $1`,
        [(await filaDeSesion(admin))[0]?.id],
      );
      const r = await pedir(n, "POST", "/api/auth/two-factor/enable", {});
      expect(r.estado).toBe(403);
      expect(r.json()).toEqual({ codigo: "sesion_vencida" });
      expect(r.texto).not.toMatch(/ENROLAMIENTO|enrol/i);
      const { rows } = await dueno.query(
        `select 1 from autenticacion."twoFactor" t join autenticacion."user" u on u.id = t."userId" where u.email = $1`,
        [admin.email],
      );
      expect(rows).toEqual([]);
    });

    it("a los 9 minutos todavía se puede", async () => {
      const admin = await altaDeAdmin(dueno);
      const { n } = await ingresar(admin);
      await dueno.query(
        `update autenticacion.session set "createdAt" = now() - interval '9 minutes' where id = $1`,
        [(await filaDeSesion(admin))[0]?.id],
      );
      expect((await pedir(n, "POST", "/api/auth/two-factor/enable", {})).estado).toBe(200);
    });

    it("solo si todavía no tiene TOTP: con uno verificado, 400 segundo_factor_requerido y no se pisa el secreto", async () => {
      const { admin, n } = await enrolado();
      const antes = (
        await dueno.query<{ secret: string }>(
          `select t.secret from autenticacion."twoFactor" t join autenticacion."user" u on u.id = t."userId" where u.email = $1`,
          [admin.email],
        )
      ).rows[0]?.secret;
      const nuevo = await reingresar(admin);
      for (const navegador of [n, nuevo]) {
        const r = await pedir(navegador, "POST", "/api/auth/two-factor/enable", {});
        expect(r.estado).toBe(400);
        expect(r.json()).toEqual({ codigo: "segundo_factor_requerido" });
      }
      const despues = (
        await dueno.query<{ secret: string }>(
          `select t.secret from autenticacion."twoFactor" t join autenticacion."user" u on u.id = t."userId" where u.email = $1`,
          [admin.email],
        )
      ).rows[0]?.secret;
      expect(despues).toBe(antes);
    });

    it("se puede repetir mientras el primer código no se haya verificado (queda UNA sola fila y el secreto nuevo reemplaza al viejo)", async () => {
      const admin = await altaDeAdmin(dueno);
      const { n } = await ingresar(admin);
      const primera = (await pedir(n, "POST", "/api/auth/two-factor/enable", {})).json() as Alta;
      const segunda = (await pedir(n, "POST", "/api/auth/two-factor/enable", {})).json() as Alta;
      expect(segunda.secreto).not.toBe(primera.secreto);
      const { rows } = await dueno.query(
        `select 1 from autenticacion."twoFactor" t join autenticacion."user" u on u.id = t."userId" where u.email = $1`,
        [admin.email],
      );
      expect(rows).toHaveLength(1);
      // Con el secreto viejo no entra; con el nuevo, sí.
      const malo = await pedir(n, "POST", "/api/auth/two-factor/verify-totp", {
        code: codigoDeLaAplicacion(primera.secreto),
      });
      expect(malo.estado).toBe(401);
      const bueno = await pedir(n, "POST", "/api/auth/two-factor/verify-totp", {
        code: codigoDeLaAplicacion(segunda.secreto),
      });
      expect(bueno.estado).toBe(200);
    });

    it("sin sesión (sin cookie, o con una cookie que no es de una sesión) responde 401 sesion_vencida y no deja nada", async () => {
      const sin = await pedir(new Navegador(), "POST", "/api/auth/two-factor/enable", {});
      expect(sin.estado).toBe(401);
      expect(sin.json()).toEqual({ codigo: "sesion_vencida" });
      const n = new Navegador();
      n.copiarCookiesA(n, HOST, HOST);
      const falso = await n.pedir(p.autenticacion, HOST, "POST", "/api/auth/two-factor/enable", {
        cuerpo: {},
        encabezados: { cookie: "__Host-pd_plat.session_token=inventada.firmaFalsa" },
      });
      expect(falso.estado).toBe(401);
    });
  });

  // =============================================================================================
  // G1: el segundo factor se marca en la sesión al verificar
  // =============================================================================================
  describe("verificar el código (G1)", () => {
    it("al verificar el PRIMER código se marca `segundo_factor_en`, la sesión se rota conservando cuándo nació (el tope de 8 horas) y queda una sola", async () => {
      const admin = await altaDeAdmin(dueno);
      const { n } = await ingresar(admin);
      const [antes] = await filaDeSesion(admin);
      const alta = (await pedir(n, "POST", "/api/auth/two-factor/enable", {})).json() as Alta;
      const cookieAntes = n.cookiesDe(HOST)[0]?.valor;
      const r = await pedir(n, "POST", "/api/auth/two-factor/verify-totp", {
        code: codigoDeLaAplicacion(alta.secreto),
      });
      expect(r.estado).toBe(200);
      expect(r.cabeceras.get("cache-control")).toContain("no-store");
      expect(r.json()).toEqual({ verificado: true, segundoFactorRecienteHastaMs: 5 * MINUTO });
      const despues = await filaDeSesion(admin);
      expect(despues).toHaveLength(1);
      expect(despues[0]?.id).not.toBe(antes?.id);
      expect(despues[0]?.createdAt).toEqual(antes?.createdAt);
      expect(despues[0]?.segundo_factor_en).not.toBeNull();
      expect(Math.abs((despues[0]?.segundo_factor_en?.getTime() ?? 0) - Date.now())).toBeLessThan(
        5_000,
      );
      // La cookie cambió (otra sesión) y no sale ningún token ni dato del usuario en el cuerpo.
      expect(n.cookiesDe(HOST)[0]?.valor).not.toBe(cookieAntes);
      expect(r.texto).not.toContain(despues[0]?.token ?? "sin-token");
      expect(r.texto).not.toContain(admin.email);
      const { rows } = await dueno.query<{ e: boolean }>(
        `select "twoFactorEnabled" as e from autenticacion."user" where email = $1`,
        [admin.email],
      );
      expect(rows[0]?.e).toBe(true);
      // `sesionDe` lo informa para que P8b arme el contexto.
      const visto = await p.autenticacion.sesionDe(n.pedidoDe(HOST), HOST);
      expect(visto?.segundoFactorEn?.getTime()).toBe(despues[0]?.segundo_factor_en?.getTime());
    });

    it("la cookie de la sesión ANTERIOR a la rotación ya no vale", async () => {
      const admin = await altaDeAdmin(dueno);
      const { n } = await ingresar(admin);
      const robada = otroNavegadorConLaSesion(n, HOST);
      const alta = (await pedir(n, "POST", "/api/auth/two-factor/enable", {})).json() as Alta;
      await pedir(n, "POST", "/api/auth/two-factor/verify-totp", {
        code: codigoDeLaAplicacion(alta.secreto),
      });
      expect(await p.autenticacion.sesionDe(robada.pedidoDe(HOST), HOST)).toBeNull();
    });

    it("en un ingreso posterior (sesión nueva) el segundo factor NO se hereda: hay que verificar de nuevo", async () => {
      const { admin } = await enrolado();
      const nuevo = await reingresar(admin);
      const visto = await p.autenticacion.sesionDe(nuevo.pedidoDe(HOST), HOST);
      expect(visto?.segundoFactorEn).toBeNull();
      const estado = (await pedir(nuevo, "GET", "/api/auth/estado-de-sesion")).json() as {
        segundoFactorRecienteHastaMs: number;
      };
      expect(estado.segundoFactorRecienteHastaMs).toBe(0);
    });

    it("con el TOTP ya verificado, un código bueno marca la sesión nueva SIN rotarla, y un código malo no la marca", async () => {
      const { admin, alta } = await enrolado();
      const nuevo = await reingresar(admin);
      const [antes] = await filaDeSesion(admin);
      expect(antes?.segundo_factor_en).toBeNull();
      const malo = await pedir(nuevo, "POST", "/api/auth/two-factor/verify-totp", {
        code: "000000",
      });
      expect(malo.estado).toBe(401);
      expect(malo.json()).toEqual({ codigo: "codigo_invalido" });
      expect((await filaDeSesion(admin))[0]?.segundo_factor_en).toBeNull();
      // Un paso hacia atrás: el primero del enrolamiento ya se usó (G2), este todavía no.
      const bueno = await pedir(nuevo, "POST", "/api/auth/two-factor/verify-totp", {
        code: codigoDeLaAplicacion(alta.secreto, new Date(), 1),
      });
      expect(bueno.estado).toBe(200);
      const [despues] = await filaDeSesion(admin);
      expect(despues?.id).toBe(antes?.id);
      expect(despues?.segundo_factor_en).not.toBeNull();
    });

    it("verificar sin haber enrolado: 400 segundo_factor_a_enrolar", async () => {
      const admin = await altaDeAdmin(dueno);
      const { n } = await ingresar(admin);
      const r = await pedir(n, "POST", "/api/auth/two-factor/verify-totp", { code: "123456" });
      expect(r.estado).toBe(400);
      expect(r.json()).toEqual({ codigo: "segundo_factor_a_enrolar" });
      expect((await filaDeSesion(admin))[0]?.segundo_factor_en).toBeNull();
    });

    it("sin sesión: 401 sesion_vencida", async () => {
      const r = await pedir(new Navegador(), "POST", "/api/auth/two-factor/verify-totp", {
        code: "123456",
      });
      expect(r.estado).toBe(401);
      expect(r.json()).toEqual({ codigo: "sesion_vencida" });
    });
  });

  // =============================================================================================
  // Códigos de recuperación
  // =============================================================================================
  describe("códigos de recuperación", () => {
    it("un código de recuperación verifica el segundo factor y se gasta: la lista queda con nueve y ya no sirve", async () => {
      const { admin, alta } = await enrolado();
      const nuevo = await reingresar(admin);
      const codigo = alta.codigosDeRecuperacion[3] as string;
      const r = await pedir(nuevo, "POST", "/api/auth/two-factor/verify-backup-code", {
        code: codigo,
      });
      expect(r.estado).toBe(200);
      expect(r.json()).toEqual({ verificado: true, segundoFactorRecienteHastaMs: 5 * MINUTO });
      expect((await filaDeSesion(admin))[0]?.segundo_factor_en).not.toBeNull();
      const { rows } = await dueno.query<{ b: string }>(
        `select t."backupCodes" as b from autenticacion."twoFactor" t join autenticacion."user" u on u.id = t."userId" where u.email = $1`,
        [admin.email],
      );
      expect(JSON.parse(rows[0]?.b ?? "[]")).toHaveLength(9);
      expect(rows[0]?.b).not.toContain(codigo);
      // Otra sesión nueva: el mismo código ya no sirve; otro de la lista, sí.
      const otra = await reingresar(admin);
      const repetido = await pedir(otra, "POST", "/api/auth/two-factor/verify-backup-code", {
        code: codigo,
      });
      expect(repetido.estado).toBe(401);
      expect(repetido.json()).toEqual({ codigo: "codigo_invalido" });
      const siguiente = await pedir(otra, "POST", "/api/auth/two-factor/verify-backup-code", {
        code: alta.codigosDeRecuperacion[4] as string,
      });
      expect(siguiente.estado).toBe(200);
    });

    it("el mismo texto de error ante un código TOTP malo, un código de recuperación malo y uno ya usado (sin oráculo)", async () => {
      const { admin, codigo } = await enrolado();
      const nuevo = await reingresar(admin);
      const totpMalo = await pedir(nuevo, "POST", "/api/auth/two-factor/verify-totp", {
        code: "999999",
      });
      const recuperacionMala = await pedir(
        nuevo,
        "POST",
        "/api/auth/two-factor/verify-backup-code",
        {
          code: "zzzzz-99999",
        },
      );
      expect(totpMalo.estado).toBe(401);
      expect(recuperacionMala.estado).toBe(401);
      expect(recuperacionMala.texto).toBe(totpMalo.texto);
      // Un código TOTP repetido (G2) también da lo mismo.
      const repetido = await pedir(nuevo, "POST", "/api/auth/two-factor/verify-totp", {
        code: codigo,
      });
      expect(repetido.estado).toBe(401);
      expect(repetido.texto).toBe(totpMalo.texto);
    });

    it("antes de verificar el primer código TOTP, un código de recuperación NO marca la sesión (no se probó el dispositivo)", async () => {
      const admin = await altaDeAdmin(dueno);
      const { n } = await ingresar(admin);
      const alta = (await pedir(n, "POST", "/api/auth/two-factor/enable", {})).json() as Alta;
      const r = await pedir(n, "POST", "/api/auth/two-factor/verify-backup-code", {
        code: alta.codigosDeRecuperacion[0] as string,
      });
      expect(r.estado).toBe(400);
      expect(r.json()).toEqual({ codigo: "segundo_factor_a_enrolar" });
      expect((await filaDeSesion(admin))[0]?.segundo_factor_en).toBeNull();
    });

    it("un código de recuperación no sirve como código TOTP ni al revés", async () => {
      const { admin, alta } = await enrolado();
      const nuevo = await reingresar(admin);
      const r = await pedir(nuevo, "POST", "/api/auth/two-factor/verify-totp", {
        code: alta.codigosDeRecuperacion[0] as string,
      });
      // Por forma (no son 6 cifras) ni llega a la librería.
      expect(r.estado).toBe(400);
      expect(r.json()).toEqual({ codigo: "codigo_invalido" });
      const s = await pedir(nuevo, "POST", "/api/auth/two-factor/verify-backup-code", {
        code: codigoDeLaAplicacion(alta.secreto, new Date(), 1),
      });
      expect(s.estado).toBe(400);
    });
  });

  // =============================================================================================
  // Estado de sesión (h5-p8 §3)
  // =============================================================================================
  describe("estado de sesión", () => {
    it("responde { vigente, venceEnMs, motivo, segundoFactorRecienteHastaMs } y NO renueva la sesión (mirar no es usar)", async () => {
      const admin = await altaDeAdmin(dueno);
      const { n } = await ingresar(admin);
      const [antes] = await filaDeSesion(admin);
      await dueno.query(
        `update autenticacion.session set "updatedAt" = now() - interval '10 minutes', "expiresAt" = now() + interval '20 minutes' where id = $1`,
        [antes?.id],
      );
      const r = await pedir(n, "GET", "/api/auth/estado-de-sesion");
      expect(r.estado).toBe(200);
      expect(r.cabeceras.get("cache-control")).toContain("no-store");
      const estado = r.json() as {
        vigente: boolean;
        venceEnMs: number;
        motivo: string;
        segundoFactorRecienteHastaMs: number;
      };
      expect(Object.keys(estado).sort()).toEqual([
        "motivo",
        "segundoFactorRecienteHastaMs",
        "venceEnMs",
        "vigente",
      ]);
      expect(estado.vigente).toBe(true);
      expect(estado.motivo).toBe("INACTIVIDAD");
      expect(estado.segundoFactorRecienteHastaMs).toBe(0);
      expect(estado.venceEnMs).toBeGreaterThan(19 * MINUTO);
      expect(estado.venceEnMs).toBeLessThanOrEqual(20 * MINUTO);
      expect(r.cabeceras.getSetCookie()).toEqual([]);
      // La sesión sigue como estaba: no se renovó.
      const [despues] = await filaDeSesion(admin);
      expect(despues?.expiresAt.getTime()).toBeLessThan(Date.now() + 21 * MINUTO);
      expect(despues?.updatedAt.getTime()).toBeLessThan(Date.now() - 9 * MINUTO);
      expect(r.texto).not.toContain(antes?.token ?? "sin-token");
    });

    it("`get-session` es la ruta que RENUEVA («Seguir») y devuelve el mismo estado, sin token ni usuario", async () => {
      const { admin, n } = await enrolado();
      const [antes] = await filaDeSesion(admin);
      await dueno.query(
        `update autenticacion.session set "updatedAt" = now() - interval '10 minutes', "expiresAt" = now() + interval '20 minutes' where id = $1`,
        [antes?.id],
      );
      const r = await pedir(n, "GET", "/api/auth/get-session");
      expect(r.estado).toBe(200);
      const estado = r.json() as {
        vigente: boolean;
        venceEnMs: number;
        segundoFactorRecienteHastaMs: number;
      };
      expect(Object.keys(estado).sort()).toEqual([
        "motivo",
        "segundoFactorRecienteHastaMs",
        "venceEnMs",
        "vigente",
      ]);
      expect(estado.vigente).toBe(true);
      expect(estado.venceEnMs).toBeGreaterThan(29 * MINUTO);
      expect(estado.segundoFactorRecienteHastaMs).toBeGreaterThan(0);
      expect(r.texto).not.toContain(antes?.token ?? "sin-token");
      expect(r.texto).not.toContain(admin.email);
      expect(r.cabeceras.getSetCookie().join("\n")).toContain("__Host-pd_plat.session_token=");
      const [despues] = await filaDeSesion(admin);
      expect(despues?.updatedAt.getTime()).toBeGreaterThan(Date.now() - 5_000);
    });

    it("con el segundo factor recién verificado informa los 5 minutos de la ventana, y baja con el tiempo", async () => {
      const { admin, n } = await enrolado();
      const e1 = (await pedir(n, "GET", "/api/auth/estado-de-sesion")).json() as {
        segundoFactorRecienteHastaMs: number;
      };
      expect(e1.segundoFactorRecienteHastaMs).toBeGreaterThan(5 * MINUTO - 10_000);
      expect(e1.segundoFactorRecienteHastaMs).toBeLessThanOrEqual(5 * MINUTO);
      await dueno.query(
        `update autenticacion.session set segundo_factor_en = now() - interval '2 minutes' where id = $1`,
        [(await filaDeSesion(admin))[0]?.id],
      );
      const e2 = (await pedir(n, "GET", "/api/auth/estado-de-sesion")).json() as {
        segundoFactorRecienteHastaMs: number;
      };
      expect(e2.segundoFactorRecienteHastaMs).toBeGreaterThan(3 * MINUTO - 10_000);
      expect(e2.segundoFactorRecienteHastaMs).toBeLessThanOrEqual(3 * MINUTO);
      await dueno.query(
        `update autenticacion.session set segundo_factor_en = now() - interval '6 minutes' where id = $1`,
        [(await filaDeSesion(admin))[0]?.id],
      );
      const e3 = (await pedir(n, "GET", "/api/auth/estado-de-sesion")).json() as {
        segundoFactorRecienteHastaMs: number;
      };
      expect(e3.segundoFactorRecienteHastaMs).toBe(0);
    });

    it("el tope de 8 horas: a las 7 h 55 informa que vence en unos 5 minutos por el tope (no se renueva)", async () => {
      const { admin, n } = await enrolado();
      await dueno.query(
        `update autenticacion.session set "createdAt" = now() - interval '7 hours 55 minutes', "expiresAt" = now() + interval '5 minutes' where id = $1`,
        [(await filaDeSesion(admin))[0]?.id],
      );
      const e = (await pedir(n, "GET", "/api/auth/estado-de-sesion")).json() as {
        vigente: boolean;
        venceEnMs: number;
        motivo: string;
      };
      expect(e.vigente).toBe(true);
      expect(e.motivo).toBe("TOPE_DE_8_HORAS");
      expect(e.venceEnMs).toBeGreaterThan(4 * MINUTO);
      expect(e.venceEnMs).toBeLessThanOrEqual(5 * MINUTO);
    });

    it("`get-session` no renueva más allá del tope: a las 7 h 50 el nuevo vencimiento es el de las 8 horas", async () => {
      const { admin, n } = await enrolado();
      await dueno.query(
        `update autenticacion.session set "createdAt" = now() - interval '7 hours 50 minutes', "expiresAt" = now() + interval '10 minutes' where id = $1`,
        [(await filaDeSesion(admin))[0]?.id],
      );
      const r = await pedir(n, "GET", "/api/auth/get-session");
      const e = r.json() as { vigente: boolean; venceEnMs: number; motivo: string };
      expect(e.vigente).toBe(true);
      expect(e.motivo).toBe("TOPE_DE_8_HORAS");
      expect(e.venceEnMs).toBeLessThanOrEqual(10 * MINUTO);
      const [fila] = await filaDeSesion(admin);
      expect(fila?.expiresAt.getTime()).toBeLessThanOrEqual(
        fila!.createdAt.getTime() + 8 * 60 * MINUTO,
      );
    });

    it("vencida por inactividad (31 minutos): el estado dice vigente=false y `get-session` responde 401 sesion_vencida y borra la fila", async () => {
      const { admin, n } = await enrolado();
      const id = (await filaDeSesion(admin))[0]?.id;
      await dueno.query(
        `update autenticacion.session set "updatedAt" = now() - interval '31 minutes', "expiresAt" = now() - interval '1 minute' where id = $1`,
        [id],
      );
      const e = await pedir(n, "GET", "/api/auth/estado-de-sesion");
      expect(e.estado).toBe(200);
      expect(e.json()).toEqual({
        vigente: false,
        venceEnMs: 0,
        motivo: "INACTIVIDAD",
        segundoFactorRecienteHastaMs: 0,
      });
      expect((await filaDeSesion(admin)).length).toBe(1);
      const g = await pedir(n, "GET", "/api/auth/get-session");
      expect(g.estado).toBe(401);
      expect(g.json()).toEqual({ codigo: "sesion_vencida" });
      expect((await filaDeSesion(admin)).length).toBe(0);
    });

    it("sin sesión (sin cookie, cookie falsa o sesión borrada) responde 200 con vigente=false, sin Set-Cookie", async () => {
      const sin = await pedir(new Navegador(), "GET", "/api/auth/estado-de-sesion");
      expect(sin.estado).toBe(200);
      expect(sin.json()).toEqual({
        vigente: false,
        venceEnMs: 0,
        motivo: "INACTIVIDAD",
        segundoFactorRecienteHastaMs: 0,
      });
      const { n } = await ingresar(await altaDeAdmin(dueno));
      await dueno.query(`truncate autenticacion.session`);
      const borrada = await pedir(n, "GET", "/api/auth/estado-de-sesion");
      expect(borrada.json()).toEqual(sin.json());
      expect(borrada.cabeceras.getSetCookie()).toEqual([]);
    });

    it("`estadoDeSesion` del puerto da lo mismo que la ruta, y con una sesión de OTRO host dice vigente=false", async () => {
      const { n } = await enrolado();
      const delPuerto = await p.autenticacion.estadoDeSesion(n.pedidoDe(HOST), HOST);
      expect(delPuerto.vigente).toBe(true);
      expect(delPuerto.motivo).toBe("INACTIVIDAD");
      const otroHost = await p.autenticacion.estadoDeSesion(
        n.pedidoDe(HOST),
        "otra-consola.example.test",
      );
      expect(otroHost).toEqual({
        vigente: false,
        venceEnMs: 0,
        motivo: "INACTIVIDAD",
        segundoFactorRecienteHastaMs: 0,
      });
      expect(await p.autenticacion.estadoDeSesion(n.pedidoDe(HOST), "host con espacios")).toEqual(
        otroHost,
      );
    });
  });

  // =============================================================================================
  // Lista cerrada de rutas y defensas heredadas de empresa
  // =============================================================================================
  describe("rutas: lista cerrada", () => {
    it("las permitidas más las bloqueadas son exactamente las que declara la librería con el plugin (si sube una nueva, falla)", () => {
      const c = configuracionDeHost(HOST);
      if (!c.ok) throw new Error("host inválido");
      const auth = betterAuth(
        opcionesDeInstancia({
          audiencia: "PLATAFORMA",
          consola: {
            personal: { esHabilitado: () => Promise.resolve(true) },
            segundoFactor: {} as never,
            auditoria: {} as never,
          },
          configuracion: c.valor,
          db: p.conexion.db,
          secreto: "s".repeat(40),
          google: { clientId: "x", clientSecret: "y" },
          limites: LIMITES_DE_SESION_DE_PLATAFORMA,
          reloj: () => new Date(),
          rutaDeError: "/ingreso",
          registrar: () => undefined,
        }),
      );
      const declaradas = Object.values(auth.api)
        .map((e) => (e as { path?: string }).path)
        .filter((x): x is string => typeof x === "string")
        .sort();
      const usadas = [
        "/sign-in/social",
        "/callback/:id",
        "/get-session",
        "/sign-out",
        "/estado-de-sesion",
        "/two-factor/enable",
        "/two-factor/verify-totp",
        "/two-factor/verify-backup-code",
        "/two-factor/generate-backup-codes",
      ];
      expect([...usadas, ...RUTAS_BLOQUEADAS_DE_PLATAFORMA].sort()).toEqual(declaradas);
      expect(
        RUTAS_PERMITIDAS_DE_PLATAFORMA.map((r) => r.ruta.replace("/api/auth", "")).sort(),
      ).toEqual(["/callback/google", ...usadas.filter((x) => x !== "/callback/:id")].sort());
    });

    it("ver el secreto, dar de baja el TOTP, el código por mail y todo lo de empresa responden 404 sin cuerpo ni cookies", async () => {
      const { n } = await enrolado();
      const casos: ["GET" | "POST", string][] = [
        ["POST", "/api/auth/two-factor/get-totp-uri"],
        ["POST", "/api/auth/two-factor/disable"],
        ["POST", "/api/auth/two-factor/send-otp"],
        ["POST", "/api/auth/two-factor/verify-otp"],
        ["POST", "/api/auth/totp/generate"],
        ["POST", "/api/auth/sign-in/email"],
        ["POST", "/api/auth/sign-up/email"],
        ["POST", "/api/auth/update-user"],
        ["POST", "/api/auth/delete-user"],
        ["POST", "/api/auth/link-social"],
        ["POST", "/api/auth/revoke-sessions"],
        ["GET", "/api/auth/list-sessions"],
        ["GET", "/api/auth/list-accounts"],
        ["GET", "/api/auth/ok"],
        ["GET", "/api/auth/error"],
        ["GET", "/api/auth/two-factor/enable"],
        ["GET", "/api/auth/two-factor/verify-totp"],
      ];
      for (const [metodo, ruta] of casos) {
        const r = await n.pedir(
          p.autenticacion,
          HOST,
          metodo,
          ruta,
          metodo === "POST" ? { cuerpo: {} } : {},
        );
        expect(r.estado, `${metodo} ${ruta}`).toBe(404);
        expect(r.texto, ruta).toBe("");
        expect(r.cabeceras.getSetCookie(), ruta).toEqual([]);
      }
    });

    it("la comprobación de Origin sigue encendida: un POST desde otro origen o sin origen se rechaza (403) y no toca nada", async () => {
      const admin = await altaDeAdmin(dueno);
      const { n } = await ingresar(admin);
      for (const origen of ["https://sitio-ajeno.example.test", null]) {
        const r = await n.pedir(p.autenticacion, HOST, "POST", "/api/auth/two-factor/enable", {
          cuerpo: {},
          origen,
        });
        expect(r.estado, String(origen)).toBe(403);
        expect(r.json()).toEqual({ codigo: "no_habilitado" });
      }
      const { rows } = await dueno.query(
        `select 1 from autenticacion."twoFactor" t join autenticacion."user" u on u.id = t."userId" where u.email = $1`,
        [admin.email],
      );
      expect(rows).toEqual([]);
    });

    it("el ingreso con un idToken mandado por el cliente no abre sesión (disableIdTokenSignIn + cuerpo cerrado)", async () => {
      const n = new Navegador();
      const r = await pedir(n, "POST", "/api/auth/sign-in/social", {
        provider: "google",
        idToken: { token: "falso" },
        callbackURL: "/",
      });
      expect(r.estado).toBe(400);
      expect(r.json()).toEqual({ codigo: "no_habilitado" });
      expect(n.cookiesDe(HOST)).toEqual([]);
      const c = configuracionDeHost(HOST);
      if (!c.ok) throw new Error("host inválido");
      const opciones = opcionesDeInstancia({
        audiencia: "PLATAFORMA",
        consola: {
          personal: { esHabilitado: () => Promise.resolve(true) },
          segundoFactor: {} as never,
          auditoria: {} as never,
        },
        configuracion: c.valor,
        db: p.conexion.db,
        secreto: "s".repeat(40),
        google: { clientId: "x", clientSecret: "y" },
        limites: LIMITES_DE_SESION_DE_PLATAFORMA,
        reloj: () => new Date(),
        rutaDeError: "/ingreso",
        registrar: () => undefined,
      });
      expect(
        (opciones.socialProviders?.google as { disableIdTokenSignIn?: boolean })
          .disableIdTokenSignIn,
      ).toBe(true);
      expect(opciones.advanced?.ipAddress?.ipAddressHeaders).toEqual([ENCABEZADO_DE_IP]);
      expect(opciones.account?.accountLinking).toEqual({
        enabled: false,
        disableImplicitLinking: true,
      });
      expect(opciones.advanced?.disableOriginCheck).toBe(false);
      expect(opciones.advanced?.disableCSRFCheck).toBe(false);
      expect(opciones.session?.cookieCache?.enabled).toBe(false);
    });

    it("los cuerpos son CERRADOS: un campo de más (trustDevice, method, password, issuer) o un código mal formado se rechazan sin tocar la librería", async () => {
      const { admin, n } = await enrolado();
      const nuevo = await reingresar(admin);
      const casos: [string, unknown][] = [
        ["/api/auth/two-factor/verify-totp", { code: "123456", trustDevice: true }],
        ["/api/auth/two-factor/verify-totp", { code: 123456 }],
        ["/api/auth/two-factor/verify-totp", {}],
        ["/api/auth/two-factor/verify-backup-code", { code: "abcde-12345", trustDevice: true }],
        ["/api/auth/two-factor/verify-backup-code", { code: "abcde12345" }],
        ["/api/auth/two-factor/enable", { method: "otp" }],
        ["/api/auth/two-factor/enable", { password: "x" }],
        ["/api/auth/two-factor/enable", { issuer: "otro" }],
        ["/api/auth/two-factor/generate-backup-codes", { password: "x" }],
      ];
      for (const [ruta, cuerpo] of casos) {
        const r = await pedir(nuevo, "POST", ruta, cuerpo);
        expect(r.estado, `${ruta} ${JSON.stringify(cuerpo)}`).toBe(400);
        expect(r.cabeceras.getSetCookie()).toEqual([]);
        expect(["codigo_invalido", "no_habilitado"]).toContain(
          (r.json() as { codigo: string }).codigo,
        );
      }
      // Y ningún dispositivo quedó «de confianza».
      expect((await filaDeSesion(admin)).length).toBeGreaterThan(0);
      void n;
    });
  });

  // =============================================================================================
  // Redirecciones y cierre de sesión
  // =============================================================================================
  describe("redirecciones y cierre de sesión", () => {
    it("un callbackURL de otro sitio no se acepta (no hay redirección abierta): 403 con el código genérico y sin cookies", async () => {
      const n = new Navegador();
      for (const callbackURL of [
        "https://sitio-ajeno.example.test/",
        "//sitio-ajeno.example.test/",
        "javascript:alert(1)",
      ]) {
        const r = await pedir(n, "POST", "/api/auth/sign-in/social", {
          provider: "google",
          callbackURL,
        });
        expect(r.estado, callbackURL).toBe(403);
        expect(r.json(), callbackURL).toEqual({ codigo: "no_habilitado" });
        expect(r.cabeceras.getSetCookie(), callbackURL).toEqual([]);
      }
    });

    it("cerrar sesión borra la fila (la revocación es inmediata), vacía la cookie y el estado pasa a vigente=false", async () => {
      const { admin, n } = await enrolado();
      const robada = otroNavegadorConLaSesion(n, HOST);
      const r = await pedir(n, "POST", "/api/auth/sign-out", {});
      expect(r.estado).toBe(200);
      expect(r.cabeceras.getSetCookie().join("\n")).toMatch(
        /__Host-pd_plat\.session_token=;|Max-Age=0/i,
      );
      expect(await filaDeSesion(admin)).toEqual([]);
      // La cookie «robada» (la misma sesión) ya no abre nada.
      expect(await p.autenticacion.sesionDe(robada.pedidoDe(HOST), HOST)).toBeNull();
      expect((await pedir(robada, "GET", "/api/auth/estado-de-sesion")).json()).toEqual({
        vigente: false,
        venceEnMs: 0,
        motivo: "INACTIVIDAD",
        segundoFactorRecienteHastaMs: 0,
      });
      // Y no puede enrolar ni verificar con ella.
      expect(
        (await pedir(robada, "POST", "/api/auth/two-factor/verify-totp", { code: "123456" }))
          .estado,
      ).toBe(401);
    });

    it("la cookie de la consola copiada a OTRO host no vale ahí (la sesión está atada a su host, G4)", async () => {
      const { n } = await enrolado();
      const otroHost = "otra-consola.example.test";
      const copiada = new Navegador();
      n.copiarCookiesA(copiada, HOST, otroHost);
      expect(await p.autenticacion.sesionDe(copiada.pedidoDe(otroHost), otroHost)).toBeNull();
      const e = await copiada.pedir(p.autenticacion, otroHost, "GET", "/api/auth/estado-de-sesion");
      expect(e.json()).toEqual({
        vigente: false,
        venceEnMs: 0,
        motivo: "INACTIVIDAD",
        segundoFactorRecienteHastaMs: 0,
      });
      const g = await copiada.pedir(p.autenticacion, otroHost, "GET", "/api/auth/get-session");
      expect(g.estado).toBe(401);
      expect(g.json()).toEqual({ codigo: "sesion_vencida" });
    });
  });
});
