"use client";

import { useCallback, useId, useState, type CSSProperties } from "react";
import { Boton } from "../../componentes/Boton.cliente";
import { Pila } from "../../primitivas/Pila";
import {
  HojaDeAcciones,
  HojaDeMover,
  HojaDeNombre,
  type AccionDeClasificacion,
} from "./HojasDeClasificacion.cliente";
import estilos from "./PantallaDeClasificacion.module.css";
import { nodosVisibles, type ArbolArmado, type NodoArmado } from "./modelo-de-clasificacion";

export type AccionesDeClasificacion = Readonly<{
  crear: AccionDeClasificacion;
  renombrar: AccionDeClasificacion;
  mover: AccionDeClasificacion;
  desactivar: AccionDeClasificacion;
  reactivar: AccionDeClasificacion;
}>;

export type PropsDePantallaDeClasificacion = Readonly<{
  arbol: ArbolArmado;
  acciones: AccionesDeClasificacion;
}>;

/** Qué hoja está abierta: las acciones de un nodo, crear (adentro de un nodo, o un departamento si no hay padre), renombrar o mover. */
type Hoja =
  | Readonly<{ tipo: "acciones"; nodoId: string }>
  | Readonly<{ tipo: "crear"; padreId: string | null }>
  | Readonly<{ tipo: "renombrar"; nodoId: string }>
  | Readonly<{ tipo: "mover"; nodoId: string }>;

function Fila({
  nodo,
  abierto,
  alAlternar,
  alTocar,
}: Readonly<{
  nodo: NodoArmado;
  abierto: boolean;
  alAlternar: () => void;
  alTocar: () => void;
}>) {
  const idDelNombre = useId();
  return (
    <li
      className={estilos["fila"]}
      data-desactivado={nodo.activo ? undefined : ""}
      style={{ "--nivel": nodo.nivel - 1 } as CSSProperties}
    >
      {nodo.tieneHijos ? (
        <button
          type="button"
          className={estilos["chevron"]}
          aria-expanded={abierto}
          aria-labelledby={idDelNombre}
          onClick={alAlternar}
        >
          <span aria-hidden="true">{abierto ? "▾" : "▸"}</span>
        </button>
      ) : (
        <span className={estilos["chevron"]} aria-hidden="true" />
      )}
      <button type="button" className={estilos["nombre"]} aria-haspopup="dialog" onClick={alTocar}>
        <span id={idDelNombre} className={estilos["texto"]}>
          {nodo.nombre}
        </span>
        {nodo.desactivado === null ? null : (
          <span className={estilos["marca"]}>{nodo.desactivado}</span>
        )}
      </button>
    </li>
  );
}

/** La hoja de «Crear»: un departamento (sin padre) o una categoría adentro de un nodo. El `id` del nodo nuevo se fija al abrir la hoja: el doble toque y el reintento mandan el mismo (idempotencia). */
function CrearEn({
  arbol,
  padre,
  accion,
  alCerrar,
}: Readonly<{
  arbol: ArbolArmado;
  padre: NodoArmado | undefined;
  accion: AccionDeClasificacion;
  alCerrar: () => void;
}>) {
  const [id] = useState(() => crypto.randomUUID());
  return (
    <HojaDeNombre
      titulo={arbol.crear}
      rotulo={padre === undefined ? arbol.rotuloDelDepartamento : arbol.rotuloDeLaCategoria}
      caminoDelPadre={padre === undefined ? "" : padre.camino}
      nombreInicial=""
      exigeCambio={false}
      accion={accion}
      pedido={(nombre) => ({ id, padreId: padre === undefined ? null : padre.id, nombre })}
      alCerrar={alCerrar}
    />
  );
}

/**
 * La clasificación comercial (maqueta aprobada `clasificacion.html`): el árbol de departamentos y categorías (hasta 4 niveles), el árbol arranca desplegado y cada fila se pliega o se despliega; tocar una fila abre sus
 * acciones (Crear adentro, Renombrar, Mover, Desactivar o Reactivar); «Crear» arriba agrega un departamento. Sin departamentos cargados no hay filas, solo «Crear» (interfaz sobria: sin texto de
 * estado vacío). La pantalla no decide qué se puede hacer: lo que apaga lo trae calculado el servidor y todo lo demás lo vuelve a decidir al guardar.
 */
