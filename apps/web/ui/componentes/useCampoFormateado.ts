import {
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type RefObject,
} from "react";

/** Lo que cada campo con formato pone: su regla de escribir y de pegar, y cómo se ve lo que viaja. Todo puro, sin DOM. */
export type MotorDeCampo = Readonly<{
  /** Lo que queda al escribir o borrar: el texto visible, el valor que viaja y dónde queda el cursor. */
  escribir: (crudo: string, cursor: number) => { texto: string; canonico: string; cursor: number };
  /** Lo que se pega: `null` si se rechaza (el campo no cambia), o el texto ya entendido. */
  pegar: (crudo: string) => { texto: string } | null;
  /** Cómo se ve el valor que viaja (también al leer un valor que puso el padre). */
  mostrar: (canonico: string) => string;
  /** El valor que viaja de lo que hay en el campo. */
  canonicoDe: (texto: string) => string;
}>;

/**
 * El manejo común de un campo que se formatea MIENTRAS se escribe (importe, cantidad, documento): lo que se ve, el valor que viaja y que el
 * cursor no salte al reformatear (el navegador lo manda al final al cambiar `value`). La regla de cada campo está en su `motor` (puro);
 * acá solo se cablea. Previene: dos campos con el mismo manejo de cursor escrito dos veces y desviándose con el tiempo.
 */
export function useCampoFormateado(
  valor: string,
  alCambiar: (valor: string) => void,
  motor: MotorDeCampo,
): Readonly<{
  entrada: RefObject<HTMLInputElement | null>;
  visible: string;
  alEscribir: (evento: ChangeEvent<HTMLInputElement>) => void;
  alPegar: (evento: ClipboardEvent<HTMLInputElement>) => void;
  alSalir: () => void;
}> {
  const entrada = useRef<HTMLInputElement>(null);
  const cursorPendiente = useRef<number | null>(null);
  // Lo que hay en el campo. Si el padre cambia `valor` por otro lado (limpiar el formulario), manda el padre.
  const [tipeado, setTipeado] = useState(() => motor.mostrar(valor));
  const visible = motor.canonicoDe(tipeado) === valor ? tipeado : motor.mostrar(valor);

  // Después de pintar se devuelve el cursor a donde corresponde.
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

  return {
    entrada,
    visible,
    alEscribir: (evento) => {
      const el = evento.target;
      const r = motor.escribir(el.value, el.selectionStart ?? el.value.length);
      aplicar(r.texto, r.canonico, r.cursor);
    },
    alPegar: (evento) => {
      // Lo pegado se entiende con la regla del campo; si no cumple, no entra nada.
      evento.preventDefault();
      const pegado = motor.pegar(evento.clipboardData.getData("text"));
      if (pegado === null) return;
      // Se inserta donde estaba el cursor (o reemplaza lo seleccionado) y el resultado vuelve a pasar por la regla.
      const el = evento.currentTarget;
      const desde = el.selectionStart ?? visible.length;
      const hasta = el.selectionEnd ?? desde;
      const unido = motor.escribir(
        visible.slice(0, desde) + pegado.texto + visible.slice(hasta),
        desde + pegado.texto.length,
      );
      aplicar(unido.texto, unido.canonico, unido.cursor);
    },
    // Al salir se completa lo que la regla completa (p. ej. los dos decimales del dinero).
    alSalir: () => {
      setTipeado(motor.mostrar(motor.canonicoDe(visible)));
    },
  };
}
