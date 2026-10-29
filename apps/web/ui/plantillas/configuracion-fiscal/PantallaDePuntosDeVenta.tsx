import { Boton } from "../../componentes/Boton";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { Insignia } from "../../componentes/Insignia";
import { Texto } from "../../primitivas/Texto";
import { MigasDeConfiguracion, type TramoDeMigas } from "./MigasDeConfiguracion";
import type { FilaDePuntoDeVenta, OfertaDeAccion } from "./modelo-de-puntos-de-venta";
import estilos from "./PantallaDePuntosDeVenta.module.css";

export type PropsDePantallaDePuntosDeVenta = Readonly<{
  migas: readonly TramoDeMigas[];
  filas: readonly FilaDePuntoDeVenta[];
  /** «Todavía no hay puntos de venta.», cuando no hay ninguno. */
  vacio: string;
  /** «Tocá un punto de venta para editarlo, activarlo o desactivarlo.» */
  ayuda: string;
  /** «Agregar punto de venta», adónde lleva y si el servidor lo deja hacer hoy (apagado, con su motivo, si no). */
  agregar: Readonly<{ texto: string; href: string; oferta: OfertaDeAccion }>;
}>;

/**
 * La lista de puntos de venta (PROTO-PV, pantalla 1): todos los del emisor, también los que no están activos (D-60), cada uno con su
 * número de cinco dígitos, su sucursal, su estado y su ambiente (cada uno con su rótulo) y, en pruebas, el aviso de que no tiene valor
 * fiscal; tocarlo abre su pantalla. Sin ninguno, el texto del vacío y «Agregar».
 */
export function PantallaDePuntosDeVenta({
  migas,
  filas,
  vacio,
  ayuda,
  agregar,
}: PropsDePantallaDePuntosDeVenta) {
  return (
    <div className={estilos["raiz"]}>
      <MigasDeConfiguracion tramos={migas} />
      {filas.length === 0 ? (
        <Texto variante="suave">{vacio}</Texto>
      ) : (
        <>
          <ul className={estilos["lista"]}>
            {filas.map((fila) => (
              <li key={fila.id}>
                <a className={estilos["fila"]} href={fila.href}>
                  <span className={estilos["datos"]}>
                    <span className={estilos["numero"]}>{fila.numero}</span>
                    <span className={estilos["sucursal"]}>{fila.sucursal}</span>
                    {fila.avisoDePruebas === null ? null : (
                      <span className={estilos["aviso"]}>{fila.avisoDePruebas}</span>
                    )}
                  </span>
                  <span className={estilos["marcas"]}>
                    {[fila.activo, fila.ambiente].map((marca) => (
                      <span key={marca.rotulo} className={estilos["marca"]}>
                        <span className={estilos["rotulo"]}>{marca.rotulo}</span>
                        <Insignia tono={marca.tono}>{marca.texto}</Insignia>
                      </span>
                    ))}
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <Texto variante="suave">{ayuda}</Texto>
        </>
      )}
      <div>
        {agregar.oferta.permitida ? (
          <EnlaceDeAccion href={agregar.href}>{agregar.texto}</EnlaceDeAccion>
        ) : (
          // Apagado con su motivo visible y asociado, igual que «Anular» en el Detalle de comprobantes.
          <Boton deshabilitado motivo={agregar.oferta.motivo ?? undefined}>
            {agregar.texto}
          </Boton>
        )}
      </div>
    </div>
  );
}
