import { describe, expect, it } from "vitest";
import {
  CATALOGO_DE_PLATAFORMA,
  PERMISOS_DE_PLATAFORMA,
  REGLAS_DE_PLATAFORMA,
  tablaDePermisosDePlataforma,
} from "../../src/capacidades/permisos/plataforma";
import { DECLARACIONES_DE_DOMINIOS } from "../../src/plataforma/casos-de-uso/dominios";
import {
  DECLARACIONES_DE_MARCAS_Y_PLANES,
  crearCasosDeUsoDeMarcasYPlanes,
  type CasosDeUsoDeMarcasYPlanes,
} from "../../src/plataforma/casos-de-uso/marcas-y-planes";
import type { TxDeMarcasYPlanes } from "../../src/plataforma/casos-de-uso/marcas-y-planes-comun";
import type { TxDeConsultasDeMarcasYPlanes } from "../../src/plataforma/consultas/contrato-de-marcas-y-planes";
import { DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA } from "../../src/plataforma/consultas/declaraciones";
import { DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES } from "../../src/plataforma/consultas/declaraciones-de-marcas-y-planes";
import {
  crearConsultasDeMarcasYPlanes,
  type ConsultasDeMarcasYPlanes,
} from "../../src/plataforma/consultas/consultas-de-marcas-y-planes";
import { CATALOGOS } from "./apoyo-de-marcas-y-planes";
import { comoAdministrador, conRol, uuid } from "./apoyo-de-soporte";

/**
 * Ningún caso de uso ni consulta de marcas y planes se salta el guard (ADR-003): corren contra una
 * transacción VIGILADA en la que solo `autorizacionDePlataforma` responde y cualquier otro acceso (un
 * repositorio, la auditoría, la idempotencia, los derechos) queda registrado y corta la ejecución. Quien lee
 * o escribe antes de autorizar, o no autoriza, se delata solo. Sin base de datos.
 */

class AccesoFueraDelGuard extends Error {}

/** Lo que recibe una consulta o un caso: la transacción de los casos más lo que las consultas suman. */
type TxVigilada = TxDeMarcasYPlanes & TxDeConsultasDeMarcasYPlanes;
type Vigilada = Readonly<{ tx: TxVigilada; accesos: string[] }>;

function vigilar(rol: "ADMIN" | "SOPORTE" | null): Vigilada {
  const accesos: string[] = [];
  const autorizacion = conRol(rol);
  const tx = new Proxy({} as TxVigilada, {
    get(_objetivo, propiedad) {
      accesos.push(String(propiedad));
      if (propiedad === "autorizacionDePlataforma") return autorizacion;
      throw new AccesoFueraDelGuard(String(propiedad));
    },
  });
  return { tx, accesos };
}

const transaccionesDe = (vigilada: Vigilada) => ({
  ejecutar: <T, E>(_opciones: unknown, trabajo: (tx: TxVigilada) => Promise<T | E>) =>
    trabajo(vigilada.tx),
});

const casosCon = (vigilada: Vigilada): CasosDeUsoDeMarcasYPlanes =>
  crearCasosDeUsoDeMarcasYPlanes({
    transacciones: transaccionesDe(vigilada),
    reglas: REGLAS_DE_PLATAFORMA,
    ...CATALOGOS,
  });
const consultasCon = (vigilada: Vigilada): ConsultasDeMarcasYPlanes =>
  crearConsultasDeMarcasYPlanes({
    transacciones: transaccionesDe(vigilada),
    reglas: REGLAS_DE_PLATAFORMA,
    ...CATALOGOS,
  });

const CLAVE = "clave-de-guard-0001";
const FECHA = new Date("2026-10-11T12:00:00Z");

/** Cómo se llama a cada caso de uso, con una entrada VÁLIDA. Un caso nuevo obliga a sumar su fila. */
const LLAMADAS: Record<
  keyof typeof DECLARACIONES_DE_MARCAS_Y_PLANES,
  (c: CasosDeUsoDeMarcasYPlanes) => Promise<unknown>
