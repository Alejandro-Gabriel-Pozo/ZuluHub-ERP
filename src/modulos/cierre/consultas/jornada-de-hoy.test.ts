import { describe, expect, it } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../../../test/utilidades/marcas";
import { empresaId, personaId, sucursalId } from "../../../primitivas/identificadores/marca";
import { fechaCivilDesdeTexto } from "../../../primitivas/tiempo/fecha-civil";
import { horaDelDiaDesdeTexto } from "../../../primitivas/tiempo/hora-del-dia";
import type { DatosDelActor } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { DatosDeJornada } from "../../empresas/publico";
import type { EstadoDeJornada } from "../estados";
import type { ClaveDeJornada } from "../persistencia/repositorio-de-jornadas";
import { crearConsultasDeCierre } from "./consultas";
import type { TxDeConsultasDeCierre } from "./contrato";

/**
 * `jornadaDeHoy` sin base de datos: el orden (guard, forma, alcance, y recién ahí leer), la cuenta de la fecha de negocio en la zona de
 * Argentina con instantes FIJOS (nunca el reloj real: un instante cerca de la medianoche haría fallar la prueba según la hora de la corrida)
 * y el cierre ante la duda (sin jornada: `SIN_ACTIVIDAD`; sucursal desconocida o zona o corte inválidos: error, nunca una fecha supuesta).
 */

const SUCURSAL = "11111111-1111-4111-8111-111111111111";
const GERENTE: DatosDelActor = {
  rol: "GERENTE",
  modulosActivados: ["cierre"],
  modulosHabilitados: ["cierre"],
};

/** La jornada tal como la devuelve el repositorio (las consultas no importan el dominio: se toma del puerto). */
type Jornada = NonNullable<Awaited<ReturnType<TxDeConsultasDeCierre["jornadas"]["obtener"]>>>;

const hora = (texto: string): DatosDeJornada["horaDeCorte"] => {
  const r = horaDelDiaDesdeTexto(texto);
  if (!r.ok) throw new Error(texto);
  return r.valor;
};
const ARGENTINA = "America/Argentina/Buenos_Aires";

const contextoEn = (instante: string): ContextoOperativo => ({
  tipo: "OPERATIVO",
  empresaId: empresaId("e-1"),
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date(instante),
});

type Fakes = Readonly<{
  actor?: DatosDelActor;
  alcance?: "TODAS" | readonly string[];
  datos?: DatosDeJornada | null;
  jornada?: EstadoDeJornada | null;
}>;

function consultasCon(fakes: Fakes = {}) {
  const accesos: string[] = [];
  const clavesLeidas: ClaveDeJornada[] = [];
  const tx = {
    autorizacion: {
      delActor: () => {
        accesos.push("delActor");
        return Promise.resolve(fakes.actor ?? GERENTE);
      },
      sucursalesDelActor: () => {
        accesos.push("sucursalesDelActor");
        return Promise.resolve(fakes.alcance ?? "TODAS");
      },
    },
    sucursales: {
      jornadaDe: () => {
        accesos.push("jornadaDe");
        const datos =
          fakes.datos === undefined
            ? { zonaHoraria: ARGENTINA, horaDeCorte: hora("00:00") }
            : fakes.datos;
        return Promise.resolve(datos);
      },
    },
    jornadas: {
      obtener: (clave: ClaveDeJornada) => {
        accesos.push("obtener");
        clavesLeidas.push(clave);
        const fecha = fechaCivilDesdeTexto("2026-11-09");
        if (!fecha.ok || fakes.jornada === undefined || fakes.jornada === null) {
          return Promise.resolve(null);
        }
        const jornada: Jornada = {
          empresaId: empresaId("e-1"),
          sucursalId: sucursalId(SUCURSAL),
          fechaDeNegocio: fecha.valor,
          estado: fakes.jornada,
          auditoriaIniciadaEn: null,
          auditoriaIniciadaPor: null,
          cerradaEn: null,
          cerradaPor: null,
          huellaDeCierre: null,
          observacion: null,
          version: 1,
        };
        return Promise.resolve(jornada);
      },
      listar: () => Promise.resolve([]),
      controlesGuardados: () => Promise.resolve([]),
    },
  } as unknown as TxDeConsultasDeCierre;
  const transacciones: Transacciones<TxDeConsultasDeCierre> = {
    ejecutar: (_opciones, trabajo) => trabajo(tx),
  };
  const consultas = crearConsultasDeCierre({
    transacciones,
    reglas: REGLAS_DE_EMPRESA,
    aportes: [],
  });
  return { consultas, accesos, clavesLeidas };
}

