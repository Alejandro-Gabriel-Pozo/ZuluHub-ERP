"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton.cliente";
import { Selector } from "../../componentes/Selector";
import { ErrorDelDetalle } from "../../patrones/ErrorDelDetalle";
import { Superposicion } from "../../patrones/Superposicion";
import { Pila } from "../../primitivas/Pila";
import { Texto } from "../../primitivas/Texto";
import { useEnvioFijado } from "../configuracion-fiscal/useEnvioFijado";
import type { AccionDeClasificacion } from "./HojasDeClasificacion.cliente";
import estilos from "./ClasificacionDelProducto.module.css";
import {
  elegirEnElNivel,
  nodoElegido,
  selectoresDeNivel,
  seleccionVigente,
  type ClasificacionDelProductoArmada,
} from "./modelo-de-clasificacion";

export type PropsDeClasificacionDelProducto = Readonly<{
  clasificacion: ClasificacionDelProductoArmada;
  /** `clasificarProducto`: recibe el pedido sin tipo; la clave (`id`), el producto y el nodo los arma esta pantalla, la empresa y la persona las pone el servidor. */
  accion: AccionDeClasificacion;
  /** Si el servidor deja cambiar hoy (`productos.editar`): si no, «Cambiar» sale apagado (solo una ayuda: el guard decide). */
  puedeCambiar: boolean;
}>;

type PropsDeHojaDeCambiar = Readonly<{
  clasificacion: ClasificacionDelProductoArmada;
  accion: AccionDeClasificacion;
  alCerrar: () => void;
}>;

/**
 * La hoja «Cambiar» (decisión del dueño, 12/11/2026: un desplegable por nivel, encadenados; 13/11/2026: rige solo desde ahora, sin fecha elegible). Cada nivel ofrece «Sin elegir» y los nodos activos
 * de lo elegido arriba; elegir «Sin elegir» en el primero deja el producto sin clasificar. «Guardar» sale apagado mientras no cambie lo que rige. La clave del cambio se fija al abrir la hoja: el doble
 * toque y el reintento mandan la misma y el servidor no duplica el vínculo; cada vez que se abre la hoja es una clave nueva.
 */
function HojaDeCambiar({ clasificacion, accion, alCerrar }: PropsDeHojaDeCambiar) {
  const router = useRouter();
  const [id] = useState(() => crypto.randomUUID());
  const [seleccion, setSeleccion] = useState<readonly string[]>(clasificacion.seleccionInicial);
  const { envio, enviarCon } = useEnvioFijado<object, unknown>(accion);
  const { estado } = envio;
  useEffect(() => {
    if (estado.tipo === "hecho") {
      router.refresh();
      alCerrar();
    } else if (estado.tipo === "rechazado") {
      router.refresh();
    }
  }, [estado, router, alCerrar]);
  const elegidos = seleccionVigente(clasificacion.nodos, seleccion);
  const nodo = nodoElegido(elegidos);
  return (
    <Superposicion
      abierta
      titulo={clasificacion.cambiar}
      proposito="editar"
      cerrable={!envio.enCurso && estado.tipo !== "incierto"}
      etiquetaDeCerrar={texto({}, "vidriera.producto.cerrar")}
      alCerrar={alCerrar}
    >
      <Pila separacion={3}>
        {estado.tipo === "rechazado" ? <ErrorDelDetalle error={estado.rechazo} /> : null}
        {estado.tipo === "incierto" ? <Texto>{texto({}, "conexion.verificando")}</Texto> : null}
        {selectoresDeNivel(clasificacion.nodos, elegidos).map((s) => (
          <Selector
            key={s.nivel}
            dato="nodo-de-clasificacion-de-producto"
            etiqueta={s.rotulo}
            nombreAccesible={s.nombreAccesible}
            valor={s.valor}
            alCambiar={(valor) => {
              setSeleccion(elegirEnElNivel(elegidos, s.nivel, valor));
            }}
            opciones={s.opciones}
            textoDeElegir={clasificacion.sinElegir}
          />
        ))}
        <div className={estilos["botones"]}>
          <Boton variante="secundaria" deshabilitado={envio.enCurso} alTocar={alCerrar}>
            {clasificacion.cancelar}
          </Boton>
          <Boton
            enviando={envio.enCurso}
            deshabilitado={
              nodo === clasificacion.nodoVigente || (!envio.enCurso && envio.bloqueado)
            }
            motivo={envio.motivoQueNoPuede}
            alTocar={() => {
              enviarCon({ id, productoId: clasificacion.productoId, nodoId: nodo });
            }}
          >
            {clasificacion.guardar}
          </Boton>
        </div>
      </Pila>
    </Superposicion>
  );
}

/**
 * La clasificación de un producto en su ficha (maqueta `clasificacion.html`, «Ficha del producto»): una fila por nivel (el rótulo y el nombre; «Departamento: Sin elegir» si no tiene), «Desactivado» si
 * el último nodo se desactivó después de asignarlo (el producto lo conserva), «Vigente desde» (solo lectura) y «Cambiar», que abre la hoja. No hereda ni propone la alícuota. «Cambiar» sale apagado sin
 * permiso o sin departamentos cargados.
 */
export function ClasificacionDelProducto({
  clasificacion,
  accion,
  puedeCambiar,
}: PropsDeClasificacionDelProducto) {
  const [abierta, setAbierta] = useState(false);
  const cerrar = useCallback(() => {
    setAbierta(false);
  }, []);
  return (
    <div className={estilos["tarjeta"]}>
      {clasificacion.filas.map((f, i) => (
        // Con varios niveles llamados «Categoría» el nombre accesible lleva al padre («Categoría de Restaurante»); lo visible no cambia. El grupo envuelve a la lista: `dl` no admite `role`.
        <div
          key={`${String(i)}-${f.rotulo}`}
          role={f.nombreAccesible === undefined ? undefined : "group"}
          aria-label={f.nombreAccesible}
        >
          <dl className={estilos["fila"]}>
            <dt>{f.rotulo}</dt>
            <dd>{f.valor}</dd>
          </dl>
        </div>
      ))}
      {clasificacion.desactivado === null ? null : (
        <Texto como="span" variante="suave">
          {clasificacion.desactivado}
        </Texto>
      )}
      {clasificacion.vigenteDesde === null ? null : (
        <dl className={estilos["fila"]}>
          <dt>{clasificacion.vigenteDesde.rotulo}</dt>
          <dd>{clasificacion.vigenteDesde.valor}</dd>
        </dl>
      )}
      <div>
        <Boton
          variante="secundaria"
          deshabilitado={!puedeCambiar || !clasificacion.hayQueElegir}
          alTocar={() => {
            setAbierta(true);
          }}
        >
          {clasificacion.cambiar}
        </Boton>
      </div>
      {abierta ? (
        <HojaDeCambiar clasificacion={clasificacion} accion={accion} alCerrar={cerrar} />
      ) : null}
    </div>
  );
}
