import { describe, expect, it } from "vitest";
import {
  CATALOGO_DE_PLATAFORMA,
  PERMISOS_DE_PLATAFORMA,
  type ClaveAccionDePlataforma,
} from "./plataforma";
import {
  CODIGO_DE_SEGUNDO_FACTOR_RECIENTE_REQUERIDO,
  accionesConSegundoFactorReciente,
  decidirSegundoFactorRecienteDeLaAccion,
  exigeSegundoFactorReciente,
} from "./segundo-factor-reciente";

/**
 * El segundo factor RECIENTE por acción (h5-p8 §2.4 bis; DECIDIDO por el dueño el 2026-10-20). La lista de lo que lo
 * exige está escrita acá A MANO, tal como la dijo el dueño: si alguien cambia una marca del catálogo, esta prueba falla
 * y el dueño lee la diferencia.
 */

const MINUTO = 60_000;
const AHORA = new Date("2026-10-20T12:00:00.000Z");
const hace = (ms: number) => new Date(AHORA.getTime() - ms);

/** Lo que el dueño dijo que exige el segundo factor reciente, una acción del catálogo por renglón. */
const EXIGEN = [
  "altas.cancelar", // cancelar alta
  "dominios.activar", // activar dominio
  "dominios.agregar", // agregar dominio
  "dominios.desactivar", // desactivar dominio
  "dominios.retirar", // retirar dominio
  "dominios.verificar", // verificar dominio
  "empresas.alta", // alta de empresa
  "empresas.reactivar", // reactivar empresa
  "empresas.suspender", // suspender empresa
  "marcas.confirmar_version", // confirmar versión de marca
  "modulos_de_empresa.activar", // activar módulo de empresa
  "modulos_de_empresa.desactivar", // desactivar módulo de empresa
  "perillas.ajustar", // ajustar perilla
  "personas.reactivar", // reactivar persona
  "personas.suspender", // suspender persona
  "planes.asignar", // asignar plan y migrar tenants de versión (una sola acción)
  "planes.publicar_version", // publicar versión de plan
  "tenants.reactivar", // reactivar tenant
  "tenants.suspender", // suspender tenant
] as const satisfies readonly ClaveAccionDePlataforma[];

/** Lo que NO lo exige, también a mano: lecturas, borradores, crear marca y plan, la invitación del alta y explicar. */
const NO_EXIGEN = [
  "auditoria.ver",
  "altas.reenviar_invitacion", // reenviar la invitación del alta
  "altas.revocar_invitacion", // revocar la invitación del alta
  "configuracion.ver",
  "empresas.ver",
  "invitaciones.ver",
  "marcas.crear", // criterio del ingeniero: sin efecto sobre clientes hasta confirmar la versión
  "marcas.editar_borrador", // guardar borrador de marca
  "marcas.ver",
  "planes.crear", // criterio del ingeniero: sin efecto sobre clientes hasta publicar
  "planes.editar_borrador", // guardar borrador de plan
  "planes.ver",
  "soporte.buscar_referencia",
  "soporte.explicar", // explicar por qué
  "tenants.ver",
  "trabajos.ver_fallidos",
] as const satisfies readonly ClaveAccionDePlataforma[];

const TODAS = Object.keys(CATALOGO_DE_PLATAFORMA.plataforma.acciones) as ClaveAccionDePlataforma[];

