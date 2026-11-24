import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  asignarSucursalesDeUsuario,
  desactivarUsuario,
  editorDeSucursalesDeUsuario,
  fichaDeUsuario,
  listarUsuarios,
  reactivarUsuario,
  type DependenciasDeSucursalesDeUsuarioWeb,
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
    casosDeUso: () => ({}) as unknown as ReturnType<DependenciasDeUsuariosWeb["casosDeUso"]>,
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

describe("las sucursales de un empleado (U4)", () => {
  const sucursalDeLista = (id: string, nombre: string) => ({
    id,
    nombre,
    activa: true,
    horaDeCorte: "00:00",
    contacto: { telefono: "no-tiene-que-salir", correo: null, web: null },
    version: 3,
    zonaHoraria: "America/Argentina/Buenos_Aires",
  });

  function deps(
    miembros: unknown,
    asignar: unknown = ok({ agregadas: [], reactivadas: [], quitadas: [] }),
    llamadas: unknown[] = [],
  ): DependenciasDeSucursalesDeUsuarioWeb {
    return {
      consultas: () =>
        ({ listarMiembros: () => Promise.resolve(miembros) }) as unknown as ReturnType<
          DependenciasDeSucursalesDeUsuarioWeb["consultas"]
        >,
      consultasDeEmpresas: () =>
        ({
          listarSucursales: (_c: unknown, entrada: unknown) => {
            llamadas.push(["listarSucursales", entrada]);
            return Promise.resolve(
              ok([sucursalDeLista("suc-1", "Centro"), sucursalDeLista("suc-2", "Norte")]),
            );
          },
        }) as unknown as ReturnType<DependenciasDeSucursalesDeUsuarioWeb["consultasDeEmpresas"]>,
      casosDeUso: () =>
        ({
          asignarSucursales: (_c: unknown, entrada: unknown) => {
            llamadas.push(["asignarSucursales", entrada]);
            return Promise.resolve(asignar);
          },
        }) as unknown as ReturnType<DependenciasDeSucursalesDeUsuarioWeb["casosDeUso"]>,
      respuesta: { registrar: (x) => registro.push(x), azar: () => new Uint8Array(4) },
    };
  }
  const gerente = { ...miembro(B, "g@x.test"), rol: "GERENTE", sucursales: [] };

  it("el editor ofrece solo las sucursales ACTIVAS con id, nombre y si están tildadas (lista blanca), pidiendo solo las activas", async () => {
    const llamadas: unknown[] = [];
    const r = await editorDeSucursalesDeUsuario(
      deps(ok([{ ...miembro(A, "a@x.test"), sucursales: ["suc-2"] }]), undefined, llamadas),
      CONTEXTO,
      { personaId: A },
    );
    expect(r).toEqual({
      ok: true,
      dato: [
        { id: "suc-1", nombre: "Centro", marcada: false },
        { id: "suc-2", nombre: "Norte", marcada: true },
      ],
    });
    expect(llamadas).toEqual([["listarSucursales", { incluirInactivas: false }]]);
    expect(JSON.stringify(r)).not.toMatch(/no-tiene-que-salir|zonaHoraria|version|horaDeCorte/);
  });

  it("para un gerente, un administrador o un desactivado no hay editor (null) y ni se piden las sucursales", async () => {
    for (const quien of [
      gerente,
      { ...miembro(B, "b@x.test"), rol: "ADMINISTRADOR" },
      miembro(B, "b@x.test", false),
    ]) {
      const llamadas: unknown[] = [];
      const r = await editorDeSucursalesDeUsuario(
        deps(ok([quien]), undefined, llamadas),
        CONTEXTO,
        {
          personaId: B,
        },
      );
      expect(r).toEqual({ ok: true, dato: null });
      expect(llamadas).toEqual([]);
    }
  });

  it("guardar manda el conjunto final al caso de uso con la persona de la dirección y devuelve solo las tres listas", async () => {
    const llamadas: unknown[] = [];
    const r = await asignarSucursalesDeUsuario(
      deps(
        ok([miembro(A, "a@x.test")]),
        ok({ agregadas: ["suc-1"], reactivadas: [], quitadas: ["suc-9"], interna: "no-sale" }),
        llamadas,
      ),
      CONTEXTO,
      { personaId: A, sucursales: [], empresaId: "otra" },
    );
    expect(r).toEqual({
      ok: true,
      dato: { agregadas: ["suc-1"], reactivadas: [], quitadas: ["suc-9"] },
    });
    expect(llamadas).toEqual([["asignarSucursales", { personaId: A, sucursales: [] }]]);
  });

  it("a un gerente, un administrador, un desactivado o alguien que no es de la empresa NO se le guarda nada: el genérico, sin llamar al caso de uso", async () => {
    for (const miembros of [
      [gerente],
      [{ ...miembro(B, "b@x.test"), rol: "ADMINISTRADOR" }],
      [miembro(B, "b@x.test", false)],
      [miembro(A, "a@x.test")],
    ]) {
      const llamadas: unknown[] = [];
      const r = await asignarSucursalesDeUsuario(
        deps(ok(miembros), undefined, llamadas),
        CONTEXTO,
        {
          personaId: B,
          sucursales: [],
        },
      );
      expect(r).toMatchObject({ ok: false, error: { codigo: "USUARIOS_NO_PERMITIDO" } });
      expect(llamadas).toEqual([]);
    }
  });

  it("todo error de negocio del caso de uso (sucursal inactiva, ajena, sin permiso…) sale como el MISMO genérico, sin decir cuál", async () => {
    const salidas = [];
    for (const motivo of ["SUCURSAL_INACTIVA", "SUCURSAL_NO_ES_DE_LA_EMPRESA", "SIN_PERMISO"]) {
      salidas.push(
        await asignarSucursalesDeUsuario(
          deps(ok([miembro(A, "a@x.test")]), err(motivo)),
          CONTEXTO,
          { personaId: A, sucursales: [] },
        ),
      );
    }
    expect(new Set(salidas.map((s) => JSON.stringify(s))).size).toBe(1);
    expect(salidas[0]).toMatchObject({ ok: false, error: { codigo: "USUARIOS_NO_PERMITIDO" } });
  });

  it("sin permiso para leer la lista no sale ninguna casilla", async () => {
    const r = await editorDeSucursalesDeUsuario(deps(err("SIN_PERMISO")), CONTEXTO, {
      personaId: A,
    });
    expect(r).toMatchObject({ ok: false, error: { codigo: "USUARIOS_NO_PERMITIDO" } });
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
