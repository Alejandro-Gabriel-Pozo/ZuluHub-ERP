import estilos from "./SelectorDeDeposito.module.css";

export type OpcionDeDeposito = Readonly<{
  id: string;
  nombre: string;
  href: string;
  actual: boolean;
}>;

/**
 * El selector «Depósitos» de las pantallas de lectura de Stock (maqueta `stock.html`): un enlace por depósito de la sucursal, el elegido marcado con `aria-current`. Son enlaces y no un campo:
 * elegir es ir a la dirección con ese depósito, sin script ni formulario. El rótulo llega resuelto.
 */
export function SelectorDeDeposito({
  rotulo,
  opciones,
}: Readonly<{ rotulo: string; opciones: readonly OpcionDeDeposito[] }>) {
  return (
    <nav aria-label={rotulo}>
      <ul className={estilos["lista"]}>
        {opciones.map((o) => (
          <li key={o.id}>
            <a
              className={estilos["opcion"]}
              href={o.href}
              {...(o.actual ? { "aria-current": "page" as const } : {})}
            >
              {o.nombre}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
