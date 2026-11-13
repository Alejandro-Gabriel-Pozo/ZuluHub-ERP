import type { ReactNode } from "react";
import { Icono } from "../iconos/Icono";
import type { ClaveDeIcono } from "../iconos/catalogo";
import estilos from "./PlantillaOperacion.module.css";

/** Una pantalla dentro de la hoja de un destino. */
type EnlaceDeHoja = Readonly<{
  etiqueta: string;
  href: string;
  actual?: boolean;
}>;

/** Un grupo de la hoja: con encabezado, o sin él (sus enlaces van sueltos) si `etiqueta` es `null`. */
type GrupoDeHoja = Readonly<{
  etiqueta: string | null;
  enlaces: readonly EnlaceDeHoja[];
}>;

export type DestinoDeOperacion = Readonly<{
  /** El texto del destino, ya resuelto. Siempre se ve: el ícono solo no alcanza. */
  etiqueta: string;
  icono: ClaveDeIcono;
  href: string;
  /** El destino actual (`aria-current="page"`). */
  actual?: boolean;
  /** Si el destino reúne varias pantallas: se abre una hoja con sus grupos (sin JavaScript: `details`) en vez de ir a una sola. */
  hoja?: readonly GrupoDeHoja[];
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
  /** Marca, empresa y estado de la sesión: va dentro del encabezado, arriba del título (un solo `banner`). */
  barraSuperior?: ReactNode;
  /** Barra fija sobre la navegación, por ejemplo el total y «Cobrar» del mostrador. */
  barraDeAccion?: ReactNode;
  children: ReactNode;
}>;

function EnlaceDeLaHoja({ enlace }: Readonly<{ enlace: EnlaceDeHoja }>) {
  return (
    <a
      href={enlace.href}
      className={estilos["enlaceDeHoja"]}
      aria-current={enlace.actual === true ? "page" : undefined}
    >
      {enlace.etiqueta}
    </a>
  );
}

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
  barraSuperior,
  barraDeAccion,
  children,
}: PropsDePlantillaOperacion) {
  return (
    <div className={estilos["raiz"]}>
      <a href="#contenido" className={estilos["salto"]}>
        {textoDeSalto}
      </a>
      {franjas}
      <header className={estilos["encabezado"]}>
        {barraSuperior}
        <div className={estilos["cabecera"]}>
          <h1 className={estilos["titulo"]}>{titulo}</h1>
        </div>
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
                {destino.hoja === undefined ? (
                  <a
                    href={destino.href}
                    className={estilos["enlace"]}
                    aria-current={destino.actual === true ? "page" : undefined}
                  >
                    <Icono clave={destino.icono} tamano="grande" decorativo />
                    <span>{destino.etiqueta}</span>
                  </a>
                ) : (
                  <details className={estilos["hoja"]}>
                    <summary
                      className={`${estilos["enlace"] ?? ""} ${estilos["resumen"] ?? ""}`}
                      aria-current={destino.actual === true ? "page" : undefined}
                    >
                      <Icono clave={destino.icono} tamano="grande" decorativo />
                      <span>{destino.etiqueta}</span>
                    </summary>
                    <ul className={estilos["panel"]}>
                      {destino.hoja.map((grupo, i) =>
                        grupo.etiqueta === null ? (
                          grupo.enlaces.map((e) => (
                            <li key={e.href}>
                              <EnlaceDeLaHoja enlace={e} />
                            </li>
                          ))
                        ) : (
                          <li key={`${grupo.etiqueta}-${String(i)}`} className={estilos["grupo"]}>
                            <span className={estilos["grupoEtiqueta"]}>{grupo.etiqueta}</span>
                            <ul className={estilos["enlacesDelGrupo"]}>
                              {grupo.enlaces.map((e) => (
                                <li key={e.href}>
                                  <EnlaceDeLaHoja enlace={e} />
                                </li>
                              ))}
                            </ul>
                          </li>
                        ),
                      )}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </footer>
    </div>
  );
}
