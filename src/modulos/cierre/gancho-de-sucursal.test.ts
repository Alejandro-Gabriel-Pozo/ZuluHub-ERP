import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../contexto/contexto";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../../test/utilidades/marcas";
import { empresaId, personaId, sucursalId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import { horaDelDiaDesdeTexto } from "../../primitivas/tiempo/hora-del-dia";
import type { RegistroDeAuditoria } from "../../puertos/auditoria";
import type { DatosDeJornada } from "../empresas/publico";
import {
  huellaDeControles,
  type AporteAlCierreDelDia,
  type ErrorDeAporte,
  type JornadaRef,
} from "./aporte-al-cierre";
import type { EstadoDeJornada } from "./dominio/jornada";
import { crearGanchoDeCierreAlDesactivar } from "./gancho-de-sucursal";

/** Decisión 178 sin base de datos: la jornada y los aportes son falsos y anotan lo que se les hizo. */

const EMPRESA = empresaId("e-1");
const SUCURSAL = sucursalId("s-1");
const PERSONA = personaId("p-1");
// 2026-11-10 05:00 UTC = 02:00 del 10 en Buenos Aires: con corte 04:00 todavía rige la jornada del 9.
const AHORA = new Date("2026-11-10T05:00:00Z");
const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: EMPRESA,
  personaId: PERSONA,
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: AHORA,
};
const corte = horaDelDiaDesdeTexto("04:00");
if (!corte.ok) throw new Error("la hora de prueba es válida");
const DATOS: DatosDeJornada = {
  zonaHoraria: "America/Argentina/Buenos_Aires",
  horaDeCorte: corte.valor,
};
const FECHA_VIGENTE = "2026-11-09";

const REGLAS: ReglasDeEmpresa = {
  catalogo: { ...CATALOGO_DE_MODULOS, caja: { ...CATALOGO_DE_MODULOS.caja, estado: "disponible" } },
  permisos: PERMISOS_DE_EMPRESA,
};

type Tx = Parameters<
  ReturnType<typeof crearGanchoDeCierreAlDesactivar<unknown>>["alDesactivarSucursalEnTx"]
>[0];

type Mundo = {
  jornada: { estado: EstadoDeJornada } | null;
  modulosActivados: string[];
  llamadas: string[];
  auditoria: RegistroDeAuditoria[];
  clavesPedidas: unknown[];
};

function armar(
  jornada: Mundo["jornada"],
  modulosActivados: string[] = ["caja"],
): { mundo: Mundo; tx: Tx } {
  const mundo: Mundo = {
    jornada,
    modulosActivados,
    llamadas: [],
    auditoria: [],
    clavesPedidas: [],
  };
  const tx = {
    autorizacion: {
      delActor: () =>
        Promise.resolve({
          rol: "GERENTE",
          modulosActivados: mundo.modulosActivados,
          modulosHabilitados: mundo.modulosActivados,
        }),
    },
    jornadas: {
      bloquearParaCambiar: (clave: unknown) => {
        mundo.clavesPedidas.push(clave);
        mundo.llamadas.push("bloquear");
        return Promise.resolve(mundo.jornada);
      },
      iniciarAuditoria: (_c: unknown, persona: string, ahora: Date) => {
        mundo.llamadas.push(`iniciar:${persona}:${ahora.toISOString()}`);
        return Promise.resolve();
      },
      cerrar: (_c: unknown, persona: string, ahora: Date, huella: string, obs: string | null) => {
        mundo.llamadas.push(`cerrar:${persona}:${ahora.toISOString()}:${huella}:${String(obs)}`);
        return Promise.resolve();
      },
    },
    auditoria: {
      registrar: (registro: RegistroDeAuditoria) => {
        mundo.auditoria.push(registro);
        return Promise.resolve();
      },
    },
  };
  return { mundo, tx: tx as unknown as Tx };
}

