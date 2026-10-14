"use client";

import {
  texto,
  type DiccionarioResuelto,
} from "../../../../src/capacidades/vocabulario/vocabulario";
import { Insignia } from "../componentes/Insignia";
import { useEstadoDeSesion } from "./ProveedorDeSesion.cliente";

/** El estado de la sesión a la vista, con texto (el color solo no alcanza): activa, por vencer o vencida. */
export function IndicadorDeSesion({
  diccionario = {},
}: Readonly<{ diccionario?: DiccionarioResuelto }>) {
  const estado = useEstadoDeSesion();
  if (estado === "vencida") {
    return <Insignia tono="peligro">{texto(diccionario, "sesion.estado_vencida")}</Insignia>;
  }
  if (estado === "por-vencer") {
    return <Insignia tono="aviso">{texto(diccionario, "sesion.estado_por_vencer")}</Insignia>;
  }
  return <Insignia tono="exito">{texto(diccionario, "sesion.estado_activa")}</Insignia>;
}
