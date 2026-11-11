import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { codigoDe } from "./concurrencia-apoyo";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { cuitAlAzar } from "./entorno";

/**
 * E9-T9: la factura que llega con la compra (N2): el comprobante con sus líneas, importes por alícuota y tributos, la conciliación atajo, la letra esperada,
 * el punto de venta de la ficha, el CUIT en la primera factura, el duplicado único, y anular la compra con su factura. Contra la base y el stock reales.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras: factura con la compra (N2)", () => {
  let c: MontajeDeCompras;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const codigo = (r: Parameters<typeof codigoDe>[0]): string =>
    !r.ok && typeof r.error === "object" && r.error !== null && "error" in r.error
      ? String(r.error.error)
      : codigoDe(r);

  /** Una empresa en N2 con un depósito, un artículo en gramos y un proveedor inscripto con el punto de venta 5 declarado. */
  const armar = async (
    nivel: "COMPRA_SIMPLE" | "CON_COMPROBANTE" = "CON_COMPROBANTE",
    condicionIva = "RESPONSABLE_INSCRIPTO",
  ) => {
    const e: EscenarioDeCompras = await c.escenario();
    if (nivel === "CON_COMPROBANTE")
      valorDe(await c.casos.configurarCompras(e.gerente, { nivel, versionEsperada: 1 }));
    const deposito = await c.deposito(e);
    const { producto, articulo } = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador, { condicionIva });
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    return { e, deposito, producto, articulo, proveedor };
  };
  type M = Awaited<ReturnType<typeof armar>>;
  const lineaFactura = (extra: Record<string, unknown> = {}) => ({
    renglon: 1,
    cantidadFacturada: "2000",
    precioNeto: "1",
    alicuota: "21",
    ...extra,
  });
  const compra = (
    m: M,
    factura: Record<string, unknown> | null = {},
    extra: Record<string, unknown> = {},
  ) => ({
    clave: nuevoId(),
    sucursalId: m.e.sucursal,
    proveedorId: m.proveedor,
    depositoId: m.deposito,
    renglones: [
      {
        productoId: m.producto,
        unidadDeCompraId: "KILOGRAMO",
        cantidad: "2",
        precioPor: "UNIDAD",
        unidadDePrecioId: "KILOGRAMO",
        precio: "1000",
      },
    ],
    ...(factura === null
      ? {}
      : {
          factura: {
            tipo: "FACTURA_A",
            puntoDeVenta: 5,
            numero: 100,
            fecha: "2026-10-10",
            lineas: [lineaFactura()],
            totalSegunFactura: "2420.00",
            cuitDelProveedor: cuitAlAzar(),
            ...factura,
          },
        }),
    ...extra,
  });
  const cantidadDe = (sql: string, p: unknown[] = []) => c.contar(sql, p);
  const filaUnica = async (sql: string, p: unknown[] = []) =>
    (await c.filas<Record<string, unknown>>(sql, p))[0];

  it("el operador carga la compra con su factura: comprobante, líneas, importes por alícuota, conciliación atajo, saldos y el CUIT en la ficha del proveedor", async () => {
    const m = await armar();
    const cuit = cuitAlAzar();
    const r = valorDe(
      await c.casos.registrarCompra(m.e.operador, compra(m, { cuitDelProveedor: cuit })),
    );
    expect(r).toMatchObject({ yaExistia: false, avisos: [] });
    expect(r.comprobanteId).not.toBeNull();
    const comprobante = await filaUnica(
      `select clase, tipo, punto_de_venta, numero, fecha_del_comprobante::text as fecha, neto_gravado::text as neto, iva::text as iva, total_calculado::text as total,
              total_segun_factura::text as impreso, credito_fiscal_computable::text as credito, proveedor_cuit, proveedor_razon_social, letra_no_esperada, nivel, es_atajo,
              estado, registrado_por
         from comprobante_de_proveedor where id = $1`,
      [r.comprobanteId],
    );
    expect(comprobante).toMatchObject({
      clase: "FACTURA",
      tipo: "FACTURA_A",
      punto_de_venta: 5,
      numero: 100,
      fecha: "2026-10-10",
      neto: "2000.00",
      iva: "420.00",
      total: "2420.00",
      impreso: "2420.00",
      credito: "420.00",
      proveedor_cuit: cuit,
      letra_no_esperada: false,
      nivel: "CON_COMPROBANTE",
      es_atajo: true,
      estado: "REGISTRADO",
      registrado_por: m.e.operador.personaId,
    });
    expect(
      await filaUnica(
        "select descripcion, unidad, cantidad_facturada::text as q, neto_de_linea::text as n, iva_de_linea::text as i, recepcion_id, linea_de_recepcion from linea_de_comprobante where comprobante_id = $1",
        [r.comprobanteId],
      ),
    ).toMatchObject({
      unidad: "GRAMO",
      q: "2000.0000",
      n: "2000.00",
      i: "420.00",
      recepcion_id: r.recepcionId,
      linea_de_recepcion: 1,
    });
    expect(
      await c.filas(
        "select alicuota, neto::text as neto, iva::text as iva from importe_por_alicuota where comprobante_id = $1",
        [r.comprobanteId],
      ),
    ).toEqual([{ alicuota: "21", neto: "2000.00", iva: "420.00" }]);
    expect(
      await filaUnica(
        "select c.es_atajo, c.nivel, a.cantidad::text as q from conciliacion c join asignacion_de_conciliacion a on a.conciliacion_id = c.id where c.comprobante_id = $1",
        [r.comprobanteId],
      ),
    ).toEqual({ es_atajo: true, nivel: "CON_COMPROBANTE", q: "2000.0000" });
    expect(
      await filaUnica(
        "select cantidad_recibida::text as r, cantidad_asignada::text as a from saldo_de_linea_de_recepcion where recepcion_id = $1",
        [r.recepcionId],
      ),
    ).toEqual({ r: "2000.0000", a: "2000.0000" });
    expect(
      await filaUnica(
        "select cantidad_facturada::text as f, cantidad_asignada::text as a from saldo_de_linea_de_comprobante where comprobante_id = $1",
        [r.comprobanteId],
      ),
    ).toEqual({ f: "2000.0000", a: "2000.0000" });
    expect(
      await filaUnica("select documento_tipo, documento_numero from parte where id = $1", [
        m.proveedor,
      ]),
    ).toEqual({ documento_tipo: "CUIT", documento_numero: cuit });
    const lista = valorDe(await c.consultas.listarCompras(m.e.gerente));
    expect(lista.compras.find((x) => x.recepcionId === r.recepcionId)?.estado).toBe(
      "RECIBIDA_Y_FACTURADA",
    );
    expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
  });

  it("una compra con percepciones: se guarda como un tributo sin clasificar y entra al total; el IVA de una B no se discrimina", async () => {
    const m = await armar();
    const r = valorDe(
      await c.casos.registrarCompra(
        m.e.operador,
        compra(m, { percepciones: "50.00", totalSegunFactura: "2470.00" }),
      ),
    );
    expect(r.avisos).toEqual([]);
    expect(
      await c.filas(
        "select tipo, importe::text as importe from tributo_de_comprobante where comprobante_id = $1",
        [r.comprobanteId],
      ),
    ).toEqual([{ tipo: "PERCEPCION_SIN_CLASIFICAR", importe: "50.00" }]);
    expect(
      await filaUnica(
        "select tributos_total::text as t, total_calculado::text as c from comprobante_de_proveedor where id = $1",
        [r.comprobanteId],
      ),
    ).toEqual({ t: "50.00", c: "2470.00" });
    const b = await armar("CON_COMPROBANTE", "RESPONSABLE_INSCRIPTO");
    const rb = valorDe(
      await c.casos.registrarCompra(
        b.e.operador,
        compra(b, {
          tipo: "FACTURA_B",
          lineas: [lineaFactura({ alicuota: null })],
          totalSegunFactura: "2000.00",
        }),
      ),
    );
    expect(
      await filaUnica(
        "select iva::text as iva, credito_fiscal_computable::text as credito from comprobante_de_proveedor where id = $1",
        [rb.comprobanteId],
      ),
    ).toEqual({ iva: "0.00", credito: "0.00" });
  });

  it("en N1 no se carga factura (FACTURA_NO_CORRESPONDE_AL_NIVEL) y no queda nada", async () => {
    const m = await armar("COMPRA_SIMPLE");
    expect(await c.casos.registrarCompra(m.e.operador, compra(m))).toEqual({
      ok: false,
      error: "FACTURA_NO_CORRESPONDE_AL_NIVEL",
    });
    expect(
      await cantidadDe("select count(*) as n from recepcion where proveedor_id = $1", [
        m.proveedor,
      ]),
    ).toBe(0);
    expect(await c.existencia(m.deposito, m.articulo)).toBe("0");
  });

  it("R4: el punto de venta tiene que estar en la ficha y activo; pedido pendiente o apagado no sirven; las facturas ya cargadas no cambian", async () => {
    const m = await armar();
    expect(await c.casos.registrarCompra(m.e.operador, compra(m, { puntoDeVenta: 6 }))).toEqual({
      ok: false,
      error: "PUNTO_DE_VENTA_NO_DECLARADO",
    });
    valorDe(await c.casos.pedirPuntoDeVenta(m.e.operador, { parteId: m.proveedor, numero: 6 }));
    expect(await c.casos.registrarCompra(m.e.operador, compra(m, { puntoDeVenta: 6 }))).toEqual({
      ok: false,
      error: "PUNTO_DE_VENTA_NO_DECLARADO",
    });
    const cargada = valorDe(await c.casos.registrarCompra(m.e.operador, compra(m)));
    valorDe(
      await c.casos.dejarDeUsarPuntoDeVenta(m.e.gerente, { parteId: m.proveedor, numero: 5 }),
    );
    expect(await c.casos.registrarCompra(m.e.operador, compra(m, { numero: 101 }))).toEqual({
      ok: false,
      error: "PUNTO_DE_VENTA_NO_DECLARADO",
    });
    expect(
      await filaUnica(
        "select punto_de_venta, numero, estado from comprobante_de_proveedor where id = $1",
        [cargada.comprobanteId],
      ),
    ).toEqual({ punto_de_venta: 5, numero: 100, estado: "REGISTRADO" });
    // un proveedor sin ficha tampoco tiene puntos de venta
    const sinFicha = await c.proveedor(m.e.operador);
    expect(
      await c.casos.registrarCompra(m.e.operador, compra(m, {}, { proveedorId: sinFicha })),
    ).toEqual({ ok: false, error: "PUNTO_DE_VENTA_NO_DECLARADO" });
    expect(
      await cantidadDe("select count(*) as n from recepcion where proveedor_id = $1", [sinFicha]),
    ).toBe(0);
  });

  it("R3: una factura B de un proveedor que debía emitir A se carga igual y avisa la esperada; cambiar su condición en el directorio no cambia la letra de la ficha", async () => {
    const m = await armar();
    const r = valorDe(
      await c.casos.registrarCompra(
        m.e.operador,
        compra(m, {
          tipo: "FACTURA_B",
          lineas: [lineaFactura({ alicuota: null })],
          totalSegunFactura: "2000.00",
        }),
      ),
    );
    expect(r.avisos).toEqual([{ tipo: "LETRA_NO_ESPERADA", esperada: "A" }]);
    expect(
      await filaUnica("select letra_no_esperada from comprobante_de_proveedor where id = $1", [
        r.comprobanteId,
      ]),
    ).toEqual({ letra_no_esperada: true });
    valorDe(
      await c.clientes.editarParte(m.e.gerente, {
        parteId: m.proveedor,
        versionEsperada: (
          await filaUnica("select version from parte where id = $1", [m.proveedor])
        )?.["version"] as number,
        cambios: { condicionIva: "MONOTRIBUTO" },
      }),
    );
    expect(
      valorDe(await c.consultas.fichaDelProveedorParaCompras(m.e.gerente, { parteId: m.proveedor }))
        .letraEsperada,
    ).toBe("A");
    const otra = valorDe(
      await c.casos.registrarCompra(
        m.e.operador,
        compra(m, {
          tipo: "FACTURA_C",
          numero: 101,
          lineas: [lineaFactura({ alicuota: null })],
          totalSegunFactura: "2000.00",
          cuitDelProveedor: null,
        }),
      ),
    );
    expect(otra.avisos).toEqual([{ tipo: "LETRA_NO_ESPERADA", esperada: "A" }]);
  });

  it("R5: el total del papel distinto del calculado se carga igual con aviso y quedan los dos totales", async () => {
    const m = await armar();
    const r = valorDe(
      await c.casos.registrarCompra(m.e.operador, compra(m, { totalSegunFactura: "2500.00" })),
    );
    expect(r.avisos).toEqual([{ tipo: "TOTAL_NO_COINCIDE" }]);
    expect(
      await filaUnica(
        "select total_calculado::text as c, total_segun_factura::text as i from comprobante_de_proveedor where id = $1",
        [r.comprobanteId],
      ),
    ).toEqual({ c: "2420.00", i: "2500.00" });
    // un centavo de diferencia está dentro de la tolerancia de ARCA
    const tolerada = valorDe(
      await c.casos.registrarCompra(
        m.e.operador,
        compra(m, { numero: 101, totalSegunFactura: "2420.01", cuitDelProveedor: null }),
      ),
    );
    expect(tolerada.avisos).toEqual([]);
  });

  it("I1: repetir la compra con factura devuelve lo mismo (comprobante y avisos) sin escribir; con otra factura y la misma clave, CLAVE_REUTILIZADA", async () => {
    const m = await armar();
    const pedido = compra(m, {
      tipo: "FACTURA_B",
      lineas: [lineaFactura({ alicuota: null })],
      totalSegunFactura: "2100.00",
    });
    const primera = valorDe(await c.casos.registrarCompra(m.e.operador, pedido));
    const segunda = valorDe(await c.casos.registrarCompra(m.e.operador, pedido));
    expect(segunda).toEqual({ ...primera, yaExistia: true });
    expect(segunda.avisos).toEqual([
      { tipo: "LETRA_NO_ESPERADA", esperada: "A" },
      { tipo: "TOTAL_NO_COINCIDE" },
    ]);
    expect(
      await cantidadDe(
        "select count(*) as n from comprobante_de_proveedor where proveedor_id = $1",
        [m.proveedor],
      ),
    ).toBe(1);
    expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
    expect(
      await c.casos.registrarCompra(m.e.operador, {
        ...compra(m, { numero: 999 }),
        clave: pedido.clave,
      }),
    ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
  });

  it("I3: la misma factura con otra clave es COMPROBANTE_YA_REGISTRADO con el id; anulada la compra, el número se puede volver a cargar", async () => {
    const m = await armar();
    const primera = valorDe(await c.casos.registrarCompra(m.e.operador, compra(m)));
    const intento = await c.casos.registrarCompra(
      m.e.operador,
      compra(m, { cuitDelProveedor: null }),
    );
    expect(intento).toEqual({
      ok: false,
      error: { error: "COMPROBANTE_YA_REGISTRADO", comprobanteId: primera.comprobanteId },
    });
    expect(
      await cantidadDe("select count(*) as n from recepcion where proveedor_id = $1", [
        m.proveedor,
      ]),
    ).toBe(1);
    expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
    valorDe(
      await c.casos.anularCompra(m.e.gerente, {
        recepcionId: primera.recepcionId,
        motivo: "Factura mal cargada",
      }),
    );
    expect(
      valorDe(await c.casos.registrarCompra(m.e.operador, compra(m, { cuitDelProveedor: null })))
        .yaExistia,
    ).toBe(false);
  });

  it("C2: dos cargas de la misma factura a la vez, en dos compras distintas: una factura; la otra COMPROBANTE_YA_REGISTRADO, sin recepción huérfana ni entrada de stock", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const cuit = cuitAlAzar();
      c.armarBarrera(2);
      try {
        const resultados = await Promise.all([
          c.casos.registrarCompra(
            m.e.operador,
            compra(m, { numero: 200 + ronda, cuitDelProveedor: cuit }),
          ),
          c.casos.registrarCompra(
            m.e.administrador,
            compra(m, { numero: 200 + ronda, cuitDelProveedor: cuit }),
          ),
        ]);
        expect(resultados.filter((r) => r.ok && !r.valor.yaExistia)).toHaveLength(1);
        for (const r of resultados) {
          expect(
            r.ok || ["COMPROBANTE_YA_REGISTRADO", "ConcurrenciaAgotada"].includes(codigo(r)),
            JSON.stringify(r),
          ).toBe(true);
        }
      } finally {
        c.soltarBarrera();
      }
      expect(
        await cantidadDe(
          "select count(*) as n from comprobante_de_proveedor where proveedor_id = $1",
          [m.proveedor],
        ),
      ).toBe(1);
      expect(
        await cantidadDe("select count(*) as n from recepcion where proveedor_id = $1", [
          m.proveedor,
        ]),
      ).toBe(1);
      expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
    }
  });

  it("el CUIT: obligatorio en la primera factura; inválido se rechaza; con otro documento ya guardado, PROVEEDOR_CON_OTRO_DOCUMENTO; el mismo CUIT otra vez está bien; el de otra parte, DOCUMENTO_YA_REGISTRADO", async () => {
    const m = await armar();
    expect(
      await c.casos.registrarCompra(m.e.operador, compra(m, { cuitDelProveedor: null })),
    ).toEqual({ ok: false, error: "CUIT_REQUERIDO_EN_PRIMERA_FACTURA" });
    expect(
      await c.casos.registrarCompra(m.e.operador, compra(m, { cuitDelProveedor: "20123456780" })),
    ).toMatchObject({ ok: false, error: { error: "DATOS_INVALIDOS" } });
    expect(
      await cantidadDe("select count(*) as n from recepcion where proveedor_id = $1", [
        m.proveedor,
      ]),
    ).toBe(0);
    const cuit = cuitAlAzar();
    valorDe(await c.casos.registrarCompra(m.e.operador, compra(m, { cuitDelProveedor: cuit })));
    expect(
      valorDe(
        await c.casos.registrarCompra(
          m.e.operador,
          compra(m, { numero: 101, cuitDelProveedor: cuit }),
        ),
      ).yaExistia,
    ).toBe(false);
    expect(
      await c.casos.registrarCompra(
        m.e.operador,
        compra(m, { numero: 102, cuitDelProveedor: cuitAlAzar() }),
      ),
    ).toEqual({ ok: false, error: "PROVEEDOR_CON_OTRO_DOCUMENTO" });
    // sin CUIT en la factura, el guardado se usa y se copia
    const sinCuit = valorDe(
      await c.casos.registrarCompra(
        m.e.operador,
        compra(m, { numero: 103, cuitDelProveedor: null }),
      ),
    );
    expect(
      await filaUnica("select proveedor_cuit from comprobante_de_proveedor where id = $1", [
        sinCuit.comprobanteId,
      ]),
    ).toEqual({ proveedor_cuit: cuit });
    const otro = await armar();
    const usado = await c.proveedor(otro.e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(otro.e.gerente, { parteId: usado, numero: 5 }));
    const delOtro = valorDe(
      await c.casos.registrarCompra(otro.e.operador, compra(otro, {}, { proveedorId: usado })),
    );
    const cuitDelOtro = (
      await filaUnica("select proveedor_cuit from comprobante_de_proveedor where id = $1", [
        delOtro.comprobanteId,
      ])
    )?.["proveedor_cuit"];
    const tercero = await c.proveedor(otro.e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(otro.e.gerente, { parteId: tercero, numero: 5 }));
    const choque = await c.casos.registrarCompra(
      otro.e.operador,
      compra(otro, { numero: 300, cuitDelProveedor: cuitDelOtro }, { proveedorId: tercero }),
    );
    expect(choque).toMatchObject({
      ok: false,
      error: { error: "DOCUMENTO_YA_REGISTRADO", parteId: usado },
    });
  });

  it("C6: dos primeras facturas del mismo proveedor sin CUIT, con CUIT distintos: una guarda el suyo y la otra PROVEEDOR_CON_OTRO_DOCUMENTO", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      c.armarBarrera(2);
      try {
        const resultados = await Promise.all([
          c.casos.registrarCompra(
            m.e.operador,
            compra(m, { numero: 1, cuitDelProveedor: cuitAlAzar() }),
          ),
          c.casos.registrarCompra(
            m.e.administrador,
            compra(m, { numero: 2, cuitDelProveedor: cuitAlAzar() }),
          ),
        ]);
        expect(resultados.filter((r) => r.ok)).toHaveLength(1);
        for (const r of resultados.filter((x) => !x.ok)) {
          expect(["PROVEEDOR_CON_OTRO_DOCUMENTO", "ConcurrenciaAgotada"]).toContain(codigo(r));
        }
      } finally {
        c.soltarBarrera();
      }
      expect(
        await cantidadDe(
          "select count(*) as n from comprobante_de_proveedor where proveedor_id = $1",
          [m.proveedor],
        ),
      ).toBe(1);
    }
  });

  it("rechaza una factura mal formada: moneda, tipo, renglón inexistente, alícuota faltante en una A, líneas vacías, tipo/punto/número/fecha", async () => {
    const m = await armar();
    const mal = async (factura: Record<string, unknown>) =>
      c.casos.registrarCompra(m.e.operador, compra(m, factura));
    expect(await mal({ moneda: "USD" })).toEqual({ ok: false, error: "MONEDA_NO_SOPORTADA" });
    expect(await mal({ tipo: "FACTURA_Z" })).toEqual({
      ok: false,
      error: "TIPO_DE_COMPROBANTE_INVALIDO",
    });
    expect(await mal({ puntoDeVenta: 0 })).toEqual({ ok: false, error: "PUNTO_DE_VENTA_INVALIDO" });
    expect(await mal({ numero: 0 })).toEqual({
      ok: false,
      error: "NUMERO_DE_COMPROBANTE_INVALIDO",
    });
    expect(await mal({ fecha: "ayer" })).toEqual({ ok: false, error: "FECHA_INVALIDA" });
    expect(await mal({ lineas: [] })).toEqual({ ok: false, error: "LINEAS_REQUERIDAS" });
    expect(await mal({ lineas: [lineaFactura({ renglon: 9 })] })).toEqual({
      ok: false,
      error: "RENGLONES_INVALIDOS",
    });
    expect(await mal({ lineas: [lineaFactura({ alicuota: null })] })).toEqual({
      ok: false,
      error: "ALICUOTA_REQUERIDA",
    });
    expect(await mal({ lineas: [lineaFactura({ precioNeto: "x" })] })).toEqual({
      ok: false,
      error: "PRECIO_INVALIDO",
    });
    expect(await mal({ lineas: [lineaFactura({ cantidadFacturada: "0" })] })).toEqual({
      ok: false,
      error: "CANTIDAD_INVALIDA",
    });
    expect(await mal({ totalSegunFactura: "x" })).toEqual({ ok: false, error: "TOTAL_INVALIDO" });
    expect(
      await cantidadDe("select count(*) as n from recepcion where proveedor_id = $1", [
        m.proveedor,
      ]),
    ).toBe(0);
  });

  it("si la factura dice más de lo recibido se asigna lo recibido; el saldo nunca supera lo recibido ni lo facturado", async () => {
    const m = await armar();
    const r = valorDe(
      await c.casos.registrarCompra(
        m.e.operador,
        compra(m, {
          lineas: [lineaFactura({ cantidadFacturada: "2500" })],
          totalSegunFactura: "3025.00",
        }),
      ),
    );
    expect(
      await filaUnica(
        "select a.cantidad::text as q from asignacion_de_conciliacion a where a.comprobante_id = $1",
        [r.comprobanteId],
      ),
    ).toEqual({ q: "2000.0000" });
    expect(
      await filaUnica(
        "select cantidad_recibida::text as r, cantidad_asignada::text as a from saldo_de_linea_de_recepcion where recepcion_id = $1",
        [r.recepcionId],
      ),
    ).toEqual({ r: "2000.0000", a: "2000.0000" });
  });

  it("A1: una falla inyectada después de la conciliación (en la oferta) no deja comprobante, conciliación, recepción, entrada ni el CUIT", async () => {
    const m = await armar();
    c.inyectarFalla("oferta");
    try {
      await expect(c.casos.registrarCompra(m.e.operador, compra(m))).rejects.toThrow(
        /falla inyectada/,
      );
    } finally {
      c.inyectarFalla(null);
    }
    expect(
      await cantidadDe(
        "select count(*) as n from comprobante_de_proveedor where proveedor_id = $1",
        [m.proveedor],
      ),
    ).toBe(0);
    expect(
      await cantidadDe(
        "select count(*) as n from conciliacion c join comprobante_de_proveedor p on p.id = c.comprobante_id where p.proveedor_id = $1",
        [m.proveedor],
      ),
    ).toBe(0);
    expect(
      await cantidadDe("select count(*) as n from recepcion where proveedor_id = $1", [
        m.proveedor,
      ]),
    ).toBe(0);
    expect(await c.existencia(m.deposito, m.articulo)).toBe("0");
    expect(
      await filaUnica("select documento_tipo from parte where id = $1", [m.proveedor]),
    ).toEqual({ documento_tipo: null });
  });

  it("anular la compra con factura deja el espejo de la conciliación, los saldos en cero, la factura ANULADA y el stock revertido", async () => {
    const m = await armar();
    const r = valorDe(await c.casos.registrarCompra(m.e.operador, compra(m)));
    valorDe(
      await c.casos.anularCompra(m.e.administrador, {
        recepcionId: r.recepcionId,
        motivo: "Devolución total",
      }),
    );
    expect(
      await c.filas(
        "select acto, anula_a is not null as espejo from conciliacion where comprobante_id = $1 order by acto",
        [r.comprobanteId],
      ),
    ).toEqual([
      { acto: "ANULACION", espejo: true },
      { acto: "CONCILIACION", espejo: false },
    ]);
    expect(
      await filaUnica(
        "select sum(a.cantidad)::text as s from asignacion_de_conciliacion a where a.comprobante_id = $1",
        [r.comprobanteId],
      ),
    ).toEqual({ s: "0.0000" });
    expect(
      await filaUnica(
        "select cantidad_asignada::text as a from saldo_de_linea_de_recepcion where recepcion_id = $1",
        [r.recepcionId],
      ),
    ).toEqual({ a: "0.0000" });
    expect(
      await filaUnica(
        "select estado, anulado_por, motivo_de_anulacion from comprobante_de_proveedor where id = $1",
        [r.comprobanteId],
      ),
    ).toEqual({
      estado: "ANULADO",
      anulado_por: m.e.administrador.personaId,
      motivo_de_anulacion: "Devolución total",
    });
    expect(await c.existencia(m.deposito, m.articulo)).toBe("0.0000");
    expect(
      valorDe(await c.consultas.listarCompras(m.e.gerente)).compras.find(
        (x) => x.recepcionId === r.recepcionId,
      )?.estado,
    ).toBe("ANULADA");
    expect(
      await c.casos.anularCompra(m.e.gerente, { recepcionId: r.recepcionId, motivo: "Otra vez" }),
    ).toEqual({ ok: false, error: "RECEPCION_YA_ANULADA" });
  });

  it("R6: la factura de una empresa no se ve ni se duplica contra la de otra (mismo proveedor, tipo, punto y número en dos empresas son dos facturas)", async () => {
    const a = await armar();
    const b = await armar();
    const fa = valorDe(await c.casos.registrarCompra(a.e.operador, compra(a)));
    const fb = valorDe(await c.casos.registrarCompra(b.e.operador, compra(b)));
    expect(fa.comprobanteId).not.toBe(fb.comprobanteId);
    expect(
      await c.casos.anularCompra(b.e.gerente, { recepcionId: fa.recepcionId, motivo: "No es mía" }),
    ).toEqual({ ok: false, error: "RECEPCION_NO_ENCONTRADA" });
  });
});
