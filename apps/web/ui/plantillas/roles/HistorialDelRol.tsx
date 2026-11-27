import type { HistorialDelRolArmado } from "./modelo-de-roles";
import estilos from "./PantallaDeRoles.module.css";

export type PropsDeHistorialDelRol = Readonly<{ historial: HistorialDelRolArmado }>;

/**
 * El historial de un rol propio: lo último que le pasó, del más nuevo al más viejo; cada fila dice cuándo (hora de Argentina), quién y qué, y si fue una edición, el nombre anterior y las acciones agregadas o quitadas.
 * Solo lectura y sin estado: es parte de la página de servidor de la ficha, que lo dibuja solo si el servidor se lo entregó (solo el gerente).
 */
export function HistorialDelRol({ historial }: PropsDeHistorialDelRol) {
  return (
    <section className={estilos["historial"]} aria-labelledby="historial-del-rol">
      <h2 id="historial-del-rol" className={estilos["titulo"]}>
        {historial.titulo}
      </h2>
      <ol className={estilos["lista"]}>
        {historial.filas.map((f) => (
          <li key={f.id} className={estilos["evento"]}>
            <span className={estilos["nombre"]}>{f.que}</span>
            <span className={estilos["detalle"]}>
              {f.cuando}
              {f.por === null ? "" : ` · ${f.por}`}
            </span>
            {f.cambios.map((c) => (
              <span key={c.rotulo} className={estilos["detalle"]}>
                <strong>{c.rotulo}:</strong> {c.texto}
              </span>
            ))}
          </li>
        ))}
      </ol>
    </section>
  );
}
