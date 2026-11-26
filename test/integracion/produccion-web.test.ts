import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  anularLaOrden,
  cancelarLaOrden,
  listarLasOrdenes,
  verLaOrden,
  type DependenciasDeProduccionWeb,
} from "../../src/composicion/produccion-web";
import {
  crearCasosDeUsoDeProduccion,
  crearConsultasDeProduccion,
} from "../../src/modulos/produccion/publico";
import { montarProduccion, type MontajeDeProduccion } from "./produccion-apoyo";
import {
  aLaVez,
  firme,
  nuevoId,
  RONDAS,
  valorDe,
  type EscenarioDeStock,
} from "./stock-casos-apoyo";

/**
 * Las pantallas de órdenes de producción de la web (`produccion-web.ts`) contra una base real y los roles reales: lo que la pantalla recibe (la lista y la ficha, solo lo que dibuja), que
 * una empresa no ve las órdenes de otra, que el operador solo ve las de su sucursal y no cancela ni anula, que el módulo en desarrollo lo decide el guard, y que cancelar y anular
 * se repiten sin duplicar y se pisan sin romper (idempotencia y concurrencia, con la auditoría y el libro de stock). Los casos de uso en sí (estados, espejo, `PRODUCTO_YA_USADO`) tienen su
 * prueba en `produccion-ordenes.test.ts` y `produccion-concurrencia.test.ts`; acá se prueba lo que agrega la composición.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("producción en la web: lista, ficha, cancelar y anular", () => {
  let c: MontajeDeProduccion;
  let e: EscenarioDeStock;
  let otra: EscenarioDeStock;
  let registrados: string[];
  let d: DependenciasDeProduccionWeb;
  let cerrado: DependenciasDeProduccionWeb;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarProduccion(base);
    e = await c.escenario();
    otra = await c.escenario();
    registrados = [];
    d = {
      consultas: () => c.consultasDeProduccion,
      casosDeUso: () => c.produccion,
      respuesta: { registrar: (detalle) => registrados.push(detalle) },
    };
    // Un catálogo con `produccion` en desarrollo (el real ya la tiene disponible, DEC-1050): el guard rechaza todo.
    const catalogo = {
      ...CATALOGO_DE_MODULOS,
      produccion: { ...CATALOGO_DE_MODULOS.produccion, estado: "en_desarrollo" },
    } as unknown as typeof CATALOGO_DE_MODULOS;
    const reglas = { catalogo, permisos: PERMISOS_DE_EMPRESA };
    const transacciones = c.entorno as never;
    cerrado = {
      consultas: () => crearConsultasDeProduccion({ transacciones, reglas }),
      casosDeUso: () => crearCasosDeUsoDeProduccion({ transacciones, reglas }),
      respuesta: { registrar: (detalle) => registrados.push(detalle) },
    };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  type P = Awaited<ReturnType<MontajeDeProduccion["panaderia"]>>;
  const lista = async (escenario = e) => {
    const p = await c.panaderia(escenario);
    await c.comprar(escenario, p.origen, p.harina.producto, "100", "1000");
    await c.comprar(escenario, p.origen, p.manteca.producto, "50", "9000");
    return p;
  };
  const abrir = async (p: P, escenario = e, cantidad = "16") =>
    valorDe(
      await c.produccion.abrirOrden(escenario.gerente, {
        id: nuevoId(),
        productoId: p.masa.producto,
        cantidad,
        unidadId: "KILOGRAMO",
        depositoId: p.origen,
        depositoDestinoId: p.destino,
      }),
    );
  const cerrar = async (ordenId: string, p: P, escenario = e) =>
    valorDe(
      await c.produccion.cerrarOrden(escenario.gerente, {
        ordenId,
        clave: nuevoId(),
        obtenido: "15",
        unidadId: "KILOGRAMO",
        consumos: [
          { productoId: p.harina.producto, cantidadReal: "12", unidadId: "KILOGRAMO" },
          { productoId: p.manteca.producto, cantidadReal: "4", unidadId: "KILOGRAMO" },
        ],
      }),
    );
  const estadoDe = async (id: string) =>
    (
      await c.filas<{ estado: string }>("select estado from orden_de_produccion where id = $1", [
        id,
      ])
    )[0]?.estado;
  const motivoDe = async (id: string) =>
    (
      await c.filas<{ motivo: string | null }>(
        "select motivo from orden_de_produccion where id = $1",
        [id],
      )
    )[0]?.motivo;
  const auditadas = async (accion: string, id: string) =>
    (await c.auditoria(e.empresa, accion)).filter((a) => a["entidad_id"] === id);
  const movimientos = async (id: string) =>
    Number(
      (
        await c.filas<{ n: string }>(
          `select count(*)::text as n from movimiento_de_stock
           where id in (select unnest(array[movimiento_de_consumo_id, movimiento_de_producto_id, anulacion_de_consumo_id, anulacion_de_producto_id])
                        from orden_de_produccion where id = $1)`,
          [id],
        )
      )[0]?.n ?? "0",
    );

  describe("la lista", () => {
    it("trae las órdenes de la sucursal, la más nueva primero, solo con lo que la pantalla dibuja", async () => {
      const p = await lista();
      const a = await abrir(p);
      const b = await abrir(p, e, "8");
      const r = await listarLasOrdenes(d, e.gerente, e.sucursal, { estado: "" });
      if (!r.ok) throw new Error(`se esperaba la lista y vino ${r.error.codigo}`);
      const mias = r.dato.ordenes.filter((o) => [a.ordenId, b.ordenId].includes(o.id));
      expect(mias.map((o) => o.id)).toEqual([b.ordenId, a.ordenId]);
      expect(mias[0]).toMatchObject({
        id: b.ordenId,
        numero: b.numero,
        estado: "ABIERTA",
        cantidad: "8.0000",
        unidadId: "KILOGRAMO",
      });
      expect(typeof mias[0]?.nombre).toBe("string");
      expect(Object.keys(mias[0] ?? {}).sort()).toEqual([
        "cantidad",
        "estado",
        "id",
        "nombre",
        "numero",
        "unidadId",
      ]);
    });

    it("«Abiertas» no trae las cerradas ni las canceladas; «Todas» trae las cuatro clases de estado", async () => {
      const p = await lista();
      const abierta = await abrir(p);
      const cerrada = await abrir(p);
      await cerrar(cerrada.ordenId, p);
      const cancelada = await abrir(p);
      valorDe(
        await c.produccion.cancelarOrden(e.gerente, { ordenId: cancelada.ordenId, motivo: "x" }),
      );
      const anulada = await abrir(p);
      await cerrar(anulada.ordenId, p);
      valorDe(await c.produccion.anularOrden(e.gerente, { ordenId: anulada.ordenId, motivo: "x" }));
      const ids = [abierta, cerrada, cancelada, anulada].map((o) => o.ordenId);
      const soloAbiertas = await listarLasOrdenes(d, e.gerente, e.sucursal, { estado: "ABIERTA" });
      if (!soloAbiertas.ok) throw new Error("se esperaba la lista");
      expect(soloAbiertas.dato.ordenes.filter((o) => ids.includes(o.id)).map((o) => o.id)).toEqual([
        abierta.ordenId,
      ]);
      const todas = await listarLasOrdenes(d, e.gerente, e.sucursal, { estado: "" });
      if (!todas.ok) throw new Error("se esperaba la lista");
      expect(
        todas.dato.ordenes
          .filter((o) => ids.includes(o.id))
          .map((o) => o.estado)
          .sort(),
      ).toEqual(["ABIERTA", "ANULADA", "CANCELADA", "CERRADA"]);
    });

    it("un filtro de estado que no existe devuelve la lista vacía sin consultar", async () => {
      const r = await listarLasOrdenes(d, e.gerente, e.sucursal, { estado: "CERRADA" });
      expect(r).toEqual({ ok: true, dato: { ordenes: [] } });
    });

    it("otra empresa no ve las órdenes de esta, ni con la sucursal de esta (aislamiento por empresa)", async () => {
      const p = await lista();
      const a = await abrir(p);
      for (const sucursal of [otra.sucursal, e.sucursal]) {
        const r = await listarLasOrdenes(d, otra.gerente, sucursal, { estado: "" });
        if (!r.ok) throw new Error("se esperaba la lista");
        expect(r.dato.ordenes.map((o) => o.id)).not.toContain(a.ordenId);
      }
    });

    it("la lista de una sucursal no trae las órdenes de otra: filtra por la sucursal que puso el servidor", async () => {
      const p = await lista();
      const enNorte = await c.deposito(e, { sucursal: e.otraSucursal });
      const origenNorte = await c.deposito(e, { sucursal: e.otraSucursal });
      const delNorte = valorDe(
        await c.produccion.abrirOrden(e.gerente, {
          id: nuevoId(),
          productoId: p.masa.producto,
          cantidad: "8",
          unidadId: "KILOGRAMO",
          depositoId: origenNorte,
          depositoDestinoId: enNorte,
        }),
      );
      const centro = await listarLasOrdenes(d, e.gerente, e.sucursal, { estado: "" });
      const norte = await listarLasOrdenes(d, e.gerente, e.otraSucursal, { estado: "" });
      if (!centro.ok || !norte.ok) throw new Error("se esperaba la lista");
      expect(centro.dato.ordenes.map((o) => o.id)).not.toContain(delNorte.ordenId);
      expect(norte.dato.ordenes.map((o) => o.id)).toContain(delNorte.ordenId);
    });

    it("un operador ve las órdenes de su sucursal; una orden con un depósito fuera de su alcance no la ve, ni la lista ni la ficha", async () => {
      const p = await lista();
      const suya = await abrir(p);
      const origenNorte = await c.deposito(e, { sucursal: e.otraSucursal });
      const ajena = valorDe(
        await c.produccion.abrirOrden(e.gerente, {
          id: nuevoId(),
          productoId: p.masa.producto,
          cantidad: "8",
          unidadId: "KILOGRAMO",
          depositoId: p.origen,
          depositoDestinoId: origenNorte,
        }),
      );
      const r = await listarLasOrdenes(d, e.operador, e.sucursal, { estado: "" });
      if (!r.ok) throw new Error(`se esperaba la lista y vino ${r.error.codigo}`);
      expect(r.dato.ordenes.map((o) => o.id)).toContain(suya.ordenId);
      expect(r.dato.ordenes.map((o) => o.id)).not.toContain(ajena.ordenId);
      expect(await verLaOrden(d, e.operador, { ordenId: suya.ordenId })).toMatchObject({
        ok: true,
      });
      expect(await verLaOrden(d, e.operador, { ordenId: ajena.ordenId })).toMatchObject({
        ok: false,
        error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" },
      });
    });

    it("con `produccion` en desarrollo el guard rechaza la lectura, sin datos", async () => {
      const r = await listarLasOrdenes(cerrado, e.gerente, e.sucursal, { estado: "" });
      expect(r).toMatchObject({ ok: false, error: { codigo: "MODULO_EN_DESARROLLO" } });
      expect(JSON.stringify(r)).not.toContain("ordenes");
    });

    it("no escribe nada: ni orden, ni movimiento, ni auditoría", async () => {
      const antes = await c.filas<{ n: string }>(
        "select (select count(*) from orden_de_produccion)::text || '/' || (select count(*) from movimiento_de_stock)::text || '/' || (select count(*) from auditoria_empresa)::text as n",
      );
      await listarLasOrdenes(d, e.gerente, e.sucursal, { estado: "" });
      const despues = await c.filas<{ n: string }>(
        "select (select count(*) from orden_de_produccion)::text || '/' || (select count(*) from movimiento_de_stock)::text || '/' || (select count(*) from auditoria_empresa)::text as n",
      );
      expect(despues).toEqual(antes);
    });
  });

  describe("la ficha", () => {
    it("una abierta: lo esperado de cada insumo, la receta sin cambios y sin lote ni costo definido", async () => {
      const p = await lista();
      const a = await abrir(p);
      const r = await verLaOrden(d, e.gerente, { ordenId: a.ordenId });
      if (!r.ok) throw new Error(`se esperaba la ficha y vino ${r.error.codigo}`);
      expect(r.dato).toMatchObject({
        id: a.ordenId,
        numero: a.numero,
        estado: "ABIERTA",
        unidadId: "KILOGRAMO",
        cantidadEsperada: "16.0000",
        cantidadObtenida: null,
        recetaCambiada: false,
        vence: null,
        lote: null,
        costo: { costoUnitario: null, costoEstado: null },
      });
      expect(r.dato.renglones.map((x) => [x.esperado, x.real, x.unidadId]).sort()).toEqual([
        ["12.0000", null, "KILOGRAMO"],
        ["4.0000", null, "KILOGRAMO"],
      ]);
      expect(JSON.stringify(r)).not.toContain(p.origen);
    });

    it("una cerrada: lo obtenido, lo real de cada insumo y el costo congelado (solo con `costos.ver`: el operador no lo ve)", async () => {
      const p = await lista();
      const a = await abrir(p);
      await cerrar(a.ordenId, p);
      const gerente = await verLaOrden(d, e.gerente, { ordenId: a.ordenId });
      if (!gerente.ok) throw new Error("se esperaba la ficha");
      expect(gerente.dato).toMatchObject({
        estado: "CERRADA",
        cantidadObtenida: "15.0000",
        // La masa no se controla por lote: no hay lote que mostrar (con control de lote es `OP-<número>`, `produccion-ordenes.test.ts`).
        lote: null,
      });
      expect(gerente.dato.renglones.map((x) => x.real).sort()).toEqual(["12.0000", "4.0000"]);
      expect(gerente.dato.costo?.costoEstado).toBe("DEFINITIVO");
      expect(gerente.dato.costo?.costoUnitario).toMatch(/^\d+\.\d{6}$/);
      const operador = await verLaOrden(d, e.operador, { ordenId: a.ordenId });
      if (!operador.ok) throw new Error("se esperaba la ficha");
      expect(Object.hasOwn(operador.dato, "costo")).toBe(false);
    });

    it("una orden de otra empresa, una que no existe o un id mal escrito salen igual: el genérico", async () => {
      const p = await lista();
      const a = await abrir(p);
      for (const [quien, id] of [
        [otra.gerente, a.ordenId],
        [e.gerente, nuevoId()],
        [e.gerente, "no-es-un-id"],
      ] as const) {
        expect(await verLaOrden(d, quien, { ordenId: id })).toMatchObject({
          ok: false,
          error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" },
        });
      }
    });

    it("con `produccion` en desarrollo el guard rechaza la ficha", async () => {
      const p = await lista();
      const a = await abrir(p);
      expect(await verLaOrden(cerrado, e.gerente, { ordenId: a.ordenId })).toMatchObject({
        ok: false,
        error: { codigo: "MODULO_EN_DESARROLLO" },
      });
    });

    it("un fallo inesperado sale sin detalle, con referencia, y queda en el registro", async () => {
      const roto: DependenciasDeProduccionWeb = {
        ...d,
        consultas: () => ({
          listarOrdenes: () => Promise.reject(new Error("detalle interno de la base")),
          fichaDeOrden: () => Promise.reject(new Error("detalle interno de la base")),
        }),
      };
      const antes = registrados.length;
      const r = await verLaOrden(roto, e.gerente, { ordenId: nuevoId() });
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain("detalle interno");
      expect(registrados).toHaveLength(antes + 1);
      expect(registrados.at(-1)).toContain("detalle interno de la base");
    });
  });

  describe("cancelar", () => {
    it("cancela una abierta con motivo: queda CANCELADA con su motivo y auditada; no mueve stock", async () => {
      const p = await lista();
      const a = await abrir(p);
      const harina = await c.existencia(p.origen, p.harina.articulo);
      const r = await cancelarLaOrden(d, e.gerente, {
        ordenId: a.ordenId,
        motivo: "Se rompió el horno",
      });
      expect(r).toEqual({ ok: true, dato: { yaEstaba: false } });
      expect(await estadoDe(a.ordenId)).toBe("CANCELADA");
      expect(await motivoDe(a.ordenId)).toBe("Se rompió el horno");
      expect(await auditadas("ORDEN_DE_PRODUCCION_CANCELADA", a.ordenId)).toHaveLength(1);
      expect(await c.existencia(p.origen, p.harina.articulo)).toBe(harina);
      expect(await movimientos(a.ordenId)).toBe(0);
    });

    it("idempotencia: repetirla (clic doble, reintento) devuelve `yaEstaba` y no escribe ni audita de nuevo", async () => {
      const p = await lista();
      const a = await abrir(p);
      await cancelarLaOrden(d, e.gerente, { ordenId: a.ordenId, motivo: "Primero" });
      const otraVez = await cancelarLaOrden(d, e.gerente, {
        ordenId: a.ordenId,
        motivo: "Segundo",
      });
      expect(otraVez).toEqual({ ok: true, dato: { yaEstaba: true } });
      expect(await motivoDe(a.ordenId)).toBe("Primero");
      expect(await auditadas("ORDEN_DE_PRODUCCION_CANCELADA", a.ordenId)).toHaveLength(1);
    });

    it("concurrencia: dos cancelaciones a la vez sobre la misma orden son una sola (una `yaEstaba: false`, la otra `true`) y una sola auditoría", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const p = await lista();
        const a = await abrir(p);
        const rs = await aLaVez(
          c,
          [
            () =>
              firme(() =>
                cancelarLaOrden(d, e.gerente, { ordenId: a.ordenId, motivo: "A la vez" }),
              ),
            () =>
              firme(() =>
                cancelarLaOrden(d, e.gerente, { ordenId: a.ordenId, motivo: "A la vez" }),
              ),
          ],
          ronda,
        );
        expect(
          rs.every((r) => r.ok),
          JSON.stringify(rs),
        ).toBe(true);
        expect(rs.map((r) => (r.ok ? r.dato.yaEstaba : null)).sort()).toEqual([false, true]);
        expect(await estadoDe(a.ordenId)).toBe("CANCELADA");
        expect(await auditadas("ORDEN_DE_PRODUCCION_CANCELADA", a.ordenId)).toHaveLength(1);
      }
    });

    it("sin motivo (vacío o en blanco) no cancela: el genérico y la orden sigue abierta", async () => {
      const p = await lista();
      const a = await abrir(p);
      for (const motivo of ["", "   "]) {
        expect(await cancelarLaOrden(d, e.gerente, { ordenId: a.ordenId, motivo })).toMatchObject({
          ok: false,
          error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" },
        });
      }
      expect(await estadoDe(a.ordenId)).toBe("ABIERTA");
    });

    it("una cerrada (ya movió stock) no se cancela: el genérico y no cambia nada", async () => {
      const p = await lista();
      const a = await abrir(p);
      await cerrar(a.ordenId, p);
      expect(
        await cancelarLaOrden(d, e.gerente, { ordenId: a.ordenId, motivo: "x" }),
      ).toMatchObject({ ok: false, error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" } });
      expect(await estadoDe(a.ordenId)).toBe("CERRADA");
    });

    it("un operador no cancela (SIN_PERMISO, el guard) y otra empresa tampoco: la orden sigue abierta", async () => {
      const p = await lista();
      const a = await abrir(p);
      expect(
        await cancelarLaOrden(d, e.operador, { ordenId: a.ordenId, motivo: "x" }),
      ).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
      expect(
        await cancelarLaOrden(d, otra.gerente, { ordenId: a.ordenId, motivo: "x" }),
      ).toMatchObject({ ok: false, error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" } });
      expect(await estadoDe(a.ordenId)).toBe("ABIERTA");
    });

    it("con `produccion` en desarrollo el guard rechaza y no cambia nada", async () => {
      const p = await lista();
      const a = await abrir(p);
      expect(
        await cancelarLaOrden(cerrado, e.gerente, { ordenId: a.ordenId, motivo: "x" }),
      ).toMatchObject({ ok: false, error: { codigo: "MODULO_EN_DESARROLLO" } });
      expect(await estadoDe(a.ordenId)).toBe("ABIERTA");
    });
  });

  describe("anular", () => {
    it("anula una cerrada con motivo: queda ANULADA, auditada, y el stock vuelve (lo consumido entra, lo producido sale)", async () => {
      const p = await lista();
      const a = await abrir(p);
      await cerrar(a.ordenId, p);
      expect(await c.existencia(p.origen, p.harina.articulo)).toBe("88.0000");
      expect(await c.existencia(p.destino, p.masa.articulo)).toBe("15.0000");
      const r = await anularLaOrden(d, e.gerente, { ordenId: a.ordenId, motivo: "Error de carga" });
      expect(r).toEqual({ ok: true, dato: { yaEstaba: false } });
      expect(await estadoDe(a.ordenId)).toBe("ANULADA");
      expect(await motivoDe(a.ordenId)).toBe("Error de carga");
      expect(await auditadas("ORDEN_DE_PRODUCCION_ANULADA", a.ordenId)).toHaveLength(1);
      expect(await c.existencia(p.origen, p.harina.articulo)).toBe("100.0000");
      expect(await c.existencia(p.destino, p.masa.articulo)).toBe("0.0000");
      expect(await movimientos(a.ordenId)).toBe(4);
    });

    it("idempotencia: repetirla devuelve `yaEstaba` y no duplica los movimientos espejo ni la auditoría", async () => {
      const p = await lista();
      const a = await abrir(p);
      await cerrar(a.ordenId, p);
      await anularLaOrden(d, e.gerente, { ordenId: a.ordenId, motivo: "Primero" });
      const otraVez = await anularLaOrden(d, e.gerente, { ordenId: a.ordenId, motivo: "Segundo" });
      expect(otraVez).toEqual({ ok: true, dato: { yaEstaba: true } });
      expect(await movimientos(a.ordenId)).toBe(4);
      expect(await auditadas("ORDEN_DE_PRODUCCION_ANULADA", a.ordenId)).toHaveLength(1);
      expect(await c.existencia(p.origen, p.harina.articulo)).toBe("100.0000");
    });

    it("concurrencia: dos anulaciones a la vez son una sola: cuatro movimientos en total y el stock vuelve una sola vez", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const p = await lista();
        const a = await abrir(p);
        await cerrar(a.ordenId, p);
        const rs = await aLaVez(
          c,
          [
            () =>
              firme(() => anularLaOrden(d, e.gerente, { ordenId: a.ordenId, motivo: "A la vez" })),
            () =>
              firme(() => anularLaOrden(d, e.gerente, { ordenId: a.ordenId, motivo: "A la vez" })),
          ],
          ronda,
        );
        expect(
          rs.every((r) => r.ok),
          JSON.stringify(rs),
        ).toBe(true);
        expect(rs.map((r) => (r.ok ? r.dato.yaEstaba : null)).sort()).toEqual([false, true]);
        expect(await movimientos(a.ordenId)).toBe(4);
        expect(await c.existencia(p.origen, p.harina.articulo)).toBe("100.0000");
        expect(await auditadas("ORDEN_DE_PRODUCCION_ANULADA", a.ordenId)).toHaveLength(1);
      }
    });

    it("sin motivo no anula; una abierta (no movió nada) no se anula: el genérico y no cambia nada", async () => {
      const p = await lista();
      const cerrada = await abrir(p);
      await cerrar(cerrada.ordenId, p);
      expect(
        await anularLaOrden(d, e.gerente, { ordenId: cerrada.ordenId, motivo: "" }),
      ).toMatchObject({ ok: false, error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" } });
      expect(await estadoDe(cerrada.ordenId)).toBe("CERRADA");
      const abierta = await abrir(p);
      expect(
        await anularLaOrden(d, e.gerente, { ordenId: abierta.ordenId, motivo: "x" }),
      ).toMatchObject({ ok: false, error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" } });
      expect(await estadoDe(abierta.ordenId)).toBe("ABIERTA");
    });

    it("lo producido que ya se usó no se anula (PRODUCTO_YA_USADO sale como el genérico) y nada queda a medias", async () => {
      const p = await lista();
      const a = await abrir(p);
      await cerrar(a.ordenId, p);
      valorDe(
        await c.casos.registrarSalida(e.gerente, {
          clave: nuevoId(),
          depositoId: p.destino,
          motivo: "CONSUMO_INTERNO",
          renglones: [{ productoId: p.masa.producto, cantidad: "10", unidadId: "KILOGRAMO" }],
        }),
      );
      expect(await anularLaOrden(d, e.gerente, { ordenId: a.ordenId, motivo: "x" })).toMatchObject({
        ok: false,
        error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" },
      });
      expect(await estadoDe(a.ordenId)).toBe("CERRADA");
      expect(await movimientos(a.ordenId)).toBe(2);
      expect(await c.existencia(p.destino, p.masa.articulo)).toBe("5.0000");
    });

    it("un operador no anula (SIN_PERMISO) y otra empresa tampoco", async () => {
      const p = await lista();
      const a = await abrir(p);
      await cerrar(a.ordenId, p);
      expect(await anularLaOrden(d, e.operador, { ordenId: a.ordenId, motivo: "x" })).toMatchObject(
        { ok: false, error: { codigo: "SIN_PERMISO" } },
      );
      expect(
        await anularLaOrden(d, otra.gerente, { ordenId: a.ordenId, motivo: "x" }),
      ).toMatchObject({ ok: false, error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" } });
      expect(await estadoDe(a.ordenId)).toBe("CERRADA");
    });

    it("con `produccion` en desarrollo el guard rechaza y no cambia nada", async () => {
      const p = await lista();
      const a = await abrir(p);
      await cerrar(a.ordenId, p);
      expect(
        await anularLaOrden(cerrado, e.gerente, { ordenId: a.ordenId, motivo: "x" }),
      ).toMatchObject({ ok: false, error: { codigo: "MODULO_EN_DESARROLLO" } });
      expect(await estadoDe(a.ordenId)).toBe("CERRADA");
    });
  });
});
