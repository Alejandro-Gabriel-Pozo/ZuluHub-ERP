import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  VARIABLES_OBLIGATORIAS_DE_CLIENTE,
  VARIABLE_DEL_PAQUETE_DE_CLIENTE,
  altaDeCliente,
  armarPaqueteDeCliente,
  codigoDelCliente,
  leerPaqueteDeCliente,
  modulosDisponibles,
  ordenarPorRequisitos,
  type EntradaDeAltaDeCliente,
} from "../../scripts/ejecutar-alta-de-cliente";
import {
  armarCasosDeLaLista,
  type CasosDeLaLista,
} from "../../scripts/ejecutar-caso-desde-archivo";
import { ejecutorDeCasos } from "../../scripts/ejecutar-preparar-empresa-de-pruebas";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { CASOS_DE_PLATAFORMA } from "../../src/plataforma/dominio/pedido-de-caso";
import { adminPlataformaId } from "../../src/primitivas/identificadores/marca";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * El alta de un cliente con todo inyectado (sin base ni red): el orden de los pasos, que los ids se encadenan, que repetir manda lo mismo, que un dato mal escrito no deja nada a medias,
 * que los módulos se activan en el orden de sus requisitos y que ni un secreto ni un dato personal llegan a lo que se imprime. Usa el `ejecutarCasoDePlataforma` real.
 */

const ID_ADMIN = adminPlataformaId("aaaaaaaa-0000-4000-8000-000000000001");
const PLAN = "11111111-1111-4111-8111-111111111111";
const MARCA = "22222222-2222-4222-8222-222222222222";
const EMPRESA = "33333333-3333-4333-8333-333333333333";
const DOMINIOS = {
  "app.centinela.test": "44444444-4444-4444-8444-444444444441",
  "carta.centinela.test": "44444444-4444-4444-8444-444444444442",
} as const;
// Un minuto antes de que la marca empiece a regir: la corrida tiene que esperar.
const AHORA_DE_LA_CORRIDA = new Date("2026-11-27T11:59:00-03:00");

const PERSONALES = {
  adminEmail: "admin.centinela@ejemplo.test",
  emailGerente: "gerente.centinela@ejemplo.test",
  cuit: "20123456786",
  razonSocial: "Razon Centinela SRL",
  nombreDeTenant: "Tenant Centinela",
};
const HEX_CENTINELA = "c0ffee".repeat(10) + "abcd";
const SECRETOS = {
  PEDERNAL_DB_MIGRACIONES:
    "postgres://dueno-centinela:clave-dueno-centinela@host-centinela.test/base",
  PEDERNAL_DB_PLATAFORMA: "postgres://plat-centinela:clave-plat-centinela@host-centinela.test/base",
  PEDERNAL_CLAVE_CONTEXTO: "1:secreto-contexto-centinela",
  PEDERNAL_SECRETO_INVITACIONES: HEX_CENTINELA,
  PEDERNAL_HOSTS_PROTEGIDOS: "consola.centinela.test, web.centinela.test",
  PEDERNAL_HOST_DE_LA_BASE: "host-centinela.test",
};
const PROHIBIDOS = [
  ...Object.values(PERSONALES),
  "dueno-centinela",
  "clave-dueno-centinela",
  "plat-centinela",
  "clave-plat-centinela",
  "secreto-contexto-centinela",
  HEX_CENTINELA,
];

