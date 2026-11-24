import { useId, useState, type KeyboardEvent } from "react";
import type { DatoDeCampo } from "../../../../src/capacidades/datos/registro";
import { RegionDeEstado } from "../patrones/RegionDeEstado";
import estilos from "./BuscadorEnLista.module.css";
import { CajaDeCampo } from "./CajaDeCampo";

export type OpcionDeBuscador = Readonly<{
  /** Lo que se devuelve al elegir (un id que ya conoce el servidor). Único dentro de la lista. */
  valor: string;
  etiqueta: string;
  /** Una línea chica debajo del nombre (por ejemplo, la unidad). */
  detalle?: string | undefined;
  /** Se ve pero no se puede elegir. */
  apagada?: boolean;
}>;

export type PropsDeBuscadorEnLista = Readonly<{
  /** Qué dato pide el campo: un `IdDeDato` del registro de datos o `"pendiente"` (deuda registrada). Obligatorio: sin dato no hay campo. */
  dato: DatoDeCampo;
  etiqueta: string;
  /** Lo que se escribió. Si hay algo elegido, quien usa el componente pone acá el nombre del elegido. */
  consulta: string;
  alCambiarLaConsulta: (consulta: string) => void;
  /** La opción elegida (`""` si no hay ninguna). Escribir en el campo la descarta: `alElegir("")`. */
  valor: string;
  alElegir: (valor: string) => void;
  /** Las opciones YA filtradas por quien usa el componente (la lista la carga el servidor; el filtro y el tope también son suyos). */
  opciones: readonly OpcionDeBuscador[];
  /** Lo que se anuncia y se ve debajo del campo cuando hay algo escrito sin elegir: la cantidad de resultados o «sin resultados». Texto del catálogo. */
  anuncio: string;
  nombre?: string | undefined;
  obligatorio?: string | undefined;
  ayuda?: string | undefined;
  error?: string | undefined;
  deshabilitado?: boolean;
}>;

/**
 * Buscar y elegir UN elemento de una lista que ya cargó el servidor (un producto, un proveedor). Es el patrón «combobox con lista» de ARIA: el campo avisa que tiene una lista, flecha
 * abajo y arriba recorren las opciones, Enter elige la activa y Escape cierra la lista. Con el dedo, tocar una opción la elige. La lista solo se ve si hay algo escrito y nada elegido.
 * No filtra ni busca: recibe las opciones ya resueltas, así la misma pieza sirve para una búsqueda en el servidor (productos) y para una local (proveedores). Los textos vienen de afuera.
 * Con `nombre` va dentro de un `<form>` con un `<input type="hidden">` que lleva la opción elegida.
 */
export function BuscadorEnLista({
  etiqueta,
  consulta,
  alCambiarLaConsulta,
  valor,
  alElegir,
  opciones,
  anuncio,
  nombre,
  obligatorio,
  ayuda,
  error,
  deshabilitado = false,
}: PropsDeBuscadorEnLista) {
  const idDeLaLista = useId();
  const [activa, setActiva] = useState(0);
  const [cerrada, setCerrada] = useState(false);

  const hayBusqueda = consulta.trim() !== "" && valor === "";
  const listaVisible = hayBusqueda && !cerrada && opciones.length > 0;
  const posicion = Math.min(activa, Math.max(opciones.length - 1, 0));
  const idDeOpcion = (indice: number) => `${idDeLaLista}-${String(indice)}`;

  const elegir = (opcion: OpcionDeBuscador | undefined) => {
    if (opcion === undefined || opcion.apagada === true) return;
    setCerrada(true);
    alElegir(opcion.valor);
  };

  const alTeclear = (evento: KeyboardEvent<HTMLInputElement>) => {
    if (evento.key === "Escape") {
      if (listaVisible) {
        evento.preventDefault();
        setCerrada(true);
      }
      return;
    }
    if (!listaVisible) {
      if (evento.key === "ArrowDown" && hayBusqueda && opciones.length > 0) {
        evento.preventDefault();
        setCerrada(false);
      }
      return;
    }
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      setActiva((posicion + 1) % opciones.length);
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      setActiva((posicion - 1 + opciones.length) % opciones.length);
    } else if (evento.key === "Enter") {
      // Enter dentro de un formulario no lo envía mientras la lista está abierta: elige la opción activa.
      evento.preventDefault();
      elegir(opciones[posicion]);
    }
  };

  return (
    <CajaDeCampo
      etiqueta={etiqueta}
      obligatorio={obligatorio}
      ayuda={ayuda}
      error={error}
      control={(datos) => (
        <div className={estilos["raiz"]}>
          <input
            {...datos}
            className={estilos["entrada"]}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={listaVisible}
            aria-controls={listaVisible ? idDeLaLista : undefined}
            aria-activedescendant={listaVisible ? idDeOpcion(posicion) : undefined}
            autoComplete="off"
            enterKeyHint="search"
            value={consulta}
            disabled={deshabilitado}
            onChange={(evento) => {
              setActiva(0);
              setCerrada(false);
              if (valor !== "") alElegir("");
              alCambiarLaConsulta(evento.target.value);
            }}
            onKeyDown={alTeclear}
          />
          {nombre === undefined ? null : <input type="hidden" name={nombre} value={valor} />}
          {listaVisible ? (
            <ul id={idDeLaLista} role="listbox" aria-label={etiqueta} className={estilos["lista"]}>
              {opciones.map((opcion, indice) => (
                <li
                  key={opcion.valor}
                  id={idDeOpcion(indice)}
                  role="option"
                  aria-selected={indice === posicion}
                  aria-disabled={opcion.apagada === true ? true : undefined}
                  data-activa={indice === posicion ? "" : undefined}
                  className={estilos["opcion"]}
                  tabIndex={-1}
                  // El dedo o el mouse eligen sin sacarle el foco al campo (si no, el campo pierde el foco antes del clic).
                  onMouseDown={(evento) => {
                    evento.preventDefault();
                  }}
                  onClick={() => {
                    elegir(opcion);
                  }}
                  // Con el foco en la opción (lector de pantalla o teclado asistido) Enter y espacio también eligen.
                  onKeyDown={(evento) => {
                    if (evento.key === "Enter" || evento.key === " ") {
                      evento.preventDefault();
                      elegir(opcion);
                    }
                  }}
                >
                  <span>{opcion.etiqueta}</span>
                  {opcion.detalle === undefined ? null : (
                    <span className={estilos["detalle"]}>{opcion.detalle}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <RegionDeEstado>{hayBusqueda ? anuncio : ""}</RegionDeEstado>
        </div>
      )}
    />
  );
}
