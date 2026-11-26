"use client";

import { useActionState, useState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { CampoImporte } from "../../componentes/CampoImporte";
import { Casilla } from "../../componentes/Casilla";
import { OpcionesExcluyentes } from "../../componentes/OpcionesExcluyentes";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import estilos from "./FormularioDeGrupoDeOpciones.module.css";
import { textoDelError, type FilaDeOpcionArmada, type GrupoArmado } from "./modelo-de-opciones";
import { sinReiniciar } from "../../patrones/sin-reinicio";

export type PropsDeFormularioDeGrupoDeOpciones = Readonly<{
  grupo: GrupoArmado;
  /** La acción de servidor (`guardarGrupoAccion` ya ligada al producto, a la versión, al grupo, a la clave del cambio y a las opciones que se vieron). */
  accion: AccionDeFormulario;
  /** Si el servidor deja guardar hoy: si no, «Guardar» sale apagado (solo una ayuda: el guard decide; DEC-0346). */
  puedeGuardar: boolean;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/** El único error que se muestra junto a su control (el nombre del grupo); el resto sale debajo con el patrón común. */
const CAMPO_DEL_GRUPO = "nombre";

/**
 * Un grupo de opciones de un producto (maqueta `productos.html`, función `vGrupo`): el nombre; los dos botones de opción excluyentes «Incluida» / «Adicional» (sin rótulo de grupo; solo se
 * eligen al crear: al editar se ven con su valor y apagados, porque la clase no se cambia); las casillas «Obligatorio», «Se puede elegir más de una» y «No figura en la carta»; y las
 * opciones, cada una con su nombre y su recargo (el rótulo «Nombre» se ve solo sobre la primera fila) y «Agregar opción». NO hay «Quitar»: una fila con el nombre vacío no se guarda (el
 * servidor la descarta; si era una opción guardada, la desactiva). La validez la decide el servidor: acá no se valida nada. Un error que apunta al nombre del grupo se
 * asocia a ese campo (`aria-describedby`); el resto sale debajo con el patrón común. El recargo viaja como texto decimal canónico (`CampoImporte`, ADR-006). Repetir el envío no duplica: la
 * clave del cambio la fija la página al armarse, así que el doble toque y el reintento mandan lo mismo y el caso de uso lo reconoce; el botón solo ignora el segundo toque. El título de la
 * pantalla («Agregar grupo» o «Editar») lo pone la página.
 */
export function FormularioDeGrupoDeOpciones({
  grupo,
  accion,
  puedeGuardar,
}: PropsDeFormularioDeGrupoDeOpciones) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  const [nombre, setNombre] = useState(grupo.nombre.valor);
  const [clase, setClase] = useState<string>(grupo.clase.valor);
  const [obligatorio, setObligatorio] = useState(grupo.obligatorio.valor);
  const [varias, setVarias] = useState(grupo.varias.valor);
  const [fuera, setFuera] = useState(grupo.fueraDeLaCarta.valor);
  const [esMedida, setEsMedida] = useState(grupo.esTamano.valor);
  const [filas, setFilas] = useState<readonly FilaDeOpcionArmada[]>(grupo.opciones.filas);
  const [siguiente, setSiguiente] = useState(grupo.esNuevo ? grupo.opciones.filas.length : 0);

  const cambiarFila = (clave: string, cambio: Partial<FilaDeOpcionArmada>) => {
    setFilas((actuales) => actuales.map((f) => (f.clave === clave ? { ...f, ...cambio } : f)));
  };

  const error = resultado.error;
  const campoDelError = error?.campo;
  const textoDeError = error === null ? undefined : textoDelError(error);
  const errorDe = (campo: string): string | undefined =>
    campoDelError === campo ? textoDeError : undefined;
  const sinCampo = error !== null && campoDelError !== CAMPO_DEL_GRUPO;

  return (
    <form action={enviar} onReset={sinReiniciar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={3}>
          <Campo
            dato="nombre-de-grupo-de-opciones"
            etiqueta={grupo.nombre.etiqueta}
            nombre="nombre"
            valor={nombre}
            alCambiar={setNombre}
            autoComplete="off"
            error={errorDe(CAMPO_DEL_GRUPO)}
          />
          {grupo.esVariante ? (
            <Casilla
              dato="medida-de-variante-de-producto"
              etiqueta={grupo.esTamano.etiqueta}
              nombre="esTamano"
              marcada={esMedida}
              alCambiar={setEsMedida}
            />
          ) : (
            <>
              <OpcionesExcluyentes
                dato="clase-de-grupo-de-opciones"
                nombre="clase"
                valor={clase}
                alCambiar={setClase}
                opciones={grupo.clase.opciones}
                apagado={grupo.clase.apagado}
              />
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
            </>
          )}
          <ul className={estilos["filas"]}>
            {filas.map((fila, posicion) => (
              <li key={fila.clave} className={estilos["fila"]}>
                <Campo
                  dato="nombre-de-opcion-de-producto"
                  etiqueta={grupo.opciones.nombreDelCampo}
                  rotuloSoloParaLector={posicion > 0}
                  nombre={`opcion_${fila.clave}_nombre`}
                  valor={fila.nombre}
                  alCambiar={(valor) => {
                    cambiarFila(fila.clave, { nombre: valor });
                  }}
                  autoComplete="off"
                />
                {grupo.esVariante ? null : (
                  <CampoImporte
                    dato="recargo-de-opcion-de-producto"
                    etiqueta={grupo.opciones.recargoDelCampo}
                    nombre={`opcion_${fila.clave}_recargo`}
                    valor={fila.recargo}
                    alCambiar={(valor) => {
                      cambiarFila(fila.clave, { recargo: valor });
                    }}
                  />
                )}
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
