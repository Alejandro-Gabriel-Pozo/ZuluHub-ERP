import type { ReactNode } from "react";
import { Icono } from "../iconos/Icono";
import type { ClaveDeIcono } from "../iconos/catalogo";
import estilos from "./PlantillaOperacion.module.css";

export type DestinoDeOperacion = Readonly<{
  /** El texto del destino, ya resuelto. Siempre se ve: el ícono solo no alcanza. */
  etiqueta: string;
  icono: ClaveDeIcono;
  href: string;
  /** El destino actual (`aria-current="page"`). */
  actual?: boolean;
}>;

/** De 3 a 5 destinos ([01] §7): el tipo lo exige, no hace falta contarlos en tiempo de ejecución. */
type DestinosDeOperacion =
  | readonly [DestinoDeOperacion, DestinoDeOperacion, DestinoDeOperacion]
  | readonly [DestinoDeOperacion, DestinoDeOperacion, DestinoDeOperacion, DestinoDeOperacion]
  | readonly [
      DestinoDeOperacion,
      DestinoDeOperacion,
      DestinoDeOperacion,
      DestinoDeOperacion,
      DestinoDeOperacion,
    ];

export type PropsDePlantillaOperacion = Readonly<{
  /** Título de la pantalla (el `h1`), ya resuelto. */
  titulo: string;
  /** Nombre accesible de la barra de navegación inferior («Navegación principal»). */
  etiquetaDeNavegacion: string;
  /** El texto del enlace para saltar al contenido. */
  textoDeSalto: string;
  destinos: DestinosDeOperacion;
  /** Franja de arriba (conexión, módulo en solo lectura, acceso asistido). */
  franjas?: ReactNode;
  /** Barra fija sobre la navegación, por ejemplo el total y «Cobrar» del mostrador. */
  barraDeAccion?: ReactNode;
  children: ReactNode;
}>;

/**
 * Armazón del mostrador en el celular: una tarea por pantalla, objetivos grandes y una barra inferior
 * con 3 a 5 destinos. No dibuja ninguna pantalla: el contenido llega por `children`.
 */
export function PlantillaOperacion({
  titulo,
  etiquetaDeNavegacion,
  textoDeSalto,
  destinos,
  franjas,
  barraDeAccion,
  children,
}: PropsDePlantillaOperacion) {
  return (
    <div className={estilos["raiz"]}>
      <a href="#contenido" className={estilos["salto"]}>
        {textoDeSalto}
      </a>
      {franjas}
      <header className={estilos["cabecera"]}>
        <h1 className={estilos["titulo"]}>{titulo}</h1>
      </header>
      <main id="contenido" className={estilos["principal"]} tabIndex={-1}>
        {children}
      </main>
      <footer className={estilos["inferior"]}>
        {barraDeAccion}
        <nav aria-label={etiquetaDeNavegacion}>
          <ul className={estilos["destinos"]}>
            {destinos.map((destino) => (
              <li key={destino.href} className={estilos["destino"]}>
                <a
                  href={destino.href}
                  className={estilos["enlace"]}
                  aria-current={destino.actual === true ? "page" : undefined}
                >
                  <Icono clave={destino.icono} tamano="grande" decorativo />
                  <span>{destino.etiqueta}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </footer>
    </div>
  );
}
