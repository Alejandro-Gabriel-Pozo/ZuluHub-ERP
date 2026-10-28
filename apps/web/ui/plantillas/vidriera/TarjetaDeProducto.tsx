import type { TextosDeVidriera } from "../../../../../src/capacidades/experiencia/vidriera/textos";
import type { VistaDeProducto } from "../../../../../src/capacidades/experiencia/vidriera/vista";
import { Boton } from "../../componentes/Boton";
import { Superposicion } from "../../patrones/Superposicion";
import { Compartir } from "./Compartir.cliente";
import { DetalleDeProducto, idDelPrecioDe } from "./DetalleDeProducto";
import estilos from "./TarjetaDeProducto.module.css";

export type PropsDeTarjetaDeProducto = Readonly<{
  /** El producto abierto, o `null` si la tarjeta está cerrada. */
  producto: VistaDeProducto | null;
  textos: TextosDeVidriera;
  alCerrar: () => void;
}>;

/**
 * La tarjeta de producto (§3.1 y §3.2): una `Superposicion` con el propósito `vistazo` (hoja inferior en el
 * celular) con el detalle del producto, «Compartir» y «Volver a la carta» al pie, al alcance del pulgar.
 * Cerrar (el botón de arriba, «Volver», Escape, tocar el fondo o «Atrás») devuelve el foco al ítem.
 */
export function TarjetaDeProducto({ producto, textos, alCerrar }: PropsDeTarjetaDeProducto) {
  return (
    <Superposicion
      abierta={producto !== null}
      titulo={producto?.nombre ?? ""}
      proposito="vistazo"
      cerrable
      etiquetaDeCerrar={textos.cerrar}
      alCerrar={alCerrar}
      {...(producto === null ? {} : { idDeLaDescripcion: idDelPrecioDe(producto) })}
    >
      {producto === null ? null : (
        <>
          <DetalleDeProducto producto={producto} textos={textos} nivelDeTitulos={3} />
          <div className={estilos["acciones"]}>
            <Compartir enlace={producto.href} titulo={producto.nombre} textos={textos} />
            <Boton ancho="completo" alTocar={alCerrar}>
              {textos.volver}
            </Boton>
          </div>
        </>
      )}
    </Superposicion>
  );
}
