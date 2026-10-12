import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { crearCorreoFalso, type CorreoFalso } from "../../src/adaptadores/correo/correo-falso";
import { crearProcesadorDeTrabajos } from "../../src/adaptadores/trabajos/procesador";
import type { PoliticaDeReintentos } from "../../src/adaptadores/trabajos/reintentos";
import { crearTokensHmac } from "../../src/adaptadores/tokens/tokens-hmac";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  TRABAJO_ENVIAR_INVITACION,
  claveDeEnvioDeInvitacion,
  crearCasosDeUsoDeIdentidad,
  crearManejadorDeEnviarInvitacion,
  type CasosDeUsoDeIdentidad,
} from "../../src/modulos/identidad/publico";
import {
  personaId,
  sucursalId,
  type EmpresaId,
  type InvitacionId,
  type SucursalId,
} from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import type { Correo } from "../../src/puertos/correo";
import type { ColaDeTrabajos } from "../../src/puertos/cola-de-trabajos";
import {
  AHORA_DE_PRUEBA,
  comoEmpresa,
  comoPlataforma,
  comoTrabajos,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEmpresaEnAlta,
  crearEntornoDePrueba,
  nombreAlAzar,
  type EmpresaDePrueba,
} from "./entorno";
import {
  aceptarDeBase,
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  emailAlAzar,
  incluirEmpresa,
  revocarDeBase,
  sucursalDe,
} from "./fixtures-identidad";

/**
 * H5: el trabajo `enviar_invitacion` de punta a punta contra una base real: la invitación se crea con
 * los casos de uso de H3, el trabajo lo ejecuta el procesador con el contexto OPERATIVO de sistema de
 * la empresa y el mail sale por el correo falso. Cubre ADR-007 (idempotencia, estado de la invitación
 * antes de enviar, el token no se guarda) y el aislamiento por empresa.
 */

const base = inject("baseDePruebas");
const T0 = AHORA_DE_PRUEBA;
const DIA = 86_400_000;
const mas = (ms: number) => new Date(T0.getTime() + ms);
const URL_BASE = "https://app.ejemplo.test";
const POLITICA: Partial<PoliticaDeReintentos> = {
  maximoDeIntentos: 3,
  esperaBaseEnMs: 1_000,
  esperaMaximaEnMs: 4_000,
  plazoDeTomaEnMs: 60_000,
};

type Fila = Record<string, unknown>;