function aporte(
  modulo: string,
  respuesta: Resultado<boolean, ErrorDeAporte> | (() => never),
  preguntas: JornadaRef[] = [],
): AporteAlCierreDelDia<unknown> {
  return {
    modulo,
    hayMovimiento: (_tx, jornada) => {
      preguntas.push(jornada);
      return Promise.resolve(typeof respuesta === "function" ? respuesta() : respuesta);
    },
    impedimentos: () => Promise.resolve(ok([])),
    controles: () => Promise.resolve(ok([])),
    congelarEnTx: () => Promise.resolve(ok(null)),
  };
}

const sucursal = { sucursalId: SUCURSAL, nombre: "Centro" };
const correr = (tx: Tx, aportes: AporteAlCierreDelDia<unknown>[], ctx = contexto, datos = DATOS) =>
  crearGanchoDeCierreAlDesactivar<unknown>({ reglas: REGLAS, aportes }).alDesactivarSucursalEnTx(
    tx,
    ctx,
    sucursal,
    datos,
  );

describe("el gancho de cierre al desactivar una sucursal (decisión 178)", () => {
  it("toma la jornada VIGENTE (fecha de negocio con la zona y el corte de la sucursal) con FOR UPDATE", async () => {
    const { mundo, tx } = armar(null);
    expect(await correr(tx, [])).toEqual({ ok: true, valor: null });
    expect(mundo.clavesPedidas).toEqual([
      { empresa: EMPRESA, sucursal: SUCURSAL, fecha: FECHA_VIGENTE },
    ]);
  });

  it("sin jornada o con la jornada cerrada: no pregunta nada a los aportes ni escribe", async () => {
    for (const jornada of [null, { estado: "CERRADA" as const }]) {
      const preguntas: JornadaRef[] = [];
      const { mundo, tx } = armar(jornada);
      const resultado = await correr(tx, [aporte("caja", ok(true), preguntas)]);
      expect(resultado).toEqual({ ok: true, valor: null });
      expect(preguntas).toEqual([]);
      expect(mundo.llamadas).toEqual(["bloquear"]);
      expect(mundo.auditoria).toEqual([]);
    }
  });

  it("en auditoría: se rechaza sin preguntar a los aportes ni escribir", async () => {
    const preguntas: JornadaRef[] = [];
    const { mundo, tx } = armar({ estado: "EN_AUDITORIA" });
    const resultado = await correr(tx, [aporte("caja", ok(false), preguntas)]);
    expect(resultado).toEqual({ ok: false, error: "SUCURSAL_CON_JORNADA_EN_AUDITORIA" });
    expect(preguntas).toEqual([]);
    expect(mundo.llamadas).toEqual(["bloquear"]);
    expect(mundo.auditoria).toEqual([]);
  });

  it("abierta con movimiento: se rechaza pidiendo el cierre del día y no escribe", async () => {
    const { mundo, tx } = armar({ estado: "ABIERTA" });
    const resultado = await correr(tx, [aporte("caja", ok(true))]);
    expect(resultado).toEqual({ ok: false, error: "SUCURSAL_CON_MOVIMIENTO_EN_LA_JORNADA" });
    expect(mundo.llamadas).toEqual(["bloquear"]);
    expect(mundo.auditoria).toEqual([]);
  });

  it("alcanza con que UN módulo tenga movimiento, y se les pregunta la jornada vigente completa", async () => {
    const preguntas: JornadaRef[] = [];
    const { mundo, tx } = armar({ estado: "ABIERTA" }, ["caja", "cierre"]);
    const resultado = await correr(tx, [
      aporte("caja", ok(false), preguntas),
      aporte("cierre", ok(true), preguntas),
    ]);
    expect(resultado).toEqual({ ok: false, error: "SUCURSAL_CON_MOVIMIENTO_EN_LA_JORNADA" });
    expect(preguntas).toEqual([
      { empresaId: EMPRESA, sucursalId: SUCURSAL, fechaDeNegocio: FECHA_VIGENTE },
      { empresaId: EMPRESA, sucursalId: SUCURSAL, fechaDeNegocio: FECHA_VIGENTE },
    ]);
    expect(mundo.llamadas).toEqual(["bloquear"]);
  });

  it("un aporte que no responde rechaza (falla cerrado) y nunca se asume «sin movimiento»", async () => {
    const { mundo, tx } = armar({ estado: "ABIERTA" });
    const resultado = await correr(tx, [aporte("caja", err("APORTE_NO_DISPONIBLE"))]);
    expect(resultado).toEqual({ ok: false, error: "JORNADA_NO_VERIFICABLE" });
    expect(mundo.llamadas).toEqual(["bloquear"]);
    expect(mundo.auditoria).toEqual([]);
  });

  it("un aporte que lanza una excepción no se traga: sale tal cual (la transacción se revierte)", async () => {
    const { tx } = armar({ estado: "ABIERTA" });
    const roto = aporte("caja", () => {
      throw new Error("falla de la base");
    });
    await expect(correr(tx, [roto])).rejects.toThrow("falla de la base");
  });

  it("abierta sin movimiento: pasa por EN_AUDITORIA a CERRADA con quien desactiva y su ahora, y lo audita", async () => {
    const { mundo, tx } = armar({ estado: "ABIERTA" });
    const resultado = await correr(tx, [aporte("caja", ok(false))]);
    expect(resultado).toEqual({ ok: true, valor: null });
    const huella = huellaDeControles([]);
    expect(mundo.llamadas).toEqual([
      "bloquear",
      `iniciar:${PERSONA}:${AHORA.toISOString()}`,
      `cerrar:${PERSONA}:${AHORA.toISOString()}:${huella}:null`,
    ]);
    expect(mundo.auditoria).toEqual([
      {
        empresaId: EMPRESA,
        actorPersonaId: PERSONA,
        accion: "JORNADA_CERRADA_AL_DESACTIVAR_SUCURSAL",
        entidad: "jornada",
        entidadId: `${SUCURSAL}:${FECHA_VIGENTE}`,
        antes: { estado: "ABIERTA" },
        despues: { estado: "CERRADA", huella, sucursal: "Centro" },
      },
    ]);
  });

  it("sin ningún aporte activo (módulo apagado, en desarrollo o sin aporte) la abierta sin movimiento se cierra sola", async () => {
    const preguntas: JornadaRef[] = [];
    const apagado = armar({ estado: "ABIERTA" }, []);
    expect(await correr(apagado.tx, [aporte("caja", ok(true), preguntas)])).toEqual({
      ok: true,
      valor: null,
    });
    expect(preguntas).toEqual([]);
    expect(apagado.mundo.auditoria).toHaveLength(1);
  });

  it("sin persona o con una zona que no se puede fechar: no verifica nada y rechaza", async () => {
    const sinPersona = armar({ estado: "ABIERTA" });
    expect(await correr(sinPersona.tx, [], { ...contexto, personaId: null })).toEqual({
      ok: false,
      error: "JORNADA_NO_VERIFICABLE",
    });
    const sinZona = armar({ estado: "ABIERTA" });
    expect(
      await correr(sinZona.tx, [], contexto, { ...DATOS, zonaHoraria: "no-es-una-zona" }),
    ).toEqual({
      ok: false,
      error: "JORNADA_NO_VERIFICABLE",
    });
    expect(sinPersona.mundo.llamadas).toEqual([]);
    expect(sinZona.mundo.llamadas).toEqual([]);
  });

  it("dos aportes del mismo módulo son un error de armado (lanza al crear el gancho)", () => {
    expect(() =>
      crearGanchoDeCierreAlDesactivar<unknown>({
        reglas: REGLAS,
        aportes: [aporte("caja", ok(false)), aporte("caja", ok(false))],
      }),
    ).toThrow(RangeError);
  });
});
