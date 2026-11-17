import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { ok } from "../../src/primitivas/resultado/resultado";
import { crearBarrera, crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import { armarCaja, crearEntornoDeCaja, type TxDeCajaDePrueba } from "./caja-configuracion-apoyo";
import {
  ACCION_DE_VENTA_FALSA,
  cobrarComoVentas,
  crearMundoDeCobro,
  entradaDeCobro,
  importe,
  origenNuevo,
  type MundoDeCobro,
} from "./caja-cobrar-apoyo";
import {
  CERO,
  armarCierreDeJornada,
  claveNueva,
  conAhora,
  instanteLocal,
  cerrarLaJornada,
  fechaLocal,
  pesos,
} from "./caja-operacion-apoyo";

/**
 * Concurrencia e idempotencia del puerto «cobrar» (E3, tramo 6; e3 §5.1 #1, #2 y #3) con una base real, los roles limitados de la aplicación,
 * una «caja falsa de ventas» que arma la transacción del llamador y una barrera: todas las transacciones de la ronda leen la autorización (el
 * guard de `tickets.cobrar`, que hace el llamador) y esperan a que lleguen las demás antes de seguir, así de verdad corren a la vez.
 *  #1 dos cobros a la vez sobre la misma caja: los dos quedan y el total es exacto al centavo;
 *  #2 el doble clic en «Cobrar» es un solo movimiento (secuencial, simultáneo, tras el cierre de la caja y con otro contenido);
 *  #3 cobrar y cerrar a la vez: todo cobro confirmado está en el esperado del arqueo; los rechazados no escriben (también con SQL directo del
 *     rol de la aplicación, sin pasar por el puerto). El cobro en `read committed` no se prueba acá: el puerto se niega a correr en él (ver
 *     `caja-cobrar-casos.test.ts`) porque el cierre serializable no lo vería.
 * El CI corre Postgres 18; las iteraciones se suben con `ITERACIONES_DE_COBRO` (por defecto, las de la especificación).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 900_000 });

const ITERACIONES_DEL_CIERRE = Number(process.env.ITERACIONES_DE_COBRO ?? 500);
const CORRIDAS_CHICAS = Number(process.env.CORRIDAS_CHICAS_DE_COBRO ?? 100);
const RONDAS_DEL_DOBLE_CLIC = 50;
const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

type Fila = Record<string, unknown>;
type Gancho = (tx: TxDeCajaDePrueba, esperar: () => Promise<void>) => TxDeCajaDePrueba;
const CONTEO_EN_CERO = { billetes: [{ denominacion: 1000, cantidad: 1 }], monedas: CERO };
const CODIGOS_DE_RECHAZO = ["CAJA_EN_CIERRE", "SIN_SESION_ABIERTA"];
const codigoDe = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "codigo" in error
    ? String(error.codigo)
    : undefined;

describe.skipIf(base === null)("puerto de cobrar: concurrencia e idempotencia", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let caja: ReturnType<typeof armarCaja>;
  let cierreDelDia: ReturnType<typeof armarCierreDeJornada>;
  let barrera: () => Promise<void> = () => Promise.resolve();
  let gancho: Gancho = (tx) => tx;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 16, (tx) => gancho(tx, () => barrera()));
    caja = armarCaja(entorno);
    cierreDelDia = armarCierreDeJornada(entorno);
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
    gancho = (tx, esperarAlResto) => {
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
              await esperarAlResto();
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
  const aLaVez = async <T>(tareas: readonly (() => Promise<T>)[]): Promise<T[]> => {
    ronda(tareas.length);
    try {
      return await Promise.all(tareas.map((t) => t()));
    } finally {
      sinRonda();
    }
  };

  const casos = () => caja.casos;
  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);
  const mundo = () => crearMundoDeCobro(entornoBase, dueno, caja);
  const en = (dias: number, minutos = 0, hora = "10:00") =>
    new Date(instanteLocal(dias, hora).getTime() + minutos * 60_000);
  const ctxEn = (m: MundoDeCobro, dias = 1, minutos = 0, hora = "10:00") =>
    conAhora(m.ctx(), en(dias, minutos, hora));
  const abrir = async (m: MundoDeCobro, dias = 1, minutos = 0, hora = "10:00") => {
    const r = await casos().abrirSesion(ctxEn(m, dias, minutos, hora), {
      claveDeIdempotencia: claveNueva(),
      sucursalId: m.sucursal,
      cajaId: m.cajaId,
      fondoInicial: pesos("1000.00"),
    });
    if (!r.ok) throw new Error(`no se pudo abrir: ${JSON.stringify(r.error)}`);
    return r.valor.sesionId;
  };
  const cerrar = (m: MundoDeCobro, sesionId: string, minutos = 30) =>
    casos().cerrarSesion(ctxEn(m, 1, minutos), {
      sesionId,
      conteo: CONTEO_EN_CERO,
      otros: [],
      conformeGeneral: true,
      observacion: null,
    });
  const cobrar = (m: MundoDeCobro, cambios: Parameters<typeof entradaDeCobro>[1] = {}) =>
    cobrarComoVentas(entorno, ctxEn(m, 1, 5), entradaDeCobro(m, cambios));
  const resumen = (rs: readonly { ok: boolean; error?: unknown }[]) =>
    rs.map((r) => (r.ok ? "ok" : JSON.stringify(r.error)));
  /** El importe en centavos de un cobro de la ronda: siempre con centavos, distinto de uno a otro. */
  const centavosDe = (k: number) => 37n * BigInt((k % 97) + 1) + BigInt(k % 13);
  const texto = (centavos: bigint) =>
    `${centavos / 100n}.${String(centavos % 100n).padStart(2, "0")}`;
  const sumaDeLaSesion = async (sesionId: string) =>
    (
      await filas<{ s: string }>(
        "select coalesce(sum(importe), 0)::text as s from movimiento_caja where sesion_id = $1",
        [sesionId],
      )
    )[0]?.s;

  // =============================================================================================
  describe("#1 dos cobros a la vez sobre la misma caja", () => {
    it("8 trabajadores × 50 cobros con claves distintas sobre una sesión: exactamente 400 filas, la suma exacta al centavo y ningún error de concurrencia; el arqueo da lo mismo", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const TRABAJADORES = 8;
      const POR_TRABAJADOR = 50;
      const porTrabajador = Array.from({ length: TRABAJADORES }, (_, w) =>
        (async () => {
          const resultados = [];
          for (let i = 0; i < POR_TRABAJADOR; i += 1) {
            const k = w * POR_TRABAJADOR + i;
            // Mitad efectivo, mitad QR sin cuenta: el arqueo tiene dos líneas.
            const medioDePagoId = k % 2 === 0 ? m.medios.EFECTIVO : m.medios.QR;
            resultados.push({
              k,
              medioDePagoId,
              r: await cobrar(m, { medioDePagoId, importe: importe(texto(centavosDe(k))) }),
            });
          }
          return resultados;
        })(),
      );
      const todos = (await Promise.all(porTrabajador)).flat();
      const fallas = todos.filter((t) => !t.r.ok);
      expect(
        fallas.map((t) => JSON.stringify(t.r)),
        "ningún cobro falla (ni ConcurrenciaAgotada)",
      ).toEqual([]);
      expect(todos.filter((t) => t.r.ok && t.r.valor.yaExistia)).toEqual([]);
      expect(new Set(todos.map((t) => (t.r.ok ? t.r.valor.cobroId : ""))).size).toBe(400);

      expect(
        await contar(
          "select count(*) as n from movimiento_caja where sesion_id = $1 and clase = 'COBRO'",
          [sesion],
        ),
      ).toBe(400);
      expect(
        await contar("select count(*) as n from cobro where empresa_id = $1", [m.empresa]),
      ).toBe(400);
      expect(
        await contar(
          "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'COBRO_REGISTRADO'",
          [m.empresa],
        ),
      ).toBe(400);
      // Σ en TS (bigint) = Σ en SQL (numeric), al centavo.
      const efectivo = todos.filter((t) => t.k % 2 === 0).reduce((s, t) => s + centavosDe(t.k), 0n);
      const qr = todos.filter((t) => t.k % 2 === 1).reduce((s, t) => s + centavosDe(t.k), 0n);
      expect(await sumaDeLaSesion(sesion)).toBe(texto(100_000n + efectivo + qr));
      // Y el cierre cuenta lo mismo: el esperado de cada línea es el fondo más lo cobrado.
      expect((await cerrar(m, sesion)).ok).toBe(true);
      const lineas = await filas<{ medio_de_pago_id: string; esperado: string }>(
        "select medio_de_pago_id, esperado::text from arqueo_caja where sesion_id = $1",
        [sesion],
      );
      const esperado = Object.fromEntries(lineas.map((l) => [l.medio_de_pago_id, l.esperado]));
      expect(esperado[m.medios.EFECTIVO]).toBe(texto(100_000n + efectivo));
      expect(esperado[m.medios.QR]).toBe(texto(qr));
    });

    it(`el caso chico: ${CORRIDAS_CHICAS} corridas de 4 cobros simultáneos con barrera, todos quedan y la suma es exacta`, async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      let esperadoTotal = 100_000n;
      for (let corrida = 0; corrida < CORRIDAS_CHICAS; corrida += 1) {
        const importes = [0, 1, 2, 3].map((j) => centavosDe(corrida * 4 + j));
        const rs = await aLaVez(
          importes.map((c) => () => cobrar(m, { importe: importe(texto(c)) })),
        );
        expect(
          rs.every((r) => r.ok && !r.valor.yaExistia),
          `corrida ${corrida}: ${JSON.stringify(resumen(rs))}`,
        ).toBe(true);
        esperadoTotal += importes.reduce((s, c) => s + c, 0n);
        expect(await sumaDeLaSesion(sesion), `corrida ${corrida}`).toBe(texto(esperadoTotal));
      }
      expect(
        await contar(
          "select count(*) as n from movimiento_caja where sesion_id = $1 and clase = 'COBRO'",
          [sesion],
        ),
      ).toBe(CORRIDAS_CHICAS * 4);
      expect(
        await contar("select count(*) as n from cobro where empresa_id = $1", [m.empresa]),
      ).toBe(CORRIDAS_CHICAS * 4);
    });
  });

  // =============================================================================================
  describe("#2 el doble clic en «Cobrar» es un solo movimiento", () => {
    const rastros = async (m: MundoDeCobro) => ({
      movimientos: await contar(
        "select count(*) as n from movimiento_caja where empresa_id = $1 and clase = 'COBRO'",
        [m.empresa],
      ),
      cobros: await contar("select count(*) as n from cobro where empresa_id = $1", [m.empresa]),
      constancias: await contar(
        "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'COBRO_REGISTRADO'",
        [m.empresa],
      ),
    });
    const UNO = { movimientos: 1, cobros: 1, constancias: 1 };

    it("el mismo (origen, orden) dos veces seguidas: una fila de cada cosa, el mismo cobroId y yaExistia en el segundo, sin una segunda auditoría", async () => {
      const m = await mundo();
      await abrir(m);
      const entrada = entradaDeCobro(m, { importe: importe("250.75") });
      const primero = await cobrarComoVentas(entorno, ctxEn(m, 1, 5), entrada);
      const segundo = await cobrarComoVentas(entorno, ctxEn(m, 1, 6), entrada);
      expect(primero).toMatchObject({ ok: true, valor: { yaExistia: false } });
      expect(segundo).toMatchObject({ ok: true, valor: { yaExistia: true } });
      expect(segundo.ok && segundo.valor).toEqual(
        primero.ok && { ...primero.valor, yaExistia: true },
      );
      expect(await rastros(m)).toEqual(UNO);
      // El segundo clic no cambió nada de lo escrito (ni la hora del cobro).
      const [mov] = await filas<{ registrado_en: Date }>(
        "select registrado_en from movimiento_caja where clase = 'COBRO' and empresa_id = $1",
        [m.empresa],
      );
      expect(mov?.registrado_en.toISOString()).toBe(ctxEn(m, 1, 5).ahora.toISOString());
    });

    it(`el mismo (origen, orden) a la vez (2 a 5 pedidos, ${RONDAS_DEL_DOBLE_CLIC} rondas): uno cobra, los demás devuelven lo mismo con yaExistia, y queda una sola fila`, async () => {
      const m = await mundo();
      await abrir(m);
      const modos = new Set<number>();
      for (let ronda = 0; ronda < RONDAS_DEL_DOBLE_CLIC; ronda += 1) {
        const clics = 2 + (ronda % 4);
        const entrada = entradaDeCobro(m, { importe: importe(texto(centavosDe(ronda))) });
        const rs = await aLaVez(
          Array.from(
            { length: clics },
            () => () => cobrarComoVentas(entorno, ctxEn(m, 1, 5), entrada),
          ),
        );
        expect(
          rs.every((r) => r.ok),
          `ronda ${ronda}: ${JSON.stringify(resumen(rs))}`,
        ).toBe(true);
        expect(
          rs.filter((r) => r.ok && !r.valor.yaExistia),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        expect(new Set(rs.map((r) => (r.ok ? r.valor.cobroId : ""))).size).toBe(1);
        expect(
          await contar("select count(*) as n from cobro where origen_id = $1", [entrada.origen.id]),
        ).toBe(1);
        modos.add(clics);
      }
      expect((await rastros(m)).movimientos).toBe(RONDAS_DEL_DOBLE_CLIC);
      expect(await rastros(m)).toEqual({
        movimientos: RONDAS_DEL_DOBLE_CLIC,
        cobros: RONDAS_DEL_DOBLE_CLIC,
        constancias: RONDAS_DEL_DOBLE_CLIC,
      });
      expect(modos.size).toBe(4);
    });

    it("corte de red: el cobro confirmó, la caja se cierra, el cliente reintenta y recibe lo mismo (no SIN_SESION_ABIERTA); también con la jornada ya cerrada", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const entrada = entradaDeCobro(m);
      const primero = await cobrarComoVentas(entorno, ctxEn(m, 1, 5), entrada);
      expect(primero.ok).toBe(true);
      expect((await cerrar(m, sesion)).ok).toBe(true);
      const tras = await cobrarComoVentas(entorno, ctxEn(m, 1, 31), entrada);
      expect(tras).toMatchObject({
        ok: true,
        valor: {
          yaExistia: true,
          sesionId: sesion,
          fechaDeNegocio: fechaLocal(en(1)),
          jornadaVencida: false,
        },
      });
      expect(tras.ok && primero.ok && tras.valor.cobroId).toBe(primero.ok && primero.valor.cobroId);
      // Con la jornada cerrada.
      await cerrarLaJornada(cierreDelDia, ctxEn(m, 1, 40), {
        sucursalId: m.sucursal,
        fechaDeNegocio: fechaLocal(en(1)),
      });
      expect(await cobrarComoVentas(entorno, ctxEn(m, 1, 50), entrada)).toMatchObject({
        ok: true,
        valor: { yaExistia: true },
      });
      // Y al día siguiente, con la sesión cerrada, también (la jornada vencida se recalcula, no se guardó).
      expect(await cobrarComoVentas(entorno, ctxEn(m, 3, 0), entrada)).toMatchObject({
        ok: true,
        valor: { yaExistia: true, sesionId: sesion },
      });
      expect(await rastros(m)).toEqual(UNO);
      // Pero un cobro NUEVO en esa caja sigue rechazado.
      expect(await cobrar(m)).toEqual({
        ok: false,
        error: { codigo: "SIN_SESION_ABIERTA", cajaId: m.cajaId },
      });
    });

    it("un reintento ve lo hecho aunque el medio o la cuenta se hayan desactivado después", async () => {
      const m = await mundo();
      await abrir(m);
      const entrada = entradaDeCobro(m, {
        medioDePagoId: m.medios.QR,
        cuentaDeCobroId: m.cuentas.qr,
      });
      expect((await cobrarComoVentas(entorno, ctxEn(m, 1, 5), entrada)).ok).toBe(true);
      await dueno.query("update medio_de_pago set activo = false where id = $1", [m.medios.QR]);
      await dueno.query("update cuenta_de_cobro set activa = false where id = $1", [m.cuentas.qr]);
      expect(await cobrarComoVentas(entorno, ctxEn(m, 1, 6), entrada)).toMatchObject({
        ok: true,
        valor: { yaExistia: true },
      });
      expect(await rastros(m)).toEqual(UNO);
    });

    it("el mismo origen con otro contenido es CLAVE_REUTILIZADA y no escribe: otro importe, otro medio, otra cuenta, otros datos, otro tipo de origen", async () => {
      const m = await mundo();
      await abrir(m);
      const entrada = entradaDeCobro(m, {
        medioDePagoId: m.medios.TARJETA_DEBITO,
        importe: importe("100.00"),
      });
      expect((await cobrarComoVentas(entorno, ctxEn(m, 1, 5), entrada)).ok).toBe(true);
      const otrosContenidos = [
        { importe: importe("100.01") },
        { medioDePagoId: m.medios.QR },
        { cuentaDeCobroId: m.cuentas.terminal },
        { origen: { tipo: "ventas.otra_cosa", id: entrada.origen.id } },
        { sucursalId: "00000000-0000-4000-8000-000000000000" },
      ];
      for (const [indice, cambios] of otrosContenidos.entries()) {
        const r = await cobrarComoVentas(entorno, ctxEn(m, 1, 6), { ...entrada, ...cambios });
        expect(r, `caso ${indice}`).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
      }
      expect(await rastros(m)).toEqual(UNO);
      // Con otro orden es OTRO cobro del mismo origen.
      expect(
        (await cobrarComoVentas(entorno, ctxEn(m, 1, 7), { ...entrada, origenOrden: 2 })).ok,
      ).toBe(true);
      expect((await rastros(m)).movimientos).toBe(2);
      // La constancia de la venta falsa quedó una por pedido aceptado y ninguna por los rechazados.
      expect(
        await contar(
          "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2",
          [m.empresa, ACCION_DE_VENTA_FALSA],
        ),
      ).toBe(2);
    });
  });

  // =============================================================================================
  describe("#3 cobrar y cerrar caja a la vez", () => {
    it(`${ITERACIONES_DEL_CIERRE} iteraciones con cobros en vuelo contra el cierre: cada cobro confirmado está en el esperado del arqueo, dentro de la sesión; los rechazados no escriben`, async () => {
      const m = await mundo();
      let confirmados = 0;
      let rechazados = 0;
      let cobrosEnVuelo = 0;
      for (let iteracion = 0; iteracion < ITERACIONES_DEL_CIERRE; iteracion += 1) {
        const sesion = await abrir(m);
        const enCierre = iteracion % 3 === 1;
        const clics = 3 + (iteracion % 3);
        const entradas = Array.from({ length: clics }, (_, j) =>
          entradaDeCobro(m, { importe: importe(texto(centavosDe(iteracion * 7 + j))) }),
        );
        const cobros = entradas.map(
          (entrada, j) => () =>
            cobrarComoVentas(entorno, ctxEn(m, 1, 5), entrada, {
              // Los cobros llegan a la base en momentos distintos respecto del cierre.
              entreLaLecturaYElCobro: () => esperar((iteracion + j * 3) % 12),
            }),
        );
        const cierre = enCierre
          ? () => casos().iniciarCierre(ctxEn(m, 1, 20), { sesionId: sesion })
          : () => cerrar(m, sesion);
        const rs = await aLaVez([cierre, ...cobros] as readonly (() => Promise<{
          ok: boolean;
          error?: unknown;
        }>)[]);
        const [resultadoDelCierre, ...resultados] = rs;
        expect(
          resultadoDelCierre?.ok,
          `iteración ${iteracion}: ${JSON.stringify(resumen(rs))}`,
        ).toBe(true);
        const buenos: bigint[] = [];
        resultados.forEach((r, j) => {
          const entrada = entradas[j];
          if (entrada === undefined) return;
          if (r.ok) {
            buenos.push(entrada.importe.unidades);
          } else {
            // Rechazado: solo por la caja que se cierra, y sin escribir nada.
            expect(
              CODIGOS_DE_RECHAZO,
              `iteración ${iteracion}: ${JSON.stringify(resumen(rs))}`,
            ).toContain(codigoDe(r.error));
          }
        });
        const noEscribio = await contar(
          "select count(*) as n from cobro where origen_id = any($1::uuid[])",
          [entradas.map((e) => e.origen.id)],
        );
        expect(noEscribio, `iteración ${iteracion}`).toBe(buenos.length);
        confirmados += buenos.length;
        rechazados += clics - buenos.length;
        cobrosEnVuelo += clics;

        if (enCierre) {
          // Tras iniciar el cierre, lo que entró ya está y lo que llegue después se rechaza; el cierre cuenta todo.
          expect(await cobrar(m, { importe: importe("1.00") }), `iteración ${iteracion}`).toEqual({
            ok: false,
            error: { codigo: "CAJA_EN_CIERRE", cajaId: m.cajaId, sesionId: sesion },
          });
          expect((await cerrar(m, sesion)).ok, `iteración ${iteracion}`).toBe(true);
        }
        // Cada cobro confirmado está en el esperado del arqueo, al centavo; ninguno quedó fuera de la cuenta.
        const [linea] = await filas<{ esperado: string }>(
          "select esperado::text from arqueo_caja where sesion_id = $1 and medio_de_pago_id = $2",
          [sesion, m.medios.EFECTIVO],
        );
        expect(linea?.esperado, `iteración ${iteracion}`).toBe(
          texto(100_000n + buenos.reduce((s, c) => s + c, 0n)),
        );
        expect(await sumaDeLaSesion(sesion), `iteración ${iteracion}`).toBe(linea?.esperado);
        // Todo movimiento de la sesión se registró dentro de ella: desde que se abrió hasta que se cerró.
        expect(
          await contar(
            `select count(*) as n from movimiento_caja mo join sesion_caja s on s.id = mo.sesion_id
              where s.id = $1 and (mo.registrado_en < s.abierta_en or mo.registrado_en > s.cerrada_en)`,
            [sesion],
          ),
          `iteración ${iteracion}`,
        ).toBe(0);
        expect(
          await contar(
            "select count(*) as n from sesion_caja where id = $1 and estado = 'CERRADA'",
            [sesion],
          ),
        ).toBe(1);
      }
      expect(confirmados + rechazados).toBe(cobrosEnVuelo);
      expect(confirmados).toBeGreaterThan(0);
      // Que haya habido rechazos depende de quién llega primero; con las esperas escalonadas, en la práctica los hay (se informa).
      console.info(
        `cobrar y cerrar a la vez: ${confirmados} confirmados, ${rechazados} rechazados`,
      );
    });

    it("también con SQL directo y el rol de la aplicación (sin pasar por el puerto): lo que confirma un cobro queda contado en el cierre, o el cobro se rechaza", async () => {
      const m = await mundo();
      let cierres = 0;
      let cierresAbortados = 0;
      let rechazos = 0;
      let confirmados = 0;
      const iteraciones = Math.max(50, Math.floor(ITERACIONES_DEL_CIERRE / 2));
      for (let iteracion = 0; iteracion < iteraciones; iteracion += 1) {
        const sesion = await abrir(m);
        const ctx = ctxEn(m, 1, 5);
        const directos = Array.from({ length: 4 }, (_, j) => ({
          origen: origenNuevo(),
          centavos: centavosDe(iteracion * 5 + j),
          espera: (iteracion + j * 4) % 14,
        }));
        const cobroDirecto = (d: (typeof directos)[number]) => async () =>
          entorno.ejecutar({ contexto: ctx, reintentos: 40 }, async (tx) => {
            await tx.autorizacion.delActor(ctx);
            await esperar(d.espera);
            const [fila] = (
              await sql<{ id: string }>`insert into movimiento_caja
                (empresa_id, sesion_id, clase, medio_de_pago_id, importe, registrado_en, registrado_por, clave_idempotencia, huella)
                values (${m.empresa}::uuid, ${sesion}::uuid, 'COBRO', ${m.medios.EFECTIVO}::uuid, ${texto(d.centavos)}::numeric,
                        ${ctx.ahora}::timestamptz, ${m.persona}::uuid, ${`cobro_${d.origen.id}_1`}, ${"d".repeat(64)})
                returning id`.execute(tx.db)
            ).rows;
            await sql`insert into cobro (movimiento_id, empresa_id, origen_tipo, origen_id, origen_orden)
                      values (${fila?.id}::uuid, ${m.empresa}::uuid, ${d.origen.tipo}, ${d.origen.id}::uuid, 1)`.execute(
              tx.db,
            );
            return ok(null);
          });
        const rs = await aLaVez([
          () => cerrar(m, sesion),
          ...directos.map(cobroDirecto),
        ] as readonly (() => Promise<{
          ok: boolean;
          error?: unknown;
        }>)[]);
        const [cierre, ...resultados] = rs;
        const buenos = directos.filter((_, j) => resultados[j]?.ok);
        confirmados += buenos.length;
        rechazos += resultados.length - buenos.length;
        // Lo rechazado, lo rechazó el disparador de la base porque la sesión ya no estaba abierta: nunca otra cosa.
        for (const r of resultados) {
          if (!r.ok) {
            expect(
              JSON.stringify(r.error),
              `iteración ${iteracion}: ${JSON.stringify(resumen(rs))}`,
            ).toMatch(/movimiento_caja_sesion_no_abierta/);
          }
        }
        const [estado] = await filas<{ estado: string }>(
          "select estado from sesion_caja where id = $1",
          [sesion],
        );
        const [suma] = await filas<{ s: string }>(
          "select coalesce(sum(importe), 0)::text as s from movimiento_caja where sesion_id = $1",
          [sesion],
        );
        const esperado = texto(100_000n + buenos.reduce((s, d) => s + d.centavos, 0n));
        expect(suma?.s, `iteración ${iteracion}`).toBe(esperado);
        if (cierre?.ok) {
          cierres += 1;
          // Si el cierre confirmó, todo lo confirmado está contado en su arqueo.
          expect(estado?.estado).toBe("CERRADA");
          const [linea] = await filas<{ esperado: string }>(
            "select esperado::text from arqueo_caja where sesion_id = $1 and medio_de_pago_id = $2",
            [sesion, m.medios.EFECTIVO],
          );
          expect(linea?.esperado, `iteración ${iteracion}`).toBe(esperado);
        } else {
          // Si el diferido frenó el cierre, la sesión sigue abierta y sin arqueo: nunca queda plata fuera de un cierre confirmado.
          cierresAbortados += 1;
          expect(estado?.estado, `iteración ${iteracion}: ${JSON.stringify(cierre)}`).toBe(
            "ABIERTA",
          );
          expect(
            await contar("select count(*) as n from arqueo_caja where sesion_id = $1", [sesion]),
          ).toBe(0);
          // Se cierra después, ya sin carreras, y cuenta todo.
          expect((await cerrar(m, sesion, 40)).ok).toBe(true);
          const [linea] = await filas<{ esperado: string }>(
            "select esperado::text from arqueo_caja where sesion_id = $1 and medio_de_pago_id = $2",
            [sesion, m.medios.EFECTIVO],
          );
          expect(linea?.esperado, `iteración ${iteracion}`).toBe(esperado);
        }
      }
      console.info(
        `SQL directo: ${confirmados} cobros confirmados, ${rechazos} rechazados, ${cierres} cierres confirmados, ${cierresAbortados} frenados por el diferido`,
      );
      expect(cierres + cierresAbortados).toBe(iteraciones);
    });
  });
});
