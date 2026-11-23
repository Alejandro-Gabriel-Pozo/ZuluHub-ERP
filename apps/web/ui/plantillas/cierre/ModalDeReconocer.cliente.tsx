"use client";

import { useState } from "react";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { Superposicion } from "../../patrones/Superposicion";
import type { ControlVisto } from "./modelo-del-cierre";
import estilos from "./PantallaDelCierre.module.css";

type Props = Readonly<{
  control: ControlVisto;
  /** Marca el control para reconocerlo al cerrar el día, con la observación (en blanco: sin observación). Nada se manda al servidor hasta cerrar (DDD:172, 2 A). */
  alMarcar: (observacion: string) => void;
  alCancelar: () => void;
}>;

/**
 * «Reconocer · {control}»: la observación opcional y los dos botones, «Cancelar» y «Reconocer» (maqueta aceptada, DDD:183). «Reconocer» solo guarda la marca en la pantalla: quién y cuándo
 * se completan al CERRAR el día, en la misma transacción (decisión del dueño, 15/11/2026, 2 A). El largo y la lista de permitidos de la observación son los de la explicación: los decide
 * el servidor al cerrar (`primitivas/texto/explicacion.ts`) y el campo no repite ninguno.
 */
export function ModalDeReconocer({ control, alMarcar, alCancelar }: Props) {
  const [observacion, setObservacion] = useState("");
  return (
    <Superposicion
      abierta
      proposito="editar"
      titulo={`${texto({}, "cierre.reconocer")} · ${control.rotulo}`}
      alCerrar={alCancelar}
      cerrable
      etiquetaDeCerrar={texto({}, "vidriera.producto.cerrar")}
    >
      <div className={estilos["formulario"]}>
        <Campo
          dato="texto-de-reconocimiento"
          etiqueta={texto({}, "caja.arqueo.observacion_opcional")}
          valor={observacion}
          alCambiar={setObservacion}
        />
        <div className={estilos["botones"]}>
          <Boton variante="secundaria" ancho="completo" alTocar={alCancelar}>
            {texto({}, "catalogo.accion.cancelar")}
          </Boton>
          <Boton
            ancho="completo"
            alTocar={() => {
              alMarcar(observacion);
            }}
          >
            {texto({}, "cierre.reconocer")}
          </Boton>
        </div>
      </div>
    </Superposicion>
  );
}
