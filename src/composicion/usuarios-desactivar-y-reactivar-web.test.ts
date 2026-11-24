import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import { desactivarUsuario, reactivarUsuario } from "./usuarios-desactivar-y-reactivar-web";
import type { DependenciasDeUsuariosWeb } from "./usuarios-web";

/**
 * Desactivar y reactivar (tramo U3) con consultas y casos de uso falsos: lo que se manda al caso de uso (SOLO el id, o el email y el rol DE LA MEMBRESÍA al reactivar), que todo rechazo sale como el genérico y que una
 * excepción sale con referencia y sin detalle. Con la base real se prueban en `test/integracion/usuarios-web-desactivar.test.ts` y `usuarios-web-reactivar.test.ts`.
 */
const CONTEXTO = { empresaId: "empresa-de-la-sesion" } as unknown as ContextoOperativo;
const A = "0b0b0b0b-1111-4222-8333-444444444441";
const B = "0b0b0b0b-1111-4222-8333-444444444442";
const registro: string[] = [];

const miembro = (id: string, email: string, activo = true) => ({
  personaId: id,
  email,
  rol: "OPERADOR",
  activo,
  sucursales: ["suc-1", "suc-2"],
  tokenHash: "no-tiene-que-salir",
});

function dependencias(miembros: unknown, invitaciones: unknown): DependenciasDeUsuariosWeb {
  return {
    casosDeUso: () => ({}) as unknown as ReturnType<DependenciasDeUsuariosWeb["casosDeUso"]>,
    consultas: () =>
      ({
        listarMiembros: () => Promise.resolve(miembros),
        listarInvitacionesPendientes: () => Promise.resolve(invitaciones),
      }) as unknown as ReturnType<DependenciasDeUsuariosWeb["consultas"]>,
    respuesta: { registrar: (x) => registro.push(x), azar: () => new Uint8Array(4) },
  };
}

describe("desactivarUsuario", () => {
  /** Los dos errores de texto que `apagarMembresia` puede devolver, más los motivos del guard y la empresa que no opera: ninguno puede salir con su texto. */
  const ERRORES = [
    "MEMBRESIA_NO_ENCONTRADA",
    "ES_UNO_MISMO",
    "ES_EL_GERENTE",
    "ULTIMO_ADMIN",
    "SIN_PERMISO",
    "MODULO_NO_ACTIVO",
    "EMPRESA_NO_OPERA",
  ];

  function conApagado(resultado: () => Promise<unknown>) {
    const pedidos: unknown[][] = [];
    const d: DependenciasDeUsuariosWeb = {
      ...dependencias(ok([]), ok([])),
      casosDeUso: () =>
        ({
          apagarMembresia: (...args: unknown[]) => {
            pedidos.push(args);
            return resultado();
          },
        }) as unknown as ReturnType<DependenciasDeUsuariosWeb["casosDeUso"]>,
    };
    return { d, pedidos };
  }

  it("manda al caso de uso SOLO el id de la persona y el contexto del servidor, aunque el pedido traiga más", async () => {
    const { d, pedidos } = conApagado(() =>
      Promise.resolve(ok({ yaEstabaApagada: false, invitacionesRevocadas: 2 })),
    );
    const r = await desactivarUsuario(d, CONTEXTO, {
      personaId: A,
      empresaId: "otra-empresa",
      rol: "GERENTE",
      actor: B,
      email: "x@x.test",
    });
    expect(r).toEqual({ ok: true, dato: { yaEstabaApagada: false } });
    expect(pedidos).toEqual([[CONTEXTO, { personaId: A }]]);
  });

  it("repetir devuelve ok sin que la pantalla note la diferencia (el caso de uso no escribe la segunda vez)", async () => {
    const { d } = conApagado(() =>
      Promise.resolve(ok({ yaEstabaApagada: true, invitacionesRevocadas: 0 })),
    );
    expect(await desactivarUsuario(d, CONTEXTO, { personaId: A })).toEqual({
      ok: true,
      dato: { yaEstabaApagada: true },
    });
  });

  it.each(ERRORES)("el error %s sale como el genérico, sin decir cuál fue", async (error) => {
    const { d } = conApagado(() => Promise.resolve(err(error)));
    expect(await desactivarUsuario(d, CONTEXTO, { personaId: A })).toMatchObject({
      ok: false,
      error: { codigo: "USUARIOS_NO_PERMITIDO" },
    });
  });

  it("un id que no tiene la forma de un identificador no llega al caso de uso", async () => {
    const { d, pedidos } = conApagado(() => Promise.resolve(err("NO_DEBERIA_LLEGAR")));
    for (const crudo of [{ personaId: "xx" }, { personaId: 7 }, {}, null, "texto"]) {
      expect(await desactivarUsuario(d, CONTEXTO, crudo)).toMatchObject({
        ok: false,
        error: { codigo: "USUARIOS_NO_PERMITIDO" },
      });
    }
    expect(pedidos).toEqual([]);
  });

  it("una excepción de la base sale con referencia y sin detalle", async () => {
    registro.length = 0;
    const { d } = conApagado(() => Promise.reject(new Error("fallo con datos: ana@x.test")));
    const r = await desactivarUsuario(d, CONTEXTO, { personaId: A });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("ana@x.test");
    expect(registro.join(" ")).toContain("ana@x.test");
  });
});

