import type { DatoDeCampo } from "../../../../src/capacidades/datos/registro";
import type { TipoDeDocumentoDeIdentidad } from "../../../../src/primitivas/identificacion-fiscal/documento";
import {
  documentoMientrasSeEscribe,
  escribirDocumento,
  interpretarDocumentoPegado,
} from "../../../../src/primitivas/identificacion-fiscal/documento-tipeado";
import { CajaDeCampo } from "./CajaDeCampo";
import estilos from "./Campo.module.css";
import { useCampoFormateado } from "./useCampoFormateado";

export type PropsDeCampoDeDocumento = Readonly<{
  /** Qué dato pide el campo: un `IdDeDato` del registro de datos o `"pendiente"` (deuda registrada). Obligatorio: sin dato no hay campo. */
  dato: DatoDeCampo;
  etiqueta: string;
  /** El tipo de documento: de él salen el formato, el largo y lo que se permite escribir (ficha `documento.ts`). */
  tipo: TipoDeDocumentoDeIdentidad;
  /** El número en su forma canónica (solo dígitos, o el pasaporte en mayúsculas), o `""`. Es también lo que entrega `alCambiar`. */
  valor: string;
  alCambiar: (valor: string) => void;
  error?: string | undefined;
  deshabilitado?: boolean;
}>;

/**
 * Número de documento del receptor: el sistema pone los guiones del CUIT y los puntos del DNI MIENTRAS se escribe; quien escribe tipea
 * solo dígitos (el pasaporte, letras y dígitos en mayúscula). Lo pegado entra con o sin separadores si es del tipo, y si no, el campo
 * no cambia. Entrega siempre el valor canónico: el servidor lo vuelve a validar. La regla vive en la primitiva
 * (`documento-tipeado.ts`); acá solo se cablea.
 */
export function CampoDeDocumento({
  etiqueta,
  tipo,
  valor,
  alCambiar,
  error,
  deshabilitado = false,
}: PropsDeCampoDeDocumento) {
  const { entrada, visible, alEscribir, alPegar, alSalir } = useCampoFormateado(valor, alCambiar, {
    escribir: (crudo, cursor) => escribirDocumento(tipo, crudo, cursor),
    pegar: (crudo) => {
      const pegado = interpretarDocumentoPegado(tipo, crudo);
      return pegado.ok ? { texto: pegado.texto } : null;
    },
    mostrar: (canonico) => documentoMientrasSeEscribe(tipo, canonico),
    canonicoDe: (texto) => escribirDocumento(tipo, texto, texto.length).canonico,
  });
  return (
    <CajaDeCampo
      etiqueta={etiqueta}
      obligatorio={undefined}
      ayuda={undefined}
      error={error}
      control={(datos) => (
        <input
          {...datos}
          ref={entrada}
          className={estilos["entrada"]}
          type="text"
          // El pasaporte lleva letras (ABC123456, dueño, 2026-11-06): el teclado numérico no las deja escribir.
          inputMode={tipo === "PASAPORTE" ? "text" : "numeric"}
          autoCapitalize={tipo === "PASAPORTE" ? "characters" : "off"}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={visible}
          disabled={deshabilitado}
          onBlur={alSalir}
          onPaste={alPegar}
          onChange={alEscribir}
        />
      )}
    />
  );
}
