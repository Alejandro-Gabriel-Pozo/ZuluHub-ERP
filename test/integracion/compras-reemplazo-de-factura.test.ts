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
import { armarReemplazarFactura } from "../../src/modulos/compras/casos-de-uso/reemplazar-factura";

/**
 * NOTAS-2a (N-E): reemplazar una factura que llega sola (N3 y N4). Una operación atómica: la original se anula con motivo, la nueva se registra con el vínculo, el libro deja el espejo del cargo de la original y el cargo de la nueva, y se
 * audita `FACTURA_REEMPLAZADA`. NO anula el pago, las conciliaciones ni las notas (falla cerrado con el primero que encuentra); el número puede repetirse; repetir no duplica; si algo falla no queda nada a medias; con permisos y alcance; y
 * dos actores a la vez (dos reemplazos; reemplazar y pagar; reemplazar y cargar una nota) dejan un estado válido en cualquier orden.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras: reemplazo de factura", () => {
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

  /** Una empresa en N4 con un proveedor y una factura de 1210,00 (1000 neto + IVA 21 %), cargada sola y sin sucursal. */
  const armar = async () => {
    const e: EscenarioDeCompras = await c.escenario();
    valorDe(await c.casos.configurarCompras(e.gerente, { nivel: "TRES_VIAS", versionEsperada: 1 }));
    const harina = (await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" })).producto;
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    const cuit = cuitUnico();
    /** El contenido de una factura (la nueva lleva el mismo CUIT: un proveedor tiene un solo documento). */
    const contenido = (extra: { numero?: number; cantidad?: string } = {}) => {
      const cantidad = extra.cantidad ?? "1000";
      const neto = Number(cantidad);
      return {
        tipo: "FACTURA_A",
        puntoDeVenta: 5,
        numero: extra.numero ?? numeroUnico(),
        fecha: "2026-10-10",
        lineas: [
          { productoId: harina, cantidadFacturada: cantidad, precioNeto: "1", alicuota: "21" },
        ],
        totalSegunFactura: (neto * 1.21).toFixed(2),
        cuitDelProveedor: cuit,
      };
    };
    const original = contenido();
    const factura = valorDe(
      await c.casos.registrarFactura(e.operador, {
        clave: nuevoId(),
        proveedorId: proveedor,
        factura: original,
      }),
    ).comprobanteId;
    return { e, proveedor, factura, original, contenido };
  };
  type M = Awaited<ReturnType<typeof armar>>;

  const reemplazar = (
    m: M,
    extra: { numero?: number; cantidad?: string } = {},
    quien = m.e.gerente,
    comprobanteId = m.factura,
    casos = c.casos,
  ) =>
    casos.reemplazarFactura(quien, {
      clave: nuevoId(),
      comprobanteId,
      motivo: "El proveedor mandó otra factura",
      factura: m.contenido(extra),
    });
  const fila = async (id: string) =>
    (
      await c.filas<{
        estado: string;
        reemplaza_a_id: string | null;
        motivo: string | null;
        total: string;
        numero: number;
      }>(
        "select estado, reemplaza_a_id, motivo_de_anulacion as motivo, total_segun_factura::text as total, numero from comprobante_de_proveedor where id = $1",
        [id],
      )
    )[0];
  const auditorias = (accion: string, id: string) =>
    c.contar(
      "select count(*) as n from auditoria_empresa where accion = $1 and entidad = 'comprobante_de_proveedor' and entidad_id = $2",
      [accion, id],
    );
  const facturas = (m: M) =>
    c.contar(
      "select count(*) as n from comprobante_de_proveedor where empresa_id = $1 and clase = 'FACTURA'",
      [m.e.empresa],
    );
  const saldo = async (m: M) =>
    (
      await c.filas<{ s: string }>(
        "select saldo::text as s from saldo_de_parte where parte_id = $1 and sentido = 'A_PAGAR'",
        [m.proveedor],
      )
    )[0]?.s ?? "0.00";
  const pagar = (m: M, comprobanteId = m.factura) =>
    c.casos.declararPago(m.e.gerente, {
      clave: nuevoId(),
      comprobanteId,
      fechaDePago: "2026-10-11",
      medio: "TRANSFERENCIA",
    });
  const notaDeCredito = (m: M, total = "100.00") =>
    c.casos.registrarNotaDeCredito(m.e.gerente, {
      clave: nuevoId(),
      proveedorId: m.proveedor,
      facturaId: m.factura,
      nota: {
        tipo: "NOTA_CREDITO_A",
        puntoDeVenta: 5,
        numero: numeroUnico(),
        fecha: "2026-11-10",
        importes: [{ alicuota: "0", neto: total }],
        totalSegunNota: total,
      },
    });

  it("reemplazar: la original queda anulada con su motivo, la nueva registrada con el vínculo, el libro con el espejo y el cargo nuevo (mismo saldo si el importe es el mismo) y una auditoría FACTURA_REEMPLAZADA", async () => {
    const m = await armar();
    expect(await saldo(m)).toBe("1210.00");
    const r = valorDe(await reemplazar(m));
    expect(r.yaExistia).toBe(false);
    expect(await fila(m.factura)).toMatchObject({
      estado: "ANULADO",
      motivo: "El proveedor mandó otra factura",
    });
    expect(await fila(r.comprobanteId)).toMatchObject({
      estado: "REGISTRADO",
      reemplaza_a_id: m.factura,
      total: "1210.00",
    });
    expect(await saldo(m)).toBe("1210.00");
    expect(await auditorias("FACTURA_REEMPLAZADA", m.factura)).toBe(1);
    expect(await auditorias("FACTURA_REGISTRADA", r.comprobanteId)).toBe(1);
    // Cadena: la nueva también se puede reemplazar (la original ya anulada no cuenta).
    const otra = valorDe(await reemplazar(m, {}, m.e.gerente, r.comprobanteId));
    expect(await fila(otra.comprobanteId)).toMatchObject({ reemplaza_a_id: r.comprobanteId });
  });

  it("con otro importe el libro refleja la factura nueva; con el MISMO número (el proveedor lo reutiliza) se permite y queda marcado en la auditoría", async () => {
    const m = await armar();
    const r = valorDe(await reemplazar(m, { cantidad: "2000" }));
    expect(await saldo(m)).toBe("2420.00");
    expect(await fila(r.comprobanteId)).toMatchObject({ total: "2420.00" });
    const n = await armar();
    const mismo = valorDe(await reemplazar(n, { numero: n.original.numero }));
    expect(await fila(mismo.comprobanteId)).toMatchObject({
      numero: n.original.numero,
      reemplaza_a_id: n.factura,
    });
    const [audit] = await c.filas<{ despues: { mismoNumero: boolean } }>(
      "select despues from auditoria_empresa where accion = 'FACTURA_REEMPLAZADA' and entidad_id = $1",
      [n.factura],
    );
    expect(audit?.despues.mismoNumero).toBe(true);
  });

  it("lo que hay que deshacer antes: un pago vigente y las notas vigentes frenan (el primero que se encuentra), sin escribir nada; deshechos, se reemplaza", async () => {
    const m = await armar();
    const pago = valorDe(await pagar(m));
    const nota = valorDe(await notaDeCredito(m));
    const lista = valorDe(
      await c.consultas.queHayQueDeshacerAntes(m.e.gerente, { comprobanteId: m.factura }),
    );
    expect(lista?.frenos).toEqual([
      { freno: "PAGO_VIGENTE", pagoId: pago.pagoId },
      { freno: "NOTAS_VIGENTES" },
    ]);
    const r = await reemplazar(m);
    expect(!r.ok && r.error).toMatchObject({ error: "COMPROBANTE_YA_PAGADO", pagoId: pago.pagoId });
    expect(await fila(m.factura)).toMatchObject({ estado: "REGISTRADO" });
    expect(await facturas(m)).toBe(1);
    valorDe(await c.casos.anularPago(m.e.gerente, { pagoId: pago.pagoId, motivo: "Mal cargado" }));
    expect(codigo(await reemplazar(m))).toBe("COMPROBANTE_CON_NOTA_DE_CREDITO");
    valorDe(
      await c.casos.anularNotaDeCredito(m.e.gerente, {
        comprobanteId: nota.comprobanteId,
        motivo: "Se cargó mal",
      }),
    );
    valorDe(await reemplazar(m));
    expect(await fila(m.factura)).toMatchObject({ estado: "ANULADO" });
    // Una nota de débito vinculada también frena.
    const n = await armar();
    valorDe(
      await c.casos.registrarNotaDeDebito(n.e.gerente, {
        clave: nuevoId(),
        proveedorId: n.proveedor,
        facturaId: n.factura,
        nota: {
          tipo: "NOTA_DEBITO_A",
          puntoDeVenta: 5,
          numero: numeroUnico(),
          fecha: "2026-11-10",
          importes: [{ alicuota: "0", neto: "50.00" }],
          totalSegunNota: "50.00",
        },
      }),
    );
    expect(codigo(await reemplazar(n))).toBe("COMPROBANTE_CON_NOTA_DE_CREDITO");
  });

  it("falla cerrada: ya reemplazada (con el id del reemplazo vigente), anulada sin reemplazo, que no es una factura o de otra empresa", async () => {
    const m = await armar();
    const r = valorDe(await reemplazar(m));
    const otra = await reemplazar(m);
    expect(!otra.ok && otra.error).toEqual({
      error: "FACTURA_YA_REEMPLAZADA",
      reemplazoId: r.comprobanteId,
    });
    const n = await armar();
    valorDe(await c.casos.anularFactura(n.e.gerente, { comprobanteId: n.factura, motivo: "Mal" }));
    expect(codigo(await reemplazar(n))).toBe("COMPROBANTE_ANULADO");
    // Algo que no es una factura (una nota de crédito) no se reemplaza.
    const x = await armar();
    const unaNota = valorDe(await notaDeCredito(x, "10.00"));
    expect(codigo(await reemplazar(x, {}, x.e.gerente, unaNota.comprobanteId))).toBe(
      "COMPROBANTE_NO_ENCONTRADO",
    );
    expect(codigo(await reemplazar(m, {}, m.e.gerente, nuevoId()))).toBe(
      "COMPROBANTE_NO_ENCONTRADO",
    );
    const b = await armar();
    expect(codigo(await reemplazar(b, {}, b.e.gerente, m.factura))).toBe(
      "COMPROBANTE_NO_ENCONTRADO",
    );
    expect(
      valorDe(await c.consultas.queHayQueDeshacerAntes(b.e.gerente, { comprobanteId: m.factura })),
    ).toBeNull();
  });

  it("I1: reemplazar dos veces con la misma clave (también a la vez) deja una sola factura nueva y una sola auditoría; con otro contenido, CLAVE_REUTILIZADA", async () => {
    const m = await armar();
    const pedido = {
      clave: nuevoId(),
      comprobanteId: m.factura,
      motivo: "El proveedor mandó otra factura",
      factura: m.contenido({ cantidad: "2000" }),
    };
    const primera = valorDe(await c.casos.reemplazarFactura(m.e.gerente, pedido));
    const otra = valorDe(await c.casos.reemplazarFactura(m.e.gerente, pedido));
    expect(otra).toMatchObject({ comprobanteId: primera.comprobanteId, yaExistia: true });
    expect(await facturas(m)).toBe(2);
    expect(await auditorias("FACTURA_REEMPLAZADA", m.factura)).toBe(1);
    expect(
      codigo(
        await c.casos.reemplazarFactura(m.e.gerente, {
          ...pedido,
          factura: m.contenido({ cantidad: "3000" }),
        }),
      ),
    ).toBe("CLAVE_REUTILIZADA");
    // A la vez, con la misma clave: una factura nueva y una auditoría.
    const n = await armar();
    const mismo = {
      clave: nuevoId(),
      comprobanteId: n.factura,
      motivo: "El proveedor mandó otra factura",
      factura: n.contenido(),
    };
    c.armarBarrera(2);
    let resultados;
    try {
      resultados = await Promise.all([
        c.casos.reemplazarFactura(n.e.gerente, mismo),
        c.casos.reemplazarFactura(n.e.administrador, mismo),
      ]);
    } finally {
      c.soltarBarrera();
    }
    const ids = new Set(resultados.flatMap((r) => (r.ok ? [r.valor.comprobanteId] : [])));
    expect(ids.size).toBe(1);
    expect(await facturas(n)).toBe(2);
    expect(await auditorias("FACTURA_REEMPLAZADA", n.factura)).toBe(1);
  });

  it("A: si falla el libro o la nueva no se puede registrar, no queda nada: la original sigue registrada, sin nueva ni auditoría", async () => {
    const m = await armar();
    c.inyectarFalla("libro");
    try {
      await expect(reemplazar(m)).rejects.toThrow(/falla inyectada/);
    } finally {
      c.inyectarFalla(null);
    }
    expect(await fila(m.factura)).toMatchObject({ estado: "REGISTRADO" });
    expect(await facturas(m)).toBe(1);
    expect(await auditorias("FACTURA_REEMPLAZADA", m.factura)).toBe(0);
    expect(await saldo(m)).toBe("1210.00");
    // La nueva choca con OTRA factura ya registrada (mismo número): la anulación de la original se deshace.
    const otra = m.contenido();
    valorDe(
      await c.casos.registrarFactura(m.e.operador, {
        clave: nuevoId(),
        proveedorId: m.proveedor,
        factura: otra,
      }),
    );
    const r = await reemplazar(m, { numero: otra.numero });
    expect(!r.ok && r.error).toMatchObject({ error: "COMPROBANTE_YA_REGISTRADO" });
    expect(await fila(m.factura)).toMatchObject({ estado: "REGISTRADO" });
    expect(await auditorias("FACTURA_REEMPLAZADA", m.factura)).toBe(0);
    expect(await saldo(m)).toBe("2420.00");
  });

  it("permisos y alcance: el operador no reemplaza ni ve lo que hay que deshacer (SIN_PERMISO); el administrador sí; con alcance parcial, SUCURSAL_FUERA_DE_ALCANCE sin tocar nada; en otro nivel de la empresa también se reemplaza", async () => {
    const m = await armar();
    expect(await reemplazar(m, {}, m.e.operador)).toMatchObject({
      ok: false,
      error: "SIN_PERMISO",
    });
    expect(
      await c.consultas.queHayQueDeshacerAntes(m.e.operador, { comprobanteId: m.factura }),
    ).toMatchObject({ ok: false });
    c.alcances.set(m.e.administrador.personaId as string, [m.e.otraSucursal]);
    try {
      expect(codigo(await reemplazar(m, {}, m.e.administrador))).toBe("SUCURSAL_FUERA_DE_ALCANCE");
    } finally {
      c.alcances.delete(m.e.administrador.personaId as string);
    }
    expect(await fila(m.factura)).toMatchObject({ estado: "REGISTRADO" });
    valorDe(await reemplazar(m, {}, m.e.administrador));
    const n = await armar();
    valorDe(
      await c.casos.configurarCompras(n.e.gerente, {
        nivel: "CON_COMPROBANTE",
        versionEsperada: 2,
      }),
    );
    // El nivel de la empresa no decide (decisión del 25/11): en «Con factura» también se reemplaza una factura que llega sola.
    valorDe(await reemplazar(n));
    expect(await fila(n.factura)).toMatchObject({ estado: "ANULADO" });
  });

  it("puntos de extensión: un freno de otro tema frena sin escribir nada; un heredador corre en la misma transacción y si falla deshace todo; con uno que anda se ve la factura nueva", async () => {
    const m = await armar();
    const conFreno = armarReemplazarFactura(c.dependencias, {
      frenos: [() => Promise.resolve("COMPROBANTE_CONCILIADO")],
      heredadores: [],
    });
    expect(
      codigo(
        await reemplazar(m, {}, m.e.gerente, m.factura, { reemplazarFactura: conFreno } as never),
      ),
    ).toBe("COMPROBANTE_CONCILIADO");
    expect(await fila(m.factura)).toMatchObject({ estado: "REGISTRADO" });
    const vistos: string[] = [];
    const conHeredador = armarReemplazarFactura(c.dependencias, {
      frenos: [],
      heredadores: [
        (_tx, _ctx, par) => {
          vistos.push(par.originalId, par.nuevaId);
          return Promise.resolve({ ok: false, error: "COMPROBANTE_NO_ENCONTRADO" });
        },
      ],
    });
    const falla = await conHeredador(m.e.gerente, {
      clave: nuevoId(),
      comprobanteId: m.factura,
      motivo: "Reemplazo",
      factura: m.contenido(),
    });
    expect(codigo(falla)).toBe("COMPROBANTE_NO_ENCONTRADO");
    expect(vistos).toHaveLength(2);
    expect(await fila(m.factura)).toMatchObject({ estado: "REGISTRADO" });
    expect(await facturas(m)).toBe(1);
    const bien = armarReemplazarFactura(c.dependencias, {
      frenos: [],
      heredadores: [() => Promise.resolve({ ok: true, valor: null })],
    });
    const hecho = await bien(m.e.gerente, {
      clave: nuevoId(),
      comprobanteId: m.factura,
      motivo: "Reemplazo",
      factura: m.contenido(),
    });
    expect(hecho.ok).toBe(true);
  });

  it("C1: dos personas reemplazan la misma original a la vez: una gana y la otra recibe FACTURA_YA_REEMPLAZADA con el id de la ganadora; queda una sola nueva vigente", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([reemplazar(m), reemplazar(m, {}, m.e.administrador)]);
      } finally {
        c.soltarBarrera();
      }
      const ganadoras = resultados.filter((r) => r.ok);
      expect(ganadoras).toHaveLength(1);
      const perdedora = resultados.find((r) => !r.ok);
      expect(!perdedora?.ok && perdedora?.error).toMatchObject({ error: "FACTURA_YA_REEMPLAZADA" });
      expect(await facturas(m)).toBe(2);
      expect(await saldo(m)).toBe("1210.00");
    }
  });

  it("C2: reemplazar y pagar la original a la vez: o se paga (y el reemplazo falla COMPROBANTE_YA_PAGADO) o se reemplaza (y el pago falla COMPROBANTE_ANULADO)", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([reemplazar(m), pagar(m)]);
      } finally {
        c.soltarBarrera();
      }
      const [rem, pago] = resultados;
      expect(rem.ok !== pago.ok, JSON.stringify(resultados)).toBe(true);
      if (rem.ok) expect(codigo(pago)).toBe("COMPROBANTE_ANULADO");
      else expect(codigo(rem)).toBe("COMPROBANTE_YA_PAGADO");
    }
  });

  it("C3: reemplazar y cargar una nota de crédito a la vez: nunca queda una nota vigente de una factura anulada", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([reemplazar(m), notaDeCredito(m)]);
      } finally {
        c.soltarBarrera();
      }
      const [rem, nota] = resultados;
      expect(rem.ok !== nota.ok, JSON.stringify(resultados)).toBe(true);
      if (rem.ok) expect(codigo(nota)).toBe("NOTA_DE_CREDITO_DE_FACTURA_ANULADA");
      else expect(codigo(rem)).toBe("COMPROBANTE_CON_NOTA_DE_CREDITO");
      const vigentes = await c.contar(
        "select count(*) as n from comprobante_de_proveedor n join comprobante_de_proveedor f on f.id = n.comprobante_asociado_id where f.id = $1 and f.estado = 'ANULADO' and n.estado = 'REGISTRADO'",
        [m.factura],
      );
      expect(vigentes).toBe(0);
    }
  });
});
