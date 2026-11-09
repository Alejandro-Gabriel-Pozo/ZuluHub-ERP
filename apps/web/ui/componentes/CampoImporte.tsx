import type { DatoDeCampo } from "../../../../src/capacidades/datos/registro";
import { useState } from "react";
import {
  filtrarImporteEscrito,
  interpretarImporteTipeado,
  interpretarImportePegado,
  mostrarImporte,
} from "../../../../src/capacidades/experiencia/importe-tipeado";
import { CajaDeCampo } from "./CajaDeCampo";
import estilos from "./CampoImporte.module.css";

export type PropsDeCampoImporte = Readonly<{
  /** Qué dato pide el campo: un `IdDeDato` del registro de datos o `"pendiente"` (deuda registrada). Obligatorio: sin dato no hay campo. */
  dato: DatoDeCampo;
  etiqueta: string;
  /**
   * El importe como TEXTO decimal canónico (`"1234.50"`), o `""` si no hay nada. Nunca un `number`:
   * lo que entrega este campo y lo que viaja al servidor es texto (ADR-006, [A006]).
   */
  valor: string;
  alCambiar: (valor: string) => void;
  /** Si está, el campo va dentro de un `<form>` con un `<input type="hidden">` que lleva el texto canónico. */
  nombre?: string | undefined;
  /** El símbolo que se ve antes del importe. Es adorno: la etiqueta ya dice que es dinero. */
  simbolo?: string | undefined;
  obligatorio?: string | undefined;
  ayuda?: string | undefined;
  error?: string | undefined;
  deshabilitado?: boolean;
}>;

/**
 * Importe en pesos para tipear en el celular: teclado decimal, solo dígitos y una coma con hasta dos decimales (es-AR,
 * el punto escrito no entra) y miles con punto que agrega el sistema al salir del campo. El campo muestra `1.234,50`; la frontera entrega `"1234.50"`. La limpieza y el
 * formato viven en `capacidades/experiencia` (sin React, con mutación al 100 %).
 */
export function CampoImporte({
  etiqueta,
  valor,
  alCambiar,
  nombre,
  simbolo = "$",
  obligatorio,
  ayuda,
  error,
  deshabilitado = false,
}: PropsDeCampoImporte) {
  // Lo que hay en el campo. Si el padre cambia `valor` por otro lado (limpiar el formulario), manda el
  // padre: se muestra su importe formateado.
  const [tipeado, setTipeado] = useState(() => mostrarImporte(valor));
  const coincide = interpretarImporteTipeado(tipeado).canonico === valor;
  const visible = coincide ? tipeado : mostrarImporte(valor);

  return (
    <CajaDeCampo
      etiqueta={etiqueta}
      obligatorio={obligatorio}
      ayuda={ayuda}
      error={error}
      control={(datos) => (
        <span className={estilos["fila"]}>
          <span className={estilos["simbolo"]} aria-hidden="true">
            {simbolo}
          </span>
          <input
            {...datos}
            className={estilos["entrada"]}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={visible}
            disabled={deshabilitado}
            onFocus={() => {
              // Al editar se muestra sin puntos de miles: es lo que se tipea.
              setTipeado(interpretarImporteTipeado(visible).texto);
            }}
            onBlur={() => {
              setTipeado(mostrarImporte(interpretarImporteTipeado(visible).canonico));
            }}
            onPaste={(evento) => {
              // Lo pegado se valida con la regla del campo; si no cumple, no entra nada (decisión 153).
              if (!interpretarImportePegado(evento.clipboardData.getData("text")).ok) {
                evento.preventDefault();
              }
            }}
            onChange={(evento) => {
              const interpretado = filtrarImporteEscrito(evento.target.value);
              setTipeado(interpretado.texto);
              if (interpretado.canonico !== valor) alCambiar(interpretado.canonico);
            }}
          />
          {nombre !== undefined ? <input type="hidden" name={nombre} value={valor} /> : null}
        </span>
      )}
    />
  );
}
