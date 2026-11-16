"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ErrorPublico, Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { Selector } from "../../componentes/Selector";
import { ErrorDelDetalle } from "../../patrones/ErrorDelDetalle";
import { Superposicion } from "../../patrones/Superposicion";
import type { EnvioConClave } from "../../patrones/useEnvioConClave";
import { Pila } from "../../primitivas/Pila";
import { Texto } from "../../primitivas/Texto";
import { useEnvioFijado } from "../configuracion-fiscal/useEnvioFijado";
import estilos from "./HojasDeClasificacion.module.css";
import { opcionesDeMover, type NodoArmado } from "./modelo-de-clasificacion";

/** Una acción de servidor de la clasificación: recibe el pedido sin tipo (se lee y se valida en el servidor) y devuelve la respuesta ya traducida. */
export type AccionDeClasificacion = (pedido: unknown) => Promise<Respuesta<unknown>>;

/**
 * Cuando el envío termina: con éxito se pide de nuevo la pantalla (ya con lo nuevo: el árbol, las versiones) y se cierra la hoja; con un rechazo también se pide de nuevo, para que el
 * reintento lleve la versión de ahora (otra persona pudo cambiar el nodo) y la hoja se queda abierta con el motivo.
 */
function useAlTerminar(envio: EnvioConClave<unknown, ErrorPublico>, alTerminar: () => void): void {
  const router = useRouter();
  const { estado } = envio;
  useEffect(() => {
    if (estado.tipo === "hecho") {
      router.refresh();
      alTerminar();
    } else if (estado.tipo === "rechazado") {
      router.refresh();
    }
  }, [estado, router, alTerminar]);
}

/** El motivo del rechazo (o «Verificando…» mientras no se sabe si se guardó), debajo de los campos. */
function Resultado({ envio }: Readonly<{ envio: EnvioConClave<unknown, ErrorPublico> }>) {
  const { estado } = envio;
  if (estado.tipo === "rechazado") return <ErrorDelDetalle error={estado.rechazo} />;
  if (estado.tipo === "incierto") return <Texto>{texto({}, "conexion.verificando")}</Texto>;
  return null;
}

/** «Cancelar» y el botón que guarda: el segundo toque no manda un segundo envío (lo evita la clave del pedido; esto es la ayuda). */
function Pie({
  envio,
  guardarApagado,
  alGuardar,
  alCancelar,
  guardar,
}: Readonly<{
  envio: EnvioConClave<unknown, ErrorPublico>;
  guardarApagado: boolean;
  alGuardar: () => void;
  alCancelar: () => void;
  guardar: string;
}>) {
  return (
    <div className={estilos["botones"]}>
      <Boton variante="secundaria" deshabilitado={envio.enCurso} alTocar={alCancelar}>
        {texto({}, "catalogo.accion.cancelar")}
      </Boton>
      <Boton
        enviando={envio.enCurso}
        deshabilitado={
          guardarApagado || envio.estado.tipo === "hecho" || (!envio.enCurso && envio.bloqueado)
        }
        motivo={envio.motivoQueNoPuede}
        alTocar={alGuardar}
      >
        {guardar}
      </Boton>
    </div>
  );
}

type PropsDeHojaDeNombre = Readonly<{
  /** «Crear» o «Renombrar»: el título de la hoja. */
  titulo: string;
  /** «Departamento» o «Categoría»: el nivel del nodo. */
  rotulo: string;
  /** El camino del padre; vacío en un departamento. */
  caminoDelPadre: string;
  nombreInicial: string;
  /** Renombrar no deja guardar el mismo nombre. */
  exigeCambio: boolean;
  accion: AccionDeClasificacion;
  /** Arma el pedido con el nombre escrito: lo demás (la clave del alta, la versión) lo fija la página que abre la hoja. */
  pedido: (nombre: string) => object;
  alCerrar: () => void;
}>;

/** La hoja de «Crear» y de «Renombrar»: un solo campo, el nombre (hasta 80; la regla es del servidor). */
export function HojaDeNombre({
  titulo,
  rotulo,
  caminoDelPadre,
  nombreInicial,
  exigeCambio,
  accion,
  pedido,
  alCerrar,
}: PropsDeHojaDeNombre) {
  const [nombre, setNombre] = useState(nombreInicial);
  const { envio, enviarCon } = useEnvioFijado<object, unknown>(accion);
  useAlTerminar(envio, alCerrar);
  const vacio = nombre.trim() === "";
  return (
    <Superposicion
      abierta
      titulo={titulo}
      proposito="editar"
      cerrable={!envio.enCurso && envio.estado.tipo !== "incierto"}
      etiquetaDeCerrar={texto({}, "vidriera.producto.cerrar")}
      alCerrar={alCerrar}
    >
      <Pila separacion={3}>
        <div className={estilos["encabezado"]}>
          <span className={estilos["nivel"]}>{rotulo}</span>
          {caminoDelPadre === "" ? null : <Texto como="span">{caminoDelPadre}</Texto>}
        </div>
        <Resultado envio={envio} />
        <Campo
          dato="nombre-de-nodo-de-clasificacion"
          etiqueta={texto({}, "catalogo.dato.nombre")}
          valor={nombre}
          alCambiar={setNombre}
          autoComplete="off"
        />
        <Pie
          envio={envio}
          guardarApagado={vacio || (exigeCambio && nombre.trim() === nombreInicial)}
          alGuardar={() => {
            enviarCon(pedido(nombre));
          }}
          alCancelar={alCerrar}
          guardar={texto({}, "catalogo.accion.guardar")}
        />
      </Pila>
    </Superposicion>
  );
}

