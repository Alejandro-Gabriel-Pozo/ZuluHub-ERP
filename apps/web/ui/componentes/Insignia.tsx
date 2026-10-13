import type { ClaveDeIcono } from "../iconos/catalogo";
import { Icono } from "../iconos/Icono";
import estilos from "./Insignia.module.css";

export type TonoDeEstado = "peligro" | "exito" | "aviso" | "info";

const ICONO_DE_ESTADO = {
  peligro: "estado-peligro",
  exito: "estado-exito",
  aviso: "estado-aviso",
  info: "estado-info",
} as const satisfies Record<TonoDeEstado, ClaveDeIcono>;

/** El ícono de un estado. Lo comparten la insignia y el aviso: el estado nunca se dice solo con color. */
export function iconoDeEstado(tono: TonoDeEstado): ClaveDeIcono {
  return ICONO_DE_ESTADO[tono];
}

export type PropsDeInsignia = Readonly<{
  tono: TonoDeEstado | "neutro";
  /** El texto del estado, ya resuelto («Cobrado», «Pendiente»). Siempre hay texto: el color solo no alcanza. */
  children: string;
}>;

export function Insignia({ tono, children }: PropsDeInsignia) {
  return (
    <span className={estilos["insignia"]} data-tono={tono}>
      {tono === "neutro" ? null : <Icono clave={iconoDeEstado(tono)} tamano="chico" decorativo />}
      <span>{children}</span>
    </span>
  );
}
