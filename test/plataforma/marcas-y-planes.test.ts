import { describe, expect, it } from "vitest";
import type { CasosDeUsoDeMarcasYPlanes } from "../../src/plataforma/casos-de-uso/marcas-y-planes";
import { OPERACION_AJUSTAR_PERILLA } from "../../src/plataforma/casos-de-uso/ajustar-perilla";
import { OPERACION_ASIGNAR_PLAN } from "../../src/plataforma/casos-de-uso/asignar-plan";
import { OPERACION_CONFIRMAR_VERSION_DE_MARCA } from "../../src/plataforma/casos-de-uso/confirmar-version-de-marca";
import { OPERACION_CREAR_MARCA } from "../../src/plataforma/casos-de-uso/crear-marca";
import { OPERACION_CREAR_PLAN } from "../../src/plataforma/casos-de-uso/crear-plan";
import { OPERACION_GUARDAR_BORRADOR_DE_MARCA } from "../../src/plataforma/casos-de-uso/guardar-borrador-de-marca";
import { OPERACION_GUARDAR_BORRADOR_DE_PLAN } from "../../src/plataforma/casos-de-uso/guardar-borrador-de-plan";
import { OPERACION_MIGRAR_TENANT_DE_VERSION } from "../../src/plataforma/casos-de-uso/migrar-tenants-de-version";
import {
  OPERACION_ACTIVAR_MODULO_DE_EMPRESA,
  OPERACION_DESACTIVAR_MODULO_DE_EMPRESA,
} from "../../src/plataforma/casos-de-uso/modulos-de-empresa";
import { OPERACION_PUBLICAR_VERSION_DE_PLAN } from "../../src/plataforma/casos-de-uso/publicar-version-de-plan";
import type { Dato } from "../../src/puertos/sin-secretos";
import {
  CLAVE,
  CONTEXTO,
  SeTocoLoQueNoDebia,
  armarMarcasYPlanes,
  id,
} from "./apoyo-de-marcas-y-planes";

/**
 * Lo que los casos de uso de marcas y planes hacen ANTES de leer o escribir nada, sin base de datos: la
 * forma de la entrada (después del guard), la clave de idempotencia, la repetición y la clave reutilizada.
 * Cualquier acceso a un repositorio, a los derechos o a la auditoría de empresa lanza: si un caso los toca
 * donde no debía, la prueba lo dice.
 */

const FECHA = new Date("2026-10-11T12:00:00Z");
const PERILLA_VALOR = { tipo: "LIMITE", limite: 3 };

/** Cada caso con una entrada VÁLIDA, la operación con que guarda su clave y lo que guardaría como resultado. */
type Caso = Readonly<{
  nombre: keyof CasosDeUsoDeMarcasYPlanes;
  operacion: string;
  llamar: (c: CasosDeUsoDeMarcasYPlanes, clave: string, cambios?: object) => Promise<unknown>;
  /** Lo que el caso guardó la primera vez. */
  guardado: Dato;
  /** Lo que devuelve ante la repetición de la clave. */
  repetido: unknown;
}>;

