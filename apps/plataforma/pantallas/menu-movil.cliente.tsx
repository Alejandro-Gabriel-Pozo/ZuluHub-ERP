"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icono } from "../../web/ui/iconos/Icono";
import estilos from "./armazon-de-consola.module.css";

export type PropsDeMenuMovil = Readonly<{
  /** El nombre de la consola (se ve en la barra del celular y arriba del menú). */
  nombre: string;
  /** El contenido del menú, ya armado por el servidor (enlaces y salida). */
  children: ReactNode;
}>;

/**
 * El menú lateral. En escritorio es una columna fija; en el celular es un cajón que se abre con el botón «Menú».
 * Escape lo cierra y devuelve el foco al botón; tocar el fondo también lo cierra. Sin JavaScript el menú queda
 * visible (el CSS solo lo esconde cuando la página ya está lista).
 */
export function MenuMovil({ nombre, children }: PropsDeMenuMovil) {
  const [listo, setListo] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const cajon = useRef<HTMLElement>(null);

  useEffect(() => {
    setListo(true);
  }, []);

  useEffect(() => {
    if (!abierto) return;
    cajon.current?.querySelector<HTMLElement>("a[href], button")?.focus();
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key !== "Escape") return;
      setAbierto(false);
      boton.current?.focus();
    };
    document.addEventListener("keydown", alTeclear);
    return () => {
      document.removeEventListener("keydown", alTeclear);
    };
  }, [abierto]);

  return (
    <>
      <div className={estilos["barra"]}>
        <button
          ref={boton}
          type="button"
          className={estilos["botonDeMenu"]}
          aria-expanded={abierto}
          aria-controls="menu-de-consola"
          onClick={() => {
            setAbierto((previo) => !previo);
          }}
        >
          <Icono clave="secciones" tamano="grande" decorativo />
          <span>Menú</span>
        </button>
        <span className={estilos["nombreEnBarra"]}>{nombre}</span>
      </div>
      {abierto ? (
        <div
          className={estilos["velo"]}
          aria-hidden="true"
          onClick={() => {
            setAbierto(false);
            boton.current?.focus();
          }}
        />
      ) : null}
      <aside
        id="menu-de-consola"
        ref={cajon}
        className={estilos["lateral"]}
        data-listo={listo}
        data-abierto={abierto}
      >
        <p className={estilos["marca"]}>{nombre}</p>
        {children}
      </aside>
    </>
  );
}
