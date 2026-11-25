"use client";

import { useActionState, useState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { REGLA_DE_CANTIDAD } from "../../../../../src/capacidades/experiencia/reglas-de-cantidad";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { CampoNumero } from "../../componentes/CampoNumero";
import { Casilla } from "../../componentes/Casilla";
import { Insignia } from "../../componentes/Insignia";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import estilos from "./PantallasDePresentaciones.module.css";
import {
  sePuedeGuardarLaPresentacion,
  type FormularioDePresentacionArmado,
} from "./modelo-de-presentaciones";

export type PropsDeFormularioDePresentacion = Readonly<{
  formulario: FormularioDePresentacionArmado;
  /** La acción de servidor (`crearPresentacionAccion` ligada al producto, o `renombrarPresentacionAccion` ligada al producto, la presentación y su versión). */
  accion: AccionDeFormulario;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * Agregar una presentación (nombre, cantidad en la unidad base y «De peso variable») o editar su nombre (la cantidad se ve y no se cambia: otra cantidad es otra presentación). Con «De peso variable»
 * la cantidad pasa a llamarse «Peso aproximado»: es el mismo dato. La validez la decide el servidor: acá solo se ofrece «Guardar» con lo mínimo escrito. Un error que apunta al campo se asocia a él
 * (`aria-describedby`); el resto sale debajo con el patrón común. Repetir el envío no duplica: el servidor devuelve la presentación ya creada y el botón ignora el segundo toque. Sin permiso, «Guardar»
 * sale apagado.
 */
export function FormularioDePresentacion({ formulario, accion }: PropsDeFormularioDePresentacion) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  const [nombre, setNombre] = useState(formulario.nombre.valorInicial);
  const [cantidad, setCantidad] = useState("");
  const [pesoVariable, setPesoVariable] = useState(false);
  const error = resultado.error;
  const delaCantidad = error?.campo === "cantidad";
  const delNombre = error?.campo === "nombre";
  return (
    <div className={estilos["raiz"]}>
      <form action={enviar}>
        <ProveedorDeEnvioDeFormulario value={enviando}>
          <Pila separacion={3}>
            <Campo
              dato="nombre-de-presentacion"
              etiqueta={formulario.nombre.etiqueta}
              nombre="nombre"
              valor={nombre}
              alCambiar={setNombre}
              autoComplete="off"
              error={delNombre ? texto({}, error.clave) : undefined}
            />
            {formulario.modo === "ALTA" ? (
              <>
                <CampoNumero
                  dato="cantidad-de-presentacion"
                  etiqueta={
                    pesoVariable
                      ? formulario.cantidad.etiquetaDePesoAproximado
                      : formulario.cantidad.etiqueta
                  }
                  nombre="cantidad"
                  valor={cantidad}
                  alCambiar={setCantidad}
                  regla={REGLA_DE_CANTIDAD}
                  error={delaCantidad ? texto({}, error.clave) : undefined}
                />
                <Casilla
                  dato="presentacion-de-peso-variable"
                  etiqueta={formulario.pesoVariable.etiqueta}
                  nombre="pesoVariable"
                  marcada={pesoVariable}
                  alCambiar={setPesoVariable}
                />
              </>
            ) : formulario.actual === null ? null : (
              <div className={estilos["actual"]}>
                <span>{formulario.actual.rotulo}</span>
                <span>{formulario.actual.valor}</span>
                {formulario.actual.marca === null ? null : (
                  <Insignia tono="neutro">{formulario.actual.marca}</Insignia>
                )}
              </div>
            )}
            {error === null || delNombre || delaCantidad ? null : (
              <ErrorDeRespuesta error={error} />
            )}
            <div className={estilos["acciones"]}>
              <a className={estilos["secundario"]} href={formulario.cancelar.href}>
                {formulario.cancelar.texto}
              </a>
              {formulario.puedeGuardar &&
              sePuedeGuardarLaPresentacion(formulario.modo, nombre, cantidad) ? (
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
