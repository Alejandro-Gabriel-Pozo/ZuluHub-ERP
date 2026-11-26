"use client";

import { useActionState, useState } from "react";
import { leerDireccionPegada } from "../../../../../src/capacidades/activos/direccion-externa";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { colorDeLaCarta } from "../../../../../src/capacidades/experiencia/vidriera/color-de-la-carta";
import { COLOR_RRGGBB } from "../../../../../src/primitivas/color/contraste";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { OpcionesExcluyentes } from "../../componentes/OpcionesExcluyentes";
import { Selector } from "../../componentes/Selector";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import estilos from "./PantallaDeCartaEnLinea.module.css";
import { OTRO_COLOR, type CartaEnLineaArmada } from "./modelo-de-carta-en-linea";
import { sinReiniciar } from "../../patrones/sin-reinicio";

export type PropsDeFormularioDeCartaEnLinea = Readonly<{
  formulario: CartaEnLineaArmada["formulario"];
  /** La acción de servidor (`guardarLosTextosAccion`), ligada a la carta, la sucursal y la versión que se vio. */
  accion: AccionDeFormulario;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * Los textos de la carta (maqueta `carta-en-linea.html`): nombre, rubro y lugar, y su identidad (V1; maquetas `carta.html` y `carta-caras.html`): cara, color y logo. La validez la decide el servidor: acá solo se
 * ofrece «Guardar» con un nombre que no esté vacío, con permiso y sin un color u dirección de logo mal escritos (se avisan con los textos aprobados; el servidor los vuelve a decidir). El aviso de contraste
 * no impide guardar: el color se guarda como se eligió y se muestra ajustado. Un
 * error que apunta al nombre se asocia a él (`aria-describedby`); el resto sale debajo con el patrón común. Repetir el envío no duplica: la clave de la carta (y su versión) va ligada a la acción por
 * la página, y el botón solo ignora el segundo toque. Sin permiso, «Guardar» sale apagado.
 */
export function FormularioDeCartaEnLinea({ formulario, accion }: PropsDeFormularioDeCartaEnLinea) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  const [nombre, setNombre] = useState(formulario.nombre.valorInicial);
  const [rubro, setRubro] = useState(formulario.rubro.valorInicial);
  const [lugar, setLugar] = useState(formulario.lugar.valorInicial);
  const { identidad } = formulario;
  const [cara, setCara] = useState(identidad.cara.valorInicial);
  const [paleta, setPaleta] = useState(identidad.color.valorInicial);
  const [otroColor, setOtroColor] = useState(identidad.color.otro.valorInicial);
  const [logo, setLogo] = useState(identidad.logo.direccion.valorInicial);
  const error = resultado.error;
  const conOtroColor = paleta === OTRO_COLOR;
  const colorMalEscrito = conOtroColor && !COLOR_RRGGBB.test(otroColor);
  const colorElegido = conOtroColor ? otroColor : paleta;
  const mostrado = colorElegido === "" || colorMalEscrito ? null : colorDeLaCarta(colorElegido);
  const ajustado = mostrado !== null && mostrado.ok && mostrado.valor.ajustado;
  const avisoDeContraste = ajustado ? identidad.color.contrasteAviso : undefined;
  const logoMalEscrito = logo.trim() !== "" && !leerDireccionPegada(logo).ok;
  const delNombre = error?.campo === "nombre";
  return (
    <form action={enviar} onReset={sinReiniciar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={3}>
          <Campo
            dato="nombre-de-la-carta"
            etiqueta={formulario.nombre.etiqueta}
            nombre="nombre"
            valor={nombre}
            alCambiar={setNombre}
            autoComplete="off"
            error={delNombre ? texto({}, error.clave) : undefined}
          />
          <Campo
            dato="rubro-de-la-carta"
            etiqueta={formulario.rubro.etiqueta}
            nombre="rubro"
            valor={rubro}
            alCambiar={setRubro}
            autoComplete="off"
          />
          <Campo
            dato="lugar-de-la-carta"
            etiqueta={formulario.lugar.etiqueta}
            nombre="lugar"
            valor={lugar}
            alCambiar={setLugar}
            autoComplete="off"
          />
          <fieldset className={estilos["grupo"]}>
            <legend className={estilos["leyenda"]}>{identidad.cara.etiqueta}</legend>
            <OpcionesExcluyentes
              dato="cara-de-la-carta"
              nombre="cara"
              valor={cara}
              alCambiar={setCara}
              opciones={identidad.cara.opciones}
              apagado={identidad.apagada}
            />
          </fieldset>
          <Selector
            dato="color-de-la-carta"
            etiqueta={identidad.color.etiqueta}
            nombre="paleta"
            valor={paleta}
            alCambiar={setPaleta}
            opciones={identidad.color.opciones}
            ayuda={conOtroColor ? undefined : avisoDeContraste}
            deshabilitado={identidad.apagada}
          />
          {conOtroColor ? (
            <Campo
              dato="color-de-la-carta"
              etiqueta={identidad.color.otro.etiqueta}
              nombre="colorPropio"
              valor={otroColor}
              alCambiar={setOtroColor}
              autoComplete="off"
              autoCapitalize="off"
              ayuda={avisoDeContraste}
              error={colorMalEscrito ? identidad.color.colorInvalido : undefined}
              deshabilitado={identidad.apagada}
            />
          ) : null}
          <fieldset className={estilos["grupo"]}>
            <legend className={estilos["leyenda"]}>{identidad.logo.etiqueta}</legend>
            <Pila separacion={2}>
              <Campo
                dato="logo-de-la-carta"
                etiqueta={identidad.logo.direccion.etiqueta}
                nombre="logo"
                valor={logo}
                alCambiar={setLogo}
                autoComplete="off"
                autoCapitalize="off"
                error={logoMalEscrito ? identidad.logo.direccionNoSirve : undefined}
                deshabilitado={identidad.apagada}
              />
              {logo === "" ? null : (
                <Boton
                  variante="secundaria"
                  deshabilitado={identidad.apagada}
                  alTocar={() => {
                    setLogo("");
                  }}
                >
                  {identidad.logo.quitar}
                </Boton>
              )}
            </Pila>
          </fieldset>
          {error === null || delNombre ? null : <ErrorDeRespuesta error={error} />}
          {formulario.puedeGuardar &&
          nombre.trim() !== "" &&
          !colorMalEscrito &&
          !logoMalEscrito ? (
            <BotonDeEnvio>{formulario.guardar}</BotonDeEnvio>
          ) : (
            <Boton deshabilitado>{formulario.guardar}</Boton>
          )}
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
