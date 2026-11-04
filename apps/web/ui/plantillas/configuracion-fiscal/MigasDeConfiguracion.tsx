import type { ReactNode } from "react";
import { Pila } from "../../primitivas/Pila";
import estilos from "./MigasDeConfiguracion.module.css";

export type TramoDeMigas = Readonly<{ texto: string; href: string }>;

/**
 * De dónde viene la pantalla (PROTO-PV: «Configuración fiscal» bajo el título): los tramos de arriba, cada uno un enlace al
 * nivel anterior. Sin ellos, de un punto de venta no hay cómo volver a la lista salvo el botón del navegador.
 */
export function MigasDeConfiguracion({ tramos }: Readonly<{ tramos: readonly TramoDeMigas[] }>) {
  return (
    <p className={estilos["migas"]}>
      {tramos.map((tramo, indice) => (
        <span key={tramo.href} className={estilos["tramo"]}>
          {indice === 0 ? null : (
            <span aria-hidden="true" className={estilos["separador"]}>
              ›
            </span>
          )}
          <a className={estilos["enlace"]} href={tramo.href}>
            {tramo.texto}
          </a>
        </span>
      ))}
    </p>
  );
}

/** Una pantalla de un punto de venta: las migas arriba y, debajo, su contenido. */
export function ConMigas({
  tramos,
  children,
}: Readonly<{ tramos: readonly TramoDeMigas[]; children: ReactNode }>) {
  return (
    <Pila separacion={4}>
      <MigasDeConfiguracion tramos={tramos} />
      {children}
    </Pila>
  );
}
