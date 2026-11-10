import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearBarrera, crearBaseAparte, comoEmpresa } from "./entorno";
import { acepta, conAppDe, crearMundo, type Mundo } from "./fiscal-apoyo";
import {
  AHORA,
  HUELLA,
  abrirSesion,
  asegurarJornada,
  claveNueva,
  cobrar,
  crearCaja,
  crearEscenario,
  cerrarSesion,
  filaDeCobro,
  filasDe,
  movimiento,
  textoDe,
  type Escenario,
} from "./caja-apoyo";
import { SesionDePrueba, esperarBloqueo, type Intento } from "./sesiones";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";

/**
 * Concurrencia REAL en la base, con el rol de la aplicación y SQL directo, sin pasar por el módulo (que llega en un tramo posterior): cada
 * prueba lanza dos transacciones a la vez, con una barrera, y después mira la base. Cubre lo que el diseño promete (e3 §3.5 «Cobrar y cerrar
 * caja a la vez» y §5.1 #1 a #3):
 *  - cobrar contra cerrar la caja: el `FOR SHARE` del movimiento contra el `UPDATE` del cierre; cada movimiento confirmado queda dentro del
 *    esperado del arqueo (la falla de Motor2, 1 en 370) — en los dos órdenes de cálculo, y con el diferido como defensa final;
 *  - dos aperturas de la misma caja: una sola sesión no cerrada;
 *  - dos cobros con la misma identidad (origen, orden) o la misma clave: un solo movimiento y una sola fila de cobro;
 *  - corregir contra cerrar la jornada: ninguna corrección confirmada se pierde de la foto.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 600_000 });

const ITERACIONES = 120;
/** La fecha civil `i` días después del primero del mes (mes de 0 a 11). */
const diaDe = (anio: number, mes: number, i: number): string =>
  new Date(Date.UTC(anio, mes, 1 + i)).toISOString().slice(0, 10);
const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

type Resultado = Readonly<{ confirmo: boolean; restriccion?: string; codigo?: string }>;