const PAQUETE = {
  adminEmail: PERSONALES.adminEmail,
  vigenteDesde: "2026-11-27T12:00:00-03:00",
  marca: { codigo: "hdn", nombreVisible: "Hoteles del Neuquén" },
  plan: {
    codigo: "hdn-completo",
    nombreComercial: "Plan Hoteles del Neuquén",
    perillas: {
      vidriera_por_qr: { tipo: "INTERRUPTOR", encendida: true },
      vidriera_modelo_libro: { tipo: "INTERRUPTOR", encendida: true },
      facturar_antes_de_cobrar: { tipo: "INTERRUPTOR", encendida: false },
    },
  },
  dominios: [
    // La carta primero a propósito: la aplicación tiene que ir antes igual.
    {
      host: "carta.centinela.test",
      superficie: "CARTA",
      titular: "OPERADOR",
      verificadoEn: "2026-11-26T09:00:00-03:00",
    },
    {
      host: "app.centinela.test",
      superficie: "APP",
      titular: "OPERADOR",
      verificadoEn: "2026-11-26T09:00:00-03:00",
    },
  ],
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
    verificarDominio: ok({ estado: "VERIFICADO", yaEstaba: false }),
    activarDominio: ok({ estado: "ACTIVO", yaEstaba: false }),
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
        if (caso === "agregarDominio") {
          const id = DOMINIOS[entrada["host"] as keyof typeof DOMINIOS];
          return Promise.resolve(ok({ dominioId: id, yaExistia: false }));
        }
        return Promise.resolve(respuestas[caso]);
      },
    ]),
  ) as unknown as CasosDeLaLista;
  return { casos, llamadas };
}

/** Lo personal: lo único que viaja en el secreto del Environment. */
const SECRETO = {
  adminEmail: PERSONALES.adminEmail,
  emailGerente: PERSONALES.emailGerente,
  cuit: PERSONALES.cuit,
  razonSocial: PERSONALES.razonSocial,
  nombreDeTenant: PERSONALES.nombreDeTenant,
};
/** Lo que no es personal: el contenido del archivo versionado del cliente (la carta primero a propósito: la aplicación tiene que ir antes igual). */
const ARCHIVO = {
  marca: PAQUETE.marca,
  plan: PAQUETE.plan,
  dominios: PAQUETE.dominios.map(({ host, superficie, titular }) => ({
    host,
    superficie,
    titular,
  })),
  zonaHoraria: PAQUETE.empresa.zonaHoraria,
  moneda: PAQUETE.empresa.moneda,
};

