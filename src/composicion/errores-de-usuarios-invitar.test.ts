import { describe, expect, it } from "vitest";
import type { CodigoDeUsuarios } from "../capacidades/experiencia/respuesta-de-usuarios";
import type { CasosDeUsoDeIdentidad } from "../modulos/identidad/publico";
import { traducirErrorDeUsuarios } from "./errores-de-usuarios";

/** El error de la acción: lo que devuelve la rama `ok: false` del caso de uso. */
type ErrorDe<F extends (...a: never[]) => Promise<unknown>> = Extract<
  Awaited<ReturnType<F>>,
  { ok: false }
>["error"];
/** Solo los errores de negocio con forma de texto: el tipo exige que no falte ninguno (sumar un error al caso de uso no compila hasta decir qué sale). */
type TextosDe<E> = Extract<E, string>;

const GENERICO = { codigo: "USUARIOS_NO_PERMITIDO" } as const;
const CON_TEXTO = (codigo: CodigoDeUsuarios) => ({ codigo });

/** Qué sale de cada error de invitar: el genérico, salvo los tres con texto propio. */
const AL_INVITAR: Readonly<
  Record<TextosDe<ErrorDe<CasosDeUsoDeIdentidad["invitarUsuario"]>>, unknown>
> = {
  YA_ES_MIEMBRO: CON_TEXTO("USUARIOS_YA_ES_MIEMBRO"),
  INVITACION_VIGENTE_CON_OTRO_ROL: CON_TEXTO("USUARIOS_YA_HABIA_INVITACION"),
  EMAIL_INVALIDO: { codigo: "CLIENTES_EMAIL_INVALIDO", campo: "email" },
  INVITACION_NO_ENCONTRADA: GENERICO,
  INVITACION_REVOCADA: GENERICO,
  INVITACION_NO_PENDIENTE: GENERICO,
  ROL_NO_INVITABLE: GENERICO,
  INVITACION_SIN_EMPRESAS: GENERICO,
  EMPRESA_REPETIDA: GENERICO,
  ALTA_INVALIDA: GENERICO,
  REENVIO_NO_PERMITIDO: GENERICO,
  ALTA_YA_TIENE_INVITACION: GENERICO,
  SUCURSAL_INACTIVA: GENERICO,
  SUCURSAL_NO_ES_DE_LA_EMPRESA: GENERICO,
  MODULO_EN_DESARROLLO: GENERICO,
  MODULO_NO_ACTIVO: GENERICO,
  MODULO_EN_SOLO_LECTURA: GENERICO,
  SIN_CAPACIDAD: GENERICO,
  SIN_PERMISO: GENERICO,
};

const AL_REENVIAR: Readonly<
  Record<TextosDe<ErrorDe<CasosDeUsoDeIdentidad["reenviarInvitacion"]>>, unknown>
> = {
  INVITACION_NO_ENCONTRADA: GENERICO,
  INVITACION_REVOCADA: GENERICO,
  INVITACION_NO_PENDIENTE: GENERICO,
  EMAIL_INVALIDO: { codigo: "CLIENTES_EMAIL_INVALIDO", campo: "email" },
  ROL_NO_INVITABLE: GENERICO,
  INVITACION_SIN_EMPRESAS: GENERICO,
  EMPRESA_REPETIDA: GENERICO,
  ALTA_INVALIDA: GENERICO,
  REENVIO_NO_PERMITIDO: GENERICO,
  ALTA_YA_TIENE_INVITACION: GENERICO,
  YA_ES_MIEMBRO: CON_TEXTO("USUARIOS_YA_ES_MIEMBRO"),
  INVITACION_VIGENTE_CON_OTRO_ROL: CON_TEXTO("USUARIOS_YA_HABIA_INVITACION"),
  MODULO_EN_DESARROLLO: GENERICO,
  MODULO_NO_ACTIVO: GENERICO,
  MODULO_EN_SOLO_LECTURA: GENERICO,
  SIN_CAPACIDAD: GENERICO,
  SIN_PERMISO: GENERICO,
};

const AL_REVOCAR: Readonly<
  Record<TextosDe<ErrorDe<CasosDeUsoDeIdentidad["revocarInvitacion"]>>, unknown>
> = {
  INVITACION_NO_ENCONTRADA: GENERICO,
  INVITACION_ACEPTADA: GENERICO,
  REVOCACION_NO_PERMITIDA: GENERICO,
  MODULO_EN_DESARROLLO: GENERICO,
  MODULO_NO_ACTIVO: GENERICO,
  MODULO_EN_SOLO_LECTURA: GENERICO,
  SIN_CAPACIDAD: GENERICO,
  SIN_PERMISO: GENERICO,
};

describe("traducirErrorDeUsuarios: invitar, reenviar y revocar", () => {
  it.each([
    ["invitar", AL_INVITAR],
    ["reenviar", AL_REENVIAR],
    ["revocar", AL_REVOCAR],
  ] as const)("todo error de %s tiene su código público", (_caso, tabla) => {
    for (const [error, esperado] of Object.entries(tabla)) {
      expect(traducirErrorDeUsuarios(error), error).toEqual(esperado);
    }
  });

  it("los únicos errores con texto propio son «ya es parte», «ya había una» y «el email no es válido»", () => {
    const propios = Object.entries(AL_INVITAR)
      .filter(([, v]) => v !== GENERICO)
      .map(([k]) => k)
      .sort();
    expect(propios).toEqual(["EMAIL_INVALIDO", "INVITACION_VIGENTE_CON_OTRO_ROL", "YA_ES_MIEMBRO"]);
  });

  it("un error de negocio con forma de objeto (la empresa no opera, el rol distinto al anterior) es el genérico y no deja pasar su detalle", () => {
    for (const error of [
      { codigo: "EMPRESA_NO_OPERA", empresaId: "e-1", motivo: "SUSPENDIDA" },
      { codigo: "ROL_DISTINTO_AL_ANTERIOR", empresaId: "e-1" },
    ]) {
      expect(traducirErrorDeUsuarios(error)).toEqual(GENERICO);
    }
  });

  it("un error de la base (tiene `tipo`, no `codigo`) pasa sin cambios, aunque traiga un texto con forma de código", () => {
    const error = { tipo: "Inesperado", codigo: "42P01", mensaje: "relation x does not exist" };
    expect(traducirErrorDeUsuarios(error)).toBe(error);
    const otro = { tipo: "Unicidad", restriccion: "uq_secreta" };
    expect(traducirErrorDeUsuarios(otro)).toBe(otro);
  });
});
