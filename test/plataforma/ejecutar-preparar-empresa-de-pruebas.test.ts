import { describe, expect, it, vi } from "vitest";
import {
  VARIABLES_OBLIGATORIAS,
  VARIABLE_DEL_PAQUETE,
  ejecutorDeCasos,
  leerPaquete,
  prepararEmpresaDePruebas,
  urlDelCron,
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
const DOMINIO = "44444444-4444-4444-8444-444444444444";
const EMPRESA = "33333333-3333-4333-8333-333333333333";

// Valores inventados y reconocibles: ninguno puede aparecer en lo que se imprime.
const PERSONALES = {
  adminEmail: "admin.centinela@ejemplo.test",
  emailGerente: "gerente.centinela@ejemplo.test",
  cuit: "20123456786",
  razonSocial: "Razon Centinela SRL",
  nombreDeTenant: "Tenant Centinela",
};
// 64 dígitos hexadecimales (la forma que exige el secreto de invitaciones) y reconocibles.
const HEX_CENTINELA = "c0ffee".repeat(10) + "abcd";
const SECRETOS = {
  PEDERNAL_DB_MIGRACIONES:
    "postgres://dueno-centinela:clave-dueno-centinela@host-centinela.test/base",
  PEDERNAL_DB_PLATAFORMA: "postgres://plat-centinela:clave-plat-centinela@host-centinela.test/base",
  PEDERNAL_CLAVE_CONTEXTO: "1:secreto-contexto-centinela",
  PEDERNAL_SECRETO_INVITACIONES: HEX_CENTINELA,
  CRON_SECRET: "cron-centinela-0123456789abcdef",
};
const PROHIBIDOS = [
  ...Object.values(PERSONALES),
  "dueno-centinela",
  "clave-dueno-centinela",
  "plat-centinela",
  "clave-plat-centinela",
  "secreto-contexto-centinela",
  HEX_CENTINELA,
  "cron-centinela-0123456789abcdef",
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
  dominio: {
    host: "app-prueba.pedernal.com.ar",
    titular: "OPERADOR",
    verificadoEn: "2026-11-05T09:00:00-03:00",
  },
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
    agregarDominio: ok({ dominioId: DOMINIO, yaExistia: false }),
    verificarDominio: ok({ dominioId: DOMINIO, estado: "VERIFICADO", yaEstaba: false }),
    activarDominio: ok({ dominioId: DOMINIO, estado: "ACTIVO", yaEstaba: false }),
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
    soloValidar?: boolean;
    cola?: number | null;
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
  const despachos: Array<{ url: string; secreto: string }> = [];
  const despachar: EntradaDePreparacion["despacharCola"] = (url, secreto) => {
    despachos.push({ url, secreto });
    return Promise.resolve(opciones.cola === undefined ? 200 : opciones.cola);
  };
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
    despacharCola: despachar,
    ...(opciones.soloValidar === true ? { soloValidar: true } : {}),
  };
  return {
    entrada,
    llamadas,
    sembrar,
    comandos,
    despachos,
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
      "verificarDominio",
      "activarDominio",
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
    expect(new Set(claves).size).toBe(11);
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
    expect(VARIABLES_OBLIGATORIAS).toHaveLength(6);
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
    expect(t.errores.join("\n")).toContain("Se detuvo en el paso 11");
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

describe("preparar la empresa de pruebas: secretos del dueño, validación previa y cola", () => {
  it("--validar revisa todo sin tocar ninguna base y sin exigir las variables del rol de plataforma", async () => {
    const t = armar({
      soloValidar: true,
      entorno: { PEDERNAL_DB_PLATAFORMA: undefined, PEDERNAL_CLAVE_CONTEXTO: undefined },
    });
    expect(await prepararEmpresaDePruebas(t.entrada)).toBe(0);
    expect(t.sembrar).not.toHaveBeenCalled();
    expect(t.llamadas).toEqual([]);
    expect(t.despachos).toEqual([]);
  });

  it("--validar también rechaza un dato mal escrito", async () => {
    const t = armar({
      soloValidar: true,
      paquete: { ...PAQUETE, empresa: { ...PAQUETE.empresa, cuit: "20123456785" } },
    });
    expect(await prepararEmpresaDePruebas(t.entrada)).toBe(2);
  });

  it.each([
    [
      "el secreto de invitaciones no es hexadecimal",
      { PEDERNAL_SECRETO_INVITACIONES: "no-es-hexa" },
      "PEDERNAL_SECRETO_INVITACIONES",
    ],
    [
      "el secreto de invitaciones es corto",
      { PEDERNAL_SECRETO_INVITACIONES: "abcd" },
      "PEDERNAL_SECRETO_INVITACIONES",
    ],
    ["el CRON_SECRET es corto", { CRON_SECRET: "corto-pero-variado-123" }, "CRON_SECRET"],
    ["el CRON_SECRET repite un solo carácter", { CRON_SECRET: "a".repeat(40) }, "CRON_SECRET"],
    ["falta el CRON_SECRET", { CRON_SECRET: undefined }, "CRON_SECRET"],
  ])("%s: se rechaza antes de empezar, sin repetir el valor", async (_nombre, entorno, nombre) => {
    const t = armar({ entorno });
    expect(await prepararEmpresaDePruebas(t.entrada)).toBe(2);
    expect(t.errores.join("\n")).toContain(nombre);
    expect(t.sembrar).not.toHaveBeenCalled();
    expect(t.llamadas).toEqual([]);
    for (const valor of Object.values(entorno)) {
      if (valor !== undefined) expect(t.texto()).not.toContain(valor);
    }
  });

  it("el administrador y el gerente con el mismo email se rechazan, y el mensaje lo explica", async () => {
    const t = armar({
      paquete: {
        ...PAQUETE,
        empresa: { ...PAQUETE.empresa, emailGerente: PERSONALES.adminEmail.toUpperCase() },
      },
    });
    expect(await prepararEmpresaDePruebas(t.entrada)).toBe(2);
    expect(t.errores.join("\n")).toContain("DISTINTOS");
    expect(t.llamadas).toEqual([]);
  });

  it("al terminar bien pega UNA vez al cron de la app con el secreto, y el secreto no se imprime", async () => {
    const t = armar();
    expect(await prepararEmpresaDePruebas(t.entrada)).toBe(0);
    expect(t.despachos).toEqual([
      {
        url: "https://app-prueba.pedernal.com.ar/api/trabajos/cron",
        secreto: "cron-centinela-0123456789abcdef",
      },
    ]);
    expect(t.texto()).toContain("Cola despachada");
  });

  it.each([
    ["responde 401", 401, "401"],
    ["no responde", null, "no respondió"],
    ["responde 500", 500, "500"],
  ])(
    "si el cron %s, lo avisa y NO falla lo ya sembrado (código 0)",
    async (_nombre, cola, texto) => {
      const t = armar({ cola });
      expect(await prepararEmpresaDePruebas(t.entrada)).toBe(0);
      expect(t.errores.join("\n")).toContain(texto);
      expect(t.errores.join("\n")).toContain("ENCOLADO");
    },
  );

  it("si un paso falla, NO se pega al cron", async () => {
    const t = armar({ casos: { altaDeEmpresa: err("CUIT_DUPLICADO") } });
    expect(await prepararEmpresaDePruebas(t.entrada)).toBe(1);
    expect(t.despachos).toEqual([]);
  });

  it("la dirección del cron solo se arma con un host de verdad", () => {
    expect(urlDelCron("app-prueba.pedernal.com.ar")).toBe(
      "https://app-prueba.pedernal.com.ar/api/trabajos/cron",
    );
    for (const malo of [
      "",
      "a.com/x",
      "a.com:8080",
      "u@a.com",
      "a.com?x=1",
      "a b.com",
      "otro.com#",
    ]) {
      expect(urlDelCron(malo)).toBeNull();
    }
  });
});
