import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import type { ReglasDelGuard } from "../../src/capacidades/permisos/guard";
import {
  REGLAS_DE_PLATAFORMA,
  ROLES_DE_PLATAFORMA,
} from "../../src/capacidades/permisos/plataforma";
import {
  crearCasosDeUsoDeSoporte,
  DECLARACIONES_DE_SOPORTE,
  type CasosDeUsoDeSoporte,
} from "../../src/plataforma/casos-de-uso/soporte";
import {
  crearConsultasDePlataforma,
  type ConsultasDePlataforma,
} from "../../src/plataforma/consultas/consultas";
import { CATALOGO_DE_PERILLAS } from "../../src/capacidades/planes/perillas";
import type { TxDeConsultasDePlataforma } from "../../src/plataforma/consultas/contrato";
import { DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA } from "../../src/plataforma/consultas/declaraciones";
import type { TxDeExplicar } from "../../src/plataforma/casos-de-uso/explicar-por-que";
import { comoAdministrador, conRol, uuid } from "./apoyo-de-soporte";

/**
 * Ninguna consulta ni caso de uso de soporte se salta el guard (ADR-003, el «P7» de empresas llevado a
 * plataforma). Corren contra una transacción VIGILADA: solo `autorizacionDePlataforma` responde y
 * cualquier otro acceso (la lectura, la auditoría, la idempotencia) queda registrado y corta la
 * ejecución. Quien lee o escribe antes de autorizar, o no autoriza, se delata solo. Sin base de datos.
 */

/** El guard dejó pasar: la transacción vigilada corta en el primer acceso que no es la autorización. */
class AccesoFueraDelGuard extends Error {}

type Vigilada = Readonly<{
  tx: TxDeConsultasDePlataforma & TxDeExplicar;
  accesos: string[];
}>;

function vigilar(rol: "ADMIN" | "SOPORTE" | null): Vigilada {
  const accesos: string[] = [];
  const autorizacion = conRol(rol);
  const tx = new Proxy({} as TxDeConsultasDePlataforma & TxDeExplicar, {
    get(_objetivo, propiedad) {
      accesos.push(String(propiedad));
      if (propiedad === "autorizacionDePlataforma") return autorizacion;
      throw new AccesoFueraDelGuard(String(propiedad));
    },
  });
  return { tx, accesos };
}

const reglasDeEmpresaDePrueba: ReglasDelGuard<string, string, string, string> = {
  catalogo: CATALOGO_DE_MODULOS,
  permisos: { "usuarios.invitar": ["GERENTE"] },
};

const consultasCon = (vigilada: Vigilada): ConsultasDePlataforma =>
  crearConsultasDePlataforma({
    transacciones: { ejecutar: (_opciones, trabajo) => trabajo(vigilada.tx) },
    reglas: REGLAS_DE_PLATAFORMA,
    catalogoDeEmpresa: CATALOGO_DE_MODULOS,
    catalogoDePerillas: CATALOGO_DE_PERILLAS,
  });

const casosCon = (vigilada: Vigilada): CasosDeUsoDeSoporte =>
  crearCasosDeUsoDeSoporte({
    explicar: {
      transacciones: { ejecutar: (_opciones, trabajo) => trabajo(vigilada.tx) },
      reglas: REGLAS_DE_PLATAFORMA,
      reglasDeEmpresa: reglasDeEmpresaDePrueba,
    },
    referencias: {
      transacciones: {
        // Sin guard por diseño: registra con el contexto de quien recibió el rechazo.
        ejecutar: (_opciones, trabajo) =>
          trabajo({ referenciasDeError: { registrar: () => Promise.resolve() } }),
      },
      azar: () => new Uint8Array([1, 2, 3, 4]),
    },
  });

/** Cómo se llama a cada consulta, con una entrada VÁLIDA. Una consulta nueva obliga a sumar su fila. */
const LLAMADAS_DE_CONSULTAS: Record<
  keyof typeof DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA,
  (c: ConsultasDePlataforma) => Promise<unknown>
