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
import { Texto } from "../../primitivas/Texto";
import estilos from "./FormularioDePrecioDeProducto.module.css";
import { textoDelError, type PreciosArmados } from "./modelo-de-precios-de-producto";

export type PropsDeFormularioDePrecioDeProducto = Readonly<{
  precios: PreciosArmados;
  /** La acción de servidor (`cambiarPrecioAccion` ya ligada al producto, a la clave del cambio y a la fila que se vio como vigente). */
  accion: AccionDeFormulario;
  /** Si el servidor deja cambiar hoy: si no, «Guardar» sale apagado (solo una ayuda: el guard decide; DEC-0346). */
  puedeGuardar: boolean;
}>;

/** El único campo al que un error puede apuntarse. */
const CAMPO = "precio";

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * Los precios de un producto (maqueta `productos.html`, solapa «Precios»): el precio de la empresa (IVA incluido) para editar, desde cuándo rige o «Precio abierto», y el historial.
 * Un producto con variante activa solo dice «Según medida». La validez la decide el servidor: acá no se valida nada. Un error que apunta al campo se asocia a él
 * (`aria-describedby`); el resto sale debajo con el patrón común. El importe viaja como texto decimal canónico (`CampoImporte`, ADR-006). Repetir el envío no duplica: la clave del
 * cambio la fija la página, así que el doble toque y el reintento mandan la misma y el caso de uso la reconoce; el botón solo ignora el segundo toque.
 */
export function FormularioDePrecioDeProducto({
  precios,
  accion,
  puedeGuardar,
}: PropsDeFormularioDePrecioDeProducto) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  const [precio, setPrecio] = useState(precios.campo.valorInicial);

  if (precios.segunMedida !== null) return <Texto>{precios.segunMedida}</Texto>;

  const error = resultado.error;
  const sinCampo = error !== null && error.campo !== CAMPO;
  return (
    <form action={enviar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={3}>
          <CampoImporte
            dato="precio-de-venta-de-producto"
            etiqueta={precios.campo.etiqueta}
            nombre={CAMPO}
            valor={precio}
            alCambiar={setPrecio}
            error={error !== null && error.campo === CAMPO ? textoDelError(error) : undefined}
          />
          <span className={estilos["suave"]}>{precios.vigencia}</span>
          {precios.historial === null ? null : (
            <section className={estilos["historial"]} aria-labelledby="historial-de-precios">
              <h2 id="historial-de-precios">{precios.historial.titulo}</h2>
              <ul>
                {precios.historial.filas.map((fila, i) => (
                  <li key={`${fila.desde}-${String(i)}`}>
                    <span>{fila.precio}</span>
                    <span>{fila.desde}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {sinCampo ? <ErrorDeRespuesta error={error} /> : null}
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
