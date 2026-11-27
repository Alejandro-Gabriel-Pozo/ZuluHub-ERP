import { describe, expect, it, vi } from "vitest";
import {
  decidirReemision,
  reemitirInvitacionDeCliente,
  type EntradaDeReemision,
} from "../../scripts/ejecutar-reemitir-invitacion-de-cliente";
import {
  prepararSecretoDeInvitaciones,
  type EntradaDelSecretoDeInvitaciones,
} from "../../scripts/ejecutar-secreto-de-invitaciones-de-cliente";
import type { EstadoDelAlta } from "../../src/adaptadores/postgres/estado-del-alta";
import { ok } from "../../src/primitivas/resultado/resultado";

/**
 * Reemitir la invitación del gerente, con todo inyectado: cuándo se permite (una empresa en alta pendiente, UNA invitación pendiente que es la del gerente, UN administrador), la clave de idempotencia
 * (sale de la invitación que se reemplaza), el candado de host, que ningún dato personal ni secreto salga, y que el secreto nuevo solo se rote en modo `reemitir` y si se permite.
 */

const EMPRESA = "33333333-3333-4333-8333-333333333333";
const INVITACION = "44444444-4444-4444-8444-444444444444";
const ADMIN = "admin.reemision@ejemplo.test";
const CADENA = "postgres://dueno-centinela:clave-dueno-centinela@host-centinela.test/base";
const BUENO: EstadoDelAlta = {
  empresas: [{ id: EMPRESA, estado: "PROVISIONING" }],
  invitacionesPendientes: [{ id: INVITACION, tipo: "ALTA_GERENTE" }],
  administradores: [ADMIN],
};

describe("decidirReemision", () => {
  it("con el alta pendiente devuelve la empresa, la invitación y el administrador", () => {
    expect(decidirReemision(BUENO)).toEqual({
      ok: true,
      empresaId: EMPRESA,
      invitacionId: INVITACION,
      adminEmail: ADMIN,
    });
  });

  it("con varios administradores actúa el primero (el más antiguo)", () => {
    const d = decidirReemision({ ...BUENO, administradores: [ADMIN, "otro@ejemplo.test"] });
    expect(d.ok && d.adminEmail).toBe(ADMIN);
  });

  it.each([
    ["sin empresa", { ...BUENO, empresas: [] }],
    [
      "dos empresas vivas",
      { ...BUENO, empresas: [...BUENO.empresas, { id: "x", estado: "ACTIVE" }] },
    ],
    [
      "empresa ya activa (alguien aceptó)",
      { ...BUENO, empresas: [{ id: EMPRESA, estado: "ACTIVE" }] },
    ],
    ["sin invitación pendiente", { ...BUENO, invitacionesPendientes: [] }],
    [
      "otra invitación pendiente (rotar el secreto la invalidaría)",
      {
        ...BUENO,
        invitacionesPendientes: [...BUENO.invitacionesPendientes, { id: "otra", tipo: "USUARIO" }],
      },
    ],
    [
      "la pendiente no es la del gerente",
      { ...BUENO, invitacionesPendientes: [{ id: INVITACION, tipo: "USUARIO" }] },
    ],
    ["sin administrador", { ...BUENO, administradores: [] }],
  ])("se rechaza: %s", (_nombre, estado) => {
    const d = decidirReemision(estado);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).not.toContain(ADMIN);
  });
});

