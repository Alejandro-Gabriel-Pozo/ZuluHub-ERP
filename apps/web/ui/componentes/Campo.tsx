import { CajaDeCampo } from "./CajaDeCampo";
import estilos from "./Campo.module.css";

export type PropsDeCampo = Readonly<{
  etiqueta: string;
  valor: string;
  alCambiar: (valor: string) => void;
  nombre?: string | undefined;
  tipo?: "text" | "email" | "search" | "tel" | "url";
  autoComplete?: string | undefined;
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
  autoComplete,
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
          name={nombre}
          value={valor}
          autoComplete={autoComplete}
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
