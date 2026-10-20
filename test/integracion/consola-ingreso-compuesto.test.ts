import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { ErrorDeEntorno } from "../../src/composicion/entorno";
import {
  armarIngresoDeConsola,
  type IngresoDeConsola,
} from "../../src/composicion/ingreso-de-consola";
import { empresaConMiembro, personaConUsuario } from "./autenticacion-apoyo";
import {
  Navegador,
  armarAutenticacionDePrueba,
  levantarProveedorLocal,
  perfilAlAzar,
  type AutenticacionDePrueba,
  type ProveedorLocal,
} from "./autenticacion-ingreso-apoyo";
import {
  altaDeAdmin,
  codigoDeLaAplicacion,
  otroNavegadorConLaSesion,
  type AdminDePrueba,
} from "./autenticacion-plataforma-apoyo";
import { crearBaseAparte } from "./entorno";
import { claveAlAzar } from "./plataforma-apoyo";

/**
 * El ingreso de la consola armado por la composición (`armarIngresoDeConsola`, P8c), de punta a punta y con la puerta REAL
 * contra una base real: Better Auth de verdad, el TOTP de verdad y un proveedor de Google local que hace de Google. Lo
 * único que se arma es lo que haría `apps/plataforma/servidor`: `armarIngresoDeConsola({ fuente })` con las variables del
 * entorno de ESTA corrida (nombres reales, valores al azar de juguete) y sus cuatro piezas: `autenticacion()`,
 * `hostDeLaConsola()`, `puerta()` y `barridoDeSesiones()`. Las variables que faltan o no sirven se prueban acá con valores
 * reales (cadenas con contraseña, secretos) para comprobar que ningún valor sale en un error ni en un registro.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const HOST = "consola.pedernal.test";
const HOST_DE_LA_WEB = "empresa.pedernal.test";
const MINUTO = 60_000;

type Alta = Readonly<{ qrSvg: string; secreto: string; codigosDeRecuperacion: string[] }>;

describe.skipIf(base === null)("el ingreso de la consola compuesto, de punta a punta", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let proveedor: ProveedorLocal;
  let web: AutenticacionDePrueba;
  let entorno: Record<string, string>;
  let ingreso: IngresoDeConsola;
  const registros: string[] = [];
  const registrosDeIngreso: string[] = [];

  beforeAll(async () => {
    if (base === null) return;
    // La librería de ingreso apaga la comprobación de origen y el límite de pedidos cuando NODE_ENV vale «test».
    vi.stubEnv("NODE_ENV", "production");
    proveedor = await levantarProveedorLocal();
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    web = armarAutenticacionDePrueba(propia.base, proveedor);
    entorno = {
      PEDERNAL_HOST_DE_LA_CONSOLA: HOST,
      PEDERNAL_AUTH_SECRETO_PLATAFORMA: randomBytes(32).toString("hex"),
      GOOGLE_CLIENT_ID_PLATAFORMA: proveedor.clientId,
      GOOGLE_CLIENT_SECRET_PLATAFORMA: proveedor.clientSecret,
      PEDERNAL_DB_AUTENTICACION: propia.base.autenticacion,
      PEDERNAL_DB_PLATAFORMA: propia.base.plataforma,
      PEDERNAL_CLAVE_CONTEXTO: `${base.clave.kid}:${base.clave.secreto.toString("hex")}`,
      PEDERNAL_SECRETO_INVITACIONES: randomBytes(32).toString("hex"),
    };
    ingreso = armarIngresoDeConsola({
      fuente: () => entorno,
      registrar: (d) => registros.push(d),
      registrarDeIngreso: (d) => registrosDeIngreso.push(d),
    });
  });
  afterAll(async () => {
    expect(proveedor.intentosExternos(), "nada salió a internet").toEqual([]);
    await ingreso.cerrar();
    await web.cerrar();
    await dueno.end();
    await propia.destruir();
    await proveedor.cerrar();
    vi.unstubAllEnvs();
  });

  // ---- lo que hace la app de la consola, en pocas líneas ----------------------------------------------------------
  const pedir = (n: Navegador, metodo: "GET" | "POST", ruta: string, cuerpo?: unknown) =>
    n.pedir(
      ingreso.autenticacion(),
      ingreso.hostDeLaConsola(),
      metodo,
      ruta,
      cuerpo === undefined ? {} : { cuerpo },
    );
  const sesionDe = (n: Navegador) =>
    ingreso.autenticacion().sesionDe(n.pedidoDe(HOST), ingreso.hostDeLaConsola());
  /** El camino de verdad de cada pedido de la consola: la sesión del pedido y, con ella, la puerta. */
  const accesoDe = async (n: Navegador) => ingreso.puerta().conSesion(await sesionDe(n));
  const accesoOk = async (n: Navegador) => {
    const r = await accesoDe(n);
    if (!r.ok) throw new Error(`tenía que dar acceso y dio ${r.error}`);
    return r.valor;
  };
  const ingresar = async (admin: AdminDePrueba): Promise<Navegador> => {
    const n = new Navegador();
    const r = await n.ingresarConGoogle(ingreso.autenticacion(), HOST, proveedor, admin);
    expect(r.estado).toBe(302);
    expect(r.ubicacion).toBe("/");
    return n;
  };
  const nuevoAdmin = (rol: "ADMIN" | "SOPORTE" = "ADMIN") => altaDeAdmin(dueno, { rol });
  /** Enrola el TOTP y verifica el primer código: deja la sesión CON segundo factor. */
  async function enrolarYVerificar(n: Navegador): Promise<Alta> {
    const enrolar = await pedir(n, "POST", "/api/auth/two-factor/enable", {});
    expect(enrolar.estado).toBe(200);
    const alta = enrolar.json() as Alta;
    const verificar = await pedir(n, "POST", "/api/auth/two-factor/verify-totp", {
      code: codigoDeLaAplicacion(alta.secreto),
    });
    expect(verificar.estado).toBe(200);
    expect(verificar.json()).toEqual({
      verificado: true,
      segundoFactorRecienteHastaMs: 5 * MINUTO,
    });
    return alta;
  }
  const n = async (consulta: string, parametros: unknown[] = []) =>
    Number(((await dueno.query<{ n: string }>(consulta, parametros)).rows[0] as { n: string }).n);
  const cuenta = (tabla: string) => n(`select count(*) as n from autenticacion."${tabla}"`);
  const envejecerElSegundoFactor = (admin: AdminDePrueba, ms: number) =>
    dueno.query(
      `update autenticacion.session set segundo_factor_en = now() - ($2 || ' milliseconds')::interval
        where segundo_factor_en is not null
          and "userId" in (select id from autenticacion."user" where email = $1)`,
      [admin.email, String(ms)],
    );
  async function personaParaSuspender() {
    const p = await personaConUsuario(dueno);
    await empresaConMiembro(dueno, p);
    return p;
  }
  const personaActiva = async (persona: string) =>
    (
      await dueno.query<{ activo_global: boolean }>(
        "select activo_global from persona where id = $1",
        [persona],
      )
    ).rows[0]?.activo_global;

  // =============================================================================================
  // De Google a un caso que exige segundo factor reciente
  // =============================================================================================
  describe("del ingreso con Google a un caso que exige segundo factor reciente", () => {
    it("Google, sesión sin segundo factor, enrolar, verificar el TOTP y la puerta da acceso: un caso marcado corre dentro de la ventana", async () => {
      const admin = await nuevoAdmin();

      // 1. Ingreso con Google (personal habilitado): sesión de la consola, SIN segundo factor.
      const nav = await ingresar(admin);
      expect(nav.cookiesDe(HOST).map((c) => c.nombre)).toContain("__Host-pd_plat.session_token");
      const sesion = await sesionDe(nav);
      expect(sesion).toMatchObject({
        email: admin.email,
        emailVerificado: true,
        host: HOST,
        segundoFactorEn: null,
        segundoFactorEnrolado: false,
      });

      // 2. Sin segundo factor la puerta no arma nada: hay que enrolar.
      expect(await accesoDe(nav)).toEqual({ ok: false, error: "segundo_factor_a_enrolar" });

      // 3. Enrolar muestra el secreto pero no prueba que lo tiene: todavía sin acceso.
      const enrolar = await pedir(nav, "POST", "/api/auth/two-factor/enable", {});
      expect(enrolar.estado).toBe(200);
      expect(enrolar.cabeceras.get("cache-control")).toContain("no-store");
      const alta = enrolar.json() as Alta;
      expect(alta.codigosDeRecuperacion).toHaveLength(10);
      expect(await accesoDe(nav)).toEqual({ ok: false, error: "segundo_factor_a_enrolar" });

      // 4. Verificar el primer código marca el segundo factor EN ESTA sesión.
      const verificar = await pedir(nav, "POST", "/api/auth/two-factor/verify-totp", {
        code: codigoDeLaAplicacion(alta.secreto),
      });
      expect(verificar.estado).toBe(200);
      expect(verificar.json()).toEqual({
        verificado: true,
        segundoFactorRecienteHastaMs: 5 * MINUTO,
      });

      // 5. La puerta da acceso: el administrador y el rol salen de la base, con 5 minutos de segundo factor reciente.
      const acceso = await accesoOk(nav);
      expect(acceso.admin).toEqual({ id: admin.adminId, rol: "ADMIN" });
      expect(acceso.segundoFactorRecienteHastaMs).toBeGreaterThan(4 * MINUTO);
      expect(acceso.segundoFactorRecienteHastaMs).toBeLessThanOrEqual(5 * MINUTO);
      expect((await acceso.consultas.listarTenants({ limite: 5 })).ok).toBe(true);

      // 6. Un caso que EXIGE segundo factor reciente corre dentro de la ventana, de verdad, con su constancia.
      const persona = await personaParaSuspender();
      const auditoriaAntes = await n("select count(*) as n from auditoria_plataforma");
      const suspendida = await acceso.casos.suspenderPersona({
        claveDeIdempotencia: claveAlAzar(),
        personaId: persona.persona,
        motivo: "prueba del ingreso compuesto",
      });
      expect(suspendida.ok).toBe(true);
      expect(await personaActiva(persona.persona)).toBe(false);
      expect(await n("select count(*) as n from auditoria_plataforma")).toBeGreaterThan(
        auditoriaAntes,
      );
      // La constancia es a nombre del administrador que entró por la consola (su id, que sale del contexto firmado).
      const constancia = await dueno.query<{ actor: string }>(
        `select actor from auditoria_plataforma where accion = 'PERSONA_SUSPENDIDA' and entidad_id = $1`,
        [persona.persona],
      );
      expect(constancia.rows.map((f) => f.actor)).toEqual([admin.adminId]);
    });

    it("fuera de la ventana (6 minutos) el caso marcado se rechaza sin dejar nada; con un código nuevo vuelve a correr, en la misma sesión", async () => {
      const admin = await nuevoAdmin();
      const nav = await ingresar(admin);
      const alta = await enrolarYVerificar(nav);
      await envejecerElSegundoFactor(admin, 6 * MINUTO);
      const persona = await personaParaSuspender();
      const pedido = {
        claveDeIdempotencia: claveAlAzar(),
        personaId: persona.persona,
        motivo: "fuera de la ventana",
      };

      const vieja = await accesoOk(nav);
      expect(vieja.segundoFactorRecienteHastaMs).toBe(0);
      const auditoriaAntes = await n("select count(*) as n from auditoria_plataforma");
      expect(await vieja.casos.suspenderPersona(pedido)).toEqual({
        ok: false,
        error: "segundo_factor_reciente_requerido",
      });
      expect(await n("select count(*) as n from auditoria_plataforma")).toBe(auditoriaAntes);
      expect(await personaActiva(persona.persona)).toBe(true);
      // Lo que no exige el segundo factor reciente sigue funcionando con la ventana vencida.
      expect((await vieja.consultas.listarTenants({ limite: 5 })).ok).toBe(true);

      // Se pide el código (un paso adelante: el del enrolamiento ya está usado) y se repite el MISMO pedido.
      const sesionesAntes = await n(
        `select count(*) as n from autenticacion.session s
           join autenticacion."user" u on u.id = s."userId" where u.email = $1`,
        [admin.email],
      );
      const v = await pedir(nav, "POST", "/api/auth/two-factor/verify-totp", {
        code: codigoDeLaAplicacion(alta.secreto, new Date(), 1),
      });
      expect(v.estado).toBe(200);
      expect(
        await n(
          `select count(*) as n from autenticacion.session s
             join autenticacion."user" u on u.id = s."userId" where u.email = $1`,
          [admin.email],
        ),
      ).toBe(sesionesAntes);
      const renovada = await accesoOk(nav);
      expect(renovada.segundoFactorRecienteHastaMs).toBeGreaterThan(4 * MINUTO);
      expect((await renovada.casos.suspenderPersona(pedido)).ok).toBe(true);
      expect(await personaActiva(persona.persona)).toBe(false);
    });

    it("el estado de la sesión y la lectura de la sesión por la ruta de la librería salen de la misma instancia", async () => {
      const admin = await nuevoAdmin();
      const nav = await ingresar(admin);
      await enrolarYVerificar(nav);
      const estado = await ingreso
        .autenticacion()
        .estadoDeSesion(nav.pedidoDe(HOST), ingreso.hostDeLaConsola());
      expect(estado.vigente).toBe(true);
      expect(estado.motivo).toBe("INACTIVIDAD");
      expect(estado.segundoFactorRecienteHastaMs).toBeGreaterThan(4 * MINUTO);
      expect(estado.venceEnMs).toBeGreaterThan(29 * MINUTO);
      expect(estado.venceEnMs).toBeLessThanOrEqual(30 * MINUTO);
      const leida = await pedir(nav, "GET", "/api/auth/get-session");
      expect(leida.estado).toBe(200);
      expect(Object.keys(leida.json() as object).sort()).toEqual([
        "motivo",
        "segundoFactorRecienteHastaMs",
        "venceEnMs",
        "vigente",
      ]);
    });

    it("un SOPORTE entra como SOPORTE (el rol sale de la base) y el guard le niega lo que es de ADMIN", async () => {
      const soporte = await nuevoAdmin("SOPORTE");
      const nav = await ingresar(soporte);
      await enrolarYVerificar(nav);
      const acceso = await accesoOk(nav);
      expect(acceso.admin.rol).toBe("SOPORTE");
      expect(
        await acceso.casos.crearMarca({
          claveDeIdempotencia: claveAlAzar(),
          codigo: "soporte-no",
          marcaPadreId: null,
        }),
      ).toEqual({ ok: false, error: "SIN_PERMISO" });
    });

    it("un ingreso nuevo del mismo administrador, ya con TOTP, vuelve a no tener segundo factor", async () => {
      const admin = await nuevoAdmin();
      await enrolarYVerificar(await ingresar(admin));
      const otro = await ingresar(admin);
      expect(await accesoDe(otro)).toEqual({ ok: false, error: "segundo_factor_requerido" });
    });
  });

  // =============================================================================================
  // Quién puede entrar: el personal habilitado REAL (admin_plataforma por la conexión de plataforma)
  // =============================================================================================
  describe("quien no es personal habilitado no entra (sin oráculo)", () => {
    it("una cuenta de Google que no es personal no crea usuario ni sesión y vuelve con el código genérico", async () => {
      const antes = [await cuenta("user"), await cuenta("account"), await cuenta("session")];
      const nav = new Navegador();
      const r = await nav.ingresarConGoogle(
        ingreso.autenticacion(),
        HOST,
        proveedor,
        perfilAlAzar(),
      );
      expect(r.estado).toBe(302);
      expect(r.ubicacion).toContain("error=no_habilitado");
      expect(nav.cookiesDe(HOST)).toEqual([]);
      expect([await cuenta("user"), await cuenta("account"), await cuenta("session")]).toEqual(
        antes,
      );
      expect(await accesoDe(nav)).toEqual({ ok: false, error: "sesion_vencida" });
    });

    it("un administrador dado de baja no entra, y reactivado entra; el rechazo es el mismo que el de una cuenta cualquiera", async () => {
      const baja = await altaDeAdmin(dueno, { activo: false });
      const desconocida = new Navegador();
      const deBaja = new Navegador();
      const rDesconocida = await desconocida.ingresarConGoogle(
        ingreso.autenticacion(),
        HOST,
        proveedor,
        perfilAlAzar(),
      );
      const rBaja = await deBaja.ingresarConGoogle(ingreso.autenticacion(), HOST, proveedor, baja);
      expect(rBaja.estado).toBe(rDesconocida.estado);
      expect(rBaja.ubicacion).toBe(rDesconocida.ubicacion);
      expect(deBaja.cookiesDe(HOST)).toEqual([]);

      await dueno.query("update admin_plataforma set activo = true where id = $1", [baja.adminId]);
      const r = await ingresar(baja);
      expect(await accesoDe(r)).toEqual({ ok: false, error: "segundo_factor_a_enrolar" });
    });

    it("dado de baja con la sesión abierta: el pedido siguiente no arma contexto (no_habilitado), igual que ante cualquier fallo", async () => {
      const admin = await nuevoAdmin();
      const nav = await ingresar(admin);
      await enrolarYVerificar(nav);
      expect((await accesoDe(nav)).ok).toBe(true);
      await dueno.query("update admin_plataforma set activo = false where id = $1", [
        admin.adminId,
      ]);
      expect(await accesoDe(nav)).toEqual({ ok: false, error: "no_habilitado" });
    });
  });

  // =============================================================================================
  // Sesión de empresa y sesión de consola no se abren entre sí
  // =============================================================================================
  describe("una sesión de la web de empresa no abre la consola, y al revés", () => {
    it("la cookie de la web, copiada al host de la consola, no es sesión; el objeto de sesión de la web tampoco", async () => {
      const admin = await nuevoAdmin();
      await enrolarYVerificar(await ingresar(admin));
      const enLaWeb = new Navegador();
      const r = await enLaWeb.ingresarConGoogle(
        web.autenticacion,
        HOST_DE_LA_WEB,
        proveedor,
        admin,
      );
      expect(r.ubicacion).toBe("/");
      const sesionWeb = await web.autenticacion.sesionDe(
        enLaWeb.pedidoDe(HOST_DE_LA_WEB),
        HOST_DE_LA_WEB,
      );
      expect(sesionWeb).not.toBeNull(); // la web SÍ reconoce a esa persona…

      const enLaConsola = new Navegador();
      enLaWeb.copiarCookiesA(enLaConsola, HOST_DE_LA_WEB, HOST);
      expect(enLaConsola.cookiesDe(HOST).length).toBeGreaterThan(0);
      expect(await sesionDe(enLaConsola)).toBeNull(); // …y la consola no.
      expect(await accesoDe(enLaConsola)).toEqual({ ok: false, error: "sesion_vencida" });
      // Aun si la app pasara a la puerta la sesión de la web: no es de la consola y no entra.
      expect(await ingreso.puerta().conSesion(sesionWeb)).toEqual({
        ok: false,
        error: "sesion_vencida",
      });
    });

    it("la cookie de la consola, copiada al host de la web, no es sesión de empresa", async () => {
      const admin = await nuevoAdmin();
      const nav = await ingresar(admin);
      expect(await sesionDe(nav)).not.toBeNull();
      const enLaWeb = new Navegador();
      nav.copiarCookiesA(enLaWeb, HOST, HOST_DE_LA_WEB);
      expect(enLaWeb.cookiesDe(HOST_DE_LA_WEB).length).toBeGreaterThan(0);
      expect(
        await web.autenticacion.sesionDe(enLaWeb.pedidoDe(HOST_DE_LA_WEB), HOST_DE_LA_WEB),
      ).toBeNull();
    });
  });

  // =============================================================================================
  // Un solo host fijo
  // =============================================================================================
  describe("la consola atiende un solo host", () => {
    it("pedida con otro host, la autenticación no atiende ni lee sesión, aunque la cookie sea buena", async () => {
      const admin = await nuevoAdmin();
      const nav = await ingresar(admin);
      await enrolarYVerificar(nav);
      const autenticacion = ingreso.autenticacion();
      const intrusos = ["otra-consola.pedernal.test", "CONSOLA.PEDERNAL.TEST", `${HOST}:8443`];
      for (const otro of intrusos) {
        expect(await autenticacion.sesionDe(nav.pedidoDe(HOST), otro), otro).toBeNull();
        expect((await autenticacion.estadoDeSesion(nav.pedidoDe(HOST), otro)).vigente, otro).toBe(
          false,
        );
        const r = await autenticacion.manejar(
          new Request(`https://${otro}/api/auth/get-session`, {
            headers: { cookie: nav.pedidoDe(HOST).headers.get("cookie") ?? "" },
          }),
          otro,
        );
        expect(r.status, otro).toBe(404);
        expect(await r.text(), otro).toBe("");
      }
      // Y con el host de la consola, la misma cookie sigue valiendo.
      expect((await accesoDe(nav)).ok).toBe(true);
    });

    it("el origen de la instancia es el de la variable: un POST con la cookie de la sesión y el origen de otro host se rechaza", async () => {
      const nav = await ingresar(await nuevoAdmin());
      await enrolarYVerificar(nav);
      const ajeno = await nav.pedir(
        ingreso.autenticacion(),
        HOST,
        "POST",
        "/api/auth/two-factor/generate-backup-codes",
        { cuerpo: {}, origen: "https://otra-consola.pedernal.test" },
      );
      expect(ajeno.estado).toBe(403);
      expect(ajeno.json()).toEqual({ codigo: "no_habilitado" });
      // Con el origen de la consola, el mismo pedido sí corre.
      const propio = await pedir(nav, "POST", "/api/auth/two-factor/generate-backup-codes", {});
      expect(propio.estado).toBe(200);
    });
  });

  // =============================================================================================
  // El segundo factor usa lo REAL: intentos en la base de autenticación y auditoría en la de plataforma
  // =============================================================================================
  describe("el bloqueo del segundo factor deja constancia en la auditoría de plataforma (la auditoría real, cableada)", () => {
    it("5 códigos malos bloquean, y el bloqueo queda auditado una vez a nombre del sistema, sin datos sensibles", async () => {
      const admin = await nuevoAdmin();
      const alta = await enrolarYVerificar(await ingresar(admin));
      const nav = await ingresar(admin);
      const malo = () =>
        // Otra IP en cada pedido: el límite de pedidos de la librería es por IP y ruta, y lo que se prueba es el de intentos.
        otroNavegadorConLaSesion(nav, HOST).pedir(
          ingreso.autenticacion(),
          HOST,
          "POST",
          "/api/auth/two-factor/verify-totp",
          { cuerpo: { code: codigoDeLaAplicacion(alta.secreto, new Date(), 7) } },
        );
      for (let i = 1; i <= 5; i++) expect((await malo()).estado, `fallo ${i}`).toBe(401);
      const bloqueado = await malo();
      expect(bloqueado.estado).toBe(429);
      expect((bloqueado.json() as { codigo: string }).codigo).toBe("demasiados_intentos");
      expect(await accesoDe(nav)).toEqual({ ok: false, error: "segundo_factor_requerido" });

      const filas = (
        await dueno.query<{ actor: string; entidad: string; despues: unknown }>(
          `select actor, entidad, despues from auditoria_plataforma
            where accion = 'SEGUNDO_FACTOR_BLOQUEADO' and entidad_id = $1`,
          [admin.adminId],
        )
      ).rows;
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ actor: "sistema", entidad: "admin_plataforma" });
      const texto = JSON.stringify(filas);
      for (const centinela of [
        admin.email,
        alta.secreto,
        "otpauth",
        entorno["PEDERNAL_AUTH_SECRETO_PLATAFORMA"] as string,
      ]) {
        expect(texto).not.toContain(centinela);
      }
    });
  });

  // =============================================================================================
  // Barrido de sesiones
  // =============================================================================================
  describe("barrido de sesiones de la consola", () => {
    it("borra la sesión vencida de la consola y deja la vigente, con solo PEDERNAL_DB_AUTENTICACION", async () => {
      const adminVencido = await nuevoAdmin();
      const vencida = await ingresar(adminVencido);
      const vigente = await ingresar(await nuevoAdmin());
      expect(await sesionDe(vencida)).not.toBeNull();
      expect(await sesionDe(vigente)).not.toBeNull();
      await dueno.query(
        `update autenticacion.session set "updatedAt" = now() - interval '3 hours',
                "expiresAt" = now() - interval '2 hours'
          where "userId" in (select id from autenticacion."user" where email = $1)`,
        [adminVencido.email],
      );
      const filasDe = (email: string) =>
        n(
          `select count(*) as n from autenticacion.session s
             join autenticacion."user" u on u.id = s."userId" where u.email = $1`,
          [email],
        );
      expect(await filasDe(adminVencido.email)).toBe(1);

      // Un entorno con SOLO la cadena de autenticación alcanza para barrer (ni el secreto, ni Google, ni el host).
      const soloElBarrido = armarIngresoDeConsola({
        fuente: () => ({
          PEDERNAL_DB_AUTENTICACION: entorno["PEDERNAL_DB_AUTENTICACION"],
        }),
      });
      try {
        const resumen = await soloElBarrido.barridoDeSesiones().barrerVencidos(new Date());
        expect(resumen.sesiones).toBeGreaterThanOrEqual(1);
        // Idempotente: repetirlo no borra de más.
        const otra = await soloElBarrido.barridoDeSesiones().barrerVencidos(new Date());
        expect(otra.sesiones).toBe(0);
      } finally {
        await soloElBarrido.cerrar();
      }
      expect(await filasDe(adminVencido.email)).toBe(0);
      expect(await sesionDe(vencida)).toBeNull();
      expect(await sesionDe(vigente)).not.toBeNull();
    });
  });

  // =============================================================================================
  // Variables que faltan o no sirven: error claro, sin valores
  // =============================================================================================
  describe("variables que faltan o no sirven", () => {
    /** Todo lo visible de un error y de los registros del servidor. */
    const visibleDe = (error: unknown, registrados: readonly string[]): string =>
      [
        String(error),
        inspect(error, { depth: 6, showHidden: true }),
        JSON.stringify(error, Object.getOwnPropertyNames(error)),
        ...registrados,
      ].join("\n");
    /** Ninguna de las variables reales (cadenas con contraseña, secretos, ids) puede aparecer en lo visible. El host no es un secreto: es público. */
    const valoresReales = () =>
      Object.entries(entorno)
        .filter(([nombre]) => nombre !== "PEDERNAL_HOST_DE_LA_CONSOLA")
        .map(([, valor]) => valor);

    it.each([
      ["PEDERNAL_HOST_DE_LA_CONSOLA"],
      ["PEDERNAL_AUTH_SECRETO_PLATAFORMA"],
      ["GOOGLE_CLIENT_ID_PLATAFORMA"],
      ["GOOGLE_CLIENT_SECRET_PLATAFORMA"],
      ["PEDERNAL_DB_AUTENTICACION"],
      ["PEDERNAL_DB_PLATAFORMA"],
      ["PEDERNAL_CLAVE_CONTEXTO"],
    ])(
      "sin %s la autenticación no se arma: error de entorno genérico y el registro nombra la variable",
      async (falta) => {
        const registrados: string[] = [];
        const sinEsa = Object.fromEntries(Object.entries(entorno).filter(([k]) => k !== falta));
        const parcial = armarIngresoDeConsola({
          fuente: () => sinEsa,
          registrar: (d) => registrados.push(d),
        });
        let error: unknown;
        try {
          parcial.autenticacion();
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(ErrorDeEntorno);
        expect((error as Error).message).toBe("el entorno del servidor no está bien configurado");
        expect(registrados.join("\n")).toContain(`${falta} falta`);
        const visible = visibleDe(error, registrados);
        for (const valor of valoresReales()) expect(visible).not.toContain(valor);
        await parcial.cerrar();
      },
    );

    it("sin PEDERNAL_SECRETO_INVITACIONES la puerta se arma, pero el grupo de altas (incluido suspender una persona) no corre y no muestra valores", async () => {
      const registrados: string[] = [];
      const sinEsa = Object.fromEntries(
        Object.entries(entorno).filter(([k]) => k !== "PEDERNAL_SECRETO_INVITACIONES"),
      );
      const parcial = armarIngresoDeConsola({
        fuente: () => sinEsa,
        registrar: (d) => registrados.push(d),
      });
      try {
        const admin = await nuevoAdmin();
        const nav = await ingresar(admin);
        await enrolarYVerificar(nav);
        const r = await parcial.puerta().conSesion(await sesionDe(nav));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const persona = await personaParaSuspender();
        let error: unknown;
        try {
          await r.valor.casos.suspenderPersona({
            claveDeIdempotencia: claveAlAzar(),
            personaId: persona.persona,
            motivo: "sin el secreto de invitaciones",
          });
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(ErrorDeEntorno);
        expect(registrados.join("\n")).toContain("PEDERNAL_SECRETO_INVITACIONES falta");
        expect(await personaActiva(persona.persona)).toBe(true);
        const visible = visibleDe(error, registrados);
        for (const valor of valoresReales()) expect(visible).not.toContain(valor);
        // Las lecturas de otros grupos siguen andando: el entorno se pide por grupo.
        expect((await r.valor.consultas.listarTenants({ limite: 5 })).ok).toBe(true);
      } finally {
        await parcial.cerrar();
      }
    });

    it("un secreto de ingreso demasiado corto no se arma y el error no lo repite (ni el valor ni el resto del entorno)", async () => {
      const corto = "corto-123";
      const registrados: string[] = [];
      const parcial = armarIngresoDeConsola({
        fuente: () => ({ ...entorno, PEDERNAL_AUTH_SECRETO_PLATAFORMA: corto }),
        registrar: (d) => registrados.push(d),
      });
      let error: unknown;
      try {
        parcial.autenticacion();
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ErrorDeEntorno);
      expect(registrados).toContain(
        "PEDERNAL_AUTH_SECRETO_PLATAFORMA inválido: necesita al menos 32 caracteres",
      );
      const visible = visibleDe(error, registrados);
      expect(visible).not.toContain(corto);
      for (const valor of valoresReales()) expect(visible).not.toContain(valor);
      await parcial.cerrar();
    });

    it("el cliente de Google de la consola igual al de la web (id o secreto) no se arma, y el error no repite el valor", async () => {
      for (const [deLaWeb, deLaConsola] of [
        ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID_PLATAFORMA"],
        ["GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET_PLATAFORMA"],
      ] as const) {
        const registrados: string[] = [];
        const parcial = armarIngresoDeConsola({
          fuente: () => ({ ...entorno, [deLaWeb]: entorno[deLaConsola] }),
          registrar: (d) => registrados.push(d),
        });
        let error: unknown;
        try {
          parcial.autenticacion();
        } catch (e) {
          error = e;
        }
        expect(error, deLaConsola).toBeInstanceOf(ErrorDeEntorno);
        expect(registrados, deLaConsola).toEqual([
          `${deLaConsola} inválido: no puede ser igual a ${deLaWeb}`,
        ]);
        const visible = visibleDe(error, registrados);
        for (const valor of valoresReales()) expect(visible, deLaConsola).not.toContain(valor);
        await parcial.cerrar();
      }
    });

    it("nada de lo que la librería de ingreso contó durante toda la prueba lleva un valor del entorno", () => {
      const todo = [...registros, ...registrosDeIngreso].join("\n");
      for (const valor of valoresReales()) expect(todo).not.toContain(valor);
    });
  });
});
