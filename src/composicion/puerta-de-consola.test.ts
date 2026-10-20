import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { CATALOGO_DE_PLATAFORMA } from "../capacidades/permisos/plataforma";
import { exigeSegundoFactorReciente } from "../capacidades/permisos/segundo-factor-reciente";
import type { ContextoDePlataforma } from "../contexto/contexto";
import { DECLARACIONES_DE_ALTAS } from "../plataforma/casos-de-uso/altas";
import { DECLARACIONES_DE_DOMINIOS } from "../plataforma/casos-de-uso/dominios";
import { DECLARACIONES_DE_MARCAS_Y_PLANES } from "../plataforma/casos-de-uso/marcas-y-planes";
import { DECLARACIONES_DE_SOPORTE } from "../plataforma/casos-de-uso/soporte";
import { DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA } from "../plataforma/consultas/declaraciones";
import { DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES } from "../plataforma/consultas/declaraciones-de-marcas-y-planes";
import { adminPlataformaId, usuarioAuthId } from "../primitivas/identificadores/marca";
import { ok } from "../primitivas/resultado/resultado";
import type { SesionAutenticada } from "../puertos/autenticacion";
import {
  ACCIONES_DE_LA_CONSOLA,
  armarPuertaDeConsola,
  crearPuertaDeConsola,
  type AccesoDeConsola,
  type PlataformaParaLaConsola,
} from "./puerta-de-consola";

/**
 * La puerta de la consola con una puerta de plataforma de MENTIRA (una función espía por cada caso y consulta): se
 * prueba que cada nombre que ofrece comprueba el segundo factor reciente de SU acción ANTES de correr, y que lo que corre
 * recibe el contexto que armó la sesión. Con la base real, en `test/integracion/consola-puerta-de-sesion.test.ts`.
 */

const MINUTO = 60_000;
const AHORA = new Date("2026-10-20T12:00:00.000Z");
const hace = (ms: number) => new Date(AHORA.getTime() - ms);
const HOST = "consola.example.test";
const ADMIN_ID = adminPlataformaId("aaaaaaaa-0000-4000-8000-000000000021");

const sesion = (segundoFactorEn: Date | null): SesionAutenticada => ({
  usuarioAuth: usuarioAuthId("bbbbbbbb-0000-4000-8000-000000000002"),
  email: "admin@dominio-de-prueba.test",
  emailVerificado: true,
  creadaEn: hace(20 * MINUTO),
  ultimoUso: hace(1 * MINUTO),
  venceEn: new Date(AHORA.getTime() + 29 * MINUTO),
  host: HOST,
  segundoFactorEn,
  segundoFactorEnrolado: true,
  cookiesDeRespuesta: [],
});

/** Los 20 nombres de caso que exigen el segundo factor reciente: los 19 del dueño (planes.asignar sirve a dos casos). */
const CASOS_QUE_LO_EXIGEN = [
  "activarDominio",
  "activarModuloDeEmpresa",
  "agregarDominio",
  "ajustarPerilla",
  "altaDeEmpresa",
  "asignarPlan",
  "cancelarAlta",
  "confirmarVersionDeMarca",
  "desactivarDominio",
  "desactivarModuloDeEmpresa",
  "migrarTenantsDeVersion",
  "publicarVersionDePlan",
  "reactivarEmpresa",
  "reactivarPersona",
  "reactivarTenant",
  "retirarDominio",
  "suspenderEmpresa",
  "suspenderPersona",
  "suspenderTenant",
  "verificarDominio",
] as const;

/** Lo que el dueño dijo que NO lo exige y es un caso (no una lectura). */
const CASOS_QUE_NO_LO_EXIGEN = [
  "crearMarca",
  "guardarBorradorDeMarca",
  "crearPlan",
  "guardarBorradorDePlan",
  "reenviarInvitacionDelAlta",
  "revocarInvitacionDelAlta",
  "explicarPorQue",
] as const;

