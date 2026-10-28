import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { puntoDeVentaId, reglaDeEmisorVigente } from "../../src/modulos/fiscal/publico";
import { emisorId, sucursalId } from "../../src/primitivas/identificadores/marca";
import { ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import { EmisionFalsa } from "../utilidades/emision-falsa";
import { crearBarrera, crearBaseAparte } from "./entorno";
import {
  casosDeConfiguracion,
  crearEntornoDeConfiguracion,
  crearEscenarioDeConfiguracion,
  domicilioNuevo,
  nuevoUuid,
  type EscenarioDeConfiguracion,
} from "./fiscal-configuracion-apoyo";
import { crearSerie } from "./fiscal-apoyo";
import { casosDeNumeracion, crearEntornoDeNumeracion, entradaDe } from "./fiscal-numeracion-apoyo";

/**
 * H7 T5: concurrencia REAL de la configuración fiscal del gerente. Cada prueba lanza varias llamadas a los casos de
 * uso a la vez (`Promise.all`, la misma persona desde varias pestañas o un doble clic: la empresa tiene un solo
 * gerente) y, con una barrera dentro de cada transacción (a la altura de la primera lectura que decide), fuerza que
 * TODAS hayan leído el mismo estado antes de que cualquiera escriba: es el cruce que importa. Después mira la base:
 * sin duplicados ni estados a medias (el domicilio, la versión y la auditoría van juntos o no van), una auditoría por
 * efecto, y quien pierde la carrera recibe un resultado con nombre (o el mismo éxito, si la acción era la misma), nunca
 * una excepción cruda ni un éxito falso. Se acepta `ConcurrenciaAgotada` del perdedor (el reintento serializable se
 * quedó sin intentos en una máquina cargada): no se exige un ganador exacto.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

const RONDAS = 4;
const AHORA = new Date("2026-10-11T12:00:00Z");
const DIA = 86_400_000;

type Fila = Record<string, unknown>;
type Cualquiera = Resultado<unknown, unknown>;

const codigoDe = (r: Cualquiera): string => {
  if (r.ok) return "ok";
  if (typeof r.error === "string") return r.error;
  const tipo = (r.error as { tipo?: unknown }).tipo;
  return typeof tipo === "string" ? tipo : "otro";
};
/** Los que perdieron la carrera por quedarse sin reintentos: no es un defecto, pero no cuenta como éxito. */
const agotada = (r: Cualquiera) => codigoDe(r) === "ConcurrenciaAgotada";

describe.skipIf(base === null)("fiscal T5: concurrencia de la configuración fiscal", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoDeConfiguracion>;
  let numeracion: ReturnType<typeof crearEntornoDeNumeracion>;
  let casos: ReturnType<typeof casosDeConfiguracion>;
  /** Mientras haya una barrera, toda transacción espera en ella al leer lo que decide, por primera vez. */
  let barrera: { donde: readonly string[]; esperar: () => Promise<void> } | null = null;
  const enBarrera = async (donde: string) => {
    if (barrera !== null && barrera.donde.includes(donde)) await barrera.esperar();
  };

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDeConfiguracion(propia.base, 16, (tx) => ({
      ...tx,
      datosFiscales: {
        ...tx.datosFiscales,
        obtenerBorrador: async (...args) => {
          const r = await tx.datosFiscales.obtenerBorrador(...args);
          await enBarrera("datos.obtenerBorrador");
          return r;
        },
        obtener: async (...args) => {
          const r = await tx.datosFiscales.obtener(...args);
          await enBarrera("datos.obtener");
          return r;
        },
      },
      reglasDeEmisor: {
        ...tx.reglasDeEmisor,
        confirmadas: async (...args) => {
          const r = await tx.reglasDeEmisor.confirmadas(...args);
          await enBarrera("reglas.confirmadas");
          return r;
        },
        obtener: async (...args) => {
          const r = await tx.reglasDeEmisor.obtener(...args);
          await enBarrera("reglas.obtener");
          return r;
        },
      },
      puntosDeVenta: {
        ...tx.puntosDeVenta,
        listarDelEmisor: async (...args) => {
          const r = await tx.puntosDeVenta.listarDelEmisor(...args);
          await enBarrera("pv.listarDelEmisor");
          return r;
        },
        obtener: async (...args) => {
          const r = await tx.puntosDeVenta.obtener(...args);
          await enBarrera("pv.obtener");
          return r;
        },
      },
      series: {
        ...tx.series,
        hayNumerosUsadosDelPuntoDeVenta: async (...args) => {
          const r = await tx.series.hayNumerosUsadosDelPuntoDeVenta(...args);
          await enBarrera("series.hayNumerosUsados");
          return r;
        },
      },
    }));
    numeracion = crearEntornoDeNumeracion(propia.base, 8, (tx) => ({
      ...tx,
      series: {
        ...tx.series,
        obtener: async (...args) => {
          const r = await tx.series.obtener(...args);
          await enBarrera("series.obtener");
          return r;
        },
      },
    }));
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    casos = casosDeConfiguracion(entorno);
  }, 120_000);
  afterAll(async () => {
    await dueno.end();
    await numeracion.cerrar();
    await entorno.cerrar();
    await propia.destruir();
  });

  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const cuenta = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);
  const auditorias = (empresa: string, accion: string) =>
    cuenta("select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2", [
      empresa,
      accion,
    ]);
  const domicilios = (empresa: string) =>
    cuenta("select count(*) as n from domicilio where empresa_id = $1", [empresa]);

  /** `n` llamadas a la vez; con `donde`, todas leen lo que decide antes de que cualquiera escriba. */
  async function enParalelo<T>(
    donde: string | readonly string[] | null,
    n: number,
    llamada: (i: number) => Promise<T>,
  ): Promise<T[]> {
    barrera =
      donde === null
        ? null
        : { donde: typeof donde === "string" ? [donde] : donde, esperar: crearBarrera(n) };
    try {
      return await Promise.all(Array.from({ length: n }, (_, i) => llamada(i)));
    } finally {
      barrera = null;
    }
  }

  const nuevo = () => crearEscenarioDeConfiguracion(dueno, { rol: "GERENTE" });

  const COMPLETOS = {
    razonSocial: "Coop Pampa SA",
    condicionIva: "RESPONSABLE_INSCRIPTO",
    inicioActividades: "2020-03-01",
  } as const;
  const guardar = (
    e: EscenarioDeConfiguracion,
    extra: Partial<Parameters<typeof casos.guardarBorradorDeDatosFiscales>[1]> = {},
  ) =>
    casos.guardarBorradorDeDatosFiscales(e.como(), {
      emisorId: emisorId(e.mundo.emisor),
      borradorId: nuevoUuid(),
      cambios: COMPLETOS,
      domicilio: domicilioNuevo(),
      ...extra,
    });
  const confirmar = (
    e: EscenarioDeConfiguracion,
    borradorId: string,
    versionEsperada: number,
    extra: Partial<Parameters<typeof casos.confirmarDatosFiscales>[1]> = {},
  ) =>
    casos.confirmarDatosFiscales(e.como(), {
      emisorId: emisorId(e.mundo.emisor),
      borradorId,
      versionEsperada,
      vigenteDesde: new Date(AHORA.getTime() + DIA),
      motivo: "Alta",
      ...extra,
    });
  const crearPv = (
    e: EscenarioDeConfiguracion,
    extra: Partial<Parameters<typeof casos.crearPuntoDeVenta>[1]> = {},
  ) =>
    casos.crearPuntoDeVenta(e.como(), {
      id: nuevoUuid(),
      emisorId: emisorId(e.mundo.emisor),
      sucursalId: sucursalId(e.mundo.sucursal),
      numero: 1,
      domicilio: domicilioNuevo(),
      ...extra,
    });
  const pvDe = async (e: EscenarioDeConfiguracion, numero = 1) => {
    const id = nuevoUuid();
    const r = await crearPv(e, { id, numero });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return { id, version: r.valor.version };
  };
  const regla = (
    e: EscenarioDeConfiguracion,
    extra: Partial<Parameters<typeof casos.confirmarReglaDeEmisor>[1]> = {},
  ) =>
    casos.confirmarReglaDeEmisor(e.como(), {
      versionId: nuevoUuid(),
      permitirEleccionManual: false,
      vigenteDesde: new Date(AHORA.getTime() + DIA),
      motivo: "Cambio",
      ...extra,
    });

  // ===============================================================================================
  describe("datos fiscales", () => {
    it("dos borradores con ids distintos a la vez: se crea UNO, el otro es YA_HAY_BORRADOR y no deja su domicilio", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await nuevo();
        const rs = await enParalelo("datos.obtenerBorrador", 3, () => guardar(e));
        const ganadoras = rs.filter((r) => r.ok);
        expect(ganadoras, `ronda ${ronda}`).toHaveLength(1);
        for (const r of rs.filter((x) => !x.ok)) {
          expect(["YA_HAY_BORRADOR", "ConcurrenciaAgotada"], `ronda ${ronda}`).toContain(
            codigoDe(r),
          );
        }
        expect(
          await cuenta("select count(*) as n from datos_fiscales where emisor_id = $1", [
            e.mundo.emisor,
          ]),
        ).toBe(1);
        expect(await domicilios(e.mundo.empresa)).toBe(1);
        expect(await auditorias(e.mundo.empresa, "DATOS_FISCALES_BORRADOR_GUARDADO")).toBe(1);
      }
    });

    it("el mismo borrador guardado varias veces a la vez (el doble clic): todas ok, UN efecto y UNA auditoría", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await nuevo();
        const borradorId = nuevoUuid();
        const domicilio = domicilioNuevo();
        const rs = await enParalelo("datos.obtenerBorrador", 4, () =>
          guardar(e, { borradorId, domicilio }),
        );
        for (const r of rs) expect(r.ok || agotada(r), `ronda ${ronda}: ${codigoDe(r)}`).toBe(true);
        expect(
          rs.filter((r) => r.ok && !r.valor.yaEstaba),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        expect(
          await cuenta("select count(*) as n from datos_fiscales where emisor_id = $1", [
            e.mundo.emisor,
          ]),
        ).toBe(1);
        expect(await domicilios(e.mundo.empresa)).toBe(1);
        expect(await auditorias(e.mundo.empresa, "DATOS_FISCALES_BORRADOR_GUARDADO")).toBe(1);
      }
    });

    it("dos ediciones del mismo borrador con la misma versión: gana UNA, la otra es VERSION_DESACTUALIZADA y no pisa nada", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await nuevo();
        const borradorId = nuevoUuid();
        const alta = await guardar(e, { borradorId });
        if (!alta.ok) throw new Error("no se guardó");
        const rs = await enParalelo("datos.obtenerBorrador", 2, (i) =>
          guardar(e, {
            borradorId,
            versionEsperada: alta.valor.version,
            cambios: { razonSocial: `Edición ${i}` },
            domicilio: undefined,
          }),
        );
        expect(
          rs.filter((r) => r.ok),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        const perdedora = rs.find((r) => !r.ok);
        expect(["VERSION_DESACTUALIZADA", "ConcurrenciaAgotada"]).toContain(
          perdedora === undefined ? "nada" : codigoDe(perdedora),
        );
        const [fila] = await filas<{ razon_social: string; version: number }>(
          "select razon_social, version from datos_fiscales where id = $1",
          [borradorId],
        );
        const gano = rs.findIndex((r) => r.ok);
        expect(fila).toEqual({ razon_social: `Edición ${gano}`, version: 2 });
        // La alta y una sola edición.
        expect(await auditorias(e.mundo.empresa, "DATOS_FISCALES_BORRADOR_GUARDADO")).toBe(2);
      }
    });

    it("confirmar el mismo borrador varias veces a la vez: todas ok, UNA lo confirma (número 1) y UNA auditoría", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await nuevo();
        const borradorId = nuevoUuid();
        const alta = await guardar(e, { borradorId });
        if (!alta.ok) throw new Error("no se guardó");
        const rs = await enParalelo("datos.obtener", 4, () =>
          confirmar(e, borradorId, alta.valor.version),
        );
        for (const r of rs) expect(r.ok || agotada(r), `ronda ${ronda}: ${codigoDe(r)}`).toBe(true);
        expect(
          rs.filter((r) => r.ok && !r.valor.yaEstaba),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        for (const r of rs) if (r.ok) expect(r.valor.numero).toBe(1);
        expect(
          await filas("select estado, numero from datos_fiscales where emisor_id = $1", [
            e.mundo.emisor,
          ]),
        ).toEqual([{ estado: "CONFIRMADA", numero: 1 }]);
        expect(await auditorias(e.mundo.empresa, "DATOS_FISCALES_CONFIRMADOS")).toBe(1);
      }
    });

    it("confirmar y editar el mismo borrador a la vez: o se confirma lo que la persona vio, o se edita; nunca las dos cosas", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await nuevo();
        const borradorId = nuevoUuid();
        const alta = await guardar(e, { borradorId });
        if (!alta.ok) throw new Error("no se guardó");
        const [confirmacion, edicion] = (await enParalelo<Cualquiera>(
          // La confirmación lee la versión por id; la edición, el borrador del emisor.
          ["datos.obtener", "datos.obtenerBorrador"],
          2,
          (i) =>
            i === 0
              ? confirmar(e, borradorId, alta.valor.version)
              : guardar(e, {
                  borradorId,
                  versionEsperada: alta.valor.version,
                  cambios: { razonSocial: "Editada a la vez SA" },
                  domicilio: undefined,
                }),
        )) as [Cualquiera, Cualquiera];
        const [fila] = await filas<{ estado: string; razon_social: string; version: number }>(
          "select estado, razon_social, version from datos_fiscales where id = $1",
          [borradorId],
        );
        if (codigoDe(confirmacion) === "ok") {
          // Se confirmó lo que la persona vio, y la edición (si entró antes) no pudo haberse perdido en silencio.
          expect(fila?.estado, `ronda ${ronda}`).toBe("CONFIRMADA");
          expect(fila?.razon_social).toBe("Coop Pampa SA");
          expect(["VERSION_CONFIRMADA_INMUTABLE", "ConcurrenciaAgotada"]).toContain(
            codigoDe(edicion),
          );
        } else {
          expect(["VERSION_DESACTUALIZADA", "ConcurrenciaAgotada"]).toContain(
            codigoDe(confirmacion),
          );
          expect(fila?.estado, `ronda ${ronda}`).toBe("BORRADOR");
          if (codigoDe(edicion) === "ok") {
            expect(fila).toMatchObject({ razon_social: "Editada a la vez SA", version: 2 });
          }
        }
      }
    });
  });

  // ===============================================================================================
  describe("regla del emisor", () => {
    it("dos confirmaciones con ids distintos a la vez: números 1 y 2 sin repetir, ningún borrador a medias y vigente determinista", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await nuevo();
        const rs = await enParalelo("reglas.confirmadas", 2, (i) =>
          regla(e, { permitirEleccionManual: i === 0 }),
        );
        for (const r of rs) expect(r.ok || agotada(r), `ronda ${ronda}: ${codigoDe(r)}`).toBe(true);
        const guardadas = await filas<{ numero: number; estado: string; permitir: boolean }>(
          `select numero, estado, permitir_eleccion_manual as permitir from regla_emisor
            where empresa_id = $1 order by numero nulls last`,
          [e.mundo.empresa],
        );
        const exitosas = rs.filter((r) => r.ok).length;
        expect(guardadas, `ronda ${ronda}`).toHaveLength(exitosas);
        expect(guardadas.map((g) => g.numero)).toEqual(
          Array.from({ length: exitosas }, (_, i) => i + 1),
        );
        expect(guardadas.every((g) => g.estado === "CONFIRMADA")).toBe(true);
        expect(await auditorias(e.mundo.empresa, "REGLA_DE_EMISOR_CONFIRMADA")).toBe(exitosas);
        // Con la misma vigencia gana el número mayor, siempre.
        const confirmadas = await entorno.ejecutar({ contexto: e.como() }, async (tx) =>
          ok(await tx.reglasDeEmisor.confirmadas(e.como().empresaId)),
        );
        if (!confirmadas.ok) throw new Error("no se pudo leer");
        const ultima = guardadas.at(-1);
        if (ultima !== undefined) {
          expect(
            reglaDeEmisorVigente(confirmadas.valor, new Date(AHORA.getTime() + 2 * DIA))
              .permitirEleccionManual,
          ).toBe(ultima.permitir);
        }
      }
    });

    it("la misma versión confirmada varias veces a la vez: todas ok, UNA fila y UNA auditoría", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await nuevo();
        const versionId = nuevoUuid();
        const rs = await enParalelo("reglas.obtener", 4, () => regla(e, { versionId }));
        for (const r of rs) expect(r.ok || agotada(r), `ronda ${ronda}: ${codigoDe(r)}`).toBe(true);
        expect(
          rs.filter((r) => r.ok && !r.valor.yaEstaba),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        expect(
          await cuenta("select count(*) as n from regla_emisor where empresa_id = $1", [
            e.mundo.empresa,
          ]),
        ).toBe(1);
        expect(await auditorias(e.mundo.empresa, "REGLA_DE_EMISOR_CONFIRMADA")).toBe(1);
      }
    });
  });

  // ===============================================================================================
  describe("puntos de venta", () => {
    it("el mismo número del mismo emisor con ids distintos a la vez: se crea UNO, los demás PUNTO_DE_VENTA_DUPLICADO sin su domicilio", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await nuevo();
        const rs = await enParalelo("pv.obtener", 3, () => crearPv(e, { numero: 5 }));
        expect(
          rs.filter((r) => r.ok),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        for (const r of rs.filter((x) => !x.ok)) {
          expect(["PUNTO_DE_VENTA_DUPLICADO", "ConcurrenciaAgotada"], `ronda ${ronda}`).toContain(
            codigoDe(r),
          );
        }
        expect(
          await cuenta("select count(*) as n from punto_de_venta where emisor_id = $1", [
            e.mundo.emisor,
          ]),
        ).toBe(1);
        expect(await domicilios(e.mundo.empresa)).toBe(1);
        expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_CREADO")).toBe(1);
      }
    });

    it("el mismo punto de venta dado de alta varias veces a la vez (el doble clic): todas ok, UNA fila y UNA auditoría", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await nuevo();
        const id = nuevoUuid();
        const domicilio = domicilioNuevo();
        const rs = await enParalelo("pv.obtener", 4, () =>
          crearPv(e, { id, numero: 2, domicilio }),
        );
        for (const r of rs) expect(r.ok || agotada(r), `ronda ${ronda}: ${codigoDe(r)}`).toBe(true);
        expect(
          rs.filter((r) => r.ok && !r.valor.yaExistia),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        expect(
          await cuenta("select count(*) as n from punto_de_venta where empresa_id = $1", [
            e.mundo.empresa,
          ]),
        ).toBe(1);
        expect(await domicilios(e.mundo.empresa)).toBe(1);
        expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_CREADO")).toBe(1);
      }
    });

    it("dos ediciones del mismo punto de venta con la misma versión: gana UNA, la otra es VERSION_DESACTUALIZADA", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await nuevo();
        const p = await pvDe(e);
        const rs = await enParalelo("pv.listarDelEmisor", 2, (i) =>
          casos.editarPuntoDeVenta(e.como(), {
            puntoDeVentaId: puntoDeVentaId(p.id),
            versionEsperada: p.version,
            numero: 10 + i,
          }),
        );
        expect(
          rs.filter((r) => r.ok),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        const perdedora = rs.find((r) => !r.ok);
        expect(["VERSION_DESACTUALIZADA", "ConcurrenciaAgotada"]).toContain(
          perdedora === undefined ? "nada" : codigoDe(perdedora),
        );
        const [fila] = await filas<{ numero: number; version: number }>(
          "select numero, version from punto_de_venta where id = $1",
          [p.id],
        );
        expect(fila).toEqual({ numero: 10 + rs.findIndex((r) => r.ok), version: 2 });
        expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_EDITADO")).toBe(1);
      }
    });

    it("activar varias veces a la vez: todas ok, UNA activa y UNA auditoría", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await nuevo();
        const p = await pvDe(e);
        const rs = await enParalelo("pv.obtener", 4, () =>
          casos.activarPuntoDeVenta(e.como(), { puntoDeVentaId: puntoDeVentaId(p.id) }),
        );
        for (const r of rs) expect(r.ok || agotada(r), `ronda ${ronda}: ${codigoDe(r)}`).toBe(true);
        expect(
          rs.filter((r) => r.ok && !r.valor.yaEstaba),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        expect(
          (await filas("select estado, version from punto_de_venta where id = $1", [p.id]))[0],
        ).toEqual({ estado: "ACTIVO", version: 2 });
        expect(await auditorias(e.mundo.empresa, "PUNTO_DE_VENTA_ACTIVADO")).toBe(1);
      }
    });

    it("activar y desactivar a la vez: el estado final es el de la última decisión y coincide con la auditoría", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await nuevo();
        const p = await pvDe(e);
        await casos.activarPuntoDeVenta(e.como(), { puntoDeVentaId: puntoDeVentaId(p.id) });
        const rs = await enParalelo("pv.obtener", 2, (i) =>
          i === 0
            ? casos.activarPuntoDeVenta(e.como(), { puntoDeVentaId: puntoDeVentaId(p.id) })
            : casos.desactivarPuntoDeVenta(e.como(), { puntoDeVentaId: puntoDeVentaId(p.id) }),
        );
        for (const r of rs) expect(r.ok || agotada(r), `ronda ${ronda}: ${codigoDe(r)}`).toBe(true);
        const [fila] = await filas<{ estado: string }>(
          "select estado from punto_de_venta where id = $1",
          [p.id],
        );
        const movimientos = await filas<{ accion: string }>(
          `select accion from auditoria_empresa
            where empresa_id = $1 and accion in ('PUNTO_DE_VENTA_ACTIVADO', 'PUNTO_DE_VENTA_DESACTIVADO')
            order by id`,
          [e.mundo.empresa],
        );
        const ultimo = movimientos.at(-1)?.accion;
        // Nada a medias: el estado es el que dejó el último movimiento auditado.
        expect(fila?.estado, `ronda ${ronda}`).toBe(
          ultimo === "PUNTO_DE_VENTA_DESACTIVADO" ? "INACTIVO" : "ACTIVO",
        );
        // Una persona que desactiva deja el punto de venta apagado o, si activó después, encendido: nunca otra cosa.
        expect(["ACTIVO", "INACTIVO"]).toContain(fila?.estado);
      }
    });

    it("cambiar el número mientras se reserva un número de su serie: o el cambio entra antes, o se rechaza; nunca queda a medias", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await nuevo();
        const p = await pvDe(e, 1);
        await casos.activarPuntoDeVenta(e.como(), { puntoDeVentaId: puntoDeVentaId(p.id) });
        await crearSerie(dueno, e.mundo.empresa, p.id, e.mundo.emisor, "FACTURA_B", 0);
        const [{ version }] = (await filas<{ version: number }>(
          "select version from punto_de_venta where id = $1",
          [p.id],
        )) as [{ version: number }];
        const numerar = casosDeNumeracion(numeracion, new EmisionFalsa());
        // La edición lee si la serie se usó y la reserva lee la serie: las dos antes de que cualquiera escriba.
        const [edicion, reserva] = (await enParalelo<Cualquiera>(
          ["series.hayNumerosUsados", "series.obtener"],
          2,
          (i) =>
            i === 0
              ? casos.editarPuntoDeVenta(e.como(), {
                  puntoDeVentaId: puntoDeVentaId(p.id),
                  versionEsperada: version,
                  numero: 2,
                })
              : numerar.reservarNumeroDeComprobante(e.como(), entradaDe({ puntoDeVenta: p.id })),
        )) as [Cualquiera, Cualquiera];
        expect(reserva.ok || agotada(reserva), `ronda ${ronda}: ${codigoDe(reserva)}`).toBe(true);
        expect(
          ["ok", "PUNTO_DE_VENTA_NUMERO_INMUTABLE", "ConcurrenciaAgotada"],
          `ronda ${ronda}`,
        ).toContain(codigoDe(edicion));
        const [pv] = await filas<{ numero: number }>(
          "select numero from punto_de_venta where id = $1",
          [p.id],
        );
        // El número cambió si y solo si la edición dijo que sí.
        expect(pv?.numero, `ronda ${ronda}`).toBe(edicion.ok ? 2 : 1);
        const [serie] = await filas<{ estado: string; en_curso: string | null }>(
          `select estado, numero_en_curso::text as en_curso from serie_comprobante
            where punto_de_venta_id = $1`,
          [p.id],
        );
        // La reserva, si entró, dejó la serie EN_CURSO con el número 1; si no, sigue LIBRE. Nunca a medias.
        expect(serie).toEqual(
          reserva.ok ? { estado: "EN_CURSO", en_curso: "1" } : { estado: "LIBRE", en_curso: null },
        );
        // Si se rechazó el cambio por números usados, fue porque la reserva ya había entrado.
        if (codigoDe(edicion) === "PUNTO_DE_VENTA_NUMERO_INMUTABLE") expect(reserva.ok).toBe(true);
      }
    });
  });
});
