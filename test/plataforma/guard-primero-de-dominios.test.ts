import { describe, expect, it } from "vitest";
import {
  REGLAS_DE_PLATAFORMA,
  ROLES_DE_PLATAFORMA,
  tablaDePermisosDePlataforma,
} from "../../src/capacidades/permisos/plataforma";
import {
  DECLARACIONES_DE_DOMINIOS,
  crearCasosDeUsoDeDominios,
  type CasosDeUsoDeDominios,
} from "../../src/plataforma/casos-de-uso/dominios";
import type { TxDeDominios } from "../../src/plataforma/casos-de-uso/dominios-comun";
import { comoAdministrador, conRol, uuid } from "./apoyo-de-soporte";

/**
 * Ningún caso de uso de dominios se salta el guard (ADR-003): corren contra una transacción VIGILADA en la que
 * solo `autorizacionDePlataforma` responde y cualquier otro acceso (el repositorio, la auditoría, la
 * idempotencia) queda registrado y corta la ejecución. Quien lee o escribe antes de autorizar, o no
 * autoriza, se delata solo. Sin base de datos.
 */

class AccesoFueraDelGuard extends Error {}

type Vigilada = Readonly<{ tx: TxDeDominios; accesos: string[] }>;

function vigilar(rol: "ADMIN" | "SOPORTE" | null): Vigilada {
  const accesos: string[] = [];
  const autorizacion = conRol(rol);
  const tx = new Proxy({} as TxDeDominios, {
    get(_objetivo, propiedad) {
      accesos.push(String(propiedad));
      if (propiedad === "autorizacionDePlataforma") return autorizacion;
      throw new AccesoFueraDelGuard(String(propiedad));
    },
  });
  return { tx, accesos };
}

const casosCon = (vigilada: Vigilada): CasosDeUsoDeDominios =>
  crearCasosDeUsoDeDominios({
    transacciones: { ejecutar: (_opciones, trabajo) => trabajo(vigilada.tx) },
    reglas: REGLAS_DE_PLATAFORMA,
  });

const CLAVE = "clave-de-guard-0001";
const base = { claveDeIdempotencia: CLAVE, dominioId: uuid(5) };

/** Cómo se llama a cada caso de uso, con una entrada VÁLIDA. Un caso nuevo obliga a sumar su fila. */
const LLAMADAS: Record<
  keyof typeof DECLARACIONES_DE_DOMINIOS,
  (c: CasosDeUsoDeDominios) => Promise<unknown>
> = {
  agregarDominio: (c) =>
    c.agregarDominio(comoAdministrador, {
      claveDeIdempotencia: CLAVE,
      host: "carta.ejemplo.com.ar",
      superficie: "CARTA",
      titular: "CLIENTE",
      esCanonico: false,
      duenio: { tipo: "MARCA", marcaId: uuid(1) },
    }),
  verificarDominio: (c) =>
    c.verificarDominio(comoAdministrador, {
      ...base,
      verificadoEn: new Date("2026-10-11T11:00:00Z"),
    }),
  activarDominio: (c) => c.activarDominio(comoAdministrador, base),
  desactivarDominio: (c) => c.desactivarDominio(comoAdministrador, base),
  retirarDominio: (c) => c.retirarDominio(comoAdministrador, { ...base, motivo: "se fue" }),
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

const todas = Object.entries(LLAMADAS);

describe("el guard es lo primero de cada caso de uso de dominios", () => {
  it.each(todas)(
    "%s: sin administrador vigente responde SIN_PERMISO y no toca nada más",
    async (_nombre, llamar) => {
      const vigilada = vigilar(null);
      expect(await llamar(casosCon(vigilada))).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(vigilada.accesos).toEqual(["autorizacionDePlataforma"]);
    },
  );

  it.each(todas)("%s: SOPORTE no pasa (solo ADMIN gestiona dominios)", async (_n, llamar) => {
    const vigilada = vigilar("SOPORTE");
    expect(await llamar(casosCon(vigilada))).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(vigilada.accesos).toEqual(["autorizacionDePlataforma"]);
  });

  it.each(todas)(
    "%s: ADMIN pasa el guard y recién entonces toca la transacción",
    async (_n, llamar) => {
      const vigilada = vigilar("ADMIN");
      expect(await pasoElGuard(llamar(casosCon(vigilada)))).toBe(true);
      expect(vigilada.accesos[0]).toBe("autorizacionDePlataforma");
      expect(vigilada.accesos.length).toBeGreaterThan(1);
    },
  );

  it("el rechazo del guard gana sobre una entrada inválida", async () => {
    const casos = casosCon(vigilar(null));
    expect(
      await casos.retirarDominio(comoAdministrador, {
        claveDeIdempotencia: "corta",
        dominioId: "x",
        motivo: "",
      }),
    ).toEqual({ ok: false, error: "SIN_PERMISO" });
  });

  it("cada acción declarada existe, es solo de ADMIN y no se repite entre casos", () => {
    const acciones = Object.values(DECLARACIONES_DE_DOMINIOS).map((d) => d.accion);
    expect(new Set(acciones).size).toBe(acciones.length);
    const tabla = tablaDePermisosDePlataforma(REGLAS_DE_PLATAFORMA.permisos);
    for (const accion of acciones) {
      expect(REGLAS_DE_PLATAFORMA.permisos[accion], accion).toEqual(["ADMIN"]);
      expect(tabla.ADMIN).toContain(accion);
      expect(tabla.SOPORTE).not.toContain(accion);
    }
    expect([...acciones].sort()).toEqual([
      "dominios.activar",
      "dominios.agregar",
      "dominios.desactivar",
      "dominios.retirar",
      "dominios.verificar",
    ]);
    expect(ROLES_DE_PLATAFORMA).toEqual(["ADMIN", "SOPORTE"]);
  });
});
