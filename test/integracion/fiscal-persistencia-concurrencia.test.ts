import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  cerrarSerie,
  confirmarDatosFiscales,
  confirmarReglaDeEmisor,
  domicilioId,
  editarBorrador,
  emisorId,
  iniciarSerie,
  puntoDeVentaId,
  reservarNumero,
  solicitudId,
  traducirErroresDeFiscal,
  versionId,
  type Emisor,
  type ErrorDeNumeracion,
  type SolicitudId,
} from "../../src/modulos/fiscal/publico";
import type { Contexto } from "../../src/contexto/contexto";
import type { Aislamiento } from "../../src/puertos/transacciones";
import { empresaId, personaId, tenantId } from "../../src/primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import { crearBarrera, crearBaseAparte, cuitAlAzar } from "./entorno";
import {
  crearDomicilio,
  crearMundo,
  crearPuntoDeVenta,
  crearSerie,
  type Mundo,
} from "./fiscal-apoyo";
import {
  contextoDeApp,
  contextoDePlataforma,
  crearEntornoFiscal,
  elPrincipal,
  nuevoId,
  unBorrador,
  unDomicilio,
  unPuntoDeVenta,
  type TxFiscalDePrueba,
} from "./fiscal-persistencia-apoyo";

/**
 * H7 (fiscal base), tramo T4: concurrencia REAL de los repositorios fiscales. Cada prueba lanza varias
 * transacciones a la vez (`Promise.all`) y, con una barrera dentro de cada transacción, fuerza que
 * TODAS hayan empezado antes de que cualquiera escriba: es el cruce que importa. Después mira la base:
 * nunca hay duplicados ni estados inválidos, y quien pierde la carrera recibe el MISMO resultado
 * exitoso (cuando la acción era la misma) o el error con nombre (cuando era otra), nunca una excepción
 * cruda ni un éxito falso.
 *
 * No hay tabla de comprobantes en H7 (es de la facturación): la idempotencia por origen
 * `(empresa, origen_tipo, origen_id, emisor, clase)` se prueba cuando exista esa tabla.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const RONDAS = 10;
const AISLAMIENTOS: readonly Aislamiento[] = ["serializable", "read committed"];
const AHORA = new Date("2026-10-12T12:00:00Z");

describe.skipIf(base === null)("fiscal T4: concurrencia de los repositorios", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoFiscal>;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoFiscal(propia.base, 12);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const consultar = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[] = [],
  ) => (await dueno.query<T>(texto, parametros)).rows;
  const cuenta = async (texto: string, parametros: unknown[] = []) =>
    Number((await consultar<{ n: string }>(texto, parametros))[0]?.n);
  const mundo = (opciones: Parameters<typeof crearMundo>[1] = {}) => crearMundo(dueno, opciones);
  const app = (m: Mundo) => contextoDeApp(m);
  const empresaDe = (m: Mundo) => empresaId(m.empresa);

  /**
   * `n` transacciones a la vez; cada una espera en la barrera, después de haber empezado, antes de hacer
   * su trabajo. Devuelve los `Resultado` tal como los recibe quien llama.
   */
  async function enParalelo<T>(
    contexto: Contexto | readonly Contexto[],
    trabajos: readonly ((tx: TxFiscalDePrueba) => Promise<T>)[],
    aislamiento: Aislamiento = "serializable",
  ) {
    const barrera = crearBarrera(trabajos.length);
    return Promise.all(
      trabajos.map((trabajo, i) =>
        entorno.ejecutar(
          {
            contexto: Array.isArray(contexto) ? (contexto[i] as Contexto) : (contexto as Contexto),
            aislamiento,
          },
          async (tx) => {
            await sql`select 1`.execute(tx.db); // la transacción ya empezó
            await barrera();
            return ok(await trabajo(tx));
          },
        ),
      ),
    );
  }
  /** Desarma un `Resultado` de la transacción: un error de la base acá es un fallo del test. */
  function valor<T>(r: Resultado<T, unknown>): T {
    if (!r.ok) throw new Error(`falló la transacción: ${JSON.stringify(r.error)}`);
    return r.valor;
  }

  // ===============================================================================================
  // Altas con id de la aplicación: la misma acción repetida a la vez deja UN efecto
  // ===============================================================================================
  describe("idempotencia: la misma alta a la vez", () => {
    for (const aislamiento of AISLAMIENTOS) {
      it(`dos altas del mismo punto de venta (mismo id) a la vez dejan una fila y las dos reciben el mismo punto de venta [${aislamiento}]`, async () => {
        for (let n = 0; n < RONDAS; n++) {
          const m = await mundo();
          const principal = await (async () => {
            const r = await entorno.ejecutar({ contexto: app(m) }, async (tx) =>
              ok(await elPrincipal(tx, m)),
            );
            return valor(r);
          })();
          const pv = unPuntoDeVenta(m, principal, { numero: 1 });
          const rs = await enParalelo(
            app(m),
            [(tx) => tx.puntosDeVenta.crear(pv), (tx) => tx.puntosDeVenta.crear(pv)],
            aislamiento,
          );
          const [a, b] = rs.map((r) => valor(r));
          expect(a, `ronda ${n}`).toEqual(expect.objectContaining({ ok: true }));
          expect(b, `ronda ${n}`).toEqual(expect.objectContaining({ ok: true }));
          if (!a?.ok || !b?.ok) return;
          expect([a.valor.creado, b.valor.creado].sort(), `ronda ${n}`).toEqual([false, true]);
          expect(a.valor.valor, `ronda ${n}`).toEqual(b.valor.valor);
          expect(
            await cuenta("select count(*) as n from punto_de_venta where empresa_id = $1", [
              m.empresa,
            ]),
          ).toBe(1);
        }
      });
    }

    it("dos altas del mismo domicilio (mismo id y contenido) a la vez dejan una fila y las dos tienen éxito", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const m = await mundo();
        const id = domicilioId(nuevoId());
        const alta = (tx: TxFiscalDePrueba) => tx.domicilios.crear(empresaDe(m), id, unDomicilio());
        const rs = (await enParalelo(app(m), [alta, alta])).map(valor);
        expect(
          rs.every((r) => r.ok),
          `ronda ${n}`,
        ).toBe(true);
        expect(rs.map((r) => r.ok && r.valor.creado).sort(), `ronda ${n}`).toEqual([false, true]);
        expect(await cuenta("select count(*) as n from domicilio where id = $1", [id])).toBe(1);
      }
    });

    it("dos altas del mismo borrador de datos fiscales (mismo id) a la vez dejan una fila y las dos tienen éxito", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const m = await mundo();
        const b = await (async () => {
          const r = await entorno.ejecutar({ contexto: app(m) }, async (tx) =>
            ok(unBorrador(m, await elPrincipal(tx, m))),
          );
          return valor(r);
        })();
        const alta = (tx: TxFiscalDePrueba) => tx.datosFiscales.crearBorrador(b);
        const rs = (await enParalelo(app(m), [alta, alta])).map(valor);
        expect(rs.map((r) => r.ok && r.valor.creado).sort(), `ronda ${n}`).toEqual([false, true]);
        expect(
          await cuenta("select count(*) as n from datos_fiscales where empresa_id = $1", [
            m.empresa,
          ]),
        ).toBe(1);
      }
    });

    it("dos altas del mismo borrador de la regla (mismo id) a la vez dejan una fila y las dos tienen éxito", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const m = await mundo();
        const b = {
          id: versionId(nuevoId()),
          empresaId: empresaDe(m),
          permitirEleccionManual: true,
          creadoPor: personaId(m.persona),
        };
        const alta = (tx: TxFiscalDePrueba) => tx.reglas.crearBorrador(b);
        const rs = (await enParalelo(app(m), [alta, alta])).map(valor);
        expect(rs.map((r) => r.ok && r.valor.creado).sort(), `ronda ${n}`).toEqual([false, true]);
        expect(
          await cuenta("select count(*) as n from regla_emisor where empresa_id = $1", [m.empresa]),
        ).toBe(1);
      }
    });

    it("dos altas del mismo emisor secundario (misma empresa y CUIT) a la vez dejan un emisor y las dos reciben el mismo", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const m = await mundo();
        const cuit = cuitAlAzar();
        const alta = (tx: TxFiscalDePrueba) => tx.emisores.crearSecundario(empresaDe(m), cuit);
        const rs = (await enParalelo(contextoDePlataforma(), [alta, alta])).map(valor);
        expect(
          rs.every((r) => r.ok),
          `ronda ${n}`,
        ).toBe(true);
        expect(rs.map((r) => r.ok && r.valor.creado).sort(), `ronda ${n}`).toEqual([false, true]);
        const [x, y] = rs;
        expect(x?.ok && y?.ok && x.valor.valor, `ronda ${n}`).toEqual(y?.ok && y.valor.valor);
        expect(await cuenta("select count(*) as n from emisor where cuit = $1", [cuit])).toBe(1);
      }
    });

    it("dos altas de la misma serie a la vez dejan una fila, sin pisar el último número", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const m = await mundo();
        const pv = await crearPuntoDeVenta(dueno, m);
        const serie = (ultimo: bigint) => {
          const r = iniciarSerie(
            {
              empresaId: empresaDe(m),
              puntoDeVentaId: puntoDeVentaId(pv),
              emisorId: emisorId(m.emisor),
              tipo: "FACTURA_B",
              ambiente: "HOMOLOGACION",
            },
            ultimo,
          );
          if (!r.ok) throw new Error("serie inválida");
          return r.valor;
        };
        const rs = (
          await enParalelo(app(m), [
            (tx) => tx.series.crear(serie(10n)),
            (tx) => tx.series.crear(serie(10n)),
          ])
        ).map(valor);
        expect(rs.map((r) => r.creado).sort(), `ronda ${n}`).toEqual([false, true]);
        expect(rs[0]?.valor, `ronda ${n}`).toEqual(rs[1]?.valor);
        expect(
          await cuenta(
            "select count(*) as n from serie_comprobante where punto_de_venta_id = $1 and ultimo_numero = 10",
            [pv],
          ),
        ).toBe(1);
      }
    });
  });

  // ===============================================================================================
  // Altas distintas que compiten por lo mismo: gana una, la otra recibe el error con nombre
  // ===============================================================================================
  describe("unicidad: dos altas distintas que compiten por lo mismo", () => {
    for (const aislamiento of AISLAMIENTOS) {
      it(`dos puntos de venta con el mismo número del mismo emisor: gana uno, el otro es PUNTO_DE_VENTA_DUPLICADO [${aislamiento}]`, async () => {
        for (let n = 0; n < RONDAS; n++) {
          const m = await mundo();
          const principal = valor(
            await entorno.ejecutar({ contexto: app(m) }, async (tx) =>
              ok(await elPrincipal(tx, m)),
            ),
          );
          const alta = (tx: TxFiscalDePrueba) =>
            tx.puntosDeVenta.crear(unPuntoDeVenta(m, principal, { numero: 5 }));
          const rs = await enParalelo(app(m), [alta, alta], aislamiento);
          const traducidos = rs.map((r) =>
            traducirErroresDeFiscal(r, ["PUNTO_DE_VENTA_DUPLICADO"]),
          );
          const ganaron = traducidos.filter((r) => r.ok);
          const perdieron = traducidos.filter((r) => !r.ok);
          expect(ganaron, `ronda ${n}`).toHaveLength(1);
          expect(perdieron, `ronda ${n}`).toEqual([err("PUNTO_DE_VENTA_DUPLICADO")]);
          expect(
            await cuenta(
              "select count(*) as n from punto_de_venta where empresa_id = $1 and numero = 5",
              [m.empresa],
            ),
          ).toBe(1);
        }
      });
    }

    it("el mismo número en DOS emisores distintos de la misma empresa entra en los dos, a la vez", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const m = await mundo();
        const sec = valor(
          await entorno.ejecutar({ contexto: contextoDePlataforma() }, async (tx) => {
            const r = await tx.emisores.crearSecundario(empresaDe(m), cuitAlAzar());
            return r.ok ? ok(r.valor.valor) : err(r.error);
          }),
        );
        const principal = valor(
          await entorno.ejecutar({ contexto: app(m) }, async (tx) => ok(await elPrincipal(tx, m))),
        );
        const rs = await enParalelo(app(m), [
          (tx) => tx.puntosDeVenta.crear(unPuntoDeVenta(m, principal, { numero: 1 })),
          (tx) => tx.puntosDeVenta.crear(unPuntoDeVenta(m, sec, { numero: 1 })),
        ]);
        expect(
          rs.map((r) => valor(r).ok),
          `ronda ${n}`,
        ).toEqual([true, true]);
      }
    });

    it("dos borradores de datos fiscales del mismo emisor con ids distintos: gana uno, el otro es YA_HAY_BORRADOR", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const m = await mundo();
        const principal = valor(
          await entorno.ejecutar({ contexto: app(m) }, async (tx) => ok(await elPrincipal(tx, m))),
        );
        const alta = (tx: TxFiscalDePrueba) =>
          tx.datosFiscales.crearBorrador(unBorrador(m, principal));
        const rs = await enParalelo(app(m), [alta, alta]);
        const traducidos = rs.map((r) => traducirErroresDeFiscal(r, ["YA_HAY_BORRADOR"]));
        expect(
          traducidos.filter((r) => r.ok),
          `ronda ${n}`,
        ).toHaveLength(1);
        expect(
          traducidos.filter((r) => !r.ok),
          `ronda ${n}`,
        ).toEqual([err("YA_HAY_BORRADOR")]);
      }
    });

    it("el mismo CUIT como emisor secundario de DOS empresas a la vez: gana una; la otra recibe CUIT_EN_USO como resultado", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const a = await mundo();
        const b = await mundo();
        const cuit = cuitAlAzar();
        const rs = await enParalelo(contextoDePlataforma(), [
          (tx) => tx.emisores.crearSecundario(empresaDe(a), cuit),
          (tx) => tx.emisores.crearSecundario(empresaDe(b), cuit),
        ]);
        const resultados = rs.map((r) => traducirErroresDeFiscal(r, ["CUIT_EN_USO"]));
        // O bien el resultado es el éxito de una (`ok` con el `Resultado` interno) y el error de la otra...
        const planos = resultados.map((r) => (r.ok ? r.valor : r.error));
        const exitos = planos.filter(
          (p) => typeof p === "object" && p !== null && "ok" in p && p.ok,
        );
        expect(exitos, `ronda ${n}`).toHaveLength(1);
        const perdedor = planos.find(
          (p) => !(typeof p === "object" && p !== null && "ok" in p && p.ok),
        );
        expect(perdedor, `ronda ${n}`).toEqual(err("CUIT_EN_USO"));
        expect(await cuenta("select count(*) as n from emisor where cuit = $1", [cuit])).toBe(1);
      }
    });

    it("un emisor secundario y el alta de una empresa con el MISMO CUIT a la vez: gana uno solo, el otro CUIT_EN_USO", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const m = await mundo();
        const cuit = cuitAlAzar();
        const rs = await enParalelo(contextoDePlataforma(), [
          async (tx) => {
            const r = await tx.emisores.crearSecundario(empresaDe(m), cuit);
            return r.ok ? ("emisor" as const) : ("rechazado" as const);
          },
          async (tx) => {
            await tx.empresas.crear({
              tenantId: tenantId(m.tenant),
              cuit,
              razonSocial: `empresa-${nuevoId().slice(0, 8)}`,
            });
            return "empresa" as const;
          },
        ]);
        const traducidos = rs.map((r) => traducirErroresDeFiscal(r, ["CUIT_EN_USO"]));
        const ganaron = traducidos.filter((r) => r.ok && r.valor !== "rechazado");
        expect(ganaron, `ronda ${n}`).toHaveLength(1);
        const perdieron = traducidos.filter((r) => !r.ok || r.valor === "rechazado");
        expect(perdieron, `ronda ${n}`).toHaveLength(1);
        const [perdedor] = perdieron;
        if (perdedor?.ok) expect(perdedor.valor).toBe("rechazado");
        else expect(perdedor).toEqual(err("CUIT_EN_USO"));
        const enEmisor = await cuenta("select count(*) as n from emisor where cuit = $1", [cuit]);
        const enEmpresa = await cuenta("select count(*) as n from empresa where cuit = $1", [cuit]);
        expect(enEmisor + enEmpresa, `ronda ${n}`).toBe(1);
      }
    });
  });

  // ===============================================================================================
  // Confirmaciones: un solo efecto, y la repetición ve «ya estaba»
  // ===============================================================================================
  describe("confirmaciones", () => {
    /**
     * Confirma como lo haría el caso de uso: lee, si ya estaba confirmada devuelve esa («ya estaba»);
     * si no, confirma y, si otra transacción llegó antes (`null`), vuelve a leer.
     */
    async function confirmarComoCasoDeUso(
      tx: TxFiscalDePrueba,
      m: Mundo,
      principal: Emisor,
      id: string,
    ) {
      const actual = await tx.datosFiscales.obtener(empresaDe(m), versionId(id));
      if (actual === null) throw new Error("el borrador no existe");
      if (actual.estado === "CONFIRMADA")
        return { numero: actual.confirmada.numero, yaEstaba: true };
      const existentes = await tx.datosFiscales.confirmadas(empresaDe(m), principal.id);
      const c = confirmarDatosFiscales(actual.borrador, existentes, {
        ahora: AHORA,
        vigenteDesde: AHORA,
        motivo: "alta",
        confirmadaPor: personaId(m.persona),
      });
      if (!c.ok) throw new Error(`no se pudo confirmar: ${JSON.stringify(c.error)}`);
      const hecha = await tx.datosFiscales.confirmar(c.valor);
      if (hecha !== null) return { numero: hecha.numero, yaEstaba: false };
      const despues = await tx.datosFiscales.obtener(empresaDe(m), versionId(id));
      if (despues?.estado !== "CONFIRMADA") throw new Error("la confirmación se perdió");
      return { numero: despues.confirmada.numero, yaEstaba: true };
    }

    it("dos confirmaciones del mismo borrador a la vez: una sola surte efecto (número 1) y la otra ve «ya estaba»", async () => {
      for (const aislamiento of AISLAMIENTOS) {
        for (let n = 0; n < RONDAS; n++) {
          const m = await mundo();
          const dom = domicilioId(await crearDomicilio(dueno, m.empresa));
          const principal = valor(
            await entorno.ejecutar({ contexto: app(m) }, async (tx) =>
              ok(await elPrincipal(tx, m)),
            ),
          );
          const completo = (() => {
            const r = editarBorrador(unBorrador(m, principal), {
              razonSocial: "Confirmada SA",
              condicionIva: "MONOTRIBUTO",
              domicilioFiscalId: dom,
              inicioActividades: "2020-01-01",
            });
            if (!r.ok) throw new Error("borrador inválido");
            return r.valor;
          })();
          valor(
            await entorno.ejecutar({ contexto: app(m) }, async (tx) =>
              ok(await tx.datosFiscales.crearBorrador(completo)),
            ),
          );
          valor(
            await entorno.ejecutar({ contexto: app(m) }, async (tx) =>
              ok(await tx.datosFiscales.guardarBorrador(completo)),
            ),
          );
          const rs = (
            await enParalelo(
              app(m),
              [
                (tx) => confirmarComoCasoDeUso(tx, m, principal, completo.id),
                (tx) => confirmarComoCasoDeUso(tx, m, principal, completo.id),
              ],
              aislamiento,
            )
          ).map(valor);
          expect(
            rs.map((r) => r.numero),
            `${aislamiento} ronda ${n}`,
          ).toEqual([1, 1]);
          expect(
            rs.filter((r) => !r.yaEstaba),
            `${aislamiento} ronda ${n}`,
          ).toHaveLength(1);
          expect(
            await cuenta(
              "select count(*) as n from datos_fiscales where empresa_id = $1 and estado = 'CONFIRMADA'",
              [m.empresa],
            ),
          ).toBe(1);
        }
      }
    });

    it("dos confirmaciones de la regla del emisor a la vez: una sola surte efecto y la otra ve «ya estaba»", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const m = await mundo();
        const b = {
          id: versionId(nuevoId()),
          empresaId: empresaDe(m),
          permitirEleccionManual: false,
          creadoPor: personaId(m.persona),
        };
        valor(
          await entorno.ejecutar({ contexto: app(m) }, async (tx) =>
            ok(await tx.reglas.crearBorrador(b)),
          ),
        );
        const confirmar = async (tx: TxFiscalDePrueba) => {
          const c = confirmarReglaDeEmisor({ permitirEleccionManual: false }, [], {
            id: b.id,
            empresaId: b.empresaId,
            confirmadaPor: b.creadoPor,
            ahora: AHORA,
            vigenteDesde: AHORA,
            motivo: "alta",
          });
          if (!c.ok) throw new Error("no se pudo confirmar");
          const hecha = await tx.reglas.confirmar(c.valor, 1);
          if (hecha !== null) return "confirmada";
          const despues = await tx.reglas.obtener(empresaDe(m), b.id);
          return despues?.estado === "CONFIRMADA" ? "ya estaba" : "perdida";
        };
        const rs = (await enParalelo(app(m), [confirmar, confirmar])).map(valor);
        expect(rs.sort(), `ronda ${n}`).toEqual(["confirmada", "ya estaba"]);
        expect(
          await cuenta(
            "select count(*) as n from regla_emisor where empresa_id = $1 and estado = 'CONFIRMADA' and numero = 1",
            [m.empresa],
          ),
        ).toBe(1);
      }
    });
  });

  // ===============================================================================================
  // Series: la reserva con versión
  // ===============================================================================================
  describe("series: reservas simultáneas", () => {
    /**
     * Reserva como lo haría el caso de uso de T6: lee, aplica el dominio, guarda con la versión; si
     * otra transacción llegó antes (`null`), vuelve a leer y decide con lo nuevo. Devuelve el número
     * reservado o el error de numeración.
     */
    async function reservar(
      tx: TxFiscalDePrueba,
      m: Mundo,
      pv: string,
      solicitud: SolicitudId,
    ): Promise<Resultado<bigint, ErrorDeNumeracion>> {
      for (let intento = 0; intento < 3; intento++) {
        const serie = await tx.series.obtener(
          empresaDe(m),
          puntoDeVentaId(pv),
          "FACTURA_B",
          "HOMOLOGACION",
        );
        if (serie === null) throw new Error("la serie no existe");
        const r = reservarNumero(serie, solicitud, AHORA);
        if (!r.ok) return r;
        if (r.valor.tipo === "YA_RESERVADA") return ok(r.valor.numero);
        const guardada = await tx.series.guardar(r.valor.serie);
        if (guardada !== null) return ok(r.valor.numero);
      }
      throw new Error("la reserva no se resolvió");
    }
    const conSerie = async () => {
      const m = await mundo();
      const pv = await crearPuntoDeVenta(dueno, m);
      await crearSerie(dueno, m.empresa, pv, m.emisor);
      return { m, pv };
    };

    for (const aislamiento of AISLAMIENTOS) {
      it(`dos solicitudes DISTINTAS reservan la misma serie a la vez: una obtiene el número 1 y la otra SERIE_OCUPADA [${aislamiento}]`, async () => {
        for (let n = 0; n < RONDAS; n++) {
          const { m, pv } = await conSerie();
          const rs = (
            await enParalelo(
              app(m),
              [
                (tx) => reservar(tx, m, pv, solicitudId(nuevoId())),
                (tx) => reservar(tx, m, pv, solicitudId(nuevoId())),
              ],
              aislamiento,
            )
          ).map(valor);
          expect(
            rs.filter((r) => r.ok),
            `ronda ${n}`,
          ).toEqual([ok(1n)]);
          expect(
            rs.filter((r) => !r.ok),
            `ronda ${n}`,
          ).toEqual([err("SERIE_OCUPADA")]);
          expect(
            await consultar(
              "select estado, ultimo_numero::text, numero_en_curso::text from serie_comprobante where punto_de_venta_id = $1",
              [pv],
            ),
          ).toEqual([{ estado: "EN_CURSO", ultimo_numero: "0", numero_en_curso: "1" }]);
        }
      });

      it(`la MISMA solicitud reserva dos veces a la vez: las dos reciben el mismo número y la serie avanza una sola vez [${aislamiento}]`, async () => {
        for (let n = 0; n < RONDAS; n++) {
          const { m, pv } = await conSerie();
          const solicitud = solicitudId(nuevoId());
          const rs = (
            await enParalelo(
              app(m),
              [(tx) => reservar(tx, m, pv, solicitud), (tx) => reservar(tx, m, pv, solicitud)],
              aislamiento,
            )
          ).map(valor);
          expect(rs, `ronda ${n}`).toEqual([ok(1n), ok(1n)]);
          expect(
            await consultar(
              "select estado, ultimo_numero::text, numero_en_curso::text, version from serie_comprobante where punto_de_venta_id = $1",
              [pv],
            ),
          ).toEqual([{ estado: "EN_CURSO", ultimo_numero: "0", numero_en_curso: "1", version: 2 }]);
        }
      });
    }

    it("cerrar la misma reserva dos veces a la vez avanza el último número UNA vez", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const { m, pv } = await conSerie();
        const solicitud = solicitudId(nuevoId());
        valor(
          await entorno.ejecutar({ contexto: app(m) }, async (tx) =>
            ok(await reservar(tx, m, pv, solicitud)),
          ),
        );
        const cerrar = async (tx: TxFiscalDePrueba) => {
          const serie = await tx.series.obtener(
            empresaDe(m),
            puntoDeVentaId(pv),
            "FACTURA_B",
            "HOMOLOGACION",
          );
          if (serie === null) throw new Error("la serie no existe");
          const c = cerrarSerie(serie, solicitud, "AUTORIZADO");
          // Si la otra ya la cerró, la solicitud ya no está vigente: es un «ya estaba».
          if (!c.ok) return c.error;
          const guardada = await tx.series.guardar(c.valor.serie);
          return guardada === null ? "PERDIDA" : "CERRADA";
        };
        const rs = (await enParalelo(app(m), [cerrar, cerrar])).map(valor);
        // Una cierra; la otra o no encuentra la reserva vigente (`SOLICITUD_NO_VIGENTE`) o pierde la versión.
        expect(
          rs.filter((r) => r === "CERRADA"),
          `ronda ${n}`,
        ).toHaveLength(1);
        expect(
          await consultar(
            "select estado, ultimo_numero::text from serie_comprobante where punto_de_venta_id = $1",
            [pv],
          ),
        ).toEqual([{ estado: "LIBRE", ultimo_numero: "1" }]);
      }
    });
  });

  // ===============================================================================================
  // Dos roles a la vez: activar un punto de venta mientras se desactiva su emisor
  // ===============================================================================================
  it("activar un punto de venta (aplicación) mientras la plataforma desactiva su emisor: nunca queda un punto de venta activo con el emisor inactivo", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const m = await mundo();
      const sec = valor(
        await entorno.ejecutar({ contexto: contextoDePlataforma() }, async (tx) => {
          const r = await tx.emisores.crearSecundario(empresaDe(m), cuitAlAzar());
          return r.ok ? ok(r.valor.valor) : err(r.error);
        }),
      );
      const dom = await crearDomicilio(dueno, m.empresa);
      const pvId = await crearPuntoDeVenta(dueno, m, { emisor: sec.id, domicilio: dom });
      const pv = valor(
        await entorno.ejecutar({ contexto: app(m) }, async (tx) =>
          ok(await tx.puntosDeVenta.obtener(empresaDe(m), puntoDeVentaId(pvId))),
        ),
      );
      if (pv === null) throw new Error("el punto de venta no existe");
      const rs = await enParalelo<unknown>(
        [app(m), contextoDePlataforma()],
        [
          (tx) => tx.puntosDeVenta.guardar({ ...pv, estado: "ACTIVO" }),
          (tx) => tx.emisores.guardar({ ...sec, activo: false }),
        ],
      );
      // Pueden ganar los dos en orden (activa y falla la baja del emisor, o baja el emisor y falla
      // la activación), pero nunca los dos cambios a la vez.
      const filas = await consultar<{ estado: string; activo: boolean }>(
        `select p.estado, e.activo from punto_de_venta p join emisor e on e.id = p.emisor_id where p.id = $1`,
        [pvId],
      );
      expect(filas[0]?.estado === "ACTIVO" && filas[0]?.activo === false, `ronda ${n}`).toBe(false);
      for (const r of rs) {
        if (!r.ok) {
          const traducido = traducirErroresDeFiscal(r, [
            "EMISOR_INACTIVO",
            "EMISOR_CON_PUNTOS_DE_VENTA_ACTIVOS",
          ]);
          expect(traducido.ok, `ronda ${n}: ${JSON.stringify(r.error)}`).toBe(false);
          expect(["EMISOR_INACTIVO", "EMISOR_CON_PUNTOS_DE_VENTA_ACTIVOS"]).toContain(
            traducido.ok ? "" : traducido.error,
          );
        }
      }
    }
  });
});
