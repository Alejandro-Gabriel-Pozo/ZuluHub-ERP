import { CajaDeCampo } from "./CajaDeCampo";
import estilos from "./CampoDeCodigo.module.css";

export type PropsDeCampoDeCodigo = Readonly<{
  etiqueta: string;
  valor: string;
  alCambiar: (valor: string) => void;
  /** Cuántos dígitos tiene el código. */
  largo?: number;
  nombre?: string | undefined;
  ayuda?: string | undefined;
  error?: string | undefined;
  deshabilitado?: boolean;
}>;

/**
 * Código de verificación de seis dígitos (segundo factor). Es UN solo campo, no seis casillas sueltas: el lector de
 * pantalla lo anuncia una vez, el celular ofrece el código recibido (`one-time-code`) y se puede pegar entero. Solo
 * deja dígitos y corta en `largo` (sin `maxLength`: pegado con un espacio, como lo muestran las aplicaciones, se recortaría antes de limpiarlo); qué hacer con el código lo decide quien arma la pantalla.
 */
export function CampoDeCodigo({
  etiqueta,
  valor,
  alCambiar,
  largo = 6,
  nombre,
  ayuda,
  error,
  deshabilitado = false,
}: PropsDeCampoDeCodigo) {
  return (
    <CajaDeCampo
      etiqueta={etiqueta}
      ayuda={ayuda}
      error={error}
      control={(datos) => (
        <input
          {...datos}
          className={estilos["entrada"]}
          type="text"
          name={nombre}
          value={valor}
          inputMode="numeric"
          autoComplete="one-time-code"
          disabled={deshabilitado}
          onChange={(evento) => {
            alCambiar(evento.target.value.replace(/\D/g, "").slice(0, largo));
          }}
        />
      )}
    />
  );
}
