import { Insignia } from "../../componentes/Insignia";
import type { ListaDeUsuariosArmada } from "./modelo-de-usuarios";
import estilos from "./PantallaDeUsuarios.module.css";

export type PropsDePantallaDeListaDeUsuarios = Readonly<{ lista: ListaDeUsuariosArmada }>;

/**
 * «Usuarios» (maqueta `usuarios.html`, `vLista`): las personas de la empresa, una por fila con su email y su rol; la desactivada lleva su insignia «Desactivado». Debajo, el bloque de invitaciones (solo si
 * hay): email, rol, «Vence el …» y su insignia, «Vencida» o «Pendiente». Las filas de personas son enlaces a su ficha; las de invitaciones no (las enlaza el tramo que las gestiona). Sin botones: en este
 * tramo la pantalla solo muestra. Sin estado ni hooks: es una página de servidor.
 */
export function PantallaDeListaDeUsuarios({ lista }: PropsDePantallaDeListaDeUsuarios) {
  return (
    <div className={estilos["cuerpo"]}>
      <ul className={estilos["lista"]}>
        {lista.usuarios.map((u) => (
          <li key={u.personaId}>
            <a className={estilos["fila"]} href={u.href}>
              <span className={estilos["nombre"]}>{u.email}</span>{" "}
              <span className={estilos["detalle"]}>{u.rol}</span>{" "}
              {u.insignia === null ? null : (
                <span className={estilos["estado"]}>
                  <Insignia tono={u.insignia.tono}>{u.insignia.texto}</Insignia>
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
      {lista.invitaciones === null ? null : (
        <section className={estilos["seccion"]}>
          <h2 className={estilos["encabezado"]}>{lista.invitaciones.encabezado}</h2>
          <ul className={estilos["lista"]}>
            {lista.invitaciones.filas.map((i) => (
              <li key={i.invitacionId} className={estilos["fila"]}>
                <span className={estilos["nombre"]}>{i.email}</span>
                <span className={estilos["detalle"]}>
                  {i.rol} · {i.vence}
                </span>
                <span className={estilos["estado"]}>
                  <Insignia tono={i.insignia.tono}>{i.insignia.texto}</Insignia>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
