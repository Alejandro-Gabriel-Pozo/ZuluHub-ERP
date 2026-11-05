import { describe, expect, it, vi } from "vitest";
import {
  VARIABLES_OBLIGATORIAS,
  VARIABLE_DEL_PAQUETE,
  ejecutorDeCasos,
  leerPaquete,
  prepararEmpresaDePruebas,
  type EntradaDePreparacion,
} from "../../scripts/ejecutar-preparar-empresa-de-pruebas";
import {
  armarCasosDeLaLista,
  type CasosDeLaLista,
} from "../../scripts/ejecutar-caso-desde-archivo";
import { CASOS_DE_PLATAFORMA } from "../../src/plataforma/dominio/pedido-de-caso";
import { adminPlataformaId } from "../../src/primitivas/identificadores/marca";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * El orquestador de «preparar la empresa de pruebas» con todo inyectado (sin base ni red): el orden de los casos,
 * que los ids se encadenan, que repetir no cambia nada, que un dato mal escrito no deja nada a medias y que ni un
 * secreto ni un dato personal llegan a lo que se imprime. Usa el `ejecutarCasoDePlataforma` real: la forma de cada
 * paso la revisa el código de producción.
 */

const ID_ADMIN = adminPlataformaId("aaaaaaaa-0000-4000-8000-000000000001");
const PLAN = "11111111-1111-4111-8111-111111111111";
const MARCA = "22222222-2222-4222-8222-222222222222";
const EMPRESA = "33333333-3333-4333-8333-333333333333";

// Valores inventados y reconocibles: ninguno puede aparecer en lo que se imprime.
const PERSONALES = {
  adminEmail: "admin.centinela@ejemplo.test",
  emailGerente: "gerente.centinela@ejemplo.test",
  cuit: "20123456786",
  razonSocial: "Razon Centinela SRL",
  nombreDeTenant: "Tenant Centinela",
};
const SECRETOS = {
  PEDERNAL_DB_MIGRACIONES:
    "postgres://dueno-centinela:clave-dueno-centinela@host-centinela.test/base",
  PEDERNAL_DB_PLATAFORMA: "postgres://plat-centinela:clave-plat-centinela@host-centinela.test/base",
  PEDERNAL_CLAVE_CONTEXTO: "1:secreto-contexto-centinela",
  PEDERNAL_SECRETO_INVITACIONES: "secreto-invitaciones-centinela",
};
const PROHIBIDOS = [
  ...Object.values(PERSONALES),
  "dueno-centinela",
  "clave-dueno-centinela",
  "plat-centinela",
  "clave-plat-centinela",
  "secreto-contexto-centinela",
  "secreto-invitaciones-centinela",
];

const PAQUETE = {
  adminEmail: PERSONALES.adminEmail,
  vigenteDesde: "2026-11-06T12:00:00-03:00",
  marca: { codigo: "pedernal-pruebas", nombreVisible: "Pedernal Pruebas" },
  plan: {
    codigo: "prueba",
    nombreComercial: "Prueba",
    modulos: ["administracion", "facturacion"],
    perillas: { empresas_por_tenant: { tipo: "LIMITE", limite: 1 } },
  },
  dominio: { host: "app-prueba.pedernal.com.ar", titular: "OPERADOR" },
  empresa: {
    nombreDeTenant: PERSONALES.nombreDeTenant,
    cuit: PERSONALES.cuit,
    razonSocial: PERSONALES.razonSocial,
    zonaHoraria: "America/Argentina/Buenos_Aires",
    moneda: "ARS",
    emailGerente: PERSONALES.emailGerente,
  },
};

type Respuesta = ReturnType<typeof ok> | ReturnType<typeof err>;

