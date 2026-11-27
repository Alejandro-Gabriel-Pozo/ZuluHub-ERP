"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { Boton } from "../../componentes/Boton.cliente";
import { Selector } from "../../componentes/Selector";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Superposicion } from "../../patrones/Superposicion";
import { Pila } from "../../primitivas/Pila";
import { Texto } from "../../primitivas/Texto";
import { rutaDeLaCopia, type CopiaArmada } from "./modelo-de-opciones";
import estilos from "./HojaDeCopiaDeOpciones.module.css";
import { sinReiniciar } from "../../patrones/sin-reinicio";

export type PropsDeHojaDeCopiaDeOpciones = Readonly<{
  copia: CopiaArmada;
  /** La acción de servidor (`copiarOpcionesAccion` ya ligada al producto, a la versión y a la clave de la copia). */
  accion: AccionDeFormulario;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * «Copiar de otro producto» (maqueta `productos.html`, función `vCopia`): una HOJA sobre la solapa de Opciones, con el selector «Producto», la vista previa de lo que se va a traer
 * (bloque «Variantes» si la copia la trae y bloque «Grupos de opciones»), «Cancelar» y «Copiar». La vista previa la arma SIEMPRE el servidor con la misma función que copia: cambiar
 * el producto navega a `?copiar=<id>` y la página vuelve a pedirla (acá no se calcula nada). «Copiar» sale apagado si no hay nada para traer, si la persona no puede editar (solo una
 * ayuda: el guard decide, DEC-0346) y mientras la vista previa todavía no es la del producto elegido. Cancelar o cerrar vuelve a la solapa; la hoja se abre por la dirección, así que
 * recargar la deja como estaba. Sin textos propios: todos llegan resueltos.
 */
export function HojaDeCopiaDeOpciones({ copia, accion }: PropsDeHojaDeCopiaDeOpciones) {
  const router = useRouter();
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  const [elegido, setElegido] = useState(copia.producto.valor);
  const [delServidor, setDelServidor] = useState(copia.producto.valor);
  // Cuando el servidor devuelve la vista previa de otro producto, ese es el que está elegido.
  if (delServidor !== copia.producto.valor) {
    setDelServidor(copia.producto.valor);
    setElegido(copia.producto.valor);
  }
  const alCerrar = () => {
    router.replace(copia.hrefDeCierre);
  };
  const vistaAlDia = elegido === copia.producto.valor;
  return (
    <Superposicion
      abierta
      titulo={copia.titulo}
      proposito="editar"
      cerrable={!enviando}
      etiquetaDeCerrar={copia.cerrar}
      alCerrar={alCerrar}
    >
      <form action={enviar} onReset={sinReiniciar}>
        <ProveedorDeEnvioDeFormulario value={enviando}>
          <Pila separacion={3}>
            <Selector
              dato="producto-de-origen-de-copia-de-opciones"
              etiqueta={copia.producto.etiqueta}
              nombre="productoOrigenId"
              valor={elegido}
              alCambiar={(valor) => {
                setElegido(valor);
                router.replace(rutaDeLaCopia(copia.id, valor));
              }}
              opciones={copia.producto.opciones}
            />
            {copia.vistaPrevia.map((bloque) => (
              <div key={bloque.titulo} className={estilos["bloque"]}>
                <strong>{bloque.titulo}</strong>
                {bloque.lineas.map((linea) => (
                  <Texto key={linea} variante="suave">
                    {linea}
                  </Texto>
                ))}
              </div>
            ))}
            {resultado.error === null ? null : <ErrorDeRespuesta error={resultado.error} />}
            <div className={estilos["botones"]}>
              <Boton variante="secundaria" alTocar={alCerrar}>
                {copia.cancelar}
              </Boton>
              {copia.copiarApagado || !vistaAlDia ? (
                <Boton deshabilitado>{copia.copiar}</Boton>
              ) : (
                <BotonDeEnvio>{copia.copiar}</BotonDeEnvio>
              )}
            </div>
          </Pila>
        </ProveedorDeEnvioDeFormulario>
      </form>
    </Superposicion>
  );
}
