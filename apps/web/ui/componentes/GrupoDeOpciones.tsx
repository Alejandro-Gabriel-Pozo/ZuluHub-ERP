import { useId } from "react";
import type { DatoDeCampo } from "../../../../src/capacidades/datos/registro";
import estilos from "./GrupoDeOpciones.module.css";

export type OpcionDelGrupo = Readonly<{
  id: string;
  /** El nombre de la opción, ya resuelto. */
  etiqueta: string;
  /** Lo que suma o dice a la derecha («+ $ 600,00»), ya resuelto. Vacío o ausente: nada. */
  nota?: string | undefined;
  deshabilitada?: boolean;
}>;

export type PropsDeGrupoDeOpciones = Readonly<{
  /** Qué dato pide el campo: un `IdDeDato` del registro de datos o `"pendiente"` (deuda registrada). Obligatorio: sin dato no hay campo. */
  dato: DatoDeCampo;
  /** El nombre del grupo, ya resuelto: nombra al conjunto para el lector de pantalla (visible salvo `ocultarNombre`). */
  nombre: string;
  /** Solo para quien usa lector de pantalla (por ejemplo «Medida»). */
  ocultarNombre?: boolean;
  opciones: readonly OpcionDelGrupo[];
  /** Los ids elegidos. Con `varias: false`, a lo sumo uno. */
  valor: readonly string[];
  alCambiar: (valor: readonly string[]) => void;
  /** Varias a la vez (casillas) o una sola (botones de opción). */
  varias: boolean;
  /**
   * Solo con una sola elección: si está, se suma una opción con este texto («Sin elegir») que deja el grupo vacío; sirve para un grupo que no es obligatorio. Sin él, una vez
   * elegida una opción no se puede volver a ninguna.
   */
  etiquetaSinElegir?: string | undefined;
  /** Lo que se lee junto al nombre, dentro de la misma leyenda («(obligatorio)»), ya resuelto. Sin él, nada cambia. */
  aclaracion?: string | undefined;
  /** Una línea dentro del grupo, debajo del nombre y antes de las opciones («Sin elegir» mientras no se eligió nada), ya resuelta. Sin ella, nada cambia. */
  notaDelGrupo?: string | undefined;
  deshabilitado?: boolean;
}>;

/**
 * Elegir una opción (botones de opción) o varias (casillas) dentro de un grupo de las que el servidor ofrece. Es un campo con dato: la elección de medida y de opciones de un producto es un dato
 * registrado (`eleccion-de-opcion-de-venta`), no un `<input>` suelto. Cada opción es una fila de objetivo táctil completo (la etiqueta envuelve al control); lo deshabilitado se ve y se lee
 * como tal. Sin textos propios: todos llegan resueltos.
 */
export function GrupoDeOpciones({
  nombre,
  ocultarNombre = false,
  opciones,
  valor,
  alCambiar,
  varias,
  etiquetaSinElegir,
  aclaracion,
  notaDelGrupo,
  deshabilitado = false,
}: PropsDeGrupoDeOpciones) {
  const grupo = useId();
  const alternar = (id: string) =>
    alCambiar(valor.includes(id) ? valor.filter((v) => v !== id) : [...valor, id]);
  return (
    <fieldset className={estilos["grupo"]} disabled={deshabilitado}>
      <legend className={ocultarNombre ? estilos["soloLector"] : estilos["nombre"]}>
        {nombre}
        {aclaracion === undefined || aclaracion === "" ? null : (
          <span className={estilos["aclaracion"]}> {aclaracion}</span>
        )}
      </legend>
      {notaDelGrupo === undefined || notaDelGrupo === "" ? null : (
        <p className={estilos["notaDelGrupo"]}>{notaDelGrupo}</p>
      )}
      {!varias && etiquetaSinElegir !== undefined ? (
        <label className={estilos["fila"]}>
          <input
            type="radio"
            name={grupo}
            checked={valor.length === 0}
            onChange={() => {
              alCambiar([]);
            }}
          />
          <span className={estilos["etiqueta"]}>{etiquetaSinElegir}</span>
        </label>
      ) : null}
      {opciones.map((opcion) => (
        <label
          key={opcion.id}
          className={estilos["fila"]}
          data-deshabilitada={opcion.deshabilitada === true ? "" : undefined}
        >
          <input
            type={varias ? "checkbox" : "radio"}
            name={grupo}
            value={opcion.id}
            checked={valor.includes(opcion.id)}
            disabled={opcion.deshabilitada === true}
            onChange={() => {
              if (varias) alternar(opcion.id);
              else alCambiar([opcion.id]);
            }}
          />
          <span className={estilos["etiqueta"]}>{opcion.etiqueta}</span>
          {opcion.nota === undefined || opcion.nota === "" ? null : (
            <span className={estilos["nota"]}>{opcion.nota}</span>
          )}
        </label>
      ))}
    </fieldset>
  );
}
