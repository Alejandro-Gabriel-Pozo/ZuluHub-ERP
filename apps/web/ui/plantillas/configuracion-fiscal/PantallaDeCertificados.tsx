import { Insignia } from "../../componentes/Insignia";
import type { FilaDeAmbiente } from "./modelo-de-certificado";
import estilos from "./PantallaDeConfiguracionFiscal.module.css";

/**
 * La lista del certificado de ARCA: una fila por ambiente (Pruebas, Producción) con su cartel si hay algo pendiente (D-64) y, con
 * certificado vigente, «Vence» y la fecha. Tocar una fila abre el asistente de ese ambiente. Mismo aspecto que la lista de lo que falta.
 */
export function PantallaDeCertificados({ filas }: Readonly<{ filas: readonly FilaDeAmbiente[] }>) {
  return (
    <div className={estilos["raiz"]}>
      <ul className={estilos["lista"]}>
        {filas.map((fila) => (
          <li key={fila.ambiente}>
            <a className={estilos["fila"]} href={fila.href}>
              <span className={estilos["titulo"]}>
                {fila.titulo}
                {fila.vence === null ? null : <span className={estilos["sub"]}>{fila.vence}</span>}
              </span>
              {fila.cartel === null ? null : (
                <Insignia tono={fila.cartel.tono}>{fila.cartel.texto}</Insignia>
              )}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
