import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  crearCasosDeUsoDeIdentidad,
  crearManejadorDeEnviarInvitacion,
} from "../../src/modulos/identidad/publico";
import type { CasosDeUsoDeAltas } from "../../src/plataforma/casos-de-uso/altas";
import {
  empresaId,
  invitacionId,
  marcaComercialId,
} from "../../src/primitivas/identificadores/marca";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import type { TrabajoTomado } from "../../src/puertos/cola-de-trabajos";
import type { Correo, MensajeDeCorreo } from "../../src/puertos/correo";
import type { Tokens } from "../../src/puertos/tokens";
import { usuarioDePrueba } from "../utilidades/usuarios";
import { ADMIN_DE_PRUEBA, EMAIL_DE_ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA } from "./admins-de-prueba";
import {
  altaNueva,
  comoAdminAhora,
  comoSoporteAhora,
  crearCasosDeAlta,
  crearEntornoDeAlta,
  crearMarcaLista,
  tokensDePrueba,
  type TxDeAltaDePrueba,
} from "./altas-apoyo";
import { crearBarrera, crearBaseAparte, crearEntornoDePrueba, cuitAlAzar } from "./entorno";
import { crearInvitacionDeBase, incluirEmpresa } from "./fixtures-identidad";
import { claveAlAzar } from "./plataforma-apoyo";

/**
 * Reenviar y revocar la invitación del alta del gerente (H5 P5, §B.5.4) contra Postgres real: la nueva
 * invitación y la que reemplaza, el otro email, lo que impide, quién puede hacerlo (también SOPORTE), el
 * mail que sale solo de la vigente, la atomicidad y las carreras (dos reenvíos, reenviar contra aceptar).
 * Base propia.
 */

const base = inject("baseDePruebas");

function exito<T>(r: Resultado<T, unknown>): T {
  if (!r.ok) throw new Error(`tenía que salir bien: ${JSON.stringify(r.error)}`);
  return r.valor;
}
const falla = <T>(r: Resultado<T, unknown>) => {
  if (r.ok) throw new Error("tenía que fallar");
  return r.error;
};

