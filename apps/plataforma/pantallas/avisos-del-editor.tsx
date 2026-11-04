import { Aviso } from "../../web/ui/componentes/Aviso";
import { Boton } from "../../web/ui/componentes/Boton";
import { Texto } from "../../web/ui/primitivas/Texto";
import type { ErrorParaLaPantalla } from "../logica/errores-de-plataforma";
import type { FichaDeSubmarca } from "../logica/ficha-de-submarca";
import { textoGeneral, textoParaAviso } from "./textos-del-editor";

export const TEXTO_DE_RETIRADA =
  "Esta submarca está retirada. Se puede ver, pero ya no se puede modificar ni confirmar.";

export type PropsDeAvisosDelEditor = Readonly<{
  puedeConfirmarse: FichaDeSubmarca["puedeConfirmarse"];
  /** Fecha legible del cambio programado del que parte el formulario (sin borrador), o `null`. */
  partidaProgramadaDesde: string | null;
  /** La ficha dice que la submarca está retirada (la edición ya está bloqueada). */
  retiradaPorLaFicha: boolean;
  /** El error de negocio del último guardado, si lo hubo (el de un campo se ve junto al campo). */
  errorDeServidor: ErrorParaLaPantalla | null;
  /** Estado del envío: incierto (no se supo si quedó guardado), en curso, o guardado. */
  incierto: boolean;
  enCurso: boolean;
  guardado: boolean;
  motivoQueNoPuede: string | undefined;
  /** El código `PD-…` de un error inesperado que dejó el guardado incierto. */
  referenciaIncierta: string | undefined;
  alReintentar: () => void;
}>;

/** Los avisos de arriba del editor: retirada, confirmación imposible, error del servidor, resultado incierto y éxito. */
export function AvisosDelEditor({
  puedeConfirmarse,
  partidaProgramadaDesde,
  retiradaPorLaFicha,
  errorDeServidor,
  incierto,
  enCurso,
  guardado,
  motivoQueNoPuede,
  referenciaIncierta,
  alReintentar,
}: PropsDeAvisosDelEditor) {
  return (
    <>
      {partidaProgramadaDesde === null ? null : (
        <Aviso tono="aviso">
          <Texto>
            Estás partiendo de un cambio programado para el {partidaProgramadaDesde}. Lo que rige
            hoy es distinto.
          </Texto>
        </Aviso>
      )}
      {retiradaPorLaFicha ? (
        <Aviso tono="aviso" titulo="Submarca retirada">
          <Texto>{TEXTO_DE_RETIRADA}</Texto>
        </Aviso>
      ) : puedeConfirmarse.ok ? null : (
        <Aviso tono="aviso" titulo="Todavía no se puede confirmar">
          <Texto>
            {textoParaAviso(puedeConfirmarse.error) ?? "Revisá el borrador antes de confirmar."}
          </Texto>
        </Aviso>
      )}
      {errorDeServidor === null || errorDeServidor.tipo === "CAMPO" || retiradaPorLaFicha ? null : (
        <Aviso
          tono={
            errorDeServidor.tipo === "OCULTAR_ACCION" || errorDeServidor.tipo === "MARCA_RETIRADA"
              ? "aviso"
              : "peligro"
          }
          accion={
            errorDeServidor.tipo === "PANTALLA_VIEJA" ? (
              <Boton
                variante="secundaria"
                alTocar={() => {
                  window.location.reload();
                }}
              >
                Recargar
              </Boton>
            ) : null
          }
        >
          <Texto>{textoGeneral(errorDeServidor)}</Texto>
        </Aviso>
      )}
      {incierto ? (
        <Aviso
          tono="aviso"
          accion={
            enCurso ? null : (
              <Boton variante="secundaria" alTocar={alReintentar}>
                Reintentar
              </Boton>
            )
          }
        >
          <Texto>
            {motivoQueNoPuede ??
              "No supimos si el borrador quedó guardado. Reintentá: no se va a duplicar."}
          </Texto>
          {referenciaIncierta === undefined ? null : (
            <Texto>Código de referencia: {referenciaIncierta}</Texto>
          )}
        </Aviso>
      ) : null}
      {guardado ? (
        <Aviso tono="exito">
          <Texto>Borrador guardado.</Texto>
        </Aviso>
      ) : null}
    </>
  );
}