describe("el catálogo declara el indicador en TODAS las acciones", () => {
  it("cada acción del catálogo tiene `segundoFactorReciente` declarado (true o false), ninguna sin declarar", () => {
    expect(TODAS.length).toBe(35);
    for (const accion of TODAS) {
      const definicion = CATALOGO_DE_PLATAFORMA.plataforma.acciones[accion] as Record<
        string,
        unknown
      >;
      expect(typeof definicion["segundoFactorReciente"], accion).toBe("boolean");
    }
  });

  it("el catálogo, la matriz de permisos y las dos listas escritas a mano tratan exactamente las mismas acciones", () => {
    expect([...TODAS].sort()).toEqual(Object.keys(PERMISOS_DE_PLATAFORMA).sort());
    expect([...EXIGEN, ...NO_EXIGEN].sort()).toEqual([...TODAS].sort());
    expect(new Set([...EXIGEN, ...NO_EXIGEN]).size).toBe(TODAS.length);
  });

  it("las que lo exigen son EXACTAMENTE las que dijo el dueño (19), ni una más ni una menos", () => {
    expect(EXIGEN).toHaveLength(19);
    expect(accionesConSegundoFactorReciente()).toEqual([...EXIGEN].sort());
  });

  it("las que NO lo exigen son las 16 restantes", () => {
    expect(NO_EXIGEN).toHaveLength(16);
    expect(TODAS.filter((a) => !exigeSegundoFactorReciente(a)).sort()).toEqual(
      [...NO_EXIGEN].sort(),
    );
  });

  it.each(EXIGEN)("%s lo exige", (accion) => {
    expect(exigeSegundoFactorReciente(accion)).toBe(true);
  });

  it.each(NO_EXIGEN)("%s no lo exige", (accion) => {
    expect(exigeSegundoFactorReciente(accion)).toBe(false);
  });

  it("toda lectura (efecto LECTURA) no lo exige, salvo que alguien lo decida a propósito", () => {
    for (const accion of TODAS) {
      if (CATALOGO_DE_PLATAFORMA.plataforma.acciones[accion].efecto === "LECTURA") {
        expect(exigeSegundoFactorReciente(accion), accion).toBe(false);
      }
    }
  });

  it("una acción que el catálogo no declara se EXIGE (nunca se omite por un defecto)", () => {
    expect(exigeSegundoFactorReciente("no.existe" as ClaveAccionDePlataforma)).toBe(true);
  });
});

describe("decidirSegundoFactorRecienteDeLaAccion", () => {
  it("el código es el de la lista cerrada de la consola", () => {
    expect(CODIGO_DE_SEGUNDO_FACTOR_RECIENTE_REQUERIDO).toBe("segundo_factor_reciente_requerido");
  });

  it.each(NO_EXIGEN)("%s pasa con cualquier segundo factor, hasta sin él", (accion) => {
    for (const marca of [null, hace(0), hace(60 * MINUTO), new Date("no es una fecha")]) {
      expect(decidirSegundoFactorRecienteDeLaAccion(accion, marca, AHORA)).toEqual({
        ok: true,
        valor: null,
      });
    }
  });

  it.each(EXIGEN)("%s pasa con el segundo factor de hasta 5 minutos justos", (accion) => {
    for (const marca of [hace(0), hace(MINUTO), hace(5 * MINUTO)]) {
      expect(decidirSegundoFactorRecienteDeLaAccion(accion, marca, AHORA)).toEqual({
        ok: true,
        valor: null,
      });
    }
  });

  it.each(EXIGEN)(
    "%s se rechaza con 5 minutos y un milisegundo, hace una hora, sin él o inválido",
    (accion) => {
      const rechazo = { ok: false, error: "segundo_factor_reciente_requerido" };
      for (const marca of [
        hace(5 * MINUTO + 1),
        hace(60 * MINUTO),
        hace(8 * 60 * MINUTO),
        null,
        new Date("no es una fecha"),
        hace(-24 * 60 * MINUTO),
      ]) {
        expect(decidirSegundoFactorRecienteDeLaAccion(accion, marca, AHORA), String(marca)).toEqual(
          rechazo,
        );
      }
    },
  );

  it("un reloj inválido rechaza las acciones que lo exigen y deja pasar a las que no", () => {
    const roto = new Date("no es una fecha");
    expect(decidirSegundoFactorRecienteDeLaAccion("empresas.alta", hace(0), roto).ok).toBe(false);
    expect(decidirSegundoFactorRecienteDeLaAccion("empresas.ver", hace(0), roto).ok).toBe(true);
  });
});
