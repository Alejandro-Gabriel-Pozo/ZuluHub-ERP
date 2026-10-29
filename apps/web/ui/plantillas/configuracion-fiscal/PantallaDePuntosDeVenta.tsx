import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { Insignia } from "../../componentes/Insignia";
import { Texto } from "../../primitivas/Texto";
import { MigasDeConfiguracion, type TramoDeMigas } from "./MigasDeConfiguracion";
import type { FilaDePuntoDeVenta } from "./modelo-de-puntos-de-venta";
import estilos from "./PantallaDePuntosDeVenta.module.css";

export type PropsDePantallaDePuntosDeVenta = Readonly<{
  migas: readonly TramoDeMigas[];
  filas: readonly FilaDePuntoDeVenta[];
  /** «Tocá un punto de venta para editarlo, activarlo o desactivarlo.» */
  ayuda: string;
  /** «Agregar punto de venta» y adónde lleva. */
  agregar: Readonly<{ texto: string; href: string }>;
}>;

/**
 * La lista de puntos de venta (PROTO-PV, pantalla 1): todos los del emisor, también los que no están activos (D-60), cada uno con su
 * número de cinco dígitos, su sucursal, si está activo y su ambiente; tocarlo abre su pantalla. Sin ninguno, solo queda «Agregar»
 * (no hay un texto aprobado para el vacío).
 */
export function PantallaDePuntosDeVenta({
  migas,
  filas,
  ayuda,
  agregar,
}: PropsDePantallaDePuntosDeVenta) {
  return (
    <div className={estilos["raiz"]}>
      <MigasDeConfiguracion tramos={migas} />
      {filas.length === 0 ? null : (
        <>
          <ul className={estilos["lista"]}>
            {filas.map((fila) => (
              <li key={fila.id}>
                <a className={estilos["fila"]} href={fila.href}>
                  <span className={estilos["datos"]}>
                    <span className={estilos["numero"]}>{fila.numero}</span>
                    <span className={estilos["sucursal"]}>{fila.sucursal}</span>
                  </span>
                  <span className={estilos["marcas"]}>
                    <Insignia tono={fila.activo.tono}>{fila.activo.texto}</Insignia>
                    <Insignia tono={fila.ambiente.tono}>{fila.ambiente.texto}</Insignia>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <Texto variante="suave">{ayuda}</Texto>
        </>
      )}
      <div>
        <EnlaceDeAccion href={agregar.href}>{agregar.texto}</EnlaceDeAccion>
      </div>
    </div>
  );
}