function armar(
  opciones: {
    ambiente?: string | undefined;
    secreto?: unknown;
    archivo?: unknown;
    entorno?: Record<string, string | undefined>;
    casos?: Partial<Record<string, Respuesta>>;
    admin?: number;
    soloValidar?: boolean;
    /** Lecturas sucesivas del reloj: la primera arma el paquete, las siguientes miden la espera (la última se repite). */
    relojes?: Date[];
  } = {},
) {
  const salida: string[] = [];
  const errores: string[] = [];
  const comandos: string[] = [];
  const { casos, llamadas } = casosFalsos(opciones.casos);
  const sembrar = vi.fn<EntradaDeAltaDeCliente["sembrarAdmin"]>((_email, s) => {
    s.info(
      "RESULTADO: OK, quedó sembrado el administrador de plataforma (ADMIN), identificador x.",
    );
    return Promise.resolve(opciones.admin ?? 0);
  });
  const esperas: number[] = [];
  const entrada: EntradaDeAltaDeCliente = {
    ambiente: "ambiente" in opciones ? opciones.ambiente : "cliente-hdn",
    entorno: {
      ...SECRETOS,
      [VARIABLE_DEL_PAQUETE_DE_CLIENTE]: JSON.stringify(opciones.secreto ?? SECRETO),
      ...opciones.entorno,
    },
    sembrarAdmin: sembrar,
    ejecutarCaso: ejecutorDeCasos({
      entorno: SECRETOS,
      ahora: () => new Date("2026-11-27T12:00:00.000Z"),
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
    ahora: () => {
      const lecturas = opciones.relojes ?? [AHORA_DE_LA_CORRIDA];
      return lecturas.length > 1 ? (lecturas.shift() as Date) : (lecturas[0] as Date);
    },
    leerDatosDelCliente: () => opciones.archivo ?? ARCHIVO,
    esperar: (ms) => {
      esperas.push(ms);
      return Promise.resolve();
    },
    ...(opciones.soloValidar === true ? { soloValidar: true } : {}),
  };
  return {
    entrada,
    llamadas,
    sembrar,
    comandos,
    esperas,
    salida,
    errores,
    texto: () =>
      [...salida, ...errores, ...comandos.filter((c) => !c.startsWith("::add-mask::"))].join("\n"),
  };
}

describe("alta de un cliente: el camino feliz", () => {
  it("siembra al administrador y ejecuta los pasos en orden, encadenando los ids (la aplicación antes que la carta)", async () => {
    const t = armar();
    expect(await altaDeCliente(t.entrada)).toBe(0);
    expect(t.sembrar).toHaveBeenCalledTimes(1);
    expect(t.sembrar.mock.calls[0]?.[0]).toBe(PERSONALES.adminEmail);
    const modulos = ordenarPorRequisitos(modulosDisponibles());
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
      "agregarDominio",
      "verificarDominio",
      "activarDominio",
      "altaDeEmpresa",
      ...modulos.map(() => "activarModuloDeEmpresa"),
    ]);
    const por = (caso: string) => t.llamadas.filter((l) => l.caso === caso).map((l) => l.entrada);
    expect(por("guardarBorradorDePlan")[0]).toMatchObject({ planId: PLAN, versionEsperada: null });
    expect(por("guardarBorradorDeMarca")[0]).toMatchObject({
      marcaId: MARCA,
      planPorDefectoId: PLAN,
    });
    // La versión que se confirma es la que devolvió el borrador, no un número fijo.
    expect(por("confirmarVersionDeMarca")[0]).toMatchObject({ marcaId: MARCA, versionEsperada: 4 });
    expect(por("agregarDominio").map((d) => d["host"])).toEqual([
      "app.centinela.test",
      "carta.centinela.test",
    ]);
    expect(por("agregarDominio")[0]).toMatchObject({
      superficie: "APP",
      esCanonico: true,
      titular: "OPERADOR",
      duenio: { tipo: "MARCA", marcaId: MARCA },
    });
    // Cada dominio se verifica y activa con SU id.
    expect(por("verificarDominio").map((d) => d["dominioId"])).toEqual(Object.values(DOMINIOS));
    expect(por("activarDominio").map((d) => d["dominioId"])).toEqual(Object.values(DOMINIOS));
    expect(por("altaDeEmpresa")[0]).toMatchObject({ marcaId: MARCA, cuit: PERSONALES.cuit });
    expect(por("activarModuloDeEmpresa").map((m) => m["modulo"])).toEqual(modulos);
    expect(por("activarModuloDeEmpresa").every((m) => m["empresaId"] === EMPRESA)).toBe(true);
    expect(t.errores).toEqual([]);
  });

  it("por defecto activa TODOS los módulos disponibles del catálogo, y ninguno que no lo esté", () => {
    const esperados = Object.entries(CATALOGO_DE_MODULOS)
      .filter(([, definicion]) => definicion.estado === "disponible")
      .map(([clave]) => clave)
      .sort();
    expect([...modulosDisponibles()].sort()).toEqual(esperados);
    const leido = leerPaqueteDeCliente(JSON.stringify(PAQUETE));
    expect(leido.ok && [...leido.paquete.plan.modulos].sort()).toEqual(esperados);
  });

  it("cada módulo se activa DESPUÉS de los que requiere", () => {
    const orden = ordenarPorRequisitos(modulosDisponibles());
    expect(new Set(orden).size).toBe(orden.length);
    expect(orden.length).toBe(modulosDisponibles().length);
    for (const [indice, modulo] of orden.entries()) {
      const requiere =
        (CATALOGO_DE_MODULOS as Record<string, { requiere?: readonly string[] }>)[modulo]
          ?.requiere ?? [];
      for (const requerido of requiere) {
        expect(orden.indexOf(requerido)).toBeGreaterThanOrEqual(0);
        expect(orden.indexOf(requerido)).toBeLessThan(indice);
      }
    }
    // Aunque lleguen al revés.
    expect(ordenarPorRequisitos(["stock", "catalogo"])).toEqual(["catalogo", "stock"]);
  });

  it("cada paso lleva una clave de idempotencia fija, distinta y con el código del cliente", async () => {
    const t = armar();
    await altaDeCliente(t.entrada);
    const claves = t.llamadas.map((l) => l.entrada["claveDeIdempotencia"]);
    expect(new Set(claves).size).toBe(claves.length);
    expect(
      claves.every((c) => typeof c === "string" && /^alta-cliente-v1-hdn-[a-z-_]+$/.test(c)),
    ).toBe(true);
  });

  it("idempotencia: repetir la corrida manda exactamente los mismos pedidos", async () => {
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
        activarModuloDeEmpresa: ok({ yaEstabaActivo: true }),
      },
    });
    expect(await altaDeCliente(primera.entrada)).toBe(0);
    expect(await altaDeCliente(segunda.entrada)).toBe(0);
    expect(segunda.llamadas).toEqual(primera.llamadas);
  });

  it("vigenteDesde y verificadoEn los pone el flujo: la marca rige 6 minutos después de la corrida y los dominios se verifican en el instante de la corrida", async () => {
    const t = armar();
    await altaDeCliente(t.entrada);
    const por = (caso: string) => t.llamadas.filter((l) => l.caso === caso).map((l) => l.entrada);
    expect(por("confirmarVersionDeMarca")[0]?.["vigenteDesde"]).toEqual(
      new Date(AHORA_DE_LA_CORRIDA.getTime() + 6 * 60_000),
    );
    expect(por("verificarDominio").map((d) => d["verificadoEn"])).toEqual([
      AHORA_DE_LA_CORRIDA,
      AHORA_DE_LA_CORRIDA,
    ]);
  });

  it("espera a que la marca rija antes del alta de la empresa, y no antes", async () => {
    const t = armar();
    await altaDeCliente(t.entrada);
    expect(t.esperas).toHaveLength(1);
    // Seis minutos de diferencia más el margen.
    expect(t.esperas[0]).toBeGreaterThan(5 * 60_000);
    const yaRige = armar({
      relojes: [AHORA_DE_LA_CORRIDA, new Date(AHORA_DE_LA_CORRIDA.getTime() + 30 * 60_000)],
    });
    expect(await altaDeCliente(yaRige.entrada)).toBe(0);
    expect(yaRige.esperas).toEqual([]);
  });

  it("repetir en otra corrida (otro instante): lo que la clave de idempotencia rechaza por el instante es «ya hecho» y se sigue sin esperar de nuevo", async () => {
    const t = armar({
      casos: {
        confirmarVersionDeMarca: err("CLAVE_REUTILIZADA"),
        verificarDominio: err("CLAVE_REUTILIZADA"),
      },
    });
    expect(await altaDeCliente(t.entrada)).toBe(0);
    expect(t.esperas).toEqual([]);
    expect(t.texto()).toContain("ya se hizo en una corrida anterior");
    expect(t.llamadas.some((l) => l.caso === "altaDeEmpresa")).toBe(true);
  });

  it("pero CLAVE_REUTILIZADA en un paso que NO depende del instante sigue cortando", async () => {
    const t = armar({ casos: { crearMarca: err("CLAVE_REUTILIZADA") } });
    expect(await altaDeCliente(t.entrada)).toBe(1);
  });
});

