"use client";

import { useActionState, useState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { CampoImporte } from "../../componentes/CampoImporte";
import { Casilla } from "../../componentes/Casilla";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import { Texto } from "../../primitivas/Texto";
import estilos from "./FormularioDeGrupoDeOpciones.module.css";
import { textoDelError, type FilaDeOpcionArmada, type GrupoArmado } from "./modelo-de-opciones";

export type PropsDeFormularioDeGrupoDeOpciones = Readonly<{
  grupo: GrupoArmado;
  /** La acción de servidor (`guardarGrupoAccion` ya ligada al producto, a la versión, al grupo, a la clave del cambio y a las opciones que se vieron). */
  accion: AccionDeFormulario;
  /** Si el servidor deja guardar hoy: si no, «Guardar» sale apagado (solo una ayuda: el guard decide; DEC-0346). */
  puedeGuardar: boolean;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/** Los campos de un error que se muestran junto a su control; el resto sale debajo con el patrón común. */
const CAMPO_DEL_GRUPO = "nombre";
const CAMPO_DE_NOMBRE_DE_FILA = /^opcion_(e\d{1,3}|n\d{1,3})_nombre$/;

/**
 * Un grupo de opciones de un producto (maqueta `productos.html`, función `vGrupo`): el nombre, si es adicional (solo al crear: la clase no se cambia después), si es obligatorio, si
 * se puede elegir más de una y si no figura en la carta; y las opciones, cada una con su nombre y su recargo, con «Agregar opción» y «Quitar». La validez la decide el servidor:
 * acá no se valida nada. Un error que apunta al nombre del grupo o al de una opción se asocia a ese campo (`aria-describedby`); el resto sale debajo con el patrón común. El recargo
 * viaja como texto decimal canónico (`CampoImporte`, ADR-006). Repetir el envío no duplica: la clave del cambio la fija la página, así que el doble toque y el reintento mandan lo mismo
 * y el caso de uso lo reconoce; el botón solo ignora el segundo toque. SUPUESTO (DEC-0526): la clase se elige con la casilla «Adicional» (sin marcar es incluida) y no con dos botones de
 * radio como la maqueta: una casilla basta para dos valores y no necesita un texto de grupo que la maqueta no tiene.
 */
export function FormularioDeGrupoDeOpciones({
  grupo,
  accion,
  puedeGuardar,
}: PropsDeFormularioDeGrupoDeOpciones) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  const [nombre, setNombre] = useState(grupo.nombre.valor);
  const [adicional, setAdicional] = useState(grupo.adicional.valor);
  const [obligatorio, setObligatorio] = useState(grupo.obligatorio.valor);
  const [varias, setVarias] = useState(grupo.varias.valor);
  const [fuera, setFuera] = useState(grupo.fueraDeLaCarta.valor);
  const [filas, setFilas] = useState<readonly FilaDeOpcionArmada[]>(grupo.opciones.filas);
  const [siguiente, setSiguiente] = useState(grupo.esNuevo ? 1 : 0);

  const cambiarFila = (clave: string, cambio: Partial<FilaDeOpcionArmada>) => {
    setFilas((actuales) => actuales.map((f) => (f.clave === clave ? { ...f, ...cambio } : f)));
  };

  const error = resultado.error;
  const campoDelError = error?.campo;
  const textoDeError = error === null ? undefined : textoDelError(error);
  const errorDe = (campo: string): string | undefined =>
    campoDelError === campo ? textoDeError : undefined;
  const sinCampo =
    error !== null &&
    campoDelError !== CAMPO_DEL_GRUPO &&
    !CAMPO_DE_NOMBRE_DE_FILA.test(campoDelError ?? "");

  return (
    <form action={enviar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={3}>
          <h2 className={estilos["titulo"]}>{grupo.titulo}</h2>
          <Campo
            dato="nombre-de-grupo-de-opciones"
            etiqueta={grupo.nombre.etiqueta}
            nombre="nombre"
            valor={nombre}
            alCambiar={setNombre}
            autoComplete="off"
            error={errorDe(CAMPO_DEL_GRUPO)}
          />
          {grupo.claseGuardada === null ? (
            <Casilla
              dato="clase-de-grupo-de-opciones"
              etiqueta={grupo.adicional.etiqueta}
              nombre="esAdicional"
              marcada={adicional}
              alCambiar={setAdicional}
            />
          ) : (
            <Texto>{grupo.claseGuardada}</Texto>
          )}
          <Casilla
            dato="obligatoriedad-de-grupo-de-opciones"
            etiqueta={grupo.obligatorio.etiqueta}
            nombre="esObligatorio"
            marcada={obligatorio}
            alCambiar={setObligatorio}
          />
          <Casilla
            dato="eleccion-multiple-de-grupo-de-opciones"
            etiqueta={grupo.varias.etiqueta}
            nombre="admiteVarias"
            marcada={varias}
            alCambiar={setVarias}
          />
          <Casilla
            dato="visibilidad-en-la-carta-de-grupo-de-opciones"
            etiqueta={grupo.fueraDeLaCarta.etiqueta}
            nombre="fueraDeLaCarta"
            marcada={fuera}
            alCambiar={setFuera}
          />
          <ul className={estilos["filas"]}>
            {filas.map((fila) => (
              <li key={fila.clave} className={estilos["fila"]}>
                <Campo
                  dato="nombre-de-opcion-de-producto"
                  etiqueta={grupo.opciones.nombreDelCampo}
                  nombre={`opcion_${fila.clave}_nombre`}
                  valor={fila.nombre}
                  alCambiar={(valor) => {
                    cambiarFila(fila.clave, { nombre: valor });
                  }}
                  autoComplete="off"
                  error={errorDe(`opcion_${fila.clave}_nombre`)}
                />
                <CampoImporte
                  dato="recargo-de-opcion-de-producto"
                  etiqueta={grupo.opciones.recargoDelCampo}
                  nombre={`opcion_${fila.clave}_recargo`}
                  valor={fila.recargo}
                  alCambiar={(valor) => {
                    cambiarFila(fila.clave, { recargo: valor });
                  }}
                />
                <Boton
                  variante="secundaria"
                  alTocar={() => {
                    setFilas((actuales) => actuales.filter((f) => f.clave !== fila.clave));
                  }}
                >
                  {grupo.opciones.quitar}
                </Boton>
              </li>
            ))}
          </ul>
          <div>
            <Boton
              variante="secundaria"
              alTocar={() => {
                setFilas((actuales) => [
                  ...actuales,
                  { ...grupo.opciones.nuevaFila, clave: `n${String(siguiente)}` },
                ]);
                setSiguiente(siguiente + 1);
              }}
            >
              {grupo.opciones.agregar}
            </Boton>
          </div>
          {sinCampo ? <ErrorDeRespuesta error={error} /> : null}
          {puedeGuardar ? (
            <BotonDeEnvio>{grupo.guardar}</BotonDeEnvio>
          ) : (
            <Boton deshabilitado>{grupo.guardar}</Boton>
          )}
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
