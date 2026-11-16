import { describe, expect, it } from "vitest";
import { texto } from "../../src/capacidades/vocabulario/vocabulario";
import { USOS_DE_DEPOSITO } from "../../src/modulos/stock/publico";
import {
  armarLaListaDeDepositos,
  CLAVE_DE_TEXTO_DEL_USO,
  RUTAS_DE_DEPOSITOS,
} from "../../apps/web/ui/plantillas/stock/depositos/modelo-de-depositos";
import { pestanasDeStock } from "../../apps/web/ui/plantillas/stock/pestanas-de-stock";
import { RUTAS_DE_STOCK } from "../../apps/web/ui/plantillas/stock/rutas-de-stock";

const textoDe = (clave: Parameters<typeof texto>[1]) => texto({}, clave);
const deposito = (extra: Record<string, unknown> = {}) => ({
  id: "d1",
  nombre: "Cocina",
  uso: "NORMAL",
  deVenta: false,
  activo: true,
  ...extra,
});

describe("el modelo de «Depósitos» de stock", () => {
  it("cada tarjeta muestra el nombre, el uso con su texto aprobado y si es de venta", () => {
    expect(
      armarLaListaDeDepositos(
        [deposito({ deVenta: true }), deposito({ id: "d2", nombre: "Cámara", uso: "CUARENTENA" })],
        textoDe,
      ),
    ).toEqual([
      { id: "d1", titulo: "Cocina", uso: "Normal", deVenta: true },
      { id: "d2", titulo: "Cámara", uso: "Cuarentena", deVenta: false },
    ]);
  });

  it("un depósito desactivado no se muestra (la maqueta no dibuja el estado ni cómo reactivarlo)", () => {
    expect(armarLaListaDeDepositos([deposito({ activo: false })], textoDe)).toEqual([]);
  });

  it("un uso sin texto aprobado no se muestra: ante la duda el sistema cierra", () => {
    expect(armarLaListaDeDepositos([deposito({ uso: "OTRO" })], textoDe)).toEqual([]);
    for (const uso of ["constructor", "toString", "__proto__"]) {
      expect(armarLaListaDeDepositos([deposito({ uso })], textoDe)).toEqual([]);
    }
  });

  it("sin depósitos, la lista está vacía (sin texto de «vacío»: no está aprobado)", () => {
    expect(armarLaListaDeDepositos([], textoDe)).toEqual([]);
  });

  it("los usos que la pantalla sabe nombrar son EXACTAMENTE los del servidor y la base", () => {
    expect(Object.keys(CLAVE_DE_TEXTO_DEL_USO).sort()).toEqual([...USOS_DE_DEPOSITO].sort());
  });
});

describe("las rutas y las pestañas de Stock", () => {
  it("son las cuatro de la maqueta, en su orden, y solo la actual lleva la marca", () => {
    const pestanas = pestanasDeStock("conteo");
    expect(pestanas.map((p) => [p.texto, p.href, p.actual])).toEqual([
      ["Existencias", "/stock/existencias", false],
      ["Movimientos", "/stock/movimientos", false],
      ["Conteo", "/stock/conteo", true],
      ["Depósitos", "/stock/depositos", false],
    ]);
  });

  it("el alta de un depósito cuelga de la lista, y el menú entra por una pantalla que existe", () => {
    expect(RUTAS_DE_DEPOSITOS.lista).toBe(RUTAS_DE_STOCK.depositos);
    expect(RUTAS_DE_DEPOSITOS.nuevo).toBe("/stock/depositos/nuevo");
    expect(RUTAS_DE_STOCK.entrada).toBe(RUTAS_DE_STOCK.depositos);
  });
});
