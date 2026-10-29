"use client";

import { useState } from "react";
import { Selector } from "../../componentes/Selector";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";
import { Texto } from "../../primitivas/Texto";
import type { EleccionDeSucursalArmada } from "./modelo-del-listado";

export type PropsDeEleccionDeSucursal = Readonly<{
  eleccion: EleccionDeSucursalArmada;
  /** La acción del servidor que guarda la sucursal (valida que sea una de las que la persona puede elegir). */
  accion: AccionDeFormulario;
}>;

/**
 * Elegir la sucursal del listado (D-34). NO es la preferencia local de `SelectorDeSucursal`: la elección tiene que vivir en el
 * servidor, que la valida en cada pedido, así que se guarda con una acción del servidor. Anda sin JavaScript (formulario con acción) y,
 * con él, muestra el error de la acción debajo.
 */
export function EleccionDeSucursal({ eleccion, accion }: PropsDeEleccionDeSucursal) {
  const [elegida, setElegida] = useState(eleccion.elegida);
  return (
    <FormularioDeAccion accion={accion}>
      {eleccion.invitacion === null ? null : <Texto>{eleccion.invitacion}</Texto>}
      <Selector
        etiqueta={eleccion.rotulo}
        nombre="sucursalId"
        valor={elegida}
        alCambiar={setElegida}
        opciones={eleccion.opciones}
        // Sin sucursal elegida, el selector arranca en blanco: tiene que elegir una (no se toma la primera).
        {...(eleccion.elegida === "" ? { textoDeElegir: eleccion.elegir } : {})}
      />
      <BotonDeEnvio variante="secundaria" textoEnviando={eleccion.enviando}>
        {eleccion.aplicar}
      </BotonDeEnvio>
    </FormularioDeAccion>
  );
}
