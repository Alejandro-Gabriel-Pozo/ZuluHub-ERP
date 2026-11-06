import type { DatoDeCampo } from "../../../../src/capacidades/datos/registro";
import { CajaDeCampo } from "./CajaDeCampo";
import estilos from "./Campo.module.css";

export type PropsDeCampo = Readonly<{
  /** Qué dato pide el campo: un `IdDeDato` del registro de datos o `"pendiente"` (deuda registrada). Obligatorio: sin dato no hay campo. */
  dato: DatoDeCampo;
  etiqueta: string;
  valor: string;
  alCambiar: (valor: string) => void;
  nombre?: string | undefined;
  tipo?: "text" | "email" | "search" | "tel" | "url" | "date";
  /** Con `tipo="date"`: la última fecha `aaaa-mm-dd` que ofrece el selector. Es ayuda, no validación (la regla es del servidor). */
  maximo?: string | undefined;
  autoComplete?: string | undefined;
  /** `"off"` para códigos que distinguen mayúsculas: el teclado del celular no debe corregirlos ni capitalizarlos. */
  autoCapitalize?: "off" | undefined;
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email" | "search" | "url";
  obligatorio?: string | undefined;
  ayuda?: string | undefined;
  error?: string | undefined;
  deshabilitado?: boolean;
}>;

/** Campo de texto con etiqueta visible y el error asociado por ARIA. Para importes está `CampoImporte`. */
export function Campo({
  etiqueta,
  valor,
  alCambiar,
  nombre,
  tipo = "text",
  maximo,
  autoComplete,
  autoCapitalize,
  inputMode,
  obligatorio,
  ayuda,
  error,
  deshabilitado = false,
}: PropsDeCampo) {
  return (
    <CajaDeCampo
      etiqueta={etiqueta}
      obligatorio={obligatorio}
      ayuda={ayuda}
      error={error}
      control={(datos) => (
        <input
          {...datos}
          className={estilos["entrada"]}
          type={tipo}
          max={maximo}
          name={nombre}
          value={valor}
          autoComplete={autoComplete}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCapitalize === "off" ? "off" : undefined}
          spellCheck={autoCapitalize === "off" ? false : undefined}
          inputMode={inputMode}
          disabled={deshabilitado}
          onChange={(evento) => {
            alCambiar(evento.target.value);
          }}
        />
      )}
    />
  );
}
