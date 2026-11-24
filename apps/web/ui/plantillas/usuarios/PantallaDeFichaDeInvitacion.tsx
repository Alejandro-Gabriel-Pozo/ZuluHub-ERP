import { Insignia } from "../../componentes/Insignia";
import { FormularioDeAccionDeInvitacion } from "./FormularioDeAccionDeInvitacion.cliente";
import type { FichaDeInvitacionArmada } from "./modelo-de-invitaciones";
import type { ResultadoDeAccionDeInvitacion } from "./resultado-de-usuarios";
import estilos from "./PantallaDeUsuarios.module.css";

type AccionDeInvitacion = (
  previo: ResultadoDeAccionDeInvitacion,
  datos: FormData,
) => Promise<ResultadoDeAccionDeInvitacion>;

export type PropsDePantallaDeFichaDeInvitacion = Readonly<{
  ficha: FichaDeInvitacionArmada;
  /** `reenviarInvitacionAccion.bind(null, id)`; `null` si la persona no puede reenviar: el botón no se dibuja (todo nace cerrado; el servidor lo vuelve a exigir). */
  reenviar: AccionDeInvitacion | null;
  /** Ídem para revocar. */
  revocar: AccionDeInvitacion | null;
}>;

/**
 * La ficha de una invitación pendiente (maqueta `usuarios.html`, `vInvitacion`): el email es el título de la pantalla (lo pone la página) y debajo van el rol, las sucursales, el estado y «Vence el …».
 * «Reenviar» (manda un enlace nuevo y anula el anterior; sirve también con la invitación vencida) y «Revocar» (la deja sin efecto). Cada botón es su propio formulario. Sin confirmación: así lo
 * aprobó el dueño (revocar y reenviar no piden confirmar; solo desactivar).
 */
export function PantallaDeFichaDeInvitacion({
  ficha,
  reenviar,
  revocar,
}: PropsDePantallaDeFichaDeInvitacion) {
  return (
    <div className={estilos["cuerpo"]}>
      <dl className={estilos["datos"]}>
        {ficha.renglones.map((r) => (
          <div key={r.rotulo} className={estilos["dato"]}>
            <dt>{r.rotulo}</dt>
            <dd>
              {r.insignia === null ? (
                r.valor
              ) : (
                <Insignia tono={r.insignia.tono}>{r.insignia.texto}</Insignia>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className={estilos["vence"]}>{ficha.vence}</p>
      {reenviar === null && revocar === null ? null : (
        <div className={estilos["botones"]}>
          {reenviar === null ? null : (
            <FormularioDeAccionDeInvitacion accion={reenviar} texto={ficha.reenviar} />
          )}
          {revocar === null ? null : (
            <FormularioDeAccionDeInvitacion
              accion={revocar}
              texto={ficha.revocar}
              variante="peligro"
            />
          )}
        </div>
      )}
    </div>
  );
}