> = {
  crearMarca: (c) =>
    c.crearMarca(comoAdministrador, {
      claveDeIdempotencia: CLAVE,
      codigo: "mi-marca",
      marcaPadreId: null,
    }),
  guardarBorradorDeMarca: (c) =>
    c.guardarBorradorDeMarca(comoAdministrador, {
      claveDeIdempotencia: CLAVE,
      marcaId: uuid(1),
      versionEsperada: null,
    }),
  confirmarVersionDeMarca: (c) =>
    c.confirmarVersionDeMarca(comoAdministrador, {
      claveDeIdempotencia: CLAVE,
      marcaId: uuid(1),
      versionEsperada: 1,
      vigenteDesde: FECHA,
      motivo: "alta",
      reemplazaProgramada: false,
    }),
  crearPlan: (c) =>
    c.crearPlan(comoAdministrador, { claveDeIdempotencia: CLAVE, codigo: "plan-pro" }),
  guardarBorradorDePlan: (c) =>
    c.guardarBorradorDePlan(comoAdministrador, {
      claveDeIdempotencia: CLAVE,
      planId: uuid(1),
      versionEsperada: null,
      nombreComercial: "Plan",
      modulos: [],
      perillas: {},
    }),
  publicarVersionDePlan: (c) =>
    c.publicarVersionDePlan(comoAdministrador, {
      claveDeIdempotencia: CLAVE,
      planId: uuid(1),
      motivo: "alta",
    }),
  asignarPlan: (c) =>
    c.asignarPlan(comoAdministrador, {
      claveDeIdempotencia: CLAVE,
      tenantId: uuid(1),
      versionDePlanId: uuid(2),
      vigenteDesde: FECHA,
      motivo: "alta",
      numeroEsperado: null,
      reemplazaProgramada: false,
    }),
  migrarTenantsDeVersion: (c) =>
    c.migrarTenantsDeVersion(comoAdministrador, {
      claveDeLote: "lote-1",
      versionDePlanId: uuid(2),
      vigenteDesde: FECHA,
      motivo: "migración",
      tenants: [{ tenantId: uuid(1), numeroEsperado: null }],
      reemplazaProgramada: false,
    }),
  ajustarPerilla: (c) =>
    c.ajustarPerilla(comoAdministrador, {
      claveDeIdempotencia: CLAVE,
      tenantId: uuid(1),
      empresaId: null,
      perilla: "empresas_por_tenant",
      valor: { tipo: "LIMITE", limite: 2 },
      vigenteDesde: FECHA,
      motivo: "extra",
      numeroEsperado: null,
      reemplazaProgramada: false,
    }),
  activarModuloDeEmpresa: (c) =>
    c.activarModuloDeEmpresa(comoAdministrador, {
      claveDeIdempotencia: CLAVE,
      empresaId: uuid(1),
      modulo: "caja",
    }),
  desactivarModuloDeEmpresa: (c) =>
    c.desactivarModuloDeEmpresa(comoAdministrador, {
      claveDeIdempotencia: CLAVE,
      empresaId: uuid(1),
      modulo: "caja",
    }),
};

/** Y cada consulta, con una entrada VÁLIDA. */
const CONSULTAS: Record<
  keyof typeof DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES,
  (c: ConsultasDeMarcasYPlanes) => Promise<unknown>
> = {
  listarMarcas: (c) => c.listarMarcas(comoAdministrador),
  fichaDeMarca: (c) => c.fichaDeMarca(comoAdministrador, { marcaId: uuid(1) }),
  marcasParaElAlta: (c) => c.marcasParaElAlta(comoAdministrador),
  catalogosDeMarca: (c) => c.catalogosDeMarca(comoAdministrador),
  listarPlanes: (c) => c.listarPlanes(comoAdministrador),
  fichaDePlan: (c) => c.fichaDePlan(comoAdministrador, { planId: uuid(1) }),
  tenantsConLaVersion: (c) =>
    c.tenantsConLaVersion(comoAdministrador, { versionDePlanId: uuid(1) }),
  planDelTenant: (c) => c.planDelTenant(comoAdministrador, { tenantId: uuid(1) }),
  derechosDeUsoDeEmpresa: (c) =>
    c.derechosDeUsoDeEmpresa(comoAdministrador, { empresaId: uuid(1) }),
  diferenciaEntreVersiones: (c) =>
    c.diferenciaEntreVersiones(comoAdministrador, { desde: uuid(1), hasta: uuid(2) }),
};

/** Pasar el guard = tocar algo que no es la autorización. */
const pasoElGuard = async (llamada: Promise<unknown>): Promise<boolean> => {
  try {
    const r = (await llamada) as { ok: boolean };
    return r.ok;
  } catch (e) {
    if (e instanceof AccesoFueraDelGuard) return true;
    throw e;
  }
};

const casos = Object.entries(LLAMADAS);
/** Los catálogos salen del código: pasado el guard no leen nada (por eso no se les pide tocar la transacción). */
const CATALOGOS_DEL_CODIGO = ["catalogosDeMarca"];
const consultas = Object.entries(CONSULTAS);
const consultasQueLeen = consultas.filter(([nombre]) => !CATALOGOS_DEL_CODIGO.includes(nombre));
const consultasDeCatalogo = consultas.filter(([nombre]) => CATALOGOS_DEL_CODIGO.includes(nombre));

