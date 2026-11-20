import type { DatoDeCampo } from "../../../../src/capacidades/datos/registro";
import estilos from "./AreaDeTexto.module.css";
import { CajaDeCampo } from "./CajaDeCampo";

export type PropsDeAreaDeTexto = Readonly<{
  /** Qué dato pide el campo: un `IdDeDato` del registro de datos o `"pendiente"` (deuda registrada). Obligatorio: sin dato no hay campo. */
  dato: DatoDeCampo;
  etiqueta: string;
  valor: string;
  alCambiar: (valor: string) => void;
  nombre?: string | undefined;
  error?: string | undefined;
  deshabilitado?: boolean;
}>;

/**
 * Texto de varias líneas con etiqueta y error asociados por ARIA. Es un componente de campo (`COMPONENTES_DE_CAMPO`): quien lo usa dice
 * qué dato pide. Previene el `<textarea>` crudo sin dato (hoy hay tres como deuda en `arquitectura/deuda/campos-sin-dato.json`).
 */
export function AreaDeTexto({
  etiqueta,
  valor,
  alCambiar,
  nombre,
  error,
  deshabilitado = false,
}: PropsDeAreaDeTexto) {
  return (
    <CajaDeCampo
      etiqueta={etiqueta}
      obligatorio={undefined}
      ayuda={undefined}
      error={error}
      control={(datos) => (
        <textarea
          {...datos}
          className={estilos["entrada"]}
          name={nombre}
          value={valor}
          disabled={deshabilitado}
          onChange={(evento) => {
            alCambiar(evento.target.value);
          }}
        />
      )}
    />
  );
}
