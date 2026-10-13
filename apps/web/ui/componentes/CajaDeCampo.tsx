import { useId, type ReactNode } from "react";
import { Icono } from "../iconos/Icono";
import estilos from "./CajaDeCampo.module.css";

export type PropsDeCajaDeCampo = Readonly<{
  /** La etiqueta es visible SIEMPRE (no alcanza un texto de ejemplo adentro del campo). */
  etiqueta: string;
  /** Si el dato es obligatorio, el texto que lo dice («obligatorio»): se marca con texto, no solo con `*`. */
  obligatorio?: string | undefined;
  ayuda?: string | undefined;
  /** El error ya resuelto. Se asocia al control por `aria-describedby` y se marca `aria-invalid`. */
  error?: string | undefined;
  /** Dibuja el control con los datos que tiene que llevar para quedar asociado a la etiqueta y al error. */
  control: (datos: DatosDelControl) => ReactNode;
}>;

type DatosDelControl = Readonly<{
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
  "aria-required": true | undefined;
}>;

/** Etiqueta, ayuda y error alrededor de un control: lo común a Campo, CampoImporte y Selector. */
export function CajaDeCampo({ etiqueta, obligatorio, ayuda, error, control }: PropsDeCajaDeCampo) {
  const id = useId();
  const idAyuda = `${id}-ayuda`;
  const idError = `${id}-error`;
  const hayAyuda = ayuda !== undefined && ayuda !== "";
  const hayError = error !== undefined && error !== "";
  const descripcion = [hayAyuda ? idAyuda : "", hayError ? idError : ""].filter(Boolean).join(" ");
  return (
    <div className={estilos["caja"]}>
      <label htmlFor={id} className={estilos["etiqueta"]}>
        {etiqueta}
        {obligatorio !== undefined ? (
          <span className={estilos["obligatorio"]}> ({obligatorio})</span>
        ) : null}
      </label>
      {control({
        id,
        "aria-describedby": descripcion === "" ? undefined : descripcion,
        "aria-invalid": hayError ? true : undefined,
        "aria-required": obligatorio !== undefined ? true : undefined,
      })}
      {hayAyuda ? (
        <p id={idAyuda} className={estilos["ayuda"]}>
          {ayuda}
        </p>
      ) : null}
      {hayError ? (
        <p id={idError} className={estilos["error"]}>
          <Icono clave="estado-peligro" tamano="chico" decorativo />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
