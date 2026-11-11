import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  crearCasosDeUsoDeStock,
  type TxDeStock,
  type CasosDeUsoDeStock,
} from "../../src/modulos/stock/publico";
import type { Transacciones } from "../../src/puertos/transacciones";
import { grupoDeBase, opcionDeBase } from "./catalogo-apoyo";
import { RONDAS, firme } from "./stock-casos-apoyo";
import { articuloDeBase, depositoDeBase, existenciaDe } from "./stock-apoyo";
import type { TxDePrueba } from "./entorno";
import {
  REGLAS_DE_PRUEBA_CON_STOCK,
  montarVentas,
  nuevaClave,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * E5-T12: ventas cableada con stock (casos de uso reales de ventas con el puerto real de la composición y los repositorios de stock sobre la MISMA
 * conexión, rol real de la aplicación). Cerrar la cuenta descuenta una vez por ejemplar (dos cierres, dos clics a la vez, el mostrador repetido),
 * anular el ticket devuelve una vez, un error de stock o una falla en cualquier punto del cierre revierte todo (ni número, ni ticket, ni cobro, ni
 * salida), con stock apagado ventas no cambia, las empresas no se tocan entre sí y el consumo usa la versión de la variante SELLADA en la línea.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 900_000 });

const monto = (valor: string) => ({ moneda: "ARS", monto: valor });

