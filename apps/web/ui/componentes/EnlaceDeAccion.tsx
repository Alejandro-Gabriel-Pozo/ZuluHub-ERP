import type { ReactNode } from "react";
import estilos from "./EnlaceDeAccion.module.css";

export type PropsDeEnlaceDeAccion = Readonly<{
  /** Adónde lleva. Quien lo arma lo valida (ver `urlDeIngreso`): acá no se corrige. */
  href: string;
  /** El verbo, ya resuelto («Ingresar»). */
  children: ReactNode;
}>;

/** Un enlace con el aspecto del botón primario: navega, no envía nada (para eso está `Boton`). */
export function EnlaceDeAccion({ href, children }: PropsDeEnlaceDeAccion) {
  return (
    <a className={estilos["enlace"]} href={href}>
      {children}
    </a>
  );
}