function casosFalsos(cambios: Partial<Record<string, Respuesta>> = {}) {
  const llamadas: Array<{ caso: string; entrada: Record<string, unknown> }> = [];
  const porDefecto: Record<string, Respuesta> = {
    crearPlan: ok({ planId: PLAN, yaExistia: false }),
    guardarBorradorDePlan: ok({ borradorId: "b-1", version: 1 }),
    publicarVersionDePlan: ok({ numero: 1 }),
    crearMarca: ok({ marcaId: MARCA, yaExistia: false }),
    guardarBorradorDeMarca: ok({ borradorId: "b-2", version: 4 }),
    confirmarVersionDeMarca: ok({ numero: 1 }),
    agregarDominio: ok({ dominioId: "d-1", yaExistia: false }),
    altaDeEmpresa: ok({
      tenantId: "t-1",
      empresaId: EMPRESA,
      invitacionId: "i-1",
      yaExistia: false,
    }),
    activarModuloDeEmpresa: ok({ yaEstabaActivo: false }),
  };
  const respuestas = { ...porDefecto, ...cambios };
  const casos = Object.fromEntries(
    CASOS_DE_PLATAFORMA.map((caso) => [
      caso,
      (_contexto: unknown, entrada: Record<string, unknown>) => {
        llamadas.push({ caso, entrada });
        return Promise.resolve(respuestas[caso]);
      },
    ]),
  ) as unknown as CasosDeLaLista;
  return { casos, llamadas };
}

function armar(
  opciones: {
    paquete?: unknown;
    entorno?: Record<string, string | undefined>;
    casos?: Partial<Record<string, Respuesta>>;
    admin?: number;
  } = {},
) {
  const salida: string[] = [];
  const errores: string[] = [];
  const comandos: string[] = [];
  const { casos, llamadas } = casosFalsos(opciones.casos);
  const sembrar = vi.fn<EntradaDePreparacion["sembrarAdmin"]>((_email, s) => {
    s.info(
      "RESULTADO: OK, quedó sembrado el administrador de plataforma (ADMIN), identificador x.",
    );
    return Promise.resolve(opciones.admin ?? 0);
  });
  const entrada: EntradaDePreparacion = {
    entorno: {
      ...SECRETOS,
      [VARIABLE_DEL_PAQUETE]: JSON.stringify(opciones.paquete ?? PAQUETE),
      ...opciones.entorno,
    },
    sembrarAdmin: sembrar,
    ejecutarCaso: ejecutorDeCasos({
      entorno: SECRETOS,
      ahora: () => new Date("2026-11-05T12:00:00.000Z"),
      buscarAdmin: () => Promise.resolve({ id: ID_ADMIN, rol: "ADMIN" as const, activo: true }),
      casos: armarCasosDeLaLista({
        casosDeUsoDeMarcasYPlanes: () => casos,
        casosDeUsoDeDominios: () => casos,
        casosDeUsoDeAltas: () => casos,
      } as never),
    }),
    info: (l) => salida.push(l),
    error: (l) => errores.push(l),
    comando: (l) => comandos.push(l),
  };
  return {
    entrada,
    llamadas,
    sembrar,
    comandos,
    salida,
    errores,
    texto: () =>
      [...salida, ...errores, ...comandos.filter((c) => !c.startsWith("::add-mask::"))].join("\n"),
  };
}

