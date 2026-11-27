import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { codigoDe } from "./concurrencia-apoyo";
import { cuitUnico } from "./entorno";
import { numeroUnico } from "./unicos";

/**
 * Compras N3 (PR C): tomar el costo de la factura. «Recibir» no pide precio: la línea recibida entra sin costo y, ya conciliada, toma el precio neto de la línea de la factura que la cubre (el servidor lo
 * lee, no viene del pedido) con la corrección que completa el precio, el IVA que entra al costo por la regla única y el ajuste del promedio del depósito en la misma transacción. Idempotencia,
 * rechazos, permisos, alcance y aislamiento, atomicidad, dos tomas a la vez, una toma y una anulación de la conciliación a la vez, y la entrada de lo que llega de más después de tomar el costo (que entra
 * al costo vigente y no sin costo).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras N3: tomar el costo de la factura", () => {
  let c: MontajeDeCompras;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    c.encenderPerilla("recepcion_separada");
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

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
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    return { e, deposito, harina, proveedor, cuit: cuitUnico() };
  };
  type M = Awaited<ReturnType<typeof armar>>;

  /** Registra (sin precio, como pide DEC-0903) y confirma una recepción de un renglón. */
  const recibir = async (m: M, kilos: string) => {
    const id = valorDe(
      await c.casos.registrarRecepcion(m.e.operador, {
        clave: nuevoId(),
        sucursalId: m.e.sucursal,
        proveedorId: m.proveedor,
        renglones: [
          {
            productoId: m.harina.producto,
            unidadDeCompraId: "KILOGRAMO",
            cantidad: kilos,
            precioPor: "UNIDAD",
            precio: null,
          },
        ],
      }),
    ).recepcionId;
    valorDe(
      await c.casos.confirmarRecepcion(m.e.gerente, { recepcionId: id, depositoId: m.deposito }),
    );
    return id;
  };
  const cargarFactura = async (m: M, gramos: number, precioNeto = "1", alicuota = "21") =>
    valorDe(
      await c.casos.registrarFactura(m.e.operador, {
        clave: nuevoId(),
        proveedorId: m.proveedor,
        factura: {
          tipo: "FACTURA_A",
          puntoDeVenta: 5,
          numero: numeroUnico(),
          fecha: "2026-10-10",
          lineas: [
            {
              productoId: m.harina.producto,
              cantidadFacturada: String(gramos),
              precioNeto,
              alicuota,
            },
          ],
          totalSegunFactura: (gramos * Number(precioNeto) * (1 + Number(alicuota) / 100)).toFixed(
            2,
          ),
          cuitDelProveedor: m.cuit,
        },
      }),
    );
  const conciliar = (m: M, comprobanteId: string, recepcionId: string, cantidad: string) =>
    c.casos.conciliarFactura(m.e.gerente, {
      clave: nuevoId(),
      comprobanteId,
      asignaciones: [{ lineaDeFactura: 1, recepcionId, lineaDeRecepcion: 1, cantidad }],
    });
  const tomar = (m: M, recepcionId: string, quien = m.e.gerente, clave = nuevoId()) =>
    c.casos.tomarElCosto(quien, { clave, recepcionId, linea: 1 });
  const promedio = async (m: M) =>
    (
      await c.filas<{ costo: string; valorizada: string }>(
        "select costo_unitario::text as costo, cantidad_valorizada::text as valorizada from costo_de_articulo where deposito_id = $1 and articulo_id = $2",
        [m.deposito, m.harina.articulo],
      )
    )[0];
  const tomas = (recepcionId: string) =>
    c.contar("select count(*) as n from correccion_de_compra where recepcion_id = $1", [
      recepcionId,
    ]);
  const ajustes = (m: M) =>
    c.contar(
      "select count(*) as n from auditoria_empresa where accion = 'COSTO_AJUSTADO' and entidad_id = $1",
      [m.harina.articulo],
    );
  const existencia = (m: M) => c.existencia(m.deposito, m.harina.articulo);
  /** Una recepción de 2 kg ya conciliada con una factura de 2000 g a $ 1 el gramo. */
  const conciliada = async (m: M) => {
    const r = await recibir(m, "2");
    const f = await cargarFactura(m, 2000);
    const hecha = valorDe(await conciliar(m, f.comprobanteId, r, "2000"));
    return { r, f, conciliacionId: hecha.conciliacionId };
  };

  it("toma el costo de la factura: corrección con su precio y su motivo en código, promedio del depósito con lo recibido, oferta del proveedor y auditoría", async () => {
    const m = await armar();
    const { r, f } = await conciliada(m);
    expect(await promedio(m)).toBeUndefined();
    const hecha = valorDe(await tomar(m, r));
    expect(hecha).toEqual({ recepcionId: r, linea: 1, numero: 1, yaExistia: false });
    expect(await promedio(m)).toEqual({ costo: "1.000000", valorizada: "2000.0000" });
    const [k] = await c.filas<Record<string, unknown>>(
      "select numero, precio_anterior, precio_nuevo::text as precio, precio_por_tipo, unidad_de_precio_id, motivo, registrado_por from correccion_de_compra where recepcion_id = $1",
      [r],
    );
    expect(k).toMatchObject({
      numero: 1,
      precio_anterior: null,
      precio: "1.000000",
      precio_por_tipo: "UNIDAD",
      unidad_de_precio_id: "GRAMO",
      motivo: `COSTO-TOMADO-DE-LA-FACTURA:${f.comprobanteId}:1`,
      registrado_por: m.e.personaDelGerente,
    });
    expect(
      await c.contar(
        "select count(*) as n from oferta_de_proveedor where proveedor_id = $1 and producto_id = $2 and ultima_compra_id = $3",
        [m.proveedor, m.harina.producto, r],
      ),
    ).toBe(1);
    expect(await ajustes(m)).toBe(1);
    expect((await c.auditoria(m.e.empresa, "COMPRA_CORREGIDA")).at(-1)).toMatchObject({
      actor_persona_id: m.e.personaDelGerente,
      entidad_id: r,
      despues: {
        tipo: "COSTO_TOMADO",
        numero: 1,
        precio: "1.000000",
        costoPorUnidad: "1.000000",
        comprobanteId: f.comprobanteId,
        lineaDeFactura: 1,
      },
    });
  });

  it("el IVA entra al costo según la condición de la empresa: monotributista con una Factura A paga el 21 % dentro del costo", async () => {
    const m = await armar();
    c.fijarCondicionDeIva("MONOTRIBUTO");
    try {
      const { r } = await conciliada(m);
      valorDe(await tomar(m, r));
      expect(await promedio(m)).toEqual({ costo: "1.210000", valorizada: "2000.0000" });
    } finally {
      c.fijarCondicionDeIva("RESPONSABLE_INSCRIPTO");
    }
  });

  it("I1: tomar el costo dos veces (misma clave) deja una sola corrección y un solo ajuste y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA", async () => {
    const m = await armar();
    const { r } = await conciliada(m);
    const clave = nuevoId();
    const primera = valorDe(await tomar(m, r, m.e.gerente, clave));
    const segunda = valorDe(await tomar(m, r, m.e.gerente, clave));
    expect(primera.yaExistia).toBe(false);
    expect(segunda).toEqual({ recepcionId: r, linea: 1, numero: 1, yaExistia: true });
    expect(await tomas(r)).toBe(1);
    expect(await ajustes(m)).toBe(1);
    expect(await promedio(m)).toEqual({ costo: "1.000000", valorizada: "2000.0000" });
    const otra = await conciliada(m);
    expect(codigoDe(await tomar(m, otra.r, m.e.gerente, clave))).toBe("CLAVE_REUTILIZADA");
    expect(await tomas(otra.r)).toBe(0);
  });

  it("repetir con otra clave después de tomada es COSTO_YA_TOMADO y no ajusta de nuevo", async () => {
    const m = await armar();
    const { r } = await conciliada(m);
    valorDe(await tomar(m, r));
    expect(codigoDe(await tomar(m, r))).toBe("COSTO_YA_TOMADO");
    expect(await tomas(r)).toBe(1);
    expect(await ajustes(m)).toBe(1);
  });

  it("sin conciliar entera no hay costo: ni sin conciliar ni conciliada en parte", async () => {
    const m = await armar();
    const r = await recibir(m, "2");
    expect(codigoDe(await tomar(m, r))).toBe("LINEA_NO_CONCILIADA_ENTERA");
    const f = await cargarFactura(m, 2000);
    valorDe(await conciliar(m, f.comprobanteId, r, "1500"));
    expect(codigoDe(await tomar(m, r))).toBe("LINEA_NO_CONCILIADA_ENTERA");
    expect(await tomas(r)).toBe(0);
    expect(await promedio(m)).toBeUndefined();
  });

  it("con dos facturas (dos precios) no hay un costo único: se rechaza y no se escribe nada", async () => {
    const m = await armar();
    const r = await recibir(m, "2");
    const f1 = await cargarFactura(m, 1000, "1");
    const f2 = await cargarFactura(m, 1000, "2");
    valorDe(await conciliar(m, f1.comprobanteId, r, "1000"));
    valorDe(await conciliar(m, f2.comprobanteId, r, "1000"));
    expect(codigoDe(await tomar(m, r))).toBe("COSTO_SIN_FACTURA_UNICA");
    expect(await tomas(r)).toBe(0);
    expect(await promedio(m)).toBeUndefined();
  });

  it("una recepción pendiente, una de otro nivel (N1) o una línea o un pedido que no existen no toman el costo", async () => {
    const m = await armar();
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
            precio: null,
          },
        ],
      }),
    ).recepcionId;
    expect(codigoDe(await tomar(m, pendiente))).toBe("RECEPCION_NO_CONFIRMADA");
    expect(codigoDe(await tomar(m, nuevoId()))).toBe("RECEPCION_NO_ENCONTRADA");
    const pedido = (extra: Record<string, unknown>) =>
      c.casos.tomarElCosto(m.e.gerente, {
        clave: nuevoId(),
        recepcionId: pendiente,
        linea: 1,
        ...extra,
      });
    expect(codigoDe(await pedido({ clave: "no" }))).toBe("IDENTIFICADOR_INVALIDO");
    expect(codigoDe(await pedido({ linea: 0 }))).toBe("LINEA_NO_ENCONTRADA");
    // Una línea que la recepción confirmada no tiene.
    const confirmada = await recibir(m, "1");
    expect(
      codigoDe(
        await c.casos.tomarElCosto(m.e.gerente, {
          clave: nuevoId(),
          recepcionId: confirmada,
          linea: 9,
        }),
      ),
    ).toBe("LINEA_NO_ENCONTRADA");
    // N1: la recepción nace confirmada, con su precio, y de otro nivel: no existe para esta operación.
    const otra = await c.escenario();
    const deposito = await c.deposito(otra);
    const { producto } = await c.articulo(otra, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(otra.operador);
    const compra = valorDe(
      await c.casos.registrarCompra(otra.operador, {
        clave: nuevoId(),
        sucursalId: otra.sucursal,
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
    expect(
      await c.casos.tomarElCosto(otra.gerente, {
        clave: nuevoId(),
        recepcionId: compra.recepcionId,
        linea: 1,
      }),
    ).toEqual({ ok: false, error: "RECEPCION_NO_ENCONTRADA" });
  });

  it("permisos y alcance: el operador no toma el costo; otra empresa no ve la recepción; una sucursal fuera del alcance se rechaza", async () => {
    const m = await armar();
    const { r } = await conciliada(m);
    expect(codigoDe(await tomar(m, r, m.e.operador))).toBe("SIN_PERMISO");
    const otra = await c.escenario();
    expect(codigoDe(await tomar(m, r, otra.gerente))).toBe("RECEPCION_NO_ENCONTRADA");
    c.alcances.set(m.e.personaDelGerente, [m.e.otraSucursal]);
    try {
      expect(codigoDe(await tomar(m, r))).toBe("SUCURSAL_FUERA_DE_ALCANCE");
    } finally {
      c.alcances.set(m.e.personaDelGerente, [m.e.sucursal]);
    }
    expect(await tomas(r)).toBe(0);
    expect(await promedio(m)).toBeUndefined();
    // El administrador sí puede.
    valorDe(await tomar(m, r, m.e.administrador));
    expect(await tomas(r)).toBe(1);
  });

  it("A3: si falla algo después de escribir la corrección (la oferta del proveedor), no queda ni la corrección ni el ajuste del promedio", async () => {
    const m = await armar();
    const { r } = await conciliada(m);
    c.inyectarFalla("oferta");
    try {
      await expect(tomar(m, r)).rejects.toThrow(/falla inyectada/);
    } finally {
      c.inyectarFalla(null);
    }
    expect(await tomas(r)).toBe(0);
    expect(await ajustes(m)).toBe(0);
    expect(await promedio(m)).toBeUndefined();
    // Se puede volver a tomar.
    valorDe(await tomar(m, r));
    expect(await promedio(m)).toEqual({ costo: "1.000000", valorizada: "2000.0000" });
  });

  it("C1: dos tomas a la vez de la misma línea dejan una (la otra es COSTO_YA_TOMADO) y un solo ajuste", async () => {
    const m = await armar();
    const { r } = await conciliada(m);
    c.armarBarrera(2);
    let rs;
    try {
      rs = await Promise.all([tomar(m, r, m.e.gerente), tomar(m, r, m.e.administrador)]);
    } finally {
      c.soltarBarrera();
    }
    expect(rs.filter((x) => x.ok)).toHaveLength(1);
    expect(rs.filter((x) => !x.ok).map((x) => (x.ok ? "" : x.error))).toEqual(["COSTO_YA_TOMADO"]);
    expect(await tomas(r)).toBe(1);
    expect(await ajustes(m)).toBe(1);
    expect(await promedio(m)).toEqual({ costo: "1.000000", valorizada: "2000.0000" });
  });

  it("C2: tomar el costo y anular la conciliación a la vez: o gana la anulación (y no hay costo) o ganó la toma (y el costo queda); nunca un costo sin saldo ni dos ajustes", async () => {
    const m = await armar();
    const { r, conciliacionId } = await conciliada(m);
    c.armarBarrera(2);
    let rs;
    try {
      rs = await Promise.all([
        tomar(m, r, m.e.gerente),
        c.casos.anularConciliacion(m.e.administrador, { conciliacionId }),
      ]);
    } finally {
      c.soltarBarrera();
    }
    const toma = rs[0];
    const hechas = await tomas(r);
    if (toma.ok) {
      expect(hechas).toBe(1);
      expect(await promedio(m)).toEqual({ costo: "1.000000", valorizada: "2000.0000" });
    } else {
      expect(codigoDe(toma)).toBe("LINEA_NO_CONCILIADA_ENTERA");
      expect(hechas).toBe(0);
      expect(await promedio(m)).toBeUndefined();
    }
    expect(await ajustes(m)).toBe(hechas);
  });

  it("DEC-0941: con el costo tomado, anular la conciliación se puede y el costo queda: es de la línea recibida, no de la conciliación", async () => {
    const m = await armar();
    const { r, f, conciliacionId } = await conciliada(m);
    valorDe(await tomar(m, r));
    valorDe(await c.casos.anularConciliacion(m.e.gerente, { conciliacionId }));
    expect(await promedio(m)).toEqual({ costo: "1.000000", valorizada: "2000.0000" });
    expect(await tomas(r)).toBe(1);
    // Ya tiene costo: no se vuelve a tomar aunque se reconcilie.
    valorDe(await conciliar(m, f.comprobanteId, r, "2000"));
    expect(codigoDe(await tomar(m, r))).toBe("COSTO_YA_TOMADO");
  });

  it("corregir a menos de lo conciliado con el costo tomado: anular, corregir, reconciliar, y el costo se conserva (la salida sale al promedio)", async () => {
    const m = await armar();
    const { r, f, conciliacionId } = await conciliada(m);
    valorDe(await tomar(m, r));
    const bajo = await c.casos.corregirLoRecibido(m.e.gerente, {
      clave: nuevoId(),
      recepcionId: r,
      linea: 1,
      correccionesVistas: 0,
      cantidad: "1500",
      causa: "FALTANTE_DEL_PROVEEDOR",
    });
    expect(codigoDe(bajo)).toBe("CORRECCION_BAJO_LO_CONCILIADO");
    valorDe(await c.casos.anularConciliacion(m.e.gerente, { conciliacionId }));
    valorDe(
      await c.casos.corregirLoRecibido(m.e.gerente, {
        clave: nuevoId(),
        recepcionId: r,
        linea: 1,
        correccionesVistas: 0,
        cantidad: "1500",
        causa: "FALTANTE_DEL_PROVEEDOR",
      }),
    );
    expect(await existencia(m)).toBe("1500.0000");
    expect(await promedio(m)).toEqual({ costo: "1.000000", valorizada: "1500.0000" });
    valorDe(await conciliar(m, f.comprobanteId, r, "1500"));
  });

  it("hallazgo: lo que llega de más después de tomar el costo entra al costo vigente (no sin costo, que desvirtuaría el promedio)", async () => {
    const m = await armar();
    const { r, conciliacionId } = await conciliada(m);
    valorDe(await tomar(m, r));
    valorDe(await c.casos.anularConciliacion(m.e.gerente, { conciliacionId }));
    valorDe(
      await c.casos.corregirLoRecibido(m.e.gerente, {
        clave: nuevoId(),
        recepcionId: r,
        linea: 1,
        correccionesVistas: 0,
        cantidad: "2600",
        causa: "REPARTO_INTERNO",
      }),
    );
    expect(await existencia(m)).toBe("2600.0000");
    expect(await promedio(m)).toEqual({ costo: "1.000000", valorizada: "2600.0000" });
  });

  it("el costo se toma sobre lo recibido vigente: una corrección de lo recibido previa cambia la cantidad que se valoriza", async () => {
    const m = await armar();
    const r = await recibir(m, "2");
    valorDe(
      await c.casos.corregirLoRecibido(m.e.gerente, {
        clave: nuevoId(),
        recepcionId: r,
        linea: 1,
        correccionesVistas: 0,
        cantidad: "1500",
        causa: "ERROR_DE_CARGA",
      }),
    );
    const f = await cargarFactura(m, 1500);
    valorDe(await conciliar(m, f.comprobanteId, r, "1500"));
    valorDe(await tomar(m, r));
    expect(await existencia(m)).toBe("1500.0000");
    expect(await promedio(m)).toEqual({ costo: "1.000000", valorizada: "1500.0000" });
  });

  it("lo que ya se consumió antes de tomar el costo conserva su costo: el promedio se corrige solo sobre lo que queda", async () => {
    const m = await armar();
    const { r } = await conciliada(m);
    // Sale la mitad (sin costo todavía) antes de tomar el costo.
    valorDe(
      await c.stockCasos.registrarSalida(m.e.gerente, {
        clave: nuevoId(),
        depositoId: m.deposito,
        motivo: "CONSUMO_INTERNO",
        renglones: [{ productoId: m.harina.producto, cantidad: "1000", unidadId: "GRAMO" }],
      }),
    );
    expect(await existencia(m)).toBe("1000.0000");
    valorDe(await tomar(m, r));
    expect(await promedio(m)).toEqual({ costo: "1.000000", valorizada: "1000.0000" });
  });

  it("hallazgo de Stock: lo valorizado nunca pasa de lo que hay (una carga sin costo consumida, luego una compra con costo, y después se toma el costo de la primera)", async () => {
    const m = await armar();
    // A (2 kg) entra sin costo y se consumen 1,5 kg; después entra B (1 kg) con su costo: 1,5 kg de existencia, 1 kg valorizado.
    const a = await conciliada(m);
    valorDe(
      await c.stockCasos.registrarSalida(m.e.gerente, {
        clave: nuevoId(),
        depositoId: m.deposito,
        motivo: "CONSUMO_INTERNO",
        renglones: [{ productoId: m.harina.producto, cantidad: "1500", unidadId: "GRAMO" }],
      }),
    );
    const b = valorDe(
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
            unidadDePrecioId: "GRAMO",
            precio: "3",
          },
        ],
      }),
    ).recepcionId;
    valorDe(
      await c.casos.confirmarRecepcion(m.e.gerente, { recepcionId: b, depositoId: m.deposito }),
    );
    expect(await existencia(m)).toBe("1500.0000");
    expect(await promedio(m)).toEqual({ costo: "3.000000", valorizada: "1000.0000" });
    valorDe(await tomar(m, a.r));
    const estado = await promedio(m);
    expect(Number(estado?.valorizada)).toBeLessThanOrEqual(Number(await existencia(m)));
    expect(estado?.valorizada).toBe("1500.0000");
  });
});
