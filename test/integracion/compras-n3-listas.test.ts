import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { cuitUnico } from "./entorno";
import { numeroUnico } from "./unicos";

/**
 * Compras N3 (listados de pantalla): las recepciones de N3 y N4 con su estado derivado y las facturas sueltas con el suyo; lo conciliado mueve el estado, las líneas rechazadas no
 * cuentan como recibidas, las compras de N1 y N2 no salen acá, y todo respeta el alcance, la empresa y los permisos.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras N3: listados de recepciones y facturas", () => {
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
  const recibir = async (m: M, kilos: string, confirmar = true, controles: unknown[] = []) => {
    const r = valorDe(
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
            unidadDePrecioId: "KILOGRAMO",
            precio: "1000",
          },
        ],
        controles,
      }),
    );
    if (confirmar)
      valorDe(
        await c.casos.confirmarRecepcion(m.e.gerente, {
          recepcionId: r.recepcionId,
          depositoId: m.deposito,
        }),
      );
    return r.recepcionId;
  };
  const factura = async (m: M, gramos: number) =>
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
              precioNeto: "1",
              alicuota: "21",
            },
          ],
          totalSegunFactura: (gramos * 1.21).toFixed(2),
          cuitDelProveedor: m.cuit,
        },
      }),
    ).comprobanteId;
  const conciliar = async (m: M, comprobanteId: string, recepcionId: string, gramos: string) =>
    valorDe(
      await c.casos.conciliarFactura(m.e.gerente, {
        clave: nuevoId(),
        comprobanteId,
        asignaciones: [{ lineaDeFactura: 1, recepcionId, lineaDeRecepcion: 1, cantidad: gramos }],
      }),
    );
  const estadosDeRecepciones = async (m: M, quien = m.e.gerente) =>
    new Map(
      valorDe(
        await c.consultas.listarRecepcionesSeparadas(quien, { proveedorId: m.proveedor }),
      ).filas.map((f) => [f.recepcionId, f.estado]),
    );
  const estadosDeFacturas = async (m: M, quien = m.e.gerente) =>
    new Map(
      valorDe(
        await c.consultas.listarFacturasSeparadas(quien, { proveedorId: m.proveedor }),
      ).filas.map((f) => [f.comprobanteId, f.estado]),
    );

  it("el estado de cada recepción se deriva de lo conciliado y las rechazadas no cuentan como recibidas", async () => {
    const m = await armar();
    const pendiente = await recibir(m, "1", false);
    const sin = await recibir(m, "2");
    const parcial = await recibir(m, "2");
    const completa = await recibir(m, "2");
    await c.deposito(m.e, { uso: "RECHAZO" });
    const conRechazada = await recibir(m, "3", true, [
      { linea: 1, condicion: "RECHAZADA", observacion: "Vencida" },
    ]);
    const anulada = await recibir(m, "1", false);
    valorDe(
      await c.casos.anularRecepcionPendiente(m.e.gerente, {
        recepcionId: anulada,
        motivo: "Se cargó mal",
      }),
    );
    await conciliar(m, await factura(m, 500), parcial, "500");
    await conciliar(m, await factura(m, 2000), completa, "2000");
    const estados = await estadosDeRecepciones(m);
    expect(estados.get(pendiente)).toBe("PENDIENTE_DE_CONFIRMAR");
    expect(estados.get(sin)).toBe("RECIBIDA_SIN_FACTURAR");
    expect(estados.get(parcial)).toBe("FACTURADA_EN_PARTE");
    expect(estados.get(completa)).toBe("RECIBIDA_Y_FACTURADA");
    expect(estados.get(anulada)).toBe("ANULADA");
    expect(estados.get(conRechazada)).toBe("RECIBIDA_SIN_FACTURAR");
    expect(estados.size).toBe(6);
  });

  it("el estado de cada factura: falta recibir, en parte, conciliada, anulada; el operador también las ve (comprobantes_de_proveedor.ver)", async () => {
    const m = await armar();
    const recibida = await recibir(m, "2");
    const sola = await factura(m, 100);
    const parcial = await factura(m, 1000);
    const completa = await factura(m, 1000);
    const anulada = await factura(m, 50);
    await conciliar(m, parcial, recibida, "400");
    await conciliar(m, completa, recibida, "1000");
    valorDe(
      await c.casos.anularFactura(m.e.gerente, { comprobanteId: anulada, motivo: "Mal cargada" }),
    );
    const estados = await estadosDeFacturas(m, m.e.operador);
    expect(estados.get(sola)).toBe("FACTURADA_FALTA_RECIBIR");
    expect(estados.get(parcial)).toBe("CONCILIADA_EN_PARTE");
    expect(estados.get(completa)).toBe("CONCILIADA");
    expect(estados.get(anulada)).toBe("ANULADA");
    expect(estados.size).toBe(4);
  });

  it("las compras de N1 y N2 no salen en estos listados; otra empresa no ve nada; filtros y cursor", async () => {
    const m = await armar();
    const r = await recibir(m, "1");
    const otra = await armar();
    const gerente = m.e.gerente;
    const lista = async (
      quien: typeof gerente,
      entrada: Parameters<typeof c.consultas.listarRecepcionesSeparadas>[1],
    ) => c.consultas.listarRecepcionesSeparadas(quien, entrada);
    expect((await estadosDeRecepciones(otra, otra.e.gerente)).size).toBe(0);
    expect(valorDe(await lista(otra.e.gerente, { proveedorId: m.proveedor })).filas).toEqual([]);
    const propia = valorDe(
      await lista(gerente, {
        sucursalId: m.e.sucursal,
        desde: "2000-01-01",
        hasta: "2999-12-31",
        proveedorId: m.proveedor,
      }),
    );
    expect(propia.filas.map((f) => f.recepcionId)).toEqual([r]);
    expect(propia.siguiente).toBeNull();
    expect(
      valorDe(await lista(gerente, { proveedorId: m.proveedor, desde: "2999-01-01" })).filas,
    ).toEqual([]);
    expect(await lista(gerente, { despuesDe: "no-es-un-cursor" })).toEqual({
      ok: false,
      error: "CURSOR_INVALIDO",
    });
    expect(await lista(gerente, { proveedorId: "x" })).toEqual({
      ok: false,
      error: "IDENTIFICADOR_INVALIDO",
    });
    expect(await c.consultas.listarFacturasSeparadas(gerente, { desde: "mañana" })).toEqual({
      ok: false,
      error: "IDENTIFICADOR_INVALIDO",
    });
    // una sucursal fuera del alcance del operador
    expect(await lista(m.e.operador, { sucursalId: m.e.otraSucursal })).toEqual({
      ok: false,
      error: "SUCURSAL_FUERA_DE_ALCANCE",
    });
  });
});