describe("el guard es lo primero de cada caso de uso de marcas y planes", () => {
  it.each(casos)(
    "%s: sin administrador vigente responde SIN_PERMISO y no toca nada más",
    async (_nombre, llamar) => {
      const vigilada = vigilar(null);
      expect(await llamar(casosCon(vigilada))).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(vigilada.accesos).toEqual(["autorizacionDePlataforma"]);
    },
  );

  it.each(casos)("%s: SOPORTE no pasa (solo ADMIN cambia estructura)", async (_n, llamar) => {
    const vigilada = vigilar("SOPORTE");
    expect(await llamar(casosCon(vigilada))).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(vigilada.accesos).toEqual(["autorizacionDePlataforma"]);
  });

  it.each(casos)(
    "%s: ADMIN pasa el guard y recién entonces toca la transacción",
    async (_n, llamar) => {
      const vigilada = vigilar("ADMIN");
      expect(await pasoElGuard(llamar(casosCon(vigilada)))).toBe(true);
      expect(vigilada.accesos[0]).toBe("autorizacionDePlataforma");
      expect(vigilada.accesos.length).toBeGreaterThan(1);
    },
  );

  it("el rechazo del guard gana sobre una entrada inválida", async () => {
    const c = casosCon(vigilar(null));
    expect(
      await c.crearMarca(comoAdministrador, {
        claveDeIdempotencia: "x",
        codigo: "!",
        marcaPadreId: "x",
      }),
    ).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(await c.crearPlan(comoAdministrador, { claveDeIdempotencia: "x", codigo: "!" })).toEqual(
      {
        ok: false,
        error: "SIN_PERMISO",
      },
    );
  });
});

describe("el guard es lo primero de cada consulta de marcas y planes", () => {
  it.each(consultas)(
    "%s: sin administrador vigente responde SIN_PERMISO y no toca nada más",
    async (_n, llamar) => {
      const vigilada = vigilar(null);
      expect(await llamar(consultasCon(vigilada))).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(vigilada.accesos).toEqual(["autorizacionDePlataforma"]);
    },
  );

  it.each(consultasQueLeen)(
    "%s: SOPORTE y ADMIN pasan el guard y recién entonces leen",
    async (_n, llamar) => {
      for (const rol of ["SOPORTE", "ADMIN"] as const) {
        const vigilada = vigilar(rol);
        expect(await pasoElGuard(llamar(consultasCon(vigilada))), rol).toBe(true);
        expect(vigilada.accesos[0]).toBe("autorizacionDePlataforma");
        expect(vigilada.accesos.length).toBeGreaterThan(1);
      }
    },
  );

  it.each(consultasDeCatalogo)(
    "%s: SOPORTE y ADMIN pasan el guard y responden sin tocar nada más de la transacción",
    async (_n, llamar) => {
      for (const rol of ["SOPORTE", "ADMIN"] as const) {
        const vigilada = vigilar(rol);
        const r = (await llamar(consultasCon(vigilada))) as { ok: boolean };
        expect(r.ok, rol).toBe(true);
        expect(vigilada.accesos, rol).toEqual(["autorizacionDePlataforma"]);
      }
    },
  );
});

describe("las acciones que exigen son las del catálogo de plataforma", () => {
  const tabla = tablaDePermisosDePlataforma(REGLAS_DE_PLATAFORMA.permisos);

  it("los casos exigen acciones solo de ADMIN, y las consultas, acciones de ADMIN y SOPORTE", () => {
    for (const d of Object.values(DECLARACIONES_DE_MARCAS_Y_PLANES)) {
      expect(PERMISOS_DE_PLATAFORMA[d.accion], d.accion).toEqual(["ADMIN"]);
      expect(tabla.SOPORTE).not.toContain(d.accion);
    }
    for (const d of Object.values(DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES)) {
      expect(PERMISOS_DE_PLATAFORMA[d.accion], d.accion).toEqual(["ADMIN", "SOPORTE"]);
    }
  });

  it("migrarTenantsDeVersion exige la misma acción que asignarPlan: migrar es asignar a muchos", () => {
    expect(DECLARACIONES_DE_MARCAS_Y_PLANES.migrarTenantsDeVersion.accion).toBe("planes.asignar");
    expect(DECLARACIONES_DE_MARCAS_Y_PLANES.asignarPlan.accion).toBe("planes.asignar");
  });

  it("cada acción que M0 agregó al catálogo la usa algún caso o alguna consulta (ninguna queda sin uso)", () => {
    const delCatalogo = Object.keys(CATALOGO_DE_PLATAFORMA.plataforma.acciones);
    const deH5 = new Set(
      Object.values(DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA).map((d) => d.accion),
    );
    const usadas = new Set<string>([
      ...Object.values(DECLARACIONES_DE_DOMINIOS).map((d) => d.accion),
      ...Object.values(DECLARACIONES_DE_MARCAS_Y_PLANES).map((d) => d.accion),
      ...Object.values(DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES).map((d) => d.accion),
    ]);
    const deMarcasYPlanes = delCatalogo.filter(
      (a) =>
        /^(marcas|planes|dominios|perillas|modulos_de_empresa)\./.test(a) && !deH5.has(a as never),
    );
    expect([...usadas].sort()).toEqual([...deMarcasYPlanes].sort());
  });
});
