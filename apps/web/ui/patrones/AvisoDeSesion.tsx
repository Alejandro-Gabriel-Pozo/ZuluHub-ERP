import { useEffect } from "react";
import { Boton } from "../componentes/Boton";
import { Icono } from "../iconos/Icono";
import { Texto } from "../primitivas/Texto";
import { Pila } from "../primitivas/Pila";
import { guardarBorrador, type Borrador } from "./borrador";
import { Superposicion } from "./Superposicion";
import type { EstadoDeSesion } from "./useActividad";

export type TextosDeSesion = Readonly<{
  avisoTitulo: string;
  avisoDetalle: string;
  seguir: string;
  vencidaTitulo: string;
  vencidaDetalle: string;
  ingresarDeNuevo: string;
  cerrar: string;
}>;

export type PropsDeAvisoDeSesion = Readonly<{
  /** Lo calcula quien arma la pantalla (`useActividad` con la función pura de inactividad). */
  estado: EstadoDeSesion;
  textos: TextosDeSesion;
  alSeguir: () => void;
  alIngresar: () => void;
  /**
   * Lo tipeado que no se puede perder. Al vencer la sesión se guarda en `sessionStorage` de la pestaña
   * (nunca claves ni tokens) para recuperarlo al volver a ingresar.
   */
  borrador?: Readonly<{ nombre: string; campos: Borrador }>;
}>;

/**
 * «¿Seguís ahí?» antes de que venza la sesión (WCAG 2.2.1, tiempo ajustable) y aviso de sesión vencida.
 * Con el aviso, «Seguir» mantiene la sesión; vencida, la superposición no se puede cerrar: lo único que
 * queda es volver a ingresar, con lo tipeado a salvo.
 */
export function AvisoDeSesion({
  estado,
  textos,
  alSeguir,
  alIngresar,
  borrador,
}: PropsDeAvisoDeSesion) {
  const nombre = borrador?.nombre;
  const campos = borrador?.campos;
  useEffect(() => {
    if (estado === "vencida" && nombre !== undefined && campos !== undefined) {
      guardarBorrador(nombre, campos);
    }
  }, [estado, nombre, campos]);

  if (estado === "activa") return null;
  const vencida = estado === "vencida";
  return (
    <Superposicion
      abierta
      proposito="confirmar"
      titulo={vencida ? textos.vencidaTitulo : textos.avisoTitulo}
      cerrable={!vencida}
      alCerrar={alSeguir}
      etiquetaDeCerrar={textos.cerrar}
    >
      <Pila separacion={4}>
        <Icono clave="reloj" tamano="grande" decorativo />
        <Texto>{vencida ? textos.vencidaDetalle : textos.avisoDetalle}</Texto>
        {vencida ? (
          <Boton alTocar={alIngresar}>{textos.ingresarDeNuevo}</Boton>
        ) : (
          <Boton alTocar={alSeguir}>{textos.seguir}</Boton>
        )}
      </Pila>
    </Superposicion>
  );
}