function armar(
  opciones: {
    ambiente?: string | undefined;
    estado?: EstadoDelAlta | "falla";
    entorno?: Record<string, string | undefined>;
    codigo?: number;
    soloValidar?: boolean;
  } = {},
) {
  const salida: string[] = [];
  const errores: string[] = [];
  const comandos: string[] = [];
  const casos: Array<{ caso: string; json: Record<string, unknown>; email: string }> = [];
  const entrada: EntradaDeReemision = {
    ambiente: "ambiente" in opciones ? opciones.ambiente : "cliente-hdn",
    entorno: {
      PEDERNAL_DB_MIGRACIONES: CADENA,
      PEDERNAL_DB_PLATAFORMA:
        "postgres://plat-centinela:clave-plat-centinela@host-centinela.test/base",
      PEDERNAL_CLAVE_CONTEXTO: "1:secreto-contexto-centinela",
      PEDERNAL_SECRETO_INVITACIONES: "ab12".repeat(16),
      PEDERNAL_HOST_DE_LA_BASE: "host-centinela.test",
      GITHUB_ACTIONS: "true",
      ...opciones.entorno,
    },
    leerEstado: () =>
      opciones.estado === "falla"
        ? Promise.reject(new Error(`falló ${CADENA}`))
        : Promise.resolve(opciones.estado ?? BUENO),
    ejecutarCaso: (caso, json, email) => {
      casos.push({ caso, json: json as Record<string, unknown>, email });
      return Promise.resolve({ codigo: opciones.codigo ?? 0, datos: new Map() });
    },
    info: (l) => salida.push(l),
    error: (l) => errores.push(l),
    comando: (l) => comandos.push(l),
    ...(opciones.soloValidar === true ? { soloValidar: true } : {}),
  };
  return {
    entrada,
    salida,
    errores,
    comandos,
    casos,
    texto: () => [...salida, ...errores].join("\n"),
  };
}

describe("reemitir la invitación del gerente", () => {
  it("ejecuta el caso con la clave que sale de la invitación que se reemplaza, como el administrador de la base", async () => {
    const t = armar();
    expect(await reemitirInvitacionDeCliente(t.entrada)).toBe(0);
    expect(t.casos).toEqual([
      {
        caso: "reenviarInvitacionDelAlta",
        json: {
          claveDeIdempotencia: `reemitir-invitacion-v1-hdn-${INVITACION}`,
          empresaId: EMPRESA,
        },
        email: ADMIN,
      },
    ]);
    expect(t.comandos).toContain(`::add-mask::${ADMIN}`);
  });

  it("repetir con el mismo estado manda exactamente el mismo pedido (idempotente)", async () => {
    const a = armar();
    const b = armar();
    await reemitirInvitacionDeCliente(a.entrada);
    await reemitirInvitacionDeCliente(b.entrada);
    expect(b.casos).toEqual(a.casos);
  });

  it("`--validar` revisa el estado y las variables sin ejecutar ningún caso (y no exige las de la corrida completa)", async () => {
    const t = armar({
      soloValidar: true,
      entorno: {
        PEDERNAL_DB_PLATAFORMA: undefined,
        PEDERNAL_CLAVE_CONTEXTO: undefined,
        PEDERNAL_SECRETO_INVITACIONES: undefined,
      },
    });
    expect(await reemitirInvitacionDeCliente(t.entrada)).toBe(0);
    expect(t.casos).toEqual([]);
    const malo = armar({ soloValidar: true, estado: { ...BUENO, empresas: [] } });
    expect(await reemitirInvitacionDeCliente(malo.entrada)).toBe(1);
  });

  it.each([
    ["ambiente fuera de la lista", { ambiente: "preview" }],
    ["sin ambiente", { ambiente: undefined }],
    [
      "cadena de otra base",
      { entorno: { PEDERNAL_DB_MIGRACIONES: "postgres://u:p@otro.test/db" } },
    ],
    [
      "cadena con host en la query",
      { entorno: { PEDERNAL_DB_MIGRACIONES: `${CADENA}?host=otro.test` } },
    ],
    ["sin host declarado", { entorno: { PEDERNAL_HOST_DE_LA_BASE: undefined } }],
    ["sin secreto de invitaciones", { entorno: { PEDERNAL_SECRETO_INVITACIONES: undefined } }],
  ])("cierra ante la duda: %s (no ejecuta nada)", async (_n, cambios) => {
    const t = armar(cambios);
    expect(await reemitirInvitacionDeCliente(t.entrada)).toBe(2);
    expect(t.casos).toEqual([]);
  });

  it("si el estado no permite reemitir, sale 1 sin ejecutar y sin repetir el email ni la cadena", async () => {
    for (const estado of [{ ...BUENO, empresas: [] }, "falla" as const]) {
      const t = armar({ estado });
      expect(await reemitirInvitacionDeCliente(t.entrada)).toBe(1);
      expect(t.casos).toEqual([]);
      expect(t.texto()).not.toContain("clave-dueno-centinela");
      expect(t.texto()).not.toContain(ADMIN);
    }
  });

  it("si el caso rechaza, sale 1 y dice que repetir es seguro", async () => {
    const t = armar({ codigo: 1 });
    expect(await reemitirInvitacionDeCliente(t.entrada)).toBe(1);
    expect(t.texto()).toContain("repetir el flujo es seguro");
  });

  it("nada sensible sale en lo que se imprime", async () => {
    for (const opciones of [
      {},
      { estado: "falla" as const },
      { codigo: 1 },
      { soloValidar: true },
    ]) {
      const t = armar(opciones);
      await reemitirInvitacionDeCliente(t.entrada);
      for (const p of [
        ADMIN,
        "clave-dueno-centinela",
        "clave-plat-centinela",
        "secreto-contexto-centinela",
        "ab12".repeat(16),
      ]) {
        expect(t.texto()).not.toContain(p);
      }
    }
  });
});

