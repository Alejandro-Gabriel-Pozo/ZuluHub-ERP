import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import {
  clavesDeLaValidacionInicial,
  emitirFactura,
  emitirNotaDeCredito,
  emitirNotaDeDebito,
  listarComprobantes,
  listarPuntosDeVentaDeLaSucursal,
  verComprobante,
  type DependenciasDeFacturacionWeb,
} from "../../src/composicion/facturacion-web";
import { armarTrabajos } from "../../src/composicion/trabajos";
import { armarWeb } from "../../src/composicion/web";
import { empresaId, personaId, sucursalId } from "../../src/primitivas/identificadores/marca";
import type { ProveedorDeEmision } from "../../src/modulos/fiscal/publico";
import { EmisionFalsa } from "../utilidades/emision-falsa";
import { comoEmpresa, crearBaseAparte } from "./entorno";
import { crearEscenarioDeCasos, type EscenarioDeCasos } from "./facturacion-casos-apoyo";
import { datosDeComprobante, insertarComprobante, viaDuenoDirecto } from "./facturacion-apoyo";
import { crearPuntoDeVenta } from "./fiscal-apoyo";
import { REGLAS_CON_FACTURACION } from "./fiscal-numeracion-apoyo";
import {
  crearAsignacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  type RolDePrueba,
} from "./fixtures-identidad";
import { asignarPlan, crearPlanPublicado } from "./marcas-apoyo";