describe("reactivarUsuario (U3, parte B)", () => {
  const S1 = "0b0b0b0b-1111-4222-8333-444444444451";

  /** Una empresa con una persona desactivada (el email y el rol los tiene la membresía, no el pedido) y un invitarUsuario falso que anota lo que recibe. */
  function conMiembros(
    miembros: unknown,
    invitar: () => Promise<unknown> = () =>
      Promise.resolve(ok({ invitacionId: "i-1", yaExistia: false })),
  ) {
    const pedidos: unknown[][] = [];
    const d: DependenciasDeUsuariosWeb = {
      ...dependencias(miembros, ok([])),
      casosDeUso: () =>
        ({
          invitarUsuario: (...args: unknown[]) => {
            pedidos.push(args);
            return invitar();
          },
        }) as unknown as ReturnType<DependenciasDeUsuariosWeb["casosDeUso"]>,
    };
    return { d, pedidos };
  }
  const desactivado = (rol: string, activo = false) => ({
    ...miembro(A, "ana@x.test", activo),
    rol,
  });

  it("invita con el email y el rol DE LA MEMBRESÍA, aunque el pedido traiga otros", async () => {
    const { d, pedidos } = conMiembros(ok([desactivado("OPERADOR")]));
    const r = await reactivarUsuario(d, CONTEXTO, {
      personaId: A,
      sucursales: [S1],
      email: "otro@x.test",
      rol: "ADMINISTRADOR",
    });
    expect(r).toEqual({ ok: true, dato: { invitacionId: "i-1", yaExistia: false } });
    expect(pedidos).toEqual([
      [CONTEXTO, { email: "ana@x.test", rol: "OPERADOR", sucursales: [S1] }],
    ]);
  });

  it("un administrador vuelve como administrador y sin sucursales (trabaja en todas), aunque se manden", async () => {
    const { d, pedidos } = conMiembros(ok([desactivado("ADMINISTRADOR")]));
    await reactivarUsuario(d, CONTEXTO, { personaId: A, sucursales: [S1] });
    expect(pedidos).toEqual([
      [CONTEXTO, { email: "ana@x.test", rol: "ADMINISTRADOR", sucursales: [] }],
    ]);
  });

  it("repetir devuelve la misma invitación (`yaExistia`), sin que la pantalla lo trate como error", async () => {
    const { d } = conMiembros(ok([desactivado("OPERADOR")]), () =>
      Promise.resolve(ok({ invitacionId: "i-1", yaExistia: true })),
    );
    expect(await reactivarUsuario(d, CONTEXTO, { personaId: A })).toEqual({
      ok: true,
      dato: { invitacionId: "i-1", yaExistia: true },
    });
  });

  it.each([
    [
      "una persona que no está en la empresa (o de otra)",
      ok([desactivado("OPERADOR")]),
      { personaId: B },
    ],
    ["una persona ya activa", ok([desactivado("OPERADOR", true)]), { personaId: A }],
    ["el gerente", ok([desactivado("GERENTE")]), { personaId: A }],
    ["un id que no es un identificador", ok([desactivado("OPERADOR")]), { personaId: "xx" }],
    ["sin permiso para ver a las personas", err("SIN_PERMISO"), { personaId: A }],
  ])("%s sale como el genérico y no invita a nadie", async (_caso, miembros, crudo) => {
    const { d, pedidos } = conMiembros(miembros);
    expect(await reactivarUsuario(d, CONTEXTO, crudo)).toMatchObject({
      ok: false,
      error: { codigo: "USUARIOS_NO_PERMITIDO" },
    });
    expect(pedidos).toEqual([]);
  });

  it("los rechazos del caso de uso de invitar que no tienen texto propio salen como el genérico (el rol distinto al anterior, por ejemplo)", async () => {
    const { d } = conMiembros(ok([desactivado("OPERADOR")]), () =>
      Promise.resolve(err({ codigo: "ROL_DISTINTO_AL_ANTERIOR", empresaId: "e-1" })),
    );
    expect(await reactivarUsuario(d, CONTEXTO, { personaId: A })).toMatchObject({
      ok: false,
      error: { codigo: "USUARIOS_NO_PERMITIDO" },
    });
  });

  it("si en el medio ya es parte de la empresa, el aviso es el propio («Ya es parte de la empresa»)", async () => {
    const { d } = conMiembros(ok([desactivado("OPERADOR")]), () =>
      Promise.resolve(err("YA_ES_MIEMBRO")),
    );
    expect(await reactivarUsuario(d, CONTEXTO, { personaId: A })).toMatchObject({
      ok: false,
      error: { codigo: "USUARIOS_YA_ES_MIEMBRO" },
    });
  });
});
