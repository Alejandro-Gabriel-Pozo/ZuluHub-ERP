import { Insignia } from "../../componentes/Insignia";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import { DireccionDeLaCarta } from "./DireccionDeLaCarta.cliente";
import { FormularioDeCartaEnLinea } from "./FormularioDeCartaEnLinea.cliente";
import { FormularioDeEstadoDeCarta } from "./FormularioDeEstadoDeCarta.cliente";
import estilos from "./PantallaDeCartaEnLinea.module.css";
import type { CartaEnLineaArmada } from "./modelo-de-carta-en-linea";

export type PropsDePantallaDeCartaEnLinea = Readonly<{
  carta: CartaEnLineaArmada;
  /** Guardar los textos, ya ligada a la carta, la sucursal y la versión que se vio. */
  accionDeGuardar: AccionDeFormulario;
  /** Poner en línea / sacar de línea, ya ligada a la carta, la sucursal, la versión y el estado que pide; `null` sin carta. */
  accionDeEstado: AccionDeFormulario | null;
}>;

/**
 * «Carta en línea» (C1; maqueta `carta-en-linea.html`): el estado y su botón, los textos, la dirección pública con su QR y cuántos productos salen, con los motivos de los que no. Sin textos propios:
 * todos llegan resueltos. El `h1` lo pone el armazón.
 */
export function PantallaDeCartaEnLinea({
  carta,
  accionDeGuardar,
  accionDeEstado,
}: PropsDePantallaDeCartaEnLinea) {
  return (
    <div className={estilos["raiz"]}>
      {carta.estado === null || carta.alternar === null || accionDeEstado === null ? null : (
        <Pila separacion={3}>
          <Insignia tono={carta.estado.enLinea ? "exito" : "neutro"}>{carta.estado.texto}</Insignia>
          <FormularioDeEstadoDeCarta
            texto={carta.alternar.texto}
            accion={accionDeEstado}
            apagado={carta.alternar.apagado}
          />
        </Pila>
      )}
      <FormularioDeCartaEnLinea formulario={carta.formulario} accion={accionDeGuardar} />
      {carta.direccion === null ? null : <DireccionDeLaCarta direccion={carta.direccion} />}
      <Pila separacion={2}>
        <p className={estilos["contador"]}>{carta.contador}</p>
        <ul className={estilos["motivos"]}>
          {carta.motivos.map((m) => (
            <li key={m.texto}>
              {m.texto} · {m.cantidad}
            </li>
          ))}
        </ul>
      </Pila>
    </div>
  );
}
