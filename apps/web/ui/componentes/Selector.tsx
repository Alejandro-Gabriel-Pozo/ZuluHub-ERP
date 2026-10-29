import { CajaDeCampo } from "./CajaDeCampo";
import estilos from "./Selector.module.css";

type OpcionDeSelector = Readonly<{ valor: string; etiqueta: string }>;

export type PropsDeSelector = Readonly<{
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
  /** El navegador no deja enviar el formulario con la opción vacía (`required`). Sin texto visible: el aviso lo da el navegador. */
  requerido?: boolean;
}>;

/** Selector nativo (`<select>`): en el celular es el mejor selector que existe. */
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
          name={nombre}
          value={valor}
          disabled={deshabilitado}
          required={requerido}
          onChange={(evento) => {
            alCambiar(evento.target.value);
          }}
        >
          {textoDeElegir !== undefined ? <option value="">{textoDeElegir}</option> : null}
          {opciones.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>
              {opcion.etiqueta}
            </option>
          ))}
        </select>
      )}
    />
  );
}
