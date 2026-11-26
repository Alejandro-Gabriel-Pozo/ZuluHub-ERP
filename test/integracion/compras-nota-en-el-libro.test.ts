import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { codigoDe } from "./concurrencia-apoyo";
import { cuitUnico } from "./entorno";
import { crearCasosDeUsoDeCompras } from "../../src/modulos/compras/publico";
import { numeroUnico } from "./unicos";

/**
 * L3a: cada nota de crédito deja su asiento de nota (resta) imputado contra el cargo de su factura, y anularla deja el espejo. Lo que sobra de lo pendiente (una nota que llega después del pago) queda
 * como saldo A FAVOR de la empresa; un pago posterior a la nota paga el NETO y deja el saldo en cero (P3). El reparto por sucursal va contra lo pendiente del cargo y el último pago salda cada centro a un centavo. Idempotencia, atomicidad, falla cerrada sin cargo o sin asiento, la nota de débito
 * como cargo suelto y dos actores a la vez (nota y pago; dos notas; anular la nota y pagar) sin abrazo mortal y con el saldo coherente.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras: las notas del proveedor en el libro", () => {
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

  /** Una empresa en N4 con un proveedor y una factura de 1210,00 (1000 neto + IVA 21 %), que la empresa carga sin sucursal. */
  const armar = async (casos = c.casos) => {
    const e: EscenarioDeCompras = await c.escenario();
    valorDe(await c.casos.configurarCompras(e.gerente, { nivel: "TRES_VIAS", versionEsperada: 1 }));
    const harina = (await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" })).producto;
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    const factura = valorDe(
      await casos.registrarFactura(e.operador, {
        clave: nuevoId(),
        proveedorId: proveedor,
        factura: {
          tipo: "FACTURA_A",
          puntoDeVenta: 5,
          numero: numeroUnico(),
          fecha: "2026-10-10",
          lineas: [
            { productoId: harina, cantidadFacturada: "1000", precioNeto: "1", alicuota: "21" },
          ],
          totalSegunFactura: "1210.00",
          cuitDelProveedor: cuitUnico(),
        },
      }),
    ).comprobanteId;
    return { e, proveedor, factura };
  };
  type M = Awaited<ReturnType<typeof armar>>;

  /** Una nota «sin IVA» de un total exacto (alícuota 0): para las cuentas. */
  const porTotal = (total: string) => ({
    tipo: "NOTA_CREDITO_A",
    puntoDeVenta: 5,
    numero: numeroUnico(),
    fecha: "2026-11-10",
    importes: [{ alicuota: "0", neto: total }],
    totalSegunNota: total,
  });
  const cargarNota = (m: M, total = "605.00", casos = c.casos) =>
    casos.registrarNotaDeCredito(m.e.gerente, {
      clave: nuevoId(),
      proveedorId: m.proveedor,
      facturaId: m.factura,
      nota: porTotal(total),
    });
  const anularNota = (m: M, comprobanteId: string, quien = m.e.gerente) =>
    c.casos.anularNotaDeCredito(quien, { comprobanteId, motivo: "Se cargó mal" });
  const pagar = (m: M, quien = m.e.gerente) =>
    c.casos.declararPago(quien, {
      clave: nuevoId(),
      comprobanteId: m.factura,
      fechaDePago: "2026-10-11",
      medio: "TRANSFERENCIA",
    });
  const delaNota = (notaId: string) =>
    c.filas<Record<string, unknown>>(
      "select id, empresa_id, parte_id, clase, naturaleza, importe::text as importe from asiento_de_saldo where origen_tipo = 'compras.nota' and origen_id = $1 order by naturaleza desc, registrado_en",
      [notaId],
    );
  const imputadoDeLaNota = async (notaId: string) =>
    (
      await c.filas<{ t: string }>(
        `select coalesce(sum(i.importe), 0)::text as t from imputacion_de_saldo i
           join asiento_de_saldo a on a.id = i.saldante_id and a.empresa_id = i.empresa_id
          where a.origen_tipo = 'compras.nota' and a.origen_id = $1`,
        [notaId],
      )
    )[0]?.t;
  const saldo = async (m: M) =>
    (
      await c.filas<{ s: string }>(
        "select saldo::text as s from saldo_de_parte where parte_id = $1 and sentido = 'A_PAGAR'",
        [m.proveedor],
      )
    )[0]?.s ?? "0.00";
  const estadoDeLaNota = async (id: string) =>
    (
      await c.filas<{ estado: string }>(
        "select estado from comprobante_de_proveedor where id = $1",
        [id],
      )
    )[0]?.estado;

  it("la nota de crédito deja un asiento que resta, a nombre del proveedor, imputado contra el cargo de su factura", async () => {
    const m = await armar();
    const r = valorDe(await cargarNota(m));
    const [a] = await delaNota(r.comprobanteId);
    expect(a).toMatchObject({
      empresa_id: m.e.empresa,
      parte_id: m.proveedor,
      clase: "NOTA_DE_CREDITO_DE_COMPRA",
      naturaleza: "ORIGINAL",
      importe: "-605.00",
    });
    expect(await imputadoDeLaNota(r.comprobanteId)).toBe("605.00");
    expect(await saldo(m)).toBe("605.00");
  });

  it("anular la nota deja el espejo, deshace la imputación y el saldo vuelve al cargo; repetir la anulación no toca el libro", async () => {
    const m = await armar();
    const r = valorDe(await cargarNota(m));
    valorDe(await anularNota(m, r.comprobanteId));
    expect((await delaNota(r.comprobanteId)).map((x) => [x["naturaleza"], x["importe"]])).toEqual([
      ["ORIGINAL", "-605.00"],
      ["ANULACION", "605.00"],
    ]);
    expect(await imputadoDeLaNota(r.comprobanteId)).toBe("0.00");
    expect(await saldo(m)).toBe("1210.00");
    expect(valorDe(await anularNota(m, r.comprobanteId))).toEqual({ yaEstaba: true });
    expect(await delaNota(r.comprobanteId)).toHaveLength(2);
  });

  it("pagar DESPUÉS de una nota: el pago es el neto (total − nota), se imputa entero contra lo pendiente y el saldo queda en cero", async () => {
    const m = await armar();
    valorDe(await cargarNota(m));
    const p = valorDe(await pagar(m));
    const [pago] = await c.filas<{ importe: string }>(
      "select importe::text as importe from asiento_de_saldo where origen_tipo = 'compras.pago' and origen_id = $1",
      [p.pagoId],
    );
    expect(pago?.importe).toBe("-605.00");
    const [imputado] = await c.filas<{ t: string }>(
      `select coalesce(sum(i.importe), 0)::text as t from imputacion_de_saldo i
         join asiento_de_saldo a on a.id = i.saldante_id and a.empresa_id = i.empresa_id
        where a.origen_tipo = 'compras.pago' and a.origen_id = $1`,
      [p.pagoId],
    );
    expect(imputado?.t).toBe("605.00");
    expect(await saldo(m)).toBe("0.00");
  });

  it("una nota DESPUÉS del pago: no hay nada pendiente que imputar y la nota queda como saldo a favor", async () => {
    const m = await armar();
    valorDe(await pagar(m));
    const r = valorDe(await cargarNota(m));
    expect(await delaNota(r.comprobanteId)).toHaveLength(1);
    // Sin ninguna imputación la suma no tiene filas: es cero.
    expect(Number(await imputadoDeLaNota(r.comprobanteId))).toBe(0);
    expect(await saldo(m)).toBe("-605.00");
  });

  it("A: si el libro falla al cargar la nota no queda la nota; si falla al anularla, la nota sigue registrada", async () => {
    const m = await armar();
    c.inyectarFalla("libro-nota");
    try {
      await expect(cargarNota(m)).rejects.toThrow(/falla inyectada/);
    } finally {
      c.inyectarFalla(null);
    }
    expect(
      await c.contar(
        "select count(*) as n from comprobante_de_proveedor where empresa_id = $1 and clase = 'NOTA_DE_CREDITO'",
        [m.e.empresa],
      ),
    ).toBe(0);
    const r = valorDe(await cargarNota(m));
    c.inyectarFalla("libro-nota");
    try {
      await expect(anularNota(m, r.comprobanteId)).rejects.toThrow(/falla inyectada/);
    } finally {
      c.inyectarFalla(null);
    }
    expect(await estadoDeLaNota(r.comprobanteId)).toBe("REGISTRADO");
    expect(await saldo(m)).toBe("605.00");
  });

  it("sin cargo (factura anterior al libro) la nota no se carga, y sin asiento de la nota no se anula: las dos fallan cerrado y no cambia nada", async () => {
    const sinCargo = crearCasosDeUsoDeCompras({
      ...c.dependencias,
      libroDeProveedores: {
        ...c.dependencias.libroDeProveedores,
        registrarCargo: () =>
          Promise.resolve({ ok: true, valor: { asientoId: nuevoId(), yaExistia: false } }),
      },
    });
    const m = await armar(sinCargo);
    expect(codigo(await cargarNota(m))).toBe("ASIENTO_DE_LA_FACTURA_NO_ENCONTRADO");
    expect(
      await c.contar(
        "select count(*) as n from comprobante_de_proveedor where empresa_id = $1 and clase = 'NOTA_DE_CREDITO'",
        [m.e.empresa],
      ),
    ).toBe(0);
    // Una nota «de antes del libro»: se registra con un libro que no asienta la nota.
    const m2 = await armar();
    const sinNota = crearCasosDeUsoDeCompras({
      ...c.dependencias,
      libroDeProveedores: {
        ...c.dependencias.libroDeProveedores,
        registrarNotaDeCredito: () =>
          Promise.resolve({ ok: true, valor: { asientoId: nuevoId(), yaExistia: false } }),
      },
    });
    const r = valorDe(await cargarNota(m2, "605.00", sinNota));
    expect(codigo(await anularNota(m2, r.comprobanteId))).toBe("ASIENTO_DE_LA_NOTA_NO_ENCONTRADO");
    expect(await estadoDeLaNota(r.comprobanteId)).toBe("REGISTRADO");
  });

  it("I: cargar la misma nota dos veces (misma clave, también a la vez) deja UN asiento y UNA imputación", async () => {
    const m = await armar();
    const pedido = {
      clave: nuevoId(),
      proveedorId: m.proveedor,
      facturaId: m.factura,
      nota: porTotal("605.00"),
    };
    c.armarBarrera(2);
    let resultados;
    try {
      resultados = await Promise.all([
        c.casos.registrarNotaDeCredito(m.e.gerente, pedido),
        c.casos.registrarNotaDeCredito(m.e.administrador, pedido),
      ]);
    } finally {
      c.soltarBarrera();
    }
    const [notaId = ""] = resultados.flatMap((r) => (r.ok ? [r.valor.comprobanteId] : []));
    expect(notaId).not.toBe("");
    expect(await delaNota(notaId)).toHaveLength(1);
    expect(await imputadoDeLaNota(notaId)).toBe("605.00");
    expect(await saldo(m)).toBe("605.00");
  });

  it("C1: una nota y el pago de la factura a la vez, sin abrazo mortal: gane quien gane el saldo es el mismo", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([cargarNota(m), pagar(m)]);
      } finally {
        c.soltarBarrera();
      }
      for (const r of resultados) {
        expect(r.ok, r.ok ? "" : JSON.stringify(r.error)).toBe(true);
      }
      // O la nota entró primero y el pago fue el neto (605: saldo cero), o el pago entró primero (1210) y la nota quedó a favor (−605): nunca un importe a medias.
      const [pago] = await c.filas<{ importe: string }>(
        "select importe::text as importe from pago_de_comprobante where comprobante_id = $1",
        [m.factura],
      );
      expect(["605.00", "1210.00"]).toContain(pago?.importe);
      expect(await saldo(m)).toBe(pago?.importe === "605.00" ? "0.00" : "-605.00");
    }
  });

  it("C2: anular la nota y pagar la factura a la vez, sin abrazo mortal y con el saldo coherente con lo que ganó cada uno", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const nota = valorDe(await cargarNota(m));
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([anularNota(m, nota.comprobanteId), pagar(m)]);
      } finally {
        c.soltarBarrera();
      }
      // Anular primero: el pago es el total (1210) y el saldo cero. Pagar primero: el pago ya descontó la nota (605) y anularla se rechaza (`NOTA_DE_CREDITO_CON_PAGO`): la nota sigue y el saldo es cero igual.
      expect(resultados[1].ok, JSON.stringify(resultados[1])).toBe(true);
      if (resultados[0].ok) {
        expect(await estadoDeLaNota(nota.comprobanteId)).toBe("ANULADO");
      } else {
        expect(codigo(resultados[0])).toBe("NOTA_DE_CREDITO_CON_PAGO");
        expect(await estadoDeLaNota(nota.comprobanteId)).toBe("REGISTRADO");
      }
      expect(await saldo(m)).toBe("0.00");
    }
  });

  it("C3: dos notas a la vez cuya suma pasa el total: entra UNA (la base impone el tope) y el libro la refleja una sola vez", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([cargarNota(m, "800.00"), cargarNota(m, "800.00")]);
      } finally {
        c.soltarBarrera();
      }
      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      for (const r of resultados.filter((x) => !x.ok)) {
        expect(["NOTA_DE_CREDITO_EXCEDE_LA_FACTURA", "ConcurrenciaAgotada"]).toContain(codigo(r));
        expect(codigo(r)).not.toBe("ConcurrenciaAgotada");
      }
      expect(await saldo(m)).toBe("410.00");
    }
  });

  it("aislamiento: la nota es de la empresa de su factura; el saldo de otra empresa no se toca", async () => {
    const a = await armar();
    const b = await armar();
    valorDe(await cargarNota(a));
    expect(await saldo(b)).toBe("1210.00");
    expect(
      await c.contar(
        "select count(*) as n from asiento_de_saldo where empresa_id = $1 and origen_tipo = 'compras.nota'",
        [b.e.empresa],
      ),
    ).toBe(0);
  });
});
