import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { codigoDe } from "./concurrencia-apoyo";
import { cuitUnico } from "./entorno";
import { numeroUnico } from "./unicos";

/**
 * P3: el pago de una factura es el NETO (total − notas de crédito vigentes), leído bajo el bloqueo de la factura. Sin notas paga lo mismo que antes; con notas paga el neto (también lo que sale de la caja y lo que asienta
 * el libro); si las notas lo acreditan todo no hay pago, ni egreso, ni asiento; un pago de varios medios se compara con el neto y no con el total; reintentar el mismo gesto después de una nota devuelve el pago ya hecho
 * (la huella no lleva el neto); una nota que el pago ya descontó no se anula sin anular antes el pago; y dos actores a la vez (pago y nota) dejan siempre «pagó el neto con la nota» o «pagó el total y la nota quedó a favor».
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras: el pago por el neto", () => {
  let c: MontajeDeCompras;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    c.encenderPerilla("recepcion_separada");
    c.encenderPerilla("conciliacion_de_tres_vias");
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const codigo = (r: Parameters<typeof codigoDe>[0]): string =>
    !r.ok && typeof r.error === "object" && r.error !== null && "error" in r.error
      ? String(r.error.error)
      : codigoDe(r);

  /** Una compra con su factura de 2420,00 (2000 neto + IVA 21 %), con caja abierta de su sucursal; la empresa queda en N4 para poder cargar notas. */
  const armar = async () => {
    const e: EscenarioDeCompras = await c.escenario();
    valorDe(
      await c.casos.configurarCompras(e.gerente, { nivel: "CON_COMPROBANTE", versionEsperada: 1 }),
    );
    const deposito = await c.deposito(e);
    const { producto } = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    const r = valorDe(
      await c.casos.registrarCompraConFactura(e.operador, {
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
        factura: {
          tipo: "FACTURA_A",
          puntoDeVenta: 5,
          numero: numeroUnico(),
          fecha: "2026-10-10",
          lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto: "1", alicuota: "21" }],
          totalSegunFactura: "2420.00",
          cuitDelProveedor: cuitUnico(),
        },
      }),
    );
    const caja = await c.cajaAbierta(e);
    // Las notas de crédito se cargan en N4: se sube el nivel DESPUÉS de la compra (lo ya cargado no se toca).
    valorDe(await c.casos.configurarCompras(e.gerente, { nivel: "TRES_VIAS", versionEsperada: 2 }));
    return {
      e,
      caja,
      proveedor,
      comprobanteId: r.comprobanteId as string,
      recepcionId: r.recepcionId,
    };
  };
  type M = Awaited<ReturnType<typeof armar>>;

  const porTotal = (total: string) => ({
    tipo: "NOTA_CREDITO_A",
    puntoDeVenta: 5,
    numero: numeroUnico(),
    fecha: "2026-11-10",
    importes: [{ alicuota: "0", neto: total }],
    totalSegunNota: total,
  });
  const cargarNota = (m: M, total: string) =>
    c.casos.registrarNotaDeCredito(m.e.gerente, {
      clave: nuevoId(),
      proveedorId: m.proveedor,
      facturaId: m.comprobanteId,
      nota: porTotal(total),
    });
  const anularNota = (m: M, comprobanteId: string) =>
    c.casos.anularNotaDeCredito(m.e.gerente, { comprobanteId, motivo: "Se cargó mal" });
  const salida = (m: M) => ({ cajaId: m.caja.cajaId, motivo: "Pago de la factura en efectivo" });
  /** Un pago en efectivo por el neto (un medio sin importe), con su caja. */
  const pagar = (m: M, clave = nuevoId()) =>
    c.casos.declararPago(m.e.gerente, {
      clave,
      comprobanteId: m.comprobanteId,
      fechaDePago: "2026-10-11",
      medio: "EFECTIVO",
      salidaDeCaja: salida(m),
    });
  const pagarConMedios = (m: M, medios: { medio: string; importe: string }[]) =>
    c.casos.declararPago(m.e.gerente, {
      clave: nuevoId(),
      comprobanteId: m.comprobanteId,
      fechaDePago: "2026-10-11",
      medios,
      salidaDeCaja: salida(m),
    });
  const pagos = (m: M) =>
    c.filas<{ id: string; importe: string; estado: string }>(
      "select id, importe::text as importe, estado from pago_de_comprobante where comprobante_id = $1 order by registrado_en",
      [m.comprobanteId],
    );
  const movimientos = (m: M) =>
    c.contar("select count(*) as n from movimiento_caja where sesion_id = $1", [m.caja.sesionId]);
  const caja = async (m: M) =>
    (
      await c.filas<{ t: string }>(
        "select coalesce(sum(importe), 0)::text as t from movimiento_caja where sesion_id = $1",
        [m.caja.sesionId],
      )
    )[0]?.t;
  const asientosDePago = (m: M) =>
    c.contar(
      `select count(*) as n from asiento_de_saldo a join pago_de_comprobante p on p.id = a.origen_id
        where a.origen_tipo = 'compras.pago' and p.comprobante_id = $1`,
      [m.comprobanteId],
    );
  const saldo = async (m: M) =>
    (
      await c.filas<{ s: string }>(
        "select saldo::text as s from saldo_de_parte where parte_id = $1 and sentido = 'A_PAGAR'",
        [m.proveedor],
      )
    )[0]?.s ?? "0.00";
  const estadoDe = async (id: string) =>
    (
      await c.filas<{ estado: string }>(
        "select estado from comprobante_de_proveedor where id = $1",
        [id],
      )
    )[0]?.estado;

  it("sin notas paga el total, igual que antes: el pago, la caja y el libro son 2420,00", async () => {
    const m = await armar();
    const antes = Number(await caja(m));
    valorDe(await pagar(m));
    expect((await pagos(m)).map((p) => p.importe)).toEqual(["2420.00"]);
    expect(Number(await caja(m))).toBe(antes - 2420);
    expect(await saldo(m)).toBe("0.00");
  });

  it("con una nota parcial paga el neto: el pago, el egreso de la caja y el asiento del libro son 2000,00 y el saldo queda en cero", async () => {
    const m = await armar();
    const antes = Number(await caja(m));
    valorDe(await cargarNota(m, "420.00"));
    valorDe(await pagar(m));
    expect((await pagos(m)).map((p) => p.importe)).toEqual(["2000.00"]);
    expect(Number(await caja(m))).toBe(antes - 2000);
    const [asiento] = await c.filas<{ importe: string }>(
      `select a.importe::text as importe from asiento_de_saldo a join pago_de_comprobante p on p.id = a.origen_id
        where a.origen_tipo = 'compras.pago' and p.comprobante_id = $1 and a.naturaleza = 'ORIGINAL'`,
      [m.comprobanteId],
    );
    expect(asiento?.importe).toBe("-2000.00");
    expect(await saldo(m)).toBe("0.00");
    const ficha = valorDe(
      await c.consultas.fichaDeCompra(m.e.gerente, { recepcionId: m.recepcionId }),
    );
    expect(ficha?.comprobante).toMatchObject({ totalSegunFactura: "2420.00" });
    expect(ficha?.pagos).toMatchObject([{ importe: "2000.00" }]);
  });

  it("la ficha muestra lo que hay que pagar (el neto) y el servidor lo calcula: sin notas el total, con una nota el total menos la nota", async () => {
    const m = await armar();
    const antes = valorDe(
      await c.consultas.fichaDeCompra(m.e.gerente, { recepcionId: m.recepcionId }),
    );
    expect(antes?.comprobante?.netoAPagar).toBe("2420.00");
    valorDe(await cargarNota(m, "420.00"));
    const despues = valorDe(
      await c.consultas.fichaDeCompra(m.e.gerente, { recepcionId: m.recepcionId }),
    );
    expect(despues?.comprobante?.netoAPagar).toBe("2000.00");
  });

  it("si las notas lo acreditan todo no hay nada para pagar: ni pago, ni salida de caja, ni asiento", async () => {
    const m = await armar();
    valorDe(await cargarNota(m, "2420.00"));
    const movimientosAntes = await movimientos(m);
    expect(codigo(await pagar(m))).toBe("NADA_PARA_PAGAR");
    expect(await pagos(m)).toEqual([]);
    expect(await movimientos(m)).toBe(movimientosAntes);
    expect(await asientosDePago(m)).toBe(0);
    expect(await saldo(m)).toBe("0.00");
  });

  it("varios medios: la suma se compara con el neto y no con el total; con una nota en el medio, la suma del total se rechaza y no queda nada", async () => {
    const m = await armar();
    valorDe(await cargarNota(m, "420.00"));
    const delTotal = [
      { medio: "EFECTIVO", importe: "1000.00" },
      { medio: "QR", importe: "1420.00" },
    ];
    const movimientosAntes = await movimientos(m);
    expect(codigo(await pagarConMedios(m, delTotal))).toBe("LA_SUMA_DE_LOS_MEDIOS_NO_ES_EL_TOTAL");
    expect(await pagos(m)).toEqual([]);
    expect(await movimientos(m)).toBe(movimientosAntes);
    expect(await asientosDePago(m)).toBe(0);
    valorDe(
      await pagarConMedios(m, [
        { medio: "EFECTIVO", importe: "1000.00" },
        { medio: "QR", importe: "1000.00" },
      ]),
    );
    expect((await pagos(m)).map((p) => p.importe)).toEqual(["2000.00"]);
  });

  it("una nota DESPUÉS del pago: el pago no cambia (2420,00) y la nota queda como saldo a favor", async () => {
    const m = await armar();
    valorDe(await pagar(m));
    valorDe(await cargarNota(m, "420.00"));
    expect((await pagos(m)).map((p) => p.importe)).toEqual(["2420.00"]);
    expect(await saldo(m)).toBe("-420.00");
  });

  it("I: reintentar el mismo pago (misma clave) después de que llegó una nota devuelve el pago ya hecho, con su importe original, sin segundo pago, egreso ni asiento; con otro contenido, CLAVE_REUTILIZADA", async () => {
    const m = await armar();
    const clave = nuevoId();
    const primero = valorDe(await pagar(m, clave));
    valorDe(await cargarNota(m, "420.00"));
    const movimientosAntes = await movimientos(m);
    const otra = valorDe(await pagar(m, clave));
    expect(otra).toMatchObject({ pagoId: primero.pagoId, yaExistia: true });
    expect((await pagos(m)).map((p) => p.importe)).toEqual(["2420.00"]);
    expect(await movimientos(m)).toBe(movimientosAntes);
    expect(await asientosDePago(m)).toBe(1);
    expect(
      codigo(
        await c.casos.declararPago(m.e.gerente, {
          clave,
          comprobanteId: m.comprobanteId,
          fechaDePago: "2026-10-11",
          medio: "TRANSFERENCIA",
        }),
      ),
    ).toBe("CLAVE_REUTILIZADA");
  });

  it("I: el mismo pago dos veces a la vez (misma clave) deja UN pago, UN egreso y UN asiento por el neto", async () => {
    const m = await armar();
    valorDe(await cargarNota(m, "420.00"));
    const clave = nuevoId();
    c.armarBarrera(2);
    let resultados;
    try {
      resultados = await Promise.all([pagar(m, clave), pagar(m, clave)]);
    } finally {
      c.soltarBarrera();
    }
    const ids = new Set(resultados.flatMap((r) => (r.ok ? [r.valor.pagoId] : [])));
    expect(ids.size).toBe(1);
    expect((await pagos(m)).map((p) => p.importe)).toEqual(["2000.00"]);
    expect(await asientosDePago(m)).toBe(1);
  });

  it("anular una nota que el pago ya descontó se rechaza (NOTA_DE_CREDITO_CON_PAGO); una que llegó después del pago se anula; con el pago anulado la nota se anula", async () => {
    const m = await armar();
    const nota = valorDe(await cargarNota(m, "420.00"));
    const pago = valorDe(await pagar(m));
    expect(codigo(await anularNota(m, nota.comprobanteId))).toBe("NOTA_DE_CREDITO_CON_PAGO");
    expect(await estadoDe(nota.comprobanteId)).toBe("REGISTRADO");
    valorDe(await c.casos.anularPago(m.e.gerente, { pagoId: pago.pagoId, motivo: "Mal cargado" }));
    valorDe(await anularNota(m, nota.comprobanteId));
    expect(await estadoDe(nota.comprobanteId)).toBe("ANULADO");

    const n = await armar();
    valorDe(await pagar(n));
    const tardia = valorDe(await cargarNota(n, "420.00"));
    valorDe(await anularNota(n, tardia.comprobanteId));
    expect(await estadoDe(tardia.comprobanteId)).toBe("ANULADO");
    expect(await saldo(n)).toBe("0.00");
  });

  it("C: el pago y una nota a la vez, en cualquier orden de llegada: o pagó el neto con la nota o pagó el total y la nota quedó a favor; nunca un importe a medias ni un egreso distinto del pago", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const antes = Number(await caja(m));
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([cargarNota(m, "420.00"), pagar(m)]);
      } finally {
        c.soltarBarrera();
      }
      for (const r of resultados) {
        expect(r.ok, r.ok ? "" : JSON.stringify(r.error)).toBe(true);
      }
      const [pago] = await pagos(m);
      expect(["2000.00", "2420.00"]).toContain(pago?.importe);
      expect(Number(await caja(m))).toBe(antes - Number(pago?.importe));
      expect(await saldo(m)).toBe(pago?.importe === "2000.00" ? "0.00" : "-420.00");
    }
  });

  it("A: si el libro falla al pagar no queda el pago ni sale plata de la caja (el neto no se escribe a medias)", async () => {
    const m = await armar();
    valorDe(await cargarNota(m, "420.00"));
    const caja0 = await caja(m);
    c.inyectarFalla("libro-pago");
    try {
      await expect(pagar(m)).rejects.toThrow(/falla inyectada/);
    } finally {
      c.inyectarFalla(null);
    }
    expect(await pagos(m)).toEqual([]);
    expect(await caja(m)).toBe(caja0);
    valorDe(await pagar(m));
    expect((await pagos(m)).map((p) => p.importe)).toEqual(["2000.00"]);
  });

  it("A: si la caja falla (caja que no es de la sucursal de la compra) no queda el pago por el neto ni su asiento", async () => {
    const m = await armar();
    valorDe(await cargarNota(m, "420.00"));
    const r = await c.casos.declararPago(m.e.gerente, {
      clave: nuevoId(),
      comprobanteId: m.comprobanteId,
      fechaDePago: "2026-10-11",
      medio: "EFECTIVO",
      salidaDeCaja: { cajaId: nuevoId(), motivo: "Pago de la factura en efectivo" },
    });
    expect(r.ok).toBe(false);
    expect(await pagos(m)).toEqual([]);
    expect(await asientosDePago(m)).toBe(0);
  });

  it("aislamiento: las notas de otra empresa no cambian lo que paga esta (paga el total)", async () => {
    const a = await armar();
    const b = await armar();
    valorDe(await cargarNota(a, "420.00"));
    valorDe(await pagar(b));
    expect((await pagos(b)).map((p) => p.importe)).toEqual(["2420.00"]);
    expect(await saldo(b)).toBe("0.00");
  });
});