/**
 * La sucursal de los comprobantes y de lo que se ve de ellos, con la composición REAL (conexiones, web y trabajos, base de verdad,
 * roles limitados) y ARCA falso. Decisiones del dueño del 2026-10-28 (`facturador-contratos-de-pantalla.md`):
 *  - D-34/D-36/D-37: la persona elige una sucursal (abierta o CERRADA, para ver su historial) y el servidor la valida cada vez; sin
 *    elegir, con exactamente UNA ABIERTA se toma sola y con otra cantidad se pide elegir; nunca se listan todas.
 *  - D-35: la factura guarda la sucursal de su punto de venta al emitirse y no cambia nunca.
 *  - D-38: una nota de crédito lleva la sucursal de la factura que corrige; una de débito (decisión pendiente), la de su punto de venta.
 *  - D-39: el detalle respeta las sucursales de la persona; si no corresponde, es «no encontrado».
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const renglonCrudo = (cambios: Record<string, unknown> = {}) => ({
  descripcion: "Medialunas",
  cantidad: "1",
  precioUnitario: "121",
  descuento: null,
  alicuota: "21",
  ...cambios,
});
const facturaCruda = (e: Pick<EscenarioDeCasos, "pv">, cambios: Record<string, unknown> = {}) => ({
  clave: randomUUID(),
  puntoDeVentaId: e.pv,
  concepto: "PRODUCTOS",
  servicio: null,
  modoDePrecio: "IVA_INCLUIDO",
  receptor: {
    nombre: null,
    documento: { tipo: "SIN_IDENTIFICAR" },
    condicionIva: "CONSUMIDOR_FINAL",
    domicilio: null,
  },
  renglones: [renglonCrudo()],
  ...cambios,
});

const FUERA = { ok: false, error: { codigo: "FISCAL_SUCURSAL_FUERA_DE_ALCANCE" } };
const NO_ELEGIDA = { ok: false, error: { codigo: "FISCAL_SUCURSAL_NO_ELEGIDA" } };

describe.skipIf(base === null)("la sucursal de los comprobantes y del listado y el detalle", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let conexiones: Conexiones;
  const registrados: string[] = [];
  const arca = { HOMOLOGACION: new EmisionFalsa(), PRODUCCION: new EmisionFalsa() };
  const emision: ProveedorDeEmision = { para: (_empresa, _emisor, ambiente) => arca[ambiente] };
  let d: DependenciasDeFacturacionWeb;
  let trabajos: ReturnType<typeof armarTrabajos>;
  let web: ReturnType<typeof armarWeb>;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    const fuente = {
      PEDERNAL_CLAVE_CONTEXTO: `${propia.base.clave.kid}:${propia.base.clave.secreto.toString("hex")}`,
      PEDERNAL_DB_APP: propia.base.app,
      PEDERNAL_DB_TRABAJOS: propia.base.trabajos,
    };
    conexiones = armarConexiones({ fuente: () => fuente, registrar: (x) => registrados.push(x) });
    web = armarWeb(conexiones, { reglas: REGLAS_CON_FACTURACION, emision });
    trabajos = armarTrabajos(conexiones, {
      emision,
      alRegistrarProblema: (p) => registrados.push(`${p.fase}: ${p.mensaje}`),
    });
    d = {
      casosDeUso: web.casosDeUsoDeFacturacion,
      consultas: web.consultasDeFacturacion,
      respuesta: { registrar: (x) => registrados.push(x) },
    };
  }, 120_000);
  afterAll(async () => {
    await conexiones.transaccionesDeApp().cerrar();
    await conexiones.transaccionesDeTrabajos().cerrar();
    await dueno.end();
    await propia.destruir();
  });

  const filas = async <T extends Record<string, unknown>>(texto: string, p: unknown[] = []) =>
    (await dueno.query<T>(texto, p)).rows;
  const ahora = (): Date => new Date();
  const comoGerente = (e: EscenarioDeCasos) => e.como(ahora());

  /** Una empresa con facturación activada de verdad y un miembro con ese rol (el de `e.como`). */
  async function empresaConFacturacion(rol: RolDePrueba = "GERENTE"): Promise<EscenarioDeCasos> {
    const e = await crearEscenarioDeCasos(dueno, propia.base, { rol });
    const { version } = await crearPlanPublicado(dueno, { modulos: ["facturacion"] });
    await asignarPlan(dueno, e.tenant, version);
    await dueno.query(
      "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'facturacion')",
      [e.empresa],
    );
    return e;
  }

  /** Otra persona de esa empresa con ese rol y esas sucursales asignadas (el operador las necesita; las otras no). */
  async function persona(
    e: EscenarioDeCasos,
    rol: RolDePrueba,
    asignadas: readonly string[] = [],
  ): Promise<ContextoOperativo> {
    const p = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, e.empresa, p.id, rol);
    for (const s of asignadas) await crearAsignacionDeBase(dueno, e.empresa, p.id, s);
    return { ...comoEmpresa(empresaId(e.empresa), personaId(p.id)), ahora: new Date() };
  }

  async function sucursalNueva(
    e: EscenarioDeCasos,
    nombre = `Sucursal ${randomUUID().slice(0, 6)}`,
    abierta = true,
  ) {
    const r = await dueno.query<{ id: string }>(
      "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
      [e.empresa, nombre],
    );
    const id = r.rows[0]?.id as string;
    if (!abierta) await cerrar(id);
    return id;
  }
  const cerrar = (sucursal: string) =>
    dueno.query("update sucursal set activa = false where id = $1", [sucursal]);
  const puntoDeVentaEn = (e: EscenarioDeCasos, sucursal: string, numero: number) =>
    crearPuntoDeVenta(dueno, e, { numero, sucursal, activo: true });
  const sucursalDelComprobante = async (id: string) =>
    (
      await filas<{ sucursal_id: string | null }>(
        "select sucursal_id from comprobante where id = $1",
        [id],
      )
    )[0]?.sucursal_id;
  const puntoDeVentaIdDe = async (e: EscenarioDeCasos, numero: number) =>
    (
      await filas<{ id: string }>(
        "select id from punto_de_venta where empresa_id = $1 and numero = $2",
        [e.empresa, numero],
      )
    )[0]?.id as string;
  const mudar = (pv: string, sucursal: string) =>
    dueno.query("update punto_de_venta set sucursal_id = $2 where id = $1", [pv, sucursal]);

  async function emitirYValidar(
    e: EscenarioDeCasos,
    entrada: ReturnType<typeof facturaCruda> = facturaCruda(e),
  ) {
    const emitido = await emitirFactura(d, comoGerente(e), entrada);
    if (!emitido.ok) throw new Error(`no se pudo emitir: ${JSON.stringify(emitido.error)}`);
    await trabajos
      .procesador()
      .despacharPorClaves(
        empresaId(e.empresa),
        clavesDeLaValidacionInicial(emitido.dato.comprobanteId),
        ahora(),
      );
    return emitido.dato;
  }

  /** El listado como lo ve quien pide `elegida` (o ninguna). */
  const listaDe = (e: EscenarioDeCasos, elegida: string | null, ctx = comoGerente(e)) =>
    listarComprobantes(d, ctx, elegida === null ? null : sucursalId(elegida), undefined);
  const idsDeLaLista = async (
    e: EscenarioDeCasos,
    elegida: string | null,
    ctx = comoGerente(e),
  ) => {
    const lista = await listaDe(e, elegida, ctx);
    if (!lista.ok) throw new Error(`no listó: ${JSON.stringify(lista.error)}`);
    return lista.dato.items.map((i) => i.id).sort();
  };
  const detalleDe = (ctx: ContextoOperativo, id: string) =>
    verComprobante(d, ctx, { comprobanteId: id as never });

  // ===============================================================================================
  // Lo que se guarda al emitir
  // ===============================================================================================
  describe("al emitir (D-35 y D-38)", () => {
    it("el comprobante guarda la sucursal de su punto de venta; con la misma clave es el mismo comprobante y la misma sucursal aunque el punto de venta se mude entre medio", async () => {
      const e = await empresaConFacturacion();
      const norte = await sucursalNueva(e);
      const pedido = facturaCruda(e);
      const primera = await emitirFactura(d, comoGerente(e), pedido);
      expect(primera).toMatchObject({ ok: true, dato: { yaExistia: false } });
      if (!primera.ok) return;
      const id = primera.dato.comprobanteId;
      expect(await sucursalDelComprobante(id)).toBe(e.sucursal);

      await mudar(e.pv, norte);
      const repetida = await emitirFactura(d, comoGerente(e), pedido);
      expect(repetida).toMatchObject({ ok: true, dato: { comprobanteId: id, yaExistia: true } });
      expect(
        await filas("select 1 from comprobante where empresa_id = $1 and origen_id = $2", [
          e.empresa,
          pedido.clave,
        ]),
      ).toHaveLength(1);
      expect(await sucursalDelComprobante(id)).toBe(e.sucursal);
      // Lo nuevo nace en la sucursal nueva del punto de venta.
      const nueva = await emitirFactura(d, comoGerente(e), facturaCruda(e));
      if (!nueva.ok) throw new Error("no emitió");
      expect(await sucursalDelComprobante(nueva.dato.comprobanteId)).toBe(norte);
    });

    it("D-38 y D-40: una nota (de crédito o de débito) lleva la sucursal de la FACTURA, salga por el punto de venta que salga", async () => {
      const e = await empresaConFacturacion();
      const norte = await sucursalNueva(e);
      const pvNorte = await puntoDeVentaEn(e, norte, 7);
      const factura = await emitirYValidar(e);
      expect(await sucursalDelComprobante(factura.comprobanteId)).toBe(e.sucursal);
      const pedidoDeNota = (puntoDeVentaId: string | null) => ({
        clave: randomUUID(),
        comprobanteAsociadoId: factura.comprobanteId,
        puntoDeVentaId,
        concepto: "PRODUCTOS",
        servicio: null,
        modoDePrecio: "IVA_INCLUIDO",
        renglones: [renglonCrudo({ precioUnitario: "10" })],
        motivo: "Devolución",
      });
      const ok = <T extends { ok: boolean }>(r: T) => {
        if (!r.ok) throw new Error(`no emitió: ${JSON.stringify(r)}`);
        return r as T & { dato: { comprobanteId: string } };
      };

      // Por el punto de venta de «Norte»: las dos se quedan en la sucursal de la factura.
      const creditoPorNorte = ok(
        await emitirNotaDeCredito(d, comoGerente(e), pedidoDeNota(pvNorte)),
      );
      const debitoPorNorte = ok(await emitirNotaDeDebito(d, comoGerente(e), pedidoDeNota(pvNorte)));
      expect(await sucursalDelComprobante(creditoPorNorte.dato.comprobanteId)).toBe(e.sucursal);
      expect(await sucursalDelComprobante(debitoPorNorte.dato.comprobanteId)).toBe(e.sucursal);
      // Por el de la factura: las dos en su sucursal.
      const creditoPropio = ok(await emitirNotaDeCredito(d, comoGerente(e), pedidoDeNota(null)));
      const debitoPropio = ok(await emitirNotaDeDebito(d, comoGerente(e), pedidoDeNota(null)));
      expect(await sucursalDelComprobante(creditoPropio.dato.comprobanteId)).toBe(e.sucursal);
      expect(await sucursalDelComprobante(debitoPropio.dato.comprobanteId)).toBe(e.sucursal);

      // El punto de venta de la factura se muda a «Norte»: las notas nuevas siguen a la FACTURA, no al punto de venta.
      await mudar(e.pv, norte);
      const creditoDespues = ok(await emitirNotaDeCredito(d, comoGerente(e), pedidoDeNota(null)));
      const debitoDespues = ok(await emitirNotaDeDebito(d, comoGerente(e), pedidoDeNota(null)));
      expect(await sucursalDelComprobante(creditoDespues.dato.comprobanteId)).toBe(e.sucursal);
      expect(await sucursalDelComprobante(debitoDespues.dato.comprobanteId)).toBe(e.sucursal);
      expect(await sucursalDelComprobante(debitoPropio.dato.comprobanteId)).toBe(e.sucursal);

      // Y en el listado, las notas aparecen donde la factura, y en el de «Norte» no aparece ninguna.
      const notas = [
        creditoPorNorte,
        debitoPorNorte,
        creditoPropio,
        debitoPropio,
        creditoDespues,
        debitoDespues,
      ].map((n) => n.dato.comprobanteId);
      const enCentro = await idsDeLaLista(e, e.sucursal);
      expect(enCentro).toEqual([factura.comprobanteId, ...notas].sort());
      expect(await idsDeLaLista(e, norte)).toEqual([]);
      // Y el Detalle de la factura lista sus notas de débito sin sacarlas de su sucursal.
      const detalle = await verComprobante(d, comoGerente(e), {
        comprobanteId: factura.comprobanteId,
      });
      expect(detalle.ok && detalle.dato.notasQueLoCitan.map((n) => n.id).sort()).toEqual(
        [...notas].sort(),
      );
    });
  });

  // ===============================================================================================
  // Emitir mientras otra transacción mueve el punto de venta
  // ===============================================================================================
  describe("emitir mientras otra transacción mueve el punto de venta", () => {
    /** Espera (sondeando, sin dormir a ciegas) a que se cumpla algo de la base. */
    async function esperar(condicion: () => Promise<boolean>, que: string, ms = 15_000) {
      const hasta = Date.now() + ms;
      while (Date.now() < hasta) {
        if (await condicion()) return;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw new Error(`no pasó a tiempo: ${que}`);
    }
    /** ¿Hay una sentencia esperando un bloqueo cuyo texto coincide? (lo dice la propia base, no un reloj). */
    const esperandoBloqueo = async (patron: string) =>
      Number(
        (
          await filas<{ n: string }>(
            `select count(*) as n from pg_stat_activity
              where datname = current_database() and wait_event_type = 'Lock' and query ~* $1`,
            [patron],
          )
        )[0]?.n,
      ) > 0;
    const unaConexion = async () => {
      const c = new pg.Client({ connectionString: propia.base.dueno });
      await c.connect();
      return c;
    };
    const terminado = (promesa: Promise<unknown>) => {
      const estado = { listo: false };
      void promesa.then(
        () => (estado.listo = true),
        () => (estado.listo = true),
      );
      return estado;
    };

    it("SQL directo, la emisión primero: el movimiento ESPERA (lo confirma pg_stat_activity), y el comprobante conserva la sucursal de antes", async () => {
      const e = await empresaConFacturacion();
      const norte = await sucursalNueva(e);
      const emisor = await unaConexion();
      const mover = await unaConexion();
      try {
        await emisor.query("begin");
        const datos = datosDeComprobante(e);
        expect((await insertarComprobante(viaDuenoDirecto(emisor), datos)).ok).toBe(true);
        await mover.query("begin");
        const mudando = mover.query("update punto_de_venta set sucursal_id = $2 where id = $1", [
          e.pv,
          norte,
        ]);
        const estado = terminado(mudando);
        await esperar(() => esperandoBloqueo("update punto_de_venta"), "el movimiento espera");
        expect(estado.listo).toBe(false);
        await emisor.query("commit");
        await mudando;
        await mover.query("commit");
        expect(await sucursalDelComprobante(datos["id"] as string)).toBe(e.sucursal);
        const pv = await filas<{ sucursal_id: string }>(
          "select sucursal_id from punto_de_venta where id = $1",
          [e.pv],
        );
        expect(pv[0]?.sucursal_id).toBe(norte);
      } finally {
        await emisor.query("rollback").catch(() => undefined);
        await mover.query("rollback").catch(() => undefined);
        await emisor.end();
        await mover.end();
      }
    });

    it("por la web, el movimiento primero: la emisión queda BLOQUEADA (lo confirma pg_stat_activity) y al soltarse sale con la sucursal NUEVA, nunca vacía", async () => {
      const e = await empresaConFacturacion();
      const norte = await sucursalNueva(e);
      const mover = await unaConexion();
      try {
        await mover.query("begin");
        await mover.query("update punto_de_venta set sucursal_id = $2 where id = $1", [
          e.pv,
          norte,
        ]);
        const emitiendo = emitirFactura(d, comoGerente(e), facturaCruda(e));
        const estado = terminado(emitiendo);
        await esperar(
          () => esperandoBloqueo('insert into "comprobante" '),
          "la emisión espera al punto de venta",
        );
        expect(estado.listo).toBe(false);
        await mover.query("commit");
        const r = await emitiendo;
        if (!r.ok) throw new Error(`no emitió: ${JSON.stringify(r.error)}`);
        expect(await sucursalDelComprobante(r.dato.comprobanteId)).toBe(norte);
      } finally {
        await mover.query("rollback").catch(() => undefined);
        await mover.end();
      }
    });

    it("por la web, la emisión primero: el movimiento ESPERA (lo confirma pg_stat_activity) y el comprobante conserva la sucursal de antes", async () => {
      const e = await empresaConFacturacion();
      const norte = await sucursalNueva(e);
      const retiene = await unaConexion();
      const mover = await unaConexion();
      try {
        // Se retiene la cola: la emisión crea el comprobante (y toma su bloqueo sobre el punto de venta) y queda esperando para
        // encolar su validación, DENTRO de su transacción. Que el movimiento espere, más abajo, prueba que ya lo tiene.
        await retiene.query("begin");
        await retiene.query("lock table trabajo in access exclusive mode");
        const emitiendo = emitirFactura(d, comoGerente(e), facturaCruda(e));
        const emision = terminado(emitiendo);
        await esperar(
          () => esperandoBloqueo('from "trabajo"'),
          "la emisión espera a la cola con el punto de venta ya tomado",
        );
        // Con la emisión a medias, el movimiento llega y también espera.
        await mover.query("begin");
        const mudando = mover.query("update punto_de_venta set sucursal_id = $2 where id = $1", [
          e.pv,
          norte,
        ]);
        const movimiento = terminado(mudando);
        await esperar(() => esperandoBloqueo("update punto_de_venta"), "el movimiento espera");
        expect(emision.listo).toBe(false);
        expect(movimiento.listo).toBe(false);
        // Se suelta la cola: la emisión confirma, y recién entonces el movimiento corre.
        await retiene.query("commit");
        const r = await emitiendo;
        if (!r.ok) throw new Error(`no emitió: ${JSON.stringify(r.error)}`);
        await mudando;
        await mover.query("commit");
        expect(await sucursalDelComprobante(r.dato.comprobanteId)).toBe(e.sucursal);
        const pv = await filas<{ sucursal_id: string }>(
          "select sucursal_id from punto_de_venta where id = $1",
          [e.pv],
        );
        expect(pv[0]?.sucursal_id).toBe(norte);
      } finally {
        await retiene.query("rollback").catch(() => undefined);
        await mover.query("rollback").catch(() => undefined);
        await retiene.end();
        await mover.end();
      }
    });
  });

  // ===============================================================================================
  // El listado: qué sucursal se usa (D-34, D-36, D-37)
  // ===============================================================================================
  describe("el listado de una sucursal", () => {
    it("trae SOLO los comprobantes de la sucursal pedida, y lo emitido en una no pasa a otra si su punto de venta se muda", async () => {
      const e = await empresaConFacturacion();
      const norte = await sucursalNueva(e);
      const pvNorte = await puntoDeVentaEn(e, norte, 9);
      const enCentro = [await emitirYValidar(e), await emitirYValidar(e)].map(
        (x) => x.comprobanteId,
      );
      const enNorte = (await emitirYValidar(e, facturaCruda(e, { puntoDeVentaId: pvNorte })))
        .comprobanteId;
      expect(await idsDeLaLista(e, e.sucursal)).toEqual([...enCentro].sort());
      expect(await idsDeLaLista(e, norte)).toEqual([enNorte]);
      await mudar(e.pv, norte);
      expect(await idsDeLaLista(e, e.sucursal)).toEqual([...enCentro].sort());
      expect(await idsDeLaLista(e, norte)).toEqual([enNorte]);
    });

    it("D-37: una sucursal CERRADA se elige para ver su historial (gerente, administrador y el operador que la tiene asignada); el que no la tiene, no", async () => {
      const e = await empresaConFacturacion();
      const vieja = await sucursalNueva(e, "Vieja");
      const pvVieja = await puntoDeVentaEn(e, vieja, 5);
      const delHistorial = (await emitirYValidar(e, facturaCruda(e, { puntoDeVentaId: pvVieja })))
        .comprobanteId;
      await cerrar(vieja);

      const administrador = await persona(e, "ADMINISTRADOR");
      const conAsignada = await persona(e, "OPERADOR", [vieja]);
      const sinAsignada = await persona(e, "OPERADOR", [e.sucursal]);
      for (const ctx of [comoGerente(e), administrador, conAsignada]) {
        expect(await idsDeLaLista(e, vieja, ctx)).toEqual([delHistorial]);
      }
      expect(await listaDe(e, vieja, sinAsignada)).toMatchObject(FUERA);
    });

    it("el gerente y el administrador: sin elegir, con UNA abierta la toman sola (con o sin cerradas); con dos o más abiertas piden elegir", async () => {
      for (const rol of ["GERENTE", "ADMINISTRADOR"] as const) {
        const e = await empresaConFacturacion();
        const ctx = rol === "GERENTE" ? comoGerente(e) : await persona(e, rol);
        const unico = (await emitirYValidar(e)).comprobanteId;
        // 1 abierta y 0 cerradas.
        expect(await idsDeLaLista(e, null, ctx), rol).toEqual([unico]);
        // 1 abierta y 1 cerrada: sigue tomando la abierta (las cerradas se eligen a mano).
        const cerrada = await sucursalNueva(e, "Cerrada", false);
        expect(await idsDeLaLista(e, null, ctx), rol).toEqual([unico]);
        expect(await listaDe(e, cerrada, ctx), rol).toMatchObject({ ok: true });
        // 2 abiertas (y 1 cerrada): hay que elegir y no se lista nada.
        const otra = await sucursalNueva(e, "Otra");
        expect(await listaDe(e, null, ctx), rol).toMatchObject(NO_ELEGIDA);
        expect(await idsDeLaLista(e, e.sucursal, ctx), rol).toEqual([unico]);
        expect(await idsDeLaLista(e, otra, ctx), rol).toEqual([]);
      }
    });

    it("el operador, todas las combinaciones de abiertas y cerradas asignadas (0, 1, 2 de cada una): elige lo asignado, solo una ABIERTA se toma sola, y nada de lo no asignado", async () => {
      // La empresa tiene 3 abiertas (la de prueba y dos más) y 2 cerradas; el operador recibe un subconjunto.
      const e = await empresaConFacturacion();
      const abiertas = [e.sucursal, await sucursalNueva(e, "A2"), await sucursalNueva(e, "A3")];
      const cerradas = [await sucursalNueva(e, "C1", false), await sucursalNueva(e, "C2", false)];
      for (const a of [0, 1, 2]) {
        for (const c of [0, 1, 2]) {
          const mias = [...abiertas.slice(0, a), ...cerradas.slice(0, c)];
          const ajenas = [...abiertas.slice(a), ...cerradas.slice(c)];
          const operador = await persona(e, "OPERADOR", mias);
          const caso = `${a} abiertas y ${c} cerradas`;
          // Sin elegir.
          const sinElegir = await listaDe(e, null, operador);
          if (a === 1) expect(sinElegir, caso).toMatchObject({ ok: true });
          else if (a + c === 0) expect(sinElegir, caso).toMatchObject(FUERA);
          else expect(sinElegir, caso).toMatchObject(NO_ELEGIDA);
          // Eligiendo: lo asignado (abierta o cerrada) sí; lo demás, fuera de alcance, también con una sola abierta.
          for (const s of mias)
            expect(await listaDe(e, s, operador), caso).toMatchObject({ ok: true });
          for (const s of ajenas) expect(await listaDe(e, s, operador), caso).toMatchObject(FUERA);
        }
      }
    });

    it("una sucursal de otra empresa o inexistente es FISCAL_SUCURSAL_FUERA_DE_ALCANCE, incluso para el gerente", async () => {
      const e = await empresaConFacturacion();
      const ajena = (await empresaConFacturacion()).sucursal;
      expect(await listaDe(e, ajena)).toMatchObject(FUERA);
      expect(await listaDe(e, randomUUID())).toMatchObject(FUERA);
    });

    it("la respuesta dice qué sucursal usó (id, nombre y si está cerrada) y cada fila trae el número de su punto de venta como dato", async () => {
      const e = await empresaConFacturacion();
      const norte = await sucursalNueva(e, "Norte");
      const pvNorte = await puntoDeVentaEn(e, norte, 9);
      await emitirYValidar(e);
      await emitirYValidar(e, facturaCruda(e, { puntoDeVentaId: pvNorte }));
      const nombreCentro = (
        await filas<{ nombre: string }>("select nombre from sucursal where id = $1", [e.sucursal])
      )[0]?.nombre;

      const enCentro = await listaDe(e, e.sucursal);
      const enNorte = await listaDe(e, norte);
      if (!enCentro.ok || !enNorte.ok) throw new Error("no listó");
      expect(enCentro.dato.sucursal).toEqual({
        id: e.sucursal,
        nombre: nombreCentro,
        activa: true,
      });
      expect(enNorte.dato.sucursal).toEqual({ id: norte, nombre: "Norte", activa: true });
      expect(enCentro.dato.items.map((i) => i.puntoDeVentaNumero)).toEqual([e.pvNumero]);
      expect(enNorte.dato.items.map((i) => i.puntoDeVentaNumero)).toEqual([9]);
      // Sin elegir, la única abierta se toma sola y la respuesta dice cuál fue.
      const sola = await listaDe(await empresaConFacturacion(), null);
      expect(sola).toMatchObject({ ok: true, dato: { sucursal: { activa: true } } });
      // La respuesta lleva solo esos tres datos de la sucursal.
      expect(Object.keys(enNorte.dato.sucursal).sort()).toEqual(["activa", "id", "nombre"]);

      await cerrar(norte);
      expect(await listaDe(e, norte)).toMatchObject({
        ok: true,
        dato: { sucursal: { id: norte, nombre: "Norte", activa: false } },
      });
    });

    it("el operador recibe la sucursal que tiene asignada con su nombre, y la que no tiene sigue siendo FUERA DE ALCANCE sin revelar su nombre", async () => {
      const e = await empresaConFacturacion();
      const norte = await sucursalNueva(e, "Norte reservada");
      const asignada = await persona(e, "OPERADOR", [e.sucursal]);
      const lista = await listaDe(e, e.sucursal, asignada);
      expect(lista).toMatchObject({ ok: true, dato: { sucursal: { id: e.sucursal } } });
      const ajena = await listaDe(e, norte, asignada);
      expect(ajena).toMatchObject(FUERA);
      expect(JSON.stringify(ajena)).not.toContain("Norte reservada");
      const sinNinguna = await listaDe(e, null, await persona(e, "OPERADOR"));
      expect(sinNinguna).toMatchObject(FUERA);
      expect(JSON.stringify(sinNinguna)).not.toContain("Norte reservada");
    });

    it("aislamiento entre empresas: con la misma sucursal «elegida» nunca aparece un comprobante de otra empresa", async () => {
      const a = await empresaConFacturacion();
      const b = await empresaConFacturacion();
      const deA = (await emitirYValidar(a)).comprobanteId;
      const deB = (await emitirYValidar(b)).comprobanteId;
      expect(await idsDeLaLista(a, a.sucursal)).toEqual([deA]);
      expect(await idsDeLaLista(b, b.sucursal)).toEqual([deB]);
      expect(await listaDe(a, b.sucursal)).toMatchObject(FUERA);
    });
  });

  // ===============================================================================================
  // Los puntos de venta de la sucursal (el filtro «Punto de venta» del listado, D-6 y D-18)
  // ===============================================================================================
  describe("los puntos de venta de la sucursal", () => {
    const pvsDe = (e: EscenarioDeCasos, elegida: string | null, ctx = comoGerente(e)) =>
      listarPuntosDeVentaDeLaSucursal(d, ctx, elegida === null ? null : sucursalId(elegida));
    const numeros = async (e: EscenarioDeCasos, elegida: string | null, ctx = comoGerente(e)) => {
      const r = await pvsDe(e, elegida, ctx);
      if (!r.ok) throw new Error(`no listó: ${JSON.stringify(r.error)}`);
      return r.dato.items.map((i) => i.numero);
    };

    it("trae solo los ACTIVOS de la sucursal pedida, de menor a mayor, sin los inactivos ni los de otra sucursal", async () => {
      const e = await empresaConFacturacion();
      const norte = await sucursalNueva(e, "Norte");
      await puntoDeVentaEn(e, e.sucursal, 30);
      await puntoDeVentaEn(e, e.sucursal, 12);
      await crearPuntoDeVenta(dueno, e, { numero: 21, sucursal: e.sucursal, activo: false });
      await puntoDeVentaEn(e, norte, 40);
      expect(await numeros(e, e.sucursal)).toEqual([e.pvNumero, 12, 30].sort((a, b) => a - b));
      expect(await numeros(e, norte)).toEqual([40]);
      // Si el punto de venta se muda de sucursal, el filtro lo sigue.
      await mudar(await puntoDeVentaIdDe(e, 12), norte);
      expect(await numeros(e, norte)).toEqual([12, 40]);
      expect(await numeros(e, e.sucursal)).toEqual([e.pvNumero, 30].sort((a, b) => a - b));
    });

    it("la respuesta lleva solo el número de cada punto de venta (el formato de 5 dígitos lo pone la pantalla)", async () => {
      const e = await empresaConFacturacion();
      const r = await pvsDe(e, e.sucursal);
      expect(r).toEqual({ ok: true, dato: { items: [{ numero: e.pvNumero }] } });
    });

    it("la sucursal se resuelve en el servidor con la regla del listado: sin elegir, una abierta se toma sola; con varias, hay que elegir", async () => {
      const e = await empresaConFacturacion();
      expect(await numeros(e, null)).toEqual([e.pvNumero]);
      // Las cerradas no cuentan para «una sola».
      await sucursalNueva(e, "Cerrada", false);
      expect(await numeros(e, null)).toEqual([e.pvNumero]);
      await sucursalNueva(e, "Otra");
      expect(await pvsDe(e, null)).toMatchObject(NO_ELEGIDA);
      expect(await numeros(e, e.sucursal)).toEqual([e.pvNumero]);
    });

    it("una sucursal cerrada se puede pedir (D-37) y, sin puntos de venta activos, da una lista vacía; no es un error", async () => {
      const e = await empresaConFacturacion();
      const vieja = await sucursalNueva(e, "Vieja");
      await puntoDeVentaEn(e, vieja, 50);
      await cerrar(vieja);
      await dueno.query("update punto_de_venta set estado = 'INACTIVO' where sucursal_id = $1", [
        vieja,
      ]);
      expect(await pvsDe(e, vieja)).toEqual({ ok: true, dato: { items: [] } });
    });

    it("el operador con sucursal asignada pide la suya; la ajena, o ninguna asignada, es FUERA DE ALCANCE y no devuelve números", async () => {
      const e = await empresaConFacturacion();
      const norte = await sucursalNueva(e, "Norte");
      await puntoDeVentaEn(e, norte, 77);
      const conAsignada = await persona(e, "OPERADOR", [e.sucursal]);
      expect(await numeros(e, e.sucursal, conAsignada)).toEqual([e.pvNumero]);
      expect(await numeros(e, null, conAsignada)).toEqual([e.pvNumero]);
      const ajena = await pvsDe(e, norte, conAsignada);
      expect(ajena).toMatchObject(FUERA);
      expect(JSON.stringify(ajena)).not.toContain("77");
      const sinAsignaciones = await persona(e, "OPERADOR");
      expect(await pvsDe(e, null, sinAsignaciones)).toMatchObject(FUERA);
      expect(await pvsDe(e, e.sucursal, sinAsignaciones)).toMatchObject(FUERA);
    });

    it("el administrador y el gerente piden cualquiera de su empresa; una sucursal de otra empresa, inexistente o mal formada es FUERA DE ALCANCE", async () => {
      const a = await empresaConFacturacion();
      const b = await empresaConFacturacion();
      await puntoDeVentaEn(b, b.sucursal, 88);
      const administrador = await persona(a, "ADMINISTRADOR");
      expect(await numeros(a, a.sucursal, administrador)).toEqual([a.pvNumero]);
      for (const ctx of [comoGerente(a), administrador]) {
        for (const elegida of [b.sucursal, randomUUID(), "no-es-un-uuid", "' or 1=1 --"]) {
          const r = await pvsDe(a, elegida, ctx);
          expect(r, elegida).toMatchObject(FUERA);
          expect(JSON.stringify(r), elegida).not.toContain("88");
        }
      }
    });

    it("aislamiento entre empresas: con el mismo número de punto de venta en dos empresas, cada una ve solo el suyo", async () => {
      const a = await empresaConFacturacion();
      const b = await empresaConFacturacion();
      await puntoDeVentaEn(a, a.sucursal, 61);
      await puntoDeVentaEn(b, b.sucursal, 61);
      await puntoDeVentaEn(b, b.sucursal, 62);
      expect(await numeros(a, a.sucursal)).toEqual([a.pvNumero, 61].sort((x, y) => x - y));
      expect(await numeros(b, b.sucursal)).toEqual([b.pvNumero, 61, 62].sort((x, y) => x - y));
    });

    it("sin membresía en la empresa no se accede a nada (sin membresía no hay módulos: el guard rechaza primero por el módulo), y la persona de otra empresa tampoco con el contexto de esta", async () => {
      const a = await empresaConFacturacion();
      const b = await empresaConFacturacion("GERENTE");
      const ajeno = await crearPersonaDeBase(dueno);
      const sinMembresia = {
        ...comoEmpresa(empresaId(a.empresa), personaId(ajeno.id)),
        ahora: new Date(),
      };
      expect(await pvsDe(a, a.sucursal, sinMembresia)).toMatchObject({
        ok: false,
        error: { codigo: "MODULO_NO_ACTIVO" },
      });
      // El gerente de B, con el contexto de A (membresía que no tiene en A).
      const deOtraEmpresa = {
        ...comoEmpresa(empresaId(a.empresa), personaId(b.persona)),
        ahora: new Date(),
      };
      expect(await pvsDe(a, a.sucursal, deOtraEmpresa)).toMatchObject({
        ok: false,
        error: { codigo: "MODULO_NO_ACTIVO" },
      });
    });
  });

  // ===============================================================================================
  // Las sucursales que se pueden elegir
  // ===============================================================================================
  describe("las sucursales que la persona puede elegir (consulta de empresas)", () => {
    const elegibles = (ctx: ContextoOperativo) =>
      web.consultasDeEmpresas().sucursalesElegibles(ctx);
    const nombreDe = async (id: string) =>
      (await filas<{ nombre: string }>("select nombre from sucursal where id = $1", [id]))[0]
        ?.nombre as string;
    const porNombre = <T extends { nombre: string }>(l: readonly T[]) =>
      [...l].sort((x, y) => x.nombre.localeCompare(y.nombre));

    it("gerente y administrador: todas las de su empresa, abiertas y cerradas, con `activa`; lo que ofrece es exactamente lo que acepta el listado", async () => {
      const e = await empresaConFacturacion();
      const centro = { id: e.sucursal, nombre: await nombreDe(e.sucursal), activa: true };
      const norte = { id: await sucursalNueva(e, "Norte"), nombre: "Norte", activa: true };
      const vieja = { id: await sucursalNueva(e, "Vieja", false), nombre: "Vieja", activa: false };
      const otraEmpresa = await empresaConFacturacion();
      const esperadas = porNombre([centro, norte, vieja]);
      for (const ctx of [comoGerente(e), await persona(e, "ADMINISTRADOR")]) {
        expect(await elegibles(ctx)).toEqual({ ok: true, valor: esperadas });
        for (const s of esperadas) expect(await listaDe(e, s.id, ctx)).toMatchObject({ ok: true });
        expect(await listaDe(e, otraEmpresa.sucursal, ctx)).toMatchObject(FUERA);
      }
    });

    it("operador: solo las asignadas, abiertas y cerradas, con `activa`; sin asignaciones, ninguna; sin membresía, SIN_PERMISO", async () => {
      const e = await empresaConFacturacion();
      const norte = await sucursalNueva(e, "Norte");
      const vieja = await sucursalNueva(e, "Vieja", false);
      const noAsignada = await sucursalNueva(e, "Otra");
      expect(await elegibles(await persona(e, "OPERADOR"))).toEqual({ ok: true, valor: [] });
      const operador = await persona(e, "OPERADOR", [norte, vieja]);
      expect(await elegibles(operador)).toEqual({
        ok: true,
        valor: [
          { id: norte, nombre: "Norte", activa: true },
          { id: vieja, nombre: "Vieja", activa: false },
        ],
      });
      expect(await listaDe(e, noAsignada, operador)).toMatchObject(FUERA);
      // Una asignación apagada ya no cuenta.
      await dueno.query(
        "update asignacion_sucursal set activa = false where empresa_id = $1 and persona_id = $2 and sucursal_id = $3",
        [e.empresa, operador.personaId, vieja],
      );
      expect(await elegibles(operador)).toEqual({
        ok: true,
        valor: [{ id: norte, nombre: "Norte", activa: true }],
      });
      const ajeno = await crearPersonaDeBase(dueno);
      expect(
        await elegibles({
          ...comoEmpresa(empresaId(e.empresa), personaId(ajeno.id)),
          ahora: new Date(),
        }),
      ).toEqual({ ok: false, error: "SIN_PERMISO" });
    });

    it("aislamiento entre empresas: nunca aparece una sucursal de otra empresa", async () => {
      const a = await empresaConFacturacion();
      const b = await empresaConFacturacion();
      const deA = await elegibles(comoGerente(a));
      expect(deA.ok && deA.valor.map((s) => s.id)).toEqual([a.sucursal]);
      expect(JSON.stringify(deA)).not.toContain(b.sucursal);
    });
  });

  // ===============================================================================================
  // El detalle respeta las sucursales de la persona (D-39)
  // ===============================================================================================
  describe("el detalle de un comprobante (D-39)", () => {
    const NO_ENCONTRADO = { ok: false, error: { codigo: "FISCAL_COMPROBANTE_NO_ENCONTRADO" } };

    /** Una empresa con una factura en «Centro» y otra en «Norte». */
    async function conDosSucursales() {
      const e = await empresaConFacturacion();
      const norte = await sucursalNueva(e, "Norte");
      const pvNorte = await puntoDeVentaEn(e, norte, 7);
      const enCentro = (await emitirYValidar(e)).comprobanteId;
      const enNorte = (await emitirYValidar(e, facturaCruda(e, { puntoDeVentaId: pvNorte })))
        .comprobanteId;
      return { e, norte, enCentro, enNorte };
    }

    it("gerente y administrador abren el de cualquier sucursal de su empresa", async () => {
      const { e, enCentro, enNorte } = await conDosSucursales();
      for (const ctx of [comoGerente(e), await persona(e, "ADMINISTRADOR")]) {
        for (const id of [enCentro, enNorte]) {
          expect(await detalleDe(ctx, id)).toMatchObject({ ok: true, dato: { id } });
        }
      }
    });

    it("el operador abre solo los de las sucursales que tiene asignadas; el de otra es indistinguible de uno que no existe", async () => {
      const { e, enCentro, enNorte } = await conDosSucursales();
      const operador = await persona(e, "OPERADOR", [e.sucursal]);
      expect(await detalleDe(operador, enCentro)).toMatchObject({ ok: true });
      const ajeno = await detalleDe(operador, enNorte);
      const inexistente = await detalleDe(operador, randomUUID());
      expect(ajeno).toMatchObject(NO_ENCONTRADO);
      // La misma respuesta (nada que revele que existe), campo por campo.
      expect(JSON.stringify(ajeno)).toBe(JSON.stringify(inexistente));
      // Sin asignaciones: ninguno.
      const sin = await persona(e, "OPERADOR");
      expect(await detalleDe(sin, enCentro)).toMatchObject(NO_ENCONTRADO);
      expect(await detalleDe(sin, enNorte)).toMatchObject(NO_ENCONTRADO);
    });

    it("el operador abre los de una sucursal CERRADA que tiene asignada, y no los de una cerrada que no", async () => {
      const { e, norte, enCentro, enNorte } = await conDosSucursales();
      await cerrar(norte);
      const conLaCerrada = await persona(e, "OPERADOR", [norte]);
      expect(await detalleDe(conLaCerrada, enNorte)).toMatchObject({ ok: true });
      expect(await detalleDe(conLaCerrada, enCentro)).toMatchObject(NO_ENCONTRADO);
      const sinLaCerrada = await persona(e, "OPERADOR", [e.sucursal]);
      expect(await detalleDe(sinLaCerrada, enNorte)).toMatchObject(NO_ENCONTRADO);
      // El gerente también abre el de una cerrada.
      expect(await detalleDe(comoGerente(e), enNorte)).toMatchObject({ ok: true });
    });

    it("sigue a la sucursal del comprobante, no a la actual de su punto de venta", async () => {
      const { e, norte, enCentro } = await conDosSucursales();
      await mudar(e.pv, norte);
      const operadorDeCentro = await persona(e, "OPERADOR", [e.sucursal]);
      const operadorDeNorte = await persona(e, "OPERADOR", [norte]);
      expect(await detalleDe(operadorDeCentro, enCentro)).toMatchObject({ ok: true });
      expect(await detalleDe(operadorDeNorte, enCentro)).toMatchObject(NO_ENCONTRADO);
    });

    it("un comprobante cuya sucursal quedó vacía (carga que apagó los disparadores) no rompe: es «no encontrado», como si no existiera", async () => {
      const e = await empresaConFacturacion();
      const c = new pg.Client({ connectionString: propia.base.dueno });
      await c.connect();
      const datos = datosDeComprobante(e);
      try {
        // Como lo dejaría una restauración con `--disable-triggers`: sin disparadores no se copia la sucursal ni se exige.
        await c.query("begin");
        await c.query("alter table comprobante disable trigger user");
        expect((await insertarComprobante(viaDuenoDirecto(c), datos)).ok).toBe(true);
        await c.query("alter table comprobante enable trigger user");
        await c.query("commit");
      } finally {
        await c.query("rollback").catch(() => undefined);
        await c.end();
      }
      expect(await sucursalDelComprobante(datos["id"] as string)).toBeNull();
      for (const ctx of [comoGerente(e), await persona(e, "OPERADOR", [e.sucursal])]) {
        expect(await detalleDe(ctx, datos["id"] as string)).toMatchObject(NO_ENCONTRADO);
      }
    });

    it("aislamiento entre empresas: el comprobante de otra empresa no se abre, ni con un contexto de gerente", async () => {
      const a = await conDosSucursales();
      const b = await conDosSucursales();
      expect(await detalleDe(comoGerente(a.e), b.enCentro)).toMatchObject(NO_ENCONTRADO);
      expect(await detalleDe(comoGerente(b.e), a.enNorte)).toMatchObject(NO_ENCONTRADO);
    });
  });

  // ===============================================================================================
  // Los permisos de la persona (la barra del facturador): calculados por el servidor
  // ===============================================================================================
  describe("los permisos de la persona para la barra (consulta de empresas)", () => {
    const permisosDe = (ctx: ContextoOperativo) => web.consultasDeEmpresas().permisosDelActor(ctx);
    const accionesDe = async (ctx: ContextoOperativo) => {
      const r = await permisosDe(ctx);
      if (!r.ok) throw new Error(`no devolvió permisos: ${JSON.stringify(r.error)}`);
      return r.valor.acciones;
    };

    it("los tres roles de una empresa con facturación ven comprobantes.ver, con los módulos activos que lo explican", async () => {
      const e = await empresaConFacturacion();
      for (const ctx of [
        comoGerente(e),
        await persona(e, "ADMINISTRADOR"),
        await persona(e, "OPERADOR"),
        await persona(e, "OPERADOR", [e.sucursal]),
      ]) {
        const r = await permisosDe(ctx);
        expect(r).toMatchObject({
          ok: true,
          valor: { modulos: { activos: ["administracion", "facturacion"], enSoloLectura: [] } },
        });
        expect(await accionesDe(ctx)).toContain("comprobantes.ver");
      }
    });

    it("el rol manda: certificados y resincronizar series son solo del gerente; emitir una nota, de los tres", async () => {
      const e = await empresaConFacturacion();
      const delGerente = ["certificados.gestionar", "series.resincronizar"];
      const gerente = await accionesDe(comoGerente(e));
      for (const accion of delGerente) expect(gerente).toContain(accion);
      for (const ctx of [await persona(e, "ADMINISTRADOR"), await persona(e, "OPERADOR")]) {
        const acciones = await accionesDe(ctx);
        for (const accion of delGerente) expect(acciones).not.toContain(accion);
        expect(acciones).toContain("notas_de_credito.emitir");
      }
    });

    it("el módulo manda: una empresa que no activó facturación no tiene comprobantes.ver aunque el rol alcance, y la otra empresa sí", async () => {
      const sin = await crearEscenarioDeCasos(dueno, propia.base, { rol: "GERENTE" });
      const con = await empresaConFacturacion();
      const deLaSin = await permisosDe(comoGerente(sin));
      expect(deLaSin).toMatchObject({
        ok: true,
        valor: { modulos: { activos: ["administracion"] } },
      });
      expect(await accionesDe(comoGerente(sin))).not.toContain("comprobantes.ver");
      expect(await accionesDe(comoGerente(sin))).toContain("usuarios.invitar");
      expect(await accionesDe(comoGerente(con))).toContain("comprobantes.ver");
    });

    it("un módulo fuera del plan queda en solo lectura: puede mirar y anular, no emitir una factura nueva", async () => {
      const e = await crearEscenarioDeCasos(dueno, propia.base, { rol: "GERENTE" });
      const { version } = await crearPlanPublicado(dueno, { modulos: [] });
      await asignarPlan(dueno, e.tenant, version);
      await dueno.query(
        "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'facturacion')",
        [e.empresa],
      );
      const r = await permisosDe(comoGerente(e));
      expect(r).toMatchObject({
        ok: true,
        valor: { modulos: { activos: ["administracion"], enSoloLectura: ["facturacion"] } },
      });
      const acciones = await accionesDe(comoGerente(e));
      expect(acciones).toContain("comprobantes.ver");
      expect(acciones).toContain("notas_de_credito.emitir");
      expect(acciones).not.toContain("comprobantes.emitir_manual");
    });

    it("lo que dice es lo que el servidor después acepta: sin comprobantes.ver el listado también lo rechaza, con él lo acepta", async () => {
      const sin = await crearEscenarioDeCasos(dueno, propia.base, { rol: "GERENTE" });
      const con = await empresaConFacturacion();
      expect(await accionesDe(comoGerente(sin))).not.toContain("comprobantes.ver");
      expect(await listaDe(sin, null)).toMatchObject({
        ok: false,
        error: { codigo: "MODULO_NO_ACTIVO" },
      });
      expect(await accionesDe(comoGerente(con))).toContain("comprobantes.ver");
      expect(await listaDe(con, null)).toMatchObject({ ok: true });
    });

    it("sin membresía activa (o apagada) da SIN_PERMISO; no se guarda: al apagar a la persona el pedido siguiente ya no ve nada", async () => {
      const e = await empresaConFacturacion();
      const ajeno = await crearPersonaDeBase(dueno);
      const sinMembresia = {
        ...comoEmpresa(empresaId(e.empresa), personaId(ajeno.id)),
        ahora: new Date(),
      };
      expect(await permisosDe(sinMembresia)).toEqual({ ok: false, error: "SIN_PERMISO" });
      const apagada = await persona(e, "ADMINISTRADOR");
      expect(await accionesDe(apagada)).toContain("comprobantes.ver");
      await dueno.query(
        "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
        [e.empresa, apagada.personaId],
      );
      expect(await permisosDe(apagada)).toEqual({ ok: false, error: "SIN_PERMISO" });
    });

    it("aislamiento entre empresas: la membresía de una no da permisos en la otra", async () => {
      const a = await empresaConFacturacion();
      const b = await empresaConFacturacion();
      const gerenteDeB = {
        ...comoEmpresa(empresaId(a.empresa), personaId(b.persona)),
        ahora: new Date(),
      };
      expect(await permisosDe(gerenteDeB)).toEqual({ ok: false, error: "SIN_PERMISO" });
    });
  });
});
