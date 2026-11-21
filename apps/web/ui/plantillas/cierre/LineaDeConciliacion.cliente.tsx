"use client";

import { useState } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { CampoImporte } from "../../componentes/CampoImporte";
import { BotonDeAccionDelCierre, type AccionDelCierre } from "./BotonDeAccionDelCierre.cliente";
import type { LineaVista } from "./modelo-del-cierre";
import estilos from "./PantallaDelCierre.module.css";

type Props = Readonly<{
  linea: LineaVista;
  fechaDeNegocio: string;
  /** El día está en cierre: el total de un medio que no es efectivo se puede escribir y declarar. */
  editable: boolean;
  /** La persona puede declarar (`declaraciones_de_total.registrar`): sin permiso el campo y «Guardar» salen apagados (una ayuda: el servidor decide). */
  puedeDeclarar: boolean;
  declarar: AccionDelCierre;
  alDeclarar: (respuesta: Respuesta<unknown>) => void;
}>;

/**
 * Una línea de la conciliación por medio: lo registrado, las correcciones si las hubo, lo declarado y la diferencia. El efectivo muestra lo contado por billetes (no se declara); el resto,
 * con el día en cierre, un campo de importe y «Guardar» (una declaración nueva por cada guardado: rige la última; 0 vale). El importe viaja como TEXTO decimal canónico (ADR-006). Idempotente:
 * la clave del intento la pone `BotonDeAccionDelCierre`. Cerrada, solo se mira.
 */
export function LineaDeConciliacion({
  linea,
  fechaDeNegocio,
  editable,
  puedeDeclarar,
  declarar,
  alDeclarar,
}: Props) {
  const [importe, setImporte] = useState(linea.declaradoCanonico);
  const campo = editable && linea.declarable;
  return (
    <li className={estilos["tarjeta"]}>
      <div className={estilos["renglon"]}>
        <strong>{linea.titulo}</strong>
        {linea.cuenta === null ? null : <span className={estilos["suave"]}>{linea.cuenta}</span>}
      </div>
      <div className={estilos["renglon"]}>
        <span className={estilos["suave"]}>{texto({}, "cierre.conciliacion.registrado")}</span>
        <span className={estilos["monto"]}>{linea.registrado}</span>
      </div>
      {linea.correcciones === null ? null : (
        <div className={estilos["renglon"]}>
          <span className={estilos["suave"]}>{texto({}, "cierre.conciliacion.correcciones")}</span>
          <span className={estilos["monto"]}>{linea.correcciones}</span>
        </div>
      )}
      {campo ? (
        <>
          <CampoImporte
            dato="importe-de-total-declarado"
            etiqueta={texto({}, "cierre.conciliacion.declarado")}
            valor={importe}
            alCambiar={setImporte}
            deshabilitado={!puedeDeclarar}
          />
          <BotonDeAccionDelCierre
            variante="secundaria"
            deshabilitado={!puedeDeclarar || importe === ""}
            accion={declarar}
            conClave
            armarPedido={() => ({
              fechaDeNegocio,
              medioDePagoId: linea.medioDePagoId,
              cuentaDeCobroId: linea.cuentaDeCobroId,
              importe,
            })}
            alResponder={alDeclarar}
          >
            {texto({}, "caja.accion.guardar")}
          </BotonDeAccionDelCierre>
        </>
      ) : (
        <div className={estilos["renglon"]}>
          <span className={estilos["suave"]}>{texto({}, "cierre.conciliacion.declarado")}</span>
          <span className={estilos["monto"]}>{linea.declarado ?? ""}</span>
        </div>
      )}
      <div className={estilos["renglon"]}>
        <span className={estilos["suave"]}>{texto({}, "cierre.conciliacion.diferencia")}</span>
        <strong className={estilos["monto"]} data-tono={linea.tonoDeDiferencia}>
          {linea.diferencia}
        </strong>
      </div>
    </li>
  );
}
