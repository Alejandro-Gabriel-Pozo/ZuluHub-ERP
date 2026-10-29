import { Insignia } from "../../componentes/Insignia";
import { Texto } from "../../primitivas/Texto";
import type { FilaDeLaLista } from "./lista-de-lo-que-falta";
import estilos from "./PantallaDeConfiguracionFiscal.module.css";

export type PropsDePantallaDeConfiguracionFiscal = Readonly<{
  /** «Lo que hace falta para emitir comprobantes», ya resuelto. */
  subtitulo: string;
  filas: readonly FilaDeLaLista[];
}>;

function Contenido({ fila }: Readonly<{ fila: FilaDeLaLista }>) {
  return (
    <>
      <span className={estilos["titulo"]}>{fila.titulo}</span>
      {fila.cartel === null ? null : (
        <Insignia tono={fila.cartel.tono}>{fila.cartel.texto}</Insignia>
      )}
    </>
  );
}

/**
 * La lista de lo que falta para emitir (D-43, opción C): una fila por tema, con su cartel si hay algo pendiente (D-64). Una fila con
 * enlace lleva a la pantalla de su tema; la del certificado todavía no es un enlace (su pantalla no tiene textos aprobados).
 */
export function PantallaDeConfiguracionFiscal({
  subtitulo,
  filas,
}: PropsDePantallaDeConfiguracionFiscal) {
  return (
    <div className={estilos["raiz"]}>
      <Texto variante="suave">{subtitulo}</Texto>
      <ul className={estilos["lista"]}>
        {filas.map((fila) => (
          <li key={fila.clave}>
            {fila.href === null ? (
              <div className={estilos["fila"]}>
                <Contenido fila={fila} />
              </div>
            ) : (
              <a className={estilos["fila"]} href={fila.href}>
                <Contenido fila={fila} />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
