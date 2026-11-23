import type { DatoDeCampo } from "../../../../src/capacidades/datos/registro";
import estilos from "./OpcionesExcluyentes.module.css";

export type PropsDeOpcionesExcluyentes = Readonly<{
  /** Qué dato pide el campo: un `IdDeDato` del registro de datos o `"pendiente"` (deuda registrada). Obligatorio: sin dato no hay campo. */
  dato: DatoDeCampo;
  /** El nombre con el que viaja el valor elegido en el formulario. */
  nombre: string;
  /** El valor de la opción elegida (uno de `opciones`). */
  valor: string;
  alCambiar: (valor: string) => void;
  /** Las opciones, lado a lado y en este orden; solo una puede estar elegida. Cada una muestra su texto. */
  opciones: readonly Readonly<{ valor: string; etiqueta: string }>[];
  /** Se ve con su valor pero no se puede cambiar (el valor viaja igual en el formulario). */
  apagado?: boolean;
}>;

/**
 * Botones de opción excluyentes (maqueta `productos.html`, `seg-c`): botones de opción nativos (`<input type="radio">`) lado a lado, cada uno con su texto visible, donde se elige uno
 * solo. Sin rótulo de grupo: el texto de cada opción alcanza. Es un componente de campo (`COMPONENTES_DE_CAMPO`): quien lo usa dice qué dato pide. Teclado: flechas y Tab, lo de siempre
 * de un grupo de botones de opción del navegador. Apagado: un control deshabilitado no viaja en un formulario, así que el valor elegido va en un campo oculto con el mismo nombre
 * (si no, un grupo que ya existe mandaría el pedido sin su clase). Mostrar no es autorizar: el servidor decide si el valor puede cambiar.
 */
export function OpcionesExcluyentes({
  nombre,
  valor,
  alCambiar,
  opciones,
  apagado = false,
}: PropsDeOpcionesExcluyentes) {
  return (
    <div className={estilos["grupo"]}>
      {opciones.map((opcion) => (
        <label key={opcion.valor} className={estilos["opcion"]}>
          <input
            className={estilos["boton"]}
            type="radio"
            name={apagado ? undefined : nombre}
            value={opcion.valor}
            checked={opcion.valor === valor}
            disabled={apagado}
            onChange={() => {
              alCambiar(opcion.valor);
            }}
          />
          <span className={estilos["texto"]}>{opcion.etiqueta}</span>
        </label>
      ))}
      {apagado ? <input type="hidden" name={nombre} value={valor} /> : null}
    </div>
  );
}
