"use client";

import { useActionState, useState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { Selector } from "../../componentes/Selector";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import estilos from "./PantallasDeMesas.module.css";
import type { FormularioDeMesaArmado } from "./modelo-de-mesas";

export type PropsDeFormularioDeMesa = Readonly<{
  formulario: FormularioDeMesaArmado;
  /** La acción de servidor (`crearMesaAccion` ligada a la clave de creación, o `editarMesaAccion` ligada a la mesa y su versión). */
  accion: AccionDeFormulario;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * Alta y edición de una mesa (maqueta `mesas.html`, «Agregar mesa» y «Editar mesa»: el mismo formulario): número, forma, tamaño, columna y fila, «Cancelar» y «Guardar». La validez la
 * decide el servidor (número de 1 a 99, que no se repita, que entre en el salón y que no se pise con otra mesa): acá solo se ofrece «Guardar» con los cinco datos completos. El error sale
 * debajo con el patrón común (los textos propios aprobados, o el genérico). Repetir el envío no duplica: la clave de creación (o la versión) va ligada a la acción por la página y el
 * botón ignora el segundo toque. Sin permiso, «Guardar» sale apagado.
 */
export function FormularioDeMesa({ formulario, accion }: PropsDeFormularioDeMesa) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  const [numero, setNumero] = useState(formulario.numero.valorInicial);
  const [forma, setForma] = useState(formulario.forma.valorInicial);
  const [tamano, setTamano] = useState(formulario.tamano.valorInicial);
  const [columna, setColumna] = useState(formulario.columna.valorInicial);
  const [fila, setFila] = useState(formulario.fila.valorInicial);
  const completo = [numero, forma, tamano, columna, fila].every((v) => v.trim() !== "");
  return (
    <div className={estilos["raiz"]}>
      <a
        className={estilos["volver"]}
        href={formulario.volver.href}
        aria-label={formulario.volver.etiqueta}
      >
        <span aria-hidden="true">‹</span>
      </a>
      <form action={enviar}>
        <ProveedorDeEnvioDeFormulario value={enviando}>
          <Pila separacion={3}>
            <Campo
              dato="numero-de-mesa"
              etiqueta={formulario.numero.etiqueta}
              nombre="numero"
              valor={numero}
              alCambiar={setNumero}
              inputMode="numeric"
              autoComplete="off"
            />
            <Selector
              dato="forma-de-mesa"
              etiqueta={formulario.forma.etiqueta}
              nombre="forma"
              valor={forma}
              alCambiar={setForma}
              opciones={formulario.forma.opciones}
            />
            <Selector
              dato="tamano-de-mesa"
              etiqueta={formulario.tamano.etiqueta}
              nombre="tamano"
              valor={tamano}
              alCambiar={setTamano}
              opciones={formulario.tamano.opciones}
            />
            <Campo
              dato="columna-de-mesa"
              etiqueta={formulario.columna.etiqueta}
              nombre="columna"
              valor={columna}
              alCambiar={setColumna}
              inputMode="numeric"
              autoComplete="off"
            />
            <Campo
              dato="fila-de-mesa"
              etiqueta={formulario.fila.etiqueta}
              nombre="fila"
              valor={fila}
              alCambiar={setFila}
              inputMode="numeric"
              autoComplete="off"
            />
            {resultado.error === null ? null : <ErrorDeRespuesta error={resultado.error} />}
            <div className={estilos["acciones"]}>
              <a className={estilos["secundario"]} href={formulario.cancelar.href}>
                {formulario.cancelar.texto}
              </a>
              {formulario.puedeGuardar && completo ? (
                <BotonDeEnvio>{formulario.guardar}</BotonDeEnvio>
              ) : (
                <Boton deshabilitado>{formulario.guardar}</Boton>
              )}
            </div>
          </Pila>
        </ProveedorDeEnvioDeFormulario>
      </form>
    </div>
  );
}
