import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { codigoDe } from "./concurrencia-apoyo";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { cuitUnico } from "./entorno";
import { numeroUnico } from "./unicos";

/**
 * P1 (DEC-1280): el pago con varios medios. La cabecera dice COMPUESTO, cada medio es una línea con su importe y la suma es el total de la factura; solo la línea en efectivo mueve la caja
 * (por lo que paga esa línea); repetir el pedido no duplica nada (y no depende del orden de los medios); dos pagos a la vez dejan uno; si la caja falla no queda ni cabecera ni líneas.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras: pago con varios medios", () => {
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

  /** Una compra N2 con su factura (total 2420,00) y una caja de su sucursal con la sesión abierta y 1000,00 de fondo. */
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
    return { e, caja, comprobanteId: r.comprobanteId as string, recepcionId: r.recepcionId };
  };
  const salida = (cajaId: string) => ({ cajaId, motivo: "Pago de la factura en efectivo" });
  const MEDIOS = [
    { medio: "EFECTIVO", importe: "1000.00" },
    { medio: "QR", importe: "1420.00" },
  ];
  const pedido = (m: { comprobanteId: string }, cajaId: string | null, extra: object = {}) => ({
    clave: nuevoId(),
    comprobanteId: m.comprobanteId,
    fechaDePago: "2026-10-11",
    medios: MEDIOS,
    ...(cajaId === null ? {} : { salidaDeCaja: salida(cajaId) }),
    ...extra,
  });
  const neto = async (sesionId: string) =>
    (
      await c.filas<{ t: string }>(
        "select coalesce(sum(importe), 0)::text as t from movimiento_caja where sesion_id = $1",
        [sesionId],
      )
    )[0]?.t;
  const movimientos = (sesionId: string) =>
    c.contar("select count(*) as n from movimiento_caja where sesion_id = $1", [sesionId]);
  const pagos = (comprobanteId: string) =>
    c.contar("select count(*) as n from pago_de_comprobante where comprobante_id = $1", [
      comprobanteId,
    ]);
  const lineas = (comprobanteId: string) =>
    c.filas<{ medio: string; importe: string }>(
      `select m.medio, m.importe::text as importe from medio_de_un_pago m
         join pago_de_comprobante p on p.id = m.pago_id and p.empresa_id = m.empresa_id
        where p.comprobante_id = $1 order by m.numero`,
      [comprobanteId],
    );

  it("efectivo y QR: la cabecera dice COMPUESTO, hay una línea por medio y la caja baja solo lo que pagó el efectivo", async () => {
    const m = await armar();
    const r = valorDe(await c.casos.declararPago(m.e.gerente, pedido(m, m.caja.cajaId)));
    expect(r.yaExistia).toBe(false);
    expect(await lineas(m.comprobanteId)).toEqual(MEDIOS);
    const [cabecera] = await c.filas<{ medio: string; importe: string }>(
      "select medio, importe::text as importe from pago_de_comprobante where id = $1",
      [r.pagoId],
    );
    expect(cabecera).toEqual({ medio: "COMPUESTO", importe: "2420.00" });
    expect(await neto(m.caja.sesionId)).toBe("0.00");
    const [egreso] = await c.filas<{ importe: string }>(
      "select importe::text as importe from movimiento_caja where sesion_id = $1 and clase = 'EGRESO_MANUAL'",
      [m.caja.sesionId],
    );
    expect(egreso?.importe).toBe("-1000.00");
    expect((await c.auditoria(m.e.empresa, "PAGO_DECLARADO")).at(-1)).toMatchObject({
      despues: expect.objectContaining({ medios: MEDIOS }) as unknown,
    });
  });

  it("un solo medio escribe su única línea por el total y la cabecera dice ese medio", async () => {
    const m = await armar();
    valorDe(
      await c.casos.declararPago(m.e.gerente, {
        clave: nuevoId(),
        comprobanteId: m.comprobanteId,
        fechaDePago: "2026-10-11",
        medio: "TRANSFERENCIA",
      }),
    );
    expect(await lineas(m.comprobanteId)).toEqual([{ medio: "TRANSFERENCIA", importe: "2420.00" }]);
  });

  it("una suma que no es el total (de menos o de más) no se declara y no deja nada", async () => {
    const m = await armar();
    const antes = await movimientos(m.caja.sesionId);
    for (const importe of ["1419.99", "1420.01"]) {
      expect(
        await c.casos.declararPago(
          m.e.gerente,
          pedido(m, m.caja.cajaId, {
            medios: [MEDIOS[0], { medio: "QR", importe }],
          }),
        ),
      ).toEqual({ ok: false, error: "LA_SUMA_DE_LOS_MEDIOS_NO_ES_EL_TOTAL" });
    }
    expect(await pagos(m.comprobanteId)).toBe(0);
    expect(await lineas(m.comprobanteId)).toEqual([]);
    expect(await movimientos(m.caja.sesionId)).toBe(antes);
  });

  it("con efectivo la caja es obligatoria; sin efectivo la caja no se admite; `medio` y `medios` juntos no se admiten", async () => {
    const m = await armar();
    expect(await c.casos.declararPago(m.e.gerente, pedido(m, null))).toEqual({
      ok: false,
      error: "SALIDA_DE_CAJA_INVALIDA",
    });
    expect(
      await c.casos.declararPago(
        m.e.gerente,
        pedido(m, m.caja.cajaId, {
          medios: [
            { medio: "QR", importe: "1000.00" },
            { medio: "TRANSFERENCIA", importe: "1420.00" },
          ],
        }),
      ),
    ).toEqual({ ok: false, error: "SALIDA_DE_CAJA_SOLO_EN_EFECTIVO" });
    expect(await c.casos.declararPago(m.e.gerente, pedido(m, null, { medio: "QR" }))).toEqual({
      ok: false,
      error: "MEDIO_INVALIDO",
    });
    expect(await pagos(m.comprobanteId)).toBe(0);
  });

  it("I: repetir el pedido (otro actor, medios en otro orden) devuelve el mismo pago sin escribir; con otro reparto es CLAVE_REUTILIZADA", async () => {
    const m = await armar();
    const p = pedido(m, m.caja.cajaId);
    const primero = valorDe(await c.casos.declararPago(m.e.gerente, p));
    expect(
      valorDe(
        await c.casos.declararPago(m.e.administrador, { ...p, medios: [...MEDIOS].reverse() }),
      ),
    ).toEqual({ pagoId: primero.pagoId, yaExistia: true });
    expect(await pagos(m.comprobanteId)).toBe(1);
    expect(await lineas(m.comprobanteId)).toHaveLength(2);
    expect(await movimientos(m.caja.sesionId)).toBe(2);
    expect(
      await c.casos.declararPago(m.e.gerente, {
        ...p,
        medios: [
          { medio: "EFECTIVO", importe: "1001.00" },
          { medio: "QR", importe: "1419.00" },
        ],
      }),
    ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
  });

  it("C: dos pagos con varios medios a la vez de la misma factura: un pago, sus líneas y un solo egreso", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      c.armarBarrera(2);
      try {
        const resultados = await Promise.all([
          c.casos.declararPago(m.e.gerente, pedido(m, m.caja.cajaId)),
          c.casos.declararPago(m.e.administrador, pedido(m, m.caja.cajaId)),
        ]);
        expect(resultados.filter((r) => r.ok)).toHaveLength(1);
        for (const r of resultados.filter((x) => !x.ok)) {
          expect(["COMPROBANTE_YA_PAGADO", "ConcurrenciaAgotada"]).toContain(codigo(r));
        }
      } finally {
        c.soltarBarrera();
      }
      expect(await pagos(m.comprobanteId)).toBe(1);
      expect(await lineas(m.comprobanteId)).toHaveLength(2);
      expect(await movimientos(m.caja.sesionId)).toBe(2);
    }
  });

  it("A: si la caja falla (cierre en curso) no queda ni cabecera, ni líneas, ni auditoría", async () => {
    const m = await armar();
    valorDe(await c.cajaCasos.iniciarCierre(m.e.gerente, { sesionId: m.caja.sesionId }));
    expect(await c.casos.declararPago(m.e.gerente, pedido(m, m.caja.cajaId))).toEqual({
      ok: false,
      error: "CAJA_EN_CIERRE",
    });
    expect(await pagos(m.comprobanteId)).toBe(0);
    expect(await lineas(m.comprobanteId)).toEqual([]);
    expect((await c.auditoria(m.e.empresa, "PAGO_DECLARADO")).length).toBe(0);
  });

  it("anular el pago con varios medios devuelve solo la línea en efectivo y deja las líneas como estaban", async () => {
    const m = await armar();
    const r = valorDe(await c.casos.declararPago(m.e.gerente, pedido(m, m.caja.cajaId)));
    valorDe(await c.casos.anularPago(m.e.gerente, { pagoId: r.pagoId, motivo: "Se cargó mal" }));
    expect(await neto(m.caja.sesionId)).toBe("1000.00");
    expect(await lineas(m.comprobanteId)).toEqual(MEDIOS);
    expect(
      await c.contar(
        "select count(*) as n from pago_de_comprobante where id = $1 and estado = 'ANULADO'",
        [r.pagoId],
      ),
    ).toBe(1);
  });

  it("un pago viejo (cabecera con su línea única del relleno de la 0103, sin asiento en el libro) no se anula en silencio: falla cerrado y queda vigente", async () => {
    const m = await armar();
    // Cabecera y línea en UNA transacción: desde el paso 2 (0109) la base exige las dos juntas.
    await c.filas("begin");
    const [pago] = await c.filas<{ id: string }>(
      `insert into pago_de_comprobante (empresa_id, comprobante_id, fecha_de_pago, medio, importe, clave_idempotencia, huella, registrado_por)
       values ($1, $2, '2026-10-01', 'EFECTIVO', 2420.00, $3, repeat('a', 64), $4) returning id`,
      [m.e.empresa, m.comprobanteId, nuevoId(), m.e.gerente.personaId],
    );
    await c.filas(
      `insert into medio_de_un_pago (empresa_id, pago_id, numero, medio, importe) values ($1, $2, 1, 'EFECTIVO', 2420.00)`,
      [m.e.empresa, pago?.id],
    );
    await c.filas("commit");
    expect(
      await c.casos.anularPago(m.e.gerente, { pagoId: pago?.id as string, motivo: "Era de antes" }),
    ).toEqual({ ok: false, error: "ASIENTO_DEL_PAGO_NO_ENCONTRADO" });
    expect(await lineas(m.comprobanteId)).toEqual([{ medio: "EFECTIVO", importe: "2420.00" }]);
    expect(
      await c.contar(
        "select count(*) as n from pago_de_comprobante where id = $1 and estado = 'VIGENTE'",
        [pago?.id],
      ),
    ).toBe(1);
    expect(await movimientos(m.caja.sesionId)).toBe(1);
  });
});
