import { useLayoutEffect, useRef, useState } from "react";
import type { DatoDeCampo } from "../../../../src/capacidades/datos/registro";
import {
  canonicoDe,
  escribirNumero,
  interpretarNumeroPegado,
  mostrarNumero,
  type ReglaDeNumero,
} from "../../../../src/capacidades/experiencia/numero-argentino";
import { CajaDeCampo } from "./CajaDeCampo";
import estilos from "./CampoNumero.module.css";

export type PropsDeCampoNumero = Readonly<{
  /** Qué dato pide el campo: un `IdDeDato` del registro de datos o `"pendiente"` (deuda registrada). Obligatorio: sin dato no hay campo. */
  dato: DatoDeCampo;
  etiqueta: string;
  /**
   * El número como TEXTO decimal canónico (`"1234.5"`), o `""` si no hay nada. Nunca un `number`: lo que entrega este campo y lo que
   * viaja al servidor es texto (ADR-006).
   */
  valor: string;
  alCambiar: (valor: string) => void;
  /** Decimales y enteros máximos: salen de la primitiva del dato (el campo no los repite). */
  regla: ReglaDeNumero;
  /** Si está, el campo va dentro de un `<form>` con un `<input type="hidden">` que lleva el texto canónico. */
  nombre?: string | undefined;
  /** Adorno antes del número (p. ej. `$`): la etiqueta ya dice qué es. */
  simbolo?: string | undefined;
  obligatorio?: string | undefined;
  ayuda?: string | undefined;
  error?: string | undefined;
  deshabilitado?: boolean;
}>;

/**
 * Número con la convención argentina para tipear en el celular: teclado decimal, solo dígitos y una coma; los miles con punto los
 * pone el sistema MIENTRAS se escribe (la tecla «.» no escribe nada); lo pegado se acepta solo si cada punto separa miles bien o se rechaza y el campo no cambia.
 * La regla completa vive en `capacidades/experiencia/numero-argentino.ts` (sin React, con pruebas); acá solo se cablea y se cuida que
 * el cursor no salte al reformatear.
 */
export function CampoNumero({
  etiqueta,
  valor,
  alCambiar,
  regla,
  nombre,
  simbolo,
  obligatorio,
  ayuda,
  error,
  deshabilitado = false,
}: PropsDeCampoNumero) {
  const entrada = useRef<HTMLInputElement>(null);
  const cursorPendiente = useRef<number | null>(null);
  // Lo que hay en el campo. Si el padre cambia `valor` por otro lado (limpiar el formulario), manda el padre.
  const [tipeado, setTipeado] = useState(() => mostrarNumero(valor, regla));
  const coincide = canonicoDe(tipeado, regla) === valor;
  const visible = coincide ? tipeado : mostrarNumero(valor, regla);

  // El navegador manda el cursor al final al cambiar `value`: se lo devuelve a donde corresponde después de pintar.
  useLayoutEffect(() => {
    const posicion = cursorPendiente.current;
    cursorPendiente.current = null;
    const el = entrada.current;
    if (posicion !== null && el !== null && document.activeElement === el) {
      el.setSelectionRange(posicion, posicion);
    }
  });

  function aplicar(texto: string, canonico: string, cursor: number) {
    cursorPendiente.current = cursor;
    setTipeado(texto);
    if (canonico !== valor) alCambiar(canonico);
  }

  return (
    <CajaDeCampo
      etiqueta={etiqueta}
      obligatorio={obligatorio}
      ayuda={ayuda}
      error={error}
      control={(datos) => (
        <span className={estilos["fila"]}>
          {simbolo === undefined ? null : (
            <span className={estilos["simbolo"]} aria-hidden="true">
              {simbolo}
            </span>
          )}
          <input
            {...datos}
            ref={entrada}
            className={estilos["entrada"]}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={visible}
            disabled={deshabilitado}
            onBlur={() => {
              // Al salir se completa lo que la regla completa (los dos decimales del dinero).
              setTipeado(mostrarNumero(canonicoDe(visible, regla), regla));
            }}
            onPaste={(evento) => {
              // Lo pegado se entiende con la regla del campo; si no cumple, no entra nada.
              evento.preventDefault();
              const pegado = interpretarNumeroPegado(evento.clipboardData.getData("text"), regla);
              if (!pegado.ok) return;
              // Se inserta donde estaba el cursor (o reemplaza lo seleccionado) y el resultado vuelve a pasar por la regla.
              const el = evento.currentTarget;
              const desde = el.selectionStart ?? visible.length;
              const hasta = el.selectionEnd ?? desde;
              const unido = escribirNumero(
                visible.slice(0, desde) + pegado.texto + visible.slice(hasta),
                desde + pegado.texto.length,
                regla,
              );
              aplicar(unido.texto, unido.canonico, unido.cursor);
            }}
            onChange={(evento) => {
              const el = evento.target;
              const r = escribirNumero(el.value, el.selectionStart ?? el.value.length, regla);
              aplicar(r.texto, r.canonico, r.cursor);
            }}
          />
          {nombre !== undefined ? <input type="hidden" name={nombre} value={valor} /> : null}
        </span>
      )}
    />
  );
}
