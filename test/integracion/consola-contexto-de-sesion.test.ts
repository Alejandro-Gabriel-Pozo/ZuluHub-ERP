import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { darDeBajaAlAdmin } from "../../src/adaptadores/postgres/baja-de-admin";
import { armarPuertaDeConsola } from "../../src/composicion/puerta-de-consola";
import { Navegador } from "./autenticacion-ingreso-apoyo";
import { empresaConMiembro, personaConUsuario } from "./autenticacion-apoyo";
import { codigoDeLaAplicacion } from "./autenticacion-plataforma-apoyo";
import {
  HOST_DE_LA_CONSOLA,
  HOST_DE_LA_WEB,
  MINUTO,
  accesoDe,
  accesoOk,
  adminConSesionCompleta,
  armarMundo,
  enrolarYVerificar,
  envejecerElSegundoFactor,
  ingresar,
  nuevoAdmin,
  pedir,
  sesionDeLaConsola,
  sesionesDe,
  type Mundo,
} from "./consola-apoyo";
import { claveAlAzar } from "./plataforma-apoyo";

/**
 * La puerta de la consola de punta a punta (P8b, h5-p8 §2.3, §2.4 bis y §4), con la autenticación REAL de plataforma
 * (Better Auth, TOTP de verdad, proveedor de Google local) y una base real: el contexto de plataforma solo se arma con
 * TODO junto, el segundo factor reciente se exige por acción antes de correr el caso, y bajar a un administrador corta
 * la sesión abierta en la operación siguiente. Ningún secreto sale en una respuesta, un registro ni la auditoría.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

describe.skipIf(base === null)(
  "la puerta de la consola con la base y la autenticación reales",
  () => {
    let m: Mundo;

    beforeAll(async () => {
      if (base === null) return;
      // La librería de ingreso apaga la comprobación de origen y el límite de pedidos cuando NODE_ENV vale «test».
      vi.stubEnv("NODE_ENV", "production");
      m = await armarMundo(base);
    });
    afterAll(async () => {
      await m.cerrar();
      vi.unstubAllEnvs();
    });

    const n = async (consulta: string, parametros: unknown[] = []) =>
      Number(
        ((await m.dueno.query<{ n: string }>(consulta, parametros)).rows[0] as { n: string }).n,
      );

    /** Lo que cambia una escritura de plataforma: constancias, claves de idempotencia y trabajos. */
    const huella = async () => ({
      auditoria: await n("select count(*) as n from auditoria_plataforma"),
      auditoriaDeEmpresa: await n("select count(*) as n from auditoria_empresa"),
      claves: await n("select count(*) as n from idempotencia_plataforma"),
      trabajos: await n("select count(*) as n from trabajo"),
      marcas: await n("select count(*) as n from marca"),
      planes: await n("select count(*) as n from plan"),
    });

    // =============================================================================================
    // El ingreso con Google sin segundo factor no arma contexto (G1)
    // =============================================================================================
    describe("el ingreso con Google sin segundo factor no arma contexto", () => {
      it("recién ingresado, sin TOTP: segundo_factor_a_enrolar, y tampoco alcanza con haber pedido el alta sin verificarla", async () => {
        const admin = await nuevoAdmin(m);
        const nav = await ingresar(m, admin);
        expect(await accesoDe(m, nav)).toEqual({ ok: false, error: "segundo_factor_a_enrolar" });
        // Enrolar muestra el secreto pero no prueba que quien entra lo tiene: sigue sin contexto.
        expect((await pedir(m, nav, "POST", "/api/auth/two-factor/enable", {})).estado).toBe(200);
        expect(await accesoDe(m, nav)).toEqual({ ok: false, error: "segundo_factor_a_enrolar" });
      });

      it("al verificar el primer código entra, con su id y su rol de la base y 5 minutos de segundo factor reciente", async () => {
        const admin = await nuevoAdmin(m);
        const nav = await ingresar(m, admin);
        await enrolarYVerificar(m, nav);
        const acceso = await accesoOk(m, nav);
        expect(acceso.admin).toEqual({ id: admin.adminId, rol: "ADMIN" });
        expect(acceso.segundoFactorRecienteHastaMs).toBeGreaterThan(4 * MINUTO);
        expect(acceso.segundoFactorRecienteHastaMs).toBeLessThanOrEqual(5 * MINUTO);
      });

      it("un ingreso nuevo del mismo administrador, ya con TOTP, vuelve a no tener segundo factor: segundo_factor_requerido", async () => {
        const { admin, alta } = await adminConSesionCompleta(m);
        const otro = await ingresar(m, admin);
        expect(await accesoDe(m, otro)).toEqual({ ok: false, error: "segundo_factor_requerido" });
        // Y se corrige verificando un código de ESA sesión (un paso adelante: el del enrolamiento ya está usado).
        const r = await pedir(m, otro, "POST", "/api/auth/two-factor/verify-totp", {
          code: codigoDeLaAplicacion(alta.secreto, new Date(), 1),
        });
        expect(r.estado).toBe(200);
        expect((await accesoDe(m, otro)).ok).toBe(true);
      });

      it("sin cookie, o con una cookie inventada: sesion_vencida, y ninguna respuesta lleva un contexto", async () => {
        expect(await m.puerta.conSesion(null)).toEqual({ ok: false, error: "sesion_vencida" });
        const inventada = new Navegador();
        expect(await accesoDe(m, inventada)).toEqual({ ok: false, error: "sesion_vencida" });
        const falsa = {
          headers: new Headers({ cookie: "__Host-zh_plat.session_token=inventada.firma-falsa" }),
        };
        const sesion = await m.consola.autenticacion.sesionDe(falsa, HOST_DE_LA_CONSOLA);
        expect(await m.puerta.conSesion(sesion)).toEqual({ ok: false, error: "sesion_vencida" });
      });
    });

    // =============================================================================================
    // Un administrador no habilitado recibe la respuesta genérica
    // =============================================================================================
    describe("un administrador no habilitado recibe la misma respuesta genérica que en el ingreso", () => {
      it("dado de baja sin cortarle la sesión, o con otro email en la tabla: no_habilitado, la misma respuesta; reactivado, entra", async () => {
        const { admin, n: nav } = await adminConSesionCompleta(m);
        expect((await accesoDe(m, nav)).ok).toBe(true);

        await m.dueno.query("update admin_plataforma set activo = false where id = $1", [
          admin.adminId,
        ]);
        const deBaja = await accesoDe(m, nav);
        expect(deBaja).toEqual({ ok: false, error: "no_habilitado" });

        await m.dueno.query("update admin_plataforma set activo = true, email = $2 where id = $1", [
          admin.adminId,
          `otro-${admin.email}`,
        ]);
        const otroEmail = await accesoDe(m, nav);
        expect(otroEmail).toEqual(deBaja);

        await m.dueno.query("update admin_plataforma set email = $2 where id = $1", [
          admin.adminId,
          admin.email,
        ]);
        expect((await accesoDe(m, nav)).ok).toBe(true);
      });

      it("el rol sale de la base, no de la sesión: un SOPORTE entra como SOPORTE y el guard le niega lo que es de ADMIN", async () => {
        const { n: nav } = await adminConSesionCompleta(m, "SOPORTE");
        const acceso = await accesoOk(m, nav);
        expect(acceso.admin.rol).toBe("SOPORTE");
        const antes = await huella();
        expect(
          await acceso.casos.crearMarca({
            claveDeIdempotencia: claveAlAzar(),
            codigo: "soporte-no",
            marcaPadreId: null,
          }),
        ).toEqual({ ok: false, error: "SIN_PERMISO" });
        expect(await huella()).toEqual(antes);
        // Lo que SOPORTE sí puede, pasa.
        expect((await acceso.consultas.listarTenants({ limite: 5 })).ok).toBe(true);
      });

      it("si cambian el rol en la base, el administrador lo nota en el pedido siguiente", async () => {
        const { admin, n: nav } = await adminConSesionCompleta(m);
        expect((await accesoOk(m, nav)).admin.rol).toBe("ADMIN");
        await m.dueno.query("update admin_plataforma set rol = 'SOPORTE' where id = $1", [
          admin.adminId,
        ]);
        expect((await accesoOk(m, nav)).admin.rol).toBe("SOPORTE");
      });
    });

    // =============================================================================================
    // Sesión de empresa y sesión de consola no se abren entre sí
    // =============================================================================================
    describe("una sesión de empresa no abre la consola, y al revés", () => {
      it("la cookie de la web, presentada a la consola (en su host o copiada a él), no es sesión; el objeto de sesión de la web tampoco", async () => {
        const { admin } = await adminConSesionCompleta(m);
        const web = new Navegador();
        const r = await web.ingresarConGoogle(
          m.web.autenticacion,
          HOST_DE_LA_WEB,
          m.proveedor,
          admin,
        );
        expect(r.ubicacion).toBe("/");
        // La web SÍ reconoce a esa persona.
        const sesionWeb = await m.web.autenticacion.sesionDe(
          web.pedidoDe(HOST_DE_LA_WEB),
          HOST_DE_LA_WEB,
        );
        expect(sesionWeb).not.toBeNull();

        // Las mismas cookies, puestas como si fueran del host de la consola.
        const enLaConsola = new Navegador();
        web.copiarCookiesA(enLaConsola, HOST_DE_LA_WEB, HOST_DE_LA_CONSOLA);
        expect(enLaConsola.cookiesDe(HOST_DE_LA_CONSOLA).length).toBeGreaterThan(0);
        expect(await sesionDeLaConsola(m, enLaConsola)).toBeNull();
        expect(await accesoDe(m, enLaConsola)).toEqual({ ok: false, error: "sesion_vencida" });
        // Y presentada a la consola con el nombre de host de la web.
        expect(
          await m.consola.autenticacion.sesionDe(web.pedidoDe(HOST_DE_LA_WEB), HOST_DE_LA_WEB),
        ).toBeNull();

        // Aun si una app pasara la sesión de la web a la puerta de la consola: no es de la consola y no entra.
        expect(await m.puerta.conSesion(sesionWeb)).toEqual({ ok: false, error: "sesion_vencida" });
      });

      it("la cookie de la consola, presentada a la web (en su host o copiada a él), no es sesión de empresa", async () => {
        const { n: nav } = await adminConSesionCompleta(m);
        expect(await sesionDeLaConsola(m, nav)).not.toBeNull();
        const enLaWeb = new Navegador();
        nav.copiarCookiesA(enLaWeb, HOST_DE_LA_CONSOLA, HOST_DE_LA_WEB);
        expect(enLaWeb.cookiesDe(HOST_DE_LA_WEB).length).toBeGreaterThan(0);
        expect(
          await m.web.autenticacion.sesionDe(enLaWeb.pedidoDe(HOST_DE_LA_WEB), HOST_DE_LA_WEB),
        ).toBeNull();
        expect(
          await m.web.autenticacion.sesionDe(nav.pedidoDe(HOST_DE_LA_CONSOLA), HOST_DE_LA_CONSOLA),
        ).toBeNull();
      });

      it("una puerta armada para otro host rechaza una sesión válida de la consola", async () => {
        const { n: nav } = await adminConSesionCompleta(m);
        const sesion = await sesionDeLaConsola(m, nav);
        expect((await m.puerta.conSesion(sesion)).ok).toBe(true);
        const ajena = armarPuertaDeConsola({
          fuente: () => m.entorno,
          hostDeLaConsola: "otra-consola.example.test",
        });
        try {
          expect(await ajena.conSesion(sesion)).toEqual({ ok: false, error: "sesion_vencida" });
        } finally {
          await ajena.cerrar();
        }
      });
    });

    // =============================================================================================
    // Bajar a un administrador corta la sesión abierta en la operación siguiente
    // =============================================================================================
    describe("bajar a un administrador corta la sesión abierta", () => {
      it("con el script de baja: la sesión desaparece, y el acceso que ya tenía no hace nada más", async () => {
        const { admin, n: nav } = await adminConSesionCompleta(m);
        const otro = await ingresar(m, admin); // una segunda sesión, también abierta
        const acceso = await accesoOk(m, nav);
        expect((await acceso.consultas.listarTenants({ limite: 5 })).ok).toBe(true);
        expect(await sesionesDe(m, admin.email)).toBe(2);

        const baja = await darDeBajaAlAdmin(m.base.dueno, admin.email);
        expect(baja.ok && baja.valor.sesionesRevocadas).toBe(2);

        // El pedido siguiente: ya no hay sesión, en ninguno de los dos navegadores.
        expect(await sesionDeLaConsola(m, nav)).toBeNull();
        expect(await accesoDe(m, nav)).toEqual({ ok: false, error: "sesion_vencida" });
        expect(await accesoDe(m, otro)).toEqual({ ok: false, error: "sesion_vencida" });

        // Y aunque alguien conservara el acceso de antes, cada caso lee al administrador dentro de su transacción.
        const antes = await huella();
        expect(await acceso.consultas.listarTenants({ limite: 5 })).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
        expect(
          await acceso.casos.crearPlan({ claveDeIdempotencia: claveAlAzar(), codigo: "tarde" }),
        ).toEqual({ ok: false, error: "SIN_PERMISO" });
        expect(await huella()).toEqual(antes);
      });

      it("aunque la baja se hiciera solo en la tabla (sin cortar la sesión), el pedido siguiente ya no entra", async () => {
        const { admin, n: nav } = await adminConSesionCompleta(m);
        await m.dueno.query("update admin_plataforma set activo = false where id = $1", [
          admin.adminId,
        ]);
        expect(await sesionDeLaConsola(m, nav)).not.toBeNull(); // la sesión de la librería sigue viva…
        expect(await accesoDe(m, nav)).toEqual({ ok: false, error: "no_habilitado" }); // …pero no arma contexto.
      });
    });

    // =============================================================================================
    // El segundo factor reciente, solo en las acciones marcadas
    // =============================================================================================
    describe("el segundo factor viejo (más de 5 minutos) se rechaza SOLO en las acciones marcadas", () => {
      /** Una persona con usuario vinculado y una membresía activa, lista para suspender. */
      async function personaParaSuspender() {
        const p = await personaConUsuario(m.dueno);
        await empresaConMiembro(m.dueno, p);
        return p;
      }
      const estadoDe = async (persona: string) =>
        (
          await m.dueno.query<{ activo_global: boolean }>(
            "select activo_global from persona where id = $1",
            [persona],
          )
        ).rows[0]?.activo_global;

      it("con el segundo factor de hace 6 minutos: lecturas y acciones no marcadas pasan; las marcadas se rechazan SIN dejar nada", async () => {
        const { admin, n: nav } = await adminConSesionCompleta(m);
        await envejecerElSegundoFactor(m, admin, 6 * MINUTO);
        const acceso = await accesoOk(m, nav);
        expect(acceso.segundoFactorRecienteHastaMs).toBe(0);

        // No marcadas: pasan (la ventana vieja no las toca).
        expect((await acceso.consultas.listarTenants({ limite: 5 })).ok).toBe(true);
        expect((await acceso.consultas.listarMarcas()).ok).toBe(true);
        const marca = await acceso.casos.crearMarca({
          claveDeIdempotencia: claveAlAzar(),
          codigo: `marca-${Date.now() % 100000}`,
          marcaPadreId: null,
        });
        expect(marca.ok).toBe(true);
        const plan = await acceso.casos.crearPlan({
          claveDeIdempotencia: claveAlAzar(),
          codigo: `plan-${Date.now() % 100000}`,
        });
        expect(plan.ok).toBe(true);

        // Marcadas: rechazadas antes de correr, sin escribir nada (ni constancia, ni clave, ni trabajo).
        const persona = await personaParaSuspender();
        const antes = await huella();
        const suspender = await acceso.casos.suspenderPersona({
          claveDeIdempotencia: claveAlAzar(),
          personaId: persona.persona,
          motivo: "prueba de segundo factor viejo",
        });
        expect(suspender).toEqual({ ok: false, error: "segundo_factor_reciente_requerido" });
        expect(await estadoDe(persona.persona)).toBe(true);
        expect(await huella()).toEqual(antes);

        // El rechazo viene ANTES del caso: ni siquiera una entrada inválida cambia el código.
        expect(await acceso.casos.altaDeEmpresa({} as never)).toEqual({
          ok: false,
          error: "segundo_factor_reciente_requerido",
        });
        expect(await acceso.casos.cancelarAlta({} as never)).toEqual({
          ok: false,
          error: "segundo_factor_reciente_requerido",
        });
        expect(await huella()).toEqual(antes);
      });

      it("con el segundo factor de hace 4 minutos todavía pasa; verificar un código nuevo renueva la ventana en la misma sesión", async () => {
        const { admin, n: nav, alta } = await adminConSesionCompleta(m);
        await envejecerElSegundoFactor(m, admin, 4 * MINUTO);
        const persona = await personaParaSuspender();
        const conCuatro = await accesoOk(m, nav);
        expect(conCuatro.segundoFactorRecienteHastaMs).toBeGreaterThan(0);
        const suspendida = await conCuatro.casos.suspenderPersona({
          claveDeIdempotencia: claveAlAzar(),
          personaId: persona.persona,
          motivo: "dentro de la ventana",
        });
        expect(suspendida.ok).toBe(true);
        expect(await estadoDe(persona.persona)).toBe(false);

        // Vence la ventana…
        await envejecerElSegundoFactor(m, admin, 7 * MINUTO);
        const otra = await personaParaSuspender();
        const vieja = await accesoOk(m, nav);
        expect(
          await vieja.casos.suspenderPersona({
            claveDeIdempotencia: claveAlAzar(),
            personaId: otra.persona,
            motivo: "fuera de la ventana",
          }),
        ).toEqual({ ok: false, error: "segundo_factor_reciente_requerido" });

        // …y se renueva con un código nuevo (un paso adelante), sin crear otra sesión.
        const sesionesAntes = await sesionesDe(m, admin.email);
        const v = await pedir(m, nav, "POST", "/api/auth/two-factor/verify-totp", {
          code: codigoDeLaAplicacion(alta.secreto, new Date(), 1),
        });
        expect(v.estado).toBe(200);
        expect(await sesionesDe(m, admin.email)).toBe(sesionesAntes);
        const renovada = await accesoOk(m, nav);
        expect(renovada.segundoFactorRecienteHastaMs).toBeGreaterThan(4 * MINUTO);
        expect(
          (
            await renovada.casos.suspenderPersona({
              claveDeIdempotencia: claveAlAzar(),
              personaId: otra.persona,
              motivo: "ventana renovada",
            })
          ).ok,
        ).toBe(true);
      });

      it("el mismo pedido reintentado con la MISMA clave después de pedir el código no duplica nada", async () => {
        const { admin, n: nav, alta } = await adminConSesionCompleta(m);
        const persona = await personaParaSuspender();
        const pedido = {
          claveDeIdempotencia: claveAlAzar(),
          personaId: persona.persona,
          motivo: "reintento con la misma clave",
        };
        await envejecerElSegundoFactor(m, admin, 10 * MINUTO);
        const rechazo = await (await accesoOk(m, nav)).casos.suspenderPersona(pedido);
        expect(rechazo).toEqual({ ok: false, error: "segundo_factor_reciente_requerido" });
        await pedir(m, nav, "POST", "/api/auth/two-factor/verify-totp", {
          code: codigoDeLaAplicacion(alta.secreto, new Date(), 1),
        });
        const acceso = await accesoOk(m, nav);
        const primera = await acceso.casos.suspenderPersona(pedido);
        const segunda = await acceso.casos.suspenderPersona(pedido);
        expect(primera.ok && !primera.valor.repetida).toBe(true);
        expect(segunda.ok && segunda.valor.repetida).toBe(true);
        expect(
          await n(
            "select count(*) as n from auditoria_plataforma where accion = 'PERSONA_SUSPENDIDA' and entidad_id = $1",
            [persona.persona],
          ),
        ).toBe(1);
      });
    });

    // =============================================================================================
    // Ningún secreto en las respuestas, los registros ni la auditoría
    // =============================================================================================
    describe("ningún secreto en las respuestas, los registros ni la auditoría", () => {
      it("lo que la puerta devuelve y lo que registra no lleva el secreto de la librería, el TOTP, los códigos, las cookies ni las cadenas", async () => {
        const { admin, n: nav, alta } = await adminConSesionCompleta(m);
        const acceso = await accesoOk(m, nav);
        const p = await personaConUsuario(m.dueno);
        const resultados: unknown[] = [
          { admin: acceso.admin, hasta: acceso.segundoFactorRecienteHastaMs },
          await acceso.consultas.listarTenants({ limite: 5 }),
          await acceso.casos.suspenderPersona({
            claveDeIdempotencia: claveAlAzar(),
            personaId: p.persona,
            motivo: "centinelas",
          }),
          await m.puerta.conSesion(null),
          await accesoDe(m, await ingresar(m, admin)),
        ];
        const centinelas = [
          alta.secreto,
          ...alta.codigosDeRecuperacion,
          m.consola.secreto,
          ...nav.cookiesDe(HOST_DE_LA_CONSOLA).map((c) => c.valor),
          ...Object.values(m.entorno),
          new URL(m.base.plataforma).password,
          new URL(m.base.autenticacion).password,
          admin.email,
        ];
        const volcado = JSON.stringify([resultados, m.registros, m.consola.registros]);
        for (const c of centinelas) {
          expect(c.length, "un centinela vacío no prueba nada").toBeGreaterThan(8);
          expect(volcado, c.slice(0, 6)).not.toContain(c);
        }
      });

      it("una base inalcanzable se rechaza con no_habilitado y el registro no repite la cadena, el servidor ni el email", async () => {
        const { admin, n: nav } = await adminConSesionCompleta(m);
        const registros: string[] = [];
        const clave = "clave-de-juguete-13579";
        const rota = armarPuertaDeConsola({
          fuente: () => ({
            ...m.entorno,
            ZULUHUB_DB_PLATAFORMA: `postgres://usuario-juguete:${clave}@127.0.0.1:1/base-juguete`,
          }),
          registrar: (d) => registros.push(d),
          hostDeLaConsola: HOST_DE_LA_CONSOLA,
        });
        try {
          const r = await rota.conSesion(await sesionDeLaConsola(m, nav));
          expect(r).toEqual({ ok: false, error: "no_habilitado" });
        } finally {
          await rota.cerrar();
        }
        expect(registros).toHaveLength(1);
        expect(registros[0]).toMatch(/^\[consola\] no se pudo leer al administrador: \w+$/);
        for (const prohibido of [
          clave,
          "usuario-juguete",
          "base-juguete",
          "127.0.0.1",
          admin.email,
        ]) {
          expect(registros.join("\n")).not.toContain(prohibido);
        }
      });

      it("una variable de entorno que falta se rechaza con no_habilitado y se registra solo el NOMBRE", async () => {
        const { n: nav } = await adminConSesionCompleta(m);
        const registros: string[] = [];
        const sinClave = armarPuertaDeConsola({
          fuente: () => ({ ZULUHUB_DB_PLATAFORMA: m.base.plataforma }),
          registrar: (d) => registros.push(d),
          hostDeLaConsola: HOST_DE_LA_CONSOLA,
        });
        try {
          expect(await sinClave.conSesion(await sesionDeLaConsola(m, nav))).toEqual({
            ok: false,
            error: "no_habilitado",
          });
        } finally {
          await sinClave.cerrar();
        }
        expect(registros.join("\n")).toContain("ZULUHUB_CLAVE_CONTEXTO falta");
        expect(registros.join("\n")).not.toContain(new URL(m.base.plataforma).password);
      });
    });

    // =============================================================================================
    // Concurrencia
    // =============================================================================================
    describe("concurrencia", () => {
      it("dos (u ocho) bajas simultáneas del mismo administrador: baja una vez, una sola constancia, ninguna sesión", async () => {
        const { admin } = await adminConSesionCompleta(m);
        await ingresar(m, admin);
        await ingresar(m, admin);
        expect(await sesionesDe(m, admin.email)).toBe(3);
        const resultados = await Promise.all(
          Array.from({ length: 8 }, () => darDeBajaAlAdmin(m.base.dueno, admin.email)),
        );
        expect(resultados.every((r) => r.ok)).toBe(true);
        const hechas = resultados.filter((r) => r.ok && !r.valor.yaEstabaDeBaja);
        expect(hechas).toHaveLength(1);
        expect(hechas[0]?.ok && hechas[0].valor.sesionesRevocadas).toBe(3);
        expect(
          resultados.reduce((suma, r) => suma + (r.ok ? r.valor.sesionesRevocadas : 0), 0),
        ).toBe(3);
        expect(
          await n(
            "select count(*) as n from auditoria_plataforma where accion = 'ADMIN_PLATAFORMA_BAJA' and entidad_id = $1",
            [admin.adminId],
          ),
        ).toBe(1);
        expect(await sesionesDe(m, admin.email)).toBe(0);
        expect(
          (
            await m.dueno.query<{ activo: boolean }>(
              "select activo from admin_plataforma where id = $1",
              [admin.adminId],
            )
          ).rows[0]?.activo,
        ).toBe(false);
      });

      it("dos suspensiones simultáneas de la misma persona con claves distintas: gana una, una sola constancia y un solo trabajo", async () => {
        const { n: nav } = await adminConSesionCompleta(m);
        const acceso = await accesoOk(m, nav);
        const p = await personaConUsuario(m.dueno);
        await empresaConMiembro(m.dueno, p);
        const resultados = await Promise.all(
          Array.from({ length: 6 }, (_, i) =>
            acceso.casos.suspenderPersona({
              claveDeIdempotencia: claveAlAzar(),
              personaId: p.persona,
              motivo: `carrera ${i}`,
            }),
          ),
        );
        expect(resultados.filter((r) => r.ok)).toHaveLength(1);
        for (const r of resultados.filter((x) => !x.ok)) {
          expect(r).toEqual({ ok: false, error: "YA_SUSPENDIDA" });
        }
        expect(
          await n(
            "select count(*) as n from auditoria_plataforma where accion = 'PERSONA_SUSPENDIDA' and entidad_id = $1",
            [p.persona],
          ),
        ).toBe(1);
        expect(
          await n(
            "select count(*) as n from auditoria_empresa where accion = 'PERSONA_SUSPENDIDA' and entidad_id = $1",
            [p.persona],
          ),
        ).toBe(1);
        const trabajos = await m.dueno.query<{
          tipo: string;
          empresa_id: string | null;
          datos: unknown;
        }>("select tipo, empresa_id, datos from trabajo where clave_idempotencia like $1", [
          `persona:${p.persona}:suspension:%`,
        ]);
        expect(trabajos.rows).toEqual([
          { tipo: "revocar_sesiones", empresa_id: null, datos: { usuarioAuthId: p.usuario } },
        ]);
      });

      it("ocho suspensiones simultáneas con la MISMA clave: todas devuelven lo mismo, una sola escribe", async () => {
        const { n: nav } = await adminConSesionCompleta(m);
        const acceso = await accesoOk(m, nav);
        const p = await personaConUsuario(m.dueno);
        const pedido = {
          claveDeIdempotencia: claveAlAzar(),
          personaId: p.persona,
          motivo: "misma clave",
        };
        const resultados = await Promise.all(
          Array.from({ length: 8 }, () => acceso.casos.suspenderPersona(pedido)),
        );
        expect(resultados.every((r) => r.ok)).toBe(true);
        expect(resultados.filter((r) => r.ok && !r.valor.repetida)).toHaveLength(1);
        expect(
          await n(
            "select count(*) as n from auditoria_plataforma where accion = 'PERSONA_SUSPENDIDA' and entidad_id = $1",
            [p.persona],
          ),
        ).toBe(1);
        expect(
          await n("select count(*) as n from trabajo where clave_idempotencia like $1", [
            `persona:${p.persona}:suspension:%`,
          ]),
        ).toBe(1);
      });
    });
  },
);
