import type { PestanaDeStock } from "./rutas-de-stock";
import estilos from "./PestanasDeStock.module.css";

/**
 * Las cuatro pestañas de Stock (maqueta `stock.html`, 09/11/2026): Existencias, Movimientos, Conteo y Depósitos. Cada una es un enlace a su pantalla; la actual se marca con
 * `aria-current`. Los textos llegan resueltos (son los de los títulos de cada pantalla). Mismo aspecto que las pestañas de caja.
 */
export function PestanasDeStock({ pestanas }: Readonly<{ pestanas: readonly PestanaDeStock[] }>) {
  return (
    <ul className={estilos["pestanas"]}>
      {pestanas.map((p) => (
        <li key={p.href}>
          <a
            className={estilos["pestana"]}
            href={p.href}
            {...(p.actual ? { "aria-current": "page" as const } : {})}
          >
            {p.texto}
          </a>
        </li>
      ))}
    </ul>
  );
}
