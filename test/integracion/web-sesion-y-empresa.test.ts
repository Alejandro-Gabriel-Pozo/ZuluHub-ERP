import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  aceptarInvitacionDeLaSesion,
  cerrarSesion,
  elegirEmpresa,
  empresasDeLaPersona,
  iniciarIngresoConGoogle,
  renovarSesion,
  resolverEmpresa,
  sucursalesDeLaEmpresa,
} from "../../src/composicion/sesion-y-empresa";
import { Navegador } from "./autenticacion-ingreso-apoyo";
import { perfilAlAzar } from "./autenticacion-ingreso-apoyo";
import { crearBarrera } from "./entorno";
import { crearMundoDeMarca } from "./marcas-apoyo";
import { emailAlAzar } from "./fixtures-identidad";
import {
  HOST_A,
  HOST_B,
  armarMundoWeb,
  empresaDeLaMarca,
  ingresarEn,
  invitar,
  personaVinculada,
  type MundoWeb,
} from "./web-apoyo";

/**
 * W5, la lógica de sesión y empresa contra la base real, con sesiones de verdad (ingreso por el proveedor
 * local de Google). Lo crítico, por orden:
 *  - P-1: nada de la marca B en una respuesta de A; una persona con membresía solo en A que entra por B no
 *    ve empresas; la cookie `zh_empresa` de A forzada en B es `SIN_PERMISO`;
 *  - P-6: la cookie de sesión de A no vale en B (renovar responde 401);
 *  - P-10: invitación -> aceptar -> panel; segundo ingreso entra directo con una empresa y elige con dos;
 *  - el contexto operativo lo arma el servidor (empresa validada, marca del host) y la base lo acepta;
 *  - IDEMPOTENCIA y CONCURRENCIA: aceptar la misma invitación dos veces a la vez deja UNA membresía.
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)("web: sesión y empresa", () => {
  let mundo: MundoWeb;

  beforeAll(async () => {
    if (base === null) return;
    vi.stubEnv("NODE_ENV", "production");
    mundo = await armarMundoWeb(base);
  });
  afterAll(async () => {
    expect(mundo.proveedor.intentosExternos(), "nada salió a internet").toEqual([]);
    await mundo.cerrar();
    vi.unstubAllEnvs();
  });

  describe("P-1: aislamiento entre marcas y hosts", () => {
    it("las empresas salen filtradas por la marca del host: en A solo las de A, en B solo las de B", async () => {
      const enA = await ingresarEn(mundo, HOST_A);
      const persona = await personaVinculada(mundo, enA.sesion);
      const deA = await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE");
      const deB = await empresaDeLaMarca(mundo, mundo.marcaB, persona, "OPERADOR");
      // La misma persona ingresa también por B (otra sesión, otro host).
      const enB = await ingresarEn(mundo, HOST_B, enA.perfil);

      const respuestaA = await empresasDeLaPersona(mundo.dependencias, enA.sesion, mundo.marcaA);
      const respuestaB = await empresasDeLaPersona(mundo.dependencias, enB.sesion, mundo.marcaB);
      expect(respuestaA.ok && respuestaA.dato.empresas.map((e) => e.empresaId)).toEqual([
        deA.empresa,
      ]);
      expect(respuestaB.ok && respuestaB.dato.empresas.map((e) => e.empresaId)).toEqual([
        deB.empresa,
      ]);
      // Propiedad sobre el cuerpo: nada de B en lo que sale para A (y a la inversa).
      expect(JSON.stringify(respuestaA)).not.toContain(deB.empresa);
      expect(JSON.stringify(respuestaB)).not.toContain(deA.empresa);
      const nombreB = (
        await mundo.dueno.query<{ razon_social: string }>(
          "select razon_social from empresa where id = $1",
          [deB.empresa],
        )
      ).rows[0]?.razon_social as string;
      expect(JSON.stringify(respuestaA)).not.toContain(nombreB);
    });

    it("una persona con membresía solo en A que entra por B no ve empresas", async () => {
      const enB = await ingresarEn(mundo, HOST_B);
      const persona = await personaVinculada(mundo, enB.sesion);
      await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE");
      const respuesta = await empresasDeLaPersona(mundo.dependencias, enB.sesion, mundo.marcaB);
      expect(respuesta).toEqual({
        ok: true,
        dato: { personaId: persona, empresas: [] },
      });
      const entrada = await resolverEmpresa(mundo.dependencias, {
        sesion: enB.sesion,
        marcaId: mundo.marcaB,
        cookieDeEmpresa: null,
      });
      expect(entrada).toEqual({ ok: true, dato: { tipo: "SIN_EMPRESAS" } });
    });

    it("la cookie zh_empresa de A forzada en B es SIN_PERMISO; elegir esa empresa en B también", async () => {
      const enB = await ingresarEn(mundo, HOST_B);
      const persona = await personaVinculada(mundo, enB.sesion);
      const deA = await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE");
      const entrada = await resolverEmpresa(mundo.dependencias, {
        sesion: enB.sesion,
        marcaId: mundo.marcaB,
        cookieDeEmpresa: deA.empresa,
      });
      expect(entrada).toEqual({
        ok: false,
        error: {
          codigo: "SIN_PERMISO",
          clave: "motivo.sin_permiso",
          presentacion: "POR_QUE_NO_PUEDO",
        },
      });
      const elegida = await elegirEmpresa(mundo.dependencias, {
        sesion: enB.sesion,
        marcaId: mundo.marcaB,
        empresaId: deA.empresa,
      });
      expect(elegida.ok).toBe(false);
      expect(elegida.ok === false && elegida.error.codigo).toBe("SIN_PERMISO");
    });

    it("una cookie con la empresa de OTRA persona (misma marca) o inventada es SIN_PERMISO", async () => {
      const yo = await ingresarEn(mundo, HOST_A);
      const personaYo = await personaVinculada(mundo, yo.sesion);
      await empresaDeLaMarca(mundo, mundo.marcaA, personaYo, "GERENTE");
      const otra = await ingresarEn(mundo, HOST_A);
      const personaOtra = await personaVinculada(mundo, otra.sesion);
      const deOtra = await empresaDeLaMarca(mundo, mundo.marcaA, personaOtra, "GERENTE");
      for (const cookie of [
        deOtra.empresa,
        "no-es-una-empresa",
        "00000000-0000-4000-8000-000000000999",
      ]) {
        const entrada = await resolverEmpresa(mundo.dependencias, {
          sesion: yo.sesion,
          marcaId: mundo.marcaA,
          cookieDeEmpresa: cookie,
        });
        expect(entrada.ok, cookie).toBe(false);
        expect(entrada.ok === false && entrada.error.codigo).toBe("SIN_PERMISO");
      }
    });

    it("un usuario sin persona vinculada no ve nada (nunca se busca por email)", async () => {
      const yo = await ingresarEn(mundo, HOST_A);
      // Existe una persona con SU email y una empresa, pero sin vínculo con su usuario.
      const persona = (
        await mundo.dueno.query<{ id: string }>(
          "insert into persona (email) values ($1) returning id",
          [yo.sesion.email],
        )
      ).rows[0]?.id as string;
      await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE");
      const respuesta = await empresasDeLaPersona(mundo.dependencias, yo.sesion, mundo.marcaA);
      expect(respuesta).toEqual({ ok: true, dato: { personaId: null, empresas: [] } });
    });

    it("una persona suspendida globalmente no ve empresas", async () => {
      const yo = await ingresarEn(mundo, HOST_A);
      const persona = await personaVinculada(mundo, yo.sesion);
      await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE");
      await mundo.dueno.query("update persona set activo_global = false where id = $1", [persona]);
      const respuesta = await empresasDeLaPersona(mundo.dependencias, yo.sesion, mundo.marcaA);
      expect(respuesta).toEqual({ ok: true, dato: { personaId: null, empresas: [] } });
    });
  });

  describe("elegir empresa y contexto operativo", () => {
    it("una sola empresa: entra directo, con el contexto armado por el servidor (empresa validada, marca del host)", async () => {
      const yo = await ingresarEn(mundo, HOST_A);
      const persona = await personaVinculada(mundo, yo.sesion);
      const e = await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE");
      const entrada = await resolverEmpresa(mundo.dependencias, {
        sesion: yo.sesion,
        marcaId: mundo.marcaA,
        cookieDeEmpresa: null,
      });
      expect(entrada.ok && entrada.dato.tipo).toBe("ENTRA");
      if (!entrada.ok || entrada.dato.tipo !== "ENTRA") return;
      expect(entrada.dato.empresa.empresaId).toBe(e.empresa);
      expect(entrada.dato.empresa.rol).toBe("GERENTE");
      expect(entrada.dato.empresa.estadoEfectivo).toBe("OPERA");
      expect(entrada.dato.contexto).toMatchObject({
        tipo: "OPERATIVO",
        empresaId: e.empresa,
        personaId: persona,
        marcaDeEntrada: mundo.marcaA,
      });
      // La base acepta ese contexto: el gerente lista las sucursales de SU empresa.
      const sucursales = await sucursalesDeLaEmpresa(mundo.dependencias, entrada.dato.contexto);
      expect(sucursales).toEqual({
        ok: true,
        dato: [{ id: expect.any(String) as string, nombre: "Casa central" }],
      });
    });

    it("la marca del contexto es siempre la del host: la misma persona entra por A con la marca A y por B con la marca B", async () => {
      const enA = await ingresarEn(mundo, HOST_A);
      const persona = await personaVinculada(mundo, enA.sesion);
      await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE");
      const deB = await empresaDeLaMarca(mundo, mundo.marcaB, persona, "GERENTE");
      const enB = await ingresarEn(mundo, HOST_B, enA.perfil);
      const entradaA = await resolverEmpresa(mundo.dependencias, {
        sesion: enA.sesion,
        marcaId: mundo.marcaA,
        cookieDeEmpresa: null,
      });
      const entradaB = await resolverEmpresa(mundo.dependencias, {
        sesion: enB.sesion,
        marcaId: mundo.marcaB,
        cookieDeEmpresa: deB.empresa,
      });
      expect(
        entradaA.ok && entradaA.dato.tipo === "ENTRA" && entradaA.dato.contexto.marcaDeEntrada,
      ).toBe(mundo.marcaA);
      expect(
        entradaB.ok && entradaB.dato.tipo === "ENTRA" && entradaB.dato.contexto.marcaDeEntrada,
      ).toBe(mundo.marcaB);
      // HUECO conocido (se informa, no es de W5): la carga de autorización de la base todavía NO compara
      // `marcaDeEntrada` con la marca del tenant, así que la barrera entre marcas es esta resolución, que
      // solo ofrece empresas de la marca del host. Ver el informe de W5.
    });

    it("un operador no puede listar sucursales: llega el motivo, no un error inesperado", async () => {
      const yo = await ingresarEn(mundo, HOST_A);
      const persona = await personaVinculada(mundo, yo.sesion);
      await empresaDeLaMarca(mundo, mundo.marcaA, persona, "OPERADOR");
      const entrada = await resolverEmpresa(mundo.dependencias, {
        sesion: yo.sesion,
        marcaId: mundo.marcaA,
        cookieDeEmpresa: null,
      });
      if (!entrada.ok || entrada.dato.tipo !== "ENTRA") throw new Error("tenía que entrar");
      const sucursales = await sucursalesDeLaEmpresa(mundo.dependencias, entrada.dato.contexto);
      expect(sucursales).toEqual({
        ok: false,
        error: {
          codigo: "SIN_PERMISO",
          clave: "motivo.sin_permiso",
          presentacion: "POR_QUE_NO_PUEDO",
        },
      });
    });

    it("dos empresas: hay que elegir (con la lista completa); con la cookie válida entra a la elegida", async () => {
      const yo = await ingresarEn(mundo, HOST_A);
      const persona = await personaVinculada(mundo, yo.sesion);
      const e1 = await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE");
      const e2 = await empresaDeLaMarca(mundo, mundo.marcaA, persona, "OPERADOR");
      const sinCookie = await resolverEmpresa(mundo.dependencias, {
        sesion: yo.sesion,
        marcaId: mundo.marcaA,
        cookieDeEmpresa: null,
      });
      expect(sinCookie.ok && sinCookie.dato.tipo).toBe("ELEGIR");
      expect(
        sinCookie.ok &&
          sinCookie.dato.tipo === "ELEGIR" &&
          sinCookie.dato.empresas.map((e) => e.empresaId).sort(),
      ).toEqual([e1.empresa, e2.empresa].sort());
      const elegida = await elegirEmpresa(mundo.dependencias, {
        sesion: yo.sesion,
        marcaId: mundo.marcaA,
        empresaId: e2.empresa,
      });
      expect(elegida).toEqual({ ok: true, dato: { empresaId: e2.empresa } });
      const conCookie = await resolverEmpresa(mundo.dependencias, {
        sesion: yo.sesion,
        marcaId: mundo.marcaA,
        cookieDeEmpresa: e2.empresa,
      });
      expect(conCookie.ok && conCookie.dato.tipo === "ENTRA" && conCookie.dato.empresa.rol).toBe(
        "OPERADOR",
      );
      // Una empresa en alta o suspendida aparece en la lista, con su estado (la pantalla explica por qué no opera).
      const suspendida = await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE", {
        estado: "SUSPENDED",
      });
      const lista = await empresasDeLaPersona(mundo.dependencias, yo.sesion, mundo.marcaA);
      const estado = lista.ok
        ? lista.dato.empresas.find((e) => e.empresaId === suspendida.empresa)?.estadoEfectivo
        : null;
      expect(estado).toBe("EMPRESA_SUSPENDIDA");
    });

    it("elegir una empresa vacía o repetida es lo mismo que la primera vez (regla natural de repetición)", async () => {
      const yo = await ingresarEn(mundo, HOST_A);
      const persona = await personaVinculada(mundo, yo.sesion);
      const e = await empresaDeLaMarca(mundo, mundo.marcaA, persona, "GERENTE");
      const pedir = (empresaId: string) =>
        elegirEmpresa(mundo.dependencias, { sesion: yo.sesion, marcaId: mundo.marcaA, empresaId });
      expect(await pedir(e.empresa)).toEqual(await pedir(e.empresa));
      const vacia = await pedir("");
      expect(vacia.ok).toBe(false);
    });
  });

  describe("P-10: invitación -> aceptar -> panel", () => {
    it("el alta del gerente: ingresa con Google, acepta, queda vinculado y entra directo a su empresa", async () => {
      const m = await empresaSinMiembros("PROVISIONING");
      const email = emailAlAzar("gerente");
      const { token } = await invitar(
        mundo,
        m.tenant,
        [{ empresa: m.empresa, rol: "GERENTE" }],
        email,
        "ALTA_GERENTE",
      );
      const yo = await ingresarEn(mundo, HOST_A, perfilAlAzar({ email }));

      // Antes de aceptar, el usuario no tiene persona ni empresas.
      const antes = await empresasDeLaPersona(mundo.dependencias, yo.sesion, mundo.marcaA);
      expect(antes).toEqual({ ok: true, dato: { personaId: null, empresas: [] } });

      const aceptada = await aceptarInvitacionDeLaSesion(mundo.dependencias, {
        token,
        sesion: yo.sesion,
      });
      expect(aceptada).toEqual({
        ok: true,
        dato: { yaEstabaAceptada: false, empresas: [{ empresaId: m.empresa, rol: "GERENTE" }] },
      });
      // Segundo ingreso (nueva sesión): entra directo, con una sola empresa, ya activa.
      const otraVez = await ingresarEn(mundo, HOST_A, yo.perfil);
      const entrada = await resolverEmpresa(mundo.dependencias, {
        sesion: otraVez.sesion,
        marcaId: mundo.marcaA,
        cookieDeEmpresa: null,
      });
      expect(entrada.ok && entrada.dato.tipo === "ENTRA" && entrada.dato.empresa).toMatchObject({
        empresaId: m.empresa,
        rol: "GERENTE",
        estadoEfectivo: "OPERA",
      });
      const fila = await mundo.dueno.query<{ estado: string }>(
        "select estado from empresa where id = $1",
        [m.empresa],
      );
      expect(fila.rows[0]?.estado).toBe("ACTIVE");
    });

    it("una segunda invitación suma una segunda empresa: ahora hay que elegir", async () => {
      const m1 = await empresaSinMiembros("PROVISIONING");
      const email = emailAlAzar("gerente");
      const primera = await invitar(
        mundo,
        m1.tenant,
        [{ empresa: m1.empresa, rol: "GERENTE" }],
        email,
        "ALTA_GERENTE",
      );
      const yo = await ingresarEn(mundo, HOST_A, perfilAlAzar({ email }));
      await aceptarInvitacionDeLaSesion(mundo.dependencias, {
        token: primera.token,
        sesion: yo.sesion,
      });
      const m2 = await empresaSinMiembros();
      const segunda = await invitar(
        mundo,
        m2.tenant,
        [{ empresa: m2.empresa, rol: "OPERADOR" }],
        email,
      );
      const aceptada = await aceptarInvitacionDeLaSesion(mundo.dependencias, {
        token: segunda.token,
        sesion: yo.sesion,
      });
      expect(aceptada.ok).toBe(true);
      const entrada = await resolverEmpresa(mundo.dependencias, {
        sesion: yo.sesion,
        marcaId: mundo.marcaA,
        cookieDeEmpresa: null,
      });
      expect(entrada.ok && entrada.dato.tipo).toBe("ELEGIR");
    });

    it("errores tipados de la aceptación, traducidos por el traductor único", async () => {
      const m = await empresaSinMiembros();
      const email = emailAlAzar("invitado");
      const { token } = await invitar(mundo, m.tenant, [{ empresa: m.empresa }], email);
      const otroEmail = await ingresarEn(mundo, HOST_A);
      const deOtroEmail = await aceptarInvitacionDeLaSesion(mundo.dependencias, {
        token,
        sesion: otroEmail.sesion,
      });
      expect(deOtroEmail).toEqual({
        ok: false,
        error: {
          codigo: "INVITACION_DE_OTRO_EMAIL",
          clave: "error.invitacion_de_otro_email",
          presentacion: "AVISO",
        },
      });
      const inexistente = await aceptarInvitacionDeLaSesion(mundo.dependencias, {
        token: "un-token-que-no-existe",
        sesion: otroEmail.sesion,
      });
      expect(inexistente).toMatchObject({
        ok: false,
        error: { codigo: "INVITACION_NO_ENCONTRADA" },
      });
      for (const token of ["", "x".repeat(513)]) {
        const r = await aceptarInvitacionDeLaSesion(mundo.dependencias, {
          token,
          sesion: otroEmail.sesion,
        });
        expect(r).toMatchObject({ ok: false, error: { codigo: "INVITACION_NO_ENCONTRADA" } });
      }
      // Ninguno de esos fue un fallo inesperado: nada fue al registro.
      expect(mundo.registros.filter((r) => r.includes("INVITACION"))).toEqual([]);
    });

    it("CONCURRENCIA: aceptar la misma invitación dos veces a la vez deja UNA membresía y nunca la duplica", async () => {
      const m = await empresaSinMiembros("PROVISIONING");
      const email = emailAlAzar("doble");
      const { token } = await invitar(
        mundo,
        m.tenant,
        [{ empresa: m.empresa, rol: "GERENTE" }],
        email,
        "ALTA_GERENTE",
      );
      const yo = await ingresarEn(mundo, HOST_A, perfilAlAzar({ email }));
      const barrera = crearBarrera(2);
      const resultados = await Promise.all(
        [0, 1].map(async () => {
          await barrera();
          return aceptarInvitacionDeLaSesion(mundo.dependencias, { token, sesion: yo.sesion });
        }),
      );
      // Cada una devuelve el éxito (la segunda, `yaEstabaAceptada`) o el error genérico de concurrencia con su referencia.
      for (const r of resultados) {
        if (!r.ok) {
          expect(r.error.codigo).toBe("ERROR_INTERNO");
          expect(r.error.referencia).toMatch(/^ZH-[0-9A-F]{4}-[0-9A-F]{4}$/);
        }
      }
      expect(resultados.some((r) => r.ok)).toBe(true);
      expect(resultados.filter((r) => r.ok && !r.dato.yaEstabaAceptada).length).toBeLessThanOrEqual(
        1,
      );
      const membresias = await mundo.dueno.query("select 1 from membresia where empresa_id = $1", [
        m.empresa,
      ]);
      expect(membresias.rowCount).toBe(1);
      const personas = await mundo.dueno.query("select 1 from persona where email = $1", [email]);
      expect(personas.rowCount).toBe(1);
      // Repetirla después, con la sesión de siempre: el mismo resultado exitoso y nada nuevo.
      const repetida = await aceptarInvitacionDeLaSesion(mundo.dependencias, {
        token,
        sesion: yo.sesion,
      });
      expect(repetida).toMatchObject({ ok: true, dato: { yaEstabaAceptada: true } });
      expect(
        (await mundo.dueno.query("select 1 from membresia where empresa_id = $1", [m.empresa]))
          .rowCount,
      ).toBe(1);
    });
  });

  describe("sesión: renovar (P-6, P-7), cerrar y vencer", () => {
    const pedidoDeRenovar = (
      n: Navegador,
      host: string,
      origen: string | null = `https://${host}`,
    ) => {
      const encabezados = new Headers(n.pedidoDe(host).headers);
      encabezados.set("host", host);
      if (origen !== null) encabezados.set("origin", origen);
      return { host, encabezados };
    };

    it("renovar devuelve la cookie renovada en la respuesta (si no, moriría a los 15 minutos del ingreso)", async () => {
      const yo = await ingresarEn(mundo, HOST_A);
      const respuesta = await renovarSesion(
        mundo.dependencias,
        pedidoDeRenovar(yo.navegador, HOST_A),
      );
      expect(respuesta.status).toBe(200);
      const cookies = respuesta.headers.getSetCookie();
      expect(cookies.length).toBeGreaterThan(0);
      const cookieDeSesion = cookies.find((c) => c.includes("session_token"));
      expect(cookieDeSesion).toMatch(/Max-Age=900/i);
      expect(cookieDeSesion).toMatch(/HttpOnly/i);
      expect(cookieDeSesion).toMatch(/Secure/i);
      expect(cookieDeSesion).toMatch(/SameSite=Lax/i);
      expect(cookieDeSesion).not.toMatch(/Domain=/i);
      expect(respuesta.headers.get("cache-control")).toBe("private, no-store");
      expect(JSON.parse(await respuesta.text())).toHaveProperty("venceEn");
    });

    it("P-6: la cookie de A reenviada al host B no renueva nada: 401, sin cookies y la sesión de A intacta", async () => {
      const yo = await ingresarEn(mundo, HOST_A);
      const ladron = new Navegador();
      yo.navegador.copiarCookiesA(ladron, HOST_A, HOST_B);
      const respuesta = await renovarSesion(mundo.dependencias, pedidoDeRenovar(ladron, HOST_B));
      expect(respuesta.status).toBe(401);
      expect(await respuesta.json()).toEqual({ codigo: "SESION_VENCIDA" });
      expect(respuesta.headers.getSetCookie()).toEqual([]);
      expect(
        await mundo.auth.autenticacion.sesionDe(yo.navegador.pedidoDe(HOST_A), HOST_A),
      ).not.toBeNull();
    });

    it("P-7: un pedido de renovación de OTRO origen es SIN_PERMISO y no renueva", async () => {
      const yo = await ingresarEn(mundo, HOST_A);
      for (const origen of ["https://sitio-malo.test", `http://${HOST_A}`, "null"]) {
        const respuesta = await renovarSesion(
          mundo.dependencias,
          pedidoDeRenovar(yo.navegador, HOST_A, origen),
        );
        expect(respuesta.status, origen).toBe(403);
        expect(await respuesta.json()).toEqual({ codigo: "SIN_PERMISO" });
        expect(respuesta.headers.getSetCookie()).toEqual([]);
      }
      const sinOrigen = await renovarSesion(
        mundo.dependencias,
        pedidoDeRenovar(yo.navegador, HOST_A, null),
      );
      expect(sinOrigen.status).toBe(200);
    });

    it("sin cookie: 401 SESION_VENCIDA", async () => {
      const respuesta = await renovarSesion(
        mundo.dependencias,
        pedidoDeRenovar(new Navegador(), HOST_A),
      );
      expect(respuesta.status).toBe(401);
    });

    it("sesión vencida (se mueve expiresAt en la base): ya no hay sesión y renovar responde 401", async () => {
      const yo = await ingresarEn(mundo, HOST_A);
      await mundo.dueno.query(
        `update autenticacion.session set "expiresAt" = now() - interval '1 minute' where "userId" = $1`,
        [yo.sesion.usuarioAuth],
      );
      expect(
        await mundo.auth.autenticacion.sesionDe(yo.navegador.pedidoDe(HOST_A), HOST_A),
      ).toBeNull();
      const respuesta = await renovarSesion(
        mundo.dependencias,
        pedidoDeRenovar(yo.navegador, HOST_A),
      );
      expect(respuesta.status).toBe(401);
    });

    it("cerrar sesión borra la fila y devuelve las cookies que la borran del navegador", async () => {
      const yo = await ingresarEn(mundo, HOST_A);
      const filas = () =>
        mundo.dueno.query(`select 1 from autenticacion.session where "userId" = $1`, [
          yo.sesion.usuarioAuth,
        ]);
      expect((await filas()).rowCount).toBe(1);
      const encabezados = new Headers(yo.navegador.pedidoDe(HOST_A).headers);
      const cierre = await cerrarSesion(mundo.dependencias, { host: HOST_A, encabezados });
      expect(cierre.ok).toBe(true);
      expect((await filas()).rowCount).toBe(0);
      expect(
        cierre.ok && cierre.dato.cookies.some((c) => /session_token=;|Max-Age=0/i.test(c)),
      ).toBe(true);
      expect(
        await mundo.auth.autenticacion.sesionDe(yo.navegador.pedidoDe(HOST_A), HOST_A),
      ).toBeNull();
    });

    it("iniciar el ingreso devuelve la dirección de Google y las cookies del estado, con la sesión por nacer atada a ESTE host", async () => {
      const encabezados = new Headers();
      const inicio = await iniciarIngresoConGoogle(mundo.dependencias, {
        host: HOST_A,
        encabezados,
        volver: "/cuenta",
      });
      expect(inicio.ok).toBe(true);
      if (!inicio.ok) return;
      const url = new URL(inicio.dato.url);
      expect(url.hostname).toBe("accounts.google.com");
      expect(url.searchParams.get("redirect_uri")).toBe(
        `https://${HOST_A}/api/auth/callback/google`,
      );
      expect(inicio.dato.cookies.length).toBeGreaterThan(0);
    });

    it("una librería de ingreso que falla sale como error inesperado, sin detalle y con referencia", async () => {
      const roto = {
        ...mundo.dependencias,
        autenticacion: () => ({
          sesionDe: () => Promise.reject(new Error("connect ECONNREFUSED 10.9.9.9:5432")),
          manejar: () => Promise.reject(new Error("connect ECONNREFUSED 10.9.9.9:5432")),
        }),
      };
      const encabezados = new Headers();
      const inicio = await iniciarIngresoConGoogle(roto, {
        host: HOST_A,
        encabezados,
        volver: "/",
      });
      const cierre = await cerrarSesion(roto, { host: HOST_A, encabezados });
      const renovar = await renovarSesion(roto, { host: HOST_A, encabezados });
      for (const r of [inicio, cierre]) {
        expect(r).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
        expect(JSON.stringify(r)).not.toMatch(/ECONNREFUSED|10\.9\.9\.9/);
      }
      expect(renovar.status).toBe(500);
      expect(await renovar.text()).not.toMatch(/ECONNREFUSED|10\.9\.9\.9/);
      expect(mundo.registros.some((r) => r.includes("ECONNREFUSED"))).toBe(true);
    });
  });

  /** Una empresa de la marca A sin ningún miembro (la de una invitación); `enAlta` para el alta del gerente. */
  async function empresaSinMiembros(
    estado: "ACTIVE" | "PROVISIONING" = "ACTIVE",
  ): Promise<{ empresa: string; tenant: string }> {
    const m = await crearMundoDeMarca(mundo.dueno, { marca: mundo.marcaA, estado });
    return { empresa: m.empresa, tenant: m.tenant };
  }
});