describe("alta de un cliente: el secreto solo trae lo personal y el archivo lo demás", () => {
  const ahora = new Date("2026-11-27T12:00:00.000Z");
  const problemas = (secreto: unknown, archivo: unknown = ARCHIVO) => {
    const r = armarPaqueteDeCliente(JSON.stringify(secreto), archivo, ahora);
    return r.ok ? [] : r.problemas.join("\n");
  };

  it("arma el paquete completo con las tres fuentes", () => {
    const r = armarPaqueteDeCliente(JSON.stringify(SECRETO), ARCHIVO, ahora);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.paquete.vigenteDesde).toBe("2026-11-27T12:06:00.000Z");
      expect(r.paquete.empresa.zonaHoraria).toBe("America/Argentina/Buenos_Aires");
      expect(r.paquete.empresa.cuit).toBe(PERSONALES.cuit);
      expect(r.paquete.dominios.every((d) => d.verificadoEn === ahora.toISOString())).toBe(true);
    }
  });

  it.each(["vigenteDesde", "marca", "plan", "dominios", "zonaHoraria", "moneda"])(
    "el secreto no puede traer «%s» (sobra) y no repite el valor",
    (campo) => {
      const texto = problemas({ ...SECRETO, [campo]: "valor-centinela" });
      expect(texto).toContain(`${campo}: no se esperaba este campo`);
      expect(texto).not.toContain("valor-centinela");
    },
  );

  it.each(["adminEmail", "emailGerente", "cuit", "razonSocial", "nombreDeTenant"])(
    "al secreto le falta «%s»: se rechaza nombrando el campo",
    (campo) => {
      const sin: Record<string, unknown> = { ...SECRETO };
      delete sin[campo];
      expect(problemas(sin)).toContain(`${campo}: falta o no es un texto`);
    },
  );

  it.each(["adminEmail", "emailGerente", "cuit", "vigenteDesde", "empresa", "extra"])(
    "el archivo del cliente no puede traer «%s» (lo personal y lo que calcula el flujo no van ahí)",
    (campo) => {
      expect(problemas(SECRETO, { ...ARCHIVO, [campo]: "x" })).toContain(
        `${campo}: no se esperaba este campo`,
      );
    },
  );

  it("el archivo no puede fijar verificadoEn en un dominio ni dejar de traer una sección", () => {
    const conVerificado = {
      ...ARCHIVO,
      dominios: [
        { ...ARCHIVO.dominios[0], verificadoEn: "2020-01-01T00:00:00Z" },
        ARCHIVO.dominios[1],
      ],
    };
    expect(problemas(SECRETO, conVerificado)).toContain("verificadoEn: no se esperaba este campo");
    const sinMoneda: Record<string, unknown> = { ...ARCHIVO };
    delete sinMoneda["moneda"];
    expect(problemas(SECRETO, sinMoneda)).toContain("moneda: falta");
    expect(problemas(SECRETO, "no es un objeto")).toContain("archivo del cliente");
  });

  it("el archivo real de hdn (scripts/clientes/hdn.json) es válido con un secreto de relleno", () => {
    const archivo: unknown = JSON.parse(
      readFileSync(join(import.meta.dirname, "../../scripts/clientes/hdn.json"), "utf8"),
    );
    expect(problemas(SECRETO, archivo)).toEqual([]);
  });
});