> = {
  listarTenants: (c) => c.listarTenants(comoAdministrador, {}),
  listarEmpresas: (c) => c.listarEmpresas(comoAdministrador, {}),
  listarAltasPendientes: (c) => c.listarAltasPendientes(comoAdministrador, {}),
  listarInvitaciones: (c) => c.listarInvitaciones(comoAdministrador, {}),
  listarTrabajosFallidos: (c) => c.listarTrabajosFallidos(comoAdministrador, {}),
  consultarAuditoria: (c) => c.consultarAuditoria(comoAdministrador, {}),
  verConfiguracion: (c) => c.verConfiguracion(comoAdministrador),
  catalogoDePerillas: (c) => c.catalogoDePerillas(comoAdministrador),
  buscarReferencia: (c) => c.buscarReferencia(comoAdministrador, { referencia: "PD-0000-0000" }),
};

/** Lo mismo para los casos de uso que pasan por el guard (los `sinGuard` se declaran y se explican aparte). */
const LLAMADAS_DE_CASOS: Record<
  Exclude<keyof typeof DECLARACIONES_DE_SOPORTE, "registrarReferenciaDeError">,
  (c: CasosDeUsoDeSoporte) => Promise<unknown>
> = {
  explicarPorQue: (c) =>
    c.explicarPorQue(comoAdministrador, {
      claveDeIdempotencia: "clave-de-prueba-0001",
      objetivo: {
        tipo: "ACCION",
        empresaId: uuid(1),
        persona: { por: "ID", personaId: uuid(2) },
        accion: "usuarios.invitar",
      },
    }),
};

/** Pasar el guard = tocar algo que no es la autorización, o terminar bien sin necesitar nada más. */
const pasoElGuard = async (llamada: Promise<unknown>): Promise<boolean> => {
  try {
    const r = (await llamada) as { ok: boolean };
    return r.ok;
  } catch (e) {
    if (e instanceof AccesoFueraDelGuard) return true;
    throw e;
  }
};

const todas = [
  ...Object.entries(LLAMADAS_DE_CONSULTAS).map(
    ([nombre, llamar]) => [nombre, (v: Vigilada) => llamar(consultasCon(v))] as const,
  ),
  ...Object.entries(LLAMADAS_DE_CASOS).map(
    ([nombre, llamar]) => [nombre, (v: Vigilada) => llamar(casosCon(v))] as const,
  ),
];

describe("el guard es lo primero de cada consulta y caso de uso de soporte", () => {
  it.each(todas)(
    "%s: sin administrador vigente responde SIN_PERMISO y no toca nada más",
    async (_n, llamar) => {
      const vigilada = vigilar(null);
      expect(await llamar(vigilada)).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(vigilada.accesos).toEqual(["autorizacionDePlataforma"]);
    },
  );

  it.each(todas)("%s: con ADMIN o SOPORTE pasa el guard", async (_n, llamar) => {
    for (const rol of ROLES_DE_PLATAFORMA) {
      const vigilada = vigilar(rol);
      expect(await pasoElGuard(llamar(vigilada)), rol).toBe(true);
      expect(vigilada.accesos[0], rol).toBe("autorizacionDePlataforma");
    }
  });

  it("el rechazo del guard gana sobre una entrada inválida", async () => {
    const vigilada = vigilar(null);
    const c = consultasCon(vigilada);
    expect(await c.listarTenants(comoAdministrador, { limite: 5000 })).toEqual({
      ok: false,
      error: "SIN_PERMISO",
    });
    expect(await c.buscarReferencia(comoAdministrador, { referencia: "mal" })).toEqual({
      ok: false,
      error: "SIN_PERMISO",
    });
    const casos = casosCon(vigilada);
    expect(
      await casos.explicarPorQue(comoAdministrador, {
        claveDeIdempotencia: "corta",
        objetivo: { tipo: "ACEPTACION", invitacionId: "x" },
      }),
    ).toEqual({ ok: false, error: "SIN_PERMISO" });
  });

  it("cada acción declarada es de las que puede ADMIN y SOPORTE, y los sinGuard explican por qué", () => {
    for (const declaracion of [
      ...Object.values(DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA),
      ...Object.values(DECLARACIONES_DE_SOPORTE),
    ]) {
      if ("accion" in declaracion) {
        expect(REGLAS_DE_PLATAFORMA.permisos[declaracion.accion]).toEqual(["ADMIN", "SOPORTE"]);
      } else {
        expect(declaracion.sinGuard.length).toBeGreaterThan(20);
      }
    }
  });
});