const GRUPOS_DE_CASOS = [
  ["casosDeUsoDeAltas", DECLARACIONES_DE_ALTAS],
  ["casosDeUsoDeDominios", DECLARACIONES_DE_DOMINIOS],
  ["casosDeUsoDeMarcasYPlanes", DECLARACIONES_DE_MARCAS_Y_PLANES],
  ["casosDeUsoDeSoporte", DECLARACIONES_DE_SOPORTE],
] as const;
const GRUPOS_DE_CONSULTAS = [
  ["consultasDePlataforma", DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA],
  ["consultasDeMarcasYPlanes", DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES],
] as const;

/** Una puerta de plataforma de mentira: cada nombre es un espía que devuelve un resultado reconocible. */
function plataformaDeMentira() {
  const espias = new Map<string, ReturnType<typeof vi.fn>>();
  for (const [, declaraciones] of [...GRUPOS_DE_CASOS, ...GRUPOS_DE_CONSULTAS]) {
    for (const funcion of Object.keys(declaraciones)) {
      espias.set(
        funcion,
        vi.fn((...args: [ContextoDePlataforma, ...unknown[]]) => {
          void args;
          return Promise.resolve(ok(`hecho:${funcion}`));
        }),
      );
    }
  }
  const armados: string[] = [];
  const grupo = (nombre: string, declaraciones: object) => () => {
    armados.push(nombre);
    return Object.fromEntries(Object.keys(declaraciones).map((f) => [f, espias.get(f)]));
  };
  const plataforma = {
    buscarAdmin: vi.fn(() =>
      Promise.resolve({ id: ADMIN_ID, rol: "ADMIN" as const, activo: true }),
    ),
    cerrar: vi.fn(() => Promise.resolve()),
    ...Object.fromEntries(
      [...GRUPOS_DE_CASOS, ...GRUPOS_DE_CONSULTAS].map(([nombre, d]) => [nombre, grupo(nombre, d)]),
    ),
  } as unknown as PlataformaParaLaConsola;
  return { plataforma, espias, armados };
}

async function acceso(segundoFactorEn: Date | null) {
  const mundo = plataformaDeMentira();
  const puerta = crearPuertaDeConsola(mundo.plataforma, {
    hostDeLaConsola: HOST,
    reloj: () => AHORA,
  });
  const r = await puerta.conSesion(sesion(segundoFactorEn));
  if (!r.ok) throw new Error(`tenía que dar acceso: ${r.error}`);
  return { ...mundo, acceso: r.valor, puerta };
}

const llamar = (
  a: AccesoDeConsola,
  clase: "casos" | "consultas",
  nombre: string,
  ...argumentos: unknown[]
): Promise<unknown> =>
  (a[clase] as unknown as Record<string, (...x: unknown[]) => Promise<unknown>>)[nombre]!(
    ...argumentos,
  );

