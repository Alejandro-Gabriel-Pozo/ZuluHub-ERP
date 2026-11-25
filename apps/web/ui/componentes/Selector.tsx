import type { DatoDeCampo } from "../../../../src/capacidades/datos/registro";
import { CajaDeCampo } from "./CajaDeCampo";
import estilos from "./Selector.module.css";

type OpcionDeSelector = Readonly<{
  valor: string;
  etiqueta: string;
  /** La opción se ve pero no se puede elegir (por ejemplo, un destino que el servidor no admite). */
  apagada?: boolean;
}>;

export type PropsDeSelector = Readonly<{
  /** Qué dato pide el campo: un `IdDeDato` del registro de datos o `"pendiente"` (deuda registrada). Obligatorio: sin dato no hay campo. */
  dato: DatoDeCampo;
  etiqueta: string;
  valor: string;
  alCambiar: (valor: string) => void;
  opciones: readonly OpcionDeSelector[];
  /** Texto de la opción vacía («Elegí una opción»). Sin él, el selector no ofrece "ninguna". */
  textoDeElegir?: string | undefined;
  nombre?: string | undefined;
  obligatorio?: string | undefined;
  ayuda?: string | undefined;
  error?: string | undefined;
  deshabilitado?: boolean;
  /** Un nombre accesible más preciso que la etiqueta visible (varios selectores con la misma etiqueta, como los niveles «Categoría»): solo para lectores de pantalla, no se ve. */
  nombreAccesible?: string | undefined;
  /** El navegador no deja enviar el formulario con la opción vacía (`required`). Sin texto visible: el aviso lo da el navegador. */
  requerido?: boolean;
}>;

/**
 * Selector nativo (`<select>`): en el celular es el mejor selector que existe.
 *
 * React 19 reinicia el `<form>` cuando termina su acción, también si la acción falló, y el navegador devuelve cada `<select>` a su opción inicial sin que el estado de la
 * pantalla cambie: la persona veía vaciarse lo que había elegido. El selector se vuelve a poner en `valor` apenas termina el reinicio (el navegador reinicia los campos
 * DESPUÉS de avisar el evento, por eso va en una microtarea). Previene: perder la elección en un envío fallido, en cualquier pantalla. Chequeo: `Selector.test.tsx`
 * («conserva lo elegido después de enviar un formulario con acción»).
 */
function reponerTrasElReinicio(
  selector: HTMLSelectElement | null,
  valor: string,
): (() => void) | undefined {
  const formulario = selector?.form;
  if (selector === null || formulario === null || formulario === undefined) return undefined;
  const alReiniciar = () => {
    queueMicrotask(() => {
      if (selector.value !== valor) selector.value = valor;
    });
  };
  formulario.addEventListener("reset", alReiniciar);
  return () => {
    formulario.removeEventListener("reset", alReiniciar);
  };
}

export function Selector({
  etiqueta,
  valor,
  alCambiar,
  opciones,
  textoDeElegir,
  nombre,
  obligatorio,
  ayuda,
  error,
  deshabilitado = false,
  nombreAccesible,
  requerido = false,
}: PropsDeSelector) {
  return (
    <CajaDeCampo
      etiqueta={etiqueta}
      obligatorio={obligatorio}
      ayuda={ayuda}
      error={error}
      control={(datos) => (
        <select
          {...datos}
          className={estilos["selector"]}
          ref={(selector) => reponerTrasElReinicio(selector, valor)}
          name={nombre}
          value={valor}
          disabled={deshabilitado}
          aria-label={nombreAccesible}
          required={requerido}
          onChange={(evento) => {
            alCambiar(evento.target.value);
          }}
        >
          {textoDeElegir !== undefined ? <option value="">{textoDeElegir}</option> : null}
          {opciones.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor} disabled={opcion.apagada === true}>
              {opcion.etiqueta}
            </option>
          ))}
        </select>
      )}
    />
  );
}