const CASOS: readonly Caso[] = [
  {
    nombre: "crearMarca",
    operacion: OPERACION_CREAR_MARCA,
    llamar: (c, claveDeIdempotencia, cambios = {}) =>
      c.crearMarca(CONTEXTO, {
        claveDeIdempotencia,
        codigo: "mi-marca",
        marcaPadreId: id(1),
        ...cambios,
      }),
    guardado: { marcaId: id(9), yaExistia: false },
    repetido: { marcaId: id(9), yaExistia: true },
  },
  {
    nombre: "guardarBorradorDeMarca",
    operacion: OPERACION_GUARDAR_BORRADOR_DE_MARCA,
    llamar: (c, claveDeIdempotencia, cambios = {}) =>
      c.guardarBorradorDeMarca(CONTEXTO, {
        claveDeIdempotencia,
        marcaId: id(1),
        versionEsperada: null,
        nombreVisible: "Mi marca",
        ...cambios,
      }),
    guardado: { borradorId: id(8), version: 3 },
    repetido: { borradorId: id(8), version: 3 },
  },
  {
    nombre: "confirmarVersionDeMarca",
    operacion: OPERACION_CONFIRMAR_VERSION_DE_MARCA,
    llamar: (c, claveDeIdempotencia, cambios = {}) =>
      c.confirmarVersionDeMarca(CONTEXTO, {
        claveDeIdempotencia,
        marcaId: id(1),
        vigenteDesde: FECHA,
        motivo: "alta",
        reemplazaProgramada: false,
        ...cambios,
      }),
    guardado: { numero: 2 },
    repetido: { numero: 2 },
  },
  {
    nombre: "crearPlan",
    operacion: OPERACION_CREAR_PLAN,
    llamar: (c, claveDeIdempotencia, cambios = {}) =>
      c.crearPlan(CONTEXTO, { claveDeIdempotencia, codigo: "plan-pro", ...cambios }),
    guardado: { planId: id(7), yaExistia: false },
    repetido: { planId: id(7), yaExistia: true },
  },
  {
    nombre: "guardarBorradorDePlan",
    operacion: OPERACION_GUARDAR_BORRADOR_DE_PLAN,
    llamar: (c, claveDeIdempotencia, cambios = {}) =>
      c.guardarBorradorDePlan(CONTEXTO, {
        claveDeIdempotencia,
        planId: id(1),
        versionEsperada: null,
        nombreComercial: "Plan",
        modulos: ["caja"],
        perillas: {},
        ...cambios,
      }),
    guardado: { borradorId: id(6), version: 1 },
    repetido: { borradorId: id(6), version: 1 },
  },
  {
    nombre: "publicarVersionDePlan",
    operacion: OPERACION_PUBLICAR_VERSION_DE_PLAN,
    llamar: (c, claveDeIdempotencia, cambios = {}) =>
      c.publicarVersionDePlan(CONTEXTO, {
        claveDeIdempotencia,
        planId: id(1),
        motivo: "alta",
        ...cambios,
      }),
    guardado: { numero: 4 },
    repetido: { numero: 4 },
  },
  {
    nombre: "asignarPlan",
    operacion: OPERACION_ASIGNAR_PLAN,
    llamar: (c, claveDeIdempotencia, cambios = {}) =>
      c.asignarPlan(CONTEXTO, {
        claveDeIdempotencia,
        tenantId: id(1),
        versionDePlanId: id(2),
        vigenteDesde: FECHA,
        motivo: "alta",
        numeroEsperado: null,
        reemplazaProgramada: false,
        ...cambios,
      }),
    guardado: { numero: 2, resultado: "ASIGNADO", repetida: false },
    repetido: { numero: 2, yaExistia: true },
  },
  {
    nombre: "ajustarPerilla",
    operacion: OPERACION_AJUSTAR_PERILLA,
    llamar: (c, claveDeIdempotencia, cambios = {}) =>
      c.ajustarPerilla(CONTEXTO, {
        claveDeIdempotencia,
        tenantId: id(1),
        empresaId: null,
        perilla: "empresas_por_tenant",
        valor: PERILLA_VALOR,
        vigenteDesde: FECHA,
        motivo: "extra",
        numeroEsperado: null,
        reemplazaProgramada: false,
        ...cambios,
      }),
    guardado: { numero: 5 },
    repetido: { numero: 5 },
  },
  {
    nombre: "activarModuloDeEmpresa",
    operacion: OPERACION_ACTIVAR_MODULO_DE_EMPRESA,
    llamar: (c, claveDeIdempotencia, cambios = {}) =>
      c.activarModuloDeEmpresa(CONTEXTO, {
        claveDeIdempotencia,
        empresaId: id(1),
        modulo: "caja",
        ...cambios,
      }),
    guardado: { yaEstabaActivo: false },
    repetido: { yaEstabaActivo: true },
  },
  {
    nombre: "desactivarModuloDeEmpresa",
    operacion: OPERACION_DESACTIVAR_MODULO_DE_EMPRESA,
    llamar: (c, claveDeIdempotencia, cambios = {}) =>
      c.desactivarModuloDeEmpresa(CONTEXTO, {
        claveDeIdempotencia,
        empresaId: id(1),
        modulo: "caja",
        ...cambios,
      }),
    guardado: { yaEstabaInactivo: false },
    repetido: { yaEstabaInactivo: true },
  },
];

describe("las operaciones con que se guardan las claves", () => {
  it("cada caso (y el lote) tiene la suya, con la forma que exige la tabla y sin repetirse", () => {
    const operaciones = [...CASOS.map((c) => c.operacion), OPERACION_MIGRAR_TENANT_DE_VERSION];
    expect(new Set(operaciones).size).toBe(operaciones.length);
    for (const operacion of operaciones) expect(operacion).toMatch(/^[a-z_.]+$/);
  });
});

