import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  fichaDeInvitacion,
  invitar,
  reenviar,
  revocar,
  type DependenciasDeUsuariosWeb,
} from "./usuarios-web";

/**
 * Invitar, reenviar y revocar con casos de uso falsos: lo que llega al caso de uso es SOLO la lista blanca (sin la empresa ni quién actúa del pedido), un pedido sin la forma pedida no corre nada y
 * el resultado sale por el camino común. Con la base real (concurrencia, idempotencia, aislamiento y permisos) se prueba en `test/integracion/usuarios-web-invitar.test.ts`.
 */
const CONTEXTO = { empresaId: "empresa-de-la-sesion" } as unknown as ContextoOperativo;
const ID = "0b0b0b0b-1111-4222-8333-444444444444";
const S1 = "0b0b0b0b-1111-4222-8333-444444444441";
const registro: string[] = [];

function dependencias(
  respuestas: Partial<
    Record<"invitarUsuario" | "reenviarInvitacion" | "revocarInvitacion", unknown>
  >,
  llamadas: { que: string; entrada: unknown }[] = [],
): DependenciasDeUsuariosWeb {
  const llamar = (que: string) => (_contexto: unknown, entrada: unknown) => {
    llamadas.push({ que, entrada });
    return Promise.resolve((respuestas as Record<string, unknown>)[que]);
  };
  return {
    casosDeUso: () =>
      ({
        invitarUsuario: llamar("invitarUsuario"),
        reenviarInvitacion: llamar("reenviarInvitacion"),
        revocarInvitacion: llamar("revocarInvitacion"),
      }) as unknown as ReturnType<DependenciasDeUsuariosWeb["casosDeUso"]>,
    consultas: () =>
      ({
        listarInvitacionesPendientes: () =>
          Promise.resolve(
            ok([
              {
                invitacionId: ID,
                email: "julia@x.test",
                rol: "OPERADOR",
                sucursales: [S1],
                emitidaEn: "2026-11-22T10:00:00.000Z",
                venceEn: "2026-11-29T10:00:00.000Z",
                vencida: false,
                emitidaPor: "quien-invito",
                tokenHash: "no-tiene-que-salir",
              },
            ]),
          ),
      }) as unknown as ReturnType<DependenciasDeUsuariosWeb["consultas"]>,
    respuesta: { registrar: (x) => registro.push(x), azar: () => new Uint8Array(4) },
  };
}

describe("invitar", () => {
  it("al caso de uso llega solo email, rol y sucursales: lo demás del pedido se descarta", async () => {
    const llamadas: { que: string; entrada: unknown }[] = [];
    const d = dependencias(
      { invitarUsuario: ok({ invitacionId: ID, yaExistia: false }) },
      llamadas,
    );
    const r = await invitar(d, CONTEXTO, {
      email: "a@x.test",
      rol: "OPERADOR",
      sucursales: [S1],
      empresaId: "otra",
      personaId: "otra",
      emitidaPor: "otra",
    });
    expect(r).toEqual({ ok: true, dato: { invitacionId: ID, yaExistia: false } });
    expect(llamadas).toEqual([
      { que: "invitarUsuario", entrada: { email: "a@x.test", rol: "OPERADOR", sucursales: [S1] } },
    ]);
  });

  it("un pedido sin la forma pedida (rol Gerente, sin email) es el genérico y no corre nada", async () => {
    const llamadas: { que: string; entrada: unknown }[] = [];
    const d = dependencias({}, llamadas);
    for (const crudo of [{ email: "a@x.test", rol: "GERENTE" }, { rol: "OPERADOR" }, null]) {
      const r = await invitar(d, CONTEXTO, crudo);
      expect(r).toMatchObject({ ok: false, error: { codigo: "USUARIOS_NO_PERMITIDO" } });
    }
    expect(llamadas).toEqual([]);
  });

  it("yaExistia: true NO es un error", async () => {
    const d = dependencias({ invitarUsuario: ok({ invitacionId: ID, yaExistia: true }) });
    expect(await invitar(d, CONTEXTO, { email: "a@x.test", rol: "OPERADOR" })).toEqual({
      ok: true,
      dato: { invitacionId: ID, yaExistia: true },
    });
  });

  it("«ya es parte» y «ya había una» tienen su código; el email inválido es el de Clientes; lo demás, el genérico", async () => {
    const pedido = { email: "a@x.test", rol: "OPERADOR" };
    const salida = async (error: unknown) =>
      invitar(dependencias({ invitarUsuario: err(error) }), CONTEXTO, pedido);
    expect(await salida("YA_ES_MIEMBRO")).toMatchObject({
      error: { codigo: "USUARIOS_YA_ES_MIEMBRO" },
    });
    expect(await salida("INVITACION_VIGENTE_CON_OTRO_ROL")).toMatchObject({
      error: { codigo: "USUARIOS_YA_HABIA_INVITACION" },
    });
    expect(await salida("EMAIL_INVALIDO")).toMatchObject({
      error: { codigo: "CLIENTES_EMAIL_INVALIDO", campo: "email" },
    });
    for (const error of [
      "SIN_PERMISO",
      "ROL_NO_INVITABLE",
      "SUCURSAL_INACTIVA",
      { codigo: "EMPRESA_NO_OPERA", empresaId: "e", motivo: "SUSPENDIDA" },
      { codigo: "ROL_DISTINTO_AL_ANTERIOR", empresaId: "e" },
    ]) {
      expect(await salida(error)).toMatchObject({ error: { codigo: "USUARIOS_NO_PERMITIDO" } });
    }
  });

  it("una falla de la base sale con referencia y sin detalle", async () => {
    const d = dependencias({
      invitarUsuario: err({ tipo: "Inesperado", sqlstate: "42P01", mensaje: "relation secreta" }),
    });
    const r = await invitar(d, CONTEXTO, { email: "a@x.test", rol: "OPERADOR" });
    expect(r).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
    expect(JSON.stringify(r)).not.toMatch(/secreta|42P01/);
  });
});

