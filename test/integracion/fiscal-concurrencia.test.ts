import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  cerrarSerie,
  reconciliarSerie,
  reservarNumero,
  verificarSecuencia,
  emisorId,
  puntoDeVentaId,
  solicitudId,
  type DesenlaceDeAutorizacion,
  type ErrorDeNumeracion,
  type Serie,
} from "../../src/modulos/fiscal/publico";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import {
  comoEmpresa,
  comoPlataforma,
  crearBarrera,
  crearBaseAparte,
  crearEntornoDePrueba,
  cuitAlAzar,
} from "./entorno";
import {
  acepta,
  crearDomicilio,
  crearMundo,
  crearPuntoDeVenta,
  crearSerie,
  type Mundo,
} from "./fiscal-apoyo";
import { SesionDePrueba, esperarBloqueo } from "./sesiones";

/**
 * H7 (fiscal base), tramo T3: concurrencia REAL de lo que la base impone en lo fiscal, sin los casos
 * de uso (eso es T6): cada prueba lanza varias transacciones a la vez y, con una barrera dentro o
 * con sesiones directas, fuerza el entrelazado que importa. Después mira la base.
 *
 *  1. Numeración: muchos trabajadores sobre la misma serie, con una emisión falsa al azar (autoriza,
 *     rechaza, incierto, «autorizó y se cayó»): los números autorizados son exactamente 1..n, sin
 *     repetidos ni huecos, `ultimo_numero = n` y una auditoría por número. Usa las funciones puras
 *     del dominio (`reservarNumero`, `cerrarSerie`, `reconciliarSerie`) sobre la tabla real.
 *  2. Unicidad: dos altas del mismo punto de venta / de la misma versión / del mismo CUIT a la vez.
 *  3. Cruces entre una reserva en vuelo y un cambio de número del punto de venta, del CUIT, o entre
 *     activar un punto de venta y desactivar su emisor.
 *  4. Idempotencia concurrente: la misma acción repetida a la vez deja un solo efecto.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type Aislamiento = "read committed" | "serializable";
const AISLAMIENTOS: readonly Aislamiento[] = ["serializable", "read committed"];
const RONDAS = 12;
/** Las rondas de la numeración son más pesadas (cada una arma una serie y la cierra a mano). */
const RONDAS_DE_NUMERACION = 6;

