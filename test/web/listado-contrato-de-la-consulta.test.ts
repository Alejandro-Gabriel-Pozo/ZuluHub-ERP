import { describe, expect, it } from "vitest";
import { listarComprobantes } from "../../src/composicion/facturacion-web";
import { ok } from "../../src/primitivas/resultado/resultado";

/**
 * El contrato de la consulta del listado que la pantalla usa (D-18, #115): la página trae la sucursal que usó el servidor
 * (`{ id, nombre, activa }`, y nada más) y cada fila trae el número del punto de venta como DATO (`puntoDeVentaNumero`; los 5
 * dígitos los pone la pantalla). Se prueba con el envoltorio REAL de `facturacion-web`, no con un simulacro del envoltorio.
 */
const SUCURSAL = "22222222-2222-4222-8222-222222222222";

const fila = {
  id: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
  tipo: "FACTURA_B",
  numero: "00007-00001234",
  puntoDeVentaNumero: 7,
  fecha: "2026-10-14",
  receptorNombre: "Marta Gómez",
  receptorDocumento: { tipo: "DNI", numero: "27345678" },
  total: "9000.00",
  estado: "AUTORIZADO",
  ambiente: "HOMOLOGACION",
  acreditacion: null,
};

const dependencias = (pedidos: unknown[]) =>
  ({
    casosDeUso: () => ({}),
    consultas: () => ({
      listarComprobantes: (_contexto: unknown, pedido: unknown) => {
        pedidos.push(pedido);
        return Promise.resolve(
          ok({
            items: [fila],
            siguiente: null,
            // Lo que NO es de la lista blanca no debe salir: un campo de más de la consulta.
            sucursal: { id: SUCURSAL, nombre: "Norte", activa: false, secreto: "no sale" },
          }),
        );
      },
    }),
    respuesta: { registrar: () => undefined },
  }) as never;

describe("la consulta del listado: lo que la pantalla recibe de #115", () => {
  it("la página trae la sucursal usada con id, nombre y si está abierta, y nada más", async () => {
    const pedidos: unknown[] = [];
    const respuesta = await listarComprobantes(
      dependencias(pedidos),
      { empresaId: "empresa-1" } as never,
      SUCURSAL as never,
      {},
    );
    expect(respuesta.ok).toBe(true);
    if (!respuesta.ok) return;
    expect(respuesta.dato.sucursal).toEqual({ id: SUCURSAL, nombre: "Norte", activa: false });
    expect(pedidos).toEqual([expect.objectContaining({ sucursalElegida: SUCURSAL })]);
  });

  it("cada fila trae el número del punto de venta como dato", async () => {
    const respuesta = await listarComprobantes(
      dependencias([]),
      { empresaId: "empresa-1" } as never,
      SUCURSAL as never,
      {},
    );
    expect(respuesta.ok && respuesta.dato.items[0]?.puntoDeVentaNumero).toBe(7);
  });

  it("la ventana de creación que pide la pantalla llega a la consulta tal cual (si el envoltorio la descartara, el servidor buscaría en toda la historia sin que nadie lo note)", async () => {
    const pedidos: unknown[] = [];
    const respuesta = await listarComprobantes(
      dependencias(pedidos),
      { empresaId: "empresa-1" } as never,
      SUCURSAL as never,
      { texto: "Aguirre", creadoDesde: "2025-11-07" },
    );
    expect(respuesta.ok).toBe(true);
    expect(pedidos).toEqual([
      { texto: "Aguirre", creadoDesde: "2025-11-07", sucursalElegida: SUCURSAL },
    ]);
  });

  it("una ventana inválida no llega a la consulta: se rechaza con el campo", async () => {
    const pedidos: unknown[] = [];
    const respuesta = await listarComprobantes(
      dependencias(pedidos),
      { empresaId: "empresa-1" } as never,
      SUCURSAL as never,
      { texto: "x", creadoDesde: "2026-02-31" },
    );
    expect(respuesta.ok).toBe(false);
    expect(pedidos).toEqual([]);
  });
});
