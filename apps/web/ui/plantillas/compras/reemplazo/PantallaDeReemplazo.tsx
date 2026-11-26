import type { ReactNode } from "react";
import { EnlaceDeAccion } from "../../../componentes/EnlaceDeAccion";
import type { PasoPrevio } from "./modelo-de-reemplazo";
import type { TextosDeReemplazo } from "./textos-de-reemplazo";
import estilos from "../Compras.module.css";

export type PropsDePantallaDeReemplazo = Readonly<{
  /** Lo que hay que deshacer antes, en el orden del servidor (vacío: se puede seguir ya). */
  pasos: readonly PasoPrevio[];
  textos: TextosDeReemplazo;
  /** El formulario del comprobante nuevo (el paso 2). */
  children: ReactNode;
}>;

const ROTULO_DEL_PASO = (textos: TextosDeReemplazo, freno: PasoPrevio["freno"]): string =>
  freno === "PAGO_VIGENTE"
    ? textos.pago
    : freno === "CONCILIACIONES_VIVAS"
      ? textos.conciliaciones
      : textos.notas;

/**
 * «Reemplazar el comprobante» (NOTAS-2c-2; maqueta de Diseño 2, pantalla 11): primero «Qué hay que deshacer antes» (lo que dice el servidor, en su orden: el pago vigente, las conciliaciones vivas y las notas vigentes; cada paso
 * lleva a la pantalla que lo resuelve solo si la persona tiene el permiso de ese paso) y después el comprobante nuevo. Sin pasos previos no se dibuja la sección (sin texto nuevo). La pantalla no deshace nada por su cuenta: cada paso es
 * de quien tiene el permiso de ese paso, y el servidor revalida todo bajo bloqueo al reemplazar. El `h1` lo pone el armazón.
 */
export function PantallaDeReemplazo({ pasos, textos, children }: PropsDePantallaDeReemplazo) {
  return (
    <div className={estilos["cuerpo"]}>
      {pasos.length === 0 ? null : (
        <section aria-labelledby="deshacer-antes">
          <h2 id="deshacer-antes">{textos.queDeshacerAntes}</h2>
          <ol className={estilos["lista"]}>
            {pasos.map((p) => (
              <li key={p.freno} className={estilos["tarjeta"]}>
                {p.ruta === null ? (
                  <span className={estilos["titulo"]}>{ROTULO_DEL_PASO(textos, p.freno)}</span>
                ) : (
                  <EnlaceDeAccion href={p.ruta} variante="secundaria">
                    {ROTULO_DEL_PASO(textos, p.freno)}
                  </EnlaceDeAccion>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
      {children}
    </div>
  );
}