describe.skipIf(base === null)("fiscal: concurrencia de lo que impone la 0006", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 14);
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
  const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));
  /** Para los mensajes de falla: JSON que sabe de `bigint`. */
  const texto = (valor: unknown): string =>
    JSON.stringify(valor, (_clave, v: unknown) => (typeof v === "bigint" ? v.toString() : v));

  // ===============================================================================================
  // 1. Numeración sin huecos ni duplicados
  // ===============================================================================================
  describe("numeración de una serie", () => {
    type FilaDeSerie = {
      estado: "LIBRE" | "EN_CURSO" | "BLOQUEADA";
      ultimo: string;
      numero: string | null;
      solicitud: string | null;
      hasta: Date | null;
      motivo: string | null;
    };
    type Escena = Readonly<{ m: Mundo; pv: string }>;

    const armar = async (ultimoInicial = 0): Promise<Escena> => {
      const m = await crearMundo(dueno);
      const pv = await crearPuntoDeVenta(dueno, m, { numero: 1 });
      await crearSerie(dueno, m.empresa, pv, m.emisor, "FACTURA_B", ultimoInicial);
      return { m, pv };
    };
    const contexto = (e: Escena) => comoEmpresa(empresaId(e.m.empresa), personaId(e.m.persona));

    const aSerie = (e: Escena, f: FilaDeSerie): Serie => {
      const identidad = {
        empresaId: empresaId(e.m.empresa),
        puntoDeVentaId: puntoDeVentaId(e.pv),
        emisorId: emisorId(e.m.emisor),
        tipo: "FACTURA_B" as const,
        version: 1,
      };
      if (f.estado === "LIBRE")
        return { ...identidad, estado: "LIBRE", ultimoNumero: BigInt(f.ultimo) };
      if (f.estado === "BLOQUEADA") {
        return {
          ...identidad,
          estado: "BLOQUEADA",
          ultimoNumero: BigInt(f.ultimo),
          motivoBloqueo: f.motivo ?? "",
        };
      }
      return {
        ...identidad,
        estado: "EN_CURSO",
        ultimoNumero: BigInt(f.ultimo),
        numeroEnCurso: BigInt(f.numero as string),
        solicitud: solicitudId(f.solicitud as string),
        enCursoHasta: f.hasta as Date,
      };
    };
    const leer = async (
      e: Escena,
      db: Parameters<Parameters<typeof entorno.ejecutar>[1]>[0]["db"],
      aislamiento: Aislamiento,
    ): Promise<Serie> => {
      // Bajo READ COMMITTED hay que bloquear la fila al leerla; bajo SERIALIZABLE lo hace el motor.
      const bloqueo = aislamiento === "read committed" ? sql`for update` : sql``;
      const r = await sql<FilaDeSerie>`
        select estado, ultimo_numero::text as ultimo, numero_en_curso::text as numero,
               solicitud_en_curso::text as solicitud, en_curso_hasta as hasta, motivo_bloqueo as motivo
        from serie_comprobante where punto_de_venta_id = ${e.pv} and tipo_comprobante = 'FACTURA_B' ${bloqueo}`.execute(
        db,
      );
      return aSerie(e, r.rows[0] as FilaDeSerie);
    };

    /** Reservar el próximo número para `solicitud` (idempotente: la misma solicitud, el mismo número). */
    const reservar = (e: Escena, solicitud: string, aislamiento: Aislamiento) =>
      entorno.ejecutar(
        { contexto: contexto(e), aislamiento },
        async ({ db }): Promise<Resultado<bigint, ErrorDeNumeracion>> => {
          const serie = await leer(e, db, aislamiento);
          const reserva = reservarNumero(serie, solicitudId(solicitud), new Date());
          if (!reserva.ok) return err(reserva.error);
          if (reserva.valor.tipo === "YA_RESERVADA") return ok(reserva.valor.numero);
          const nueva = reserva.valor.serie;
          await sql`update serie_comprobante
                       set estado = 'EN_CURSO', numero_en_curso = ${nueva.numeroEnCurso.toString()},
                           solicitud_en_curso = ${nueva.solicitud}, en_curso_hasta = ${nueva.enCursoHasta}
                     where punto_de_venta_id = ${e.pv} and tipo_comprobante = 'FACTURA_B'`.execute(
            db,
          );
          return ok(reserva.valor.numero);
        },
      );

    const auditar = (
      e: Escena,
      db: Parameters<Parameters<typeof entorno.ejecutar>[1]>[0]["db"],
      numero: bigint,
    ) =>
      sql`insert into auditoria_empresa (empresa_id, actor_persona_id, accion, entidad, entidad_id, despues)
          values (${e.m.empresa}, ${e.m.persona}, 'NUMERO_AUTORIZADO', 'serie_comprobante', ${e.pv},
                  ${JSON.stringify({ numero: numero.toString() })}::jsonb)`.execute(db);

    /** Cerrar la reserva según cómo terminó la autorización; serie y auditoría en la misma transacción. */
    const cerrar = (
      e: Escena,
      solicitud: string,
      desenlace: DesenlaceDeAutorizacion,
      aislamiento: Aislamiento,
    ) =>
      entorno.ejecutar(
        { contexto: contexto(e), aislamiento },
        async ({ db }): Promise<Resultado<bigint | null, ErrorDeNumeracion>> => {
          const serie = await leer(e, db, aislamiento);
          const cierre = cerrarSerie(serie, solicitudId(solicitud), desenlace);
          if (!cierre.ok) return err(cierre.error);
          if (cierre.valor.serie.estado === "LIBRE") {
            await sql`update serie_comprobante
                         set estado = 'LIBRE', ultimo_numero = ${cierre.valor.serie.ultimoNumero.toString()},
                             numero_en_curso = null, solicitud_en_curso = null, en_curso_hasta = null
                       where punto_de_venta_id = ${e.pv} and tipo_comprobante = 'FACTURA_B'`.execute(
              db,
            );
          }
          if (cierre.valor.numeroAutorizado !== null)
            await auditar(e, db, cierre.valor.numeroAutorizado);
          return ok(cierre.valor.numeroAutorizado);
        },
      );

    /** La emisión falsa: solo acepta el número siguiente al último que autorizó (como ARCA). */
    class EmisionFalsa {
      readonly autorizados: bigint[] = [];
      autorizar(numero: bigint): void {
        const esperado = BigInt(this.autorizados.length) + 1n;
        if (numero !== esperado)
          throw new Error(`la emisión recibió ${numero} y esperaba ${esperado}`);
        this.autorizados.push(numero);
      }
      ultimoAutorizado(): bigint {
        return BigInt(this.autorizados.length);
      }
    }

    /**
     * Reconcilia una reserva ABANDONADA (el trabajador «se cayó» o no supo el resultado): se pasa
     * como `ahora` el fin del plazo, así que el plazo no depende del reloj de la prueba.
     */
    const reconciliar = (
      e: Escena,
      emision: EmisionFalsa,
      abandonadas: ReadonlySet<string>,
      aislamiento: Aislamiento,
    ) =>
      entorno.ejecutar(
        { contexto: contexto(e), aislamiento },
        async ({ db }): Promise<Resultado<string | null, ErrorDeNumeracion>> => {
          const serie = await leer(e, db, aislamiento);
          if (serie.estado !== "EN_CURSO" || !abandonadas.has(serie.solicitud)) return ok(null);
          const r = reconciliarSerie(serie, emision.ultimoAutorizado(), serie.enCursoHasta);
          if (!r.ok) return err(r.error);
          if (r.valor.serie.estado === "BLOQUEADA")
            throw new Error("la serie quedó bloqueada: desfase inesperado");
          await sql`update serie_comprobante
                       set estado = 'LIBRE', ultimo_numero = ${r.valor.serie.ultimoNumero.toString()},
                           numero_en_curso = null, solicitud_en_curso = null, en_curso_hasta = null
                     where punto_de_venta_id = ${e.pv} and tipo_comprobante = 'FACTURA_B'`.execute(
            db,
          );
          if (r.valor.resolucion === "CERRADA_COMO_AUTORIZADA") {
            await auditar(e, db, r.valor.serie.ultimoNumero);
          }
          return ok(serie.solicitud);
        },
      );

    const esConcurrenciaAgotada = (error: unknown): boolean =>
      typeof error === "object" &&
      error !== null &&
      (error as { tipo?: string }).tipo === "ConcurrenciaAgotada";

    type Resumen = Record<
      "autorizadas" | "rechazadas" | "inciertasQueAutorizaron" | "inciertasQueNo",
      number
    >;

    /** Una ronda: `trabajadores` en paralelo, cada uno con `solicitudes` solicitudes de factura. */
    const ronda = async (
      aislamiento: Aislamiento,
      trabajadores: number,
      solicitudes: number,
      ultimoInicial = 0,
    ) => {
      const e = await armar(ultimoInicial);
      const emision = new EmisionFalsa();
      for (let i = 0; i < ultimoInicial; i++) emision.autorizados.push(BigInt(i + 1));
      const abandonadas = new Set<string>();
      /** Las abandonadas que todavía nadie reconcilió: mientras haya, un trabajador que espera reconcilia. */
      const pendientes = new Set<string>();
      const resumen: Resumen = {
        autorizadas: 0,
        rechazadas: 0,
        inciertasQueAutorizaron: 0,
        inciertasQueNo: 0,
      };

      const trabajador = async () => {
        for (let k = 0; k < solicitudes; k++) {
          const solicitud = randomUUID();
          let numero: bigint | null = null;
          while (numero === null) {
            const r = await reservar(e, solicitud, aislamiento);
            if (r.ok) {
              numero = r.valor;
              break;
            }
            // Ocupada por otra solicitud (o conflicto agotado): se reconcilia lo abandonado y se reintenta.
            if (r.error !== "SERIE_OCUPADA" && !esConcurrenciaAgotada(r.error)) {
              throw new Error(`reservar: ${texto(r.error)}`);
            }
            await reconciliarSiHaceFalta();
            await esperar(randomInt(1, 4));
          }
          // Autorizar: afuera de la transacción, al azar.
          const suerte = randomInt(0, 100);
          if (suerte < 55) {
            emision.autorizar(numero);
            await cerrarConReintento(solicitud, "AUTORIZADO");
            resumen.autorizadas += 1;
          } else if (suerte < 70) {
            await cerrarConReintento(solicitud, "RECHAZADO");
            resumen.rechazadas += 1;
          } else if (suerte < 85) {
            // Autorizó y se cayó antes de cerrar: queda EN_CURSO hasta que alguien reconcilie.
            emision.autorizar(numero);
            abandonadas.add(solicitud);
            pendientes.add(solicitud);
            resumen.inciertasQueAutorizaron += 1;
          } else {
            abandonadas.add(solicitud);
            pendientes.add(solicitud);
            resumen.inciertasQueNo += 1;
          }
        }
      };
      const cerrarConReintento = async (solicitud: string, desenlace: DesenlaceDeAutorizacion) => {
        for (;;) {
          const r = await cerrar(e, solicitud, desenlace, aislamiento);
          if (r.ok) return;
          if (!esConcurrenciaAgotada(r.error)) throw new Error(`cerrar: ${texto(r.error)}`);
          await esperar(randomInt(1, 6));
        }
      };
      const reconciliarSiHaceFalta = async () => {
        if (pendientes.size === 0) return;
        const r = await reconciliar(e, emision, abandonadas, aislamiento);
        if (r.ok) {
          if (r.valor !== null) pendientes.delete(r.valor);
        } else if (!esConcurrenciaAgotada(r.error)) {
          throw new Error(`reconciliar: ${texto(r.error)}`);
        }
      };

      await Promise.all(Array.from({ length: trabajadores }, trabajador));
      // Lo que quedó EN_CURSO se reconcilia hasta que la serie quede libre.
      for (let intento = 0; intento < 50; intento++) {
        const [fila] = await consultar<{ estado: string }>(
          "select estado from serie_comprobante where punto_de_venta_id = $1",
          [e.pv],
        );
        if (fila?.estado === "LIBRE") break;
        await reconciliarSiHaceFalta();
      }

      // ---- lo que tiene que valer ---------------------------------------------------------------
      const total = BigInt(emision.autorizados.length);
      const secuencia = verificarSecuencia(0n, emision.autorizados);
      expect(secuencia, "la emisión autorizó 1..n sin repetidos ni huecos").toEqual(ok(total));
      const [serie] = await consultar<{ estado: string; ultimo: string; numero: string | null }>(
        `select estado, ultimo_numero::text as ultimo, numero_en_curso::text as numero
           from serie_comprobante where punto_de_venta_id = $1`,
        [e.pv],
      );
      expect(serie, "la serie quedó libre y con el último número exacto").toEqual({
        estado: "LIBRE",
        ultimo: total.toString(),
        numero: null,
      });
      const auditorias = await consultar<{ numero: string }>(
        `select despues->>'numero' as numero from auditoria_empresa
          where entidad_id = $1 and accion = 'NUMERO_AUTORIZADO'`,
        [e.pv],
      );
      expect(
        auditorias.map((a) => BigInt(a.numero)).sort((x, y) => Number(x - y)),
        "una auditoría por número autorizado, ni una más",
      ).toEqual(
        Array.from({ length: Number(total) - ultimoInicial }, (_, i) =>
          BigInt(ultimoInicial + i + 1),
        ),
      );
      expect(resumen.autorizadas + resumen.inciertasQueAutorizaron).toBe(
        Number(total) - ultimoInicial,
      );
      return { total: Number(total) - ultimoInicial, resumen };
    };

    it.each(AISLAMIENTOS)(
      "(%s) 8 trabajadores × 50 solicitudes sobre la misma serie, con una emisión falsa al azar: los números autorizados son exactamente 1..n, sin repetidos ni huecos",
      async (aislamiento) => {
        const { total, resumen } = await ronda(aislamiento, 8, 50);
        // La prueba no es vacía: hubo de todo.
        expect(total).toBeGreaterThan(100);
        expect(resumen.rechazadas).toBeGreaterThan(0);
        expect(resumen.inciertasQueAutorizaron).toBeGreaterThan(0);
        expect(resumen.inciertasQueNo).toBeGreaterThan(0);
      },
    );

    it.each(AISLAMIENTOS)(
      "(%s) rondas chicas y repetidas, con la serie empezando en un número alto: nunca un hueco ni un repetido",
      async (aislamiento) => {
        for (let i = 0; i < RONDAS_DE_NUMERACION; i++) {
          await ronda(aislamiento, 4, 10, i * 1000);
        }
      },
    );

    it.each(AISLAMIENTOS)(
      "(%s) dos reservas de solicitudes distintas a la vez: una sola gana y la otra recibe SERIE_OCUPADA; la ganadora, repetida, recibe el mismo número",
      async (aislamiento) => {
        for (let i = 0; i < RONDAS; i++) {
          const e = await armar(7);
          const barrera = crearBarrera(2);
          const intentoDe = (solicitud: string) =>
            entorno.ejecutar(
              { contexto: contexto(e), aislamiento },
              async ({ db }): Promise<Resultado<bigint, ErrorDeNumeracion>> => {
                // Sin bloquear la fila: las dos leen LIBRE antes de que cualquiera escriba.
                const r = await sql<FilaDeSerie>`
                  select estado, ultimo_numero::text as ultimo, numero_en_curso::text as numero,
                         solicitud_en_curso::text as solicitud, en_curso_hasta as hasta, motivo_bloqueo as motivo
                  from serie_comprobante where punto_de_venta_id = ${e.pv}`.execute(db);
                await barrera();
                const reserva = reservarNumero(
                  aSerie(e, r.rows[0] as FilaDeSerie),
                  solicitudId(solicitud),
                  new Date(),
                );
                if (!reserva.ok) return err(reserva.error);
                if (reserva.valor.tipo === "YA_RESERVADA") return ok(reserva.valor.numero);
                const nueva = reserva.valor.serie;
                const escrito = await sql`update serie_comprobante
                             set estado = 'EN_CURSO', numero_en_curso = ${nueva.numeroEnCurso.toString()},
                                 solicitud_en_curso = ${nueva.solicitud}, en_curso_hasta = ${nueva.enCursoHasta}
                           where punto_de_venta_id = ${e.pv} and estado = 'LIBRE'`.execute(db);
                // El UPDATE condicionado al estado: quien llega segundo no toca nada.
                if (Number(escrito.numAffectedRows) === 0) return err("SERIE_OCUPADA");
                return ok(reserva.valor.numero);
              },
            );
          const s1 = randomUUID();
          const s2 = randomUUID();
          const [x, y] = await Promise.all([intentoDe(s1), intentoDe(s2)]);
          const ganadoras = [x, y].filter((r) => r.ok);
          expect(ganadoras, `ronda ${i}: ${texto([x, y])}`).toHaveLength(1);
          const perdedora = [x, y].find((r) => !r.ok);
          expect(perdedora && !perdedora.ok && perdedora.error, `ronda ${i}`).toBe("SERIE_OCUPADA");
          const [serie] = await consultar<{ numero: string; solicitud: string }>(
            `select numero_en_curso::text as numero, solicitud_en_curso::text as solicitud
               from serie_comprobante where punto_de_venta_id = $1`,
            [e.pv],
          );
          expect(serie?.numero, `ronda ${i}`).toBe("8");
          const ganadora = serie?.solicitud as string;
          expect([s1, s2], `ronda ${i}`).toContain(ganadora);
          // Idempotencia: repetir la solicitud ganadora devuelve el mismo número y no cambia nada.
          expect(await reservar(e, ganadora, aislamiento)).toEqual(ok(8n));
          expect(await reservar(e, ganadora, aislamiento)).toEqual(ok(8n));
          // La otra sigue viendo la serie ocupada.
          const otra = ganadora === s1 ? s2 : s1;
          const r = await reservar(e, otra, aislamiento);
          expect(!r.ok && r.error).toBe("SERIE_OCUPADA");
          const [despues] = await consultar<{ version: number }>(
            "select version from serie_comprobante where punto_de_venta_id = $1",
            [e.pv],
          );
          expect(despues?.version, "la serie se actualizó una sola vez").toBe(2);
        }
      },
    );
  });

  // ===============================================================================================
  // 2. Unicidad e idempotencia concurrentes
  // ===============================================================================================
  describe("unicidad e idempotencia", () => {
    const appDe = (m: Mundo, aislamiento: Aislamiento | "repeatable read" = "read committed") =>
      SesionDePrueba.abrir(
        propia.base,
        "zuluhub_app",
        comoEmpresa(empresaId(m.empresa), personaId(m.persona)),
        aislamiento,
      );
    const plataforma = (aislamiento: Aislamiento | "repeatable read" = "read committed") =>
      SesionDePrueba.abrir(propia.base, "zuluhub_plataforma", comoPlataforma(), aislamiento);

    it.each(AISLAMIENTOS)(
      "(%s) dos altas de punto de venta con el mismo número a la vez: gana una; la otra recibe PUNTO_DE_VENTA_DUPLICADO",
      async (aislamiento) => {
        for (let i = 0; i < RONDAS; i++) {
          const m = await crearMundo(dueno);
          const barrera = crearBarrera(2);
          const alta = () =>
            entorno.ejecutar(
              { contexto: comoEmpresa(empresaId(m.empresa), personaId(m.persona)), aislamiento },
              async ({ db }): Promise<Resultado<string, never>> => {
                await sql`select numero from punto_de_venta where empresa_id = ${m.empresa} and emisor_id = ${m.emisor} and numero = 5`.execute(
                  db,
                );
                await barrera();
                await sql`insert into punto_de_venta (id, empresa_id, emisor_id, sucursal_id, numero)
                          values (${randomUUID()}, ${m.empresa}, ${m.emisor}, ${m.sucursal}, 5)`.execute(
                  db,
                );
                return ok("ALTA");
              },
            );
          const [x, y] = await Promise.all([alta(), alta()]);
          expect(
            [x, y].filter((r) => r.ok),
            `ronda ${i}: ${texto([x, y])}`,
          ).toHaveLength(1);
          const perdedora = [x, y].find((r) => !r.ok);
          expect(perdedora && !perdedora.ok && perdedora.error, `ronda ${i}`).toMatchObject({
            tipo: "Unicidad",
            restriccion: "punto_de_venta_numero_uk",
          });
          expect(
            await consultar("select 1 from punto_de_venta where emisor_id = $1 and numero = 5", [
              m.emisor,
            ]),
          ).toHaveLength(1);
        }
      },
    );

    it("el alta repetida del mismo punto de venta (mismo id) a la vez es idempotente: una fila y ningún error con ON CONFLICT DO NOTHING", async () => {
      for (let i = 0; i < RONDAS; i++) {
        const m = await crearMundo(dueno);
        const id = randomUUID();
        const s1 = await appDe(m);
        const s2 = await appDe(m);
        try {
          const insertar = (s: SesionDePrueba) =>
            s.directo(
              `insert into punto_de_venta (id, empresa_id, emisor_id, sucursal_id, numero)
               values ($1, $2, $3, $4, 3) on conflict (id) do nothing`,
              [id, m.empresa, m.emisor, m.sucursal],
            );
          const primero = await insertar(s1);
          expect(primero.ok && primero.filas).toBe(1);
          // La segunda espera a que la primera confirme (la fila ya existe en su intento).
          const segunda = insertar(s2);
          expect(await esperarBloqueo(dueno, s2.pid)).toBe(true);
          expect((await s1.confirmar()).ok).toBe(true);
          const resultado = await segunda;
          expect(resultado.ok && resultado.filas, `ronda ${i}`).toBe(0);
          expect((await s2.confirmar()).ok).toBe(true);
        } finally {
          await s1.cerrar();
          await s2.cerrar();
        }
        expect(await consultar("select 1 from punto_de_venta where id = $1", [id])).toHaveLength(1);
      }
    });

    it("dos confirmaciones de la misma versión de datos fiscales a la vez: una sola surte efecto (la otra encuentra «ya estaba»)", async () => {
      for (const aislamiento of AISLAMIENTOS) {
        for (let i = 0; i < RONDAS; i++) {
          const m = await crearMundo(dueno);
          const domicilio = await crearDomicilio(dueno, m.empresa);
          const id = (
            await dueno.query<{ id: string }>(
              `insert into datos_fiscales (empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id,
                      inicio_actividades, creado_por) values ($1, $2, 'Mi SA', 'EXENTO', $3, '2020-01-01', $4) returning id`,
              [m.empresa, m.emisor, domicilio, m.persona],
            )
          ).rows[0]?.id as string;
          const barrera = crearBarrera(2);
          const confirmar = () =>
            entorno.ejecutar(
              { contexto: comoEmpresa(empresaId(m.empresa), personaId(m.persona)), aislamiento },
              async ({ db }): Promise<Resultado<number, never>> => {
                await sql`select estado from datos_fiscales where id = ${id}`.execute(db);
                await barrera();
                const r = await sql`update datos_fiscales
                  set estado = 'CONFIRMADA', numero = 1, vigente_desde = now() + interval '1 day', confirmada_en = now(),
                      confirmada_por = ${m.persona}, motivo = 'Alta'
                  where id = ${id} and estado = 'BORRADOR'`.execute(db);
                return ok(Number(r.numAffectedRows));
              },
            );
          const [x, y] = await Promise.all([confirmar(), confirmar()]);
          expect(x.ok && y.ok, `(${aislamiento}) ronda ${i}: ${texto([x, y])}`).toBe(true);
          const filasAfectadas = [x, y].map((r) => (r.ok ? r.valor : -1)).sort();
          expect(filasAfectadas, `(${aislamiento}) ronda ${i}`).toEqual([0, 1]);
          expect(
            await consultar("select numero, version from datos_fiscales where id = $1", [id]),
          ).toEqual([{ numero: 1, version: 2 }]);
        }
      }
    });

    it("la versión siguiente espera a que la anterior confirme: números 1 y 2 sin repetir, y un número equivocado se rechaza", async () => {
      for (let i = 0; i < RONDAS; i++) {
        const m = await crearMundo(dueno);
        const domicilio = await crearDomicilio(dueno, m.empresa);
        const borrador = (
          await dueno.query<{ id: string }>(
            `insert into datos_fiscales (empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id,
                    inicio_actividades, creado_por) values ($1, $2, 'Mi SA', 'EXENTO', $3, '2020-01-01', $4) returning id`,
            [m.empresa, m.emisor, domicilio, m.persona],
          )
        ).rows[0]?.id as string;
        const s1 = await appDe(m);
        const s2 = await appDe(m);
        try {
          const confirmar = (s: SesionDePrueba, id: string, numero: number) =>
            s.directo(
              `update datos_fiscales set estado = 'CONFIRMADA', numero = $2, vigente_desde = now(),
                      confirmada_en = now(), confirmada_por = $3, motivo = 'Cambio' where id = $1`,
              [id, numero, m.persona],
            );
          acepta(await confirmar(s1, borrador, 1));
          // Mientras la primera no confirma, el borrador siguiente no puede nacer (única parcial).
          const siguiente = s2.directo(
            `insert into datos_fiscales (empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id,
                    inicio_actividades, creado_por) values ($1, $2, 'Mi SA 2', 'EXENTO', $3, '2020-01-01', $4) returning id`,
            [m.empresa, m.emisor, domicilio, m.persona],
          );
          expect(await esperarBloqueo(dueno, s2.pid)).toBe(true);
          expect((await s1.confirmar()).ok).toBe(true);
          const creado = await siguiente;
          expect(creado.ok, creado.ok ? "" : creado.mensaje).toBe(true);
          const id2 = (creado.ok && creado.rows[0]?.["id"]) as string;
          // El número 1 ya está tomado; tiene que ser el 2.
          const mal = await s2.intentar(
            `update datos_fiscales set estado = 'CONFIRMADA', numero = 1, vigente_desde = now(),
                    confirmada_en = now(), confirmada_por = $2, motivo = 'x' where id = $1`,
            [id2, m.persona],
          );
          expect(!mal.ok && mal.restriccion).toBe("datos_fiscales_numero_invalido");
          acepta(await confirmar(s2, id2, 2));
          expect((await s2.confirmar()).ok).toBe(true);
        } finally {
          await s1.cerrar();
          await s2.cerrar();
        }
        expect(
          (
            await consultar<{ numero: number }>(
              "select numero from datos_fiscales where emisor_id = $1 order by numero",
              [m.emisor],
            )
          ).map((f) => f.numero),
        ).toEqual([1, 2]);
      }
    });

    it.each(["read committed", "serializable"] as const)(
      "(%s) un secundario y el alta de una empresa con el MISMO CUIT a la vez: gana una sola, en cualquier orden de llegada",
      async (aislamiento) => {
        for (const primero of ["emisor", "empresa"] as const) {
          for (let i = 0; i < 4; i++) {
            const m = await crearMundo(dueno);
            const cuit = cuitAlAzar();
            const s1 = await plataforma(aislamiento);
            const s2 = await plataforma(aislamiento);
            const altaDeEmisor = (s: SesionDePrueba) =>
              s.directo(
                "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2)",
                [m.empresa, cuit],
              );
            const altaDeEmpresa = (s: SesionDePrueba) =>
              s.directo(
                "insert into empresa (tenant_id, cuit, razon_social) values ($1, $2, 'carrera')",
                [m.tenant, cuit],
              );
            const [a, b] =
              primero === "emisor" ? [altaDeEmisor, altaDeEmpresa] : [altaDeEmpresa, altaDeEmisor];
            let confirmaciones = 0;
            try {
              const r1 = await a(s1);
              expect(r1.ok, r1.ok ? "" : r1.mensaje).toBe(true);
              // La otra se cruza: espera a que la primera termine (bloqueo por CUIT) o ve su conflicto.
              const r2 = b(s2);
              const esperaba = await esperarBloqueo(dueno, s2.pid, 1500);
              expect(esperaba, "la segunda alta espera el bloqueo del CUIT").toBe(true);
              const c1 = await s1.confirmar();
              if (c1.ok) confirmaciones += 1;
              const resultado2 = await r2;
              if (resultado2.ok) {
                const c2 = await s2.confirmar();
                if (c2.ok) confirmaciones += 1;
                else expect(c2.codigo, c2.mensaje).toBe("40001");
              } else {
                // Bajo READ COMMITTED ve el CUIT ya tomado; bajo SERIALIZABLE puede ver el conflicto de lectura/escritura.
                expect(["23514", "40001"], resultado2.mensaje).toContain(resultado2.codigo);
              }
            } finally {
              await s1.cerrar();
              await s2.cerrar();
            }
            expect(confirmaciones, `${aislamiento}/${primero}/${i}`).toBe(1);
            const tomados = await consultar<{ n: number }>(
              `select (select count(*) from empresa where cuit = $1 and estado <> 'CANCELLED')
                    + (select count(*) from emisor where cuit = $1) as n`,
              [cuit],
            );
            expect(
              Number(tomados[0]?.n),
              `${aislamiento}/${primero}/${i}: el CUIT quedó en un solo lugar`,
            ).toBe(1);
          }
        }
      },
    );
  });

  // ===============================================================================================
  // 3. Cruces con una reserva en vuelo
  // ===============================================================================================
  describe("cruces con una reserva en vuelo", () => {
    type Escena = Readonly<{ m: Mundo; secundario: string; pv: string; pvSecundario: string }>;
    const armar = async (): Promise<Escena> => {
      const m = await crearMundo(dueno);
      const secundario = (
        await dueno.query<{ id: string }>(
          "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2) returning id",
          [m.empresa, cuitAlAzar()],
        )
      ).rows[0]?.id as string;
      const domicilio = await crearDomicilio(dueno, m.empresa);
      const pv = await crearPuntoDeVenta(dueno, m, { numero: 1, domicilio });
      const pvSecundario = await crearPuntoDeVenta(dueno, m, {
        numero: 1,
        emisor: secundario,
        domicilio,
      });
      await crearSerie(dueno, m.empresa, pv, m.emisor);
      await crearSerie(dueno, m.empresa, pvSecundario, secundario);
      return { m, secundario, pv, pvSecundario };
    };
    const app = (
      e: Escena,
      aislamiento: "read committed" | "repeatable read" | "serializable" = "read committed",
    ) =>
      SesionDePrueba.abrir(
        propia.base,
        "zuluhub_app",
        comoEmpresa(empresaId(e.m.empresa), personaId(e.m.persona)),
        aislamiento,
      );
    const plataforma = () =>
      SesionDePrueba.abrir(propia.base, "zuluhub_plataforma", comoPlataforma());
    const reservar = (s: SesionDePrueba, pv: string, tipo = "FACTURA_B") =>
      s.directo(
        `update serie_comprobante set estado = 'EN_CURSO', numero_en_curso = ultimo_numero + 1,
                solicitud_en_curso = gen_random_uuid(), en_curso_hasta = now() + interval '5 minutes'
          where punto_de_venta_id = $1 and tipo_comprobante = $2 and estado = 'LIBRE'`,
        [pv, tipo],
      );
    const cambiarNumero = (s: SesionDePrueba, pv: string, numero: number) =>
      s.directo("update punto_de_venta set numero = $2 where id = $1", [pv, numero]);

    it("cambiar el número del punto de venta MIENTRAS se reserva su serie: o cambia antes y la reserva sigue, o se rechaza", async () => {
      for (let i = 0; i < 4; i++) {
        // (a) La reserva va primero: el cambio espera y, al ver la reserva confirmada, se rechaza.
        const a = await armar();
        const reserva = await app(a);
        const cambio = await app(a);
        try {
          expect((await reservar(reserva, a.pv)).ok).toBe(true);
          const pendiente = cambiarNumero(cambio, a.pv, 2);
          expect(await esperarBloqueo(dueno, cambio.pid)).toBe(true);
          expect((await reserva.confirmar()).ok).toBe(true);
          const r = await pendiente;
          expect(!r.ok && r.restriccion).toBe("punto_de_venta_numero_inmutable");
        } finally {
          await reserva.cerrar();
          await cambio.cerrar();
        }
        expect(await consultar("select numero from punto_de_venta where id = $1", [a.pv])).toEqual([
          { numero: 1 },
        ]);

        // (b) El cambio va primero: la reserva espera y sigue después; el número ya cambió.
        const b = await armar();
        const cambio2 = await app(b);
        const reserva2 = await app(b);
        try {
          expect((await cambiarNumero(cambio2, b.pv, 2)).ok).toBe(true);
          const pendiente = reservar(reserva2, b.pv);
          expect(await esperarBloqueo(dueno, reserva2.pid)).toBe(true);
          expect((await cambio2.confirmar()).ok).toBe(true);
          const r = await pendiente;
          expect(r.ok && r.filas).toBe(1);
          expect((await reserva2.confirmar()).ok).toBe(true);
        } finally {
          await cambio2.cerrar();
          await reserva2.cerrar();
        }
        expect(await consultar("select numero from punto_de_venta where id = $1", [b.pv])).toEqual([
          { numero: 2 },
        ]);
        expect(
          await consultar("select estado from serie_comprobante where punto_de_venta_id = $1", [
            b.pv,
          ]),
        ).toEqual([{ estado: "EN_CURSO" }]);
      }
    });

    it.each(["repeatable read", "serializable"] as const)(
      "(%s) si la reserva se confirma entre la lectura del cambio de número y su escritura, el cambio aborta (40001) y no pasa con datos viejos",
      async (aislamiento) => {
        const e = await armar();
        const cambio = await app(e, aislamiento);
        const reserva = await app(e);
        try {
          // El cambio toma su instantánea (primera lectura) antes de que la reserva confirme.
          const antes = await cambio.intentar("select numero from punto_de_venta where id = $1", [
            e.pv,
          ]);
          expect(antes.ok).toBe(true);
          expect((await reservar(reserva, e.pv)).ok).toBe(true);
          expect((await reserva.confirmar()).ok).toBe(true);
          const r = await cambiarNumero(cambio, e.pv, 2);
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.codigo, r.mensaje).toBe("40001");
        } finally {
          await cambio.cerrar();
          await reserva.cerrar();
        }
        expect(await consultar("select numero from punto_de_venta where id = $1", [e.pv])).toEqual([
          { numero: 1 },
        ]);
      },
    );

    it("corregir el CUIT del emisor MIENTRAS se reserva su serie: o cambia antes, o se rechaza", async () => {
      for (let i = 0; i < 4; i++) {
        const nuevoCuit = cuitAlAzar();
        // (a) La reserva va primero: el cambio de CUIT espera el bloqueo del emisor y se rechaza.
        const a = await armar();
        const reserva = await app(a);
        const cambio = await plataforma();
        try {
          expect((await reservar(reserva, a.pvSecundario)).ok).toBe(true);
          const pendiente = cambio.directo("update emisor set cuit = $2 where id = $1", [
            a.secundario,
            nuevoCuit,
          ]);
          expect(await esperarBloqueo(dueno, cambio.pid)).toBe(true);
          expect((await reserva.confirmar()).ok).toBe(true);
          const r = await pendiente;
          expect(!r.ok && r.restriccion).toBe("emisor_cuit_inmutable");
        } finally {
          await reserva.cerrar();
          await cambio.cerrar();
        }
        // (b) El cambio de CUIT va primero: la reserva espera y sigue después.
        const b = await armar();
        const cambio2 = await plataforma();
        const reserva2 = await app(b);
        try {
          expect(
            (
              await cambio2.directo("update emisor set cuit = $2 where id = $1", [
                b.secundario,
                nuevoCuit,
              ])
            ).ok,
          ).toBe(true);
          const pendiente = reservar(reserva2, b.pvSecundario);
          expect(await esperarBloqueo(dueno, reserva2.pid)).toBe(true);
          expect((await cambio2.confirmar()).ok).toBe(true);
          const r = await pendiente;
          expect(r.ok && r.filas).toBe(1);
          expect((await reserva2.confirmar()).ok).toBe(true);
        } finally {
          await cambio2.cerrar();
          await reserva2.cerrar();
        }
        expect(await consultar("select cuit from emisor where id = $1", [b.secundario])).toEqual([
          { cuit: nuevoCuit },
        ]);
      }
    });

    it("lo mismo con el CUIT de la empresa (el del emisor principal)", async () => {
      const nuevoCuit = cuitAlAzar();
      const a = await armar();
      const reserva = await app(a);
      const cambio = await plataforma();
      try {
        expect((await reservar(reserva, a.pv)).ok).toBe(true);
        const pendiente = cambio.directo("update empresa set cuit = $2 where id = $1", [
          a.m.empresa,
          nuevoCuit,
        ]);
        expect(await esperarBloqueo(dueno, cambio.pid)).toBe(true);
        expect((await reserva.confirmar()).ok).toBe(true);
        const r = await pendiente;
        expect(!r.ok && r.restriccion).toBe("empresa_cuit_inmutable");
      } finally {
        await reserva.cerrar();
        await cambio.cerrar();
      }
      const b = await armar();
      const cambio2 = await plataforma();
      const reserva2 = await app(b);
      try {
        expect(
          (
            await cambio2.directo("update empresa set cuit = $2 where id = $1", [
              b.m.empresa,
              nuevoCuit,
            ])
          ).ok,
        ).toBe(true);
        const pendiente = reservar(reserva2, b.pv);
        expect(await esperarBloqueo(dueno, reserva2.pid)).toBe(true);
        expect((await cambio2.confirmar()).ok).toBe(true);
        expect((await pendiente).ok).toBe(true);
        expect((await reserva2.confirmar()).ok).toBe(true);
      } finally {
        await cambio2.cerrar();
        await reserva2.cerrar();
      }
      expect(await consultar("select cuit from empresa where id = $1", [b.m.empresa])).toEqual([
        { cuit: nuevoCuit },
      ]);
    });

    it("dos reservas de series distintas del mismo emisor no se esperan entre sí (el bloqueo del emisor es compartido)", async () => {
      const e = await armar();
      await crearSerie(dueno, e.m.empresa, e.pv, e.m.emisor, "FACTURA_A");
      const s1 = await app(e);
      const s2 = await app(e);
      try {
        expect((await reservar(s1, e.pv)).ok).toBe(true);
        // Otra serie del MISMO emisor: el bloqueo compartido del emisor no la hace esperar.
        const r = await reservar(s2, e.pv, "FACTURA_A");
        expect(r.ok && r.filas).toBe(1);
        expect((await s1.confirmar()).ok).toBe(true);
        expect((await s2.confirmar()).ok).toBe(true);
      } finally {
        await s1.cerrar();
        await s2.cerrar();
      }
    });

    it("activar un punto de venta MIENTRAS se desactiva su emisor: nunca queda un punto de venta activo con el emisor inactivo", async () => {
      const activar = (s: SesionDePrueba, pv: string) =>
        s.directo("update punto_de_venta set estado = 'ACTIVO' where id = $1", [pv]);
      const desactivar = (s: SesionDePrueba, emisor: string) =>
        s.directo("update emisor set activo = false where id = $1", [emisor]);
      for (let i = 0; i < 4; i++) {
        // (a) La desactivación va primero: la activación espera y, al ver el emisor inactivo, se rechaza.
        const a = await armar();
        const baja = await plataforma();
        const alta = await app(a);
        try {
          expect((await desactivar(baja, a.secundario)).ok).toBe(true);
          const pendiente = activar(alta, a.pvSecundario);
          expect(await esperarBloqueo(dueno, alta.pid)).toBe(true);
          expect((await baja.confirmar()).ok).toBe(true);
          const r = await pendiente;
          expect(!r.ok && r.restriccion).toBe("punto_de_venta_emisor_inactivo");
        } finally {
          await baja.cerrar();
          await alta.cerrar();
        }
        // (b) La activación va primero: la desactivación espera y, al ver el punto de venta activo, se rechaza.
        const b = await armar();
        const alta2 = await app(b);
        const baja2 = await plataforma();
        try {
          expect((await activar(alta2, b.pvSecundario)).ok).toBe(true);
          const pendiente = desactivar(baja2, b.secundario);
          expect(await esperarBloqueo(dueno, baja2.pid)).toBe(true);
          expect((await alta2.confirmar()).ok).toBe(true);
          const r = await pendiente;
          expect(!r.ok && r.restriccion).toBe("emisor_con_pv_activos");
        } finally {
          await alta2.cerrar();
          await baja2.cerrar();
        }
      }
      expect(
        await consultar(
          `select 1 from punto_de_venta p join emisor e on e.id = p.emisor_id
            where p.estado = 'ACTIVO' and not e.activo`,
        ),
      ).toEqual([]);
    });

    it("bajo SERIALIZABLE el cruce (leer el otro, escribir lo propio) aborta a uno: nunca quedan los dos cambios", async () => {
      for (let i = 0; i < 4; i++) {
        const e = await armar();
        const baja = await SesionDePrueba.abrir(
          propia.base,
          "zuluhub_plataforma",
          comoPlataforma(),
          "serializable",
        );
        const alta = await app(e, "serializable");
        let confirmadas = 0;
        try {
          expect(
            (await baja.directo("update emisor set activo = false where id = $1", [e.secundario]))
              .ok,
          ).toBe(true);
          const pendiente = alta.directo(
            "update punto_de_venta set estado = 'ACTIVO' where id = $1",
            [e.pvSecundario],
          );
          expect(await esperarBloqueo(dueno, alta.pid)).toBe(true);
          if ((await baja.confirmar()).ok) confirmadas += 1;
          const r = await pendiente;
          if (r.ok) {
            const c = await alta.confirmar();
            if (c.ok) confirmadas += 1;
            else expect(c.codigo).toBe("40001");
          } else {
            expect(["23514", "40001"]).toContain(r.codigo);
          }
        } finally {
          await baja.cerrar();
          await alta.cerrar();
        }
        expect(confirmadas, `ronda ${i}`).toBe(1);
        expect(
          await consultar(
            `select 1 from punto_de_venta p join emisor e on e.id = p.emisor_id
              where p.id = $1 and p.estado = 'ACTIVO' and not e.activo`,
            [e.pvSecundario],
          ),
        ).toEqual([]);
      }
    });
  });
});