describe("alta de un cliente: cierra ante la duda", () => {
  it("un ambiente que no es un cliente de la lista cerrada: código 2 y no hace nada", async () => {
    for (const ambiente of [undefined, "preview", "produccion", "cliente-otro", "__proto__"]) {
      const t = armar({ ambiente });
      expect(await altaDeCliente(t.entrada)).toBe(2);
      expect(t.sembrar).not.toHaveBeenCalled();
      expect(t.llamadas).toEqual([]);
    }
    expect(codigoDelCliente("cliente-hdn")).toBe("hdn");
    expect(codigoDelCliente("production")).toBeNull();
  });

  it("faltan variables: las nombra (sin valores) y no hace nada", async () => {
    const t = armar({
      entorno: { PEDERNAL_DB_PLATAFORMA: "  ", PEDERNAL_SECRETO_INVITACIONES: undefined },
    });
    expect(await altaDeCliente(t.entrada)).toBe(2);
    expect(t.errores.join("\n")).toContain("PEDERNAL_DB_PLATAFORMA, PEDERNAL_SECRETO_INVITACIONES");
    expect(t.sembrar).not.toHaveBeenCalled();
    expect(t.llamadas).toEqual([]);
    expect(VARIABLES_OBLIGATORIAS_DE_CLIENTE).toHaveLength(7);
  });

  it("candado de host: la cadena de otra base (o sin host declarado) no recibe nada", async () => {
    for (const entorno of [
      { PEDERNAL_DB_MIGRACIONES: "postgres://u:p@otro-host.test/base" },
      { PEDERNAL_HOST_DE_LA_BASE: undefined },
      { PEDERNAL_HOST_DE_LA_BASE: "otro-host.test" },
    ]) {
      const t = armar({ entorno });
      expect(await altaDeCliente(t.entrada)).toBe(2);
      expect(t.sembrar).not.toHaveBeenCalled();
      expect(t.llamadas).toEqual([]);
      expect(t.texto()).not.toContain("otro-host.test");
    }
  });

  it("candado de host: una cadena con host, hostaddr o port en la query (pisan el host de la URL) se rechaza", async () => {
    for (const parametro of [
      "host=otro.test",
      "hostaddr=10.0.0.1",
      "port=5433",
      "HOST=otro.test",
    ]) {
      const t = armar({
        entorno: { PEDERNAL_DB_MIGRACIONES: `${SECRETOS.PEDERNAL_DB_MIGRACIONES}?${parametro}` },
      });
      expect(await altaDeCliente(t.entrada)).toBe(2);
      expect(t.sembrar).not.toHaveBeenCalled();
      expect(t.llamadas).toEqual([]);
    }
  });

  it("el administrador y el gerente con el mismo email: se rechaza antes de sembrar nada", async () => {
    const t = armar({
      secreto: { ...SECRETO, emailGerente: PERSONALES.adminEmail.toUpperCase() },
    });
    expect(await altaDeCliente(t.entrada)).toBe(2);
    expect(t.sembrar).not.toHaveBeenCalled();
    expect(t.llamadas).toEqual([]);
    expect(t.texto()).toContain("DISTINTOS");
    expect(t.texto()).not.toContain(PERSONALES.adminEmail);
  });

  it("un dato mal escrito se rechaza ANTES de sembrar nada, sin repetir el valor", async () => {
    const t = armar({
      secreto: { ...SECRETO, cuit: "20123456785" },
    });
    expect(await altaDeCliente(t.entrada)).toBe(2);
    expect(t.sembrar).not.toHaveBeenCalled();
    expect(t.llamadas).toEqual([]);
    expect(t.texto()).toContain("alta-de-empresa");
    expect(t.texto()).not.toContain("20123456785");
  });

  it.each([
    ["JSON roto", "{no es json"],
    ["no es un objeto", "[1]"],
  ])("el paquete %s: código 2 y no hace nada", async (_nombre, texto) => {
    const t = armar({ entorno: { [VARIABLE_DEL_PAQUETE_DE_CLIENTE]: texto } });
    expect(await altaDeCliente(t.entrada)).toBe(2);
    expect(t.sembrar).not.toHaveBeenCalled();
    expect(t.llamadas).toEqual([]);
  });

  it("dominios mal armados: repetidos, sin aplicación, dos aplicaciones, superficie no permitida", () => {
    const dominio = (host: string, superficie: string) => ({
      host,
      superficie,
      titular: "OPERADOR",
      verificadoEn: "2026-11-26T09:00:00-03:00",
    });
    const con = (dominios: unknown) =>
      leerPaqueteDeCliente(JSON.stringify({ ...PAQUETE, dominios }));
    const problemas = (r: ReturnType<typeof con>) => (r.ok ? [] : r.problemas.join("\n"));
    expect(problemas(con([dominio("a.test", "APP"), dominio("A.test", "CARTA")]))).toContain(
      "repetidos",
    );
    expect(problemas(con([dominio("c.test", "CARTA")]))).toContain("exactamente un dominio");
    expect(problemas(con([dominio("a.test", "APP"), dominio("b.test", "APP")]))).toContain(
      "exactamente un dominio",
    );
    expect(problemas(con([dominio("a.test", "APP"), dominio("l.test", "LANDING")]))).toContain(
      "superficie",
    );
    expect(problemas(con([]))).toContain("al menos un dominio");
  });

  it("un campo que sobra se rechaza y solo se nombra el campo", () => {
    const leido = leerPaqueteDeCliente(JSON.stringify({ ...PAQUETE, extra: 1 }));
    expect(leido.ok).toBe(false);
    if (!leido.ok) expect(leido.problemas).toContain("extra: no se esperaba este campo");
    expect(leerPaqueteDeCliente(undefined).ok).toBe(false);
  });

  it("si el administrador no se siembra, se detiene en el paso 1", async () => {
    const t = armar({ admin: 1 });
    expect(await altaDeCliente(t.entrada)).toBe(1);
    expect(t.llamadas).toEqual([]);
  });

  it("un paso rechazado detiene el alta y no sigue con los siguientes", async () => {
    const t = armar({ casos: { crearMarca: err("CODIGO_YA_EXISTE") } });
    expect(await altaDeCliente(t.entrada)).toBe(1);
    expect(t.llamadas.map((l) => l.caso)).toEqual([
      "crearPlan",
      "guardarBorradorDePlan",
      "publicarVersionDePlan",
      "crearMarca",
    ]);
    expect(t.errores.join("\n")).toContain("crear-marca");
  });

  it("si la salida no trae el id que necesita el paso siguiente, se detiene", async () => {
    const t = armar({ casos: { crearPlan: ok({ yaExistia: false }) } });
    expect(await altaDeCliente(t.entrada)).toBe(1);
    expect(t.llamadas.map((l) => l.caso)).toEqual(["crearPlan"]);
  });

  it("`--validar` revisa todo sin sembrar ni ejecutar nada y no exige las variables de la corrida completa", async () => {
    const t = armar({
      soloValidar: true,
      entorno: {
        PEDERNAL_DB_PLATAFORMA: undefined,
        PEDERNAL_CLAVE_CONTEXTO: undefined,
        PEDERNAL_SECRETO_INVITACIONES: undefined,
      },
    });
    expect(await altaDeCliente(t.entrada)).toBe(0);
    expect(t.sembrar).not.toHaveBeenCalled();
    expect(t.llamadas).toEqual([]);
    const malo = armar({
      soloValidar: true,
      secreto: { ...SECRETO, cuit: "20123456785" },
    });
    expect(await altaDeCliente(malo.entrada)).toBe(2);
  });
});

describe("alta de un cliente: nada sensible sale", () => {
  it("ni un secreto ni un dato personal aparecen en lo que se imprime (corrida completa, rechazada y de validación)", async () => {
    for (const opciones of [
      {},
      { casos: { altaDeEmpresa: err("EMPRESA_YA_EXISTE") } },
      { soloValidar: true },
      { secreto: { ...SECRETO, cuit: "20123456785" } },
    ] as const) {
      const t = armar(opciones);
      await altaDeCliente(t.entrada);
      const texto = t.texto();
      for (const prohibido of PROHIBIDOS) expect(texto).not.toContain(prohibido);
    }
  });

  it("los datos personales se entregan al runner para taparlos (::add-mask::) solo dentro de GitHub Actions", async () => {
    const enActions = armar({ entorno: { GITHUB_ACTIONS: "true" } });
    await altaDeCliente(enActions.entrada);
    for (const dato of Object.values(PERSONALES)) {
      expect(enActions.comandos).toContain(`::add-mask::${dato}`);
    }
    const local = armar();
    await altaDeCliente(local.entrada);
    expect(local.comandos).toEqual([]);
  });
});
