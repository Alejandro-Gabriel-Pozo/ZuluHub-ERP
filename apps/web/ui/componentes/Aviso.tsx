import type { ReactNode } from "react";
import { Icono } from "../iconos/Icono";
import { iconoDeEstado, type TonoDeEstado } from "./Insignia";
import estilos from "./Aviso.module.css";

export type PropsDeAviso = Readonly<{
  tono: TonoDeEstado;
  titulo?: string;
  /** El mensaje, ya resuelto. La UI no inventa textos: traduce códigos en el llamador. */
  children: ReactNode;
  /** Lo que se puede hacer (un botón «Reintentar»). */
  accion?: ReactNode;
}>;

/** Aviso en contexto: ícono, texto y, si hay, la acción. El peligro se anuncia como alerta. */
export function Aviso({ tono, titulo, children, accion }: PropsDeAviso) {
  return (
    <div
      className={estilos["aviso"]}
      data-tono={tono}
      role={tono === "peligro" ? "alert" : "status"}
    >
      <span className={estilos["icono"]}>
        <Icono clave={iconoDeEstado(tono)} tamano="grande" decorativo />
      </span>
      <div className={estilos["cuerpo"]}>
        {titulo !== undefined ? <p className={estilos["titulo"]}>{titulo}</p> : null}
        <div>{children}</div>
        {accion !== undefined ? <div className={estilos["accion"]}>{accion}</div> : null}
      </div>
    </div>
  );
}