describe("lo que la consola ofrece", () => {
  const casos = Object.keys(ACCIONES_DE_LA_CONSOLA.casos).sort();
  const consultas = Object.keys(ACCIONES_DE_LA_CONSOLA.consultas).sort();

  it("ofrece todos los casos con guard y ninguno sin guard (el barrido del sistema y la referencia de error no se ofrecen)", () => {
    expect(casos).toEqual([...CASOS_QUE_LO_EXIGEN, ...CASOS_QUE_NO_LO_EXIGEN].sort());
    expect(casos).not.toContain("cancelarAltasVencidas");
    expect(casos).not.toContain("registrarReferenciaDeError");
  });

  it("ofrece las 19 consultas, todas de lectura", () => {
    expect(consultas).toHaveLength(19);
    for (const [nombre, accion] of Object.entries(ACCIONES_DE_LA_CONSOLA.consultas)) {
      expect(CATALOGO_DE_PLATAFORMA.plataforma.acciones[accion].efecto, nombre).toBe("LECTURA");
    }
  });

  it("ningún nombre se repite entre casos y consultas, ni dentro de ellos (uno taparía a otro)", () => {
    const cuenta = [...GRUPOS_DE_CASOS, ...GRUPOS_DE_CONSULTAS].flatMap(([, d]) =>
      Object.keys(d),
    ).length;
    expect(new Set([...casos, ...consultas]).size).toBe(cuenta - 2 /* los dos sin guard */);
  });

  it("cada nombre apunta a una acción que EXISTE en el catálogo, y cada acción del catálogo la ofrece algún nombre", () => {
    const delCatalogo = Object.keys(CATALOGO_DE_PLATAFORMA.plataforma.acciones).sort();
    const ofrecidas = new Set<string>([
      ...Object.values(ACCIONES_DE_LA_CONSOLA.casos),
      ...Object.values(ACCIONES_DE_LA_CONSOLA.consultas),
    ]);
    for (const accion of ofrecidas) expect(delCatalogo).toContain(accion);
    expect([...ofrecidas].sort()).toEqual(delCatalogo);
  });

  it("los casos que exigen el segundo factor reciente son los 20 que corresponden a la lista del dueño", () => {
    const quienes = Object.entries(ACCIONES_DE_LA_CONSOLA.casos)
      .filter(([, accion]) => exigeSegundoFactorReciente(accion))
      .map(([nombre]) => nombre)
      .sort();
    expect(quienes).toEqual([...CASOS_QUE_LO_EXIGEN].sort());
    for (const accion of Object.values(ACCIONES_DE_LA_CONSOLA.consultas)) {
      expect(exigeSegundoFactorReciente(accion)).toBe(false);
    }
  });

  it("asignar plan y migrar tenants de versión comparten la misma acción", () => {
    expect(ACCIONES_DE_LA_CONSOLA.casos["asignarPlan"]).toBe("planes.asignar");
    expect(ACCIONES_DE_LA_CONSOLA.casos["migrarTenantsDeVersion"]).toBe("planes.asignar");
  });

  it("los tipos: el caso se llama sin contexto y los sin guard no existen", () => {
    expectTypeOf<AccesoDeConsola["casos"]>().toHaveProperty("suspenderPersona");
    expectTypeOf<AccesoDeConsola["casos"]>().not.toHaveProperty("cancelarAltasVencidas");
    expectTypeOf<AccesoDeConsola["casos"]>().not.toHaveProperty("registrarReferenciaDeError");
    expectTypeOf<AccesoDeConsola["casos"]>().not.toHaveProperty("listarTenants");
    expectTypeOf<AccesoDeConsola["consultas"]>().toHaveProperty("listarTenants");
    expectTypeOf<AccesoDeConsola["consultas"]>().not.toHaveProperty("suspenderPersona");
    type Suspender = AccesoDeConsola["casos"]["suspenderPersona"];
    expectTypeOf<Parameters<Suspender>>().toEqualTypeOf<
      [
        entrada: Readonly<{
          claveDeIdempotencia: string;
          personaId: string;
          motivo: string;
        }>,
      ]
    >();
  });
});

