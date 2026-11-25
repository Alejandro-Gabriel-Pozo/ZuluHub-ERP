"use client";

import { useActionState, useState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { Boton } from "../../componentes/Boton.cliente";
import { CampoImporte } from "../../componentes/CampoImporte";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import {
  textoDelErrorDePrecios,
  type PreciosPorMedidaArmados,
} from "./modelo-de-precios-por-medida";

export type PropsDeFormularioDePreciosPorMedida = Readonly<{
  precios: PreciosPorMedidaArmados;
  /** La acción de servidor (`cambiarPreciosPorMedidaAccion` ya ligada al producto, a la clave del cambio y a las filas vistas). */
  accion: AccionDeFormulario;
  /** Si el servidor deja cambiar hoy: si no, «Guardar» sale apagado (solo una ayuda: el guard decide; DEC-0346). */
  puedeGuardar: boolean;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * Los precios por medida de un producto (maqueta `productos.html`, solapa «Precios» con variante): un campo de precio (IVA incluido, de la empresa) por cada medida y «Guardar». La validez
 * la decide el servidor: acá no se valida nada. Un error que apunta al campo de una medida se asocia a él; el resto sale debajo con el patrón común. El precio viaja como texto decimal
 * canónico (`CampoImporte`, ADR-006). Una medida que se deja vacía no se toca. Repetir el envío no duplica: la clave del cambio la fija la página.
 */
export function FormularioDePreciosPorMedida({
  precios,
  accion,
  puedeGuardar,
}: PropsDeFormularioDePreciosPorMedida) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  const [valores, setValores] = useState(precios.campos.map((c) => c.valorInicial));
  const error = resultado.error;
  const delCampo = precios.campos.some((c) => c.nombreDelCampo === error?.campo);
  return (
    <form action={enviar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={3}>
          {precios.campos.map((campo, i) => (
            <CampoImporte
              key={campo.nombreDelCampo}
              dato="precio-de-medida-de-producto"
              etiqueta={campo.etiqueta}
              nombre={campo.nombreDelCampo}
              valor={valores[i] ?? ""}
              alCambiar={(valor) => {
                setValores((actuales) => actuales.map((v, j) => (j === i ? valor : v)));
              }}
              error={
                error !== null && error.campo === campo.nombreDelCampo
                  ? textoDelErrorDePrecios(error)
                  : undefined
              }
            />
          ))}
          {error !== null && !delCampo ? <ErrorDeRespuesta error={error} /> : null}
          {puedeGuardar ? (
            <BotonDeEnvio>{precios.guardar}</BotonDeEnvio>
          ) : (
            <Boton deshabilitado>{precios.guardar}</Boton>
          )}
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
