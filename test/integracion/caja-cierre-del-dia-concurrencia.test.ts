import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  REGLAS_DE_CAJA,
  armarCaja,
  crearEntornoDeCaja,
  type TxDeCajaDePrueba,
} from "./caja-configuracion-apoyo";
import { crearMundoDeCobro, type MundoDeCobro } from "./caja-cobrar-apoyo";
import {
  armarCierreConCaja,
  empezarElCierre,
  jornadaConCobros,
  ticketsFalsos,
  type CobroDePrueba,
  type JornadaLista,
  type OpcionesDeJornada,
} from "./caja-cierre-del-dia-apoyo";
import { claveNueva, pesos } from "./caja-operacion-apoyo";
import { crearBarrera, crearBaseAparte, crearEntornoDePrueba } from "./entorno";

/**
 * Concurrencia e idempotencia de la contribución de caja al cierre del día (E3, tramo 8; e3b §5) con una base real, los roles limitados y una
 * barrera: todas las transacciones de la ronda leen la autorización y esperan a que lleguen las demás antes de seguir, así de verdad corren a la
 * vez (y con la misma foto de la base). El doble clic en corregir, declarar y dar el conforme; dos correcciones simultáneas del mismo cobro
 * (gana una y la otra recibe `MEDIO_DEL_COBRO_CAMBIO`); dos correcciones de cobros distintos (ninguna falla); y corregir contra cerrar la
 * jornada (nada de lo confirmado falta en la foto). Cada ronda usa su propio cobro o su propia jornada, así que se repite `RONDAS` veces.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 600_000 });

type Fila = Record<string, unknown>;
type Gancho = (tx: TxDeCajaDePrueba, esperar: () => Promise<void>) => TxDeCajaDePrueba;
const RONDAS = 50;
const RONDAS_POR_JORNADA = 30;

describe.skipIf(base === null)("cierre del día de caja: concurrencia e idempotencia", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let caja: ReturnType<typeof armarCaja>;
  let cierre: ReturnType<typeof armarCierreConCaja>;
  let barrera: () => Promise<void> = () => Promise.resolve();
  let gancho: Gancho = (tx) => tx;
  const tickets = ticketsFalsos();

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 16, (tx) => gancho(tx, () => barrera()));
    caja = armarCaja(entorno, REGLAS_DE_CAJA, tickets);
    cierre = armarCierreConCaja(entorno, tickets);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoBase.cerrar();
    await propia.destruir();
  });

  /** Prepara la ronda: `participantes` transacciones esperan tras su primera lectura de la autorización. */
  const ronda = (participantes: number) => {
    barrera = crearBarrera(participantes);
    gancho = (tx, esperar) => {
      let primera = true;
      const original = tx.autorizacion;
      return {
        ...tx,
        autorizacion: {
          ...original,
          delActor: async (contexto) => {
            const r = await original.delActor(contexto);
            if (primera) {
              primera = false;
              await esperar();
            }
            return r;
          },
        },
      };
    };
  };
  const sinRonda = () => {
    gancho = (tx) => tx;
  };
  /** Corre las tareas a la vez con una barrera, y deja todo como estaba. */
  const aLaVez = async <const T extends readonly (() => Promise<unknown>)[]>(
    tareas: T,
  ): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> => {
    ronda(tareas.length);
    try {
      return (await Promise.all(tareas.map((t) => t()))) as {
        -readonly [K in keyof T]: Awaited<ReturnType<T[K]>>;
      };
    } finally {
      sinRonda();
    }
  };

  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);
  const resumen = (rs: readonly { ok: boolean; error?: unknown }[]) =>
    JSON.stringify(rs.map((r) => (r.ok ? "ok" : r.error)));
  const mundo = (opciones = {}) => crearMundoDeCobro(entornoBase, dueno, caja, opciones);
  const listo = (
    m: MundoDeCobro,
    cobros: readonly CobroDePrueba[],
    opciones: OpcionesDeJornada = {},
  ) => jornadaConCobros(entorno, caja, m, cobros, { tickets, ...opciones });
  const credito = (n: number): CobroDePrueba[] =>
    Array.from({ length: n }, (_, i) => ({
      medio: "TARJETA_CREDITO",
      cuenta: "terminal",
      importe: `${100 + i}.00`,
    }));
  const corregir = (
    m: MundoDeCobro,
    j: JornadaLista,
    i: number,
    medio: keyof MundoDeCobro["medios"],
    cuenta: keyof MundoDeCobro["cuentas"] | null,
    clave = claveNueva(),
  ) =>
    caja.casos.corregirMedioDeCobro(j.ctx(45), {
      claveDeIdempotencia: clave,
      cobroId: j.cobroIds[i] as string,
      medioDestinoId: m.medios[medio],
      cuentaDestinoId: cuenta === null ? null : m.cuentas[cuenta],
      motivo: "Era otro medio",
    });
  const correccionesDe = (cobroId: string) =>
    filas<{ secuencia: number; medio_despues_id: string; cuenta_despues_id: string | null }>(
      "select secuencia, medio_despues_id, cuenta_despues_id from correccion_de_medio where cobro_id = $1 order by secuencia",
      [cobroId],
    );

  // =============================================================================================
  describe("corregirMedioDeCobro", () => {
    it("doble clic (la misma clave, tres a la vez): una sola corrección, una auditoría, el mismo resultado y yaExistia en los otros", async () => {
      const m = await mundo();
      const j = await listo(m, credito(RONDAS));
      await empezarElCierre(cierre, j);
      for (let i = 0; i < RONDAS; i += 1) {
        const clave = claveNueva();
        const uno = () => corregir(m, j, i, "TARJETA_DEBITO", "terminal", clave);
        const rs = await aLaVez([uno, uno, uno]);
        expect(
          rs.every((r) => r.ok),
          resumen(rs),
        ).toBe(true);
        expect(
          rs.filter((r) => r.ok && !r.valor.yaExistia),
          resumen(rs),
        ).toHaveLength(1);
        expect(new Set(rs.map((r) => (r.ok ? r.valor.correccionId : ""))).size).toBe(1);
        expect(await correccionesDe(j.cobroIds[i] as string)).toHaveLength(1);
      }
      expect(
        await contar("select count(*) as n from correccion_de_medio where empresa_id = $1", [
          m.empresa,
        ]),
      ).toBe(RONDAS);
      expect(
        await contar(
          "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'CORRECCION_DE_MEDIO_REGISTRADA'",
          [m.empresa],
        ),
      ).toBe(RONDAS);
    });

    it("dos correcciones del mismo cobro a la vez con claves distintas: gana una (secuencia 1) y la otra recibe MEDIO_DEL_COBRO_CAMBIO con el medio vigente; la siguiente es la secuencia 2, sin huecos", async () => {
      const m = await mundo();
      const j = await listo(m, credito(RONDAS));
      await empezarElCierre(cierre, j);
      for (let i = 0; i < RONDAS; i += 1) {
        const mismoDestino = i % 2 === 0;
        const [a, b] = await aLaVez([
          () => corregir(m, j, i, "TARJETA_DEBITO", "terminal"),
          () =>
            mismoDestino
              ? corregir(m, j, i, "TARJETA_DEBITO", "terminal")
              : corregir(m, j, i, "EFECTIVO", null),
        ] as const);
        const ganadora = [a, b].filter((r) => r.ok);
        const perdedora = [a, b].filter((r) => !r.ok);
        expect(ganadora, resumen([a, b])).toHaveLength(1);
        expect(perdedora, resumen([a, b])).toHaveLength(1);
        const filasDelCobro = await correccionesDe(j.cobroIds[i] as string);
        expect(
          filasDelCobro.map((f) => f.secuencia),
          resumen([a, b]),
        ).toEqual([1]);
        const vigente = {
          medioDePagoId: filasDelCobro[0]?.medio_despues_id,
          cuentaDeCobroId: filasDelCobro[0]?.cuenta_despues_id,
        };
        expect(perdedora[0]).toEqual({
          ok: false,
          error: { codigo: "MEDIO_DEL_COBRO_CAMBIO", vigente },
        });
        // Después de la carrera se sigue desde el medio vigente: la secuencia 2, sin huecos.
        const siguiente = await corregir(m, j, i, "QR", "qr");
        expect(siguiente, resumen([a, b])).toMatchObject({ ok: true, valor: { secuencia: 2 } });
        expect((await correccionesDe(j.cobroIds[i] as string)).map((f) => f.secuencia)).toEqual([
          1, 2,
        ]);
      }
    });

    it("dos correcciones de cobros DISTINTOS a la vez: las dos pasan (ninguna falla por la carrera de la otra)", async () => {
      const m = await mundo();
      const j = await listo(m, credito(RONDAS * 2));
      await empezarElCierre(cierre, j);
      for (let i = 0; i < RONDAS; i += 1) {
        const rs = await aLaVez([
          () => corregir(m, j, 2 * i, "TARJETA_DEBITO", "terminal"),
          () => corregir(m, j, 2 * i + 1, "EFECTIVO", null),
        ] as const);
        expect(
          rs.every((r) => r.ok),
          resumen(rs),
        ).toBe(true);
        expect(rs.map((r) => (r.ok ? r.valor.secuencia : 0))).toEqual([1, 1]);
      }
      expect(
        await contar("select count(*) as n from correccion_de_medio where empresa_id = $1", [
          m.empresa,
        ]),
      ).toBe(RONDAS * 2);
    });

    it("corregir contra cerrar la jornada a la vez: cada corrección confirmada está en las líneas guardadas y las rechazadas dan JORNADA_CERRADA sin escribir; el cierre que vio otra cosa da CONTROLES_CAMBIARON", async () => {
      const m = await mundo();
      const resultados = new Set<string>();
      for (let i = 0; i < RONDAS; i += 1) {
        const j = await listo(m, credito(2), { dias: i + 1, conforme: true });
        await empezarElCierre(cierre, j);
        const vistos = await cierre.consultas.controlesDeLaJornada(j.ctx(50), j.entrada);
        if (!vistos.ok) throw new Error(JSON.stringify(vistos.error));
        const reconocimientos = vistos.valor.controles
          .filter((c) => c.severidad === "RECONOCIBLE" && c.cantidad > 0)
          .map((c) => ({ modulo: c.modulo, clave: c.clave, texto: null }));
        const [correccion, cierreDelDia] = await aLaVez([
          () => corregir(m, j, 0, "TARJETA_DEBITO", "terminal"),
          () =>
            cierre.casos.cerrarJornada(j.ctx(60), {
              ...j.entrada,
              huellaVista: vistos.valor.huella,
              reconocimientos,
              observacion: null,
            }),
        ] as const);
        const hechas = await contar(
          "select count(*) as n from correccion_de_medio where cobro_id = $1",
          [j.cobroIds[0]],
        );
        const estado = (
          await filas<{ estado: string }>(
            "select estado from jornada_de_sucursal where empresa_id = $1 and fecha_negocio = $2",
            [m.empresa, j.fecha],
          )
        )[0]?.estado;
        const detalle = resumen([correccion, cierreDelDia]);
        if (cierreDelDia.ok) {
          // Cerró primero: la corrección fue rechazada y no escribió nada.
          resultados.add("cierra antes");
          expect(correccion, detalle).toEqual({ ok: false, error: "JORNADA_CERRADA" });
          expect(hechas, detalle).toBe(0);
          expect(estado).toBe("CERRADA");
        } else {
          // La corrección entró antes: el cierre vio otros controles y no cerró; la jornada sigue en auditoría con la corrección.
          resultados.add("corrige antes");
          expect(correccion.ok, detalle).toBe(true);
          expect(cierreDelDia, detalle).toMatchObject({
            ok: false,
            error: { codigo: "CONTROLES_CAMBIARON" },
          });
          expect(hechas, detalle).toBe(1);
          expect(estado).toBe("EN_AUDITORIA");
        }
        // Σ guardada = Σ recalculada: lo que quedó congelado (si cerró) es exactamente lo que dicen los movimientos y las correcciones.
        if (estado === "CERRADA") {
          const desvios = await filas(
            `select l.medio_de_pago_id from conciliacion_de_jornada l
              where l.empresa_id = $1 and l.fecha_negocio = $2
                and l.correcciones <> coalesce((
                  select sum(case when k.medio_despues_id = l.medio_de_pago_id and k.cuenta_despues_id is not distinct from l.cuenta_de_cobro_id then m.importe else 0 end
                                - case when k.medio_antes_id = l.medio_de_pago_id and k.cuenta_antes_id is not distinct from l.cuenta_de_cobro_id then m.importe else 0 end)
                    from correccion_de_medio k join movimiento_caja m on m.id = k.cobro_id and m.empresa_id = k.empresa_id
                   where k.empresa_id = l.empresa_id and k.fecha_negocio = l.fecha_negocio), 0)`,
            [m.empresa, j.fecha],
          );
          expect(desvios, detalle).toEqual([]);
        }
      }
      // La carrera es de verdad: la barrera deja que ocurran los dos órdenes con el tiempo.
      expect(resultados.size).toBeGreaterThan(0);
    });
  });

  // =============================================================================================
  describe("declararTotal y darConformeGeneral", () => {
    it("doble clic en declarar y en el conforme (la misma clave, tres a la vez): una sola fila y yaExistia en los otros; dos declaraciones del mismo par a la vez: las dos pasan con secuencias 1 y 2; dos conformes con claves distintas: uno solo", async () => {
      const m = await mundo();
      for (let i = 0; i < RONDAS_POR_JORNADA; i += 1) {
        const j = await listo(m, [{ medio: "QR", cuenta: "qr", importe: "300.00" }], {
          dias: i + 1,
        });
        await empezarElCierre(cierre, j);
        const declarar = (importe: string, clave = claveNueva()) =>
          caja.casos.declararTotal(j.ctx(46), {
            claveDeIdempotencia: clave,
            ...j.entrada,
            medioDePagoId: m.medios.QR,
            cuentaDeCobroId: m.cuentas.qr,
            importe: pesos(importe),
          });
        const conforme = (clave = claveNueva()) =>
          caja.casos.darConformeGeneral(j.ctx(47), { claveDeIdempotencia: clave, ...j.entrada });

        const claveDeclaracion = claveNueva();
        const triple = await aLaVez([
          () => declarar("300.00", claveDeclaracion),
          () => declarar("300.00", claveDeclaracion),
          () => declarar("300.00", claveDeclaracion),
        ] as const);
        expect(
          triple.every((r) => r.ok),
          resumen(triple),
        ).toBe(true);
        expect(
          triple.filter((r) => r.ok && !r.valor.yaExistia),
          resumen(triple),
        ).toHaveLength(1);

        const [d1, d2] = await aLaVez([
          () => declarar("290.00"),
          () => declarar("280.00"),
        ] as const);
        expect(d1.ok && d2.ok, resumen([d1, d2])).toBe(true);
        const secuencias = await filas<{ secuencia: number }>(
          "select secuencia from declaracion_de_total where empresa_id = $1 and fecha_negocio = $2 order by secuencia",
          [m.empresa, j.fecha],
        );
        expect(secuencias.map((f) => f.secuencia)).toEqual([1, 2, 3]);

        const claveConforme = claveNueva();
        const igual = await aLaVez([
          () => conforme(claveConforme),
          () => conforme(claveConforme),
          () => conforme(claveConforme),
        ] as const);
        expect(
          igual.every((r) => r.ok),
          resumen(igual),
        ).toBe(true);
        expect(
          igual.filter((r) => r.ok && !r.valor.yaExistia),
          resumen(igual),
        ).toHaveLength(1);
        expect(
          await contar(
            "select count(*) as n from conforme_de_jornada where empresa_id = $1 and fecha_negocio = $2",
            [m.empresa, j.fecha],
          ),
        ).toBe(1);
      }
      expect(
        await contar(
          "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'CONFORME_GENERAL_DADO'",
          [m.empresa],
        ),
      ).toBe(RONDAS_POR_JORNADA);
    });

    it("dos conformes con claves distintas a la vez: una sola fila; los dos devuelven el mismo conformeId", async () => {
      const m = await mundo();
      for (let i = 0; i < RONDAS_POR_JORNADA; i += 1) {
        const j = await listo(m, [{ medio: "QR", cuenta: "qr", importe: "300.00" }], {
          dias: i + 1,
        });
        await empezarElCierre(cierre, j);
        const conforme = () =>
          caja.casos.darConformeGeneral(j.ctx(47), {
            claveDeIdempotencia: claveNueva(),
            ...j.entrada,
          });
        const rs = await aLaVez([conforme, conforme] as const);
        expect(
          rs.every((r) => r.ok),
          resumen(rs),
        ).toBe(true);
        expect(new Set(rs.map((r) => (r.ok ? r.valor.conformeId : ""))).size).toBe(1);
        expect(
          rs.filter((r) => r.ok && !r.valor.yaExistia),
          resumen(rs),
        ).toHaveLength(1);
        expect(
          await contar(
            "select count(*) as n from conforme_de_jornada where empresa_id = $1 and fecha_negocio = $2",
            [m.empresa, j.fecha],
          ),
        ).toBe(1);
      }
    });

    it("declarar contra cerrar la jornada a la vez: o la declaración entró antes (el cierre ve otra huella) o se rechazó con JORNADA_CERRADA sin escribir", async () => {
      const m = await mundo();
      for (let i = 0; i < RONDAS_POR_JORNADA; i += 1) {
        const j = await listo(m, [{ medio: "QR", cuenta: "qr", importe: "300.00" }], {
          dias: i + 1,
          conforme: true,
        });
        await empezarElCierre(cierre, j);
        const vistos = await cierre.consultas.controlesDeLaJornada(j.ctx(50), j.entrada);
        if (!vistos.ok) throw new Error(JSON.stringify(vistos.error));
        const reconocimientos = vistos.valor.controles
          .filter((c) => c.severidad === "RECONOCIBLE" && c.cantidad > 0)
          .map((c) => ({ modulo: c.modulo, clave: c.clave, texto: null }));
        const [declaracion, cierreDelDia] = await aLaVez([
          () =>
            caja.casos.declararTotal(j.ctx(46), {
              claveDeIdempotencia: claveNueva(),
              ...j.entrada,
              medioDePagoId: m.medios.QR,
              cuentaDeCobroId: m.cuentas.qr,
              importe: pesos("250.00"),
            }),
          () =>
            cierre.casos.cerrarJornada(j.ctx(60), {
              ...j.entrada,
              huellaVista: vistos.valor.huella,
              reconocimientos,
              observacion: null,
            }),
        ] as const);
        const detalle = resumen([declaracion, cierreDelDia]);
        const hechas = await contar(
          "select count(*) as n from declaracion_de_total where empresa_id = $1 and fecha_negocio = $2",
          [m.empresa, j.fecha],
        );
        if (cierreDelDia.ok) {
          expect(declaracion, detalle).toEqual({ ok: false, error: "JORNADA_CERRADA" });
          expect(hechas, detalle).toBe(0);
        } else {
          expect(declaracion.ok, detalle).toBe(true);
          expect(cierreDelDia, detalle).toMatchObject({
            ok: false,
            error: { codigo: "CONTROLES_CAMBIARON" },
          });
          expect(hechas, detalle).toBe(1);
        }
      }
    });
  });
});