const hoy = (instante: string, fakes: Fakes = {}, sucursal: string = SUCURSAL) =>
  consultasCon(fakes).consultas.jornadaDeHoy(contextoEn(instante), { sucursalId: sucursal });

describe("jornadaDeHoy: la fecha de negocio es la de Argentina (UTC-3) y respeta el corte de la sucursal", () => {
  it("un segundo antes de la medianoche de Argentina todavía es el día anterior; a las 00:00 cambia", async () => {
    expect(await hoy("2026-11-10T02:59:59Z")).toEqual({
      ok: true,
      valor: { fechaDeNegocio: "2026-11-09", estado: "SIN_ACTIVIDAD" },
    });
    expect(await hoy("2026-11-10T03:00:00Z")).toEqual({
      ok: true,
      valor: { fechaDeNegocio: "2026-11-10", estado: "SIN_ACTIVIDAD" },
    });
  });

  it("el mismo instante de UTC en otro día civil no cambia la cuenta: 23:30 UTC ya es el día siguiente en UTC y todavía no en Argentina", async () => {
    // 2026-11-09T23:30Z = 20:30 del 9 en Argentina.
    expect(await hoy("2026-11-09T23:30:00Z")).toMatchObject({
      ok: true,
      valor: { fechaDeNegocio: "2026-11-09" },
    });
    // 2026-11-09T01:00Z = 22:00 del 8 en Argentina: UTC ya está en el 9 y la jornada sigue siendo la del 8.
    expect(await hoy("2026-11-09T01:00:00Z")).toMatchObject({
      ok: true,
      valor: { fechaDeNegocio: "2026-11-08" },
    });
  });

  it("con corte a las 04:00 la jornada anterior dura hasta las 04:00 de Argentina (07:00 UTC)", async () => {
    const corte = { datos: { zonaHoraria: ARGENTINA, horaDeCorte: hora("04:00") } };
    expect(await hoy("2026-11-10T06:59:59Z", corte)).toMatchObject({
      valor: { fechaDeNegocio: "2026-11-09" },
    });
    expect(await hoy("2026-11-10T07:00:00Z", corte)).toMatchObject({
      valor: { fechaDeNegocio: "2026-11-10" },
    });
  });

  it("cambio de mes y de año: el primero de enero a las 00:30 de Argentina es el 1 de enero; a las 02:59 UTC, 31 de diciembre", async () => {
    expect(await hoy("2027-01-01T03:30:00Z")).toMatchObject({
      valor: { fechaDeNegocio: "2027-01-01" },
    });
    expect(await hoy("2027-01-01T02:59:59Z")).toMatchObject({
      valor: { fechaDeNegocio: "2026-12-31" },
    });
  });
});

