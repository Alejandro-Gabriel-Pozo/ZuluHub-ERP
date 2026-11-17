import type { PestanaDeCaja } from "./lista-de-caja";
import estilos from "./PestanasDeCaja.module.css";

/**
 * Las tres pestañas de la configuración de caja (maqueta `medios.html`, 09/11/2026): Medios de pago, Cuentas de cobro y Cajas. Cada una es un enlace a su pantalla; la actual se
 * marca con `aria-current`. Los textos llegan resueltos (son los de los títulos de cada pantalla).
 */
export function PestanasDeCaja({ pestanas }: Readonly<{ pestanas: readonly PestanaDeCaja[] }>) {
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
