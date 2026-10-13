import type { ReactNode } from "react";
import estilos from "./PlantillaAdministracion.module.css";

type SeccionDeAdministracion = Readonly<{
  etiqueta: string;
  href: string;
  actual?: boolean;
}>;

export type PropsDePlantillaAdministracion = Readonly<{
  titulo: string;
  etiquetaDeNavegacion: string;
  textoDeSalto: string;
  secciones: readonly SeccionDeAdministracion[];
  franjas?: ReactNode;
  children: ReactNode;
}>;

/**
 * Armazón de la administración de empresa: navegación por secciones y contenido. Más compacta que el
 * mostrador en escritorio (objetivo táctil menor) y cómoda en el celular. No se mezcla con la operación:
 * el gerente cambia de modo a propósito ([01] §7).
 */
export function PlantillaAdministracion({
  titulo,
  etiquetaDeNavegacion,
  textoDeSalto,
  secciones,
  franjas,
  children,
}: PropsDePlantillaAdministracion) {
  return (
    <div className={estilos["raiz"]}>
      <a href="#contenido" className={estilos["salto"]}>
        {textoDeSalto}
      </a>
      {franjas}
      <header className={estilos["cabecera"]}>
        <h1 className={estilos["titulo"]}>{titulo}</h1>
      </header>
      <div className={estilos["cuerpo"]}>
        <nav aria-label={etiquetaDeNavegacion} className={estilos["navegacion"]}>
          <ul className={estilos["secciones"]}>
            {secciones.map((seccion) => (
              <li key={seccion.href}>
                <a
                  href={seccion.href}
                  className={estilos["enlace"]}
                  aria-current={seccion.actual === true ? "page" : undefined}
                >
                  {seccion.etiqueta}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main id="contenido" className={estilos["principal"]} tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
