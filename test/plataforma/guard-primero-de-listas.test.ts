import { describe, expect, it } from "vitest";
import {
  CATALOGO_DE_PLATAFORMA,
  PERMISOS_DE_PLATAFORMA,
  REGLAS_DE_PLATAFORMA,
} from "../../src/capacidades/permisos/plataforma";
import type { TxDeListas } from "../../src/plataforma/casos-de-uso/listas-comun";
import {
  DECLARACIONES_DE_LISTAS,
  crearCasosDeUsoDeListas,
  type CasosDeUsoDeListas,
} from "../../src/plataforma/casos-de-uso/listas-del-sistema";
import {
  DECLARACIONES_DE_CONSULTAS_DE_LISTAS,
  crearConsultasDeListas,
  type ConsultasDeListas,
  type TxDeConsultasDeListas,
} from "../../src/plataforma/consultas/consultas-de-listas";
import { comoAdministrador, conRol, uuid } from "./apoyo-de-soporte";

/**
 * Ningún caso de uso ni consulta de las listas del sistema se salta el guard (ADR-003): corren contra una transacción VIGILADA en la que
 * solo `autorizacionDePlataforma` responde y cualquier otro acceso (el repositorio, la auditoría, la idempotencia) queda registrado y
 * corta la ejecución. Quien lee o escribe antes de autorizar, o no autoriza, se delata solo. Sin base de datos.
 */

class AccesoFueraDelGuard extends Error {}

type TxVigilada = TxDeListas & TxDeConsultasDeListas;
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

const casosCon = (vigilada: Vigilada): CasosDeUsoDeListas =>
  crearCasosDeUsoDeListas({
    transacciones: transaccionesDe(vigilada),
    reglas: REGLAS_DE_PLATAFORMA,
  });
const consultasCon = (vigilada: Vigilada): ConsultasDeListas =>
  crearConsultasDeListas({
    transacciones: transaccionesDe(vigilada),
    reglas: REGLAS_DE_PLATAFORMA,
  });

const CLAVE = "clave-de-guard-0001";

/** Cómo se llama a cada caso de uso, con una entrada VÁLIDA. Un caso nuevo obliga a sumar su fila. */
const LLAMADAS: Record<
  keyof typeof DECLARACIONES_DE_LISTAS,
  (c: CasosDeUsoDeListas) => Promise<unknown>
> = {
  agregarValorDeLista: (c) =>
    c.agregarValorDeLista(comoAdministrador, {
      claveDeIdempotencia: CLAVE,
      lista: "MARCAS_DE_TARJETA",
      nombre: "Diners Club",
    }),
  corregirNombreDeValor: (c) =>
    c.corregirNombreDeValor(comoAdministrador, {
      claveDeIdempotencia: CLAVE,
      valorId: uuid(1),
      nombre: "Visa Débito",
      versionEsperada: 1,
    }),
  desactivarValorDeLista: (c) =>
    c.desactivarValorDeLista(comoAdministrador, {
      claveDeIdempotencia: CLAVE,
      valorId: uuid(1),
      versionEsperada: 1,
    }),
  reactivarValorDeLista: (c) =>
    c.reactivarValorDeLista(comoAdministrador, {
      claveDeIdempotencia: CLAVE,
      valorId: uuid(1),
      versionEsperada: 1,
    }),
};

const CONSULTAS: Record<
  keyof typeof DECLARACIONES_DE_CONSULTAS_DE_LISTAS,
  (c: ConsultasDeListas) => Promise<unknown>
> = {
  listarValoresDeLista: (c) => c.listarValoresDeLista(comoAdministrador, { lista: null }),
};

/** Pasar el guard = tocar algo que no es la autorización. */
const pasoElGuard = async (llamada: Promise<unknown>): Promise<boolean> => {
  try {
    return ((await llamada) as { ok: boolean }).ok;
  } catch (e) {
    if (e instanceof AccesoFueraDelGuard) return true;
    throw e;
  }
};

const casos = Object.entries(LLAMADAS);
const consultas = Object.entries(CONSULTAS);

describe("el guard es lo primero de cada caso de uso de las listas del sistema", () => {
  it.each(casos)(
    "%s: sin administrador vigente responde SIN_PERMISO y no toca nada más",
    async (_nombre, llamar) => {
      const vigilada = vigilar(null);
      expect(await llamar(casosCon(vigilada))).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(vigilada.accesos).toEqual(["autorizacionDePlataforma"]);
    },
  );

  it.each(casos)("%s: SOPORTE no pasa (solo ADMIN edita las listas)", async (_n, llamar) => {
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

  it.each(casos)(
    "%s: el guard va ANTES de mirar la entrada (una entrada inválida de quien no puede es SIN_PERMISO)",
    async (nombre) => {
      const vigilada = vigilar("SOPORTE");
      const casosVigilados = casosCon(vigilada) as unknown as Record<
        string,
        (contexto: unknown, entrada: unknown) => Promise<unknown>
      >;
      expect(await casosVigilados[nombre]?.(comoAdministrador, {})).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
      expect(vigilada.accesos).toEqual(["autorizacionDePlataforma"]);
    },
  );

  it("cada caso exige la acción declarada, y esa acción del catálogo es la de editar", () => {
    for (const [nombre, declaracion] of Object.entries(DECLARACIONES_DE_LISTAS)) {
      expect(declaracion.accion, nombre).toBe("listas.editar");
    }
    expect(PERMISOS_DE_PLATAFORMA["listas.editar"]).toEqual(["ADMIN"]);
    expect(CATALOGO_DE_PLATAFORMA.plataforma.acciones["listas.editar"].efecto).toBe("CREA_AMPLIA");
  });
});

describe("el guard es lo primero de la consulta de las listas del sistema", () => {
  it.each(consultas)("%s: sin administrador vigente responde SIN_PERMISO", async (_n, llamar) => {
    const vigilada = vigilar(null);
    expect(await llamar(consultasCon(vigilada))).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(vigilada.accesos).toEqual(["autorizacionDePlataforma"]);
  });

  it.each(consultas)("%s: ADMIN y SOPORTE pasan el guard (`listas.ver`)", async (_n, llamar) => {
    for (const rol of ["ADMIN", "SOPORTE"] as const) {
      const vigilada = vigilar(rol);
      expect(await pasoElGuard(llamar(consultasCon(vigilada))), rol).toBe(true);
      expect(vigilada.accesos[0]).toBe("autorizacionDePlataforma");
    }
    expect(DECLARACIONES_DE_CONSULTAS_DE_LISTAS.listarValoresDeLista.accion).toBe("listas.ver");
    expect(PERMISOS_DE_PLATAFORMA["listas.ver"]).toEqual(["ADMIN", "SOPORTE"]);
  });

  it("una lista inválida de quien no puede ver es SIN_PERMISO, no LISTA_INVALIDA", async () => {
    const vigilada = vigilar(null);
    expect(
      await consultasCon(vigilada).listarValoresDeLista(comoAdministrador, { lista: "NO_EXISTE" }),
    ).toEqual({ ok: false, error: "SIN_PERMISO" });
  });
});