describe("preparar la empresa de pruebas: el camino feliz", () => {
  it("siembra al administrador y ejecuta los casos en orden, encadenando los ids", async () => {
    const t = armar();
    expect(await prepararEmpresaDePruebas(t.entrada)).toBe(0);
    expect(t.sembrar).toHaveBeenCalledTimes(1);
    expect(t.sembrar.mock.calls[0]?.[0]).toBe(PERSONALES.adminEmail);
    expect(t.llamadas.map((l) => l.caso)).toEqual([
      "crearPlan",
      "guardarBorradorDePlan",
      "publicarVersionDePlan",
      "crearMarca",
      "guardarBorradorDeMarca",
      "confirmarVersionDeMarca",
      "agregarDominio",
      "altaDeEmpresa",
      "activarModuloDeEmpresa",
    ]);
    const por = (caso: string) => t.llamadas.find((l) => l.caso === caso)?.entrada;
    expect(por("guardarBorradorDePlan")).toMatchObject({ planId: PLAN, versionEsperada: null });
    expect(por("publicarVersionDePlan")).toMatchObject({ planId: PLAN });
    expect(por("guardarBorradorDeMarca")).toMatchObject({
      marcaId: MARCA,
      planPorDefectoId: PLAN,
      versionEsperada: null,
    });
    // La versión que se confirma es la que devolvió el borrador, no un número fijo.
    expect(por("confirmarVersionDeMarca")).toMatchObject({ marcaId: MARCA, versionEsperada: 4 });
    expect(por("agregarDominio")).toMatchObject({
      host: "app-prueba.pedernal.com.ar",
      superficie: "APP",
      esCanonico: true,
      duenio: { tipo: "MARCA", marcaId: MARCA },
    });
    expect(por("altaDeEmpresa")).toMatchObject({ marcaId: MARCA, cuit: PERSONALES.cuit });
    expect(por("activarModuloDeEmpresa")).toMatchObject({
      empresaId: EMPRESA,
      modulo: "facturacion",
    });
    expect(t.errores).toEqual([]);
  });

  it("cada paso lleva una clave de idempotencia fija y distinta", async () => {
    const t = armar();
    await prepararEmpresaDePruebas(t.entrada);
    const claves = t.llamadas.map((l) => l.entrada["claveDeIdempotencia"]);
    expect(new Set(claves).size).toBe(9);
    expect(
      claves.every((c) => typeof c === "string" && /^preparar-prueba-v1-[a-z-]+$/.test(c)),
    ).toBe(true);
  });

  it("idempotencia: repetir la corrida manda exactamente los mismos pedidos (mismas claves y mismos datos)", async () => {
    const primera = armar();
    const segunda = armar({
      casos: {
        crearPlan: ok({ planId: PLAN, yaExistia: true }),
        crearMarca: ok({ marcaId: MARCA, yaExistia: true }),
        altaDeEmpresa: ok({
          tenantId: "t-1",
          empresaId: EMPRESA,
          invitacionId: "i-1",
          yaExistia: true,
        }),
      },
    });
    expect(await prepararEmpresaDePruebas(primera.entrada)).toBe(0);
    expect(await prepararEmpresaDePruebas(segunda.entrada)).toBe(0);
    expect(segunda.llamadas).toEqual(primera.llamadas);
  });
});

