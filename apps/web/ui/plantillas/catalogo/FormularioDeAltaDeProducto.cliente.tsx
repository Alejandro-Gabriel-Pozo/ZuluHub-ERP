"use client";

import { useActionState, useState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { Selector } from "../../componentes/Selector";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import type { AltaArmada } from "./modelo-de-alta-de-producto";

export type PropsDeFormularioDeAltaDeProducto = Readonly<{
  alta: AltaArmada;
  /** La acción de servidor (`crearProductoAccion` ya ligada a la clave de creación que fijó la página). */
  accion: AccionDeFormulario;
  /** Si el servidor deja crear hoy: si no, «Guardar» sale apagado (solo una ayuda: el guard decide; DEC-0346). */
  puedeCrear: boolean;
}>;

/** Los campos del formulario a los que un error puede apuntarse (los que muestran su propio error). */
const CAMPOS = ["nombre", "codigo", "codigoDeBarras", "alicuota"];

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * El alta de un producto (maqueta `productos.html`, «Nuevo producto»): la clase, el nombre, el nombre de cocina, los códigos, la unidad, la alícuota y la sección, en ese orden
 * (cocina, alícuota y sección solo si la clase se vende). La validez la decide el servidor: acá no se valida nada. Un error que apunta a un campo se asocia a ese campo
 * (`aria-describedby`); el resto sale debajo con el patrón común. Repetir el envío no duplica: la clave de creación va ligada a la acción (la fijó la página) y el botón solo ignora el
 * segundo toque. Lo que una clase que no se vende no lleva no se muestra, y por eso no se manda.
 */
export function FormularioDeAltaDeProducto({
  alta,
  accion,
  puedeCrear,
}: PropsDeFormularioDeAltaDeProducto) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  const [clase, setClase] = useState(alta.clase.valorInicial);
  const [nombre, setNombre] = useState("");
  const [cocina, setCocina] = useState("");
  const [codigo, setCodigo] = useState("");
  const [barras, setBarras] = useState("");
  const [unidad, setUnidad] = useState(alta.unidad.valorInicial);
  const [alicuota, setAlicuota] = useState("");
  const [seccion, setSeccion] = useState("");

  const seVende = alta.clase.queSeVenden.includes(clase);
  const error = resultado.error;
  const campoDelError = error?.campo;
  const textoDeError = error === null ? undefined : texto({}, error.clave);
  const errorDe = (campo: string): string | undefined =>
    campoDelError === campo ? textoDeError : undefined;
  const sinCampo = error !== null && !CAMPOS.includes(campoDelError ?? "");

  return (
    <form action={enviar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={3}>
          <Selector
            dato="clase-de-uso-de-producto"
            etiqueta={alta.clase.etiqueta}
            nombre="claseDeUso"
            valor={clase}
            alCambiar={setClase}
            opciones={alta.clase.opciones}
          />
          <Campo
            dato="nombre-de-producto"
            etiqueta={alta.nombre.etiqueta}
            nombre="nombre"
            valor={nombre}
            alCambiar={setNombre}
            autoComplete="off"
            error={errorDe("nombre")}
          />
          {seVende ? (
            <Campo
              dato="nombre-de-cocina-de-producto"
              etiqueta={alta.nombreDeCocina.etiqueta}
              nombre="nombreDeCocina"
              valor={cocina}
              alCambiar={setCocina}
              autoComplete="off"
            />
          ) : null}
          <Campo
            dato="codigo-interno-de-producto"
            etiqueta={alta.codigo.etiqueta}
            nombre="codigo"
            valor={codigo}
            alCambiar={setCodigo}
            autoComplete="off"
            autoCapitalize="off"
            error={errorDe("codigo")}
          />
          <Campo
            dato="codigo-de-barras-de-producto"
            etiqueta={alta.codigoDeBarras.etiqueta}
            nombre="codigoDeBarras"
            valor={barras}
            alCambiar={setBarras}
            autoComplete="off"
            inputMode="numeric"
            error={errorDe("codigoDeBarras")}
          />
          <Selector
            dato="unidad-de-medida-de-producto"
            etiqueta={alta.unidad.etiqueta}
            nombre="unidadBaseId"
            valor={unidad}
            alCambiar={setUnidad}
            opciones={alta.unidad.opciones}
          />
          {seVende ? (
            <Selector
              dato="alicuota-de-iva-de-producto"
              etiqueta={alta.alicuota.etiqueta}
              nombre="alicuota"
              valor={alicuota}
              alCambiar={setAlicuota}
              opciones={alta.alicuota.opciones}
              textoDeElegir={alta.textoDeElegir}
              error={errorDe("alicuota")}
            />
          ) : null}
          {seVende ? (
            <Selector
              dato="seccion-de-carta-de-producto"
              etiqueta={alta.seccion.etiqueta}
              nombre="seccionDeCartaId"
              valor={seccion}
              alCambiar={setSeccion}
              opciones={alta.seccion.opciones}
              textoDeElegir={alta.textoDeElegir}
            />
          ) : null}
          {sinCampo ? <ErrorDeRespuesta error={error} /> : null}
          {puedeCrear ? (
            <BotonDeEnvio>{alta.guardar}</BotonDeEnvio>
          ) : (
            <Boton deshabilitado>{alta.guardar}</Boton>
          )}
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
