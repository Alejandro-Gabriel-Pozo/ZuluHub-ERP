import { describe, expect, it } from "vitest";
import { CODIGOS_PUBLICOS, errorDeCodigo } from "../capacidades/experiencia/respuesta";
import type { MotivoDeRechazo } from "../capacidades/permisos/guard";
import { err, ok } from "../primitivas/resultado/resultado";
import { entradaDeFichaDeUsuario } from "./entradas-de-usuarios";
import {
  accionDeUsuarios,
  lecturaDeUsuarios,
  traducirErrorDeUsuarios,
} from "./errores-de-usuarios";

const GENERICO = { codigo: "USUARIOS_NO_PERMITIDO" };
const ID = "0b0b0b0b-1111-4222-8333-444444444444";
const registro: string[] = [];
const respuesta = { registrar: (x: string) => registro.push(x), azar: () => new Uint8Array(4) };

/** Todos los motivos del guard: el tipo exige que no falte ninguno (sumar un motivo no compila hasta sumarlo acá). */
const MOTIVOS: Readonly<Record<MotivoDeRechazo, true>> = {
  MODULO_EN_DESARROLLO: true,
  MODULO_NO_ACTIVO: true,
  MODULO_EN_SOLO_LECTURA: true,
  SIN_CAPACIDAD: true,
  SIN_PERMISO: true,
};

describe("traducirErrorDeUsuarios", () => {
  it.each(Object.keys(MOTIVOS))("el motivo del guard %s sale como el genérico", (motivo) => {
    expect(traducirErrorDeUsuarios(motivo)).toEqual(GENERICO);
  });

  it.each([
    "MEMBRESIA_NO_ENCONTRADA",
    "ES_UNO_MISMO",
    "ES_EL_GERENTE",
    "ULTIMO_ADMIN",
    "EMPRESA_NO_OPERA",
    "INVITACION_NO_ENCONTRADA",
    "UN_ERROR_QUE_NADIE_CONOCE",
    "",
  ])("cualquier otro texto de error (%s) sale como el genérico", (error) => {
    expect(traducirErrorDeUsuarios(error)).toEqual(GENERICO);
  });

  it.each([
    { codigo: "EMPRESA_NO_OPERA", empresaId: "e-1", motivo: "EMPRESA_SUSPENDIDA" },
    { codigo: "ROL_DISTINTO_AL_ANTERIOR", empresaId: "e-1" },
  ])(
    "un error de negocio con datos (%j) sale como el genérico, sin decir cuál empresa ni por qué",
    (error) => {
      expect(traducirErrorDeUsuarios(error)).toEqual(GENERICO);
    },
  );

  it("un error de la base (objeto) pasa sin cambios para que salga como fallo inesperado", () => {
    const error = { tipo: "Inesperado", sqlstate: "XX000", mensaje: "relation does not exist" };
    expect(traducirErrorDeUsuarios(error)).toBe(error);
  });
});

describe("accionDeUsuarios y lecturaDeUsuarios", () => {
  it("todo error de las dos consultas tiene código público: los motivos, el genérico; la base, referencia sin detalle", async () => {
    for (const motivo of Object.keys(MOTIVOS)) {
      const r = await lecturaDeUsuarios(
        respuesta,
        () => Promise.resolve(err(motivo)),
        () => 1,
      );
      expect(r).toEqual({ ok: false, error: errorDeCodigo("USUARIOS_NO_PERMITIDO") });
      expect(Object.keys(CODIGOS_PUBLICOS)).toContain("USUARIOS_NO_PERMITIDO");
    }
    for (const tipo of [
      { tipo: "Unicidad", restriccion: "uq_secreta" },
      { tipo: "Superposicion", restriccion: null },
      { tipo: "Referencia", restriccion: "fk_secreta" },
      { tipo: "Check", restriccion: "ck_secreta" },
      { tipo: "AccesoDenegado" },
      { tipo: "ConcurrenciaAgotada" },
      { tipo: "Inesperado", sqlstate: "42P01", mensaje: 'relation "membresia" does not exist' },
    ]) {
      registro.length = 0;
      const r = await lecturaDeUsuarios(
        respuesta,
        () => Promise.resolve(err(tipo)),
        () => 1,
      );
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.error.codigo).toBe("ERROR_INTERNO");
      expect(r.error.referencia).toMatch(/^PD-/);
      expect(JSON.stringify(r)).not.toMatch(/secreta|membresia|42P01/);
      expect(registro.join(" ")).toMatch(/PD-/);
    }
  });

  it("un pedido sin la forma pedida es el genérico y no corre nada", async () => {
    let corrio = false;
    const r = await accionDeUsuarios(
      respuesta,
      { personaId: "no-es-un-id" },
      entradaDeFichaDeUsuario,
      () => {
        corrio = true;
        return Promise.resolve(ok(1));
      },
      (x) => x,
    );
    expect(r).toEqual({ ok: false, error: errorDeCodigo("USUARIOS_NO_PERMITIDO") });
    expect(corrio).toBe(false);
  });

  it("un pedido válido corre y presenta; una excepción sale sin detalle y con referencia", async () => {
    const bien = await accionDeUsuarios(
      respuesta,
      { personaId: ID },
      entradaDeFichaDeUsuario,
      (e) => Promise.resolve(ok(e.personaId)),
      (x) => ({ x }),
    );
    expect(bien).toEqual({ ok: true, dato: { x: ID } });
    registro.length = 0;
    const mal = await lecturaDeUsuarios(
      respuesta,
      () => Promise.reject(new Error("clave secreta de la base")),
      () => 1,
    );
    expect(mal.ok).toBe(false);
    expect(JSON.stringify(mal)).not.toMatch(/secreta/);
    expect(registro.join(" ")).toMatch(/secreta/);
  });
});
