import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { RegionDeEstado } from "../../patrones/RegionDeEstado";
import { ErrorDelDetalle } from "../facturacion/ErrorDelDetalle";

/**
 * Lo que dice una pantalla de Datos fiscales mientras envía (los mismos textos que ya usa Puntos de venta): «Verificando si se
 * registró…» cuando el resultado es incierto (con la referencia si fue un INESPERADO devuelto como valor) y, si el servidor rechazó, su
 * rechazo con el texto del catálogo. Lo usa el formulario de Datos fiscales.
 */
export function AvisosDelEnvio({
  enCurso,
  incierto,
  referenciaIncierta,
  rechazo,
}: Readonly<{
  enCurso: boolean;
  incierto: boolean;
  referenciaIncierta: string | undefined;
  /** El rechazo que se dice arriba (el que tiene campo se marca en su campo y no viene acá). */
  rechazo: ErrorPublico | null;
}>) {
  return (
    <>
      <RegionDeEstado urgencia="cortes" ocupada={enCurso}>
        {incierto ? texto({}, "conexion.verificando") : null}
      </RegionDeEstado>
      {incierto && referenciaIncierta !== undefined ? (
        <ErrorDelDetalle
          error={{
            codigo: "ERROR_INTERNO",
            clave: "error.inesperado",
            presentacion: "INESPERADO",
            referencia: referenciaIncierta,
          }}
        />
      ) : null}
      {rechazo === null ? null : <ErrorDelDetalle error={rechazo} />}
    </>
  );
}