describe.skipIf(base === null)(
  "caja: concurrencia en la base (rol de la aplicación, SQL directo)",
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

    const abrirTx = () =>
      SesionDePrueba.abrir(
        propia.base,
        "pedernal_app",
        comoEmpresa(empresaId(m.empresa), personaId(m.persona)),
      );
    const deIntento = (r: Intento): Resultado =>
      r.ok
        ? { confirmo: true }
        : {
            confirmo: false,
            ...(r.restriccion === undefined ? {} : { restriccion: r.restriccion }),
            codigo: r.codigo,
          };

    /** Una sesión abierta y confirmada en una caja nueva. */
    const sesionNueva = async (nombre: string): Promise<{ sesion: string; caja: string }> => {
      const caja = await crearCaja(dueno, m, nombre);
      let sesion = "";
      await conAppDe(propia.base, m, async (s) => {
        sesion = (await abrirSesion(s, esc, { caja })).sesion;
        expect((await s.confirmar()).ok).toBe(true);
      });
      return { sesion, caja };
    };

    const sumaDebito = async (sesion: string): Promise<string> =>
      (
        await dueno.query<{ t: string }>(
          "select coalesce(sum(importe), 0)::text as t from movimiento_caja where sesion_id = $1 and medio_de_pago_id = $2",
          [sesion, esc.medios.TARJETA_DEBITO],
        )
      ).rows[0]?.t as string;

    // ---------------------------------------------------------------------------------------------
    describe("cobrar y cerrar caja a la vez", () => {
      /** Cobra 100,00 con débito en la sesión: movimiento + fila de cobro + confirmar. `espera` retiene el bloqueo antes de confirmar. */
      const cobrarT = async (
        sesion: string,
        barrera: () => Promise<void>,
        antes: number,
        retiene: number,
      ): Promise<Resultado> => {
        const s = await abrirTx();
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

      /** Cierra la sesión: `leerPrimero` calcula el esperado antes de tomar la sesión (el orden que el diferido tiene que defender). */
      const cerrarT = async (
        sesion: string,
        barrera: () => Promise<void>,
        antes: number,
        leerPrimero: boolean,
        pausaTrasLeer = 0,
      ): Promise<Resultado> => {
        const s = await abrirTx();
        try {
          await barrera();
          await esperar(antes);
          const esperado = async () =>
            filasDe(
              await s.directo(
                `select medio_de_pago_id as medio, cuenta_de_cobro_id as cuenta, sum(importe)::text as esperado
                 from movimiento_caja where empresa_id = $1 and sesion_id = $2 group by 1, 2`,
                [m.empresa, sesion],
              ),
            ) as { medio: string; cuenta: string | null; esperado: string }[];
          const cerrar = async () =>
            s.directo(
              `update sesion_caja set estado = 'CERRADA', cierre_iniciado_en = $3, cierre_iniciado_por = $4, cerrada_en = $3, cerrada_por = $4
              where empresa_id = $1 and id = $2`,
              [m.empresa, sesion, "2026-11-10T02:00:00Z", m.persona],
            );
          let lineas: { medio: string; cuenta: string | null; esperado: string }[];
          if (leerPrimero) {
            lineas = await esperado();
            await esperar(pausaTrasLeer);
            const c = await cerrar();
            if (!c.ok) return deIntento(c);
          } else {
            const c = await cerrar(); // espera a los cobros en vuelo (FOR SHARE) y después calcula con todo lo confirmado
            if (!c.ok) return deIntento(c);
            lineas = await esperado();
          }
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

      /** Lo que tiene que cumplir la base después de cada ronda, pase lo que pase. */
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
        const cobros = Number(
          (
            await dueno.query<{ n: string }>(
              "select count(*)::text as n from cobro c join movimiento_caja mv on mv.id = c.movimiento_id where mv.sesion_id = $1",
              [sesion],
            )
          ).rows[0]?.n,
        );
        const movimientos = Number(
          (
            await dueno.query<{ n: string }>(
              "select count(*)::text as n from movimiento_caja where sesion_id = $1 and clase = 'COBRO'",
              [sesion],
            )
          ).rows[0]?.n,
        );
        // Un cobro confirmado tiene su fila, y uno rechazado no dejó nada.
        expect(movimientos, `${etiqueta}: movimientos y filas de cobro`).toBe(cobros);
        expect(cobros, `${etiqueta}: cobro confirmado`).toBe(cobro.confirmo ? 1 : 0);
        if (!cobro.confirmo) {
          expect(["movimiento_caja_sesion_no_abierta"], `${etiqueta}: ${cobro.codigo}`).toContain(
            cobro.restriccion,
          );
        }
        if (cierre.confirmo) {
          expect(estado, etiqueta).toBe("CERRADA");
          // Todo cobro confirmado está dentro del esperado del arqueo (y el esperado es exactamente la suma real).
          const arqueo = (
            await dueno.query<{ esperado: string }>(
              "select esperado::text from arqueo_caja where sesion_id = $1 and medio_de_pago_id = $2",
              [sesion, esc.medios.TARJETA_DEBITO],
            )
          ).rows[0]?.esperado;
          expect(arqueo ?? "0.00", etiqueta).toBe(
            (await sumaDebito(sesion)) === "0" ? "0.00" : await sumaDebito(sesion),
          );
        } else {
          // Un cierre que no se confirmó no dejó la sesión cerrada ni líneas sueltas.
          expect(estado, etiqueta).toBe("ABIERTA");
          const lineas = Number(
            (
              await dueno.query<{ n: string }>(
                "select count(*)::text as n from arqueo_caja where sesion_id = $1",
                [sesion],
              )
            ).rows[0]?.n,
          );
          expect(lineas, etiqueta).toBe(0);
        }
        // Nunca un movimiento en una sesión cerrada que el arqueo no cuente.
        if (estado === "CERRADA") {
          const sinContar = await dueno.query(
            `select 1 from movimiento_caja mv where mv.sesion_id = $1
              and not exists (select 1 from arqueo_caja a where a.sesion_id = mv.sesion_id and a.medio_de_pago_id = mv.medio_de_pago_id
                                 and a.cuenta_de_cobro_id is not distinct from mv.cuenta_de_cobro_id)`,
            [sesion],
          );
          expect(sinContar.rowCount, etiqueta).toBe(0);
        }
      };

      it(`el cierre toma la sesión (UPDATE) y espera a los cobros en vuelo: ${ITERACIONES} rondas, en los dos órdenes; cada cobro confirmado queda dentro del esperado`, async () => {
        let cobradosAntes = 0;
        let rechazados = 0;
        for (let i = 0; i < ITERACIONES; i++) {
          const { sesion } = await sesionNueva(`Carrera A ${i}`);
          const barrera = crearBarrera(2);
          // Pares: el cobro entra primero y retiene el bloqueo mientras el cierre intenta; o el cierre entra primero y el cobro llega después.
          const cobroPrimero = i % 2 === 0;
          const [cobro, cierre] = await Promise.all([
            cobrarT(sesion, barrera, cobroPrimero ? 0 : 40, cobroPrimero ? 40 : 0),
            cerrarT(sesion, barrera, cobroPrimero ? 15 : 0, false),
          ]);
          // El cierre siempre se confirma: espera a los cobros en vuelo y calcula con lo que ya está confirmado.
          expect(cierre.confirmo, `ronda ${i}: ${cierre.restriccion}`).toBe(true);
          await verificar(sesion, cobro, cierre, `ronda ${i}`);
          if (cobro.confirmo) cobradosAntes++;
          else rechazados++;
        }
        // Los dos órdenes se ejercitaron de verdad.
        expect(cobradosAntes).toBeGreaterThanOrEqual(ITERACIONES / 2 - 5);
        expect(rechazados).toBeGreaterThanOrEqual(ITERACIONES / 2 - 5);
      });

      it("el UPDATE del cierre queda esperando mientras un cobro en vuelo tiene la sesión (FOR SHARE), y sigue cuando el cobro confirma", async () => {
        const { sesion } = await sesionNueva("Carrera bloqueo");
        const cobro = await abrirTx();
        const cierre = await abrirTx();
        try {
          const mov = await movimiento(cobro, esc, sesion, {
            clase: "COBRO",
            medio: "TARJETA_DEBITO",
            cuenta: esc.cuentas.terminal,
            importe: "100.00",
          });
          acepta(mov);
          acepta(await filaDeCobro(cobro, esc, textoDe(mov, "id")));
          const cerrando = cierre.directo(
            `update sesion_caja set estado = 'CERRADA', cierre_iniciado_en = $3, cierre_iniciado_por = $4, cerrada_en = $3, cerrada_por = $4
            where empresa_id = $1 and id = $2`,
            [m.empresa, sesion, "2026-11-10T02:00:00Z", m.persona],
          );
          expect(
            await esperarBloqueo(dueno, cierre.pid),
            "el cierre espera al cobro en vuelo",
          ).toBe(true);
          acepta(await cobro.confirmar());
          acepta(await cerrando);
        } finally {
          await cobro.cerrar();
          await cierre.cerrar();
        }
      });

      it(`defensa final: si el cierre calculó el esperado ANTES de que confirmara un cobro, el diferido lo rechaza al confirmar (${ITERACIONES} rondas)`, async () => {
        let rechazadosPorDiferido = 0;
        let cerradosSinCobro = 0;
        for (let i = 0; i < ITERACIONES; i++) {
          const { sesion } = await sesionNueva(`Carrera B ${i}`);
          const barrera = crearBarrera(2);
          // Con el cobro en vuelo (retiene 40 ms) el cierre lee el esperado (sin ver el cobro sin confirmar), inserta las líneas y su UPDATE
          // espera al cobro; al confirmar el cobro, el cierre sigue con un arqueo viejo y el diferido lo frena. En las rondas impares el cobro
          // llega tarde (80 ms): el cierre ya se confirmó y el cobro se rechaza.
          const cobroEnVuelo = i % 2 === 0;
          const [cobro, cierre] = await Promise.all([
            cobrarT(sesion, barrera, cobroEnVuelo ? 0 : 80, cobroEnVuelo ? 40 : 0),
            cerrarT(sesion, barrera, cobroEnVuelo ? 15 : 0, true, 0),
          ]);
          await verificar(sesion, cobro, cierre, `ronda ${i}`);
          if (cobro.confirmo && !cierre.confirmo) {
            expect(
              ["sesion_caja_arqueo_incompleto", "sesion_caja_arqueo_no_cuadra"],
              `ronda ${i}`,
            ).toContain(cierre.restriccion);
            rechazadosPorDiferido++;
          } else if (!cobro.confirmo) {
            expect(cierre.confirmo, `ronda ${i}`).toBe(true);
            cerradosSinCobro++;
          } else {
            // Los dos confirmaron: el cobro entró antes de que el cierre calculara (el arqueo ya lo cuenta).
            expect(cobro.confirmo && cierre.confirmo).toBe(true);
          }
        }
        expect(rechazadosPorDiferido).toBeGreaterThan(0);
        expect(cerradosSinCobro).toBeGreaterThan(0);
      });
    });

    // ---------------------------------------------------------------------------------------------
    describe("dos aperturas de la misma caja a la vez", () => {
      it("una sola sesión no cerrada por caja (sesion_caja_vigente_uk): la otra pierde", async () => {
        for (let i = 0; i < 40; i++) {
          const caja = await crearCaja(dueno, m, `Apertura ${i}`);
          // La jornada ya existe (la crea `asegurarAbiertaEnTx` antes de abrir): las dos aperturas compiten solo por la caja.
          await conAppDe(propia.base, m, async (s) => {
            await asegurarJornada(s, m, "2026-11-09");
            await s.confirmar();
          });
          const barrera = crearBarrera(2);
          const abrir = async (): Promise<Resultado & { sesion?: string }> => {
            const s = await abrirTx();
            try {
              await barrera();
              const r = await abrirSesion(s, esc, { caja }).then(
                (a) => a,
                () => null,
              );
              if (r === null) return { confirmo: false };
              return { ...deIntento(await s.confirmar()), sesion: r.sesion };
            } finally {
              await s.cerrar();
            }
          };
          // `abrirSesion` lanza si la base rechaza algo: la que pierde lo hace en su INSERT de la sesión (23505) tras esperar a la ganadora.
          const [a, b] = await Promise.all([abrir(), abrir()]);
          expect([a.confirmo, b.confirmo].filter(Boolean), `ronda ${i}`).toHaveLength(1);
          const vigentes = Number(
            (
              await dueno.query<{ n: string }>(
                "select count(*)::text as n from sesion_caja where caja_id = $1 and estado <> 'CERRADA'",
                [caja],
              )
            ).rows[0]?.n,
          );
          expect(vigentes, `ronda ${i}`).toBe(1);
          const fondos = Number(
            (
              await dueno.query<{ n: string }>(
                "select count(*)::text as n from movimiento_caja mv join sesion_caja s on s.id = mv.sesion_id where s.caja_id = $1 and mv.clase = 'FONDO_INICIAL'",
                [caja],
              )
            ).rows[0]?.n,
          );
          expect(fondos, `ronda ${i}`).toBe(1);
        }
      });

      it("con la misma clave de idempotencia (doble clic) tampoco hay dos sesiones: la repetida pierde por sesion_caja_clave_uk", async () => {
        const caja = await crearCaja(dueno, m, "Apertura doble clic");
        await conAppDe(propia.base, m, async (s) => {
          await asegurarJornada(s, m, "2026-11-09");
          await s.confirmar();
        });
        const barrera = crearBarrera(2);
        const claveCompartida = claveNueva();
        const abrir = async (): Promise<Resultado> => {
          const s = await abrirTx();
          try {
            await barrera();
            const r = await s.intentar(
              `insert into sesion_caja (empresa_id, caja_id, fecha_negocio, hora_de_corte, zona_horaria, abierta_en, abierta_por,
                                     clave_idempotencia, huella)
             values ($1, $2, '2026-11-09', '00:00', 'America/Argentina/Buenos_Aires', $3, $4, $5, $6)`,
              [m.empresa, caja, AHORA, m.persona, claveCompartida, HUELLA],
            );
            if (!r.ok) return deIntento(r);
            await esperar(30);
            return deIntento(await s.confirmar());
          } finally {
            await s.cerrar();
          }
        };
        const [a, b] = await Promise.all([abrir(), abrir()]);
        expect([a.confirmo, b.confirmo].filter(Boolean)).toHaveLength(1);
        const perdedora = a.confirmo ? b : a;
        expect(["sesion_caja_clave_uk", "sesion_caja_vigente_uk"]).toContain(perdedora.restriccion);
      });
    });

    // ---------------------------------------------------------------------------------------------
    describe("dos cobros con la misma identidad", () => {
      it("el mismo (origen, orden) a la vez: un solo movimiento y una sola fila de cobro; el otro pierde por cobro_origen_uk", async () => {
        for (let i = 0; i < 40; i++) {
          const { sesion } = await sesionNueva(`Identidad ${i}`);
          const origen = { id: crypto.randomUUID(), orden: 1 };
          const barrera = crearBarrera(2);
          const cobrarIgual = async (): Promise<Resultado> => {
            const s = await abrirTx();
            try {
              const mov = await movimiento(s, esc, sesion, {
                clase: "COBRO",
                medio: "EFECTIVO",
                importe: "100.00",
              });
              if (!mov.ok) return deIntento(mov);
              await barrera();
              const fila = await filaDeCobro(s, esc, textoDe(mov, "id"), origen);
              if (!fila.ok) return deIntento(fila);
              await esperar(20);
              return deIntento(await s.confirmar());
            } finally {
              await s.cerrar();
            }
          };
          const [a, b] = await Promise.all([cobrarIgual(), cobrarIgual()]);
          expect([a.confirmo, b.confirmo].filter(Boolean), `ronda ${i}`).toHaveLength(1);
          expect((a.confirmo ? b : a).restriccion, `ronda ${i}`).toBe("cobro_origen_uk");
          const { rows } = await dueno.query<{ movimientos: string; cobros: string }>(
            `select (select count(*) from movimiento_caja where sesion_id = $1 and clase = 'COBRO')::text as movimientos,
                  (select count(*) from cobro c join movimiento_caja mv on mv.id = c.movimiento_id where mv.sesion_id = $1)::text as cobros`,
            [sesion],
          );
          expect(rows[0], `ronda ${i}`).toEqual({ movimientos: "1", cobros: "1" });
        }
      });

      it("la misma clave de idempotencia a la vez: un solo movimiento; el otro pierde por movimiento_caja_clave_uk", async () => {
        for (let i = 0; i < 20; i++) {
          const { sesion } = await sesionNueva(`Clave ${i}`);
          const claveCompartida = claveNueva();
          const barrera = crearBarrera(2);
          const ingresar = async (): Promise<Resultado> => {
            const s = await abrirTx();
            try {
              await barrera();
              const r = await s.intentar(
                `insert into movimiento_caja (empresa_id, sesion_id, clase, medio_de_pago_id, importe, motivo, registrado_en, registrado_por,
                                            clave_idempotencia, huella)
               values ($1, $2, 'INGRESO_MANUAL', $3, 10, 'Cambio', $4, $5, $6, $7)`,
                [m.empresa, sesion, esc.medios.EFECTIVO, AHORA, m.persona, claveCompartida, HUELLA],
              );
              if (!r.ok) return deIntento(r);
              await esperar(20);
              return deIntento(await s.confirmar());
            } finally {
              await s.cerrar();
            }
          };
          const [a, b] = await Promise.all([ingresar(), ingresar()]);
          expect([a.confirmo, b.confirmo].filter(Boolean), `ronda ${i}`).toHaveLength(1);
          expect((a.confirmo ? b : a).restriccion, `ronda ${i}`).toBe("movimiento_caja_clave_uk");
        }
      });

      it("muchos cobros distintos a la vez sobre la misma sesión no compiten (no hay fila caliente): todos quedan y la suma es exacta", async () => {
        const { sesion } = await sesionNueva("Muchos cobros");
        const trabajadores = 8;
        const porTrabajador = 12;
        const barrera = crearBarrera(trabajadores);
        const cobradas = await Promise.all(
          Array.from({ length: trabajadores }, async () => {
            await barrera();
            let confirmados = 0;
            for (let k = 0; k < porTrabajador; k++) {
              // Una transacción por cobro, como en producción.
              const s = await abrirTx();
              try {
                const mov = await movimiento(s, esc, sesion, {
                  clase: "COBRO",
                  medio: "EFECTIVO",
                  importe: "10.25",
                });
                if (!mov.ok) throw new Error(`${mov.restriccion}: ${mov.mensaje}`);
                const fila = await filaDeCobro(s, esc, textoDe(mov, "id"));
                if (!fila.ok) throw new Error(`${fila.restriccion}: ${fila.mensaje}`);
                const c = await s.confirmar();
                if (!c.ok) throw new Error(`${c.restriccion}: ${c.mensaje}`);
                confirmados++;
              } finally {
                await s.cerrar();
              }
            }
            return confirmados;
          }),
        );
        expect(cobradas.reduce((a, b) => a + b, 0)).toBe(trabajadores * porTrabajador);
        const { rows } = await dueno.query<{ n: string; total: string }>(
          `select count(*)::text as n, sum(importe)::text as total from movimiento_caja where sesion_id = $1 and clase = 'COBRO'`,
          [sesion],
        );
        // 96 cobros de 10,25 = 984,00 al centavo.
        expect(rows[0]).toEqual({ n: "96", total: "984.00" });
      });
    });

    // ---------------------------------------------------------------------------------------------
    describe("corregir un medio contra cerrar la jornada", () => {
      it("el cierre toma la jornada (FOR UPDATE) y espera a las correcciones en vuelo: ninguna corrección confirmada falta en la foto (40 rondas)", async () => {
        let corregidas = 0;
        let rechazadas = 0;
        for (let i = 0; i < 40; i++) {
          const fecha = diaDe(2028, 0, i);
          const { cobro } = await jornadaConCobroDeCredito(fecha);
          const barrera = crearBarrera(2);
          const corregirCobro = async (): Promise<Resultado> => {
            const s = await abrirTx();
            try {
              await barrera();
              await esperar(i % 2 === 0 ? 0 : 40);
              const r = await s.intentar(
                `insert into correccion_de_medio (empresa_id, cobro_id, secuencia, sucursal_id, fecha_negocio, medio_antes_id, cuenta_antes_id,
                                                medio_despues_id, cuenta_despues_id, motivo, corregido_en, corregido_por, clave_idempotencia, huella)
               values ($1, $2, 1, $3, $4, $5, $6, $7, $6, 'Era débito', $8, $9, $10, $11)`,
                [
                  m.empresa,
                  cobro,
                  m.sucursal,
                  fecha,
                  esc.medios.TARJETA_CREDITO,
                  esc.cuentas.terminal,
                  esc.medios.TARJETA_DEBITO,
                  AHORA,
                  m.persona,
                  claveNueva(),
                  HUELLA,
                ],
              );
              if (!r.ok) return deIntento(r);
              await esperar(i % 2 === 0 ? 30 : 0);
              return deIntento(await s.confirmar());
            } finally {
              await s.cerrar();
            }
          };
          const cerrarJornada = async (): Promise<Resultado> => {
            const s = await abrirTx();
            try {
              await barrera();
              await esperar(i % 2 === 0 ? 10 : 0);
              // Como el cierre: bloquea la jornada, congela (cabecera + líneas recalculadas) y la pasa a CERRADA, todo en una transacción.
              const bloqueo = await s.directo(
                "select 1 from jornada_de_sucursal where empresa_id = $1 and sucursal_id = $2 and fecha_negocio = $3 for update",
                [m.empresa, m.sucursal, fecha],
              );
              if (!bloqueo.ok) return deIntento(bloqueo);
              const hay = Number(
                filasDe(
                  await s.directo(
                    "select count(*)::int as n from correccion_de_medio where cobro_id = $1",
                    [cobro],
                  ),
                )[0]?.["n"],
              );
              const cabecera = await s.directo(
                "insert into cierre_de_caja_de_jornada (empresa_id, sucursal_id, fecha_negocio, congelado_en, congelado_por) values ($1, $2, $3, $4, $5)",
                [m.empresa, m.sucursal, fecha, AHORA, m.persona],
              );
              if (!cabecera.ok) return deIntento(cabecera);
              const lineas: [string, string | null, string, string, string | null, string][] = [
                [esc.medios.EFECTIVO, null, "1000.00", "0.00", "1000.00", "CONTADO"],
                [
                  esc.medios.TARJETA_CREDITO,
                  esc.cuentas.terminal,
                  "100.00",
                  hay > 0 ? "-100.00" : "0.00",
                  "100.00",
                  "DECLARADO",
                ],
                ...(hay > 0
                  ? ([
                      [
                        esc.medios.TARJETA_DEBITO,
                        esc.cuentas.terminal,
                        "0.00",
                        "100.00",
                        null,
                        "SIN_DATO",
                      ],
                    ] as [string, string | null, string, string, string | null, string][])
                  : []),
              ];
              for (const l of lineas) {
                const r = await s.directo(
                  `insert into conciliacion_de_jornada (empresa_id, sucursal_id, fecha_negocio, medio_de_pago_id, cuenta_de_cobro_id, registrado,
                                                      correcciones, declarado, estado_de_conteo)
                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                  [m.empresa, m.sucursal, fecha, ...l.slice(0, 5), l[5]],
                );
                if (!r.ok) return deIntento(r);
              }
              const cierre = await s.directo(
                `update jornada_de_sucursal set estado = 'CERRADA', cerrada_en = $4, cerrada_por = $5, huella_de_cierre = $6
                where empresa_id = $1 and sucursal_id = $2 and fecha_negocio = $3`,
                [m.empresa, m.sucursal, fecha, "2028-02-01T00:00:00Z", m.persona, HUELLA],
              );
              if (!cierre.ok) return deIntento(cierre);
              return deIntento(await s.confirmar());
            } finally {
              await s.cerrar();
            }
          };
          const [correccion, cierre] = await Promise.all([corregirCobro(), cerrarJornada()]);
          // El cierre siempre se confirma: la foto la recalcula con las correcciones que ya estaban confirmadas, y el diferido la verifica.
          expect(cierre.confirmo, `ronda ${i}: ${cierre.restriccion ?? ""}`).toBe(true);
          const guardadas = Number(
            (
              await dueno.query<{ n: string }>(
                "select count(*)::text as n from correccion_de_medio where cobro_id = $1",
                [cobro],
              )
            ).rows[0]?.n,
          );
          const enFoto = Number(
            (
              await dueno.query<{ n: string }>(
                "select count(*)::text as n from conciliacion_de_jornada where fecha_negocio = $1 and empresa_id = $2 and correcciones <> 0",
                [fecha, m.empresa],
              )
            ).rows[0]?.n,
          );
          if (correccion.confirmo) {
            corregidas++;
            expect(guardadas, `ronda ${i}`).toBe(1);
            expect(enFoto, `ronda ${i}: la corrección confirmada está en la foto`).toBe(2);
          } else {
            rechazadas++;
            expect(guardadas, `ronda ${i}`).toBe(0);
            expect(enFoto, `ronda ${i}`).toBe(0);
            expect(["correccion_de_medio_jornada_no_en_auditoria"], `ronda ${i}`).toContain(
              correccion.restriccion,
            );
          }
        }
        expect(corregidas).toBeGreaterThan(0);
        expect(rechazadas).toBeGreaterThan(0);
      });

      it("dos correcciones del mismo cobro a la vez: una gana y la otra pierde por la clave (cobro, secuencia)", async () => {
        for (let i = 0; i < 20; i++) {
          const fecha = diaDe(2028, 5, i);
          const { cobro } = await jornadaConCobroDeCredito(fecha);
          const barrera = crearBarrera(2);
          const corregirA = async (destino: "TARJETA_DEBITO" | "QR"): Promise<Resultado> => {
            const s = await abrirTx();
            try {
              await barrera();
              const r = await s.intentar(
                `insert into correccion_de_medio (empresa_id, cobro_id, secuencia, sucursal_id, fecha_negocio, medio_antes_id, cuenta_antes_id,
                                                medio_despues_id, cuenta_despues_id, motivo, corregido_en, corregido_por, clave_idempotencia, huella)
               values ($1, $2, 1, $3, $4, $5, $6, $7, $8, 'Era otro', $9, $10, $11, $12)`,
                [
                  m.empresa,
                  cobro,
                  m.sucursal,
                  fecha,
                  esc.medios.TARJETA_CREDITO,
                  esc.cuentas.terminal,
                  esc.medios[destino],
                  destino === "QR" ? null : esc.cuentas.terminal,
                  AHORA,
                  m.persona,
                  claveNueva(),
                  HUELLA,
                ],
              );
              if (!r.ok) return deIntento(r);
              await esperar(20);
              return deIntento(await s.confirmar());
            } finally {
              await s.cerrar();
            }
          };
          const [a, b] = await Promise.all([corregirA("TARJETA_DEBITO"), corregirA("QR")]);
          expect([a.confirmo, b.confirmo].filter(Boolean), `ronda ${i}`).toHaveLength(1);
          // Quien pierde choca con la clave primaria `(cobro, secuencia)` si las dos llegaron antes de que la otra confirmara, o con el disparador
          // de la secuencia si la otra ya había confirmado cuando el disparador leyó (dos desenlaces válidos de la misma carrera; fallaba 1 de 20).
          expect(
            ["correccion_de_medio_pkey", "correccion_de_medio_secuencia_invalida"],
            `ronda ${i}`,
          ).toContain((a.confirmo ? b : a).restriccion);
          const secuencias = (
            await dueno.query<{ secuencia: number }>(
              "select secuencia from correccion_de_medio where cobro_id = $1",
              [cobro],
            )
          ).rows;
          expect(secuencias).toEqual([{ secuencia: 1 }]);
        }
      });

      /** Una jornada EN_AUDITORIA con una sesión cerrada y un cobro de crédito de 100,00 (todo confirmado). */
      async function jornadaConCobroDeCredito(fecha: string): Promise<{ cobro: string }> {
        const caja = await crearCaja(dueno, m, `Jornada ${fecha}`);
        let cobroId = "";
        await conAppDe(propia.base, m, async (s) => {
          const { sesion } = await abrirSesion(s, esc, { caja, abiertaEn: `${fecha}T15:00:00Z` });
          cobroId = await cobrar(s, esc, sesion, {
            medio: "TARJETA_CREDITO",
            cuenta: esc.cuentas.terminal,
            importe: "100.00",
          });
          await cerrarSesion(s, esc, sesion, { billetes: { 1000: 1 } });
          acepta(await s.confirmar());
        });
        await conAppDe(propia.base, m, async (s) => {
          acepta(
            await s.intentar(
              `update jornada_de_sucursal set estado = 'EN_AUDITORIA', auditoria_iniciada_en = $3, auditoria_iniciada_por = $4
              where empresa_id = $1 and sucursal_id = $5 and fecha_negocio = $2`,
              [m.empresa, fecha, AHORA, m.persona, m.sucursal],
            ),
          );
          acepta(await s.confirmar());
        });
        return { cobro: cobroId };
      }
    });
  },
);
