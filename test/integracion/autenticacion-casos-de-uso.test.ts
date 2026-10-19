import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearTokensHmac } from "../../src/adaptadores/tokens/tokens-hmac";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  crearCasosDeUsoDeIdentidad,
  crearConsultasDeSesion,
  type CasosDeUsoDeIdentidad,
  type ConsultasDeSesion,
} from "../../src/modulos/identidad/publico";
import {
  empresaId,
  marcaComercialId,
  personaId,
  type UsuarioAuthId,
} from "../../src/primitivas/identificadores/marca";
import type { Tokens } from "../../src/puertos/tokens";
import { usuarioAlAzar } from "../utilidades/usuarios";
import { empresaConMiembro, personaConUsuario } from "./autenticacion-apoyo";
import {
  AHORA_DE_PRUEBA,
  comoSesion,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEmpresaEnAlta,
  crearEntornoDePrueba,
  type EmpresaDePrueba,
} from "./entorno";
import {
  crearInvitacionDeBase,
  crearPersonaDeBase,
  emailAlAzar,
  incluirEmpresa,
  type RolDePrueba,
} from "./fixtures-identidad";
import { crearMarca, crearMundoDeMarca, marcaPrincipal } from "./marcas-apoyo";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../utilidades/marcas";

/**
 * Autenticación (W3a): `aceptarInvitacion` con el usuario autenticado y las lecturas de la sesión, contra una
 * base real con los roles limitados. Lo crítico, por orden:
 *
 *  - el VÍNCULO persona <-> usuario se fija en la aceptación (con su constancia), una sola vez, y nunca se pisa;
 *  - IDEMPOTENCIA: repetir la aceptación con el mismo usuario devuelve lo mismo y no escribe NADA;
 *  - todo o nada: si el vínculo no se puede fijar, no queda nada (ni persona, ni aceptación, ni membresía);
 *  - `personaDeLaSesion` y `empresasDeLaSesion` ven solo lo del usuario y solo la marca de la puerta.
 * La concurrencia está en `autenticacion-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
const ahora = AHORA_DE_PRUEBA;

type Fila = Record<string, unknown>;

describe.skipIf(base === null)("autenticación: aceptar con usuario y leer la sesión", () => {
  // Base propia (ver `identidad-casos-de-uso.test.ts`): SERIALIZABLE aborta por falsos positivos con otros archivos.
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;
  let tokens: Tokens;
  let casos: CasosDeUsoDeIdentidad;
  let consultas: ConsultasDeSesion;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 10);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    tokens = crearTokensHmac(randomBytes(32));
    casos = crearCasosDeUsoDeIdentidad({
      transacciones: entorno,
      tokens,
      reglas: REGLAS_DE_EMPRESA,
    });
    consultas = crearConsultasDeSesion({ transacciones: entorno });
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;

  /** Una invitación de USUARIO (armada por el dueño) a esas empresas, para ese email. */
  const invitacion = async (
    empresas: { e: EmpresaDePrueba; rol?: RolDePrueba }[],
    email = emailAlAzar("invitado"),
  ) => {
    const emitido = tokens.emitir();
    const inv = await crearInvitacionDeBase(dueno, {
      tenant: empresas[0]?.e.tenant as string,
      id: emitido.invitacionId,
      tokenHash: emitido.tokenHash,
      email,
    });
    for (const { e, rol } of empresas)
      await incluirEmpresa(dueno, inv, e.empresa, rol ?? "OPERADOR");
    return { inv, email, token: emitido.token };
  };

  /** El alta del gerente de una empresa en PROVISIONING. */
  const alta = async () => {
    const empresa = await crearEmpresaEnAlta(entorno);
    const emitido = tokens.emitir();
    const email = emailAlAzar("gerente");
    const inv = await crearInvitacionDeBase(dueno, {
      tenant: empresa.tenant,
      id: emitido.invitacionId,
      tokenHash: emitido.tokenHash,
      tipo: "ALTA_GERENTE",
      email,
    });
    await incluirEmpresa(dueno, inv, empresa.empresa, "GERENTE");
    return { empresa, inv, email, token: emitido.token };
  };

  const aceptar = (token: string, email: string | null, usuarioAuth: UsuarioAuthId) =>
    casos.aceptarInvitacion({
      token,
      emailAutenticado: email,
      usuarioAuth,
      marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
      ahora,
    });

  const vinculoDe = async (email: string) =>
    (
      await filas<{ id: string; usuario_auth_id: string | null }>(
        "select id, usuario_auth_id from persona where email = $1",
        [email],
      )
    )[0];

  /** Todo lo que puede tocar `aceptarInvitacion`, para esas empresas y esos emails: la «foto» de la base. */
  const foto = async (empresas: string[], emails: string[]) =>
    JSON.stringify({
      personas: await filas("select * from persona where email = any($1) order by email", [emails]),
      membresias: await filas(
        "select * from membresia where empresa_id = any($1) order by empresa_id, persona_id",
        [empresas],
      ),
      invitaciones: await filas(
        `select i.* from invitacion i where i.id in (select invitacion_id from invitacion_empresa where empresa_id = any($1))
         order by i.id`,
        [empresas],
      ),
      auditoria: await filas(
        "select id, empresa_id, accion, actor_persona_id, antes, despues from auditoria_empresa where empresa_id = any($1) order by id",
        [empresas],
      ),
      empresas: await filas(
        "select id, estado, version from empresa where id = any($1) order by id",
        [empresas],
      ),
    });

  const acciones = async (empresa: string) =>
    (
      await filas<{ accion: string }>(
        "select accion from auditoria_empresa where empresa_id = $1 order by id",
        [empresa],
      )
    ).map((f) => f.accion);

  // =============================================================================================
  // El vínculo se fija al aceptar
  // =============================================================================================
  describe("el vínculo persona <-> usuario", () => {
    it("aceptar el alta del gerente crea la persona, la VINCULA con el usuario que aceptó y deja la constancia", async () => {
      const { empresa, email, token } = await alta();
      const usuario = usuarioAlAzar();

      const r = await aceptar(token, email, usuario);

      expect(r.ok).toBe(true);
      const persona = await vinculoDe(email);
      expect(persona?.usuario_auth_id).toBe(usuario);
      if (r.ok) expect(r.valor.personaId).toBe(persona?.id);
      expect(await acciones(empresa.empresa)).toEqual([
        "ALTA_ACEPTADA",
        "EMPRESA_ACTIVADA",
        "PERSONA_VINCULADA",
      ]);
      const constancia = (
        await filas(
          "select actor_persona_id, entidad, entidad_id, antes, despues from auditoria_empresa where empresa_id = $1 and accion = 'PERSONA_VINCULADA'",
          [empresa.empresa],
        )
      )[0];
      expect(constancia).toEqual({
        actor_persona_id: persona?.id,
        entidad: "persona",
        entidad_id: persona?.id,
        antes: { usuarioAuth: null },
        despues: { usuarioAuth: usuario },
      });
    });

    it("una persona que ya existía, sin usuario, queda vinculada al aceptar una invitación de usuario", async () => {
      const e = await crearEmpresaActiva(entorno);
      const existente = await crearPersonaDeBase(dueno);
      const { email, token } = await invitacion([{ e }], existente.email);
      const usuario = usuarioAlAzar();

      const r = await aceptar(token, email, usuario);

      expect(r.ok).toBe(true);
      expect(await vinculoDe(existente.email)).toEqual({
        id: existente.id,
        usuario_auth_id: usuario,
      });
      expect(await acciones(e.empresa)).toEqual(["INVITACION_ACEPTADA", "PERSONA_VINCULADA"]);
    });

    it("la persona ya vinculada que acepta otra invitación con el MISMO usuario sigue igual y no se vuelve a vincular", async () => {
      const e1 = await crearEmpresaActiva(entorno);
      const e2 = await crearEmpresaActiva(entorno);
      const usuario = usuarioAlAzar();
      const primera = await invitacion([{ e: e1 }]);
      expect((await aceptar(primera.token, primera.email, usuario)).ok).toBe(true);
      const segunda = await invitacion([{ e: e2 }], primera.email);

      const r = await aceptar(segunda.token, segunda.email, usuario);

      expect(r.ok).toBe(true);
      expect((await vinculoDe(primera.email))?.usuario_auth_id).toBe(usuario);
      // Sin constancia de vínculo en la segunda empresa: no se fijó nada nuevo.
      expect(await acciones(e2.empresa)).toEqual(["INVITACION_ACEPTADA"]);
    });

    it("con OTRO usuario, una persona ya vinculada se rechaza (PERSONA_DE_OTRO_USUARIO) y NO queda nada escrito", async () => {
      const e1 = await crearEmpresaActiva(entorno);
      const e2 = await crearEmpresaActiva(entorno);
      const primera = await invitacion([{ e: e1 }]);
      const dueño = usuarioAlAzar();
      expect((await aceptar(primera.token, primera.email, dueño)).ok).toBe(true);
      const segunda = await invitacion([{ e: e2 }], primera.email);
      const antes = await foto([e1.empresa, e2.empresa], [primera.email]);

      const r = await aceptar(segunda.token, segunda.email, usuarioAlAzar());

      expect(r).toEqual({ ok: false, error: "PERSONA_DE_OTRO_USUARIO" });
      expect(await foto([e1.empresa, e2.empresa], [primera.email])).toBe(antes);
      expect((await vinculoDe(primera.email))?.usuario_auth_id).toBe(dueño);
      const pendiente = await filas<{ estado: string }>(
        "select estado from invitacion where id = $1",
        [segunda.inv.id],
      );
      expect(pendiente).toEqual([{ estado: "PENDIENTE" }]);
    });

    it("un usuario ya vinculado con otra persona no puede aceptar para la persona de otro email (USUARIO_DE_OTRA_PERSONA), y todo se revierte", async () => {
      const e1 = await crearEmpresaActiva(entorno);
      const e2 = await crearEmpresaActiva(entorno);
      const usuario = usuarioAlAzar();
      const primera = await invitacion([{ e: e1 }]);
      expect((await aceptar(primera.token, primera.email, usuario)).ok).toBe(true);
      // El usuario cambió de email en su proveedor y ahora lo invitan con el nuevo.
      const nuevo = await invitacion([{ e: e2 }]);
      const antes = await foto([e1.empresa, e2.empresa], [primera.email, nuevo.email]);

      const r = await aceptar(nuevo.token, nuevo.email, usuario);

      expect(r).toEqual({ ok: false, error: "USUARIO_DE_OTRA_PERSONA" });
      expect(await foto([e1.empresa, e2.empresa], [primera.email, nuevo.email])).toBe(antes);
      // La persona del email nuevo no llegó a crearse.
      expect(await vinculoDe(nuevo.email)).toBeUndefined();
    });

    it("con un email autenticado que no es el de la invitación no se crea ni se vincula nada", async () => {
      const e = await crearEmpresaActiva(entorno);
      const { email, token } = await invitacion([{ e }]);
      const antes = await foto([e.empresa], [email]);

      expect(await aceptar(token, emailAlAzar("otro"), usuarioAlAzar())).toEqual({
        ok: false,
        error: "INVITACION_DE_OTRO_EMAIL",
      });
      expect(await aceptar(token, null, usuarioAlAzar())).toEqual({
        ok: false,
        error: "INVITACION_DE_OTRO_EMAIL",
      });
      expect(await foto([e.empresa], [email])).toBe(antes);
      expect(await vinculoDe(email)).toBeUndefined();
    });

    it("una persona suspendida no se vincula: la aceptación se rechaza antes de escribir", async () => {
      const e = await crearEmpresaActiva(entorno);
      const existente = await crearPersonaDeBase(dueno);
      await dueno.query("update persona set activo_global = false where id = $1", [existente.id]);
      const { email, token } = await invitacion([{ e }], existente.email);

      expect(await aceptar(token, email, usuarioAlAzar())).toEqual({
        ok: false,
        error: "PERSONA_SUSPENDIDA",
      });
      expect((await vinculoDe(existente.email))?.usuario_auth_id).toBeNull();
    });

    it("una invitación aceptada ANTES de que existiera el vínculo lo completa en la repetición (una sola vez, con su constancia)", async () => {
      const e = await crearEmpresaActiva(entorno);
      const { inv, email, token } = await invitacion([{ e }]);
      // Cómo quedaba una aceptación con el código anterior: persona sin usuario, invitación aceptada, membresía.
      const persona = await crearPersonaDeBase(dueno, email);
      await dueno.query(
        "update invitacion set estado = 'ACEPTADA', aceptada_por = $2, aceptada_en = $3 where id = $1",
        [inv.id, persona.id, ahora],
      );
      await dueno.query(
        "insert into membresia (empresa_id, persona_id, rol, invitacion_id) values ($1, $2, 'OPERADOR', $3)",
        [e.empresa, persona.id, inv.id],
      );
      const usuario = usuarioAlAzar();

      const primera = await aceptar(token, email, usuario);
      expect(primera.ok && primera.valor.yaEstabaAceptada).toBe(true);
      expect((await vinculoDe(email))?.usuario_auth_id).toBe(usuario);
      expect(await acciones(e.empresa)).toEqual(["PERSONA_VINCULADA"]);

      // Y la segunda repetición ya no escribe.
      const antes = await foto([e.empresa], [email]);
      const segunda = await aceptar(token, email, usuario);
      expect(segunda).toEqual(primera);
      expect(await foto([e.empresa], [email])).toBe(antes);
    });
  });

  // =============================================================================================
  // Idempotencia
  // =============================================================================================
  describe("idempotencia: repetir con el mismo usuario devuelve lo mismo y no escribe nada", () => {
    it("la invitación de usuario: la segunda llamada es `yaEstabaAceptada` con la misma persona y empresas, sin tocar ni una fila", async () => {
      const e1 = await crearEmpresaActiva(entorno);
      const e2 = await crearEmpresaActiva(entorno, { tenant: e1.tenant });
      const { email, token } = await invitacion([
        { e: e1, rol: "OPERADOR" },
        { e: e2, rol: "ADMINISTRADOR" },
      ]);
      const usuario = usuarioAlAzar();

      const primera = await aceptar(token, email, usuario);
      expect(primera.ok && !primera.valor.yaEstabaAceptada).toBe(true);
      const antes = await foto([e1.empresa, e2.empresa], [email]);

      for (let i = 0; i < 3; i++) {
        const repetida = await aceptar(token, email, usuario);
        expect(repetida.ok).toBe(true);
        if (primera.ok && repetida.ok) {
          expect(repetida.valor).toEqual({ ...primera.valor, yaEstabaAceptada: true });
        }
      }
      expect(await foto([e1.empresa, e2.empresa], [email])).toBe(antes);
      // Una constancia de vínculo por empresa de la invitación, no una por llamada.
      for (const e of [e1, e2]) {
        expect((await acciones(e.empresa)).filter((a) => a === "PERSONA_VINCULADA")).toHaveLength(
          1,
        );
      }
    });

    it("el alta del gerente: repetir no vuelve a activar la empresa ni a duplicar la auditoría", async () => {
      const { empresa, email, token } = await alta();
      const usuario = usuarioAlAzar();
      expect((await aceptar(token, email, usuario)).ok).toBe(true);
      const antes = await foto([empresa.empresa], [email]);

      const repetida = await aceptar(token, email, usuario);

      expect(repetida.ok && repetida.valor.yaEstabaAceptada).toBe(true);
      expect(await foto([empresa.empresa], [email])).toBe(antes);
      expect(await acciones(empresa.empresa)).toEqual([
        "ALTA_ACEPTADA",
        "EMPRESA_ACTIVADA",
        "PERSONA_VINCULADA",
      ]);
    });

    it("repetir con OTRO usuario (mismo email) NO es un éxito: PERSONA_DE_OTRO_USUARIO y la base no cambia", async () => {
      const e = await crearEmpresaActiva(entorno);
      const { email, token } = await invitacion([{ e }]);
      expect((await aceptar(token, email, usuarioAlAzar())).ok).toBe(true);
      const antes = await foto([e.empresa], [email]);

      expect(await aceptar(token, email, usuarioAlAzar())).toEqual({
        ok: false,
        error: "PERSONA_DE_OTRO_USUARIO",
      });
      expect(await foto([e.empresa], [email])).toBe(antes);
    });
  });

  // =============================================================================================
  // Lecturas de la sesión
  // =============================================================================================
  describe("personaDeLaSesion y empresasDeLaSesion", () => {
    it("después de aceptar, la sesión del usuario encuentra su persona y su empresa (de punta a punta)", async () => {
      const principal = marcaComercialId(await marcaPrincipal(dueno));
      const { empresa, email, token } = await alta();
      const usuario = usuarioAlAzar();
      const aceptada = await aceptar(token, email, usuario);
      expect(aceptada.ok).toBe(true);

      const persona = await consultas.personaDeLaSesion(comoSesion(usuario));
      expect(persona).toEqual({
        ok: true,
        valor: { personaId: aceptada.ok ? aceptada.valor.personaId : null },
      });
      const empresas = await consultas.empresasDeLaSesion(comoSesion(usuario), {
        marcaId: principal,
      });
      expect(empresas.ok).toBe(true);
      if (empresas.ok) {
        expect(empresas.valor).toEqual([
          {
            empresaId: empresaId(empresa.empresa),
            nombre: expect.any(String) as string,
            rol: "GERENTE",
            estado: "ACTIVE",
            estadoEfectivo: "OPERA",
          },
        ]);
      }
    });

    it("sin vínculo (usuario nuevo, sin persona) no hay persona ni empresas: nunca se busca por email", async () => {
      const principal = marcaComercialId(await marcaPrincipal(dueno));
      // Una persona con el MISMO email que el usuario, con membresía, pero sin vínculo.
      const email = emailAlAzar("mismo-email");
      const persona = await crearPersonaDeBase(dueno, email);
      await empresaConMiembro(dueno, { persona: persona.id });
      const usuario = usuarioAlAzar();

      expect(await consultas.personaDeLaSesion(comoSesion(usuario))).toEqual({
        ok: true,
        valor: null,
      });
      expect(
        await consultas.empresasDeLaSesion(comoSesion(usuario), { marcaId: principal }),
      ).toEqual({
        ok: true,
        valor: [],
      });
    });

    it("una sesión de una marca no vale en otra: con la marca de otra puerta, la lista de empresas es vacía", async () => {
      const principal = marcaComercialId(await marcaPrincipal(dueno));
      const otra = marcaComercialId(await crearMarca(dueno));
      const tercera = marcaComercialId(await crearMarca(dueno));
      const p = await personaConUsuario(dueno);
      const enPrincipal = await empresaConMiembro(dueno, p, { marca: principal });
      const enOtra = await empresaConMiembro(dueno, p, { marca: otra, rol: "GERENTE" });

      const deLa = async (marcaId: typeof principal) => {
        const r = await consultas.empresasDeLaSesion(comoSesion(p.usuario), { marcaId });
        if (!r.ok) throw new Error(JSON.stringify(r.error));
        return r.valor.map((e) => e.empresaId);
      };
      expect(await deLa(principal)).toEqual([empresaId(enPrincipal.empresa)]);
      expect(await deLa(otra)).toEqual([empresaId(enOtra.empresa)]);
      expect(await deLa(tercera)).toEqual([]);
      // La persona es una sola, entre marcas.
      expect(await consultas.personaDeLaSesion(comoSesion(p.usuario))).toEqual({
        ok: true,
        valor: { personaId: personaId(p.persona) },
      });
    });

    it("lista solo las membresías ACTIVAS, con su rol, ordenadas por nombre, y dice si la empresa opera", async () => {
      const principal = marcaComercialId(await marcaPrincipal(dueno));
      const p = await personaConUsuario(dueno);
      const activa = await empresaConMiembro(dueno, p, { marca: principal, rol: "ADMINISTRADOR" });
      const apagada = await empresaConMiembro(dueno, p, { marca: principal, activo: false });
      const suspendida = await empresaConMiembro(dueno, p, {
        marca: principal,
        estado: "SUSPENDED",
      });
      const enAlta = await empresaConMiembro(dueno, p, {
        marca: principal,
        estado: "PROVISIONING",
      });
      // Un tenant suspendido arrastra a sus empresas, aunque ellas estén ACTIVE.
      const delSuspendido = await empresaConMiembro(dueno, p, { marca: principal });
      await dueno.query(
        "update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
        [delSuspendido.tenant],
      );
      // Nombres que fijan el orden.
      for (const [mundo, nombre] of [
        [activa, "Beta"],
        [suspendida, "Alfa"],
        [enAlta, "Gamma"],
        [delSuspendido, "Delta"],
        [apagada, "Epsilon"],
      ] as const) {
        await dueno.query("update empresa set razon_social = $2 where id = $1", [
          mundo.empresa,
          nombre,
        ]);
      }

      const r = await consultas.empresasDeLaSesion(comoSesion(p.usuario), { marcaId: principal });

      expect(r).toEqual({
        ok: true,
        valor: [
          {
            empresaId: empresaId(suspendida.empresa),
            nombre: "Alfa",
            rol: "OPERADOR",
            estado: "SUSPENDED",
            estadoEfectivo: "EMPRESA_SUSPENDIDA",
          },
          {
            empresaId: empresaId(activa.empresa),
            nombre: "Beta",
            rol: "ADMINISTRADOR",
            estado: "ACTIVE",
            estadoEfectivo: "OPERA",
          },
          {
            empresaId: empresaId(delSuspendido.empresa),
            nombre: "Delta",
            rol: "OPERADOR",
            estado: "ACTIVE",
            estadoEfectivo: "TENANT_SUSPENDIDO",
          },
          {
            empresaId: empresaId(enAlta.empresa),
            nombre: "Gamma",
            rol: "OPERADOR",
            estado: "PROVISIONING",
            estadoEfectivo: "EMPRESA_EN_ALTA",
          },
        ],
      });
    });

    it("una persona suspendida globalmente no tiene persona ni empresas con su sesión", async () => {
      const principal = marcaComercialId(await marcaPrincipal(dueno));
      const p = await personaConUsuario(dueno, { activaGlobal: false });
      await empresaConMiembro(dueno, p, { marca: principal });

      expect(await consultas.personaDeLaSesion(comoSesion(p.usuario))).toEqual({
        ok: true,
        valor: null,
      });
      expect(
        await consultas.empresasDeLaSesion(comoSesion(p.usuario), { marcaId: principal }),
      ).toEqual({
        ok: true,
        valor: [],
      });
    });

    it("cada usuario ve solo lo suyo aunque comparta empresa con otro", async () => {
      const principal = marcaComercialId(await marcaPrincipal(dueno));
      const a = await personaConUsuario(dueno);
      const b = await personaConUsuario(dueno);
      const comun = await empresaConMiembro(dueno, a, { marca: principal });
      await dueno.query(
        "insert into membresia (empresa_id, persona_id, rol) values ($1, $2, 'ADMINISTRADOR')",
        [comun.empresa, b.persona],
      );
      const soloB = await empresaConMiembro(dueno, b, { marca: principal });

      const deA = await consultas.empresasDeLaSesion(comoSesion(a.usuario), { marcaId: principal });
      const deB = await consultas.empresasDeLaSesion(comoSesion(b.usuario), { marcaId: principal });

      expect(deA.ok && deA.valor.map((e) => [e.empresaId, e.rol])).toEqual([
        [empresaId(comun.empresa), "OPERADOR"],
      ]);
      expect(deB.ok && deB.valor.map((e) => [e.empresaId, e.rol]).sort()).toEqual(
        [
          [empresaId(comun.empresa), "ADMINISTRADOR"],
          [empresaId(soloB.empresa), "OPERADOR"],
        ].sort(),
      );
    });

    it("una marca de otro tenant sembrada con `crearMundoDeMarca` no se cuela: el filtro es por la marca del TENANT", async () => {
      const principal = marcaComercialId(await marcaPrincipal(dueno));
      const otra = await crearMarca(dueno);
      const p = await personaConUsuario(dueno);
      const mundo = await crearMundoDeMarca(dueno, { marca: otra });
      await dueno.query(
        "insert into membresia (empresa_id, persona_id, rol) values ($1, $2, 'OPERADOR')",
        [mundo.empresa, p.persona],
      );
      const r = await consultas.empresasDeLaSesion(comoSesion(p.usuario), { marcaId: principal });
      expect(r).toEqual({ ok: true, valor: [] });
    });
  });
});