type PropsDeHojaDeMover = Readonly<{
  nodo: NodoArmado;
  nodos: readonly NodoArmado[];
  accion: AccionDeClasificacion;
  alCerrar: () => void;
}>;

/**
 * La hoja de «Mover» (sin arrastrar): se elige el nuevo padre en una lista con todo el árbol. El propio nodo, lo que tiene adentro, lo que pasaría el tope de niveles y lo desactivado salen
 * apagados (calculado por el servidor con la misma regla que al guardar). Lleva la versión que se vio: si otra persona cambió el nodo, el servidor rechaza y no escribe.
 */
export function HojaDeMover({ nodo, nodos, accion, alCerrar }: PropsDeHojaDeMover) {
  const [destino, setDestino] = useState(nodo.padreId ?? "");
  const { envio, enviarCon } = useEnvioFijado<object, unknown>(accion);
  useAlTerminar(envio, alCerrar);
  return (
    <Superposicion
      abierta
      titulo={texto({}, "catalogo.clasificacion.mover")}
      proposito="editar"
      cerrable={!envio.enCurso && envio.estado.tipo !== "incierto"}
      etiquetaDeCerrar={texto({}, "vidriera.producto.cerrar")}
      alCerrar={alCerrar}
    >
      <Pila separacion={3}>
        <div className={estilos["encabezado"]}>
          <span className={estilos["nivel"]}>{nodo.rotulo}</span>
          <Texto como="span">{nodo.nombre}</Texto>
        </div>
        <Resultado envio={envio} />
        <Selector
          dato="padre-de-nodo-de-clasificacion"
          etiqueta={nodo.rotulo}
          valor={destino}
          alCambiar={setDestino}
          opciones={opcionesDeMover(nodos, nodo.id)}
        />
        <Pie
          envio={envio}
          guardarApagado={destino === "" || destino === nodo.padreId}
          alGuardar={() => {
            enviarCon({ nodoId: nodo.id, versionEsperada: nodo.version, nuevoPadreId: destino });
          }}
          alCancelar={alCerrar}
          guardar={texto({}, "catalogo.accion.guardar")}
        />
      </Pila>
    </Superposicion>
  );
}

type PropsDeHojaDeAcciones = Readonly<{
  nodo: NodoArmado;
  /** Desactivar o reactivar, según esté el nodo. */
  alternar: AccionDeClasificacion;
  alCrear: () => void;
  alRenombrar: () => void;
  alMover: () => void;
  alCerrar: () => void;
}>;

/**
 * La hoja de acciones de un nodo (maqueta `clasificacion.html`): Crear (adentro), Renombrar, Mover (no un departamento), Desactivar o Reactivar y Cancelar. Desactivar y reactivar se ejecutan al
 * tocar, sin confirmación (se deshacen con la otra acción; supuesto S5). «Crear» sale apagado donde el nodo no admite hijos (calculado por el servidor); lo demás que el servidor rechace, lo dice al intentarlo.
 */
export function HojaDeAcciones({
  nodo,
  alternar,
  alCrear,
  alRenombrar,
  alMover,
  alCerrar,
}: PropsDeHojaDeAcciones) {
  const { envio, enviarCon } = useEnvioFijado<object, unknown>(alternar);
  useAlTerminar(envio, alCerrar);
  return (
    <Superposicion
      abierta
      titulo={nodo.nombre}
      proposito="editar"
      cerrable={!envio.enCurso && envio.estado.tipo !== "incierto"}
      etiquetaDeCerrar={texto({}, "vidriera.producto.cerrar")}
      alCerrar={alCerrar}
    >
      <Pila separacion={3}>
        <div className={estilos["encabezado"]}>
          <span className={estilos["nivel"]}>{nodo.rotulo}</span>
          {nodo.desactivado === null ? null : (
            <span className={estilos["nivel"]}>{nodo.desactivado}</span>
          )}
          {nodo.caminoDelPadre === "" ? null : <Texto como="span">{nodo.caminoDelPadre}</Texto>}
        </div>
        <Resultado envio={envio} />
        <div className={estilos["acciones"]}>
          <Boton variante="secundaria" deshabilitado={!nodo.admiteHijos} alTocar={alCrear}>
            {texto({}, "catalogo.clasificacion.crear")}
          </Boton>
          <Boton variante="secundaria" alTocar={alRenombrar}>
            {texto({}, "catalogo.clasificacion.renombrar")}
          </Boton>
          {nodo.seMueve ? (
            <Boton variante="secundaria" alTocar={alMover}>
              {texto({}, "catalogo.clasificacion.mover")}
            </Boton>
          ) : null}
          <Boton
            variante="secundaria"
            enviando={envio.enCurso}
            deshabilitado={envio.estado.tipo === "hecho" || (!envio.enCurso && envio.bloqueado)}
            motivo={envio.motivoQueNoPuede}
            alTocar={() => {
              enviarCon({ nodoId: nodo.id });
            }}
          >
            {texto({}, nodo.activo ? "catalogo.accion.desactivar" : "catalogo.accion.reactivar")}
          </Boton>
          <Boton variante="secundaria" deshabilitado={envio.enCurso} alTocar={alCerrar}>
            {texto({}, "catalogo.accion.cancelar")}
          </Boton>
        </div>
      </Pila>
    </Superposicion>
  );
}