describe.skipIf(base === null)("ventas con stock: cerrar descuenta, anular devuelve", () => {
  let m: MundoDeVentas;
  let stock: CasosDeUsoDeStock;
  /** Mientras no es `null`, la auditoría de esa acción falla (una falla en el MEDIO del cierre, después de que stock escribió). */
  let fallaAlAuditar: string | null = null;

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, {
      stock: true,
      conexiones: 16,
      ajustarTx: (tx: TxDePrueba): TxDePrueba => ({
        ...tx,
        auditoria: {
          ...tx.auditoria,
          registrar: async (evento) => {
            if (fallaAlAuditar !== null && evento.accion === fallaAlAuditar) {
              throw new Error("falla inyectada en medio del cierre");
            }
            return tx.auditoria.registrar(evento);
          },
        },
      }),
    });
    stock = crearCasosDeUsoDeStock({
      transacciones: m.entorno as unknown as Transacciones<TxDeStock>,
      reglas: REGLAS_DE_PRUEBA_CON_STOCK,
    });
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  // ---- el escenario ---------------------------------------------------------------------------------------------------------------

  type Mundo = Readonly<{ e: EscenarioDeVentas; dep: string }>;
  /** Una empresa con su sucursal y su depósito de venta. */
  const mundoNuevo = async (): Promise<Mundo> => {
    const e = await m.escenario();
    const dep = await depositoDeBase(m.dueno, e, { deVenta: true });
    return { e, dep };
  };
  /** Un producto de reventa con su artículo, a $1000 y con esa existencia en el depósito de venta. */
  const reventa = async ({ e, dep }: Mundo, existencia = "10", precio = "1000") => {
    const a = await articuloDeBase(m.dueno, e, { clase: "REVENTA" });
    await m.precio({
      empresa: e.empresa,
      producto: a.producto,
      precio,
      desde: "2026-01-01T00:00:00Z",
    });
    if (existencia !== "0") {
      valorDe(
        await stock.registrarEntrada(e.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "COMPRA",
          renglones: [{ productoId: a.producto, cantidad: existencia, unidadId: "UNIDAD" }],
        }),
      );
    }
    return a;
  };
  const existencia = (dep: string, articulo: string) => existenciaDe(m.dueno, dep, articulo);

  type Pedido = ReadonlyArray<
    Readonly<{ producto: string; cantidad?: string; extra?: Record<string, unknown> }>
  >;
  /** Abre la cuenta y le agrega las líneas (todavía sin cerrar). */
  const cuentaCon = async (
    e: EscenarioDeVentas,
    pedido: Pedido,
    contexto: ContextoOperativo = e.gerente,
    sucursal = e.sucursal,
  ) => {
    const cuenta = nuevoId();
    valorDe(await m.casos.abrirCuenta(contexto, { cuentaId: cuenta, sucursalId: sucursal }));
    const lineas: string[] = [];
    for (const l of pedido) {
      const lineaId = nuevoId();
      valorDe(
        await m.casos.agregarLinea(contexto, {
          cuentaId: cuenta,
          lineaId,
          productoId: l.producto,
          opcionIds: [],
          cantidad: l.cantidad ?? "1",
          ...l.extra,
        }),
      );
      lineas.push(lineaId);
    }
    return { cuenta, lineas };
  };
  const cerrar = (contexto: ContextoOperativo, cuenta: string, ejemplarId = nuevoId()) =>
    m.casos.cerrarCuenta(contexto, { cuentaId: cuenta, ejemplarId });
  /** Una venta cerrada (ticket EMITIDO). */
  const vender = async (mundo: Mundo, pedido: Pedido) => {
    const { cuenta, lineas } = await cuentaCon(mundo.e, pedido);
    const ejemplarId = nuevoId();
    const t = valorDe(await cerrar(mundo.e.gerente, cuenta, ejemplarId));
    return { cuenta, lineas, ...t };
  };
  const anular = (
    contexto: ContextoOperativo,
    t: Readonly<{ ticketId: string; ejemplarId: string }>,
    extra: Record<string, unknown> = {},
  ) =>
    m.casos.anularTicket(contexto, {
      claveIdempotencia: nuevaClave(),
      ticketId: t.ticketId,
      ejemplarBaseId: t.ejemplarId,
      ejemplarNuevoId: nuevoId(),
      motivo: "Error del cajero",
      ...extra,
    });

  // ---- lo que quedó en la base ---------------------------------------------------------------------------------------------------

  const delEjemplar = (ejemplarId: string, clase: "SALIDA" | "ANULACION") =>
    m.filas<{
      id: string;
      clave_idempotencia: string;
      accion: string;
      deposito_id: string;
      fecha: string;
      hecho_en: Date;
      detalle: string | null;
      anula_a: string | null;
      registrado_por: string;
    }>(
      `select id, clave_idempotencia, accion, deposito_id, fecha_negocio::text as fecha, hecho_en, detalle, anula_a, registrado_por
         from movimiento_de_stock where origen_tipo = 'EJEMPLAR_DE_TICKET' and origen_id = $1 and clase = $2 order by registrado_en`,
      [ejemplarId, clase],
    );
  const renglonesDe = (movimientoId: string) =>
    m.filas<{ articulo_id: string; cantidad: string }>(
      "select articulo_id, cantidad::text as cantidad from renglon_de_movimiento where movimiento_id = $1 order by articulo_id",
      [movimientoId],
    );
  const contar = (tabla: string, empresa: string) =>
    m.contar(`select count(*) as n from ${tabla} where empresa_id = $1`, [empresa]);
  const numerador = async (e: EscenarioDeVentas) =>
    (
      await m.filas<{ ultimo: number }>(
        "select ultimo from numerador_ticket where empresa_id = $1 and sucursal_id = $2",
        [e.empresa, e.sucursal],
      )
    )[0]?.ultimo ?? 0;
  /** Todo lo que un cierre fallido no puede haber movido: ventas, caja, stock y auditoría. */
  const sinCambios = async (e: EscenarioDeVentas) => ({
    cuentas: await contar("cuenta_consumo", e.empresa),
    lineas: await contar("linea_cuenta", e.empresa),
    tickets: await contar("ticket", e.empresa),
    ejemplares: await contar("ticket_ejemplar", e.empresa),
    cobranzas: await contar("cobranza_de_ticket", e.empresa),
    movimientosDeCaja: await contar("movimiento_caja", e.empresa),
    movimientosDeStock: await contar("movimiento_de_stock", e.empresa),
    renglones: await contar("renglon_de_movimiento", e.empresa),
    auditoria: await contar("auditoria_empresa", e.empresa),
    ultimo: await numerador(e),
  });
  const cuentaEn = async (id: string) =>
    (await m.filas<{ estado: string }>("select estado from cuenta_consumo where id = $1", [id]))[0];
  const controla = async (lineaId: string) =>
    (
      await m.filas<{ c: boolean }>("select controla_stock as c from linea_cuenta where id = $1", [
        lineaId,
      ])
    )[0]?.c;
  const fijarNivel = (empresa: string, nivel: "PERMITIR" | "AVISAR" | "BLOQUEAR") =>
    m.dueno.query(
      `insert into nivel_de_control (empresa_id, sucursal_id, control, nivel) values ($1, null, 'stock.existencia_negativa', $2)
       on conflict on constraint nivel_de_control_uk do update set nivel = excluded.nivel`,
      [empresa, nivel],
    );

  // ---- cerrar la cuenta descuenta ------------------------------------------------------------------------------------------------

  it("cerrar la cuenta descuenta de verdad: una salida por ejemplar, con la jornada del TICKET, la acción de ventas, el depósito de venta y la línea marcada", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const a = await reventa(mundo, "10");
    const t = await vender(mundo, [{ producto: a.producto, cantidad: "2" }]);

    expect(await existencia(dep, a.articulo)).toBe("8.0000");
    const salidas = await delEjemplar(t.ejemplarId, "SALIDA");
    expect(salidas).toHaveLength(1);
    const salida = salidas[0] as (typeof salidas)[number];
    expect(salida).toMatchObject({
      clave_idempotencia: `venta_${t.ejemplarId}`,
      accion: "cuentas.cerrar",
      deposito_id: dep,
      fecha: t.fechaNegocio,
      registrado_por: e.gerente.personaId,
    });
    expect(salida.hecho_en.toISOString()).toBe(e.gerente.ahora.toISOString());
    expect(await renglonesDe(salida.id)).toEqual([
      { articulo_id: a.articulo, cantidad: "-2.0000" },
    ]);
    expect(await controla(t.lineas[0] as string)).toBe(true);
    // La auditoría de la salida y la del ticket quedan en la misma historia, una vez cada una.
    expect(await m.auditoria(e.empresa, "TICKET_EMITIDO")).toHaveLength(1);
  });

  it("solo descuenta lo que controla: una línea anulada no, un producto sin artículo ni receta no (la venta pasa, D140); una receta descuenta sus componentes", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const a = await reventa(mundo, "10");
    const anulada = await reventa(mundo, "10");
    const insumo = await articuloDeBase(m.dueno, e, { clase: "INSUMO" });
    valorDe(
      await stock.registrarEntrada(e.gerente, {
        clave: nuevoId(),
        depositoId: dep,
        motivo: "COMPRA",
        renglones: [{ productoId: insumo.producto, cantidad: "100", unidadId: "UNIDAD" }],
      }),
    );
    const conReceta = await m.productoVendible(e.empresa, "500");
    valorDe(
      await stock.guardarComposicion(e.gerente, {
        productoId: conReceta,
        versionEsperada: 0,
        rinde: "1",
        componentes: [{ productoId: insumo.producto, cantidad: "3", unidadId: "UNIDAD" }],
      }),
    );
    // `e.producto` es un vendible sin artículo ni receta.
    const { cuenta, lineas } = await cuentaCon(e, [
      { producto: a.producto, cantidad: "1" },
      { producto: anulada.producto, cantidad: "5" },
      { producto: e.producto, cantidad: "1" },
      { producto: conReceta, cantidad: "2" },
    ]);
    const marcas: (boolean | undefined)[] = [];
    for (const id of lineas) marcas.push(await controla(id));
    expect(marcas).toEqual([true, true, false, true]);
    valorDe(
      await m.casos.anularLinea(e.gerente, {
        cuentaId: cuenta,
        lineaId: lineas[1] as string,
        motivo: "Error",
      }),
    );
    const ejemplarId = nuevoId();
    valorDe(await cerrar(e.gerente, cuenta, ejemplarId));

    expect(await existencia(dep, a.articulo)).toBe("9.0000");
    expect(await existencia(dep, anulada.articulo)).toBe("10.0000");
    expect(await existencia(dep, insumo.articulo)).toBe("94.0000");
    const [salida] = await delEjemplar(ejemplarId, "SALIDA");
    expect(await renglonesDe((salida as { id: string }).id)).toHaveLength(2);
  });

  it("una venta sin ninguna línea que controle no toca el libro: sin depósito de venta también pasa, y anularla no devuelve nada", async () => {
    const e = await m.escenario(); // sin depósito de venta
    const t = valorDe(
      await cerrar(e.gerente, (await cuentaCon(e, [{ producto: e.producto }])).cuenta),
    );
    expect(await contar("movimiento_de_stock", e.empresa)).toBe(0);
    valorDe(await anular(e.gerente, t));
    expect(await contar("movimiento_de_stock", e.empresa)).toBe(0);
  });

  // ---- una sola salida ------------------------------------------------------------------------------------------------------------

  it("I5b: cerrar dos veces la misma cuenta deja un solo ticket y UNA sola salida de stock (con el mismo ejemplar o con otro)", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const a = await reventa(mundo, "10");
    const { cuenta } = await cuentaCon(e, [{ producto: a.producto, cantidad: "2" }]);
    const ejemplarId = nuevoId();
    const primera = valorDe(await cerrar(e.gerente, cuenta, ejemplarId));
    const repetida = valorDe(await cerrar(e.gerente, cuenta, ejemplarId));
    const otroEjemplar = valorDe(await cerrar(e.gerente, cuenta, nuevoId()));
    expect(primera.yaEstabaCerrada).toBe(false);
    expect(repetida).toMatchObject({ ticketId: primera.ticketId, yaEstabaCerrada: true });
    expect(otroEjemplar).toMatchObject({ ticketId: primera.ticketId, yaEstabaCerrada: true });
    expect(await contar("ticket", e.empresa)).toBe(1);
    expect(await delEjemplar(ejemplarId, "SALIDA")).toHaveLength(1);
    expect(await contar("movimiento_de_stock", e.empresa)).toBe(2); // la entrada y la salida
    expect(await existencia(dep, a.articulo)).toBe("8.0000");
  });

  it("dos clics a la vez sobre la misma cuenta: un ticket, una salida y la existencia baja una sola vez", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const a = await reventa(mundo, "10");
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { cuenta } = await cuentaCon(e, [{ producto: a.producto, cantidad: "1" }]);
      const ejemplarId = nuevoId();
      m.armarBarrera(2);
      try {
        const orden = ronda % 2 === 0 ? [0, 1] : [1, 0];
        const r = await Promise.all(
          orden.map(() => firme(() => cerrar(e.gerente, cuenta, ejemplarId))),
        );
        expect(r.every((x) => x.ok)).toBe(true);
      } finally {
        m.soltarBarrera();
      }
      expect(await delEjemplar(ejemplarId, "SALIDA")).toHaveLength(1);
    }
    expect(await contar("ticket", e.empresa)).toBe(RONDAS);
    expect(await existencia(dep, a.articulo)).toBe(`${10 - RONDAS}.0000`);
  });

  it("dos cierres a la vez de DOS cuentas que descuentan lo mismo: ninguna pisa a la otra y la existencia refleja las dos", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const a = await reventa(mundo, "10");
    const una = await cuentaCon(e, [{ producto: a.producto, cantidad: "3" }]);
    const otra = await cuentaCon(e, [{ producto: a.producto, cantidad: "4" }]);
    m.armarBarrera(2);
    try {
      const r = await Promise.all([
        firme(() => cerrar(e.gerente, una.cuenta)),
        firme(() => cerrar(e.gerente, otra.cuenta)),
      ]);
      expect(r.every((x) => x.ok)).toBe(true);
    } finally {
      m.soltarBarrera();
    }
    expect(await existencia(dep, a.articulo)).toBe("3.0000");
    expect(await contar("ticket", e.empresa)).toBe(2);
    expect(await numerador(e)).toBe(2);
  });

  // ---- anular devuelve ------------------------------------------------------------------------------------------------------------

  it("anular el ticket devuelve la salida entera, con la clave derivada, la acción de ventas y el número del ticket; anular de nuevo no devuelve dos veces", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const a = await reventa(mundo, "10");
    const t = await vender(mundo, [{ producto: a.producto, cantidad: "4" }]);
    expect(await existencia(dep, a.articulo)).toBe("6.0000");

    const clave = nuevaClave();
    const entrada = {
      claveIdempotencia: clave,
      ticketId: t.ticketId,
      ejemplarBaseId: t.ejemplarId,
      ejemplarNuevoId: nuevoId(),
      motivo: "¡Se equivocó el cajero!", // válido para ventas; el detalle de stock no admite el «!»: no viaja
    };
    const primera = valorDe(await m.casos.anularTicket(e.gerente, entrada));
    const repetida = valorDe(await m.casos.anularTicket(e.gerente, entrada));
    expect(primera.yaExistia).toBe(false);
    expect(repetida.yaExistia).toBe(true);
    // Con otra clave el ticket ya está anulado: error de ventas, y stock no se toca.
    expect(await anular(e.gerente, t)).toMatchObject({ ok: false });

    const anulaciones = await delEjemplar(t.ejemplarId, "ANULACION");
    expect(anulaciones).toHaveLength(1);
    const [salida] = await delEjemplar(t.ejemplarId, "SALIDA");
    expect(anulaciones[0]).toMatchObject({
      clave_idempotencia: `anulacion_venta_${t.ejemplarId}`,
      accion: "tickets.corregir",
      detalle: `Anulación del ticket ${t.numero}`,
      anula_a: (salida as { id: string }).id,
      deposito_id: dep,
    });
    expect(await existencia(dep, a.articulo)).toBe("10.0000");
  });

  it("anular en dos clics a la vez devuelve una sola vez", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const a = await reventa(mundo, "10");
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const t = await vender(mundo, [{ producto: a.producto, cantidad: "2" }]);
      const entrada = {
        claveIdempotencia: nuevaClave(),
        ticketId: t.ticketId,
        ejemplarBaseId: t.ejemplarId,
        ejemplarNuevoId: nuevoId(),
        motivo: "Error del cajero",
      };
      m.armarBarrera(2);
      try {
        const r = await Promise.all([
          firme(() => m.casos.anularTicket(e.gerente, entrada)),
          firme(() => m.casos.anularTicket(e.gerente, entrada)),
        ]);
        expect(r.every((x) => x.ok)).toBe(true);
      } finally {
        m.soltarBarrera();
      }
      expect(await delEjemplar(t.ejemplarId, "ANULACION")).toHaveLength(1);
    }
    expect(await existencia(dep, a.articulo)).toBe("10.0000");
  });

  it("anular no exige el módulo activo: con stock apagado se devuelve lo que ya se había descontado", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const a = await reventa(mundo, "10");
    const t = await vender(mundo, [{ producto: a.producto, cantidad: "3" }]);
    m.apagarStock();
    try {
      valorDe(await anular(e.gerente, t));
    } finally {
      m.encenderStock();
    }
    expect(await delEjemplar(t.ejemplarId, "ANULACION")).toHaveLength(1);
    expect(await existencia(dep, a.articulo)).toBe("10.0000");
  });

  // ---- una falla revierte todo ----------------------------------------------------------------------------------------------------

  it("sin depósito de venta (P-3) el cierre FALLA CERRADO: STOCK_SIN_DEPOSITO_DE_VENTA, ni número ni ticket ni salida, y con el depósito el reintento cierra", async () => {
    const e = await m.escenario();
    const a = await articuloDeBase(m.dueno, e, { clase: "REVENTA" });
    await m.precio({
      empresa: e.empresa,
      producto: a.producto,
      precio: "1000",
      desde: "2026-01-01T00:00:00Z",
    });
    const { cuenta } = await cuentaCon(e, [{ producto: a.producto }]);
    const antes = await sinCambios(e);

    expect(await cerrar(e.gerente, cuenta)).toEqual({
      ok: false,
      error: "STOCK_SIN_DEPOSITO_DE_VENTA",
    });
    expect(await sinCambios(e)).toEqual(antes);
    expect((await cuentaEn(cuenta))?.estado).toBe("ABIERTA");

    // Un depósito que NO es de venta no alcanza.
    await depositoDeBase(m.dueno, e, { deVenta: false });
    expect(await cerrar(e.gerente, cuenta)).toEqual({
      ok: false,
      error: "STOCK_SIN_DEPOSITO_DE_VENTA",
    });
    const dep = await depositoDeBase(m.dueno, e, { deVenta: true });
    valorDe(
      await stock.registrarEntrada(e.gerente, {
        clave: nuevoId(),
        depositoId: dep,
        motivo: "COMPRA",
        renglones: [{ productoId: a.producto, cantidad: "5", unidadId: "UNIDAD" }],
      }),
    );
    expect(valorDe(await cerrar(e.gerente, cuenta))).toMatchObject({ numero: 1 });
    expect(await existencia(dep, a.articulo)).toBe("4.0000");
  });

  it("con el control en BLOQUEAR una salida que deja la existencia en negativo frena TODO el cierre (CONTROL_BLOQUEA) y no queda ni ticket ni salida; en PERMITIR pasa", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const a = await reventa(mundo, "1");
    await fijarNivel(e.empresa, "BLOQUEAR");
    const { cuenta } = await cuentaCon(e, [{ producto: a.producto, cantidad: "2" }]);
    const antes = await sinCambios(e);

    const r = await cerrar(e.gerente, cuenta);
    expect(r).toMatchObject({
      ok: false,
      error: { error: "STOCK_FALLIDO", causa: { error: "CONTROL_BLOQUEA" } },
    });
    expect(await sinCambios(e)).toEqual(antes);
    expect(await existencia(dep, a.articulo)).toBe("1.0000");
    expect((await cuentaEn(cuenta))?.estado).toBe("ABIERTA");

    await fijarNivel(e.empresa, "PERMITIR");
    valorDe(await cerrar(e.gerente, cuenta));
    expect(await existencia(dep, a.articulo)).toBe("-1.0000");
  });

  it("con el control en AVISAR y sin confirmación el cierre también frena (CONTROL_REQUIERE_CONFIRMACION): ventas no manda la confirmación de stock", async () => {
    const mundo = await mundoNuevo();
    const { e } = mundo;
    const a = await reventa(mundo, "1");
    await fijarNivel(e.empresa, "AVISAR");
    const { cuenta } = await cuentaCon(e, [{ producto: a.producto, cantidad: "2" }]);
    const antes = await sinCambios(e);
    expect(await cerrar(e.gerente, cuenta)).toMatchObject({
      ok: false,
      error: { error: "STOCK_FALLIDO", causa: { error: "CONTROL_REQUIERE_CONFIRMACION" } },
    });
    expect(await sinCambios(e)).toEqual(antes);
  });

  it("una falla en el MEDIO del cierre, después de que stock escribió, deja todo como estaba: ni número, ni ticket, ni salida; el reintento cierra", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const a = await reventa(mundo, "10");
    const { cuenta } = await cuentaCon(e, [{ producto: a.producto, cantidad: "2" }]);
    const antes = await sinCambios(e);
    fallaAlAuditar = "CUENTA_CERRADA";
    try {
      await expect(cerrar(e.gerente, cuenta)).rejects.toThrow(/falla inyectada/);
    } finally {
      fallaAlAuditar = null;
    }
    expect(await sinCambios(e)).toEqual(antes);
    expect(await existencia(dep, a.articulo)).toBe("10.0000");
    valorDe(await cerrar(e.gerente, cuenta));
    expect(await existencia(dep, a.articulo)).toBe("8.0000");
  });

  it("una falla al anular, después de que stock devolvió, deja el ticket sin anular y la salida sin devolver", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const a = await reventa(mundo, "10");
    const t = await vender(mundo, [{ producto: a.producto, cantidad: "2" }]);
    const antes = await sinCambios(e);
    fallaAlAuditar = "TICKET_ANULADO";
    try {
      await expect(anular(e.gerente, t)).rejects.toThrow(/falla inyectada/);
    } finally {
      fallaAlAuditar = null;
    }
    expect(await sinCambios(e)).toEqual(antes);
    expect(await delEjemplar(t.ejemplarId, "ANULACION")).toHaveLength(0);
    expect(await existencia(dep, a.articulo)).toBe("8.0000");
  });

  // ---- stock apagado --------------------------------------------------------------------------------------------------------------

  it("con stock apagado ventas no cambia: ninguna línea controla, no se mira el depósito, no se escribe nada en el libro", async () => {
    const e = await m.escenario(); // ni siquiera tiene depósito de venta
    const a = await articuloDeBase(m.dueno, e, { clase: "REVENTA" });
    await m.precio({
      empresa: e.empresa,
      producto: a.producto,
      precio: "1000",
      desde: "2026-01-01T00:00:00Z",
    });
    m.apagarStock();
    try {
      const { cuenta, lineas } = await cuentaCon(e, [{ producto: a.producto, cantidad: "2" }]);
      expect(await controla(lineas[0] as string)).toBe(false);
      const t = valorDe(await cerrar(e.gerente, cuenta));
      expect(t).toMatchObject({ numero: 1, estado: "EMITIDO" });
      valorDe(await anular(e.gerente, t));
    } finally {
      m.encenderStock();
    }
    expect(await contar("movimiento_de_stock", e.empresa)).toBe(0);
  });

  it("si el módulo se apagó con la cuenta abierta, el cierre no llama a stock (aunque la línea quedó marcada) y no exige depósito", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const a = await reventa(mundo, "10");
    const { cuenta, lineas } = await cuentaCon(e, [{ producto: a.producto, cantidad: "2" }]);
    expect(await controla(lineas[0] as string)).toBe(true);
    m.apagarStock();
    try {
      valorDe(await cerrar(e.gerente, cuenta));
    } finally {
      m.encenderStock();
    }
    expect(await existencia(dep, a.articulo)).toBe("10.0000");
    expect(await contar("movimiento_de_stock", e.empresa)).toBe(1); // solo la entrada
  });

  // ---- el mostrador (venderYCobrar) -----------------------------------------------------------------------------------------------

  const pedidoDeMostrador = (
    e: EscenarioDeVentas,
    caja: Awaited<ReturnType<MundoDeVentas["cajaAbierta"]>>,
    producto: string,
    cantidad: string,
    total: string,
    sucursal = e.sucursal,
  ) => ({
    claveIdempotencia: nuevaClave(),
    cuentaId: nuevoId(),
    ejemplarId: nuevoId(),
    sucursalId: sucursal,
    lineas: [{ lineaId: nuevoId(), productoId: producto, opcionIds: [], cantidad }],
    totalEsperado: monto(total),
    cobro: {
      cajaId: caja.cajaId,
      cobros: [
        {
          medioDePagoId: caja.medios["EFECTIVO"] as string,
          cuentaDeCobroId: null,
          importe: monto(total),
        },
      ],
    },
  });

  it("venderYCobrar descuenta con la jornada de la sesión de caja y repetirlo (o hacer dos clics a la vez) deja una sola salida", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const a = await reventa(mundo, "10");
    const caja = await m.cajaAbierta(e);
    const pedido = pedidoDeMostrador(e, caja, a.producto, "2", "2000.00");
    const primera = valorDe(await m.casos.venderYCobrar(e.gerente, pedido));
    expect(primera).toMatchObject({ estado: "COBRADO", yaExistia: false });
    const repetida = valorDe(await m.casos.venderYCobrar(e.gerente, pedido));
    expect(repetida).toMatchObject({ ticketId: primera.ticketId, yaExistia: true });
    const [salida] = await delEjemplar(pedido.ejemplarId, "SALIDA");
    expect(salida).toMatchObject({ fecha: caja.fechaDeNegocio, accion: "cuentas.cerrar" });
    expect(await existencia(dep, a.articulo)).toBe("8.0000");

    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const otro = pedidoDeMostrador(e, caja, a.producto, "1", "1000.00");
      m.armarBarrera(2);
      try {
        const r = await Promise.all([
          firme(() => m.casos.venderYCobrar(e.gerente, otro)),
          firme(() => m.casos.venderYCobrar(e.gerente, otro)),
        ]);
        expect(r.every((x) => x.ok)).toBe(true);
      } finally {
        m.soltarBarrera();
      }
      expect(await delEjemplar(otro.ejemplarId, "SALIDA")).toHaveLength(1);
    }
    expect(await existencia(dep, a.articulo)).toBe(`${8 - RONDAS}.0000`);
  });

  it("venderYCobrar sin depósito de venta falla cerrado y no deja cuenta, ticket, cobro ni salida", async () => {
    const e = await m.escenario();
    const a = await articuloDeBase(m.dueno, e, { clase: "REVENTA" });
    await m.precio({
      empresa: e.empresa,
      producto: a.producto,
      precio: "1000",
      desde: "2026-01-01T00:00:00Z",
    });
    const caja = await m.cajaAbierta(e);
    const antes = await sinCambios(e);
    const r = await m.casos.venderYCobrar(
      e.gerente,
      pedidoDeMostrador(e, caja, a.producto, "1", "1000.00"),
    );
    expect(r).toEqual({ ok: false, error: "STOCK_SIN_DEPOSITO_DE_VENTA" });
    expect(await sinCambios(e)).toEqual(antes);
  });

  it("venderYCobrar con una existencia que el control bloquea no cobra: ni cuenta, ni ticket, ni movimiento de caja, ni salida", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const a = await reventa(mundo, "1");
    await fijarNivel(e.empresa, "BLOQUEAR");
    const caja = await m.cajaAbierta(e);
    const antes = await sinCambios(e);
    const r = await m.casos.venderYCobrar(
      e.gerente,
      pedidoDeMostrador(e, caja, a.producto, "2", "2000.00"),
    );
    expect(r).toMatchObject({
      ok: false,
      error: { error: "STOCK_FALLIDO", causa: { error: "CONTROL_BLOQUEA" } },
    });
    expect(await sinCambios(e)).toEqual(antes);
    expect(await existencia(dep, a.articulo)).toBe("1.0000");
  });

  // ---- aislamiento ----------------------------------------------------------------------------------------------------------------

  it("las empresas no se tocan: dos empresas venden a la vez y cada una descuenta de SU depósito y SU libro", async () => {
    const a = await mundoNuevo();
    const b = await mundoNuevo();
    const deA = await reventa(a, "10");
    const deB = await reventa(b, "10");
    const una = await cuentaCon(a.e, [{ producto: deA.producto, cantidad: "3" }]);
    const otra = await cuentaCon(b.e, [{ producto: deB.producto, cantidad: "5" }]);
    m.armarBarrera(2);
    try {
      const r = await Promise.all([
        firme(() => cerrar(a.e.gerente, una.cuenta)),
        firme(() => cerrar(b.e.gerente, otra.cuenta)),
      ]);
      expect(r.every((x) => x.ok)).toBe(true);
    } finally {
      m.soltarBarrera();
    }
    expect(await existencia(a.dep, deA.articulo)).toBe("7.0000");
    expect(await existencia(b.dep, deB.articulo)).toBe("5.0000");
    expect(
      await m.filas(
        `select distinct empresa_id from movimiento_de_stock where deposito_id = $1 and clase = 'SALIDA'`,
        [a.dep],
      ),
    ).toEqual([{ empresa_id: a.e.empresa }]);
    // La empresa B no puede descontar del depósito de A: el depósito de venta lo busca ventas en SU empresa y sucursal.
    expect(await contar("movimiento_de_stock", b.e.empresa)).toBe(2);
    expect(await contar("movimiento_de_stock", a.e.empresa)).toBe(2);
  });

  it("una sucursal descuenta de SU depósito de venta, no del de la otra de la misma empresa", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const depNorte = await depositoDeBase(
      m.dueno,
      { empresa: e.empresa, sucursal: e.otraSucursal },
      {
        deVenta: true,
      },
    );
    const a = await reventa(mundo, "10");
    valorDe(
      await stock.registrarEntrada(e.gerente, {
        clave: nuevoId(),
        depositoId: depNorte,
        motivo: "COMPRA",
        renglones: [{ productoId: a.producto, cantidad: "10", unidadId: "UNIDAD" }],
      }),
    );
    const { cuenta } = await cuentaCon(
      e,
      [{ producto: a.producto, cantidad: "2" }],
      e.gerente,
      e.otraSucursal,
    );
    valorDe(await cerrar(e.gerente, cuenta));
    expect(await existencia(depNorte, a.articulo)).toBe("8.0000");
    expect(await existencia(dep, a.articulo)).toBe("10.0000");
  });

  // ---- el sellado de la variante --------------------------------------------------------------------------------------------------

  /**
   * Un producto de reventa con artículo propio, un tamaño chico (factor 1) y uno grande (factor 1,5, $3000) y un adicional que consume 100 de un
   * insumo y ESCALA con el tamaño; devuelve lo que hace falta para vender y para cambiar el factor del grande después.
   */
  const conTamanos = async ({ e, dep }: Mundo) => {
    const a = await articuloDeBase(m.dueno, e, { clase: "REVENTA" });
    const insumo = await articuloDeBase(m.dueno, e, { clase: "INSUMO" });
    for (const [articulo, cantidad] of [
      [a, "100"],
      [insumo, "1000"],
    ] as const) {
      valorDe(
        await stock.registrarEntrada(e.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "COMPRA",
          renglones: [{ productoId: articulo.producto, cantidad, unidadId: "UNIDAD" }],
        }),
      );
    }
    await m.dueno.query("begin");
    let grande: { opcion: string; version: string };
    let queso: { opcion: string; version: string };
    try {
      const tamano = await grupoDeBase(m.dueno, e.empresa, a.producto, {
        clase: "VARIANTE",
        esTamano: true,
        nombre: "Tamano",
      });
      await opcionDeBase(m.dueno, e.empresa, a.producto, tamano, { nombre: "Chico", factor: "1" });
      grande = await opcionDeBase(m.dueno, e.empresa, a.producto, tamano, {
        nombre: "Grande",
        factor: "1.5",
      });
      const extras = await grupoDeBase(m.dueno, e.empresa, a.producto, {
        clase: "ADICIONAL",
        nombre: "Extras",
      });
      queso = await opcionDeBase(m.dueno, e.empresa, a.producto, extras, { nombre: "Queso" });
      await m.dueno.query(
        "insert into consumo_de_opcion (empresa_id, version_de_opcion_id, numero, insumo_id, cantidad, escala_con_tamano) values ($1, $2, 1, $3, '100', true)",
        [e.empresa, queso.version, insumo.producto],
      );
      await m.dueno.query("commit");
    } catch (error) {
      await m.dueno.query("rollback");
      throw error;
    }
    await m.precio({
      empresa: e.empresa,
      producto: a.producto,
      opcion: grande.opcion,
      precio: "3000",
      desde: "2026-01-01T00:00:00Z",
    });
    /** Sube el factor del tamaño grande: una versión NUEVA (lo ya vendido no se reescribe), la vigente de ahora en más. */
    const cambiarFactorDelGrande = async (numero: number, factor: string) => {
      const version = nuevoId();
      await m.dueno.query(
        `insert into version_de_opcion (id, empresa_id, opcion_id, numero, nombre, recargo, factor_de_tamano, creado_en)
         values ($1, $2, $3, $4, 'Grande', 0, $5, now())`,
        [version, e.empresa, grande.opcion, numero, factor],
      );
      return version;
    };
    return { a, insumo, grande, queso, cambiarFactorDelGrande };
  };

  it("la línea sella la versión del tamaño que se vendió: el consumo usa ESE factor aunque después cambie el vigente, y la venta siguiente usa el nuevo", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const t = await conTamanos(mundo);
    const venta = (cantidad: string) =>
      cuentaCon(e, [
        {
          producto: t.a.producto,
          cantidad,
          extra: { varianteId: t.grande.opcion, opcionIds: [t.queso.opcion] },
        },
      ]);

    // Se agrega la línea con el factor 1,5 vigente y se la deja ABIERTA: el catálogo cambia ANTES de cerrar.
    const abierta = await venta("2");
    const linea = (
      await m.filas<{ v: string | null; vn: string | null }>(
        "select variante_version_de_opcion_id as v, variante_nombre as vn from linea_cuenta where id = $1",
        [abierta.lineas[0]],
      )
    )[0];
    expect(linea).toEqual({ v: t.grande.version, vn: "Grande" });
    const nueva = await t.cambiarFactorDelGrande(2, "2");
    expect(nueva).not.toBe(t.grande.version);
    const ejemplarId = nuevoId();
    valorDe(await cerrar(e.gerente, abierta.cuenta, ejemplarId));

    // queso: 100 × 2 × 1,5 (el factor SELLADO) = 300; con el factor de hoy (2) serían 400. El artículo propio: 2.
    expect(await existencia(dep, t.insumo.articulo)).toBe("700.0000");
    expect(await existencia(dep, t.a.articulo)).toBe("98.0000");
    const [salida] = await delEjemplar(ejemplarId, "SALIDA");
    expect(await renglonesDe((salida as { id: string }).id)).toEqual(
      expect.arrayContaining([{ articulo_id: t.insumo.articulo, cantidad: "-300.0000" }]),
    );

    // Una venta NUEVA sella la versión de hoy (factor 2): 100 × 1 × 2 = 200.
    const otra = await venta("1");
    expect(
      (
        await m.filas<{ v: string }>(
          "select variante_version_de_opcion_id as v from linea_cuenta where id = $1",
          [otra.lineas[0]],
        )
      )[0]?.v,
    ).toBe(nueva);
    valorDe(await cerrar(e.gerente, otra.cuenta));
    expect(await existencia(dep, t.insumo.articulo)).toBe("500.0000");
  });

  it("una línea sin variante no sella versión", async () => {
    const mundo = await mundoNuevo();
    const a = await reventa(mundo, "10");
    const { lineas } = await cuentaCon(mundo.e, [{ producto: a.producto }]);
    expect(
      (
        await m.filas<{ v: string | null }>(
          "select variante_version_de_opcion_id as v from linea_cuenta where id = $1",
          [lineas[0]],
        )
      )[0]?.v,
    ).toBeNull();
  });
});