describe("el segundo factor reciente, antes de correr el caso", () => {
  const todos = [
    ...Object.entries(ACCIONES_DE_LA_CONSOLA.casos).map(([n, a]) => ["casos", n, a] as const),
    ...Object.entries(ACCIONES_DE_LA_CONSOLA.consultas).map(
      ([n, a]) => ["consultas", n, a] as const,
    ),
  ];

  it.each(todos)(
    "%s %s con el segundo factor de hace 2 minutos: corre con el contexto de la sesión",
    async (clase, nombre) => {
      const m = await acceso(hace(2 * MINUTO));
      const entrada = { dato: nombre };
      const r = await llamar(m.acceso, clase, nombre, entrada);
      expect(r).toEqual(ok(`hecho:${nombre}`));
      const espia = m.espias.get(nombre)!;
      expect(espia).toHaveBeenCalledExactlyOnceWith(
        { tipo: "PLATAFORMA", actor: { tipo: "ADMIN", id: ADMIN_ID }, ahora: AHORA },
        entrada,
      );
    },
  );

  it.each(todos)(
    "%s %s con el segundo factor de hace 6 minutos: lo exige solo si su acción está marcada",
    async (clase, nombre, accion) => {
      const m = await acceso(hace(6 * MINUTO));
      const r = await llamar(m.acceso, clase, nombre, { dato: 1 });
      const espia = m.espias.get(nombre)!;
      if (exigeSegundoFactorReciente(accion)) {
        expect(r).toEqual({ ok: false, error: "segundo_factor_reciente_requerido" });
        expect(espia).not.toHaveBeenCalled();
        // Ni siquiera se armó el grupo: el rechazo es antes de tocar nada.
        expect(m.armados).toEqual([]);
      } else {
        expect(r).toEqual(ok(`hecho:${nombre}`));
        expect(espia).toHaveBeenCalledOnce();
      }
    },
  );

  it("justo en el límite de 5 minutos todavía pasa; un milisegundo más, no (para uno marcado)", async () => {
    const enElLimite = await acceso(hace(5 * MINUTO));
    expect(await llamar(enElLimite.acceso, "casos", "altaDeEmpresa", {})).toEqual(
      ok("hecho:altaDeEmpresa"),
    );
    const pasado = await acceso(hace(5 * MINUTO + 1));
    expect(await llamar(pasado.acceso, "casos", "altaDeEmpresa", {})).toEqual({
      ok: false,
      error: "segundo_factor_reciente_requerido",
    });
  });

  it("verificar de nuevo (una sesión con la marca nueva) vuelve a dejar pasar: el rechazo no es permanente", async () => {
    const vieja = await acceso(hace(30 * MINUTO));
    expect(
      (await llamar(vieja.acceso, "casos", "suspenderPersona", {})) as { ok: boolean },
    ).toMatchObject({ ok: false });
    const renovada = await acceso(hace(0));
    expect(await llamar(renovada.acceso, "casos", "suspenderPersona", {})).toEqual(
      ok("hecho:suspenderPersona"),
    );
  });

  it("el rechazo por segundo factor viejo no depende de los argumentos que se pasen", async () => {
    const m = await acceso(hace(10 * MINUTO));
    for (const entrada of [undefined, {}, { claveDeIdempotencia: "x".repeat(20) }]) {
      expect(await llamar(m.acceso, "casos", "ajustarPerilla", entrada)).toEqual({
        ok: false,
        error: "segundo_factor_reciente_requerido",
      });
    }
    expect(m.espias.get("ajustarPerilla")).not.toHaveBeenCalled();
  });
});

describe("lo que se obtiene de un acceso", () => {
  it("`casos` tiene SOLO los casos y `consultas` SOLO las consultas (sin mezclar ni sobrar)", async () => {
    const m = await acceso(hace(0));
    expect(Object.keys(m.acceso.casos).sort()).toEqual(
      Object.keys(ACCIONES_DE_LA_CONSOLA.casos).sort(),
    );
    expect(Object.keys(m.acceso.consultas).sort()).toEqual(
      Object.keys(ACCIONES_DE_LA_CONSOLA.consultas).sort(),
    );
  });
});

