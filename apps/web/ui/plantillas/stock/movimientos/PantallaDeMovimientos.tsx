import { SelectorDeDeposito } from "../lectura/SelectorDeDeposito";
import { Boton } from "../../../componentes/Boton.cliente";
import { EnlaceDeAccion } from "../../../componentes/EnlaceDeAccion";
import { Insignia } from "../../../componentes/Insignia";
import type { VistaDeMovimientos } from "./modelo-de-movimientos";
import estilos from "./PantallaDeMovimientos.module.css";

export type PropsDePantallaDeMovimientos = Readonly<{
  vista: VistaDeMovimientos;
  textos: Readonly<{ depositos: string; anulado: string; siguiente: string; anular: string }>;
  /** Si el servidor deja anular hoy: si no, «Anular» sale apagado. Solo una ayuda: el guard decide. */
  puedeAnular: boolean;
  hrefDeAnular: (movimientoId: string) => string;
}>;

/**
 * «Movimientos» de la sucursal (maqueta `stock.html`, 09/11/2026), solo lectura: el selector de depósitos y una tarjeta por renglón del libro con su clase, «Anulado» si lo está, la cantidad con signo, el
 * artículo, el motivo, quién lo registró y cuándo. «Anular» solo en lo que el servidor dice que es anulable: lleva al detalle de la anulación, o sale apagado sin permiso. Los textos llegan resueltos.
 */
export function PantallaDeMovimientos({
  vista,
  textos,
  puedeAnular,
  hrefDeAnular,
}: PropsDePantallaDeMovimientos) {
  return (
    <div className={estilos["raiz"]}>
      <SelectorDeDeposito rotulo={textos.depositos} opciones={vista.opciones} />
      <ul className={estilos["lista"]}>
        {vista.tarjetas.map((t) => (
          <li key={t.id} className={estilos["tarjeta"]}>
            <div className={estilos["cabecera"]}>
              <strong className={estilos["titulo"]}>{t.clase}</strong>
              {t.anulado ? <Insignia tono="aviso">{textos.anulado}</Insignia> : null}
              <span className={estilos["cantidad"]}>{t.cantidad}</span>
            </div>
            <span className={estilos["detalle"]}>{t.detalle}</span>
            <span className={estilos["detalle"]}>{t.cuando}</span>
            {t.anulable ? (
              puedeAnular ? (
                <EnlaceDeAccion href={hrefDeAnular(t.movimientoId)} variante="secundaria">
                  {textos.anular}
                </EnlaceDeAccion>
              ) : (
                <Boton deshabilitado>{textos.anular}</Boton>
              )
            ) : null}
          </li>
        ))}
      </ul>
      {vista.hrefDeSiguiente === null ? null : (
        <a href={vista.hrefDeSiguiente}>{textos.siguiente}</a>
      )}
    </div>
  );
}
