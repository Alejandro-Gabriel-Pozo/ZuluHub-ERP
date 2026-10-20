import fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import "../../test/propiedades/configuracion";
import { CODIGOS_PUBLICOS, type CodigoPublico } from "../capacidades/experiencia/respuesta";
import type { ErrorAlListarSucursales } from "../modulos/empresas/publico";
import type { ErrorAlAceptarInvitacion } from "../modulos/identidad/publico";
import { err, ok } from "../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../puertos/transacciones";
import {
  aRespuesta,
  aRespuestaDeExcepcion,
  errorAPublico,
  respuestaDeFalla,
  type DependenciasDeRespuesta,
} from "./a-respuesta";

/**
 * ADR-016 en el borde: `aRespuesta` es el único traductor. Acá se prueba (1) el contrato exhaustivo de los
 * errores que ya consumen las pantallas, (2) que un error inesperado, una excepción o `ConcurrenciaAgotada`
 * salen SIN detalle y con referencia, y el detalle va al registro, (3) que el dato exitoso sale proyectado.
 */
const AZAR = new Uint8Array([0xab, 0xcd, 0x01, 0x23]);

function armar() {
  const registros: string[] = [];
  const dependencias: DependenciasDeRespuesta = {
    registrar: (d) => registros.push(d),
    azar: () => AZAR,
  };
  return { dependencias, registros };
}

describe("contrato exhaustivo: todo error conocido por las pantallas tiene su código público", () => {
  it("los errores de aceptar una invitación (de texto) son códigos públicos", () => {
    expectTypeOf<Extract<ErrorAlAceptarInvitacion, string>>().toExtend<CodigoPublico>();
    expectTypeOf<
      Extract<ErrorAlAceptarInvitacion, { codigo: string }>["codigo"]
    >().toExtend<CodigoPublico>();
  });

  it("los motivos del guard de las consultas de empresa son códigos públicos", () => {
    expectTypeOf<Extract<ErrorAlListarSucursales, string>>().toExtend<CodigoPublico>();
  });

  it("los errores de persistencia no son códigos públicos: salen como inesperados", () => {
    expectTypeOf<Extract<ErrorDePersistencia, string>>().toEqualTypeOf<never>();
  });

  it("cada código de aceptar una invitación sale con su código y su texto", () => {
    const { dependencias, registros } = armar();
    const codigos: ErrorAlAceptarInvitacion[] = [
      "INVITACION_NO_ENCONTRADA",
      "ALTA_NO_PENDIENTE",
      "INVITACION_REVOCADA",
      "INVITACION_NO_PENDIENTE",
      "INVITACION_VENCIDA",
      "INVITACION_DE_OTRO_EMAIL",
      "PERSONA_SUSPENDIDA",
      "PERSONA_DE_OTRO_USUARIO",
      "USUARIO_DE_OTRA_PERSONA",
      "YA_ES_MIEMBRO",
      { codigo: "EMPRESA_NO_OPERA", empresaId: "x" as never, motivo: "EMPRESA_EN_ALTA" },
      { codigo: "ROL_DISTINTO_AL_ANTERIOR", empresaId: "x" as never },
    ];
    for (const e of codigos) {
      const r = aRespuesta(err(e), dependencias, () => 1);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(Object.hasOwn(CODIGOS_PUBLICOS, r.error.codigo)).toBe(true);
      expect(r.error.referencia).toBeUndefined();
    }
    expect(registros).toEqual([]);
  });
});

