import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { codigoDe } from "./concurrencia-apoyo";
import { cuitUnico } from "./entorno";

/**
 * Compras N3 (tramo N3-4): la factura del proveedor llega SOLA y se concilia con lo recibido. Cargar la factura con el producto de cada línea, la propuesta de un toque,
 * conciliar (idempotente y todo o nada), el tope «no más de lo recibido ni de lo facturado» bajo concurrencia, anular la conciliación con su espejo, permisos y aislamiento.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras N3: factura sola y conciliación", () => {
  let c: MontajeDeCompras;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    c.encenderPerilla("recepcion_separada");
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const codigo = (r: Parameters<typeof codigoDe>[0]): string =>
    !r.ok && typeof r.error === "object" && r.error !== null && "error" in r.error
      ? String(r.error.error)
      : codigoDe(r);

  /** Una empresa en N3 con su depósito, dos productos en gramos y un proveedor con el punto de venta 5. */
  const armar = async () => {
    const e: EscenarioDeCompras = await c.escenario();
    valorDe(
      await c.casos.configurarCompras(e.gerente, {
        nivel: "RECEPCION_SEPARADA",
        versionEsperada: 1,
      }),
    );
    const deposito = await c.deposito(e);
    const harina = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const azucar = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    return { e, deposito, harina, azucar, proveedor, cuit: cuitUnico() };
  };
  type M = Awaited<ReturnType<typeof armar>>;

  /** Recibe y CONFIRMA una recepción de un solo renglón (kilos del producto); devuelve su id. */
  const recibir = async (m: M, producto: string, kilos: string, controles: unknown[] = []) => {
    const r = valorDe(
      await c.casos.registrarRecepcion(m.e.operador, {
        clave: nuevoId(),
        sucursalId: m.e.sucursal,
        proveedorId: m.proveedor,
        renglones: [
          {
            productoId: producto,
            unidadDeCompraId: "KILOGRAMO",
            cantidad: kilos,
            precioPor: "UNIDAD",
            unidadDePrecioId: "KILOGRAMO",
            precio: "1000",
          },
        ],
        controles,
      }),
    );
    valorDe(
      await c.casos.confirmarRecepcion(m.e.gerente, {
        recepcionId: r.recepcionId,
        depositoId: m.deposito,
      }),
    );
    return r.recepcionId;
  };
  const pedidoDeFactura = (
    m: M,
    lineas: readonly Record<string, unknown>[],
    extra: Record<string, unknown> = {},
    clave = nuevoId(),
  ) => ({
    clave,
    proveedorId: m.proveedor,
    factura: {
      tipo: "FACTURA_A",
      puntoDeVenta: 5,
      numero: Math.floor(Math.random() * 90_000_000) + 1,
      fecha: "2026-10-10",
      lineas,
      totalSegunFactura: "0.00",
      cuitDelProveedor: m.cuit,
      ...extra,
    },
  });
  const linea = (producto: string, gramos: string) => ({
    productoId: producto,
    cantidadFacturada: gramos,
    precioNeto: "1",
    alicuota: "21",
  });
  /** El total impreso que coincide con lo calculado (neto + 21 %), para no recibir el aviso. */
  const totalDe = (gramos: number) => (gramos * 1.21).toFixed(2);
  const cargarFactura = async (m: M, lineas: readonly Record<string, unknown>[], gramos: number) =>
    valorDe(
      await c.casos.registrarFactura(
        m.e.operador,
        pedidoDeFactura(m, lineas, { totalSegunFactura: totalDe(gramos) }),
      ),
    );
  const asignadaDeLaRecepcion = async (recepcionId: string) =>
    (
      await c.filas<{ a: string }>(
        "select cantidad_asignada::text as a from saldo_de_linea_de_recepcion where recepcion_id = $1 and numero = 1",
        [recepcionId],
      )
    )[0]?.a;
  const asignadaDeLaFactura = async (comprobanteId: string) =>
    (
      await c.filas<{ a: string }>(
        "select cantidad_asignada::text as a from saldo_de_linea_de_comprobante where comprobante_id = $1 and numero = 1",
        [comprobanteId],
      )
    )[0]?.a;
  const conciliaciones = (comprobanteId: string) =>
    c.contar("select count(*) as n from conciliacion where comprobante_id = $1", [comprobanteId]);

  it("la factura llega sola: comprobante con el producto de cada línea, sin recepción ni conciliación ni stock; audita", async () => {
    const m = await armar();
    const r = await cargarFactura(m, [linea(m.harina.producto, "2000")], 2000);
    expect(r).toMatchObject({ yaExistia: false, avisos: [] });
    const [comprobante] = await c.filas<Record<string, unknown>>(
      "select nivel, es_atajo, estado, registrado_por from comprobante_de_proveedor where id = $1",
      [r.comprobanteId],
    );
    expect(comprobante).toEqual({
      nivel: "RECEPCION_SEPARADA",
      es_atajo: false,
      estado: "REGISTRADO",
      registrado_por: m.e.operador.personaId,
    });
    const [l] = await c.filas<Record<string, unknown>>(
      "select producto_id, recepcion_id, linea_de_recepcion, unidad, cantidad_facturada::text as cantidad from linea_de_comprobante where comprobante_id = $1",
      [r.comprobanteId],
    );
    expect(l).toEqual({
      producto_id: m.harina.producto,
      recepcion_id: null,
      linea_de_recepcion: null,
      unidad: "GRAMO",
      cantidad: "2000.0000",
    });
    expect(await conciliaciones(r.comprobanteId)).toBe(0);
    expect(await c.existencia(m.deposito, m.harina.articulo)).toBe("0");
    expect((await c.auditoria(m.e.empresa, "FACTURA_REGISTRADA")).at(-1)).toMatchObject({
      actor_persona_id: m.e.operador.personaId,
      entidad_id: r.comprobanteId,
    });
  });

  it("I1: la misma factura dos veces (misma clave) deja un solo comprobante y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA; la misma factura con otra clave, COMPROBANTE_YA_REGISTRADO", async () => {
    const m = await armar();
    const pedido = pedidoDeFactura(m, [linea(m.harina.producto, "1000")], {
      totalSegunFactura: totalDe(1000),
    });
    const primera = valorDe(await c.casos.registrarFactura(m.e.operador, pedido));
    const auditadas = (await c.auditoria(m.e.empresa, "FACTURA_REGISTRADA")).length;
    expect(valorDe(await c.casos.registrarFactura(m.e.operador, pedido))).toMatchObject({
      comprobanteId: primera.comprobanteId,
      yaExistia: true,
    });
    expect((await c.auditoria(m.e.empresa, "FACTURA_REGISTRADA")).length).toBe(auditadas);
    const otra = await c.casos.registrarFactura(m.e.operador, {
      ...pedido,
      factura: { ...pedido.factura, lineas: [linea(m.azucar.producto, "1000")] },
    });
    expect(codigo(otra)).toBe("CLAVE_REUTILIZADA");
    expect(await c.casos.registrarFactura(m.e.operador, { ...pedido, clave: nuevoId() })).toEqual({
      ok: false,
      error: { error: "COMPROBANTE_YA_REGISTRADO", comprobanteId: primera.comprobanteId },
    });
    expect(
      await c.contar("select count(*) as n from comprobante_de_proveedor where proveedor_id = $1", [
        m.proveedor,
      ]),
    ).toBe(1);
  });

  it("la factura exige N3 o N4 y la perilla, un producto por línea, y un producto de otra empresa no existe", async () => {
    const n1 = await c.escenario();
    const proveedor = await c.proveedor(n1.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    const x = await c.articulo(n1, { unidadBase: "GRAMO", dimension: "MASA" });
    const enN1 = await c.casos.registrarFactura(n1.operador, {
      clave: nuevoId(),
      proveedorId: proveedor,
      factura: pedidoDeFactura({ proveedor, cuit: cuitUnico() } as M, [linea(x.producto, "10")])
        .factura,
    });
    expect(codigo(enN1)).toBe("RECEPCION_SEPARADA_NO_CORRESPONDE_AL_NIVEL");
    const m = await armar();
    const ajeno = await armar();
    const sinProducto = await c.casos.registrarFactura(
      m.e.operador,
      pedidoDeFactura(m, [{ cantidadFacturada: "10", precioNeto: "1", alicuota: "21" }]),
    );
    expect(codigo(sinProducto)).toBe("PRODUCTO_NO_ENCONTRADO");
    const deOtra = await c.casos.registrarFactura(
      m.e.operador,
      pedidoDeFactura(m, [linea(ajeno.harina.producto, "10")]),
    );
    expect(codigo(deOtra)).toBe("PRODUCTO_NO_ENCONTRADO");
    c.apagarPerillas();
    try {
      expect(
        await c.casos.registrarFactura(
          m.e.operador,
          pedidoDeFactura(m, [linea(m.harina.producto, "10")]),
        ),
      ).toEqual({
        ok: false,
        error: { error: "FUNCION_NO_INCLUIDA", perilla: "recepcion_separada" },
      });
    } finally {
      c.encenderPerilla("recepcion_separada");
    }
  });

  it("la propuesta de un toque: por producto y en el orden en que se recibió; no propone lo rechazado, lo de otro producto ni lo ya asignado; no escribe", async () => {
    const m = await armar();
    const primera = await recibir(m, m.harina.producto, "2");
    const segunda = await recibir(m, m.harina.producto, "1");
    await recibir(m, m.azucar.producto, "5");
    // una línea rechazada no se propone (hay un depósito de rechazo para que la confirmación pase)
    await c.deposito(m.e, { uso: "RECHAZO" });
    await recibir(m, m.harina.producto, "4", [
      { linea: 1, condicion: "RECHAZADA", observacion: "Vencida" },
    ]);
    const f = await cargarFactura(m, [linea(m.harina.producto, "2500")], 2500);
    const propuesta = valorDe(
      await c.consultas.proponerConciliacion(m.e.gerente, { comprobanteId: f.comprobanteId }),
    );
    expect(propuesta?.asignaciones).toEqual([
      { lineaDeFactura: 1, recepcionId: primera, lineaDeRecepcion: 1, cantidad: "2000.0000" },
      { lineaDeFactura: 1, recepcionId: segunda, lineaDeRecepcion: 1, cantidad: "500.0000" },
    ]);
    expect(await conciliaciones(f.comprobanteId)).toBe(0);
    // el operador no ve la propuesta; una factura que no existe o de otra empresa es null
    expect(
      await c.consultas.proponerConciliacion(m.e.operador, { comprobanteId: f.comprobanteId }),
    ).toMatchObject({ ok: false });
    const otra = await armar();
    expect(
      valorDe(
        await c.consultas.proponerConciliacion(otra.e.gerente, { comprobanteId: f.comprobanteId }),
      ),
    ).toBeNull();
    expect(
      valorDe(await c.consultas.proponerConciliacion(m.e.gerente, { comprobanteId: nuevoId() })),
    ).toBeNull();
  });

  it("I2: la misma conciliación dos veces (misma clave) deja una sola y devuelve yaExistia; con otras asignaciones, CLAVE_REUTILIZADA", async () => {
    const m = await armar();
    const r1 = await recibir(m, m.harina.producto, "2");
    const r2 = await recibir(m, m.harina.producto, "1");
    const f = await cargarFactura(m, [linea(m.harina.producto, "2500")], 2500);
    const propuesta = valorDe(
      await c.consultas.proponerConciliacion(m.e.gerente, { comprobanteId: f.comprobanteId }),
    );
    const pedido = {
      clave: nuevoId(),
      comprobanteId: f.comprobanteId,
      asignaciones: propuesta?.asignaciones,
    };
    const primera = valorDe(await c.casos.conciliarFactura(m.e.administrador, pedido));
    expect(primera.yaExistia).toBe(false);
    expect(await asignadaDeLaRecepcion(r1)).toBe("2000.0000");
    expect(await asignadaDeLaRecepcion(r2)).toBe("500.0000");
    expect(await asignadaDeLaFactura(f.comprobanteId)).toBe("2500.0000");
    const auditadas = (await c.auditoria(m.e.empresa, "CONCILIACION_REGISTRADA")).length;
    expect(valorDe(await c.casos.conciliarFactura(m.e.gerente, pedido))).toEqual({
      conciliacionId: primera.conciliacionId,
      yaExistia: true,
    });
    expect((await c.auditoria(m.e.empresa, "CONCILIACION_REGISTRADA")).length).toBe(auditadas);
    expect(await asignadaDeLaFactura(f.comprobanteId)).toBe("2500.0000");
    const otras = await c.casos.conciliarFactura(m.e.gerente, {
      ...pedido,
      asignaciones: [
        { lineaDeFactura: 1, recepcionId: r1, lineaDeRecepcion: 1, cantidad: "1.0000" },
      ],
    });
    expect(codigo(otras)).toBe("CLAVE_REUTILIZADA");
    // el saldo de lo facturado y de lo recibido ya está agotado: una conciliación más excede
    const demas = await c.casos.conciliarFactura(m.e.gerente, {
      clave: nuevoId(),
      comprobanteId: f.comprobanteId,
      asignaciones: [
        { lineaDeFactura: 1, recepcionId: r2, lineaDeRecepcion: 1, cantidad: "600.0000" },
      ],
    });
    expect([
      "CANTIDAD_ASIGNADA_EXCEDE_LO_FACTURADO",
      "CANTIDAD_ASIGNADA_EXCEDE_LO_RECIBIDO",
    ]).toContain(codigo(demas));
    expect(await conciliaciones(f.comprobanteId)).toBe(1);
  });

  it("lo que no se puede conciliar se rechaza entero: otro producto, una línea rechazada, una recepción pendiente, más de lo recibido; un operador no concilia", async () => {
    const m = await armar();
    const buena = await recibir(m, m.harina.producto, "2");
    const deAzucar = await recibir(m, m.azucar.producto, "2");
    await c.deposito(m.e, { uso: "RECHAZO" });
    const rechazada = await recibir(m, m.harina.producto, "1", [
      { linea: 1, condicion: "RECHAZADA", observacion: "Vencida" },
    ]);
    const pendiente = valorDe(
      await c.casos.registrarRecepcion(m.e.operador, {
        clave: nuevoId(),
        sucursalId: m.e.sucursal,
        proveedorId: m.proveedor,
        renglones: [
          {
            productoId: m.harina.producto,
            unidadDeCompraId: "KILOGRAMO",
            cantidad: "1",
            precioPor: "UNIDAD",
            unidadDePrecioId: "KILOGRAMO",
            precio: "1000",
          },
        ],
      }),
    ).recepcionId;
    const f = await cargarFactura(m, [linea(m.harina.producto, "3000")], 3000);
    const conciliar = (asignaciones: unknown, quien = m.e.gerente) =>
      c.casos.conciliarFactura(quien, {
        clave: nuevoId(),
        comprobanteId: f.comprobanteId,
        asignaciones,
      });
    const una = (recepcionId: string, cantidad = "100", lineaDeFactura = 1) => [
      { lineaDeFactura, recepcionId, lineaDeRecepcion: 1, cantidad },
    ];
    expect(codigo(await conciliar(una(deAzucar)))).toBe("ASIGNACION_DE_OTRO_PRODUCTO");
    expect(codigo(await conciliar(una(rechazada)))).toBe("ASIGNACION_NO_CONCILIABLE");
    expect(codigo(await conciliar(una(pendiente)))).toBe("ASIGNACION_NO_CONCILIABLE");
    expect(codigo(await conciliar(una(nuevoId())))).toBe("ASIGNACION_NO_CONCILIABLE");
    expect(codigo(await conciliar(una(buena, "100", 2)))).toBe("LINEA_NO_ENCONTRADA");
    expect(codigo(await conciliar(una(buena, "2000.0001")))).toBe(
      "CANTIDAD_ASIGNADA_EXCEDE_LO_RECIBIDO",
    );
    expect(codigo(await conciliar([]))).toBe("ASIGNACIONES_INVALIDAS");
    expect(codigo(await conciliar([{ ...una(buena)[0], cantidad: "0" }]))).toBe(
      "ASIGNACIONES_INVALIDAS",
    );
    expect(await conciliar(una(buena), m.e.operador)).toMatchObject({
      ok: false,
      error: "SIN_PERMISO",
    });
    // todo o nada: la primera asignación es buena y la segunda excede: no queda ninguna
    const mezcla = [
      ...una(buena, "1000"),
      { lineaDeFactura: 1, recepcionId: buena, lineaDeRecepcion: 1, cantidad: "1500" },
    ];
    expect(["ASIGNACIONES_INVALIDAS", "CANTIDAD_ASIGNADA_EXCEDE_LO_RECIBIDO"]).toContain(
      codigo(await conciliar(mezcla)),
    );
    expect(await conciliaciones(f.comprobanteId)).toBe(0);
    expect(await asignadaDeLaRecepcion(buena)).toBe("0.0000");
    expect(await asignadaDeLaFactura(f.comprobanteId)).toBe("0.0000");
  });

  it("C1: dos conciliaciones a la vez sobre la misma línea recibida (de facturas distintas): gana una y la otra excede lo recibido; lo asignado nunca supera lo recibido", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const recibida = await recibir(m, m.harina.producto, "2");
      const f1 = await cargarFactura(m, [linea(m.harina.producto, "2000")], 2000);
      const f2 = await cargarFactura(m, [linea(m.harina.producto, "2000")], 2000);
      const todo = (recepcionId: string) => [
        { lineaDeFactura: 1, recepcionId, lineaDeRecepcion: 1, cantidad: "2000" },
      ];
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([
          c.casos.conciliarFactura(m.e.gerente, {
            clave: nuevoId(),
            comprobanteId: f1.comprobanteId,
            asignaciones: todo(recibida),
          }),
          c.casos.conciliarFactura(m.e.administrador, {
            clave: nuevoId(),
            comprobanteId: f2.comprobanteId,
            asignaciones: todo(recibida),
          }),
        ]);
      } finally {
        c.soltarBarrera();
      }
      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      const perdedora = resultados.find((r) => !r.ok);
      expect(perdedora && codigo(perdedora)).toBe("CANTIDAD_ASIGNADA_EXCEDE_LO_RECIBIDO");
      expect(await asignadaDeLaRecepcion(recibida)).toBe("2000.0000");
    }
  });

  it("C2: la misma conciliación a la vez (misma clave): una sola; el espejo de una anulación a la vez: uno solo", async () => {
    const m = await armar();
    const recibida = await recibir(m, m.harina.producto, "2");
    const f = await cargarFactura(m, [linea(m.harina.producto, "2000")], 2000);
    const pedido = {
      clave: nuevoId(),
      comprobanteId: f.comprobanteId,
      asignaciones: [
        { lineaDeFactura: 1, recepcionId: recibida, lineaDeRecepcion: 1, cantidad: "2000" },
      ],
    };
    c.armarBarrera(2);
    let rs;
    try {
      rs = await Promise.all([
        c.casos.conciliarFactura(m.e.gerente, pedido),
        c.casos.conciliarFactura(m.e.administrador, pedido),
      ]);
    } finally {
      c.soltarBarrera();
    }
    for (const r of rs) expect(r.ok || codigo(r) === "ConcurrenciaAgotada").toBe(true);
    expect(await conciliaciones(f.comprobanteId)).toBe(1);
    expect(await asignadaDeLaRecepcion(recibida)).toBe("2000.0000");
    const id = valorDe(await c.casos.conciliarFactura(m.e.gerente, pedido)).conciliacionId;
    c.armarBarrera(2);
    let anulaciones;
    try {
      anulaciones = await Promise.all([
        c.casos.anularConciliacion(m.e.gerente, { conciliacionId: id }),
        c.casos.anularConciliacion(m.e.administrador, { conciliacionId: id }),
      ]);
    } finally {
      c.soltarBarrera();
    }
    expect(anulaciones.filter((r) => r.ok)).toHaveLength(1);
    expect(await conciliaciones(f.comprobanteId)).toBe(2);
    expect(await asignadaDeLaRecepcion(recibida)).toBe("0.0000");
  });

  it("I3: anular dos veces una conciliación deja un solo espejo y la segunda es CONCILIACION_YA_ANULADA; las líneas recuperan su saldo", async () => {
    const m = await armar();
    const recibida = await recibir(m, m.harina.producto, "2");
    const f = await cargarFactura(m, [linea(m.harina.producto, "2000")], 2000);
    const pedido = {
      clave: nuevoId(),
      comprobanteId: f.comprobanteId,
      asignaciones: [
        { lineaDeFactura: 1, recepcionId: recibida, lineaDeRecepcion: 1, cantidad: "2000" },
      ],
    };
    const hecha = valorDe(await c.casos.conciliarFactura(m.e.gerente, pedido));
    expect(
      await c.casos.anularConciliacion(m.e.operador, { conciliacionId: hecha.conciliacionId }),
    ).toMatchObject({ ok: false, error: "SIN_PERMISO" });
    expect(
      valorDe(
        await c.casos.anularConciliacion(m.e.gerente, { conciliacionId: hecha.conciliacionId }),
      ),
    ).toEqual({ anulada: true });
    expect(await asignadaDeLaRecepcion(recibida)).toBe("0.0000");
    expect(await asignadaDeLaFactura(f.comprobanteId)).toBe("0.0000");
    const auditadas = (await c.auditoria(m.e.empresa, "CONCILIACION_ANULADA")).length;
    expect(
      await c.casos.anularConciliacion(m.e.administrador, { conciliacionId: hecha.conciliacionId }),
    ).toEqual({
      ok: false,
      error: "CONCILIACION_YA_ANULADA",
    });
    expect((await c.auditoria(m.e.empresa, "CONCILIACION_ANULADA")).length).toBe(auditadas);
    expect(await conciliaciones(f.comprobanteId)).toBe(2);
    // con el saldo de vuelta se puede conciliar otra vez (con otra clave)
    expect(
      valorDe(await c.casos.conciliarFactura(m.e.gerente, { ...pedido, clave: nuevoId() }))
        .yaExistia,
    ).toBe(false);
    expect(await asignadaDeLaRecepcion(recibida)).toBe("2000.0000");
    // el espejo no se anula, ni una conciliación inexistente o de otra empresa
    const otra = await armar();
    for (const conciliacionId of [nuevoId(), "no-es-un-id", hecha.conciliacionId]) {
      expect(await c.casos.anularConciliacion(otra.e.gerente, { conciliacionId })).toEqual({
        ok: false,
        error: "CONCILIACION_NO_ENCONTRADA",
      });
    }
  });
});
