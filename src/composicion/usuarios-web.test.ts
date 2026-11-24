import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  desactivarUsuario,
  fichaDeUsuario,
  listarUsuarios,
  type DependenciasDeUsuariosWeb,
} from "./usuarios-web";

/**
 * La composición de «Usuarios» con consultas falsas: la lista blanca (nada de más sale aunque la consulta traiga más), el todo o nada y la ficha buscada entre las de la empresa.
 * Con la base real, el aislamiento entre empresas y los permisos se prueban en `test/integracion/usuarios-web.test.ts`.
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
const invitacion = (id: string) => ({
  invitacionId: id,
  email: "julia@x.test",
  rol: "ADMINISTRADOR",
  sucursales: ["suc-1"],
  emitidaEn: "2026-11-22T10:00:00.000Z",
  venceEn: "2026-11-29T10:00:00.000Z",
  vencida: false,
  emitidaPor: "quien-invito",
  token: "no-tiene-que-salir",
});

function dependencias(
  miembros: unknown,
  invitaciones: unknown,
  llamadas: string[] = [],
): DependenciasDeUsuariosWeb {
  return {
    casosDeUso: () => {
      throw new Error("las lecturas no escriben: no tocan los casos de uso");
    },
    consultas: () =>
      ({
        listarMiembros: () => {
          llamadas.push("miembros");
          return Promise.resolve(miembros);
        },
        listarInvitacionesPendientes: () => {
          llamadas.push("invitaciones");
          return Promise.resolve(invitaciones);
        },
      }) as unknown as ReturnType<DependenciasDeUsuariosWeb["consultas"]>,
    respuesta: { registrar: (x) => registro.push(x), azar: () => new Uint8Array(4) },
  };
}

describe("listarUsuarios", () => {
  it("sale solo la lista blanca: sin sucursales, token, hash ni quién invitó", async () => {
    const d = dependencias(
      ok([miembro(A, "a@x.test"), miembro(B, "b@x.test", false)]),
      ok([invitacion("i-1")]),
    );
    const r = await listarUsuarios(d, CONTEXTO);
    expect(r).toEqual({
      ok: true,
      dato: {
        usuarios: [
          { personaId: A, email: "a@x.test", rol: "OPERADOR", activo: true },
          { personaId: B, email: "b@x.test", rol: "OPERADOR", activo: false },
        ],
        invitaciones: [
          {
            invitacionId: "i-1",
            email: "julia@x.test",
            rol: "ADMINISTRADOR",
            venceEn: "2026-11-29T10:00:00.000Z",
            vencida: false,
          },
        ],
      },
    });
    expect(JSON.stringify(r)).not.toMatch(/token|hash|sucursales|quien-invito|emitid/i);
  });

  it("si falla la lista de miembros, falla todo y no se pide la otra", async () => {
    const llamadas: string[] = [];
    const r = await listarUsuarios(
      dependencias(err("SIN_PERMISO"), ok([invitacion("i-1")]), llamadas),
      CONTEXTO,
    );
    expect(r).toMatchObject({ ok: false, error: { codigo: "USUARIOS_NO_PERMITIDO" } });
    expect(llamadas).toEqual(["miembros"]);
  });

  it("si falla la de invitaciones, falla todo: no sale la lista a medias", async () => {
    const r = await listarUsuarios(
      dependencias(ok([miembro(A, "a@x.test")]), err("SIN_PERMISO")),
      CONTEXTO,
    );
    expect(r).toMatchObject({ ok: false, error: { codigo: "USUARIOS_NO_PERMITIDO" } });
    expect(r.ok).toBe(false);
  });

  it("una excepción de la base sale con referencia y sin detalle", async () => {
    registro.length = 0;
    const d = dependencias(ok([]), ok([]));
    const roto: DependenciasDeUsuariosWeb = {
      ...d,
      consultas: () => {
        throw new Error("contraseña de la base");
      },
    };
    const r = await listarUsuarios(roto, CONTEXTO);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/contraseña/);
    expect(registro.join(" ")).toMatch(/contraseña/);
  });

  it("sin nadie ni invitaciones sale vacía (no es un error)", async () => {
    expect(await listarUsuarios(dependencias(ok([]), ok([])), CONTEXTO)).toEqual({
      ok: true,
      dato: { usuarios: [], invitaciones: [] },
    });
  });
});

describe("fichaDeUsuario", () => {
  const d = () => dependencias(ok([miembro(A, "a@x.test"), miembro(B, "b@x.test", false)]), ok([]));

  it("trae a la persona pedida entre las de la empresa, con la lista blanca", async () => {
    const r = await fichaDeUsuario(d(), CONTEXTO, { personaId: B });
    expect(r).toEqual({
      ok: true,
      dato: { personaId: B, email: "b@x.test", rol: "OPERADOR", activo: false },
    });
  });

  it("una persona que no está en la empresa sale como el genérico, igual que un id mal escrito", async () => {
    const ajena = await fichaDeUsuario(d(), CONTEXTO, {
      personaId: "0b0b0b0b-1111-4222-8333-4444444444ff",
    });
    const mal = await fichaDeUsuario(d(), CONTEXTO, { personaId: "xx" });
    expect(ajena).toEqual(mal);
    expect(ajena).toMatchObject({ ok: false, error: { codigo: "USUARIOS_NO_PERMITIDO" } });
  });

  it("sin permiso sale el genérico y ninguna fila", async () => {
    const r = await fichaDeUsuario(dependencias(err("SIN_PERMISO"), ok([])), CONTEXTO, {
      personaId: A,
    });
    expect(r).toMatchObject({ ok: false, error: { codigo: "USUARIOS_NO_PERMITIDO" } });
  });
});

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