describe("armar y crear la puerta", () => {
  it("sin reloj propio usa el del sistema: una sesión de este instante entra", async () => {
    const mundo = plataformaDeMentira();
    const puerta = crearPuertaDeConsola(mundo.plataforma, { hostDeLaConsola: HOST });
    const ahora = Date.now();
    const sesionDeAhora: SesionAutenticada = {
      ...sesion(new Date(ahora - MINUTO)),
      creadaEn: new Date(ahora - 5 * MINUTO),
      ultimoUso: new Date(ahora - MINUTO),
      venceEn: new Date(ahora + 20 * MINUTO),
    };
    const r = await puerta.conSesion(sesionDeAhora);
    expect(r.ok).toBe(true);
    // Y una de hace una hora, con el reloj real, no.
    const vieja: SesionAutenticada = { ...sesionDeAhora, ultimoUso: new Date(ahora - 60 * MINUTO) };
    expect(await puerta.conSesion(vieja)).toEqual({ ok: false, error: "sesion_vencida" });
  });

  it("el registro del servidor llega hasta la lectura del administrador (solo el nombre del error)", async () => {
    const mundo = plataformaDeMentira();
    (mundo.plataforma.buscarAdmin as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError("detalle que no debe salir"),
    );
    const registrar = vi.fn();
    const puerta = crearPuertaDeConsola(mundo.plataforma, {
      hostDeLaConsola: HOST,
      reloj: () => AHORA,
      registrar,
    });
    expect(await puerta.conSesion(sesion(hace(0)))).toEqual({ ok: false, error: "no_habilitado" });
    expect(registrar).toHaveBeenCalledExactlyOnceWith(
      "[consola] no se pudo leer al administrador: TypeError",
    );
  });

  it("armarPuertaDeConsola es perezosa: armarla, pedir una sesión que no vale y cerrarla no leen ninguna variable", async () => {
    const fuente = vi.fn(() => ({}));
    const registrar = vi.fn();
    const puerta = armarPuertaDeConsola({ fuente, registrar, hostDeLaConsola: HOST });
    expect(await puerta.conSesion(null)).toEqual({ ok: false, error: "sesion_vencida" });
    await expect(puerta.cerrar()).resolves.toBeUndefined();
    expect(fuente).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it("armarPuertaDeConsola arma la puerta de plataforma con ESE entorno y ese registro: sin variables, falla cerrado y registra los nombres", async () => {
    const registrar = vi.fn();
    const puerta = armarPuertaDeConsola({
      fuente: () => ({}),
      registrar,
      hostDeLaConsola: HOST,
      reloj: () => AHORA,
    });
    expect(await puerta.conSesion(sesion(hace(0)))).toEqual({ ok: false, error: "no_habilitado" });
    expect(registrar).toHaveBeenCalledWith(
      "pieza transacciones-de-plataforma: PEDERNAL_DB_PLATAFORMA falta; PEDERNAL_CLAVE_CONTEXTO falta",
    );
  });
});

describe("el acceso de un pedido", () => {
  it("informa el administrador (id y rol de la base) y cuánto le queda al segundo factor reciente", async () => {
    const m = await acceso(hace(2 * MINUTO));
    expect(m.acceso.admin).toEqual({ id: ADMIN_ID, rol: "ADMIN" });
    expect(m.acceso.segundoFactorRecienteHastaMs).toBe(3 * MINUTO);
    const vieja = await acceso(hace(20 * MINUTO));
    expect(vieja.acceso.segundoFactorRecienteHastaMs).toBe(0);
  });

  it("sin sesión, o con una que no vale, no da acceso y no arma nada", async () => {
    const mundo = plataformaDeMentira();
    const puerta = crearPuertaDeConsola(mundo.plataforma, {
      hostDeLaConsola: HOST,
      reloj: () => AHORA,
    });
    expect(await puerta.conSesion(null)).toEqual({ ok: false, error: "sesion_vencida" });
    expect(await puerta.conSesion(sesion(null))).toEqual({
      ok: false,
      error: "segundo_factor_requerido",
    });
    expect(await puerta.conSesion({ ...sesion(hace(0)), host: "app.example.test" })).toEqual({
      ok: false,
      error: "sesion_vencida",
    });
    expect(mundo.armados).toEqual([]);
  });

  it("los grupos se arman recién al usar una función, y una sola vez por llamada", async () => {
    const m = await acceso(hace(0));
    expect(m.armados).toEqual([]);
    await llamar(m.acceso, "consultas", "listarTenants", {});
    expect(m.armados).toEqual(["consultasDePlataforma"]);
  });

  it("cerrar cierra la puerta de plataforma", async () => {
    const m = await acceso(hace(0));
    await m.puerta.cerrar();
    expect((m.plataforma.cerrar as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});