describe("la forma de la entrada se valida DESPUÉS del guard y ANTES de tocar nada", () => {
  const MALAS: ReadonlyArray<readonly [Caso["nombre"], object, string | object]> = [
    ["crearMarca", { codigo: "Mi Marca" }, "CODIGO_DE_MARCA_INVALIDO"],
    ["crearMarca", { marcaPadreId: "x" }, "ID_INVALIDO"],
    ["guardarBorradorDeMarca", { marcaId: "x" }, "ID_INVALIDO"],
    ["guardarBorradorDeMarca", { versionEsperada: 0 }, "VERSION_ESPERADA_INVALIDA"],
    ["guardarBorradorDeMarca", { planPorDefectoId: "x" }, "ID_INVALIDO"],
    ["guardarBorradorDeMarca", { nombreVisible: " " }, "NOMBRE_DE_MARCA_INVALIDO"],
    [
      "guardarBorradorDeMarca",
      { tema: { fondo: "#000000" } },
      { codigo: "TEMA_INVALIDO", token: "fondo" },
    ],
    ["guardarBorradorDeMarca", { logo: "/otra/ruta.svg" }, "LOGO_INVALIDO"],
    [
      "guardarBorradorDeMarca",
      { modulosIniciales: ["comandas"] },
      { codigo: "MODULO_DESCONOCIDO", modulo: "comandas" },
    ],
    ["confirmarVersionDeMarca", { marcaId: "x" }, "ID_INVALIDO"],
    ["confirmarVersionDeMarca", { vigenteDesde: new Date("x") }, "VIGENCIA_INVALIDA"],
    ["confirmarVersionDeMarca", { motivo: "m".repeat(501) }, "MOTIVO_DEMASIADO_LARGO"],
    ["crearPlan", { codigo: "Plan Pro" }, "CODIGO_DE_PLAN_INVALIDO"],
    ["guardarBorradorDePlan", { planId: "x" }, "ID_INVALIDO"],
    ["guardarBorradorDePlan", { versionEsperada: 1.5 }, "VERSION_ESPERADA_INVALIDA"],
    ["guardarBorradorDePlan", { nombreComercial: " " }, "NOMBRE_DE_PLAN_INVALIDO"],
    [
      "guardarBorradorDePlan",
      { modulos: ["cuentas"] },
      { codigo: "REQUIERE_FALTANTE", modulo: "cuentas", requiere: "ventas" },
    ],
    [
      "guardarBorradorDePlan",
      { perillas: { inventada: PERILLA_VALOR } },
      { codigo: "PERILLA_DESCONOCIDA", perilla: "inventada" },
    ],
    ["publicarVersionDePlan", { planId: "x" }, "ID_INVALIDO"],
    ["publicarVersionDePlan", { motivo: "m".repeat(501) }, "MOTIVO_DEMASIADO_LARGO"],
    ["asignarPlan", { tenantId: "x" }, "ID_INVALIDO"],
    ["asignarPlan", { versionDePlanId: "x" }, "ID_INVALIDO"],
    ["asignarPlan", { vigenteDesde: new Date("x") }, "VIGENCIA_INVALIDA"],
    ["asignarPlan", { motivo: "m".repeat(501) }, "MOTIVO_DEMASIADO_LARGO"],
    ["asignarPlan", { numeroEsperado: -1 }, "NUMERO_ESPERADO_INVALIDO"],
    ["ajustarPerilla", { tenantId: "x" }, "ID_INVALIDO"],
    ["ajustarPerilla", { empresaId: "x" }, "ID_INVALIDO"],
    ["ajustarPerilla", { vigenteDesde: new Date("x") }, "VIGENCIA_INVALIDA"],
    ["ajustarPerilla", { numeroEsperado: 0 }, "NUMERO_ESPERADO_INVALIDO"],
    ["activarModuloDeEmpresa", { empresaId: "x" }, "ID_INVALIDO"],
    ["desactivarModuloDeEmpresa", { empresaId: "x" }, "ID_INVALIDO"],
  ];

  it.each(MALAS)(
    "%s con %j: %j, sin tocar repositorios, constancias ni claves",
    async (nombre, cambios, esperado) => {
      const { casos, auditoria, idempotencia } = armarMarcasYPlanes();
      const caso = CASOS.find((c) => c.nombre === nombre) as Caso;
      expect(await caso.llamar(casos, CLAVE, cambios)).toEqual({ ok: false, error: esperado });
      expect(auditoria.registros).toEqual([]);
      expect(idempotencia.guardadas.size).toBe(0);
    },
  );

  it.each(CASOS)(
    "$nombre: una clave de idempotencia con mala forma se rechaza antes de mirar la entrada",
    async (caso) => {
      const { casos } = armarMarcasYPlanes();
      for (const mala of ["corta", "con espacios y más de dieciséis", "ñ".repeat(20)]) {
        expect(await caso.llamar(casos, mala)).toEqual({
          ok: false,
          error: "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
        });
      }
    },
  );

  it("un valor de ajuste que no es dato plano no entra a la huella y lo rechaza el dominio al llegar a leer", async () => {
    const { casos } = armarMarcasYPlanes();
    const caso = CASOS.find((c) => c.nombre === "ajustarPerilla") as Caso;
    // Pasa la forma (es la huella la que lo marca) y recién el dominio, que necesita leer el tenant, lo rechaza.
    await expect(caso.llamar(casos, CLAVE, { valor: () => 1 })).rejects.toThrow(SeTocoLoQueNoDebia);
  });
});