describe("secreto de invitaciones en modo reemitir", () => {
  const armarSecreto = (permitido: boolean | "falla") => {
    const escribir = vi.fn(() => Promise.resolve(ok(null)));
    const entregadas: string[] = [];
    const errores: string[] = [];
    const entrada: EntradaDelSecretoDeInvitaciones = {
      ambiente: "cliente-hdn",
      // Sin el secreto con los datos personales: en este modo no hace falta.
      entorno: {
        PEDERNAL_DB_MIGRACIONES: CADENA,
        PEDERNAL_VERCEL_TOKEN: "token-de-prueba",
        PEDERNAL_HOST_DE_LA_BASE: "host-centinela.test",
      },
      empresaExiste: () => Promise.reject(new Error("no se usa en este modo")),
      modo: "reemitir",
      puedeReemitir: () =>
        permitido === "falla"
          ? Promise.reject(new Error("falló"))
          : Promise.resolve(
              permitido
                ? { ok: true as const }
                : { ok: false as const, motivo: "hay otra invitación pendiente" },
            ),
      clienteDeVercel: () =>
        ({ escribir }) as unknown as ReturnType<EntradaDelSecretoDeInvitaciones["clienteDeVercel"]>,
      entregar: (l) => entregadas.push(l),
      info: () => undefined,
      error: (l) => errores.push(l),
      comando: () => undefined,
      generar: () => "cd34".repeat(16),
    };
    return { entrada, escribir, entregadas, errores };
  };

  it("permitido: rota el secreto aunque la empresa exista (lo escribe en Vercel pisando) y lo entrega al paso siguiente", async () => {
    const t = armarSecreto(true);
    expect(await prepararSecretoDeInvitaciones(t.entrada)).toBe(0);
    expect(t.escribir).toHaveBeenCalledWith(
      "PEDERNAL_SECRETO_INVITACIONES",
      "cd34".repeat(16),
      "production",
      { pisar: true },
    );
    expect(t.entregadas).toEqual([`PEDERNAL_SECRETO_INVITACIONES=${"cd34".repeat(16)}`]);
  });

  it("no permitido (o falla la lectura): no escribe nada en Vercel y sale 1 sin entregar el secreto", async () => {
    for (const permitido of [false, "falla" as const]) {
      const t = armarSecreto(permitido);
      expect(await prepararSecretoDeInvitaciones(t.entrada)).toBe(1);
      expect(t.escribir).not.toHaveBeenCalled();
      expect(t.entregadas).toEqual([]);
    }
  });
});
