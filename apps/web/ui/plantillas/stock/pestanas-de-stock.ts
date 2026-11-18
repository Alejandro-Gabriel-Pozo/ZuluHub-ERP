import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { RUTAS_DE_STOCK, type PestanaDeStock } from "./rutas-de-stock";

type ClaveDePestana = Exclude<keyof typeof RUTAS_DE_STOCK, "entrada">;

/** Las cuatro pestañas de Stock con sus textos (los títulos de cada pantalla, aprobados el 09/11/2026) y la actual marcada. El orden es el de la maqueta `stock.html`. */
export function pestanasDeStock(actual: ClaveDePestana): readonly PestanaDeStock[] {
  return (
    [
      { clave: "existencias", texto: texto({}, "stock.pantalla.existencias") },
      { clave: "movimientos", texto: texto({}, "stock.pantalla.movimientos") },
      { clave: "conteo", texto: texto({}, "stock.pantalla.conteo") },
      { clave: "depositos", texto: texto({}, "stock.pantalla.depositos") },
    ] as const
  ).map((p) => ({
    href: RUTAS_DE_STOCK[p.clave],
    texto: p.texto,
    actual: p.clave === actual,
  }));
}
