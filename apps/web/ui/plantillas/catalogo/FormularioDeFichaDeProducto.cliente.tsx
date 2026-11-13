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
import estilos from "./FormularioDeFichaDeProducto.module.css";
import type { FichaArmada } from "./modelo-de-ficha-de-producto";

export type PropsDeFormularioDeFichaDeProducto = Readonly<{
  ficha: FichaArmada;
  /** La acción de servidor (`guardarFichaAccion` ya ligada al id y la versión que se vieron). */
  accion: AccionDeFormulario;
  /** Si el servidor deja guardar hoy: si no, «Guardar» sale apagado (solo una ayuda: el guard decide; DEC-0346). */
  puedeGuardar: boolean;
}>;

/** Los campos del formulario a los que un error puede apuntarse (los que muestran su propio error). */
const CAMPOS = ["nombre", "codigo", "codigoDeBarras", "alicuota"];

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/** Un dato que solo se ve (la clase y la unidad no se cambian después de crear el producto). */
function SoloLectura({ etiqueta, valor }: Readonly<{ etiqueta: string; valor: string }>) {
  return (
    <dl className={estilos["solo"]}>
      <dt>{etiqueta}</dt>
      <dd>{valor}</dd>
    </dl>
  );
}

/**
 * Los datos de un producto (maqueta `productos.html`, solapa «Datos»): la clase y la unidad, solo a la vista; y el nombre, el nombre de cocina, los códigos, la alícuota y la sección
 * para editar, en ese orden (cocina, alícuota y sección solo si el producto se vende). La validez la decide el servidor: acá no se valida nada. Un error que apunta a un campo se
 * asocia a ese campo (`aria-describedby`); el resto sale debajo con el patrón común. Un desplegable apagado (lo guardado no está entre las opciones) no se manda: el servidor
 * conserva lo guardado. Repetir el envío no duplica: lo evita la regla de repetición del caso de uso; el botón solo ignora el segundo toque.
 */
export function FormularioDeFichaDeProducto({
  ficha,
  accion,
  puedeGuardar,
}: PropsDeFormularioDeFichaDeProducto) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  const [nombre, setNombre] = useState(ficha.nombre.valor);
  const [cocina, setCocina] = useState(ficha.nombreDeCocina?.valor ?? "");
  const [codigo, setCodigo] = useState(ficha.codigo.valor);
  const [barras, setBarras] = useState(ficha.codigoDeBarras.valor);
  const [alicuota, setAlicuota] = useState(ficha.alicuota?.valor ?? "");
  const [seccion, setSeccion] = useState(ficha.seccion?.valor ?? "");

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
          <SoloLectura etiqueta={ficha.clase.etiqueta} valor={ficha.clase.valor} />
          <Campo
            dato="nombre-de-producto"
            etiqueta={ficha.nombre.etiqueta}
            nombre="nombre"
            valor={nombre}
            alCambiar={setNombre}
            autoComplete="off"
            error={errorDe("nombre")}
          />
          {ficha.nombreDeCocina === null ? null : (
            <Campo
              dato="nombre-de-cocina-de-producto"
              etiqueta={ficha.nombreDeCocina.etiqueta}
              nombre="nombreDeCocina"
              valor={cocina}
              alCambiar={setCocina}
              autoComplete="off"
            />
          )}
          <Campo
            dato="codigo-interno-de-producto"
            etiqueta={ficha.codigo.etiqueta}
            nombre="codigo"
            valor={codigo}
            alCambiar={setCodigo}
            autoComplete="off"
            autoCapitalize="off"
            error={errorDe("codigo")}
          />
          <Campo
            dato="codigo-de-barras-de-producto"
            etiqueta={ficha.codigoDeBarras.etiqueta}
            nombre="codigoDeBarras"
            valor={barras}
            alCambiar={setBarras}
            autoComplete="off"
            inputMode="numeric"
            error={errorDe("codigoDeBarras")}
          />
          <SoloLectura etiqueta={ficha.unidad.etiqueta} valor={ficha.unidad.valor} />
          {ficha.alicuota === null ? null : (
            <Selector
              dato="alicuota-de-iva-de-producto"
              etiqueta={ficha.alicuota.etiqueta}
              nombre="alicuota"
              valor={alicuota}
              alCambiar={setAlicuota}
              opciones={ficha.alicuota.opciones}
              textoDeElegir={ficha.textoDeElegir}
              deshabilitado={ficha.alicuota.apagado}
              error={errorDe("alicuota")}
            />
          )}
          {ficha.seccion === null ? null : (
            <Selector
              dato="seccion-de-carta-de-producto"
              etiqueta={ficha.seccion.etiqueta}
              nombre="seccionDeCartaId"
              valor={seccion}
              alCambiar={setSeccion}
              opciones={ficha.seccion.opciones}
              textoDeElegir={ficha.textoDeElegir}
              deshabilitado={ficha.seccion.apagado}
            />
          )}
          {sinCampo ? <ErrorDeRespuesta error={error} /> : null}
          {puedeGuardar ? (
            <BotonDeEnvio>{ficha.guardar}</BotonDeEnvio>
          ) : (
            <Boton deshabilitado>{ficha.guardar}</Boton>
          )}
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
