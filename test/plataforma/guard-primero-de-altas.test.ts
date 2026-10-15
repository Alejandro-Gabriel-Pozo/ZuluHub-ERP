import { describe, expect, it } from "vitest";
import {
  REGLAS_DE_PLATAFORMA,
  tablaDePermisosDePlataforma,
} from "../../src/capacidades/permisos/plataforma";
import type { TxDeAlta } from "../../src/plataforma/casos-de-uso/alta-nucleo";
import {
  DECLARACIONES_DE_ALTAS,
  crearCasosDeUsoDeAltas,
  type CasosDeUsoDeAltas,
} from "../../src/plataforma/casos-de-uso/altas";
import { invitacionId } from "../../src/primitivas/identificadores/marca";
import { comoAdministrador, conRol, uuid } from "./apoyo-de-soporte";

/**
 * Ningún caso de uso del alta se salta el guard (ADR-003): corren contra una transacción VIGILADA en la que
 * solo `autorizacionDePlataforma` responde y cualquier otro acceso (los repositorios, la auditoría, la
 * idempotencia) queda registrado y corta la ejecución. Quien lee o escribe antes de autorizar, o no
 * autoriza, se delata solo. Sin base de datos.
 */

class AccesoFueraDelGuard extends Error {}

type Vigilada = Readonly<{ tx: TxDeAlta; accesos: string[] }>;

function vigilar(rol: "ADMIN" | "SOPORTE" | null): Vigilada {
  const accesos: string[] = [];
  const autorizacion = conRol(rol);
  const tx = new Proxy({} as TxDeAlta, {
    get(_objetivo, propiedad) {
      accesos.push(String(propiedad));
      if (propiedad === "autorizacionDePlataforma") return autorizacion;
      throw new AccesoFueraDelGuard(String(propiedad));
    },
  });
  return { tx, accesos };
}

const casosCon = (vigilada: Vigilada): CasosDeUsoDeAltas =>
  crearCasosDeUsoDeAltas({
    altaDeEmpresa: {
      transacciones: { ejecutar: (_opciones, trabajo) => trabajo(vigilada.tx) },
      reglas: REGLAS_DE_PLATAFORMA,
      tokens: {
        emitir: () => ({
          invitacionId: invitacionId(uuid(900)),
          token: "no-se-usa",
          tokenHash: "0".repeat(64),
        }),
      },
      catalogoDeModulos: {},
    },
    cancelarAlta: {
      transacciones: { ejecutar: (_opciones, trabajo) => trabajo(vigilada.tx) },
      reglas: REGLAS_DE_PLATAFORMA,
    },
    cancelarAltasVencidas: {
      transacciones: { ejecutar: (_opciones, trabajo) => trabajo(vigilada.tx) },
    },
    reenviarInvitacionDelAlta: {
      transacciones: { ejecutar: (_opciones, trabajo) => trabajo(vigilada.tx) },
      reglas: REGLAS_DE_PLATAFORMA,
      tokens: {
        emitir: () => ({
          invitacionId: invitacionId(uuid(901)),
          token: "no-se-usa",
          tokenHash: "0".repeat(64),
        }),
      },
    },
    revocarInvitacionDelAlta: {
      transacciones: { ejecutar: (_opciones, trabajo) => trabajo(vigilada.tx) },
      reglas: REGLAS_DE_PLATAFORMA,
    },
  });

const CLAVE = "clave-de-guard-0001";

/** Cómo se llama a cada caso de uso, con una entrada VÁLIDA. Un caso nuevo obliga a sumar su fila. */
const LLAMADAS: Record<
  Exclude<keyof typeof DECLARACIONES_DE_ALTAS, "cancelarAltasVencidas">,
  (c: CasosDeUsoDeAltas) => Promise<unknown>