describe("reenviar y revocar", () => {
  it("al caso de uso llega solo el id de la invitación", async () => {
    const llamadas: { que: string; entrada: unknown }[] = [];
    const d = dependencias(
      {
        reenviarInvitacion: ok({ invitacionId: ID, yaEstabaReenviada: false }),
        revocarInvitacion: ok({ yaEstabaRevocada: true }),
      },
      llamadas,
    );
    expect(await reenviar(d, CONTEXTO, { invitacionId: ID, empresaId: "otra" })).toEqual({
      ok: true,
      dato: { invitacionId: ID, yaEstabaReenviada: false },
    });
    expect(await revocar(d, CONTEXTO, { invitacionId: ID, rol: "GERENTE" })).toEqual({
      ok: true,
      dato: { yaEstabaRevocada: true },
    });
    expect(llamadas).toEqual([
      { que: "reenviarInvitacion", entrada: { invitacionId: ID } },
      { que: "revocarInvitacion", entrada: { invitacionId: ID } },
    ]);
  });

  it("un id que no es un identificador es el genérico y no corre nada", async () => {
    const llamadas: { que: string; entrada: unknown }[] = [];
    const d = dependencias({}, llamadas);
    expect(await reenviar(d, CONTEXTO, { invitacionId: "x" })).toMatchObject({ ok: false });
    expect(await revocar(d, CONTEXTO, {})).toMatchObject({ ok: false });
    expect(llamadas).toEqual([]);
  });

  it("revocar una ya aceptada o de otra empresa es el genérico, sin decir cuál", async () => {
    for (const error of [
      "INVITACION_ACEPTADA",
      "INVITACION_NO_ENCONTRADA",
      "REVOCACION_NO_PERMITIDA",
    ]) {
      const d = dependencias({ revocarInvitacion: err(error) });
      expect(await revocar(d, CONTEXTO, { invitacionId: ID })).toMatchObject({
        error: { codigo: "USUARIOS_NO_PERMITIDO" },
      });
    }
  });
});

describe("fichaDeInvitacion", () => {
  it("trae la invitación con sus sucursales y sin token, hash ni quién invitó", async () => {
    const r = await fichaDeInvitacion(dependencias({}), CONTEXTO, { invitacionId: ID });
    expect(r).toEqual({
      ok: true,
      dato: {
        invitacionId: ID,
        email: "julia@x.test",
        rol: "OPERADOR",
        venceEn: "2026-11-29T10:00:00.000Z",
        vencida: false,
        sucursales: [S1],
      },
    });
    expect(JSON.stringify(r)).not.toMatch(/token|hash|quien-invito|emitid/i);
  });

  it("una que no está entre las de la empresa es el genérico", async () => {
    const otra = "0b0b0b0b-1111-4222-8333-444444444499";
    expect(
      await fichaDeInvitacion(dependencias({}), CONTEXTO, { invitacionId: otra }),
    ).toMatchObject({
      ok: false,
      error: { codigo: "USUARIOS_NO_PERMITIDO" },
    });
  });
});