describe.skipIf(base === null)("enviar_invitacion: el trabajo contra una base real", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;
  let tokens: ReturnType<typeof crearTokensHmac>;
  let casos: CasosDeUsoDeIdentidad;

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
  });
  // Cada prueba parte de una cola sin pendientes de las anteriores.
  beforeEach(async () => {
    if (base === null) return;
    await dueno.query(
      "update trabajo set estado = 'EN_CURSO', tomado_hasta = now() where estado = 'PENDIENTE'",
    );
    await dueno.query(
      "update trabajo set estado = 'HECHO', tomado_hasta = null where estado = 'EN_CURSO'",
    );
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;

  // ---- escenarios ---------------------------------------------------------------------------

  type Escenario = EmpresaDePrueba & Readonly<{ sucursal: SucursalId; ctx: ContextoOperativo }>;

  /** Una empresa activa con su sucursal y su gerente (miembro activo). */
  const escenario = async (): Promise<Escenario> => {
    const e = await crearEmpresaActiva(entorno);
    const sucursal = sucursalId(await sucursalDe(dueno, e.empresa));
    const g = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, e.empresa, g.id, "GERENTE");
    return { ...e, sucursal, ctx: comoEmpresa(e.empresa, personaId(g.id)) };
  };

  const invitar = async (e: Escenario, email = emailAlAzar("invitado")) => {
    const r = await casos.invitarUsuario(e.ctx, {
      email,
      rol: "OPERADOR",
      sucursales: [e.sucursal],
    });
    if (!r.ok) throw new Error(`no se pudo invitar: ${JSON.stringify(r.error)}`);
    return { id: r.valor.invitacionId, email, token: tokens.derivar(r.valor.invitacionId) };
  };

  /** Una invitación de usuario armada por el dueño de la base, con su trabajo encolado en `empresaDelTrabajo`. */
  const invitacionConTrabajo = async (
    e: Escenario,
    cambios: { venceEn?: Date; empresaDelTrabajo?: EmpresaId; email?: string } = {},
  ) => {
    const emitido = tokens.emitir();
    const email = cambios.email ?? emailAlAzar("invitado");
    const inv = await crearInvitacionDeBase(dueno, {
      tenant: e.tenant,
      id: emitido.invitacionId,
      tokenHash: emitido.tokenHash,
      email,
      ...(cambios.venceEn === undefined ? {} : { venceEn: cambios.venceEn }),
    });
    await incluirEmpresa(dueno, inv, e.empresa, "OPERADOR", [e.sucursal]);
    await encolarEnvio(cambios.empresaDelTrabajo ?? e.empresa, emitido.invitacionId);
    return { inv, email, id: emitido.invitacionId, token: emitido.token };
  };

  const encolarEnvio = async (empresa: EmpresaId, id: InvitacionId | string) => {
    const r = await entorno.ejecutar({ contexto: comoEmpresa(empresa) }, async (tx) =>
      ok(
        await tx.trabajos.encolar({
          empresaId: empresa,
          tipo: TRABAJO_ENVIAR_INVITACION,
          datos: { invitacionId: id },
          claveDeIdempotencia: claveDeEnvioDeInvitacion(id),
        }),
      ),
    );
    expect(r).toEqual({ ok: true, valor: "ENCOLADO" });
  };

  // ---- el procesador con el correo falso ------------------------------------------------------

  const armar = (correo: Correo = crearCorreoFalso()) =>
    crearProcesadorDeTrabajos({
      transacciones: entorno,
      manejadores: new Map([
        [
          TRABAJO_ENVIAR_INVITACION,
          crearManejadorDeEnviarInvitacion({
            transacciones: entorno,
            tokens,
            correo,
            urlBase: URL_BASE,
            marca: { nombre: "Marca de Prueba" },
          }),
        ],
      ]),
      politica: POLITICA,
    });

  const enLaCola = async <T>(operar: (cola: ColaDeTrabajos) => Promise<T>): Promise<T> => {
    const r = await entorno.ejecutar(
      { contexto: comoTrabajos(), aislamiento: "read committed" },
      async ({ cola }) => ok(await operar(cola)),
    );
    if (!r.ok) throw new Error(`la cola falló: ${JSON.stringify(r.error)}`);
    return r.valor;
  };

  const idDelTrabajo = async (id: string): Promise<string> => {
    const { rows } = await dueno.query<{ id: string }>(
      "select id from trabajo where clave_idempotencia = $1",
      [claveDeEnvioDeInvitacion(id)],
    );
    return rows[0]!.id;
  };

  const trabajo = async (id: string) =>
    (
      await filas<{
        estado: string;
        intentos: number;
        ultimo_error: string | null;
        datos: unknown;
      }>(
        "select estado, intentos, ultimo_error, datos from trabajo where clave_idempotencia = $1",
        [claveDeEnvioDeInvitacion(id)],
      )
    )[0]!;

  const auditoria = (empresa: EmpresaId, accion: string) =>
    filas<{ actor_persona_id: string | null; entidad_id: string; despues: Fila | null }>(
      `select actor_persona_id, entidad_id, despues from auditoria_empresa
       where empresa_id = $1 and accion = $2 order by id`,
      [empresa, accion],
    );

  // ---- las pruebas ----------------------------------------------------------------------------

  it("invitar → despacho inmediato: sale un solo mail con la clave del envío y un enlace que sirve", async () => {
    const e = await escenario();
    const { id, email, token } = await invitar(e);
    const correo = crearCorreoFalso();

    // Lo que quedó encolado: solo el id de la invitación, nunca el token.
    expect((await trabajo(id)).datos).toEqual({ invitacionId: id });

    const ids = await enLaCola((c) => c.idsPorClaves(e.empresa, [claveDeEnvioDeInvitacion(id)]));
    expect(ids).toEqual([await idDelTrabajo(id)]);
    await armar(correo).despacharAhora(ids, T0);

    const enviados = correo.enviados();
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({
      claveDeIdempotencia: `invitacion:${id}:envio`,
      mensaje: { para: email },
    });
    expect(enviados[0]!.mensaje.texto).toContain(`${URL_BASE}/invitaciones/${token}`);
    expect(await trabajo(id)).toMatchObject({ estado: "HECHO", intentos: 1, ultimo_error: null });
    expect(await auditoria(e.empresa, "INVITACION_ENVIADA")).toEqual([
      { actor_persona_id: null, entidad_id: id, despues: { email, proveedor: "falso-1" } },
    ]);

    // El enlace del mail alcanza para aceptar la invitación.
    const enlace = /\/invitaciones\/(\S+)/.exec(enviados[0]!.mensaje.texto);
    const aceptada = await casos.aceptarInvitacion({
      token: enlace![1]!,
      emailAutenticado: email,
      ahora: T0,
    });
    expect(aceptada.ok).toBe(true);
  });

  it("el token, el enlace y el hash no aparecen en ninguna columna de trabajo, de auditoría ni del error", async () => {
    const e = await escenario();
    const exito = await invitar(e);
    const falla = await invitar(e);
    const correo = crearCorreoFalso();
    const procesador = armar(correo);

    await procesador.procesarUno(await idDelTrabajo(exito.id), T0);
    // El correo se rompe repitiendo el cuerpo del mensaje (con el enlace) en su excepción.
    const roto: Correo = {
      enviar: (mensaje) => {
        throw new Error(`no pude mandar: ${mensaje.texto}`);
      },
    };
    await armar(roto).procesarUno(await idDelTrabajo(falla.id), T0);
    expect((await trabajo(falla.id)).estado).toBe("PENDIENTE");

    const tabla = JSON.stringify([
      ...(await filas("select to_jsonb(t) as t from trabajo t")),
      ...(await filas("select to_jsonb(a) as a from auditoria_empresa a")),
    ]);
    for (const secreto of [exito.token, falla.token]) {
      expect(tabla).not.toContain(secreto);
      expect(tabla).not.toContain(tokens.hash(secreto));
    }
    expect(tabla).not.toContain("/invitaciones/");
    expect((await trabajo(falla.id)).ultimo_error).toMatch(/^Error: no pude mandar:/);
  });

  describe("idempotencia", () => {
    it("ejecutar dos veces el mismo trabajo deja un solo envío observable", async () => {
      const e = await escenario();
      const { id } = await invitar(e);
      const trabajoId = await idDelTrabajo(id);
      const correo = crearCorreoFalso();
      const procesador = armar(correo);

      // Un procesador que se muere justo después de enviar: toma el trabajo y lo ejecuta, sin cerrarlo.
      const manejador = crearManejadorDeEnviarInvitacion({
        transacciones: entorno,
        tokens,
        correo,
        urlBase: URL_BASE,
        marca: { nombre: "Marca de Prueba" },
      });
      const tomado = await enLaCola((c) => c.tomar(trabajoId, T0, T0));
      expect(await manejador(tomado!, T0)).toEqual({ tipo: "HECHO" });
      expect(await trabajo(id)).toMatchObject({ estado: "EN_CURSO", intentos: 1 });

      // Vencido el plazo, otro procesador lo retoma y lo ejecuta de nuevo.
      expect(await procesador.procesarUno(trabajoId, mas(1))).toBe("HECHO");
      expect(await trabajo(id)).toMatchObject({ estado: "HECHO", intentos: 2 });

      // Dos llamadas al proveedor con la misma clave y el mismo mensaje: un solo mail.
      const llamadas = correo.llamadas();
      expect(llamadas).toHaveLength(2);
      expect(llamadas[1]).toEqual(llamadas[0]);
      expect(llamadas[0]!.claveDeIdempotencia).toBe(`invitacion:${id}:envio`);
      expect(correo.enviados()).toHaveLength(1);
    });

    it("el intento inmediato y el cron sobre el mismo trabajo: un solo mail", async () => {
      const e = await escenario();
      const { id } = await invitar(e);
      const correo = crearCorreoFalso();
      const a = armar(correo);
      const b = armar(correo);
      await Promise.all([
        a.despacharAhora([await idDelTrabajo(id)], T0),
        b.procesarPendientes({ ahora: T0, limite: 20 }),
      ]);
      expect(correo.enviados()).toHaveLength(1);
      expect(await trabajo(id)).toMatchObject({ estado: "HECHO" });
    });
  });

  describe("el correo falla", () => {
    it("reprograma con espera creciente y, al agotar los intentos, queda FALLIDO sin perder la fila", async () => {
      const e = await escenario();
      const { id } = await invitar(e);
      const trabajoId = await idDelTrabajo(id);
      const correo = crearCorreoFalso();
      correo.fallarLasProximas(99, { definitivo: false, motivo: "el proveedor respondió 503" });
      const p = armar(correo);

      expect(await p.procesarUno(trabajoId, T0)).toBe("REPROGRAMADO");
      expect(await trabajo(id)).toMatchObject({
        estado: "PENDIENTE",
        intentos: 1,
        ultimo_error: "correo: el proveedor respondió 503",
      });
      expect(await p.procesarUno(trabajoId, mas(999))).toBe("NO_TOMADO");
      expect(await p.procesarUno(trabajoId, mas(1_000))).toBe("REPROGRAMADO");
      expect(await p.procesarUno(trabajoId, mas(3_000))).toBe("FALLIDO");

      expect(await trabajo(id)).toMatchObject({
        estado: "FALLIDO",
        intentos: 3,
        ultimo_error: "correo: el proveedor respondió 503",
      });
      expect(correo.enviados()).toEqual([]);
      expect(await auditoria(e.empresa, "INVITACION_ENVIADA")).toEqual([]);
      // La fila sigue ahí y el cron no la toca.
      await p.procesarPendientes({ ahora: mas(99 * DIA), limite: 50 });
      expect(await trabajo(id)).toMatchObject({ estado: "FALLIDO", intentos: 3 });
    });

    it("si se recupera a tiempo, sale un solo mail con la misma clave en todos los intentos", async () => {
      const e = await escenario();
      const { id } = await invitar(e);
      const trabajoId = await idDelTrabajo(id);
      const correo = crearCorreoFalso();
      correo.fallarLasProximas(2);
      const p = armar(correo);
      await p.procesarUno(trabajoId, T0);
      await p.procesarUno(trabajoId, mas(1_000));
      expect(await p.procesarUno(trabajoId, mas(3_000))).toBe("HECHO");
      expect(correo.enviados()).toHaveLength(1);
      expect(new Set(correo.llamadas().map((l) => l.claveDeIdempotencia))).toEqual(
        new Set([`invitacion:${id}:envio`]),
      );
      expect(await trabajo(id)).toMatchObject({ estado: "HECHO", intentos: 3, ultimo_error: null });
    });

    it("un rechazo definitivo (dirección inválida) deja FALLIDO en el primer intento", async () => {
      const e = await escenario();
      const { id } = await invitar(e);
      const correo = crearCorreoFalso();
      correo.fallarLasProximas(1, { definitivo: true, motivo: "el proveedor respondió 422" });
      expect(await armar(correo).procesarUno(await idDelTrabajo(id), T0)).toBe("FALLIDO");
      expect(await trabajo(id)).toMatchObject({ estado: "FALLIDO", intentos: 1 });
    });
  });

  describe("solo se envía si la invitación sigue pendiente y vigente", () => {
    const sinEnviar = async (
      e: Escenario,
      id: string,
      motivo: string,
      ahora: Date = T0,
      correo: CorreoFalso = crearCorreoFalso(),
    ) => {
      expect(await armar(correo).procesarUno(await idDelTrabajo(id), ahora)).toBe("HECHO");
      expect(correo.llamadas()).toEqual([]);
      expect(await trabajo(id)).toMatchObject({
        estado: "HECHO",
        intentos: 1,
        ultimo_error: `OMITIDO: ${motivo}`,
      });
      expect(await auditoria(e.empresa, "INVITACION_ENVIO_OMITIDO")).toContainEqual({
        actor_persona_id: null,
        entidad_id: id,
        despues: { motivo },
      });
      expect(await auditoria(e.empresa, "INVITACION_ENVIADA")).toEqual([]);
    };

    it("revocada: el trabajo termina HECHO sin enviar y deja registro", async () => {
      const e = await escenario();
      const i = await invitacionConTrabajo(e);
      await revocarDeBase(dueno, i.inv);
      await sinEnviar(e, i.id, "REVOCADA");
    });

    it("aceptada: no se manda un enlace que ya se usó", async () => {
      const e = await escenario();
      const i = await invitacionConTrabajo(e);
      const persona = await crearPersonaDeBase(dueno, i.email);
      await aceptarDeBase(dueno, i.inv, persona.id);
      await sinEnviar(e, i.id, "ACEPTADA");
    });

    it("vencida: no se manda un enlace que ya no sirve", async () => {
      const e = await escenario();
      const { id } = await invitar(e);
      await sinEnviar(e, id, "VENCIDA", mas(8 * DIA));
    });

    it("vencida justo en `venceEn`; un instante antes todavía se envía", async () => {
      const e = await escenario();
      const i = await invitacionConTrabajo(e, { venceEn: mas(5_000) });
      const correo = crearCorreoFalso();
      expect(await armar(correo).procesarUno(await idDelTrabajo(i.id), mas(4_999))).toBe("HECHO");
      expect(correo.enviados()).toHaveLength(1);
      const otra = await escenario();
      const j = await invitacionConTrabajo(otra, { venceEn: mas(5_000) });
      await sinEnviar(otra, j.id, "VENCIDA", mas(5_000));
    });

    it("reemplazada: reenviar anula el trabajo viejo; sale un solo mail, con el enlace nuevo", async () => {
      const e = await escenario();
      const vieja = await invitar(e);
      const reenvio = await casos.reenviarInvitacion(e.ctx, { invitacionId: vieja.id });
      if (!reenvio.ok) throw new Error("no se pudo reenviar");
      const nueva = reenvio.valor.invitacionId;
      expect(nueva).not.toBe(vieja.id);

      const correo = crearCorreoFalso();
      const p = armar(correo);
      await p.procesarPendientes({ ahora: T0, limite: 50 });

      expect(await trabajo(vieja.id)).toMatchObject({
        estado: "HECHO",
        ultimo_error: "OMITIDO: REEMPLAZADA",
      });
      expect(await trabajo(nueva)).toMatchObject({ estado: "HECHO", ultimo_error: null });
      expect(correo.enviados()).toHaveLength(1);
      const texto = correo.enviados()[0]!.mensaje.texto;
      expect(texto).toContain(tokens.derivar(nueva));
      expect(texto).not.toContain(vieja.token);
      expect(correo.enviados()[0]!.claveDeIdempotencia).toBe(`invitacion:${nueva}:envio`);
    });

    it("si la empresa se suspendió después de encolar, no se envía (y no se audita: la base no lo admite)", async () => {
      const e = await escenario();
      const { id } = await invitar(e);
      await dueno.query(
        "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
        [e.empresa],
      );
      const correo = crearCorreoFalso();
      expect(await armar(correo).procesarUno(await idDelTrabajo(id), T0)).toBe("HECHO");
      expect(correo.llamadas()).toEqual([]);
      expect(await trabajo(id)).toMatchObject({
        estado: "HECHO",
        ultimo_error: "OMITIDO: EMPRESA_NO_OPERA",
      });
      expect(await auditoria(e.empresa, "INVITACION_ENVIO_OMITIDO")).toEqual([]);
    });

    it("lo mismo si se suspendió el tenant", async () => {
      const e = await escenario();
      const { id } = await invitar(e);
      await dueno.query(
        "update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
        [e.tenant],
      );
      const correo = crearCorreoFalso();
      expect(await armar(correo).procesarUno(await idDelTrabajo(id), T0)).toBe("HECHO");
      expect(correo.llamadas()).toEqual([]);
      expect((await trabajo(id)).ultimo_error).toBe("OMITIDO: EMPRESA_NO_OPERA");
    });
  });

  describe("el alta del gerente (empresa en PROVISIONING)", () => {
    it("el mail sale aunque la empresa todavía no opere; la auditoría de la aplicación no lo admite", async () => {
      const empresa = await crearEmpresaEnAlta(entorno);
      const emitido = tokens.emitir();
      const email = emailAlAzar("gerente");
      const inv = await crearInvitacionDeBase(dueno, {
        tenant: empresa.tenant,
        id: emitido.invitacionId,
        tokenHash: emitido.tokenHash,
        tipo: "ALTA_GERENTE",
        email,
        emitidaEn: new Date("2026-10-11T00:00:00Z"),
        venceEn: new Date("2026-10-12T00:00:00Z"),
      });
      await incluirEmpresa(dueno, inv, empresa.empresa, "GERENTE");
      // El alta la encola la plataforma, para la empresa que todavía no opera.
      const r = await entorno.ejecutar({ contexto: comoPlataforma() }, async (tx) =>
        ok(
          await tx.trabajos.encolar({
            empresaId: empresa.empresa,
            tipo: TRABAJO_ENVIAR_INVITACION,
            datos: { invitacionId: emitido.invitacionId },
            claveDeIdempotencia: claveDeEnvioDeInvitacion(emitido.invitacionId),
          }),
        ),
      );
      expect(r).toEqual({ ok: true, valor: "ENCOLADO" });

      const correo = crearCorreoFalso();
      expect(await armar(correo).procesarUno(await idDelTrabajo(emitido.invitacionId), T0)).toBe(
        "HECHO",
      );
      expect(correo.enviados()).toHaveLength(1);
      expect(correo.enviados()[0]!.mensaje.texto).toContain(emitido.token);
      expect(await trabajo(emitido.invitacionId)).toMatchObject({
        estado: "HECHO",
        ultimo_error: null,
      });
      expect(await auditoria(empresa.empresa, "INVITACION_ENVIADA")).toEqual([]);
    });
  });

  describe("aislamiento por empresa", () => {
    it("un trabajo de otra empresa no se ejecuta con el contexto equivocado: no ve la invitación, falla y no envía", async () => {
      const a = await escenario();
      const b = await escenario();
      // El trabajo es de B pero apunta a una invitación de A.
      const deA = await invitacionConTrabajo(a, { empresaDelTrabajo: b.empresa });
      const correo = crearCorreoFalso();
      expect(await armar(correo).procesarUno(await trabajoDeB(b, deA.id), T0)).toBe("FALLIDO");
      expect(correo.llamadas()).toEqual([]);
      const fila = await filas<{ estado: string; ultimo_error: string }>(
        "select estado, ultimo_error from trabajo where empresa_id = $1 and clave_idempotencia = $2",
        [b.empresa, claveDeEnvioDeInvitacion(deA.id)],
      );
      expect(fila[0]).toEqual({
        estado: "FALLIDO",
        ultimo_error: "la invitación no existe para la empresa del trabajo",
      });
      expect(await auditoria(a.empresa, "INVITACION_ENVIADA")).toEqual([]);
      expect(await auditoria(b.empresa, "INVITACION_ENVIADA")).toEqual([]);
    });

    const trabajoDeB = async (b: Escenario, invitacion: string): Promise<string> =>
      (
        await filas<{ id: string }>(
          "select id from trabajo where empresa_id = $1 and clave_idempotencia = $2",
          [b.empresa, claveDeEnvioDeInvitacion(invitacion)],
        )
      )[0]!.id;

    it("la empresa del trabajo es la de su columna: un `datos.empresaId` ajeno no cambia el contexto", async () => {
      const a = await escenario();
      const b = await escenario();
      const deA = await invitacionConTrabajo(a, { empresaDelTrabajo: b.empresa });
      // Un trabajo de B cuyos datos, además, nombran a la empresa A: los datos no mandan.
      await dueno.query(
        "update trabajo set datos = datos || jsonb_build_object('empresaId', $3::text) where empresa_id = $1 and clave_idempotencia = $2",
        [b.empresa, claveDeEnvioDeInvitacion(deA.id), a.empresa],
      );
      const correo = crearCorreoFalso();
      expect(await armar(correo).procesarUno(await trabajoDeB(b, deA.id), T0)).toBe("FALLIDO");
      expect(correo.llamadas()).toEqual([]);
    });

    it("el mismo trabajo, con la empresa correcta, sí envía (el aislamiento no es una falla general)", async () => {
      const a = await escenario();
      const i = await invitacionConTrabajo(a);
      const correo = crearCorreoFalso();
      expect(await armar(correo).procesarUno(await idDelTrabajo(i.id), T0)).toBe("HECHO");
      expect(correo.enviados()).toHaveLength(1);
    });

    it("un trabajo de ámbito plataforma (sin empresa) no se puede ejecutar: falla sin enviar", async () => {
      const clave = nombreAlAzar("sin-empresa");
      const r = await entorno.ejecutar({ contexto: comoPlataforma() }, async (tx) =>
        ok(
          await tx.trabajos.encolar({
            empresaId: null,
            tipo: TRABAJO_ENVIAR_INVITACION,
            datos: { invitacionId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" },
            claveDeIdempotencia: clave,
          }),
        ),
      );
      expect(r).toEqual({ ok: true, valor: "ENCOLADO" });
      const { rows } = await dueno.query<{ id: string }>(
        "select id from trabajo where clave_idempotencia = $1 and empresa_id is null",
        [clave],
      );
      const correo = crearCorreoFalso();
      expect(await armar(correo).procesarUno(rows[0]!.id, T0)).toBe("FALLIDO");
      expect(correo.llamadas()).toEqual([]);
    });

    it("datos que no traen una invitación válida: FALLIDO de inmediato", async () => {
      const e = await escenario();
      const clave = nombreAlAzar("datos-malos");
      await entorno.ejecutar({ contexto: comoEmpresa(e.empresa) }, async (tx) =>
        ok(
          await tx.trabajos.encolar({
            empresaId: e.empresa,
            tipo: TRABAJO_ENVIAR_INVITACION,
            datos: { otraCosa: "x" },
            claveDeIdempotencia: clave,
          }),
        ),
      );
      const { rows } = await dueno.query<{ id: string }>(
        "select id from trabajo where clave_idempotencia = $1",
        [clave],
      );
      expect(await armar().procesarUno(rows[0]!.id, T0)).toBe("FALLIDO");
    });
  });
});
