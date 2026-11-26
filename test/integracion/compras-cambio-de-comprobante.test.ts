import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { cuitUnico } from "./entorno";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { codigoDe } from "./concurrencia-apoyo";
import { numeroUnico } from "./unicos";
import { armarCambiarElComprobanteDeLaCompra } from "../../src/modulos/compras/casos-de-uso/cambiar-comprobante-de-la-compra";

/**
 * NOTAS-2b (N-F): cambiar el comprobante de una compra N2 que ya tiene factura. Una operación atómica: la factura anterior se anula con motivo (y su conciliación atajo y su cargo se espejan), la nueva se registra contra los MISMOS renglones
 * recibidos con su atajo y su cargo, y el stock, la recepción y el costo congelado no se tocan (una compra ya consumida también se cambia). NO anula el pago, las notas ni otra conciliación: falla cerrado con el primero que encuentra. Repetir
 * no duplica; si algo falla no queda nada a medias; con permisos y alcance; y dos actores a la vez (dos cambios; cambiar y pagar; cambiar y cargar una nota; cambiar y anular la compra) dejan un estado válido en cualquier orden.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras: cambiar el comprobante de la compra", () => {
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

  /** Una empresa en N2 con un proveedor y una compra de 2 kg con su factura de 2420,00 (2000 neto + IVA 21 %). */
  const armar = async () => {
    const e: EscenarioDeCompras = await c.escenario();
    valorDe(
      await c.casos.configurarCompras(e.gerente, { nivel: "CON_COMPROBANTE", versionEsperada: 1 }),
    );
    const deposito = await c.deposito(e);
    const { producto } = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    const cuit = cuitUnico();
    /** El contenido de una factura de la compra (el mismo CUIT: un proveedor tiene un solo documento). */
    const contenido = (extra: { numero?: number; precioNeto?: string } = {}) => {
      const precioNeto = extra.precioNeto ?? "1";
      return {
        tipo: "FACTURA_A",
        puntoDeVenta: 5,
        numero: extra.numero ?? numeroUnico(),
        fecha: "2026-10-10",
        cuitDelProveedor: cuit,
        totalSegunFactura: (2000 * Number(precioNeto) * 1.21).toFixed(2),
        lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto, alicuota: "21" }],
      };
    };
    const original = contenido();
    /** El pedido de una compra de 2 kg con la factura dada. */
    const pedidoDe = (factura: ReturnType<typeof contenido>) => ({
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
      factura,
    });
    const compra = valorDe(await c.casos.registrarCompraConFactura(e.operador, pedidoDe(original)));
    return {
      e,
      deposito,
      producto,
      proveedor,
      original,
      contenido,
      pedidoDe,
      recepcionId: compra.recepcionId,
      factura: compra.comprobanteId as string,
    };
  };
  type M = Awaited<ReturnType<typeof armar>>;

  const cambiar = (
    m: M,
    extra: { numero?: number; precioNeto?: string } = {},
    quien = m.e.gerente,
    recepcionId = m.recepcionId,
    casos = c.casos,
  ) =>
    casos.cambiarElComprobanteDeLaCompra(quien, {
      clave: nuevoId(),
      recepcionId,
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
        es_atajo: boolean;
      }>(
        "select estado, reemplaza_a_id, motivo_de_anulacion as motivo, total_segun_factura::text as total, numero, es_atajo from comprobante_de_proveedor where id = $1",
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
  const cargosDe = (comprobanteId: string) =>
    c.contar(
      "select count(*) as n from asiento_de_saldo where origen_tipo = 'compras.factura' and origen_id = $1",
      [comprobanteId],
    );
  /** Lo que la compra dejó en stock y en la recepción: no cambia al cambiar el comprobante. */
  const huellaDeStock = async (m: M) => ({
    existencia: await c.existencia(m.deposito, m.producto),
    movimientos: await c.contar(
      "select count(*) as n from movimiento_de_stock where empresa_id = $1",
      [m.e.empresa],
    ),
    recepcion: await c.filas(
      "select estado, version, anulada_por, motivo_de_anulacion from recepcion where id = $1",
      [m.recepcionId],
    ),
    lineas: await c.filas(
      "select numero, cantidad_en_stock::text as c, costo_por_unidad_de_stock::text as k, movimiento_id from linea_de_recepcion where recepcion_id = $1 order by numero",
      [m.recepcionId],
    ),
  });
  const asignadoVigente = async (comprobanteId: string) =>
    (
      await c.filas<{ t: string }>(
        `select coalesce(sum(a.cantidad), 0)::text as t from asignacion_de_conciliacion a where a.comprobante_id = $1`,
        [comprobanteId],
      )
    )[0]?.t;
  const pagar = (m: M, comprobanteId: string, clave = nuevoId()) =>
    c.casos.declararPago(m.e.gerente, {
      clave,
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

  it("cambiar: la anterior queda anulada con su motivo, la nueva vinculada, con su atajo y su cargo; el saldo pasa al total de la nueva y stock, recepción y costo congelado quedan idénticos; la auditoría lleva las fechas", async () => {
    const m = await armar();
    expect(await saldo(m)).toBe("2420.00");
    const antes = await huellaDeStock(m);
    const r = valorDe(await cambiar(m, { precioNeto: "1.5" }));
    expect(r.yaExistia).toBe(false);
    expect(await fila(m.factura)).toMatchObject({
      estado: "ANULADO",
      motivo: "El proveedor mandó otra factura",
    });
    expect(await fila(r.comprobanteId)).toMatchObject({
      estado: "REGISTRADO",
      reemplaza_a_id: m.factura,
      es_atajo: true,
      total: "3630.00",
    });
    expect(await saldo(m)).toBe("3630.00");
    expect(await cargosDe(m.factura)).toBe(2);
    expect(await cargosDe(r.comprobanteId)).toBe(1);
    expect(await huellaDeStock(m)).toEqual(antes);
    // La conciliación atajo de la anterior se espejó (neto cero) y la de la nueva quedó repartida contra los mismos renglones.
    expect(await asignadoVigente(m.factura)).toBe("0.0000");
    expect(await asignadoVigente(r.comprobanteId)).toBe("2000.0000");
    expect(
      await c.contar(
        "select count(*) as n from linea_de_comprobante where comprobante_id = $1 and recepcion_id = $2",
        [r.comprobanteId, m.recepcionId],
      ),
    ).toBe(1);
    expect(await auditorias("FACTURA_REEMPLAZADA", m.factura)).toBe(1);
    const [audit] = await c.filas<{
      despues: {
        compra: string;
        fechaDeLaOriginal: string;
        fechaDeLaNueva: string;
        mismoNumero: boolean;
      };
    }>(
      "select despues from auditoria_empresa where accion = 'FACTURA_REEMPLAZADA' and entidad_id = $1",
      [m.factura],
    );
    expect(audit?.despues).toMatchObject({
      compra: m.recepcionId,
      fechaDeLaOriginal: "2026-10-10",
      fechaDeLaNueva: "2026-10-10",
      mismoNumero: false,
    });
    expect(await auditorias("FACTURA_REGISTRADA", r.comprobanteId)).toBe(1);
    // Se puede volver a cambiar (la nueva pasa a ser la anterior).
    const otra = valorDe(await cambiar(m));
    expect(await fila(r.comprobanteId)).toMatchObject({ estado: "ANULADO" });
    expect(await fila(otra.comprobanteId)).toMatchObject({ reemplaza_a_id: r.comprobanteId });
    expect(await saldo(m)).toBe("2420.00");
  });

  it("una compra ya consumida (lo recibido se gastó) también se cambia, y el stock no se mueve", async () => {
    const m = await armar();
    valorDe(
      await c.stockCasos.registrarSalida(m.e.gerente, {
        clave: nuevoId(),
        depositoId: m.deposito,
        motivo: "MERMA",
        detalle: "se tiró",
        renglones: [{ productoId: m.producto, cantidad: "1500", unidadId: "GRAMO" }],
      }),
    );
    expect(
      await c.casos.anularCompra(m.e.gerente, {
        recepcionId: m.recepcionId,
        motivo: "Quiero anularla",
      }),
    ).toEqual({ ok: false, error: "COMPRA_CONSUMIDA" });
    const antes = await huellaDeStock(m);
    valorDe(await cambiar(m));
    expect(await huellaDeStock(m)).toEqual(antes);
    expect(await fila(m.factura)).toMatchObject({ estado: "ANULADO" });
  });

  it("el proveedor reutiliza el MISMO número: se permite y la auditoría lo marca", async () => {
    const m = await armar();
    const r = valorDe(await cambiar(m, { numero: m.original.numero }));
    expect(await fila(r.comprobanteId)).toMatchObject({ numero: m.original.numero });
    const [audit] = await c.filas<{ despues: { mismoNumero: boolean } }>(
      "select despues from auditoria_empresa where accion = 'FACTURA_REEMPLAZADA' and entidad_id = $1",
      [m.factura],
    );
    expect(audit?.despues.mismoNumero).toBe(true);
  });

  it("lo que hay que deshacer antes frena sin escribir nada: un pago vigente, otra conciliación vigente y las notas; deshechos, se cambia", async () => {
    const m = await armar();
    const pago = valorDe(await pagar(m, m.factura));
    expect(await cambiar(m)).toEqual({
      ok: false,
      error: { error: "COMPROBANTE_YA_PAGADO", pagoId: pago.pagoId },
    });
    valorDe(await c.casos.anularPago(m.e.gerente, { pagoId: pago.pagoId, motivo: "Mal cargado" }));
    const nota = valorDe(await notaDeCredito(m));
    expect(codigo(await cambiar(m))).toBe("COMPROBANTE_CON_NOTA_DE_CREDITO");
    valorDe(
      await c.casos.anularNotaDeCredito(m.e.gerente, {
        comprobanteId: nota.comprobanteId,
        motivo: "Mal cargada",
      }),
    );
    // Otra conciliación vigente sobre la factura (la que no es del atajo de la compra) también frena.
    const [conciliacion] = await c.filas<{ id: string }>(
      `insert into conciliacion (empresa_id, acto, comprobante_id, es_atajo, nivel, clave_idempotencia, registrado_por)
       values ($1, 'CONCILIACION', $2, false, 'CON_COMPROBANTE', $3, $4) returning id`,
      [m.e.empresa, m.factura, nuevoId(), m.e.gerente.personaId],
    );
    expect(codigo(await cambiar(m))).toBe("COMPROBANTE_CONCILIADO");
    expect(await fila(m.factura)).toMatchObject({ estado: "REGISTRADO" });
    expect(await facturas(m)).toBe(1);
    expect(await auditorias("FACTURA_REEMPLAZADA", m.factura)).toBe(0);
    expect(await saldo(m)).toBe("2420.00");
    await c.filas(
      `insert into conciliacion (empresa_id, acto, anula_a, comprobante_id, es_atajo, nivel, clave_idempotencia, registrado_por)
       values ($1, 'ANULACION', $2, $3, false, 'CON_COMPROBANTE', $4, $5)`,
      [m.e.empresa, conciliacion?.id, m.factura, nuevoId(), m.e.gerente.personaId],
    );
    valorDe(await cambiar(m));
    expect(await fila(m.factura)).toMatchObject({ estado: "ANULADO" });
  });

  it("no se cambia lo que no corresponde: compra inexistente o de otra empresa, compra anulada, compra sin comprobante, motivo vacío y factura de otro formato", async () => {
    const m = await armar();
    expect(codigo(await cambiar(m, {}, m.e.gerente, nuevoId()))).toBe("RECEPCION_NO_ENCONTRADA");
    const otra = await armar();
    expect(codigo(await cambiar(otra, {}, otra.e.gerente, m.recepcionId))).toBe(
      "RECEPCION_NO_ENCONTRADA",
    );
    for (const motivo of ["", "   "]) {
      expect(
        await c.casos.cambiarElComprobanteDeLaCompra(m.e.gerente, {
          clave: nuevoId(),
          recepcionId: m.recepcionId,
          motivo,
          factura: m.contenido(),
        }),
      ).toEqual({ ok: false, error: "MOTIVO_REQUERIDO" });
    }
    expect(
      await c.casos.cambiarElComprobanteDeLaCompra(m.e.gerente, {
        clave: nuevoId(),
        recepcionId: m.recepcionId,
        motivo: "Cambio",
        factura: { tipo: "FACTURA_A" },
      }),
    ).toMatchObject({ ok: false });
    expect(await fila(m.factura)).toMatchObject({ estado: "REGISTRADO" });
    // Una compra sin comprobante (N1) queda afuera.
    const simple = valorDe(
      await c.casos.registrarCompra(m.e.operador, {
        clave: nuevoId(),
        sucursalId: m.e.sucursal,
        proveedorId: m.proveedor,
        depositoId: m.deposito,
        renglones: [
          {
            productoId: m.producto,
            unidadDeCompraId: "KILOGRAMO",
            cantidad: "1",
            precioPor: "UNIDAD",
            unidadDePrecioId: "KILOGRAMO",
            precio: "1000",
          },
        ],
      }),
    );
    expect(codigo(await cambiar(m, {}, m.e.gerente, simple.recepcionId))).toBe(
      "COMPROBANTE_NO_ENCONTRADO",
    );
    // Una compra anulada (con su factura) no se cambia.
    valorDe(
      await c.casos.anularCompra(m.e.administrador, {
        recepcionId: m.recepcionId,
        motivo: "Se cargó mal",
      }),
    );
    expect(codigo(await cambiar(m))).toBe("RECEPCION_YA_ANULADA");
  });

  it("I1: cambiar el comprobante dos veces con la misma clave (también a la vez) deja una sola factura nueva, un solo cargo y una sola auditoría; con otro contenido, CLAVE_REUTILIZADA", async () => {
    const m = await armar();
    const pedido = {
      clave: nuevoId(),
      recepcionId: m.recepcionId,
      motivo: "El proveedor mandó otra factura",
      factura: m.contenido({ precioNeto: "1.5" }),
    };
    const primera = valorDe(await c.casos.cambiarElComprobanteDeLaCompra(m.e.gerente, pedido));
    const repetida = valorDe(await c.casos.cambiarElComprobanteDeLaCompra(m.e.gerente, pedido));
    expect(repetida).toMatchObject({ comprobanteId: primera.comprobanteId, yaExistia: true });
    expect(
      codigo(
        await c.casos.cambiarElComprobanteDeLaCompra(m.e.gerente, {
          ...pedido,
          factura: m.contenido({ precioNeto: "2" }),
        }),
      ),
    ).toBe("CLAVE_REUTILIZADA");
    expect(await facturas(m)).toBe(2);
    expect(await cargosDe(primera.comprobanteId)).toBe(1);
    expect(await auditorias("FACTURA_REEMPLAZADA", m.factura)).toBe(1);
    expect(await saldo(m)).toBe("3630.00");
    // A la vez, con la misma clave: una sola factura nueva.
    const n = await armar();
    const mismo = {
      clave: nuevoId(),
      recepcionId: n.recepcionId,
      motivo: "El proveedor mandó otra factura",
      factura: n.contenido(),
    };
    c.armarBarrera(2);
    let resultados;
    try {
      resultados = await Promise.all([
        c.casos.cambiarElComprobanteDeLaCompra(n.e.gerente, mismo),
        c.casos.cambiarElComprobanteDeLaCompra(n.e.gerente, mismo),
      ]);
    } finally {
      c.soltarBarrera();
    }
    expect(resultados.some((r) => r.ok)).toBe(true);
    const ids = new Set(resultados.flatMap((r) => (r.ok ? [r.valor.comprobanteId] : [])));
    expect(ids.size).toBe(1);
    expect(await facturas(n)).toBe(2);
    expect(await auditorias("FACTURA_REEMPLAZADA", n.factura)).toBe(1);
    expect(await saldo(n)).toBe("2420.00");
  });

  it("A: si falla el libro o la nueva no se puede registrar, no queda nada: la anterior sigue registrada con su atajo, sin nueva ni auditoría", async () => {
    const m = await armar();
    c.inyectarFalla("libro");
    try {
      await expect(cambiar(m)).rejects.toThrow(/falla inyectada/);
    } finally {
      c.inyectarFalla(null);
    }
    expect(await fila(m.factura)).toMatchObject({ estado: "REGISTRADO" });
    expect(await facturas(m)).toBe(1);
    expect(await auditorias("FACTURA_REEMPLAZADA", m.factura)).toBe(0);
    expect(await saldo(m)).toBe("2420.00");
    expect(await asignadoVigente(m.factura)).toBe("2000.0000");
    // La nueva choca con OTRA factura ya registrada (mismo número): se deshace la anulación y el espejo.
    const otra = m.contenido();
    valorDe(await c.casos.registrarCompraConFactura(m.e.operador, m.pedidoDe(otra)));
    const conOtraCompra = await huellaDeStock(m);
    const r = await cambiar(m, { numero: otra.numero });
    expect(!r.ok && r.error).toMatchObject({ error: "COMPROBANTE_YA_REGISTRADO" });
    expect(await fila(m.factura)).toMatchObject({ estado: "REGISTRADO" });
    expect(await asignadoVigente(m.factura)).toBe("2000.0000");
    expect(await auditorias("FACTURA_REEMPLAZADA", m.factura)).toBe(0);
    expect(await huellaDeStock(m)).toEqual(conOtraCompra);
  });

  it("permisos y alcance: el operador no cambia (SIN_PERMISO); el administrador sí; con alcance parcial, SUCURSAL_FUERA_DE_ALCANCE sin tocar nada", async () => {
    const m = await armar();
    expect(await cambiar(m, {}, m.e.operador)).toMatchObject({ ok: false, error: "SIN_PERMISO" });
    c.alcances.set(m.e.administrador.personaId as string, [m.e.otraSucursal]);
    try {
      expect(codigo(await cambiar(m, {}, m.e.administrador))).toBe("SUCURSAL_FUERA_DE_ALCANCE");
    } finally {
      c.alcances.delete(m.e.administrador.personaId as string);
    }
    expect(await fila(m.factura)).toMatchObject({ estado: "REGISTRADO" });
    expect(await facturas(m)).toBe(1);
    valorDe(await cambiar(m, {}, m.e.administrador));
    expect(await fila(m.factura)).toMatchObject({ estado: "ANULADO" });
  });

  it("sin el permiso de CADA paso (reemplazar, anular, cargar factura) no se cambia: SIN_PERMISO y no queda nada", async () => {
    for (const faltante of [
      "comprobantes_de_proveedor.reemplazar",
      "comprobantes_de_proveedor.anular",
      "comprobantes_de_proveedor.registrar",
    ]) {
      const m = await armar();
      // El actor sin esa acción en lo que la base le da (la autoridad del guard): el servidor decide, no la pantalla.
      const transacciones = c.dependencias.transacciones;
      const sinEl = armarCambiarElComprobanteDeLaCompra({
        ...c.dependencias,
        transacciones: {
          ...transacciones,
          ejecutar: (opciones, trabajo) =>
            transacciones.ejecutar(opciones, (tx) =>
              trabajo({
                ...tx,
                autorizacion: {
                  ...tx.autorizacion,
                  delActor: async (contexto) => {
                    const actor = await tx.autorizacion.delActor(contexto);
                    return {
                      ...actor,
                      ...(actor.acciones === undefined
                        ? {}
                        : { acciones: actor.acciones.filter((x) => x !== faltante) }),
                    };
                  },
                },
              }),
            ),
        },
      });
      expect(
        await sinEl(m.e.gerente, {
          clave: nuevoId(),
          recepcionId: m.recepcionId,
          motivo: "El proveedor mandó otra factura",
          factura: m.contenido(),
        }),
      ).toMatchObject({ ok: false, error: "SIN_PERMISO" });
      expect(await fila(m.factura)).toMatchObject({ estado: "REGISTRADO" });
      expect(await facturas(m)).toBe(1);
    }
  });

  it("C1: dos personas cambian el comprobante a la vez: se encadenan (cada una cambia la factura vigente que encuentra) y al final hay UNA sola factura vigente, el saldo es el de la última y nada queda a medias", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([cambiar(m), cambiar(m, {}, m.e.administrador)]);
      } finally {
        c.soltarBarrera();
      }
      expect(
        resultados.every((r) => r.ok || codigo(r) === "ConcurrenciaAgotada"),
        JSON.stringify(resultados),
      ).toBe(true);
      const hechos = resultados.filter((r) => r.ok).length;
      expect(hechos).toBeGreaterThanOrEqual(1);
      expect(await facturas(m)).toBe(1 + hechos);
      expect(
        await c.contar(
          "select count(*) as n from comprobante_de_proveedor where empresa_id = $1 and clase = 'FACTURA' and estado = 'REGISTRADO'",
          [m.e.empresa],
        ),
      ).toBe(1);
      expect(await saldo(m)).toBe("2420.00");
      expect(await auditorias("FACTURA_REEMPLAZADA", m.factura)).toBe(1);
    }
  });

  it("C2: cambiar y pagar la factura a la vez: o se paga (y el cambio falla COMPROBANTE_YA_PAGADO) o se cambia (y el pago falla COMPROBANTE_ANULADO)", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([cambiar(m), pagar(m, m.factura)]);
      } finally {
        c.soltarBarrera();
      }
      const [cambio, pago] = resultados;
      expect(cambio.ok !== pago.ok, JSON.stringify(resultados)).toBe(true);
      if (cambio.ok) expect(codigo(pago)).toBe("COMPROBANTE_ANULADO");
      else expect(codigo(cambio)).toBe("COMPROBANTE_YA_PAGADO");
    }
  });

  it("C3: cambiar y cargar una nota de crédito a la vez: nunca queda una nota vigente de una factura anulada", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([cambiar(m), notaDeCredito(m)]);
      } finally {
        c.soltarBarrera();
      }
      const [cambio, nota] = resultados;
      expect(cambio.ok !== nota.ok, JSON.stringify(resultados)).toBe(true);
      if (cambio.ok) expect(codigo(nota)).toBe("NOTA_DE_CREDITO_DE_FACTURA_ANULADA");
      else expect(codigo(cambio)).toBe("COMPROBANTE_CON_NOTA_DE_CREDITO");
      const vigentes = await c.contar(
        "select count(*) as n from comprobante_de_proveedor n join comprobante_de_proveedor f on f.id = n.comprobante_asociado_id where f.id = $1 and f.estado = 'ANULADO' and n.estado = 'REGISTRADO'",
        [m.factura],
      );
      expect(vigentes).toBe(0);
    }
  });

  it("C4: cambiar el comprobante y anular la compra a la vez: nunca queda una factura vigente de una compra anulada ni una compra con dos facturas vigentes", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([
          cambiar(m),
          c.casos.anularCompra(m.e.administrador, { recepcionId: m.recepcionId, motivo: "Una" }),
        ]);
      } finally {
        c.soltarBarrera();
      }
      const [cambio, anulacion] = resultados;
      const vigentes = await c.contar(
        "select count(distinct c.id) as n from comprobante_de_proveedor c join linea_de_comprobante l on l.comprobante_id = c.id and l.empresa_id = c.empresa_id where l.recepcion_id = $1 and c.estado = 'REGISTRADO'",
        [m.recepcionId],
      );
      const estado = (
        await c.filas<{ estado: string }>("select estado from recepcion where id = $1", [
          m.recepcionId,
        ])
      )[0]?.estado;
      if (estado === "ANULADA") expect(vigentes, JSON.stringify(resultados)).toBe(0);
      else expect(vigentes, JSON.stringify(resultados)).toBe(1);
      expect(cambio.ok || anulacion.ok, JSON.stringify(resultados)).toBe(true);
    }
  });
});
