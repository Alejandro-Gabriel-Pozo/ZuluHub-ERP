"use client";

import { useActionState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { BotonDeFilaDeProducto } from "./BotonDeFilaDeProducto.cliente";
import estilos from "./PantallasDeSecciones.module.css";
import { CAMPO_DE_AGREGAR, type CandidatosArmados } from "./modelo-de-secciones";
import { sinReiniciar } from "../../patrones/sin-reinicio";

export type PropsDeListaDeCandidatos = Readonly<{
  filas: CandidatosArmados["filas"];
  /** La acción de servidor (`agregarProductoASeccionAccion` ligada a la sección y a los candidatos como la persona los vio). */
  accion: AccionDeFormulario;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * Los productos que se pueden agregar a la sección (maqueta `productos-secciones.html`, cuadro «Agregar producto»): una fila por candidato con su nombre y dónde está hoy. Un solo formulario: cada
 * fila lo envía con su producto. Uno apagado (sin permiso, o que falta completar) se ve pero no se elige. Un error sale debajo con el patrón común y la página se vuelve a pedir. Sin textos propios.
 */
export function ListaDeCandidatos({ filas, accion }: PropsDeListaDeCandidatos) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  return (
    <form action={enviar} onReset={sinReiniciar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <ul className={estilos["lista"]}>
          {filas.map((fila) => (
            <li key={fila.id}>
              <BotonDeFilaDeProducto
                campo={CAMPO_DE_AGREGAR}
                valor={fila.id}
                apagado={fila.apagada}
                forma="fila"
              >
                <span>{fila.nombre}</span>
                <span className={estilos["suave"]}>{fila.donde}</span>
              </BotonDeFilaDeProducto>
            </li>
          ))}
        </ul>
        {resultado.error === null ? null : <ErrorDeRespuesta error={resultado.error} />}
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
