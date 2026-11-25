import type { ReactNode } from "react";
import estilos from "./EnlaceDeAccion.module.css";

export type PropsDeEnlaceDeAccion = Readonly<{
  /** Adónde lleva. Quien lo arma lo valida (ver `urlDeIngreso`): acá no se corrige. */
  href: string;
  /** El verbo, ya resuelto («Ingresar»). */
  children: ReactNode;
  /** `secundaria`: el aspecto del botón secundario (acciones de una tarjeta o de una lista, como «Editar»). Sin decirlo, la primaria. */
  variante?: "primaria" | "secundaria";
}>;

/** Un enlace con el aspecto del botón primario (o del secundario): navega, no envía nada (para eso está `Boton`). */
export function EnlaceDeAccion({ href, children, variante = "primaria" }: PropsDeEnlaceDeAccion) {
  return (
    <a className={estilos["enlace"]} data-variante={variante} href={href}>
      {children}
    </a>
  );
}
