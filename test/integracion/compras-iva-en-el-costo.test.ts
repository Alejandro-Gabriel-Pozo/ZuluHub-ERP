import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearIvaDeLaEmpresa } from "../../src/composicion/iva-de-la-empresa";
import { ok } from "../../src/primitivas/resultado/resultado";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import { codigoDe } from "./concurrencia-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { cuitUnico } from "./entorno";
import { crearDomicilio } from "./fiscal-apoyo";
import { numeroUnico } from "./unicos";

/**
 * E9-T15 (DEC-0322, decisión del dueño del 11/11/2026): el IVA como costo o como crédito fiscal según la condición de la EMPRESA frente al IVA. Las cuatro combinaciones
 * condición × letra, la alícuota, el redondeo (una sola vez), «no se puede leer la condición» (la compra con IVA discriminado no se registra) y que la corrección de
 * precio usa la misma regla. Más el adaptador real de la composición (los datos fiscales confirmados del emisor principal).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type Condicion = "RESPONSABLE_INSCRIPTO" | "MONOTRIBUTO" | "EXENTO";

describe.skipIf(base === null)("compras: IVA al costo según la condición de la empresa", () => {
  let c: MontajeDeCompras;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  /** Una empresa en nivel «con comprobante» con un proveedor que tiene el punto de venta 5 declarado. */
  const armar = async () => {
    const e: EscenarioDeCompras = await c.escenario();
    valorDe(
      await c.casos.configurarCompras(e.gerente, { nivel: "CON_COMPROBANTE", versionEsperada: 1 }),
    );
    const deposito = await c.deposito(e);
    const { producto, articulo } = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    // El CUIT del proveedor se fija una vez: otro en una segunda factura sería PROVEEDOR_CON_OTRO_DOCUMENTO.
    return { e, deposito, producto, articulo, proveedor, cuit: cuitUnico() };
  };
  type Montaje = Awaited<ReturnType<typeof armar>>;

  /** 2 kg a 1000 el kilo (neto 2000,00): entran 2000 g. Con A, IVA 21 % (total 2420,00); con B o C, sin IVA discriminado (total 2000,00). */
  const compra = (m: Montaje, tipo: string, alicuota: string | null = "21", precio = "1000") => {
    const neto = Number(precio) * 2;
    const iva =
      alicuota === null || Number.isNaN(Number(alicuota)) ? 0 : (neto * Number(alicuota)) / 100;
    return {
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
          precio,
        },
      ],
      factura: {
        tipo,
        puntoDeVenta: 5,
        numero: numeroUnico(),
        fecha: "2026-10-10",
        lineas: [
          {
            renglon: 1,
            cantidadFacturada: "2000",
            precioNeto: String(Number(precio) / 1000),
            alicuota,
          },
        ],
        totalSegunFactura: (neto + iva).toFixed(2),
        cuitDelProveedor: m.cuit,
      },
    };
  };
  const registrar = async (
    m: Montaje,
    condicion: Condicion | null,
    tipo: string,
    alicuota: string | null = "21",
    precio = "1000",
  ) => {
    c.fijarCondicionDeIva(condicion);
    const r = await c.casos.registrarCompraConFactura(
      m.e.operador,
      compra(m, tipo, alicuota, precio),
    );
    return r;
  };
  const costoDeLaLinea = async (recepcionId: string) =>
    (
      await c.filas<{ costo: string; importe: string }>(
        "select costo_por_unidad_de_stock::text as costo, importe::text as importe from linea_de_recepcion where recepcion_id = $1",
        [recepcionId],
      )
    )[0];
  const promedio = async (m: Montaje) =>
    (
      await c.filas<{ costo: string }>(
        "select costo_unitario::text as costo from costo_de_articulo where deposito_id = $1 and articulo_id = $2",
        [m.deposito, m.articulo],
      )
    )[0]?.costo;
  const credito = async (comprobanteId: string) =>
    (
      await c.filas<{ credito: string; iva: string }>(
        "select credito_fiscal_computable::text as credito, iva::text as iva from comprobante_de_proveedor where id = $1",
        [comprobanteId],
      )
    )[0];

  it("Factura A: inscripto → costo neto y crédito fiscal = IVA; monotributista o exento → costo con IVA incluido y crédito cero", async () => {
    const esperado: [Condicion, string, string][] = [
      ["RESPONSABLE_INSCRIPTO", "1.000000", "420.00"],
      ["MONOTRIBUTO", "1.210000", "0.00"],
      ["EXENTO", "1.210000", "0.00"],
    ];
    for (const [condicion, costo, creditoFiscal] of esperado) {
      const m = await armar();
      const r = valorDe(await registrar(m, condicion, "FACTURA_A"));
      expect(await costoDeLaLinea(r.recepcionId), condicion).toEqual({ costo, importe: "2000.00" });
      expect(await promedio(m), condicion).toBe(costo);
      expect(await credito(r.comprobanteId as string), condicion).toEqual({
        credito: creditoFiscal,
        iva: "420.00",
      });
    }
  });

  it("Factura B o C: el costo es el importe de la línea con cualquier condición y el crédito fiscal es cero", async () => {
    for (const tipo of ["FACTURA_B", "FACTURA_C"]) {
      for (const condicion of ["RESPONSABLE_INSCRIPTO", "MONOTRIBUTO", "EXENTO"] as const) {
        const m = await armar();
        const r = valorDe(await registrar(m, condicion, tipo, null));
        expect(await costoDeLaLinea(r.recepcionId), `${tipo} ${condicion}`).toEqual({
          costo: "1.000000",
          importe: "2000.00",
        });
        expect(await credito(r.comprobanteId as string)).toEqual({ credito: "0.00", iva: "0.00" });
      }
    }
  });

  it("la alícuota de la línea manda: 10,5 % con IVA al costo da 1,105; exento y no gravado no suman", async () => {
    const m = await armar();
    const r = valorDe(await registrar(m, "MONOTRIBUTO", "FACTURA_A", "10.5"));
    expect((await costoDeLaLinea(r.recepcionId))?.costo).toBe("1.105000");
    for (const alicuota of ["EXENTO", "NO_GRAVADO", "0"]) {
      const otra = await armar();
      const x = valorDe(await registrar(otra, "EXENTO", "FACTURA_A", alicuota));
      expect((await costoDeLaLinea(x.recepcionId))?.costo, alicuota).toBe("1.000000");
    }
  });

  it("sin factura (compra simple, N1) la condición no se lee y el costo es el precio cargado", async () => {
    const e = await c.escenario();
    const deposito = await c.deposito(e);
    const { producto } = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador);
    c.fijarCondicionDeIva(null);
    const r = valorDe(
      await c.casos.registrarCompra(e.operador, {
        clave: nuevoId(),
        sucursalId: e.sucursal,
        proveedorId: proveedor,
        depositoId: deposito,
        renglones: [
          {
            productoId: producto,
            unidadDeCompraId: "KILOGRAMO",
            cantidad: "2",
            precioPor: "UNIDAD",
            unidadDePrecioId: "KILOGRAMO",
            precio: "1000",
          },
        ],
      }),
    );
    expect((await costoDeLaLinea(r.recepcionId))?.costo).toBe("1.000000");
  });

  it("si la condición de la empresa no se puede leer, la compra con IVA discriminado NO se registra (y una B o C sí)", async () => {
    const m = await armar();
    const antes = await c.contar("select count(*) as n from recepcion where proveedor_id = $1", [
      m.proveedor,
    ]);
    const stockAntes = await promedio(m);
    expect(await registrar(m, null, "FACTURA_A")).toEqual({
      ok: false,
      error: "CONDICION_DE_IVA_NO_DISPONIBLE",
    });
    expect(
      await c.contar("select count(*) as n from recepcion where proveedor_id = $1", [m.proveedor]),
    ).toBe(antes);
    expect(await promedio(m)).toBe(stockAntes);
    expect(
      await c.contar("select count(*) as n from comprobante_de_proveedor where proveedor_id = $1", [
        m.proveedor,
      ]),
    ).toBe(0);
    expect((await registrar(m, null, "FACTURA_B", null)).ok).toBe(true);
  });

  it("repetir la compra (misma clave) no cambia el costo; cambiar la condición entre medio es otra huella solo si cambia el pedido", async () => {
    const m = await armar();
    const pedido = compra(m, "FACTURA_A");
    c.fijarCondicionDeIva("MONOTRIBUTO");
    const primero = valorDe(await c.casos.registrarCompraConFactura(m.e.operador, pedido));
    c.fijarCondicionDeIva("RESPONSABLE_INSCRIPTO");
    const segundo = valorDe(await c.casos.registrarCompraConFactura(m.e.operador, pedido));
    expect(segundo).toMatchObject({ recepcionId: primero.recepcionId, yaExistia: true });
    expect((await costoDeLaLinea(primero.recepcionId))?.costo).toBe("1.210000");
  });

  it("la corrección de precio usa la MISMA regla: monotributista, 1000 → 1200 da un costo de 1,452 y el promedio pasa de 1,21 a 1,452", async () => {
    const m = await armar();
    const r = valorDe(await registrar(m, "MONOTRIBUTO", "FACTURA_A"));
    c.fijarCondicionDeIva("MONOTRIBUTO");
    const salida = valorDe(
      await c.casos.corregirCompra(m.e.gerente, {
        clave: nuevoId(),
        recepcionId: r.recepcionId,
        linea: 1,
        correccionesVistas: 0,
        precio: "1200",
        motivo: "El proveedor cobró 1200 el kilo",
      }),
    );
    expect(salida.ajuste).toMatchObject({
      costoPorUnidadAntes: "1.210000",
      costoPorUnidadDespues: "1.452000",
      promedioAntes: "1.210000",
      promedioDespues: "1.452000",
    });
    expect(await promedio(m)).toBe("1.452000");
  });

  it("la corrección en una empresa inscripta corrige sobre el neto, y en una compra con B o C sobre el importe de la línea", async () => {
    const inscripta = await armar();
    const a = valorDe(await registrar(inscripta, "RESPONSABLE_INSCRIPTO", "FACTURA_A"));
    const corr = (recepcionId: string) => ({
      clave: nuevoId(),
      recepcionId,
      linea: 1,
      correccionesVistas: 0,
      precio: "1200",
      motivo: "Corrección de precio",
    });
    expect(
      valorDe(await c.casos.corregirCompra(inscripta.e.gerente, corr(a.recepcionId))).ajuste,
    ).toMatchObject({
      costoPorUnidadAntes: "1.000000",
      costoPorUnidadDespues: "1.200000",
    });
    const b = await armar();
    const rb = valorDe(await registrar(b, "MONOTRIBUTO", "FACTURA_B", null));
    expect(
      valorDe(await c.casos.corregirCompra(b.e.gerente, corr(rb.recepcionId))).ajuste,
    ).toMatchObject({
      costoPorUnidadAntes: "1.000000",
      costoPorUnidadDespues: "1.200000",
    });
  });

  it("corregir una compra con IVA discriminado sin poder leer la condición NO escribe nada (CONDICION_DE_IVA_NO_DISPONIBLE)", async () => {
    const m = await armar();
    const r = valorDe(await registrar(m, "MONOTRIBUTO", "FACTURA_A"));
    c.fijarCondicionDeIva(null);
    expect(
      await c.casos.corregirCompra(m.e.gerente, {
        clave: nuevoId(),
        recepcionId: r.recepcionId,
        linea: 1,
        correccionesVistas: 0,
        precio: "1200",
        motivo: "Corrección de precio",
      }),
    ).toEqual({ ok: false, error: "CONDICION_DE_IVA_NO_DISPONIBLE" });
    expect(
      await c.contar("select count(*) as n from correccion_de_compra where recepcion_id = $1", [
        r.recepcionId,
      ]),
    ).toBe(0);
    expect(await promedio(m)).toBe("1.210000");
  });

  it("concurrencia: dos compras con IVA al costo del mismo producto a la vez dejan el promedio de las dos", async () => {
    for (let ronda = 0; ronda < Math.min(RONDAS, 10); ronda++) {
      const m = await armar();
      c.fijarCondicionDeIva("MONOTRIBUTO");
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([
          c.casos.registrarCompraConFactura(m.e.operador, compra(m, "FACTURA_A")),
          c.casos.registrarCompraConFactura(m.e.operador, compra(m, "FACTURA_A")),
        ]);
      } finally {
        c.soltarBarrera();
      }
      for (const x of resultados) expect(x.ok || codigoDe(x) === "ConcurrenciaAgotada").toBe(true);
      if (resultados.every((x) => x.ok)) expect(await promedio(m)).toBe("1.210000");
    }
  });

  describe("el adaptador real de la composición (datos fiscales confirmados del emisor principal)", () => {
    const leer = async (e: EscenarioDeCompras) => {
      const r = await c.entorno.ejecutar({ contexto: e.gerente }, async (tx) =>
        ok(await crearIvaDeLaEmpresa().condicion(tx as never, e.gerente)),
      );
      if (!r.ok) throw new Error(`no se pudo leer la condición: ${JSON.stringify(r.error)}`);
      return r.valor;
    };
    const datos = async (
      e: EscenarioDeCompras,
      condicion: string,
      confirmar: boolean,
      numero = 1,
    ) => {
      const emisor = (
        await c.filas<{ id: string }>(
          "select id from emisor where empresa_id = $1 and es_principal",
          [e.empresa],
        )
      )[0]?.id as string;
      const domicilio = await crearDomicilio(c.dueno, e.empresa);
      const id = nuevoId();
      await c.dueno.query(
        `insert into datos_fiscales (id, empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id, inicio_actividades, iibb_numero, iibb_condicion, creado_por)
         values ($1, $2, $3, 'Panadería Zulú SA', $4, $5, '2020-01-01', '901-123456-7', 'LOCAL', $6)`,
        [id, e.empresa, emisor, condicion, domicilio, e.personaDelGerente],
      );
      if (confirmar) {
        await c.dueno.query(
          `update datos_fiscales set estado = 'CONFIRMADA', numero = $3, vigente_desde = now(), confirmada_en = now(), confirmada_por = $2, motivo = 'alta' where id = $1`,
          [id, e.personaDelGerente, numero],
        );
      }
    };

    it("sin datos fiscales, o con uno solo en borrador, no se puede leer (null)", async () => {
      const e = await c.escenario();
      expect(await leer(e)).toBeNull();
      await datos(e, "MONOTRIBUTO", false);
      expect(await leer(e)).toBeNull();
    });

    it("con datos confirmados devuelve la condición del emisor principal", async () => {
      for (const condicion of ["RESPONSABLE_INSCRIPTO", "MONOTRIBUTO", "EXENTO"] as const) {
        const e = await c.escenario();
        await datos(e, condicion, true);
        expect(await leer(e), condicion).toBe(condicion);
      }
    });

    it("no ve los datos de otra empresa", async () => {
      const una = await c.escenario();
      const otra = await c.escenario();
      await datos(una, "MONOTRIBUTO", true);
      expect(await leer(otra)).toBeNull();
      expect(await leer(una)).toBe("MONOTRIBUTO");
    });
  });
});
