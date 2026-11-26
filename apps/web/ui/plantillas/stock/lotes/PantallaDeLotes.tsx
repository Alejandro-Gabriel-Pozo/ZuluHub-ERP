import { Insignia } from "../../../componentes/Insignia";
import { SelectorDeDeposito } from "../lectura/SelectorDeDeposito";
import type { VistaDeLotes, VistaDeVencimientos } from "./modelo-de-lotes";
import estilos from "./PantallaDeLotes.module.css";

export type TextosDeLotes = Readonly<{
  articulo: string;
  vencimientos: string;
  vence: string;
  existencia: string;
  disponible: string;
}>;

/**
 * Los lotes de un artículo (maqueta `stock-lotes.html`, FP-STK-13), solo lectura: el selector de artículos (enlaces, como el de depósitos) y una tarjeta por lote con su código, su vencimiento, la existencia y lo
 * disponible; el «Sin asignar» ya viene al final. Un enlace lleva a «Vencimientos». Sin importes. Los textos llegan resueltos.
 */
export function PantallaDeLotes({
  vista,
  textos,
}: Readonly<{ vista: VistaDeLotes; textos: TextosDeLotes }>) {
  return (
    <div className={estilos["raiz"]}>
      {vista.opciones.length === 0 ? null : (
        <SelectorDeDeposito rotulo={textos.articulo} opciones={vista.opciones} />
      )}
      <a href={vista.hrefDeVencimientos}>{textos.vencimientos}</a>
      <ul className={estilos["lista"]}>
        {vista.filas.map((fila) => (
          <li key={fila.id} className={estilos["tarjeta"]}>
            <strong className={estilos["titulo"]}>{fila.codigo}</strong>
            {fila.vence === null ? null : (
              <span>
                {textos.vence} {fila.vence}
              </span>
            )}
            <span className={estilos["cantidad"]}>
              {textos.existencia} {fila.existencia}
            </span>
            <span className={estilos["cantidad"]}>
              {textos.disponible} {fila.disponible}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * «Vencimientos» (FP-STK-14): lo que vence en el horizonte elegido o ya venció, con su estado («Vencido» o «Vence hoy»; lo que vence más adelante no lleva estado). El horizonte se elige con enlaces. Sin botón de
 * baja: la baja es una Salida con motivo «Vencimiento».
 */
export function PantallaDeVencimientos({
  vista,
  titulo,
  textos,
}: Readonly<{
  vista: VistaDeVencimientos;
  titulo: string;
  textos: Pick<TextosDeLotes, "vence" | "existencia">;
}>) {
  return (
    <div className={estilos["raiz"]}>
      <h2 className={estilos["encabezado"]}>{titulo}</h2>
      <SelectorDeDeposito
        rotulo={titulo}
        opciones={vista.horizontes.map((h) => ({
          id: String(h.dias),
          nombre: h.texto,
          href: h.href,
          actual: h.actual,
        }))}
      />
      <ul className={estilos["lista"]}>
        {vista.filas.map((fila) => (
          <li key={fila.id} className={estilos["tarjeta"]}>
            <strong className={estilos["titulo"]}>{fila.articulo}</strong>
            <span>{fila.codigo}</span>
            <span>
              {textos.vence} {fila.vence}
            </span>
            <span className={estilos["cantidad"]}>
              {textos.existencia} {fila.existencia}
            </span>
            {fila.estado === null ? null : (
              <Insignia tono={fila.vencido ? "peligro" : "aviso"}>{fila.estado}</Insignia>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