export function PantallaDeClasificacion({ arbol, acciones }: PropsDePantallaDeClasificacion) {
  const [plegados, setPlegados] = useState<ReadonlySet<string>>(new Set());
  const [hoja, setHoja] = useState<Hoja | null>(null);
  const cerrar = useCallback(() => {
    setHoja(null);
  }, []);
  const nodo = (id: string): NodoArmado | undefined => arbol.nodos.find((n) => n.id === id);
  const alternar = (id: string) => {
    setPlegados((previo) => {
      const siguiente = new Set(previo);
      if (!siguiente.delete(id)) siguiente.add(id);
      return siguiente;
    });
  };

  const abierta = hoja === null ? undefined : hoja;
  const deLaHoja = abierta !== undefined && "nodoId" in abierta ? nodo(abierta.nodoId) : undefined;
  const padreDeLaHoja =
    abierta !== undefined && abierta.tipo === "crear" && abierta.padreId !== null
      ? nodo(abierta.padreId)
      : undefined;

  return (
    <Pila separacion={4}>
      <div>
        <Boton
          alTocar={() => {
            setHoja({ tipo: "crear", padreId: null });
          }}
        >
          {arbol.crear}
        </Boton>
      </div>
      {arbol.nodos.length === 0 ? null : (
        <ul className={estilos["arbol"]}>
          {nodosVisibles(arbol.nodos, plegados).map((n) => (
            <Fila
              key={n.id}
              nodo={n}
              abierto={!plegados.has(n.id)}
              alAlternar={() => {
                alternar(n.id);
              }}
              alTocar={() => {
                setHoja({ tipo: "acciones", nodoId: n.id });
              }}
            />
          ))}
        </ul>
      )}
      {abierta?.tipo === "acciones" && deLaHoja !== undefined ? (
        <HojaDeAcciones
          key={deLaHoja.id}
          nodo={deLaHoja}
          alternar={deLaHoja.activo ? acciones.desactivar : acciones.reactivar}
          alCrear={() => {
            // Lo que se crea adentro de un nodo plegado tiene que verse.
            setPlegados((previo) => new Set([...previo].filter((id) => id !== deLaHoja.id)));
            setHoja({ tipo: "crear", padreId: deLaHoja.id });
          }}
          alRenombrar={() => {
            setHoja({ tipo: "renombrar", nodoId: deLaHoja.id });
          }}
          alMover={() => {
            setHoja({ tipo: "mover", nodoId: deLaHoja.id });
          }}
          alCerrar={cerrar}
        />
      ) : null}
      {abierta?.tipo === "crear" && (abierta.padreId === null || padreDeLaHoja !== undefined) ? (
        <CrearEn
          key={abierta.padreId ?? "departamento"}
          arbol={arbol}
          padre={padreDeLaHoja}
          accion={acciones.crear}
          alCerrar={cerrar}
        />
      ) : null}
      {abierta?.tipo === "renombrar" && deLaHoja !== undefined ? (
        <HojaDeNombre
          key={deLaHoja.id}
          titulo={arbol.renombrar}
          rotulo={deLaHoja.rotulo}
          caminoDelPadre={deLaHoja.caminoDelPadre}
          nombreInicial={deLaHoja.nombre}
          exigeCambio
          accion={acciones.renombrar}
          pedido={(nombre) => ({
            nodoId: deLaHoja.id,
            versionEsperada: deLaHoja.version,
            nombre,
          })}
          alCerrar={cerrar}
        />
      ) : null}
      {abierta?.tipo === "mover" && deLaHoja !== undefined ? (
        <HojaDeMover
          key={deLaHoja.id}
          nodo={deLaHoja}
          nodos={arbol.nodos}
          accion={acciones.mover}
          alCerrar={cerrar}
        />
      ) : null}
    </Pila>
  );
}
