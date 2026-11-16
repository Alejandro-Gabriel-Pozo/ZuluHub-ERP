"use client";

import { useActionState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { Insignia } from "../../componentes/Insignia";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import {
  ProveedorDeEnvioDeFormulario,
  useEnvioDeFormulario,
} from "../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import estilos from "./PantallasDeSecciones.module.css";
import type { ListaDeSeccionesArmada } from "./modelo-de-secciones";

export type PropsDeListaDeSecciones = Readonly<{
  lista: ListaDeSeccionesArmada;
  /** La acción de servidor (`moverSeccionAccion` ligada a las secciones activas como la persona las vio). */
  accion: AccionDeFormulario;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * Una flecha: un botón de envío que lleva el id de la sección tocada en su `name`/`value` (no es un campo de entrada). Mientras la acción corre ignora el segundo toque (como `Boton`: sin
 * `disabled` para no perder el foco), así el doble toque no manda dos movimientos. El glifo es decorativo; el nombre accesible es el aprobado con el nombre de la sección.
 */
function Flecha({
  etiqueta,
  campo,
  valor,
  glifo,
  apagada,
}: Readonly<{ etiqueta: string; campo: string; valor: string; glifo: string; apagada: boolean }>) {
  const enviando = useEnvioDeFormulario();
  return (
    <button
      type="submit"
      className={estilos["flecha"]}
      name={campo}
      value={valor}
      aria-label={etiqueta}
      disabled={apagada}
      aria-disabled={enviando ? "true" : undefined}
      onClick={(evento) => {
        if (enviando) evento.preventDefault();
      }}
    >
      <span aria-hidden="true">{glifo}</span>
    </button>
  );
}

/**
 * La lista de secciones de la carta (maqueta `productos-secciones.html`): una fila por sección con su nombre (enlace a la sección), la marca «Desactivado» y las flechas ↑ y ↓ de las activas.
 * Un solo formulario: cada flecha lo envía con su sección. Un error (una versión vieja, sin permiso) sale debajo con el patrón común y la página se vuelve a pedir. Sin textos propios: todos
 * llegan resueltos.
 */
export function ListaDeSecciones({ lista, accion }: PropsDeListaDeSecciones) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  return (
    <form action={enviar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <ul className={estilos["lista"]}>
          {lista.filas.map((fila) => (
            <li key={fila.id} className={estilos["fila"]}>
              <a className={estilos["abrir"]} href={fila.href}>
                <span>{fila.nombre}</span>
                {fila.marca === null ? null : <Insignia tono="aviso">{fila.marca}</Insignia>}
              </a>
              {fila.flechas === null ? null : (
                <>
                  <Flecha {...fila.flechas.subir} valor={fila.id} glifo="↑" />
                  <Flecha {...fila.flechas.bajar} valor={fila.id} glifo="↓" />
                </>
              )}
            </li>
          ))}
        </ul>
        {resultado.error === null ? null : <ErrorDeRespuesta error={resultado.error} />}
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
