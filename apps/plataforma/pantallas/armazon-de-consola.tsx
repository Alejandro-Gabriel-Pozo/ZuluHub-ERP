import type { ReactNode } from "react";
import { Icono } from "../../web/ui/iconos/Icono";
import { CerrarSesion } from "./cerrar-sesion.cliente";
import { MenuMovil } from "./menu-movil.cliente";
import { VigilanteDeSesion } from "./vigilante-de-sesion.cliente";
import estilos from "./armazon-de-consola.module.css";

/** Las secciones de la consola. Hoy solo Empresas: las demás se suman cuando existan sus pantallas. */
const SECCIONES = [{ clave: "empresas", etiqueta: "Empresas", href: "/empresas" }] as const;

export type PropsDeArmazonDeConsola = Readonly<{
  activo: (typeof SECCIONES)[number]["clave"];
  /** El título de la pantalla. Por defecto, el de la sección activa. */
  titulo?: string;
  /** Lo que va a la derecha del título (por ejemplo, el botón principal de la pantalla). */
  acciones?: ReactNode;
  children: ReactNode;
}>;

/**
 * El armazón de toda pantalla de la consola: menú lateral (cajón en el celular), título, contenido, el aviso de
 * vencimiento de la sesión y la salida. Es de servidor; solo el cajón y la salida son de cliente.
 */
export function ArmazonDeConsola({ activo, titulo, acciones, children }: PropsDeArmazonDeConsola) {
  const seccion = SECCIONES.find((s) => s.clave === activo);
  return (
    <div className={estilos["raiz"]}>
      <a href="#contenido" className={estilos["salto"]}>
        Saltar al contenido
      </a>
      <MenuMovil nombre="Consola de plataforma">
        <nav aria-label="Secciones de la consola">
          <ul className={estilos["lista"]}>
            {SECCIONES.map((s) => (
              <li key={s.clave}>
                <a
                  href={s.href}
                  className={estilos["enlace"]}
                  aria-current={s.clave === activo ? "page" : undefined}
                >
                  <Icono clave="empresa" tamano="medio" decorativo />
                  <span>{s.etiqueta}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className={estilos["salida"]}>
          <CerrarSesion />
        </div>
      </MenuMovil>
      <div className={estilos["zona"]}>
        <header className={estilos["cabecera"]}>
          <h1 className={estilos["titulo"]}>{titulo ?? seccion?.etiqueta}</h1>
          {acciones}
        </header>
        <main id="contenido" className={estilos["principal"]} tabIndex={-1}>
          {children}
        </main>
      </div>
      <VigilanteDeSesion />
    </div>
  );
}
