"use client";

import { useActionState, useState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import type { CodigoDeProduccion } from "../../../../../src/capacidades/experiencia/respuesta-de-produccion";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton.cliente";
import { Casilla } from "../../componentes/Casilla";
import { Campo } from "../../componentes/Campo";
import { Selector } from "../../componentes/Selector";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { Superposicion } from "../../patrones/Superposicion";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import estilosDeCobrar from "../cobrar/Cobrar.module.css";
import estilos from "./FormularioDeFichaDeProducto.module.css";
import type { FichaArmada } from "./modelo-de-ficha-de-producto";
import { sinReiniciar } from "../../patrones/sin-reinicio";

export type PropsDeFormularioDeFichaDeProducto = Readonly<{
  ficha: FichaArmada;
  /** La acción de servidor (`guardarFichaAccion` ya ligada al id y la versión que se vieron). */
  accion: AccionDeFormulario;
  /** Si el servidor deja guardar hoy: si no, «Guardar» sale apagado (solo una ayuda: el guard decide; DEC-0346). */
  puedeGuardar: boolean;
  /**
   * El tilde «Se controla el stock»: `null` si no se dibuja (clase que no se controla, producto desactivado, módulo `stock` sin activar o sin poder leerlo). Con `puedeCambiar` en `false`
   * (sin `articulos.controlar`) se ve apagada, con su estado real.
   */
  controlDeStock: Readonly<{ marcada: boolean; puedeCambiar: boolean }> | null;
}>;

/** Los campos del formulario a los que un error puede apuntarse (los que muestran su propio error). */
const CAMPOS = ["nombre", "codigo", "codigoDeBarras", "alicuota"];

/** El código del aviso «hay cuentas abiertas con este plato» (DEC-PRO-004): no es un fallo, la persona confirma y se reenvía. */
const CODIGO_DE_AVISO = "PRODUCCION_CUENTAS_ABIERTAS" satisfies CodigoDeProduccion;

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
  controlDeStock,
}: PropsDeFormularioDeFichaDeProducto) {
  // Con cuentas abiertas que tienen el plato, encender el stock propio vuelve con un aviso: el botón pasa a «Confirmar» y reenvía con `confirmarCuentasAbiertas=1`. Cambiar cualquier dato descarta la confirmación.
  const [avisado, setAvisado] = useState(false);
  const conAviso: AccionDeFormulario = async (previo, datos) => {
    if (avisado) datos.set("confirmarCuentasAbiertas", "1");
    // Cuando la acción sale bien, Next redirige y el pedido no devuelve valor: por eso `| undefined`.
    const respuesta: Awaited<ReturnType<AccionDeFormulario>> | undefined = await accion(
      previo,
      datos,
    );
    setAvisado(respuesta?.error?.codigo === CODIGO_DE_AVISO);
    return respuesta;
  };
  const [resultado, enviar, enviando] = useActionState(conAviso, SIN_ERROR);
  const [nombre, setNombre] = useState(ficha.nombre.valor);
  const [cocina, setCocina] = useState(ficha.nombreDeCocina?.valor ?? "");
  const [codigo, setCodigo] = useState(ficha.codigo.valor);
  const [barras, setBarras] = useState(ficha.codigoDeBarras.valor);
  const [alicuota, setAlicuota] = useState(ficha.alicuota?.valor ?? "");
  const [seccion, setSeccion] = useState(ficha.seccion?.valor ?? "");
  const [controlado, setControlado] = useState(controlDeStock?.marcada ?? false);
  // El valor que la persona pidió y espera confirmación; `null` sin diálogo. La casilla no cambia hasta confirmar.
  const [porConfirmar, setPorConfirmar] = useState<boolean | null>(null);
  const confirmacion = ficha.confirmacionDelControlDeStock;

  const error = resultado.error;
  const campoDelError = error?.campo;
  const textoDeError = error === null ? undefined : texto({}, error.clave);
  const errorDe = (campo: string): string | undefined =>
    campoDelError === campo ? textoDeError : undefined;
  const sinCampo = error !== null && !CAMPOS.includes(campoDelError ?? "");

  return (
    <>
      <form action={enviar} onReset={sinReiniciar}>
        <ProveedorDeEnvioDeFormulario value={enviando}>
          <Pila separacion={3}>
            <SoloLectura etiqueta={ficha.clase.etiqueta} valor={ficha.clase.valor} />
            <Campo
              dato="nombre-de-producto"
              etiqueta={ficha.nombre.etiqueta}
              nombre="nombre"
              valor={nombre}
              alCambiar={(valor) => {
                setAvisado(false);
                setNombre(valor);
              }}
              autoComplete="off"
              error={errorDe("nombre")}
            />
            {ficha.nombreDeCocina === null ? null : (
              <Campo
                dato="nombre-de-cocina-de-producto"
                etiqueta={ficha.nombreDeCocina.etiqueta}
                nombre="nombreDeCocina"
                valor={cocina}
                alCambiar={(valor) => {
                  setAvisado(false);
                  setCocina(valor);
                }}
                autoComplete="off"
              />
            )}
            <Campo
              dato="codigo-interno-de-producto"
              etiqueta={ficha.codigo.etiqueta}
              nombre="codigo"
              valor={codigo}
              alCambiar={(valor) => {
                setAvisado(false);
                setCodigo(valor);
              }}
              autoComplete="off"
              autoCapitalize="off"
              error={errorDe("codigo")}
            />
            <Campo
              dato="codigo-de-barras-de-producto"
              etiqueta={ficha.codigoDeBarras.etiqueta}
              nombre="codigoDeBarras"
              valor={barras}
              alCambiar={(valor) => {
                setAvisado(false);
                setBarras(valor);
              }}
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
                alCambiar={(valor) => {
                  setAvisado(false);
                  setAlicuota(valor);
                }}
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
                alCambiar={(valor) => {
                  setAvisado(false);
                  setSeccion(valor);
                }}
                opciones={ficha.seccion.opciones}
                textoDeElegir={ficha.textoDeElegir}
                deshabilitado={ficha.seccion.apagado}
              />
            )}
            {ficha.enlaceDeSecciones === null ? null : (
              <a className={estilos["enlace"]} href={ficha.enlaceDeSecciones.href}>
                {ficha.enlaceDeSecciones.texto}
              </a>
            )}
            {controlDeStock === null || ficha.etiquetaDelControlDeStock === null ? null : (
              <Casilla
                dato="control-de-stock-de-producto"
                etiqueta={ficha.etiquetaDelControlDeStock}
                nombre="seControlaElStock"
                marcada={controlado}
                alCambiar={(valor) => {
                  if (valor !== controlado) {
                    setAvisado(false);
                    setPorConfirmar(valor);
                  }
                }}
                apagada={!controlDeStock.puedeCambiar}
              />
            )}
            {sinCampo ? <ErrorDeRespuesta error={error} /> : null}
            {puedeGuardar ? (
              <BotonDeEnvio>
                {avisado && confirmacion !== null ? confirmacion.confirmar : ficha.guardar}
              </BotonDeEnvio>
            ) : (
              <Boton deshabilitado>{ficha.guardar}</Boton>
            )}
          </Pila>
        </ProveedorDeEnvioDeFormulario>
      </form>
      {confirmacion === null || porConfirmar === null ? null : (
        <Superposicion
          abierta
          titulo={confirmacion.titulo}
          proposito="confirmar"
          alCerrar={() => {
            setPorConfirmar(null);
          }}
          cerrable
          etiquetaDeCerrar={confirmacion.cerrar}
        >
          <div className={estilosDeCobrar["cuerpo"]}>
            <p>{porConfirmar ? confirmacion.activar : confirmacion.apagar}</p>
            <div className={estilosDeCobrar["acciones"]}>
              <Boton
                ancho="completo"
                alTocar={() => {
                  setControlado(porConfirmar);
                  setPorConfirmar(null);
                }}
              >
                {confirmacion.confirmar}
              </Boton>
              <Boton
                variante="secundaria"
                ancho="completo"
                alTocar={() => {
                  setPorConfirmar(null);
                }}
              >
                {confirmacion.cancelar}
              </Boton>
            </div>
          </div>
        </Superposicion>
      )}
    </>
  );
}