describe("la repetición de la clave devuelve lo guardado, marcado, sin tocar nada", () => {
  /** Hace que la clave quede registrada con la entrada canónica que el caso mismo arma (la captura corriendo una vez). */
  async function conLaClaveYaUsada(caso: Caso, cambios: object = {}) {
    const armado = armarMarcasYPlanes();
    let capturada: Dato | undefined;
    const consultar = armado.idempotencia.consultar.bind(armado.idempotencia);
    armado.idempotencia.consultar = (operacion, clave, entrada) => {
      capturada = entrada;
      return consultar(operacion, clave, entrada);
    };
    // La primera vez llega a leer los repositorios (que lanzan): ahí se captura la entrada canónica.
    await expect(caso.llamar(armado.casos, CLAVE, cambios)).rejects.toThrow(SeTocoLoQueNoDebia);
    expect(capturada).toBeDefined();
    await armado.idempotencia.registrar(caso.operacion, CLAVE, capturada as Dato, caso.guardado);
    return { armado, entrada: capturada as Dato };
  }

  it.each(CASOS)("$nombre", async (caso) => {
    const { armado } = await conLaClaveYaUsada(caso);
    expect(await caso.llamar(armado.casos, CLAVE)).toEqual({ ok: true, valor: caso.repetido });
    expect(armado.auditoria.registros).toEqual([]);
    expect(armado.idempotencia.guardadas.size).toBe(1);
  });

  it.each(CASOS)("$nombre: la misma clave con otra entrada es CLAVE_REUTILIZADA", async (caso) => {
    const { armado } = await conLaClaveYaUsada(caso);
    // Otra entrada VÁLIDA: cambia lo que cada caso tiene de distinto.
    const OTRA: Record<Caso["nombre"], object> = {
      crearMarca: { codigo: "otra-marca" },
      guardarBorradorDeMarca: { nombreVisible: "Otro nombre" },
      confirmarVersionDeMarca: { motivo: "otro motivo" },
      crearPlan: { codigo: "otro-plan" },
      guardarBorradorDePlan: { nombreComercial: "Otro plan" },
      publicarVersionDePlan: { motivo: "otro motivo" },
      asignarPlan: { motivo: "otro motivo" },
      migrarTenantsDeVersion: {},
      ajustarPerilla: { motivo: "otro motivo" },
      activarModuloDeEmpresa: { modulo: "ventas" },
      desactivarModuloDeEmpresa: { modulo: "ventas" },
    };
    expect(await caso.llamar(armado.casos, CLAVE, OTRA[caso.nombre])).toEqual({
      ok: false,
      error: "CLAVE_REUTILIZADA",
    });
  });

  it("asignarPlan: lo guardado como «ya estaba» también se repite como yaExistia", async () => {
    const caso = CASOS.find((c) => c.nombre === "asignarPlan") as Caso;
    const { armado, entrada } = await conLaClaveYaUsada(caso);
    const otro = armarMarcasYPlanes();
    await otro.idempotencia.registrar(caso.operacion, CLAVE, entrada, {
      numero: 3,
      resultado: "YA_ESTABA",
      repetida: false,
    });
    expect(await caso.llamar(otro.casos, CLAVE)).toEqual({
      ok: true,
      valor: { numero: 3, yaExistia: true },
    });
    expect(armado.idempotencia.guardadas.size).toBe(1);
  });

  it.each([
    ["ASIGNADO", "MIGRADO"],
    ["YA_ESTABA", "YA_ESTABA"],
  ] as const)(
    "migrarTenantsDeVersion: el tenant que ya hizo %s lo repite como %s, con repetido en true y sin tocar nada",
    async (guardado, esperado) => {
      const lote = {
        claveDeLote: "lote-1",
        versionDePlanId: id(2),
        vigenteDesde: FECHA,
        motivo: "migración",
        tenants: [{ tenantId: id(1), numeroEsperado: 1 }],
        reemplazaProgramada: false,
      };
      // La entrada canónica del tenant se captura corriendo el lote una vez (que llega a leer y lanza).
      const armado = armarMarcasYPlanes();
      const capturadas: Array<{ clave: string; entrada: Dato }> = [];
      const consultar = armado.idempotencia.consultar.bind(armado.idempotencia);
      armado.idempotencia.consultar = (operacion, clave, entrada) => {
        capturadas.push({ clave, entrada });
        return consultar(operacion, clave, entrada);
      };
      await expect(armado.casos.migrarTenantsDeVersion(CONTEXTO, lote)).rejects.toThrow(
        SeTocoLoQueNoDebia,
      );
      expect(capturadas.map((c) => c.clave)).toEqual([`lote_lote-1_${id(1)}`]);
      await armado.idempotencia.registrar(
        OPERACION_MIGRAR_TENANT_DE_VERSION,
        `lote_lote-1_${id(1)}`,
        capturadas[0]?.entrada as Dato,
        { numero: 2, resultado: guardado, repetida: false },
      );
      expect(await armado.casos.migrarTenantsDeVersion(CONTEXTO, lote)).toEqual({
        ok: true,
        valor: {
          resultados: [
            { tenantId: id(1), resultado: esperado, numero: 2, repetido: true, error: null },
          ],
        },
      });
      expect(armado.auditoria.registros).toEqual([]);
    },
  );
});

