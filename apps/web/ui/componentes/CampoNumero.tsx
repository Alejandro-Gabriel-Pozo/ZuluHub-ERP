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
import { useCampoFormateado } from "./useCampoFormateado";

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
  const { entrada, visible, alEscribir, alPegar, alSalir } = useCampoFormateado(valor, alCambiar, {
    escribir: (crudo, cursor) => escribirNumero(crudo, cursor, regla),
    pegar: (crudo) => {
      const pegado = interpretarNumeroPegado(crudo, regla);
      return pegado.ok ? { texto: pegado.texto } : null;
    },
    mostrar: (canonico) => mostrarNumero(canonico, regla),
    canonicoDe: (texto) => canonicoDe(texto, regla),
  });

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
            onBlur={alSalir}
            onPaste={alPegar}
            onChange={alEscribir}
          />
          {nombre !== undefined ? <input type="hidden" name={nombre} value={valor} /> : null}
        </span>
      )}
    />
  );
}