describe("aRespuesta", () => {
  it("un resultado ok sale proyectado: solo lo que presenta `presentar`", () => {
    const { dependencias } = armar();
    const r = aRespuesta(
      ok({ id: "interno", nombre: "Café", secreto: "x" }),
      dependencias,
      (v) => ({
        nombre: v.nombre,
      }),
    );
    expect(r).toEqual({ ok: true, dato: { nombre: "Café" } });
  });

  it("un error de negocio sale con su código, sin referencia y sin registro", () => {
    const { dependencias, registros } = armar();
    const r = aRespuesta(err("INVITACION_VENCIDA"), dependencias, () => 1);
    expect(r).toEqual({
      ok: false,
      error: {
        codigo: "INVITACION_VENCIDA",
        clave: "error.invitacion_vencida",
        presentacion: "AVISO",
      },
    });
    expect(registros).toEqual([]);
  });

  it("un motivo del guard sale como «por qué no puedo»", () => {
    const { dependencias } = armar();
    const r = aRespuesta(err("MODULO_NO_ACTIVO"), dependencias, () => 1);
    expect(r).toEqual({
      ok: false,
      error: {
        codigo: "MODULO_NO_ACTIVO",
        clave: "motivo.modulo_no_activo",
        presentacion: "POR_QUE_NO_PUEDO",
      },
    });
  });

  it("un error inesperado de la base sale SIN detalle y con referencia; el detalle va al registro", () => {
    const { dependencias, registros } = armar();
    const crudo = {
      tipo: "Inesperado",
      sqlstate: "08006",
      mensaje: 'password authentication failed for user "pedernal_app"',
    } as const;
    const r = aRespuesta(err(crudo), dependencias, () => 1);
    expect(r).toEqual({
      ok: false,
      error: {
        codigo: "ERROR_INTERNO",
        clave: "error.inesperado",
        presentacion: "INESPERADO",
        referencia: "PD-ABCD-0123",
      },
    });
    expect(JSON.stringify(r)).not.toMatch(/password|pedernal_app|08006/);
    expect(registros).toEqual([
      'PD-ABCD-0123 Inesperado 08006 password authentication failed for user "pedernal_app"',
    ]);
  });

  it("ConcurrenciaAgotada también es «No se pudo completar. Podés reintentar» con referencia", () => {
    const { dependencias, registros } = armar();
    const r = aRespuesta(err({ tipo: "ConcurrenciaAgotada" } as const), dependencias, () => 1);
    expect(r).toMatchObject({
      ok: false,
      error: { codigo: "ERROR_INTERNO", referencia: "PD-ABCD-0123" },
    });
    expect(registros).toEqual(["PD-ABCD-0123 ConcurrenciaAgotada"]);
  });

  it("un texto desconocido en el lado de error no sale: es inesperado", () => {
    const { dependencias, registros } = armar();
    const r = aRespuesta(err("CODIGO_NUEVO_SIN_TEXTO"), dependencias, () => 1);
    expect(r).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
    expect(JSON.stringify(r)).not.toContain("CODIGO_NUEVO");
    expect(registros).toEqual(["PD-ABCD-0123 CODIGO_NUEVO_SIN_TEXTO"]);
  });
});

describe("aRespuestaDeExcepcion y respuestaDeFalla", () => {
  it("una excepción sale sin detalle y con referencia", () => {
    const { dependencias, registros } = armar();
    const r = aRespuestaDeExcepcion(new Error("connect ECONNREFUSED 10.0.0.5:5432"), dependencias);
    expect(r).toMatchObject({
      ok: false,
      error: { codigo: "ERROR_INTERNO", referencia: "PD-ABCD-0123" },
    });
    expect(JSON.stringify(r)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
    expect(registros).toEqual(["PD-ABCD-0123 Error: connect ECONNREFUSED 10.0.0.5:5432"]);
  });

  it("indisponible: NO_DISPONIBLE (la base no responde)", () => {
    const { dependencias } = armar();
    expect(respuestaDeFalla("x", dependencias, true)).toMatchObject({
      codigo: "NO_DISPONIBLE",
      clave: "error.no_disponible",
    });
    expect(respuestaDeFalla("x", dependencias)).toMatchObject({ codigo: "ERROR_INTERNO" });
  });

  it("si el propio registro falla, la respuesta sale igual", () => {
    const r = respuestaDeFalla("x", {
      registrar: () => {
        throw new Error("el registro no anda");
      },
      azar: () => AZAR,
    });
    expect(r.referencia).toBe("PD-ABCD-0123");
  });

  it("sin azar inyectado, la referencia es una PD-XXXX-XXXX distinta cada vez", () => {
    const referencias = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const r = respuestaDeFalla("x", { registrar: () => undefined });
      expect(r.referencia).toMatch(/^PD-[0-9A-F]{4}-[0-9A-F]{4}$/);
      referencias.add(r.referencia as string);
    }
    expect(referencias.size).toBeGreaterThan(1);
  });

  it("errorAPublico: lo conocido sin referencia, lo demás con ella", () => {
    const { dependencias, registros } = armar();
    expect(errorAPublico("YA_ES_MIEMBRO", dependencias).referencia).toBeUndefined();
    expect(errorAPublico(new Error("x"), dependencias).referencia).toBe("PD-ABCD-0123");
    expect(registros).toHaveLength(1);
  });
});

describe("propiedad: ninguna forma de falla expone su detalle por aRespuesta", () => {
  it("con una palabra secreta en cualquier lugar, la respuesta serializada no la contiene", () => {
    const SECRETO = "SECRETO-PD-77";
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(new Error(SECRETO)),
          fc.constant({ tipo: "Inesperado", sqlstate: "X", mensaje: SECRETO }),
          fc.constant({ tipo: "Check", restriccion: SECRETO }),
          fc.constant(SECRETO),
          fc.constant({ codigo: "OTRO", campo: SECRETO }),
          fc.constant({ codigo: "YA_ES_MIEMBRO", campo: SECRETO }),
          fc.anything().map((x) => ({ x, SECRETO })),
        ),
        fc.boolean(),
        (falla, comoExcepcion) => {
          const { dependencias } = armar();
          const r = comoExcepcion
            ? aRespuestaDeExcepcion(falla, dependencias)
            : aRespuesta(err(falla), dependencias, () => 1);
          expect(JSON.stringify(r)).not.toContain(SECRETO);
        },
      ),
    );
  });
});
