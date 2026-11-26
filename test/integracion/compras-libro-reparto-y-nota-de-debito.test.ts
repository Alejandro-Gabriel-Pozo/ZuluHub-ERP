import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { nuevoId, valorDe } from "./clientes-apoyo";
import type { LibroDeProveedores } from "../../src/modulos/compras/publico";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";

/**
 * L3a, puerto del libro contra la base real: lo que se aplica contra un cargo de VARIAS sucursales se reparte entre ellas sobre lo pendiente y el último pago salda cada sucursal a un centavo (nada queda desfasado por redondeo);
 * una nota de débito es un cargo suelto del proveedor (con la distribución de la factura vinculada si tiene cargo, o sin centro de costo), idempotente, y su anulación deja el espejo; sin asiento no se anula.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras: el libro de proveedores, reparto y nota de débito", () => {
  let c: MontajeDeCompras;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  /** Un cargo de 1000,00 repartido 600,00 a una sucursal y 400,00 «sin centro de costo» (como lo dejará una factura repartida), cargado por SQL del dueño. */
  const armar = async () => {
    const e: EscenarioDeCompras = await c.escenario();
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    const facturaId = randomUUID();
    await c.filas("begin");
    const [a] = await c.filas<{ id: string }>(
      `insert into asiento_de_saldo (empresa_id, parte_id, sentido, clase, importe, origen_tipo, origen_id, origen_orden, clave_idempotencia, huella, hecho_en, registrado_por)
         values ($1, $2, 'A_PAGAR', 'CARGO_DE_FACTURA_DE_COMPRA', 1000, 'compras.factura', $3, 1, $4, repeat('e', 64), now(), $5) returning id`,
      [e.empresa, proveedor, facturaId, `clave-${nuevoId()}`, e.gerente.personaId],
    );
    await c.filas(
      `insert into distribucion_de_asiento (empresa_id, asiento_id, sucursal_id, importe) values ($1, $2, $3, 600), ($1, $2, null, 400)`,
      [e.empresa, a?.id, e.sucursal],
    );
    await c.filas("commit");
    return { e, proveedor, facturaId };
  };
  type M = Awaited<ReturnType<typeof armar>>;
  const libro = () => c.dependencias.libroDeProveedores;
  type RDelLibro = Awaited<ReturnType<LibroDeProveedores["registrarPago"]>>;
  const enTx = (m: M, trabajo: (tx: never) => Promise<RDelLibro>) =>
    c.dependencias.transacciones.ejecutar({ contexto: m.e.gerente }, (tx) => trabajo(tx as never));
  const porCentro = (m: M) =>
    c.filas<{ sucursal_id: string | null; t: string }>(
      `select d.sucursal_id, sum(d.importe)::text as t from distribucion_de_asiento d
         join asiento_de_saldo a on a.id = d.asiento_id and a.empresa_id = d.empresa_id
        where a.parte_id = $1 group by d.sucursal_id order by d.sucursal_id nulls last`,
      [m.proveedor],
    );
  const distribucionDe = (origenId: string) =>
    c.filas<{ sucursal_id: string | null; i: string }>(
      `select d.sucursal_id, d.importe::text as i from distribucion_de_asiento d
         join asiento_de_saldo a on a.id = d.asiento_id and a.empresa_id = d.empresa_id
        where a.origen_id = $1 and a.naturaleza = 'ORIGINAL' order by d.sucursal_id nulls last`,
      [origenId],
    );

  it("una nota y el pago del resto se reparten entre las sucursales sobre lo pendiente y el último pago salda cada una a un centavo", async () => {
    const m = await armar();
    const nota = randomUUID();
    const pago = randomUUID();
    valorDe(
      await enTx(m, (tx) =>
        libro().registrarNotaDeCredito(tx, m.e.gerente, {
          notaId: nota,
          facturaId: m.facturaId,
          importe: "100.00",
          hechoEn: new Date(),
        }),
      ),
    );
    expect(await distribucionDe(nota)).toEqual([
      { sucursal_id: m.e.sucursal, i: "-60.00" },
      { sucursal_id: null, i: "-40.00" },
    ]);
    // 900,00 es EXACTAMENTE lo pendiente: el reparto es el pendiente de cada sucursal (540 y 360), sin prorrateo.
    valorDe(
      await enTx(m, (tx) =>
        libro().registrarPago(tx, m.e.gerente, {
          pagoId: pago,
          comprobanteId: m.facturaId,
          importe: "900.00",
          hechoEn: new Date(),
        }),
      ),
    );
    expect(await distribucionDe(pago)).toEqual([
      { sucursal_id: m.e.sucursal, i: "-540.00" },
      { sucursal_id: null, i: "-360.00" },
    ]);
    expect(await porCentro(m)).toEqual([
      { sucursal_id: m.e.sucursal, t: "0.00" },
      { sucursal_id: null, t: "0.00" },
    ]);
  });

  it("un reparto que no es exacto (un tercio de 1000,00 en tres notas) suma siempre el importe y el último pago deja cada sucursal en cero", async () => {
    const m = await armar();
    const notas = [randomUUID(), randomUUID(), randomUUID()];
    for (const notaId of notas) {
      valorDe(
        await enTx(m, (tx) =>
          libro().registrarNotaDeCredito(tx, m.e.gerente, {
            notaId,
            facturaId: m.facturaId,
            importe: "333.33",
            hechoEn: new Date(),
          }),
        ),
      );
    }
    for (const notaId of notas) {
      const total = (await distribucionDe(notaId)).reduce(
        (a, f) => a + Math.round(Number(f.i) * 100),
        0,
      );
      expect(total).toBe(-33333);
    }
    valorDe(
      await enTx(m, (tx) =>
        libro().registrarPago(tx, m.e.gerente, {
          pagoId: randomUUID(),
          comprobanteId: m.facturaId,
          importe: "0.01",
          hechoEn: new Date(),
        }),
      ),
    );
    expect((await porCentro(m)).reduce((a, f) => a + Math.round(Number(f.t) * 100), 0)).toBe(0);
  });

  it("la nota de débito es un cargo suelto: con factura vinculada lleva su distribución; sin factura, sin centro de costo; no se imputa y el saldo sube", async () => {
    const m = await armar();
    const vinculada = randomUUID();
    const suelta = randomUUID();
    valorDe(
      await enTx(m, (tx) =>
        libro().registrarNotaDeDebito(tx, m.e.gerente, {
          notaId: vinculada,
          proveedorId: m.proveedor,
          facturaId: m.facturaId,
          importe: "100.00",
          hechoEn: new Date(),
        }),
      ),
    );
    valorDe(
      await enTx(m, (tx) =>
        libro().registrarNotaDeDebito(tx, m.e.gerente, {
          notaId: suelta,
          proveedorId: m.proveedor,
          facturaId: null,
          importe: "50.00",
          hechoEn: new Date(),
        }),
      ),
    );
    expect(await distribucionDe(vinculada)).toEqual([
      { sucursal_id: m.e.sucursal, i: "60.00" },
      { sucursal_id: null, i: "40.00" },
    ]);
    expect(await distribucionDe(suelta)).toEqual([{ sucursal_id: null, i: "50.00" }]);
    expect(
      await c.contar(
        "select count(*) as n from imputacion_de_saldo where empresa_id = $1 and saldante_id in (select id from asiento_de_saldo where origen_id = any($2::uuid[]))",
        [m.e.empresa, [vinculada, suelta]],
      ),
    ).toBe(0);
    const [s] = await c.filas<{ s: string }>(
      "select saldo::text as s from saldo_de_parte where parte_id = $1 and sentido = 'A_PAGAR'",
      [m.proveedor],
    );
    expect(s?.s).toBe("1150.00");
  });

  it("la nota de débito: la misma nota dos veces es un solo asiento; anularla deja el espejo y baja el saldo; sin asiento no se anula (falla cerrado)", async () => {
    const m = await armar();
    const nota = randomUUID();
    const cargar = () =>
      enTx(m, (tx) =>
        libro().registrarNotaDeDebito(tx, m.e.gerente, {
          notaId: nota,
          proveedorId: m.proveedor,
          facturaId: null,
          importe: "70.00",
          hechoEn: new Date(),
        }),
      );
    const primera = valorDe(await cargar());
    expect(valorDe(await cargar())).toMatchObject({
      asientoId: primera.asientoId,
      yaExistia: true,
    });
    valorDe(await enTx(m, (tx) => libro().anularNotaDeDebito(tx, m.e.gerente, { notaId: nota })));
    expect(
      (
        await c.filas<{ n: string; i: string }>(
          "select naturaleza as n, importe::text as i from asiento_de_saldo where origen_id = $1 order by naturaleza desc",
          [nota],
        )
      ).map((f) => [f.n, f.i]),
    ).toEqual([
      ["ORIGINAL", "70.00"],
      ["ANULACION", "-70.00"],
    ]);
    const sin = await enTx(m, (tx) =>
      libro().anularNotaDeDebito(tx, m.e.gerente, { notaId: randomUUID() }),
    );
    expect(sin.ok ? null : sin.error).toBe("ASIENTO_DE_LA_NOTA_NO_ENCONTRADO");
  });
});