> = {
  reenviarInvitacionDelAlta: (c) =>
    c.reenviarInvitacionDelAlta(comoAdministrador, {
      claveDeIdempotencia: CLAVE,
      empresaId: uuid(4),
    }),
  revocarInvitacionDelAlta: (c) =>
    c.revocarInvitacionDelAlta(comoAdministrador, {
      claveDeIdempotencia: CLAVE,
      empresaId: uuid(5),
    }),
  cancelarAlta: (c) =>
    c.cancelarAlta(comoAdministrador, {
      claveDeIdempotencia: CLAVE,
      empresaId: uuid(3),
      motivo: "se arrepintió",
    }),
  altaDeEmpresa: (c) =>
    c.altaDeEmpresa(comoAdministrador, {
      claveDeIdempotencia: CLAVE,
      nombreDeTenant: "Cliente",
      marcaId: uuid(1),
      cuit: "30-70308853-4",
      razonSocial: "Cliente S.A.",
      zonaHoraria: "America/Argentina/Buenos_Aires",
      moneda: "ARS",
      emailGerente: "gerente@cliente.test",
    }),
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
/** Reenviar y revocar la invitación del alta también los puede SOPORTE (destraba a un cliente sin mail). */
const LAS_DE_SOPORTE = ["reenviarInvitacionDelAlta", "revocarInvitacionDelAlta"];
const soloAdmin = todas.filter(([nombre]) => !LAS_DE_SOPORTE.includes(nombre));
const tambienSoporte = todas.filter(([nombre]) => LAS_DE_SOPORTE.includes(nombre));

describe("el guard es lo primero de cada caso de uso del alta", () => {
  it.each(todas)(
    "%s: sin administrador vigente responde SIN_PERMISO y no toca nada más",
    async (_nombre, llamar) => {
      const vigilada = vigilar(null);
      expect(await llamar(casosCon(vigilada))).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(vigilada.accesos).toEqual(["autorizacionDePlataforma"]);
    },
  );

  it.each(soloAdmin)("%s: SOPORTE no pasa (solo ADMIN)", async (_n, llamar) => {
    const vigilada = vigilar("SOPORTE");
    expect(await llamar(casosCon(vigilada))).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(vigilada.accesos).toEqual(["autorizacionDePlataforma"]);
  });

  it.each(tambienSoporte)("%s: SOPORTE sí pasa el guard", async (_n, llamar) => {
    const vigilada = vigilar("SOPORTE");
    expect(await pasoElGuard(llamar(casosCon(vigilada)))).toBe(true);
    expect(vigilada.accesos[0]).toBe("autorizacionDePlataforma");
    expect(vigilada.accesos.length).toBeGreaterThan(1);
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

  it("el rechazo del guard gana sobre una entrada inválida y sobre una clave mal formada", async () => {
    const casos = casosCon(vigilar(null));
    expect(
      await casos.altaDeEmpresa(comoAdministrador, {
        claveDeIdempotencia: "corta",
        cuit: "x",
        razonSocial: "",
        zonaHoraria: "",
        moneda: "",
        emailGerente: "",
      }),
    ).toEqual({ ok: false, error: "SIN_PERMISO" });
  });

  it("cada acción declarada existe y no se repite entre casos; solo reenviar y revocar el alta son también de SOPORTE", () => {
    // El barrido corre como el sistema y declara por qué no pasa por el guard.
    const { cancelarAltasVencidas, ...conGuard } = DECLARACIONES_DE_ALTAS;
    expect(cancelarAltasVencidas.sinGuard.length).toBeGreaterThan(20);
    const acciones = Object.values(conGuard).map((d) => d.accion);
    expect(new Set(acciones).size).toBe(acciones.length);
    const tabla = tablaDePermisosDePlataforma(REGLAS_DE_PLATAFORMA.permisos);
    for (const accion of acciones) {
      expect(tabla.ADMIN, accion).toContain(accion);
      const deSoporte =
        accion === "altas.reenviar_invitacion" || accion === "altas.revocar_invitacion";
      expect(tabla.SOPORTE.includes(accion), accion).toBe(deSoporte);
    }
    expect([...acciones].sort()).toEqual([
      "altas.cancelar",
      "altas.reenviar_invitacion",
      "altas.revocar_invitacion",
      "empresas.alta",
    ]);
  });
});