describe("preparar la empresa de pruebas: cierra ante la duda", () => {
  it("faltan variables: las nombra (sin valores) y no hace nada", async () => {
    const t = armar({
      entorno: { PEDERNAL_DB_PLATAFORMA: "  ", PEDERNAL_CLAVE_CONTEXTO: undefined },
    });
    expect(await prepararEmpresaDePruebas(t.entrada)).toBe(2);
    expect(t.errores.join("\n")).toContain("PEDERNAL_DB_PLATAFORMA, PEDERNAL_CLAVE_CONTEXTO");
    expect(t.sembrar).not.toHaveBeenCalled();
    expect(t.llamadas).toEqual([]);
    expect(VARIABLES_OBLIGATORIAS).toHaveLength(5);
  });

  it("un dato mal escrito se rechaza ANTES de sembrar nada, sin repetir el valor", async () => {
    const t = armar({
      paquete: { ...PAQUETE, empresa: { ...PAQUETE.empresa, cuit: "20123456785" } },
    });
    expect(await prepararEmpresaDePruebas(t.entrada)).toBe(2);
    expect(t.sembrar).not.toHaveBeenCalled();
    expect(t.llamadas).toEqual([]);
    expect(t.texto()).toContain("altaDeEmpresa");
    expect(t.texto()).not.toContain("20123456785");
  });

  it.each([
    ["JSON roto", "{no es json"],
    ["no es un objeto", "[1]"],
  ])("el paquete %s: código 2 y no hace nada", async (_nombre, texto) => {
    const t = armar({ entorno: { [VARIABLE_DEL_PAQUETE]: texto } });
    expect(await prepararEmpresaDePruebas(t.entrada)).toBe(2);
    expect(t.sembrar).not.toHaveBeenCalled();
    expect(t.llamadas).toEqual([]);
  });

  it("un campo que sobra o falta se rechaza y solo se nombra el campo", () => {
    const leido = leerPaquete(
      JSON.stringify({
        ...PAQUETE,
        extra: 1,
        plan: { ...PAQUETE.plan, modulos: ["administracion"] },
      }),
    );
    expect(leido.ok).toBe(false);
    if (!leido.ok) {
      expect(leido.problemas).toContain("extra: no se esperaba este campo");
      expect(leido.problemas).toContain("plan.modulos: tiene que incluir «facturacion»");
    }
    expect(leerPaquete(undefined).ok).toBe(false);
  });

  it("si el administrador no se siembra, se detiene en el paso 1", async () => {
    const t = armar({ admin: 1 });
    expect(await prepararEmpresaDePruebas(t.entrada)).toBe(1);
    expect(t.llamadas).toEqual([]);
    expect(t.errores.join("\n")).toContain("paso 1");
  });

  it("si un caso rechaza, se detiene ahí: los siguientes no se ejecutan", async () => {
    const t = armar({ casos: { altaDeEmpresa: err("CUIT_DUPLICADO") } });
    expect(await prepararEmpresaDePruebas(t.entrada)).toBe(1);
    expect(t.llamadas.map((l) => l.caso).at(-1)).toBe("altaDeEmpresa");
    expect(t.errores.join("\n")).toContain("Se detuvo en el paso 9");
    expect(t.texto()).not.toContain(PERSONALES.cuit);
  });

  it("si la salida de un caso no trae el id que el siguiente necesita, se detiene", async () => {
    const t = armar({ casos: { crearMarca: ok({ marcaId: "no-es-un-uuid", yaExistia: false }) } });
    expect(await prepararEmpresaDePruebas(t.entrada)).toBe(1);
    expect(t.llamadas.map((l) => l.caso).at(-1)).toBe("crearMarca");
  });
});

describe("preparar la empresa de pruebas: nada sensible sale", () => {
  it.each([
    ["camino feliz", {}],
    ["un rechazo", { casos: { altaDeEmpresa: err("CUIT_DUPLICADO") } }],
    ["falta una variable", { entorno: { PEDERNAL_CLAVE_CONTEXTO: undefined } }],
    [
      "un dato mal escrito",
      { paquete: { ...PAQUETE, empresa: { ...PAQUETE.empresa, cuit: "1" } } },
    ],
  ])("ni secretos ni datos personales en lo que se imprime (%s)", async (_nombre, opciones) => {
    const t = armar(opciones);
    await prepararEmpresaDePruebas(t.entrada);
    const todo = t.texto();
    for (const prohibido of PROHIBIDOS) expect(todo).not.toContain(prohibido);
  });

  it("un valor personal que se cuela en un mensaje queda tapado", async () => {
    const t = armar();
    const sembrarAdmin: EntradaDePreparacion["sembrarAdmin"] = (_email, salida) => {
      salida.error(`falla con ${PERSONALES.emailGerente} y ${PERSONALES.cuit}`);
      return Promise.resolve(1);
    };
    await prepararEmpresaDePruebas({ ...t.entrada, sembrarAdmin });
    for (const dato of [PERSONALES.emailGerente, PERSONALES.cuit]) {
      expect(t.texto()).not.toContain(dato);
    }
  });

  it("en GitHub Actions entrega cada dato personal al runner con ::add-mask::; fuera de Actions, no", async () => {
    const enActions = armar({ entorno: { GITHUB_ACTIONS: "true" } });
    await prepararEmpresaDePruebas(enActions.entrada);
    expect([...enActions.comandos].sort()).toEqual(
      Object.values(PERSONALES)
        .map((v) => `::add-mask::${v}`)
        .sort(),
    );
    const local = armar();
    await prepararEmpresaDePruebas(local.entrada);
    expect(local.comandos).toEqual([]);
  });
});
