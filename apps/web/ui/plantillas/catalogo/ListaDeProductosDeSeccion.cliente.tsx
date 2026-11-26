"use client";

import { useActionState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { BotonDeFilaDeProducto } from "./BotonDeFilaDeProducto.cliente";
import estilos from "./PantallasDeSecciones.module.css";
import { CAMPO_DE_QUITAR, type UnaSeccionArmada } from "./modelo-de-secciones";
import { sinReiniciar } from "../../patrones/sin-reinicio";

export type PropsDeListaDeProductosDeSeccion = Readonly<{
  productos: UnaSeccionArmada["productos"];
  quitar: UnaSeccionArmada["quitar"];
  /** La acción de servidor (`quitarProductoDeSeccionAccion` ligada a la sección y a los productos como la persona los vio). */
  accion: AccionDeFormulario;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * Los productos de una sección, en orden alfabético, cada uno con «Quitar» (maqueta `productos-secciones.html`). Un solo formulario: cada botón lo envía con su producto. Sin aviso de éxito (el
 * producto sale de la lista, DDD 12/11, punto 1 de la fila 61); un error (una versión vieja, sin permiso) sale debajo con el patrón común y la página se vuelve a pedir. Sin textos propios.
 */
export function ListaDeProductosDeSeccion({
  productos,
  quitar,
  accion,
}: PropsDeListaDeProductosDeSeccion) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  return (
    <form action={enviar} onReset={sinReiniciar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <ul className={estilos["productos"]}>
          {productos.map((p) => (
            <li key={p.id} className={estilos["producto"]}>
              <span className={estilos["nombre"]}>{p.nombre}</span>
              <BotonDeFilaDeProducto
                campo={CAMPO_DE_QUITAR}
                valor={p.id}
                apagado={quitar.apagado}
                forma="enlace"
                etiqueta={p.etiquetaDeQuitar}
              >
                {quitar.texto}
              </BotonDeFilaDeProducto>
            </li>
          ))}
        </ul>
        {resultado.error === null ? null : <ErrorDeRespuesta error={resultado.error} />}
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
