import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA } from "../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../contexto/contexto";
import { crearStockDeVentas } from "./stock-de-ventas";

const stock = crearStockDeVentas({ catalogo: CATALOGO_DE_MODULOS, permisos: PERMISOS_DE_EMPRESA });
const contexto = {} as ContextoOperativo;

describe("crearStockDeVentas: el puente de ventas con stock", () => {
  it("falla cerrado si la transacción no trae los repositorios de stock (nunca descuenta a medias)", async () => {
    const sinStock = {};
    expect(() => stock.controla(sinStock, contexto, [])).toThrow(
      /transacción compuesta con los repositorios de stock/,
    );
    expect(() => stock.depositoDeVenta(sinStock, contexto, "x")).toThrow(/repositorios de stock/);
    await expect(stock.registrarSalidaEnTx(sinStock, contexto, {} as never)).rejects.toThrow(
      /repositorios de stock/,
    );
    await expect(stock.revertirSalidaEnTx(sinStock, contexto, {} as never)).rejects.toThrow(
      /repositorios de stock/,
    );
  });

  it("falla cerrado también si falta solo uno de los repositorios que usa", () => {
    expect(() => stock.controla({ movimientosDeStock: {}, niveles: {} }, contexto, [])).toThrow();
    expect(() => stock.controla({ movimientosDeStock: {}, depositos: {} }, contexto, [])).toThrow();
    expect(() => stock.controla({ niveles: {}, depositos: {} }, contexto, [])).toThrow();
  });

  it("traduce las restricciones de stock que salen de la transacción de ventas; lo que no es de stock da null", () => {
    expect(
      stock.traducirFalla({
        tipo: "Check",
        restriccion: "stock_existencia_negativa_bloqueada",
      } as never),
    ).toMatchObject({ error: "CONTROL_BLOQUEA" });
    expect(
      stock.traducirFalla({
        tipo: "Check",
        restriccion: "stock_existencia_negativa_sin_confirmar",
      } as never),
    ).toMatchObject({ error: "CONTROL_REQUIERE_CONFIRMACION" });
    expect(
      stock.traducirFalla({ tipo: "Check", restriccion: "restriccion_que_no_existe" } as never),
    ).toBeNull();
    expect(stock.traducirFalla({ tipo: "ConcurrenciaAgotada" } as never)).toBeNull();
  });
});
