import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearBarrera, crearBaseAparte, comoEmpresa } from "./entorno";
import { conAppDe, crearMundo, type Mundo } from "./fiscal-apoyo";
import {
  abrirSesion,
  crearCaja,
  crearEscenario,
  filaDeCobro,
  filasDe,
  movimiento,
  textoDe,
  type Escenario,
} from "./caja-apoyo";
import { SesionDePrueba, type Intento } from "./sesiones";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";

/**
 * El hueco de dinero del cierre: un cobro cargado por SQL directo en `read committed` contra un cierre `serializable` (el real). Sin el
 * arreglo, el cierre seguía con su instantánea vieja (`FOR SHARE` solo bloquea, no versiona la fila), el diferido recalculaba con esa
 * misma instantánea y la sesión quedaba CERRADA con un cobro confirmado que el arqueo no contaba (arqueo 0,00 contra 100,00 cobrados).
 * Con el arreglo (`movimiento_caja_validar_alta` escribe la sesión fuera de `serializable`), el cierre choca con una versión posterior a
 * su instantánea (40001, que el adaptador reintenta) o, si llegó primero, el cobro se rechaza. Cada ronda es una carrera con barrera entre
 * dos conexiones; el invariante es el mismo en todas: una sesión CERRADA nunca tiene un movimiento que su arqueo no cuente.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 600_000 });

const RONDAS = 60;
const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));
type Aislamiento = "read committed" | "serializable";
type Resultado = Readonly<{ confirmo: boolean; codigo?: string; restriccion?: string }>;

describe.skipIf(base === null)(
  "caja: el hueco de dinero entre un cobro y un cierre serializable",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let m: Mundo;
    let esc: Escenario;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      m = await crearMundo(dueno);
      esc = await crearEscenario(dueno, m);
    });
    afterAll(async () => {
      await dueno.end();
      await propia.destruir();
    });

    const abrirTx = (aislamiento: Aislamiento) =>
      SesionDePrueba.abrir(
        propia.base,
        "pedernal_app",
        comoEmpresa(empresaId(m.empresa), personaId(m.persona)),
        aislamiento,
      );
    const deIntento = (r: Intento): Resultado =>
      r.ok
        ? { confirmo: true }
        : {
            confirmo: false,
            codigo: r.codigo,
            ...(r.restriccion === undefined ? {} : { restriccion: r.restriccion }),
          };

    const sesionNueva = async (nombre: string): Promise<string> => {
      const caja = await crearCaja(dueno, m, nombre);
      let sesion = "";
      await conAppDe(propia.base, m, async (s) => {
        sesion = (await abrirSesion(s, esc, { caja })).sesion;
        expect((await s.confirmar()).ok).toBe(true);
      });
      return sesion;
    };

    /** Cobra 100,00 con débito: `antes` ms después de la barrera, y retiene la transacción `retiene` ms antes de confirmar. */
    const cobrarT = async (
      aislamiento: Aislamiento,
      sesion: string,
      barrera: () => Promise<void>,
      antes: number,
      retiene: number,
    ): Promise<Resultado> => {
      const s = await abrirTx(aislamiento);
      try {
        await barrera();
        await esperar(antes);
        const mov = await movimiento(s, esc, sesion, {
          clase: "COBRO",
          medio: "TARJETA_DEBITO",
          cuenta: esc.cuentas.terminal,
          importe: "100.00",
        });
        if (!mov.ok) return deIntento(mov);
        const fila = await filaDeCobro(s, esc, textoDe(mov, "id"));
        if (!fila.ok) return deIntento(fila);
        await esperar(retiene);
        return deIntento(await s.confirmar());
      } finally {
        await s.cerrar();
      }
    };

    /**
     * El cierre serializable como lo hace la aplicación: toma su instantánea ANTES (primera lectura), calcula el esperado con ella, `pausa` ms
     * después cierra la sesión (UPDATE) y escribe el arqueo con ese esperado. Sin savepoints: un error deja la transacción abortada.
     */
    const cerrarT = async (
      sesion: string,
      barrera: () => Promise<void>,
      pausa: number,
    ): Promise<Resultado> => {
      const s = await abrirTx("serializable");
      try {
        const instantanea = await s.directo("select 1 from sesion_caja where id = $1", [sesion]);
        if (!instantanea.ok) return deIntento(instantanea);
        await barrera();
        const lineas = filasDe(
          await s.directo(
            `select medio_de_pago_id as medio, cuenta_de_cobro_id as cuenta, sum(importe)::text as esperado
             from movimiento_caja where empresa_id = $1 and sesion_id = $2 group by 1, 2`,
            [m.empresa, sesion],
          ),
        ) as { medio: string; cuenta: string | null; esperado: string }[];
        await esperar(pausa);
        const cerrar = await s.directo(
          `update sesion_caja set estado = 'CERRADA', cierre_iniciado_en = $3, cierre_iniciado_por = $4, cerrada_en = $3, cerrada_por = $4
          where empresa_id = $1 and id = $2`,
          [m.empresa, sesion, "2026-11-10T02:00:00Z", m.persona],
        );
        if (!cerrar.ok) return deIntento(cerrar);
        if (!lineas.some((l) => l.medio === esc.medios.EFECTIVO && l.cuenta === null)) {
          lineas.push({ medio: esc.medios.EFECTIVO, cuenta: null, esperado: "0.00" });
        }
        const billete = await s.directo(
          "insert into arqueo_billete (empresa_id, sesion_id, denominacion, cantidad) values ($1, $2, 1000, 1)",
          [m.empresa, sesion],
        );
        if (!billete.ok) return deIntento(billete);
        for (const l of lineas) {
          const efectivo = l.medio === esc.medios.EFECTIVO;
          const r = await s.directo(
            `insert into arqueo_caja (empresa_id, sesion_id, medio_de_pago_id, cuenta_de_cobro_id, esperado, contado, contado_monedas)
           values ($1, $2, $3, $4, $5, $6, $7)`,
            [
              m.empresa,
              sesion,
              l.medio,
              l.cuenta,
              l.esperado,
              efectivo ? "1000.00" : l.esperado,
              efectivo ? "0.00" : null,
            ],
          );
          if (!r.ok) return deIntento(r);
        }
        return deIntento(await s.confirmar());
      } finally {
        await s.cerrar();
      }
    };

    /** El invariante de dinero, igual en toda ronda. */
    const verificar = async (
      sesion: string,
      cobro: Resultado,
      cierre: Resultado,
      etiqueta: string,
    ) => {
      const estado = (
        await dueno.query<{ estado: string }>("select estado from sesion_caja where id = $1", [
          sesion,
        ])
      ).rows[0]?.estado;
      const cobrado = (
        await dueno.query<{ t: string }>(
          "select coalesce(sum(importe), 0)::text as t from movimiento_caja where sesion_id = $1 and clase = 'COBRO'",
          [sesion],
        )
      ).rows[0]?.t;
      expect(cobrado, `${etiqueta}: el cobro confirmado es el que informó la conexión`).toBe(
        cobro.confirmo ? "100.00" : "0",
      );
      expect(estado, `${etiqueta}: la sesión está cerrada si y solo si el cierre confirmó`).toBe(
        cierre.confirmo ? "CERRADA" : "ABIERTA",
      );
      if (estado === "CERRADA") {
        const arqueo = (
          await dueno.query<{ t: string }>(
            "select coalesce(sum(esperado), 0)::text as t from arqueo_caja where sesion_id = $1 and medio_de_pago_id = $2",
            [sesion, esc.medios.TARJETA_DEBITO],
          )
        ).rows[0]?.t;
        expect(Number(arqueo), `${etiqueta}: el arqueo cuenta lo cobrado (${cobrado})`).toBe(
          Number(cobrado),
        );
        const sinContar = await dueno.query(
          `select 1 from movimiento_caja mv where mv.sesion_id = $1
          and not exists (select 1 from arqueo_caja a where a.sesion_id = mv.sesion_id and a.medio_de_pago_id = mv.medio_de_pago_id
                             and a.cuenta_de_cobro_id is not distinct from mv.cuenta_de_cobro_id)`,
          [sesion],
        );
        expect(sinContar.rowCount, `${etiqueta}: nada sin contar en una sesión cerrada`).toBe(0);
      }
    };

    const FALLA_DE_SERIALIZACION = "40001";

    it.each([
      ["el cobro ya confirmó cuando el cierre intenta cerrar (instantánea vieja)", 0, 0, 80],
      ["el cobro sigue en vuelo cuando el cierre intenta cerrar", 0, 60, 15],
    ] as const)(
      `cobro por SQL directo en read committed contra cierre serializable, ${RONDAS} rondas: %s`,
      async (_nombre, antes, retiene, pausa) => {
        let cierresRechazados = 0;
        for (let i = 0; i < RONDAS; i++) {
          const sesion = await sesionNueva(`Hueco ${pausa} ${i}`);
          const barrera = crearBarrera(2);
          const [cobro, cierre] = await Promise.all([
            cobrarT("read committed", sesion, barrera, antes, retiene),
            cerrarT(sesion, barrera, pausa),
          ]);
          // Los dos desenlaces válidos, según quién llegó primero a la fila de la sesión (con la máquina cargada el orden puede cambiar):
          // el cobro llegó primero, se confirma y el cierre con instantánea vieja pierde con 40001 (el adaptador lo reintenta y ve el cobro);
          // o el cierre llegó primero y se confirma, y el cobro se rechaza. Nunca los dos confirmados.
          if (cobro.confirmo) {
            expect(
              cierre.confirmo,
              `ronda ${i}: el cierre con instantánea vieja no puede confirmar`,
            ).toBe(false);
            expect(cierre.codigo, `ronda ${i}`).toBe(FALLA_DE_SERIALIZACION);
            cierresRechazados++;
          } else {
            expect(cierre.confirmo, `ronda ${i}: ${cierre.restriccion ?? cierre.codigo}`).toBe(
              true,
            );
            expect(cobro.restriccion, `ronda ${i}`).toBe("movimiento_caja_sesion_no_abierta");
          }
          await verificar(sesion, cobro, cierre, `ronda ${i}`);
        }
        // El orden que abre el hueco es el que se ejercita (el cobro llega primero), no un desenlace de casualidad.
        expect(cierresRechazados).toBeGreaterThanOrEqual(RONDAS * 0.8);
      },
    );

    it(`el cierre llega primero: el cobro por SQL directo en read committed se rechaza (${RONDAS} rondas)`, async () => {
      for (let i = 0; i < RONDAS; i++) {
        const sesion = await sesionNueva(`Hueco cierre primero ${i}`);
        const barrera = crearBarrera(2);
        const [cobro, cierre] = await Promise.all([
          cobrarT("read committed", sesion, barrera, 60, 0),
          cerrarT(sesion, barrera, 0),
        ]);
        expect(cierre.confirmo, `ronda ${i}: ${cierre.restriccion ?? cierre.codigo}`).toBe(true);
        expect(cobro.confirmo, `ronda ${i}`).toBe(false);
        expect(cobro.restriccion, `ronda ${i}`).toBe("movimiento_caja_sesion_no_abierta");
        await verificar(sesion, cobro, cierre, `ronda ${i}`);
      }
    });

    it(`caso mixto, los dos serializables (el camino de la aplicación): nunca una sesión cerrada con un cobro sin contar (${RONDAS} rondas)`, async () => {
      let cobroGano = 0;
      let cierreGano = 0;
      for (let i = 0; i < RONDAS; i++) {
        const sesion = await sesionNueva(`Hueco mixto ${i}`);
        const barrera = crearBarrera(2);
        const cobroPrimero = i % 2 === 0;
        const [cobro, cierre] = await Promise.all([
          cobrarT("serializable", sesion, barrera, cobroPrimero ? 0 : 40, cobroPrimero ? 30 : 0),
          cerrarT(sesion, barrera, cobroPrimero ? 15 : 0),
        ]);
        // Cualquier desenlace válido: uno confirma y el otro pierde (40001 o sesión no abierta); jamás los dos con un arqueo viejo.
        expect(cobro.confirmo && cierre.confirmo && (await arqueoViejo(sesion)), `ronda ${i}`).toBe(
          false,
        );
        if (!cobro.confirmo) {
          expect([FALLA_DE_SERIALIZACION, "23514"], `ronda ${i}: ${cobro.codigo}`).toContain(
            cobro.codigo,
          );
        }
        if (!cierre.confirmo) {
          expect(cierre.codigo, `ronda ${i}`).toBe(FALLA_DE_SERIALIZACION);
        }
        await verificarMixto(sesion, cobro, cierre, `ronda ${i}`);
        if (cobro.confirmo) cobroGano++;
        if (cierre.confirmo) cierreGano++;
      }
      expect(cobroGano + cierreGano).toBeGreaterThan(0);
    });

    /** El arqueo de la sesión no cuenta todo lo cobrado. */
    const arqueoViejo = async (sesion: string): Promise<boolean> => {
      const r = await dueno.query<{ cobrado: string; contado: string }>(
        `select (select coalesce(sum(importe), 0)::text from movimiento_caja where sesion_id = $1 and medio_de_pago_id = $2) as cobrado,
              (select coalesce(sum(esperado), 0)::text from arqueo_caja where sesion_id = $1 and medio_de_pago_id = $2) as contado`,
        [sesion, esc.medios.TARJETA_DEBITO],
      );
      return Number(r.rows[0]?.cobrado) !== Number(r.rows[0]?.contado);
    };

    /** Como `verificar`, pero un cierre que perdió deja la sesión abierta y un cobro que perdió no deja nada. */
    const verificarMixto = async (
      sesion: string,
      cobro: Resultado,
      cierre: Resultado,
      etiqueta: string,
    ) => {
      const estado = (
        await dueno.query<{ estado: string }>("select estado from sesion_caja where id = $1", [
          sesion,
        ])
      ).rows[0]?.estado;
      expect(estado, etiqueta).toBe(cierre.confirmo ? "CERRADA" : "ABIERTA");
      const cobrado = (
        await dueno.query<{ n: string }>(
          "select count(*)::text as n from movimiento_caja where sesion_id = $1 and clase = 'COBRO'",
          [sesion],
        )
      ).rows[0]?.n;
      expect(cobrado, etiqueta).toBe(cobro.confirmo ? "1" : "0");
      if (estado === "CERRADA") expect(await arqueoViejo(sesion), etiqueta).toBe(false);
    };
  },
);