describe.skipIf(base === null)("reenviar y revocar la invitación del alta", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: TransaccionesDePostgres<TxDeAltaDePrueba>;
  let entornoGeneral: ReturnType<typeof crearEntornoDePrueba>;
  let tokens: Tokens;
  let casos: CasosDeUsoDeAltas;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoDeAlta(propia.base, 6);
    entornoGeneral = crearEntornoDePrueba(propia.base, 4);
    tokens = tokensDePrueba();
    casos = crearCasosDeAlta(entorno, tokens);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoGeneral.cerrar();
    await propia.destruir();
  });

  const una = <T extends Record<string, unknown>>(texto: string, parametros: unknown[] = []) =>
    dueno.query<T>(texto, parametros).then((r) => r.rows[0] as T);
  const todas = <T extends Record<string, unknown>>(texto: string, parametros: unknown[] = []) =>
    dueno.query<T>(texto, parametros).then((r) => r.rows);
  const cuenta = async (texto: string, parametros: unknown[] = []) =>
    Number(((await dueno.query(texto, parametros)).rows[0] as { n: string }).n);

  async function unaAlta(extra: Parameters<typeof altaNueva>[1] = {}) {
    const m = await crearMarcaLista(dueno);
    const entrada = altaNueva(m.marca, extra);
    const alta = exito(await casos.altaDeEmpresa(comoAdminAhora(), entrada));
    return { ...alta, marca: m, entrada, email: entrada.emailGerente.toLowerCase() };
  }
  const reenviar = (
    empresa: string,
    extra: { emailNuevo?: string; claveDeIdempotencia?: string } = {},
    contexto = comoAdminAhora(),
  ) =>
    casos.reenviarInvitacionDelAlta(contexto, {
      claveDeIdempotencia: claveAlAzar(),
      empresaId: empresa,
      ...extra,
    });
  const revocar = (
    empresa: string,
    extra: { claveDeIdempotencia?: string } = {},
    contexto = comoAdminAhora(),
  ) =>
    casos.revocarInvitacionDelAlta(contexto, {
      claveDeIdempotencia: claveAlAzar(),
      empresaId: empresa,
      ...extra,
    });
  const invitacion = (id: string) =>
    una<{
      estado: string;
      email: string;
      reemplazada_por: string | null;
      motivo_revocacion: string | null;
      emitida_por: string | null;
      vence_en: Date;
      emitida_en: Date;
    }>(
      "select estado, email, reemplazada_por, motivo_revocacion, emitida_por, vence_en, emitida_en from invitacion where id = $1",
      [id],
    );
  const pendientesDe = (empresa: string) =>
    cuenta(
      `select count(*)::int as n from invitacion i join invitacion_empresa ie on ie.invitacion_id = i.id
       where ie.empresa_id = $1 and i.tipo = 'ALTA_GERENTE' and i.estado = 'PENDIENTE'`,
      [empresa],
    );
  const constanciasDe = (accion: string, empresa: string) =>
    todas<{ actor: string; antes: Record<string, unknown>; despues: Record<string, unknown> }>(
      "select actor, antes, despues from auditoria_plataforma where accion = $1 and despues ->> 'empresaId' = $2 order by id",
      [accion, empresa],
    );
  const trabajosDe = (empresa: string) =>
    todas<{ datos: { invitacionId: string }; estado: string }>(
      "select datos, estado from trabajo where empresa_id = $1 and tipo = 'enviar_invitacion' order by id",
      [empresa],
    );

  describe("reenviar", () => {
    it("revoca la anterior (REENVIADA), crea otra con otro id y otro token por 24 horas, encola su mail y deja la constancia", async () => {
      const a = await unaAlta();
      const r = exito(await reenviar(a.empresaId));
      expect(r.yaEstabaReenviada).toBe(false);
      expect(r.invitacionId).not.toBe(a.invitacionId);
      expect(await invitacion(a.invitacionId)).toMatchObject({
        estado: "REVOCADA",
        motivo_revocacion: "REENVIADA",
        reemplazada_por: r.invitacionId,
      });
      const nueva = await invitacion(r.invitacionId);
      expect(nueva).toMatchObject({ estado: "PENDIENTE", email: a.email, emitida_por: null });
      expect(nueva.vence_en.getTime() - nueva.emitida_en.getTime()).toBe(24 * 3_600_000);
      expect(await pendientesDe(a.empresaId)).toBe(1);
      // El token de la nueva se deriva de SU id: el de la vieja no sirve.
      expect(
        await una(
          "select (select token_hash from invitacion where id = $1) <> (select token_hash from invitacion where id = $2) as distintos",
          [a.invitacionId, r.invitacionId],
        ),
      ).toEqual({ distintos: true });
      // Un trabajo de mail por invitación; el de la nueva es el que sale.
      expect((await trabajosDe(a.empresaId)).map((t) => t.datos.invitacionId)).toEqual([
        a.invitacionId,
        r.invitacionId,
      ]);
      expect(await constanciasDe("ALTA_INVITACION_REENVIADA", a.empresaId)).toEqual([
        {
          actor: ADMIN_DE_PRUEBA,
          antes: { invitacionId: a.invitacionId, estado: "PENDIENTE", email: a.email },
          despues: {
            empresaId: a.empresaId,
            invitacionId: r.invitacionId,
            estado: "PENDIENTE",
            email: a.email,
            venceEn: nueva.vence_en.toISOString(),
          },
        },
      ]);
      // La empresa sigue en alta.
      expect(
        (await una<{ estado: string }>("select estado from empresa where id = $1", [a.empresaId]))
          .estado,
      ).toBe("PROVISIONING");
    });

    it("a otro email (corrigiendo uno mal cargado): la nueva va a ese email, normalizado", async () => {
      const a = await unaAlta();
      const r = exito(await reenviar(a.empresaId, { emailNuevo: "  Correcto@Gerente.TEST " }));
      expect((await invitacion(r.invitacionId)).email).toBe("correcto@gerente.test");
      expect((await invitacion(a.invitacionId)).email).toBe(a.email);
    });

    it("el email de un administrador de plataforma no puede ser gerente, ni el nuevo ni (si ahora lo es) el que ya tenía", async () => {
      const a = await unaAlta();
      const antes = await cuenta("select count(*)::int as n from invitacion");
      expect(
        falla(await reenviar(a.empresaId, { emailNuevo: EMAIL_DE_ADMIN_DE_PRUEBA.toUpperCase() })),
      ).toBe("EMAIL_DE_ADMIN_PLATAFORMA");
      // El email original pasa a ser el de un administrador: reenviar sin cambiarlo tampoco.
      await dueno.query(
        "insert into admin_plataforma (id, email, rol) values (gen_random_uuid(), $1, 'SOPORTE')",
        [a.email],
      );
      expect(falla(await reenviar(a.empresaId))).toBe("EMAIL_DE_ADMIN_PLATAFORMA");
      expect(await cuenta("select count(*)::int as n from invitacion")).toBe(antes);
      expect(await pendientesDe(a.empresaId)).toBe(1);
    });

    it("un email nuevo inválido es EMAIL_INVALIDO, un id malo ID_INVALIDO y una empresa inexistente EMPRESA_NO_ENCONTRADA", async () => {
      const a = await unaAlta();
      expect(falla(await reenviar(a.empresaId, { emailNuevo: "sin-arroba" }))).toBe(
        "EMAIL_INVALIDO",
      );
      expect(falla(await reenviar("no-es-uuid"))).toBe("ID_INVALIDO");
      expect(falla(await reenviar("0a1b2c3d-0000-4000-8000-0000000000ee"))).toBe(
        "EMPRESA_NO_ENCONTRADA",
      );
    });

    it("una empresa que ya no está en alta (activa o cancelada) es ALTA_NO_PENDIENTE y no cambia nada", async () => {
      const activa = await unaAlta();
      await dueno.query("update empresa set estado = 'ACTIVE' where id = $1", [activa.empresaId]);
      const cancelada = await unaAlta();
      await dueno.query(
        "update empresa set estado = 'CANCELLED', motivo_estado = 'antes' where id = $1",
        [cancelada.empresaId],
      );
      for (const a of [activa, cancelada]) {
        const antes = await cuenta("select count(*)::int as n from invitacion");
        expect(falla(await reenviar(a.empresaId))).toBe("ALTA_NO_PENDIENTE");
        expect(await cuenta("select count(*)::int as n from invitacion")).toBe(antes);
      }
    });

    it("una invitación vencida (todavía guardada como pendiente) se reenvía; una revocada sin reemplazo, también", async () => {
      // Vencida: empresa en alta con una invitación de fechas pasadas.
      const m = await crearMarcaLista(dueno);
      const mundo = (
        await dueno.query<{ id: string }>(
          "insert into tenant (nombre, marca_id) values ('t-venc', $1) returning id",
          [m.marca],
        )
      ).rows[0]?.id as string;
      const empresa = (
        await dueno.query<{ id: string }>(
          "insert into empresa (tenant_id, cuit, razon_social) values ($1, $2, 'Vencida S.A.') returning id",
          [mundo, cuitAlAzar()],
        )
      ).rows[0]?.id as string;
      const inv = await crearInvitacionDeBase(dueno, {
        tenant: mundo,
        tipo: "ALTA_GERENTE",
        emitidaEn: new Date("2026-10-01T10:00:00Z"),
        venceEn: new Date("2026-10-02T10:00:00Z"),
      });
      await incluirEmpresa(dueno, inv, empresa, "GERENTE");
      const r = exito(await reenviar(empresa));
      expect((await invitacion(inv.id)).estado).toBe("REVOCADA");
      expect((await invitacion(r.invitacionId)).estado).toBe("PENDIENTE");

      // Revocada sin reenviar: es la salida.
      const a = await unaAlta();
      exito(await revocar(a.empresaId));
      const otra = exito(await reenviar(a.empresaId));
      expect(otra.invitacionId).not.toBe(a.invitacionId);
      expect((await invitacion(a.invitacionId)).reemplazada_por).toBe(otra.invitacionId);
      expect(await pendientesDe(a.empresaId)).toBe(1);
    });

    it("la misma clave devuelve la misma invitación (yaEstabaReenviada) sin mandar otro mail; otra clave reenvía de nuevo", async () => {
      const a = await unaAlta();
      const clave = claveAlAzar();
      const primera = exito(await reenviar(a.empresaId, { claveDeIdempotencia: clave }));
      const trabajos = (await trabajosDe(a.empresaId)).length;
      const segunda = exito(await reenviar(a.empresaId, { claveDeIdempotencia: clave }));
      expect(segunda).toEqual({ ...primera, yaEstabaReenviada: true });
      expect((await trabajosDe(a.empresaId)).length).toBe(trabajos);
      expect(await constanciasDe("ALTA_INVITACION_REENVIADA", a.empresaId)).toHaveLength(1);
      // Otra clave es otro pedido: reemplaza a la vigente (una sola pendiente a la vez).
      const tercera = exito(await reenviar(a.empresaId));
      expect(tercera.invitacionId).not.toBe(primera.invitacionId);
      expect(await pendientesDe(a.empresaId)).toBe(1);
      expect((await invitacion(primera.invitacionId)).reemplazada_por).toBe(tercera.invitacionId);
    });

    it("la misma clave con otro email o con otra empresa es CLAVE_REUTILIZADA", async () => {
      const a = await unaAlta();
      const b = await unaAlta();
      const clave = claveAlAzar();
      exito(await reenviar(a.empresaId, { claveDeIdempotencia: clave }));
      expect(
        falla(
          await reenviar(a.empresaId, { claveDeIdempotencia: clave, emailNuevo: "otro@x.test" }),
        ),
      ).toBe("CLAVE_REUTILIZADA");
      expect(falla(await reenviar(b.empresaId, { claveDeIdempotencia: clave }))).toBe(
        "CLAVE_REUTILIZADA",
      );
    });

    it("SOPORTE también puede: destraba al cliente sin mail, y la constancia lleva a SOPORTE como actor", async () => {
      const a = await unaAlta();
      const r = exito(await reenviar(a.empresaId, {}, comoSoporteAhora()));
      expect(r.yaEstabaReenviada).toBe(false);
      expect(
        (await constanciasDe("ALTA_INVITACION_REENVIADA", a.empresaId)).map((c) => c.actor),
      ).toEqual([SOPORTE_DE_PRUEBA]);
    });

    it("el sistema, un administrador dado de baja y uno inexistente reciben SIN_PERMISO", async () => {
      const a = await unaAlta();
      const antes = await cuenta("select count(*)::int as n from invitacion");
      const sistema = { ...comoAdminAhora(), actor: { tipo: "SISTEMA", proceso: "x" } } as const;
      expect(falla(await reenviar(a.empresaId, {}, sistema))).toBe("SIN_PERMISO");
      expect(falla(await revocar(a.empresaId, {}, sistema))).toBe("SIN_PERMISO");
      expect(await cuenta("select count(*)::int as n from invitacion")).toBe(antes);
    });

    it("el mail sale solo de la invitación vigente: el trabajo de la reemplazada termina omitido", async () => {
      const a = await unaAlta();
      const r = exito(await reenviar(a.empresaId, { emailNuevo: "nuevo@gerente.test" }));
      const enviados: MensajeDeCorreo[] = [];
      const correo: Correo = {
        enviar: (mensaje) => {
          enviados.push(mensaje);
          return Promise.resolve({ tipo: "ENVIADO", idDelProveedor: "p-1" });
        },
      };
      const manejador = crearManejadorDeEnviarInvitacion({
        transacciones: entornoGeneral,
        tokens,
        correo,
        urlBase: "https://app.ejemplo.test",
        marca: { nombre: "ZuluHub" },
      });
      const trabajo = (invitacion: string): TrabajoTomado => ({
        id: "t",
        empresaId: empresaId(a.empresaId),
        tipo: "enviar_invitacion",
        datos: { invitacionId: invitacion },
        intentos: 1,
      });
      const vieja = await manejador(trabajo(a.invitacionId), new Date());
      expect(vieja.tipo === "HECHO" ? vieja.nota : null).toContain("OMITIDO");
      expect(enviados).toEqual([]);
      const nueva = await manejador(trabajo(r.invitacionId), new Date());
      expect(nueva).toEqual({ tipo: "HECHO" });
      expect(enviados.map((m) => m.para)).toEqual(["nuevo@gerente.test"]);
    });

    it("con la nueva invitación el gerente puede aceptar; con la vieja, no", async () => {
      const a = await unaAlta();
      const r = exito(await reenviar(a.empresaId));
      const identidad = crearCasosDeUsoDeIdentidad({
        transacciones: entornoGeneral,
        tokens,
        reglas: REGLAS_DE_EMPRESA,
      });
      const aceptar = (id: string) =>
        identidad.aceptarInvitacion({
          token: tokens.derivar(invitacionId(id)),
          emailAutenticado: a.email,
          usuarioAuth: usuarioDePrueba(a.email),
          marcaDeEntrada: marcaComercialId(a.marca.marca),
          ahora: new Date(),
        });
      expect(falla(await aceptar(a.invitacionId))).toBe("INVITACION_REVOCADA");
      exito(await aceptar(r.invitacionId));
      expect(
        (await una<{ estado: string }>("select estado from empresa where id = $1", [a.empresaId]))
          .estado,
      ).toBe("ACTIVE");
    });
  });

  describe("revocar sin reenviar", () => {
    it("revoca (REVOCADA_POR_PLATAFORMA), deja la constancia y la empresa sigue en alta; el gerente ya no puede aceptar", async () => {
      const a = await unaAlta();
      const r = exito(await revocar(a.empresaId));
      expect(r).toEqual({
        empresaId: a.empresaId,
        invitacionId: a.invitacionId,
        yaEstabaRevocada: false,
      });
      expect(await invitacion(a.invitacionId)).toMatchObject({
        estado: "REVOCADA",
        motivo_revocacion: "REVOCADA_POR_PLATAFORMA",
        reemplazada_por: null,
      });
      expect(await constanciasDe("ALTA_INVITACION_REVOCADA", a.empresaId)).toEqual([
        {
          actor: ADMIN_DE_PRUEBA,
          antes: { estado: "PENDIENTE", email: a.email },
          despues: {
            empresaId: a.empresaId,
            estado: "REVOCADA",
            motivo: "REVOCADA_POR_PLATAFORMA",
          },
        },
      ]);
      expect(
        (await una<{ estado: string }>("select estado from empresa where id = $1", [a.empresaId]))
          .estado,
      ).toBe("PROVISIONING");
      const identidad = crearCasosDeUsoDeIdentidad({
        transacciones: entornoGeneral,
        tokens,
        reglas: REGLAS_DE_EMPRESA,
      });
      const aceptada = await identidad.aceptarInvitacion({
        token: tokens.derivar(invitacionId(a.invitacionId)),
        emailAutenticado: a.email,
        usuarioAuth: usuarioDePrueba(a.email),
        marcaDeEntrada: marcaComercialId(a.marca.marca),
        ahora: new Date(),
      });
      expect(falla(aceptada)).toBe("INVITACION_REVOCADA");
    });

    it("revocar lo ya revocado no es un error: devuelve lo mismo (yaEstabaRevocada) sin escribir ni auditar", async () => {
      const a = await unaAlta();
      exito(await revocar(a.empresaId));
      const otra = exito(await revocar(a.empresaId));
      expect(otra).toEqual({
        empresaId: a.empresaId,
        invitacionId: a.invitacionId,
        yaEstabaRevocada: true,
      });
      expect(await constanciasDe("ALTA_INVITACION_REVOCADA", a.empresaId)).toHaveLength(1);
    });

    it("la misma clave devuelve lo mismo; con otra empresa es CLAVE_REUTILIZADA", async () => {
      const a = await unaAlta();
      const b = await unaAlta();
      const clave = claveAlAzar();
      const primera = exito(await revocar(a.empresaId, { claveDeIdempotencia: clave }));
      expect(exito(await revocar(a.empresaId, { claveDeIdempotencia: clave }))).toEqual({
        ...primera,
        yaEstabaRevocada: true,
      });
      expect(falla(await revocar(b.empresaId, { claveDeIdempotencia: clave }))).toBe(
        "CLAVE_REUTILIZADA",
      );
    });

    it("una empresa activa o cancelada es ALTA_NO_PENDIENTE; sin invitación del alta, ALTA_SIN_INVITACION; empresa o id inválidos", async () => {
      const activa = await unaAlta();
      await dueno.query("update empresa set estado = 'ACTIVE' where id = $1", [activa.empresaId]);
      expect(falla(await revocar(activa.empresaId))).toBe("ALTA_NO_PENDIENTE");

      const m = await crearMarcaLista(dueno);
      const tenant = (
        await dueno.query<{ id: string }>(
          "insert into tenant (nombre, marca_id) values ('t-sin', $1) returning id",
          [m.marca],
        )
      ).rows[0]?.id as string;
      const sinInvitacion = (
        await dueno.query<{ id: string }>(
          "insert into empresa (tenant_id, cuit, razon_social) values ($1, $2, 'Sin invitación S.A.') returning id",
          [tenant, cuitAlAzar()],
        )
      ).rows[0]?.id as string;
      expect(falla(await revocar(sinInvitacion))).toBe("ALTA_SIN_INVITACION");
      expect(falla(await reenviar(sinInvitacion))).toBe("ALTA_SIN_INVITACION");

      expect(falla(await revocar("0a1b2c3d-0000-4000-8000-0000000000ee"))).toBe(
        "EMPRESA_NO_ENCONTRADA",
      );
      expect(falla(await revocar("x"))).toBe("ID_INVALIDO");
    });

    it("SOPORTE también puede revocar", async () => {
      const a = await unaAlta();
      exito(await revocar(a.empresaId, {}, comoSoporteAhora()));
      expect((await invitacion(a.invitacionId)).estado).toBe("REVOCADA");
    });
  });

  describe("todo o nada", () => {
    const pasos = [
      "revocar la anterior",
      "crear la nueva",
      "vincular el reemplazo",
      "encolar el mail",
      "dejar la constancia",
      "registrar la clave",
    ] as const;
    type Paso = (typeof pasos)[number];

    function entornoRotoDespuesDe(paso: Paso) {
      const despues = async <T>(valor: Promise<T>): Promise<T> => {
        await valor;
        throw new Error(`falla inyectada después de ${paso}`);
      };
      return crearEntornoDeAlta(propia.base, 3, (tx) => {
        switch (paso) {
          case "revocar la anterior":
            return {
              ...tx,
              invitaciones: {
                ...tx.invitaciones,
                revocar: (...a) => despues(tx.invitaciones.revocar(...a)),
              },
            };
          case "crear la nueva":
            return {
              ...tx,
              invitaciones: {
                ...tx.invitaciones,
                crear: (...a) => despues(tx.invitaciones.crear(...a)),
              },
            };
          case "vincular el reemplazo":
            return {
              ...tx,
              invitaciones: {
                ...tx.invitaciones,
                vincularReemplazo: (...a) => despues(tx.invitaciones.vincularReemplazo(...a)),
              },
            };
          case "encolar el mail":
            return {
              ...tx,
              trabajos: { ...tx.trabajos, encolar: (...a) => despues(tx.trabajos.encolar(...a)) },
            };
          case "dejar la constancia":
            return {
              ...tx,
              auditoriaDePlataforma: {
                registrar: (...a) => despues(tx.auditoriaDePlataforma.registrar(...a)),
              },
            };
          case "registrar la clave":
            return {
              ...tx,
              idempotencia: {
                ...tx.idempotencia,
                registrar: (...a) => despues(tx.idempotencia.registrar(...a)),
              },
            };
        }
      });
    }

    it.each(pasos)(
      "reenviar: falla después de «%s» y la anterior sigue pendiente, sin invitación nueva ni mail",
      async (paso) => {
        const a = await unaAlta();
        const antes = {
          invitaciones: await cuenta("select count(*)::int as n from invitacion"),
          trabajos: await cuenta("select count(*)::int as n from trabajo"),
          constancias: await cuenta("select count(*)::int as n from auditoria_plataforma"),
          claves: await cuenta("select count(*)::int as n from idempotencia_plataforma"),
        };
        const roto = entornoRotoDespuesDe(paso);
        try {
          await expect(
            crearCasosDeAlta(roto).reenviarInvitacionDelAlta(comoAdminAhora(), {
              claveDeIdempotencia: claveAlAzar(),
              empresaId: a.empresaId,
            }),
          ).rejects.toThrow("falla inyectada");
        } finally {
          await roto.cerrar();
        }
        expect((await invitacion(a.invitacionId)).estado).toBe("PENDIENTE");
        expect((await invitacion(a.invitacionId)).reemplazada_por).toBeNull();
        expect({
          invitaciones: await cuenta("select count(*)::int as n from invitacion"),
          trabajos: await cuenta("select count(*)::int as n from trabajo"),
          constancias: await cuenta("select count(*)::int as n from auditoria_plataforma"),
          claves: await cuenta("select count(*)::int as n from idempotencia_plataforma"),
        }).toEqual(antes);
        expect(await pendientesDe(a.empresaId)).toBe(1);
      },
    );

    it("revocar: si falla la constancia, la invitación sigue pendiente", async () => {
      const a = await unaAlta();
      const roto = entornoRotoDespuesDe("dejar la constancia");
      try {
        await expect(
          crearCasosDeAlta(roto).revocarInvitacionDelAlta(comoAdminAhora(), {
            claveDeIdempotencia: claveAlAzar(),
            empresaId: a.empresaId,
          }),
        ).rejects.toThrow("falla inyectada");
      } finally {
        await roto.cerrar();
      }
      expect((await invitacion(a.invitacionId)).estado).toBe("PENDIENTE");
    });
  });

  describe("carreras", () => {
    const VUELTAS = 8;

    function conBarrera(participantes: number) {
      const cita = crearBarrera(participantes);
      const e = crearEntornoDeAlta(propia.base, participantes + 2, (tx) => ({
        ...tx,
        invitaciones: {
          ...tx.invitaciones,
          obtenerAltaVigente: async (...a) => {
            const r = await tx.invitaciones.obtenerAltaVigente(...a);
            await cita();
            return r;
          },
        },
      }));
      return { entorno: e, casos: crearCasosDeAlta(e, tokens), cita };
    }

    it("dos reenvíos a la vez (claves distintas): termina UNA sola invitación pendiente, y las demás quedan revocadas y encadenadas", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { entorno: e, casos: c } = conBarrera(2);
        try {
          const a = await unaAlta();
          const rs = await Promise.all([
            c.reenviarInvitacionDelAlta(comoAdminAhora(), {
              claveDeIdempotencia: claveAlAzar(),
              empresaId: a.empresaId,
            }),
            c.reenviarInvitacionDelAlta(comoAdminAhora(), {
              claveDeIdempotencia: claveAlAzar(),
              empresaId: a.empresaId,
            }),
          ]);
          expect(
            rs.every((r) => r.ok),
            `vuelta ${vuelta}: ${JSON.stringify(rs)}`,
          ).toBe(true);
          expect(await pendientesDe(a.empresaId)).toBe(1);
          // Original + dos reenvíos: tres invitaciones, dos revocadas, cada una apunta a la siguiente.
          expect(
            await cuenta(
              `select count(*)::int as n from invitacion i join invitacion_empresa ie on ie.invitacion_id = i.id
               where ie.empresa_id = $1`,
              [a.empresaId],
            ),
          ).toBe(3);
          expect(
            await cuenta(
              `select count(*)::int as n from invitacion i join invitacion_empresa ie on ie.invitacion_id = i.id
               where ie.empresa_id = $1 and i.estado = 'REVOCADA' and i.reemplazada_por is not null`,
              [a.empresaId],
            ),
          ).toBe(2);
        } finally {
          await e.cerrar();
        }
      }
    });

    it("el mismo reenvío a la vez (misma clave): una sola invitación nueva", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { entorno: e, casos: c } = conBarrera(3);
        try {
          const a = await unaAlta();
          const clave = claveAlAzar();
          const rs = await Promise.all(
            [1, 2, 3].map(() =>
              c.reenviarInvitacionDelAlta(comoAdminAhora(), {
                claveDeIdempotencia: clave,
                empresaId: a.empresaId,
              }),
            ),
          );
          const vs = rs.map(exito);
          expect(new Set(vs.map((v) => v.invitacionId)).size, `vuelta ${vuelta}`).toBe(1);
          expect(vs.filter((v) => !v.yaEstabaReenviada)).toHaveLength(1);
          expect(await pendientesDe(a.empresaId)).toBe(1);
          expect(
            await cuenta(
              `select count(*)::int as n from invitacion i join invitacion_empresa ie on ie.invitacion_id = i.id
               where ie.empresa_id = $1`,
              [a.empresaId],
            ),
          ).toBe(2);
          expect(await constanciasDe("ALTA_INVITACION_REENVIADA", a.empresaId)).toHaveLength(1);
        } finally {
          await e.cerrar();
        }
      }
    });

    it("reenviar contra aceptar: gana uno solo; si gana el reenvío, la invitación vieja ya no sirve y la nueva sí", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const a = await unaAlta();
        const cita = crearBarrera(2);
        const entornoReenvia = crearEntornoDeAlta(propia.base, 4, (tx) => ({
          ...tx,
          invitaciones: {
            ...tx.invitaciones,
            obtenerAltaVigente: async (...args) => {
              const r = await tx.invitaciones.obtenerAltaVigente(...args);
              await cita();
              return r;
            },
          },
        }));
        const entornoAcepta = crearEntornoDePrueba(propia.base, 4, (tx) => ({
          ...tx,
          invitaciones: {
            ...tx.invitaciones,
            obtenerPorHash: async (...args) => {
              const r = await tx.invitaciones.obtenerPorHash(...args);
              await cita();
              return r;
            },
          },
        }));
        try {
          const identidad = crearCasosDeUsoDeIdentidad({
            transacciones: entornoAcepta,
            tokens,
            reglas: REGLAS_DE_EMPRESA,
          });
          const [aceptada, reenviada] = await Promise.all([
            identidad.aceptarInvitacion({
              token: tokens.derivar(invitacionId(a.invitacionId)),
              emailAutenticado: a.email,
              usuarioAuth: usuarioDePrueba(a.email),
              marcaDeEntrada: marcaComercialId(a.marca.marca),
              ahora: new Date(),
            }),
            crearCasosDeAlta(entornoReenvia, tokens).reenviarInvitacionDelAlta(comoAdminAhora(), {
              claveDeIdempotencia: claveAlAzar(),
              empresaId: a.empresaId,
            }),
          ]);
          const estado = (
            await una<{ estado: string }>("select estado from empresa where id = $1", [a.empresaId])
          ).estado;
          expect((aceptada.ok ? 1 : 0) + (reenviada.ok ? 1 : 0), `vuelta ${vuelta}`).toBe(1);
          if (aceptada.ok) {
            expect(estado).toBe("ACTIVE");
            expect(falla(reenviada)).toBe("ALTA_NO_PENDIENTE");
          } else {
            expect(estado).toBe("PROVISIONING");
            expect(falla(aceptada)).toBe("INVITACION_REVOCADA");
            expect(await pendientesDe(a.empresaId)).toBe(1);
          }
        } finally {
          await entornoReenvia.cerrar();
          await entornoAcepta.cerrar();
        }
      }
    });
  });
});
