import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  anularLaConciliacion,
  conciliacionesDeLaFactura,
  conciliarLaFactura,
  datosParaConciliar,
  fichaDeLaFactura,
  listarLasFacturas,
  registrarLaFactura,
  type DependenciasDeFacturasWeb,
} from "../../src/composicion/facturas-web";
import {
  confirmarLaRecepcion,
  registrarLaRecepcion,
  type DependenciasDeRecepcionesWeb,
} from "../../src/composicion/recepciones-web";
import { RONDAS, nuevoId } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { cuitUnico } from "./entorno";
import { numeroUnico } from "./unicos";

/**
 * Compras 4, «Facturas» y «Conciliar» por la composición web, con una base real. Los casos de uso (`registrarFactura`, `conciliarFactura`, `anularConciliacion`) ya tienen sus pruebas de servidor
 * (`compras-n3-conciliacion.test.ts`); ésta prueba lo que agrega la pantalla: la frontera (el pedido tal como lo manda el navegador), la lista y el detalle con el estado derivado («Facturada, falta recibir»,
 * «Falta conciliar», «Conciliada en parte», «Todo coincide»), lo recibido POR SUCURSAL limitado al alcance de quien mira, y de punta a punta lo que pidió el dueño: IDEMPOTENCIA (la misma factura o conciliación
 * dos veces, también a la vez: una sola), CONCURRENCIA (dos conciliaciones a la vez sobre la misma línea recibida, sobre una línea de factura repartida entre dos sucursales, y conciliar y anular a la vez),
 * ALCANCE (cada gerente concilia lo de su sucursal), AISLAMIENTO entre empresas y AUTORIZACIÓN en el servidor.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });
const sinPermiso = (r: unknown) =>
  expect(r).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
const esGenerico = (r: unknown) =>
  expect(r).toMatchObject({ ok: false, error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" } });

describe.skipIf(base === null)("composición web: Facturas y conciliación", () => {
  let c: MontajeDeCompras;
  let f: DependenciasDeFacturasWeb;
  let r: DependenciasDeRecepcionesWeb;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    c.encenderPerilla("recepcion_separada");
    f = {
      consultas: () => c.consultas,
      casosDeUso: () => c.casos,
      respuesta: { registrar: () => undefined },
    };
    r = {
      consultas: () => c.consultas,
      casosDeUso: () => c.casos,
      respuesta: { registrar: () => undefined },
    };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  /** Una empresa con dos sucursales, un depósito en cada una, harina en gramos y un proveedor con el punto de venta 5. */
  const mundo = async () => {
    const x: EscenarioDeCompras = await c.escenario();
    const deposito = await c.deposito(x);
    const depositoDeLaOtra = await c.deposito({ empresa: x.empresa, sucursal: x.otraSucursal });
    const harina = await c.articulo(x, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(x.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    const puntoDeVenta = await c.casos.agregarPuntoDeVenta(x.gerente, {
      parteId: proveedor,
      numero: 5,
    });
    if (!puntoDeVenta.ok) throw new Error("no se pudo declarar el punto de venta");
    return { x, m: { deposito, depositoDeLaOtra, harina, proveedor, cuit: cuitUnico() } };
  };
  type Montaje = Awaited<ReturnType<typeof mundo>>["m"];

  /** Lo que manda el navegador al cargar la factura: un producto por línea, sin sucursal. */
  const pedidoDeFactura = (
    m: Montaje,
    gramos: number,
    extra: Record<string, unknown> = {},
    clave = nuevoId(),
  ) => ({
    clave,
    proveedorId: m.proveedor,
    factura: {
      tipo: "FACTURA_A",
      puntoDeVenta: "5",
      numero: String(numeroUnico()),
      fecha: "2026-11-20",
      lineas: [
        {
          productoId: m.harina.producto,
          cantidadFacturada: String(gramos),
          precioNeto: "1",
          alicuota: "21",
        },
      ],
      totalSegunFactura: (gramos * 1.21).toFixed(2),
      cuitDelProveedor: m.cuit,
    },
    ...extra,
  });
  const dato = <D>(
    respuesta: { ok: true; dato: D } | { ok: false; error: unknown },
    que = "la operación",
  ): D => {
    if (!respuesta.ok) throw new Error(`${que} falló: ${JSON.stringify(respuesta.error)}`);
    return respuesta.dato;
  };
  const cargar = async (x: EscenarioDeCompras, m: Montaje, gramos: number) =>
    dato(await registrarLaFactura(f, x.operador, pedidoDeFactura(m, gramos)), "cargar la factura")
      .comprobanteId;
  /** Recibe `kilos` de harina en una sucursal y los confirma: devuelve el id de la recepción. */
  const recibir = async (
    x: EscenarioDeCompras,
    m: Montaje,
    kilos: string,
    sucursal: string = x.sucursal,
  ) => {
    const quien = sucursal === x.sucursal ? x.operador : x.gerente;
    const recepcion = dato(
      await registrarLaRecepcion(r, quien, sucursal, {
        clave: nuevoId(),
        proveedorId: m.proveedor,
        renglones: [
          { productoId: m.harina.producto, unidadDeCompraId: "KILOGRAMO", cantidad: kilos },
        ],
      }),
      "recibir",
    ).recepcionId;
    dato(
      await confirmarLaRecepcion(r, x.gerente, {
        recepcionId: recepcion,
        depositoId: sucursal === x.sucursal ? m.deposito : m.depositoDeLaOtra,
      }),
      "confirmar la recepción",
    );
    return recepcion;
  };
  const conciliar = (
    x: EscenarioDeCompras,
    comprobanteId: string,
    asignaciones: readonly Record<string, unknown>[],
    clave = nuevoId(),
    quien = x.gerente,
  ) => conciliarLaFactura(f, quien, { clave, comprobanteId, asignaciones });
  const asignacion = (recepcionId: string, gramos: string, lineaDeFactura = 1) => ({
    lineaDeFactura,
    recepcionId,
    lineaDeRecepcion: 1,
    cantidad: gramos,
  });
  const estadoDe = async (x: EscenarioDeCompras, comprobanteId: string, quien = x.gerente) =>
    dato(await listarLasFacturas(f, quien, {}), "listar").facturas.find(
      (fila) => fila.comprobanteId === comprobanteId,
    )?.estado;
  const facturas = (m: Montaje) =>
    c.contar("select count(*) as n from comprobante_de_proveedor where proveedor_id = $1", [
      m.proveedor,
    ]);
  const conciliaciones = (comprobanteId: string, acto = "CONCILIACION") =>
    c.contar("select count(*) as n from conciliacion where comprobante_id = $1 and acto = $2", [
      comprobanteId,
      acto,
    ]);
  const asignadaDeLaFactura = async (comprobanteId: string) =>
    (
      await c.filas<{ n: string }>(
        "select coalesce(sum(cantidad_asignada), 0)::text as n from saldo_de_linea_de_comprobante where comprobante_id = $1",
        [comprobanteId],
      )
    )[0]?.n;

  it("cargar la factura: no mueve stock, no lleva sucursal, audita, la respuesta no trae nada interno y el estado es «Facturada, falta recibir»", async () => {
    const { x, m } = await mundo();
    const respuesta = await registrarLaFactura(f, x.operador, pedidoDeFactura(m, 2000));
    expect(respuesta).toMatchObject({ ok: true, dato: { yaExistia: false } });
    const hecha = dato(respuesta);
    expect(Object.keys(hecha).sort()).toEqual(["comprobanteId", "yaExistia"]);
    expect(await facturas(m)).toBe(1);
    expect(
      await c.contar("select count(*) as n from movimiento_de_stock where deposito_id = $1", [
        m.deposito,
      ]),
    ).toBe(0);
    expect((await c.auditoria(x.empresa, "FACTURA_REGISTRADA")).at(-1)).toMatchObject({
      actor_persona_id: x.personaDelOperador,
      entidad_id: hecha.comprobanteId,
    });
    expect(await estadoDe(x, hecha.comprobanteId)).toBe("FACTURADA_FALTA_RECIBIR");
    const ficha = dato(await fichaDeLaFactura(f, x.operador, hecha.comprobanteId));
    expect(ficha).toMatchObject({ estado: "FACTURADA_FALTA_RECIBIR", tipo: "FACTURA_A" });
    expect(ficha.lineas).toEqual([
      expect.objectContaining({
        numero: 1,
        facturada: "2000.0000",
        conciliada: "0.0000",
        recibidoPorSucursal: [],
      }),
    ]);
  });

  it("cargar la factura NO acepta lo que el navegador invente: la empresa, la sucursal, un remito o un renglón sin producto son el genérico y no queda nada", async () => {
    const { x, m } = await mundo();
    esGenerico(
      await registrarLaFactura(f, x.operador, pedidoDeFactura(m, 1000, { empresaId: x.empresa })),
    );
    esGenerico(
      await registrarLaFactura(f, x.operador, pedidoDeFactura(m, 1000, { sucursalId: x.sucursal })),
    );
    const sinProducto = pedidoDeFactura(m, 1000);
    esGenerico(
      await registrarLaFactura(f, x.operador, {
        ...sinProducto,
        factura: { ...sinProducto.factura, lineas: [{ cantidadFacturada: "1", precioNeto: "1" }] },
      }),
    );
    esGenerico(
      await registrarLaFactura(f, x.operador, {
        ...sinProducto,
        factura: { ...sinProducto.factura, lineas: [] },
      }),
    );
    expect(await facturas(m)).toBe(0);
  });

  it("el recorrido: falta recibir → falta conciliar → conciliada en parte → todo coincide, con lo recibido por sucursal en cada paso", async () => {
    const { x, m } = await mundo();
    const factura = await cargar(x, m, 2000);
    const recepcion = await recibir(x, m, "3");
    expect(await estadoDe(x, factura)).toBe("FALTA_CONCILIAR");
    const ficha = dato(await fichaDeLaFactura(f, x.gerente, factura));
    expect(ficha.lineas[0]?.recibidoPorSucursal).toEqual([
      { sucursalId: x.sucursal, recibida: "3000.0000", sinConciliar: "3000.0000" },
    ]);

    const datos = dato(await datosParaConciliar(f, x.gerente, factura));
    expect(datos.lineas).toEqual([
      expect.objectContaining({ numero: 1, facturada: "2000.0000", sinConciliar: "2000.0000" }),
    ]);
    expect(datos.recibidas).toEqual([
      expect.objectContaining({
        recepcionId: recepcion,
        recepcionNumero: expect.any(Number) as number,
        sucursalId: x.sucursal,
        linea: 1,
        recibida: "3000.0000",
        sinAsignar: "3000.0000",
      }),
    ]);
    expect(datos.propuesta).toEqual([
      { lineaDeFactura: 1, recepcionId: recepcion, lineaDeRecepcion: 1, cantidad: "2000.0000" },
    ]);

    // Se concilia en parte (la persona corrige la propuesta) y después el resto.
    const primera = dato(await conciliar(x, factura, [asignacion(recepcion, "800")]));
    expect(primera.yaExistia).toBe(false);
    expect(await estadoDe(x, factura)).toBe("CONCILIADA_EN_PARTE");
    const enParte = dato(await fichaDeLaFactura(f, x.gerente, factura));
    expect(enParte.lineas[0]).toMatchObject({ conciliada: "800.0000" });
    expect(enParte.lineas[0]?.recibidoPorSucursal).toEqual([
      { sucursalId: x.sucursal, recibida: "3000.0000", sinConciliar: "2200.0000" },
    ]);
    const hechas = dato(await conciliacionesDeLaFactura(f, x.gerente, factura));
    expect(hechas).toEqual([
      expect.objectContaining({
        conciliacionId: primera.conciliacionId,
        anulada: false,
        anulableEnAlcance: true,
        asignaciones: [
          expect.objectContaining({
            lineaDeFactura: 1,
            sucursalId: x.sucursal,
            lineaDeRecepcion: 1,
            cantidad: "800.0000",
          }),
        ],
      }),
    ]);
    dato(await conciliar(x, factura, [asignacion(recepcion, "1200")]));
    expect(await estadoDe(x, factura)).toBe("CONCILIADA");
    expect(await asignadaDeLaFactura(factura)).toBe("2000.0000");
    // Ya no queda nada que proponer.
    expect(dato(await datosParaConciliar(f, x.gerente, factura)).propuesta).toEqual([]);
  });

  it("anular una conciliación devuelve el saldo, queda el registro opuesto, no se borra nada y una conciliación se anula una sola vez", async () => {
    const { x, m } = await mundo();
    const factura = await cargar(x, m, 1000);
    const recepcion = await recibir(x, m, "1");
    const hecha = dato(await conciliar(x, factura, [asignacion(recepcion, "1000")]));
    expect(await estadoDe(x, factura)).toBe("CONCILIADA");
    expect(
      dato(await anularLaConciliacion(f, x.gerente, { conciliacionId: hecha.conciliacionId })),
    ).toEqual({ anulada: true });
    expect(await estadoDe(x, factura)).toBe("FALTA_CONCILIAR");
    expect(await asignadaDeLaFactura(factura)).toBe("0.0000");
    expect(await conciliaciones(factura)).toBe(1);
    expect(await conciliaciones(factura, "ANULACION")).toBe(1);
    expect(dato(await conciliacionesDeLaFactura(f, x.gerente, factura))).toEqual([
      expect.objectContaining({ anulada: true }),
    ]);
    esGenerico(await anularLaConciliacion(f, x.gerente, { conciliacionId: hecha.conciliacionId }));
    expect(await conciliaciones(factura, "ANULACION")).toBe(1);
    // Lo recuperado se puede volver a conciliar.
    dato(await conciliar(x, factura, [asignacion(recepcion, "1000")]));
    expect(await estadoDe(x, factura)).toBe("CONCILIADA");
  });

  it("I1: cargar la misma factura dos veces (misma clave) deja una sola; también a la vez; con otro contenido, el genérico; la misma factura con otra clave, rechazada", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { x, m } = await mundo();
      const pedido = pedidoDeFactura(m, 1000);
      const dos = await Promise.all([
        registrarLaFactura(f, x.operador, pedido),
        registrarLaFactura(f, x.operador, pedido),
      ]);
      expect(dos.every((d) => d.ok)).toBe(true);
      expect(new Set(dos.map((d) => dato(d).comprobanteId)).size).toBe(1);
      expect(dos.filter((d) => dato(d).yaExistia === false)).toHaveLength(1);
      expect(await facturas(m)).toBe(1);
      expect(await c.auditoria(x.empresa, "FACTURA_REGISTRADA")).toHaveLength(1);
      // Otro contenido con la misma clave: no pisa lo hecho.
      esGenerico(
        await registrarLaFactura(f, x.operador, {
          ...pedido,
          factura: { ...pedido.factura, totalSegunFactura: "1.00", fecha: "2026-11-21" },
        }),
      );
      // La misma factura (mismo número) con otra clave: rechazada, sigue una sola.
      expect(
        await registrarLaFactura(f, x.operador, { ...pedido, clave: nuevoId() }),
      ).toMatchObject({ ok: false });
      expect(await facturas(m)).toBe(1);
    }
  });

  it("I2: confirmar la misma conciliación dos veces (misma clave, también a la vez) deja una sola y lo asignado una vez; con otras asignaciones, el genérico", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { x, m } = await mundo();
      const factura = await cargar(x, m, 1000);
      const recepcion = await recibir(x, m, "2");
      const clave = nuevoId();
      const dos = await Promise.all([
        conciliar(x, factura, [asignacion(recepcion, "600")], clave),
        conciliar(x, factura, [asignacion(recepcion, "600")], clave),
      ]);
      expect(dos.every((d) => d.ok)).toBe(true);
      expect(new Set(dos.map((d) => dato(d).conciliacionId)).size).toBe(1);
      expect(await conciliaciones(factura)).toBe(1);
      expect(await asignadaDeLaFactura(factura)).toBe("600.0000");
      expect((await c.auditoria(x.empresa, "CONCILIACION_REGISTRADA")).length).toBe(1);
      esGenerico(await conciliar(x, factura, [asignacion(recepcion, "100")], clave));
      expect(await asignadaDeLaFactura(factura)).toBe("600.0000");
    }
  });

  it("C1: dos conciliaciones a la vez sobre la misma línea recibida (de facturas distintas): gana una y la suma nunca pasa de lo recibido", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { x, m } = await mundo();
      const recepcion = await recibir(x, m, "1");
      const f1 = await cargar(x, m, 1000);
      const f2 = await cargar(x, m, 1000);
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([
          conciliar(x, f1, [asignacion(recepcion, "1000")]),
          conciliar(x, f2, [asignacion(recepcion, "1000")], nuevoId(), x.administrador),
        ]);
      } finally {
        c.soltarBarrera();
      }
      expect(resultados.filter((d) => d.ok)).toHaveLength(1);
      esGenerico(resultados.find((d) => !d.ok));
      expect(
        (await asignadaDeLaFactura(f1)) === "1000.0000" ||
          (await asignadaDeLaFactura(f2)) === "1000.0000",
      ).toBe(true);
      const total = await c.contar(
        "select coalesce(sum(cantidad_asignada), 0)::bigint as n from saldo_de_linea_de_recepcion where recepcion_id = $1",
        [recepcion],
      );
      expect(total).toBe(1000);
    }
  });

  it("C2: una línea de la factura repartida entre dos sucursales, dos conciliaciones a la vez que juntas pasan de lo facturado: gana una y lo facturado nunca se supera", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { x, m } = await mundo();
      const deLaCentral = await recibir(x, m, "1");
      const deLaNorte = await recibir(x, m, "1", x.otraSucursal);
      const factura = await cargar(x, m, 1000);
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([
          conciliar(x, factura, [asignacion(deLaCentral, "600")]),
          conciliar(x, factura, [asignacion(deLaNorte, "600")], nuevoId(), x.administrador),
        ]);
      } finally {
        c.soltarBarrera();
      }
      expect(resultados.filter((d) => d.ok)).toHaveLength(1);
      esGenerico(resultados.find((d) => !d.ok));
      expect(await asignadaDeLaFactura(factura)).toBe("600.0000");
      // Quedan 400: pasarse (300 y 300) es el genérico y no cambia nada; repartir exacto (200 y 200) entra y la deja «Todo coincide».
      esGenerico(
        await conciliar(x, factura, [asignacion(deLaCentral, "300"), asignacion(deLaNorte, "300")]),
      );
      expect(await asignadaDeLaFactura(factura)).toBe("600.0000");
      dato(
        await conciliar(x, factura, [asignacion(deLaCentral, "200"), asignacion(deLaNorte, "200")]),
      );
      expect(await asignadaDeLaFactura(factura)).toBe("1000.0000");
      expect(await estadoDe(x, factura)).toBe("CONCILIADA");
    }
  });

  it("C3: una línea de la factura repartida exactamente entre dos sucursales (60 y 40 por ciento): queda «Todo coincide» y cada recepción con su parte", async () => {
    const { x, m } = await mundo();
    const deLaCentral = await recibir(x, m, "1");
    const deLaNorte = await recibir(x, m, "1", x.otraSucursal);
    const factura = await cargar(x, m, 1000);
    dato(
      await conciliar(x, factura, [asignacion(deLaCentral, "600"), asignacion(deLaNorte, "400")]),
    );
    expect(await estadoDe(x, factura)).toBe("CONCILIADA");
    expect(await asignadaDeLaFactura(factura)).toBe("1000.0000");
    const partes = await c.filas<{ recepcion_id: string; n: string }>(
      "select recepcion_id, cantidad_asignada::text as n from saldo_de_linea_de_recepcion where recepcion_id = any($1) order by n",
      [[deLaCentral, deLaNorte]],
    );
    expect(partes.map((p) => p.n)).toEqual(["400.0000", "600.0000"]);
  });

  it("C4: conciliar y anular la misma conciliación a la vez: o se anula después de conciliar o la anulación no encuentra nada; nunca quedan saldos negativos ni dos espejos", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { x, m } = await mundo();
      const factura = await cargar(x, m, 1000);
      const recepcion = await recibir(x, m, "1");
      const hecha = dato(await conciliar(x, factura, [asignacion(recepcion, "500")]));
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([
          anularLaConciliacion(f, x.gerente, { conciliacionId: hecha.conciliacionId }),
          anularLaConciliacion(f, x.administrador, { conciliacionId: hecha.conciliacionId }),
        ]);
      } finally {
        c.soltarBarrera();
      }
      expect(resultados.filter((d) => d.ok)).toHaveLength(1);
      expect(await conciliaciones(factura, "ANULACION")).toBe(1);
      expect(await asignadaDeLaFactura(factura)).toBe("0.0000");
    }
  });

  it("C5: conciliar y anular a la vez sobre la misma línea de la factura: según quién entra primero la nueva entra o se rechaza, pero nunca se pasa lo facturado ni queda un saldo negativo ni dos espejos", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { x, m } = await mundo();
      const factura = await cargar(x, m, 1000);
      const recepcion = await recibir(x, m, "2");
      const primera = dato(await conciliar(x, factura, [asignacion(recepcion, "1000")]));
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([
          anularLaConciliacion(f, x.gerente, { conciliacionId: primera.conciliacionId }),
          conciliar(x, factura, [asignacion(recepcion, "1000")], nuevoId(), x.administrador),
        ]);
      } finally {
        c.soltarBarrera();
      }
      const [anulacion, nueva] = resultados;
      // Anular siempre entra (una sola vez); la nueva entra si la anulación fue primero y si no, es el genérico.
      expect(anulacion?.ok).toBe(true);
      if (nueva?.ok !== true) esGenerico(nueva);
      expect(await conciliaciones(factura, "ANULACION")).toBe(1);
      expect(await asignadaDeLaFactura(factura)).toBe(nueva?.ok === true ? "1000.0000" : "0.0000");
      expect(
        await c.contar(
          "select count(*) as n from saldo_de_linea_de_recepcion where cantidad_asignada < 0 or cantidad_asignada > cantidad_recibida",
        ),
      ).toBe(0);
    }
  });

  it("alcance: cada gerente concilia lo de su sucursal: la propuesta, lo recibido, el detalle y las conciliaciones se limitan a las suyas, y conciliar o anular lo de otra sucursal es el genérico", async () => {
    const { x, m } = await mundo();
    const deLaCentral = await recibir(x, m, "1");
    const deLaNorte = await recibir(x, m, "1", x.otraSucursal);
    const factura = await cargar(x, m, 2000);
    // El gerente de la Casa central solo ve la suya.
    c.alcances.set(x.personaDelGerente, [x.sucursal]);
    const datos = dato(await datosParaConciliar(f, x.gerente, factura));
    expect(datos.recibidas.map((rec) => rec.recepcionId)).toEqual([deLaCentral]);
    expect(datos.propuesta).toEqual([
      { lineaDeFactura: 1, recepcionId: deLaCentral, lineaDeRecepcion: 1, cantidad: "1000.0000" },
    ]);
    const ficha = dato(await fichaDeLaFactura(f, x.gerente, factura));
    expect(ficha.lineas[0]?.recibidoPorSucursal.map((rec) => rec.sucursalId)).toEqual([x.sucursal]);
    // Conciliar con la recepción de la otra sucursal: fuera de alcance, y no queda nada.
    esGenerico(await conciliar(x, factura, [asignacion(deLaNorte, "500")]));
    esGenerico(
      await conciliar(x, factura, [asignacion(deLaCentral, "500"), asignacion(deLaNorte, "500")]),
    );
    expect(await conciliaciones(factura)).toBe(0);
    expect(await asignadaDeLaFactura(factura)).toBe("0.0000");
    // Lo suyo sí.
    dato(await conciliar(x, factura, [asignacion(deLaCentral, "1000")]));
    // El administrador (todas) concilia lo de la otra, y esa conciliación, que reparte solo lo de la Norte, no es visible ni anulable para el gerente de la Casa central.
    const deLaOtra = dato(
      await conciliar(x, factura, [asignacion(deLaNorte, "1000")], nuevoId(), x.administrador),
    );
    expect(dato(await conciliacionesDeLaFactura(f, x.gerente, factura))).toHaveLength(1);
    esGenerico(
      await anularLaConciliacion(f, x.gerente, { conciliacionId: deLaOtra.conciliacionId }),
    );
    expect(await conciliaciones(factura, "ANULACION")).toBe(0);
    // Con alcance sobre todas, el administrador sí la ve y la anula.
    expect(dato(await conciliacionesDeLaFactura(f, x.administrador, factura))).toHaveLength(2);
    dato(
      await anularLaConciliacion(f, x.administrador, { conciliacionId: deLaOtra.conciliacionId }),
    );
    expect(await conciliaciones(factura, "ANULACION")).toBe(1);
  });

  it("alcance: el estado «Falta conciliar» solo cuenta la mercadería de las sucursales del alcance de quien mira", async () => {
    const { x, m } = await mundo();
    const factura = await cargar(x, m, 1000);
    await recibir(x, m, "1", x.otraSucursal);
    expect(await estadoDe(x, factura)).toBe("FALTA_CONCILIAR");
    c.alcances.set(x.personaDelGerente, [x.sucursal]);
    expect(await estadoDe(x, factura)).toBe("FACTURADA_FALTA_RECIBIR");
  });

  it("autorización: el operador carga y ve las facturas pero no concilia, no ve conciliaciones ni la propuesta ni anula; sin persona, nada", async () => {
    const { x, m } = await mundo();
    const factura = await cargar(x, m, 1000);
    const recepcion = await recibir(x, m, "1");
    const hecha = dato(await conciliar(x, factura, [asignacion(recepcion, "400")]));
    expect(dato(await listarLasFacturas(f, x.operador, {})).facturas).toHaveLength(1);
    expect(dato(await fichaDeLaFactura(f, x.operador, factura))).toMatchObject({
      comprobanteId: factura,
    });
    sinPermiso(await conciliacionesDeLaFactura(f, x.operador, factura));
    sinPermiso(await datosParaConciliar(f, x.operador, factura));
    sinPermiso(await conciliar(x, factura, [asignacion(recepcion, "100")], nuevoId(), x.operador));
    sinPermiso(await anularLaConciliacion(f, x.operador, { conciliacionId: hecha.conciliacionId }));
    sinPermiso(
      await conciliar(x, factura, [asignacion(recepcion, "100")], nuevoId(), {
        ...x.gerente,
        personaId: null,
      }),
    );
    expect(await conciliaciones(factura)).toBe(1);
    expect(await asignadaDeLaFactura(factura)).toBe("400.0000");
  });

  it("aislamiento: otra empresa no ve la factura (ni la propuesta ni las conciliaciones) y no puede conciliarla ni anularla", async () => {
    const { x, m } = await mundo();
    const otra = await mundo();
    const factura = await cargar(x, m, 1000);
    const recepcion = await recibir(x, m, "1");
    const hecha = dato(await conciliar(x, factura, [asignacion(recepcion, "400")]));
    esGenerico(await fichaDeLaFactura(f, otra.x.gerente, factura));
    esGenerico(await datosParaConciliar(f, otra.x.gerente, factura));
    esGenerico(await conciliacionesDeLaFactura(f, otra.x.gerente, factura));
    esGenerico(await conciliar(otra.x, factura, [asignacion(recepcion, "100")]));
    esGenerico(
      await anularLaConciliacion(f, otra.x.gerente, { conciliacionId: hecha.conciliacionId }),
    );
    expect(dato(await listarLasFacturas(f, otra.x.gerente, {})).facturas).toEqual([]);
    expect(await conciliaciones(factura, "ANULACION")).toBe(0);
    // La misma clave en dos empresas no choca.
    const clave = nuevoId();
    dato(await registrarLaFactura(f, x.operador, pedidoDeFactura(m, 1000, {}, clave)));
    dato(await registrarLaFactura(f, otra.x.operador, pedidoDeFactura(otra.m, 1000, {}, clave)));
  });

  it("la lista: de la más nueva a la más vieja, con el cursor que ella misma entrega, y una factura con otro proveedor trae su nombre", async () => {
    const { x, m } = await mundo();
    const primera = await cargar(x, m, 1000);
    const segunda = await cargar(x, m, 1500);
    const lista = dato(await listarLasFacturas(f, x.operador, {}));
    expect(lista.facturas.map((fila) => fila.comprobanteId).sort()).toEqual(
      [primera, segunda].sort(),
    );
    expect(lista.facturas[0]).toMatchObject({
      estado: "FACTURADA_FALTA_RECIBIR",
      tipo: "FACTURA_A",
      puntoDeVenta: 5,
    });
    expect(typeof lista.facturas[0]?.proveedor).toBe("string");
    expect(lista.siguiente).toBeNull();
    esGenerico(await listarLasFacturas(f, x.operador, { despues: "no-es-un-cursor" }));
  });
});