describe("migrarTenantsDeVersion: el lote mal armado se rechaza antes de tocar a nadie", () => {
  const UNO = { tenantId: id(1), numeroEsperado: null };
  const lote = {
    claveDeLote: "lote-1",
    versionDePlanId: id(2),
    vigenteDesde: FECHA,
    motivo: "migración",
    tenants: [{ tenantId: id(1), numeroEsperado: null }],
    reemplazaProgramada: false,
  };
  it.each([
    [{ claveDeLote: "lote_1" }, "CLAVE_DE_LOTE_INVALIDA"],
    [{ tenants: [] }, "LOTE_VACIO"],
    [
      {
        tenants: Array.from({ length: 201 }, (_, i) => ({
          tenantId: id(i + 1),
          numeroEsperado: null,
        })),
      },
      "LOTE_DEMASIADO_GRANDE",
    ],
    [{ tenants: [UNO, UNO] }, "TENANT_REPETIDO_EN_EL_LOTE"],
    [{ tenants: [{ tenantId: "x", numeroEsperado: null }] }, "ID_INVALIDO"],
    [{ versionDePlanId: "x" }, "ID_INVALIDO"],
    [{ vigenteDesde: new Date("x") }, "VIGENCIA_INVALIDA"],
    [{ motivo: "m".repeat(501) }, "MOTIVO_DEMASIADO_LARGO"],
  ])("%j: %s", async (cambios, esperado) => {
    const { casos, idempotencia, auditoria } = armarMarcasYPlanes();
    expect(await casos.migrarTenantsDeVersion(CONTEXTO, { ...lote, ...cambios })).toEqual({
      ok: false,
      error: esperado,
    });
    expect(idempotencia.guardadas.size).toBe(0);
    expect(auditoria.registros).toEqual([]);
  });

  it("pide el guard en una lectura propia, antes de mirar el lote, y SOPORTE no pasa", async () => {
    const { casos, transacciones } = armarMarcasYPlanes("SOPORTE");
    expect(await casos.migrarTenantsDeVersion(CONTEXTO, { ...lote, tenants: [] })).toEqual({
      ok: false,
      error: "SIN_PERMISO",
    });
    expect(transacciones.pedidas).toEqual([
      { contexto: CONTEXTO, aislamiento: "read committed", soloLectura: true },
    ]);
  });
});