describe("jornadaDeHoy: el estado sale de la jornada de ESA fecha y, ante la duda, cierra", () => {
  it.each(["ABIERTA", "EN_AUDITORIA", "CERRADA"] as const)(
    "devuelve %s tal cual",
    async (estado) => {
      const { consultas, clavesLeidas } = consultasCon({ jornada: estado });
      expect(
        await consultas.jornadaDeHoy(contextoEn("2026-11-10T15:00:00Z"), { sucursalId: SUCURSAL }),
      ).toEqual({ ok: true, valor: { fechaDeNegocio: "2026-11-10", estado } });
      expect(clavesLeidas).toEqual([{ empresa: "e-1", sucursal: SUCURSAL, fecha: "2026-11-10" }]);
    },
  );

  it("sin jornada: SIN_ACTIVIDAD (no inventa una abierta)", async () => {
    expect(await hoy("2026-11-10T15:00:00Z", { jornada: null })).toEqual({
      ok: true,
      valor: { fechaDeNegocio: "2026-11-10", estado: "SIN_ACTIVIDAD" },
    });
  });

  it("sucursal que la lectura no encuentra (inexistente o de otra empresa): JORNADA_NO_ENCONTRADA, sin fecha", async () => {
    expect(await hoy("2026-11-10T15:00:00Z", { datos: null })).toEqual({
      ok: false,
      error: "JORNADA_NO_ENCONTRADA",
    });
  });

  it("zona u hora de corte inválidas: error, sin fecha ni estado", async () => {
    expect(
      await hoy("2026-11-10T15:00:00Z", {
        datos: { zonaHoraria: "Marte/Olimpo", horaDeCorte: hora("00:00") },
      }),
    ).toEqual({ ok: false, error: "ZONA_HORARIA_INVALIDA" });
    expect(
      await hoy("2026-11-10T15:00:00Z", {
        datos: { zonaHoraria: ARGENTINA, horaDeCorte: "25:99" as DatosDeJornada["horaDeCorte"] },
      }),
    ).toEqual({ ok: false, error: "HORA_DE_CORTE_INVALIDA" });
  });

  it("instante inválido: error, no una fecha", async () => {
    expect(await hoy("2026-11-10T15:00:00Z".replace("2026", "0000"))).toEqual({
      ok: false,
      error: "INSTANTE_INVALIDO",
    });
  });
});

describe("jornadaDeHoy: el guard y el alcance van antes de leer nada", () => {
  it("sin rol: SIN_PERMISO y no se toca la sucursal ni la jornada", async () => {
    const { consultas, accesos } = consultasCon({
      actor: { rol: null, modulosActivados: ["cierre"], modulosHabilitados: ["cierre"] },
    });
    expect(
      await consultas.jornadaDeHoy(contextoEn("2026-11-10T15:00:00Z"), { sucursalId: SUCURSAL }),
    ).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(accesos).toEqual(["delActor"]);
  });

  it("módulo de cierre no activado: MODULO_NO_ACTIVO sin leer nada más", async () => {
    const { consultas, accesos } = consultasCon({
      actor: { rol: "GERENTE", modulosActivados: [], modulosHabilitados: [] },
    });
    expect(
      await consultas.jornadaDeHoy(contextoEn("2026-11-10T15:00:00Z"), { sucursalId: SUCURSAL }),
    ).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
    expect(accesos).toEqual(["delActor"]);
  });

  it("sucursal fuera del alcance: SUCURSAL_FUERA_DE_ALCANCE y no se lee ni la zona ni la jornada", async () => {
    const { consultas, accesos } = consultasCon({
      actor: { rol: "OPERADOR", modulosActivados: ["cierre"], modulosHabilitados: ["cierre"] },
      alcance: [],
    });
    expect(
      await consultas.jornadaDeHoy(contextoEn("2026-11-10T15:00:00Z"), { sucursalId: SUCURSAL }),
    ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
    expect(accesos).toEqual(["delActor", "sucursalesDelActor"]);
  });

  it("una sucursal que no es un uuid se rechaza antes del alcance (lo que se PERMITE es un uuid)", async () => {
    for (const mala of ["", "x", "1; drop table jornada", SUCURSAL + "0", 42, null, undefined]) {
      const { consultas, accesos } = consultasCon();
      expect(
        await consultas.jornadaDeHoy(contextoEn("2026-11-10T15:00:00Z"), {
          sucursalId: mala as unknown as string,
        }),
        String(mala),
      ).toEqual({ ok: false, error: "JORNADA_NO_ENCONTRADA" });
      expect(accesos).toEqual(["delActor"]);
    }
  });

  it("con permiso y alcance, lee en ese orden: actor, alcance, zona y corte, jornada", async () => {
    const { consultas, accesos } = consultasCon();
    await consultas.jornadaDeHoy(contextoEn("2026-11-10T15:00:00Z"), { sucursalId: SUCURSAL });
    expect(accesos).toEqual(["delActor", "sucursalesDelActor", "jornadaDe", "obtener"]);
  });
});
