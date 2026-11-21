"use client";

import { useEffect, useRef, useState } from "react";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";
import { Superposicion } from "../../patrones/Superposicion";
import { useEnLinea } from "../../patrones/useEnLinea";
import { Pila } from "../../primitivas/Pila";
import { Texto } from "../../primitivas/Texto";
import estilos from "./HojaDeMotivo.module.css";

export type PropsDeHojaDeMotivo = Readonly<{
  /** La acción del servidor, ya ligada a la orden (`bind`): cancelar o anular. */
  accion: AccionDeFormulario;
  /** El botón que abre la hoja y el que confirma: el mismo verbo («Anular la orden»). */
  boton: string;
  /** El título de la hoja («Anular la orden 13»). */
  titulo: string;
  textos: Readonly<{
    motivo: string;
    cancelar: string;
    cerrar: string;
    /** Qué pasa al confirmar (solo al anular); `null` no lleva. */
    explicacion: string | null;
    /** Lo que se dice cuando no hay conexión: la confirmación sale apagada (no hay modo sin conexión). */
    sinConexion: string;
  }>;
}>;

/**
 * La hoja de motivo de la ficha de una orden de producción (maqueta `produccion.html`, hoja «Anular la orden», 09/11/2026; decisión del 15/11/2026: cancelar usa la misma hoja):
 * un botón que la abre, el campo «Motivo» y la confirmación, que sale apagada mientras el motivo esté en blanco (como la maqueta). El servidor vuelve a validar el motivo (largo y
 * caracteres) y el permiso. Repetir el envío no duplica: cancelar y anular deciden por estado (`yaEstaba`); el botón solo ignora el segundo toque mientras la acción corre.
 */
export function HojaDeMotivo({ accion, boton, titulo, textos }: PropsDeHojaDeMotivo) {
  const [abierta, setAbierta] = useState(false);
  const [motivo, setMotivo] = useState("");
  const enLinea = useEnLinea();
  const envolturaDelBoton = useRef<HTMLSpanElement>(null);
  const estabaAbierta = useRef(false);

  // Al cerrarse la hoja el foco vuelve al botón que la abrió. `Superposicion` lo restaura al elemento activo de entonces, que en Safari no es el botón (tocar un botón no le da el foco):
  // se fija acá, sin depender de eso (igual que el detalle de un punto de venta).
  useEffect(() => {
    if (estabaAbierta.current && !abierta) {
      envolturaDelBoton.current?.querySelector("button")?.focus();
    }
    estabaAbierta.current = abierta;
  }, [abierta]);

  function cerrar(): void {
    setAbierta(false);
    setMotivo("");
  }

  return (
    <>
      <span ref={envolturaDelBoton}>
        <Boton
          variante="secundaria"
          alTocar={() => {
            setAbierta(true);
          }}
        >
          {boton}
        </Boton>
      </span>
      <Superposicion
        abierta={abierta}
        titulo={titulo}
        proposito="confirmar"
        cerrable
        etiquetaDeCerrar={textos.cerrar}
        alCerrar={cerrar}
      >
        <FormularioDeAccion accion={accion}>
          {textos.explicacion === null ? null : <Texto>{textos.explicacion}</Texto>}
          <Campo
            dato="motivo-de-orden-de-produccion"
            etiqueta={textos.motivo}
            nombre="motivo"
            valor={motivo}
            alCambiar={setMotivo}
            autoComplete="off"
          />
          <div className={estilos["botones"]}>
            <Pila separacion={2}>
              {motivo.trim() === "" || !enLinea ? (
                <Boton variante="primaria" deshabilitado ancho="completo">
                  {boton}
                </Boton>
              ) : (
                <BotonDeEnvio ancho="completo">{boton}</BotonDeEnvio>
              )}
              {enLinea ? null : <Texto variante="suave">{textos.sinConexion}</Texto>}
              <Boton variante="secundaria" alTocar={cerrar} ancho="completo">
                {textos.cancelar}
              </Boton>
            </Pila>
          </div>
        </FormularioDeAccion>
      </Superposicion>
    </>
  );
}
