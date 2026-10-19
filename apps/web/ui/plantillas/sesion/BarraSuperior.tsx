import type { ReactNode } from "react";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Icono } from "../../iconos/Icono";
import estilos from "./BarraSuperior.module.css";

export type PropsDeBarraSuperior = Readonly<{
  /** El nombre visible de la marca, ya resuelto (se pinta como texto). */
  marca: string;
  /** La empresa en la que se trabaja. */
  empresa: string;
  /** Adónde lleva «Cambiar de empresa». */
  hrefDeCambiarEmpresa: string;
  /** El indicador del estado de la sesión (cliente). */
  indicadorDeSesion: ReactNode;
  diccionario?: DiccionarioResuelto;
}>;

/**
 * La barra de arriba del mostrador: la marca sobre su color, y debajo la empresa, el cambio de empresa y el
 * estado de la sesión. Va dentro del encabezado de la plantilla (un solo `banner`).
 */
export function BarraSuperior({
  marca,
  empresa,
  hrefDeCambiarEmpresa,
  indicadorDeSesion,
  diccionario = {},
}: PropsDeBarraSuperior) {
  return (
    <div className={estilos["raiz"]}>
      <p className={estilos["marca"]}>{marca}</p>
      <div className={estilos["empresa"]}>
        <p className={estilos["nombre"]}>
          <Icono clave="empresa" tamano="medio" decorativo />
          <span>{empresa}</span>
        </p>
        <a className={estilos["cambiar"]} href={hrefDeCambiarEmpresa}>
          {texto(diccionario, "empresa.cambiar")}
        </a>
        {indicadorDeSesion}
      </div>
    </div>
  );
}
