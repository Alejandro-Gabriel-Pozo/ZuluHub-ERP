import type { ReactNode } from "react";
import { Aviso } from "../../componentes/Aviso";
import { Insignia } from "../../componentes/Insignia";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Texto } from "../../primitivas/Texto";
import { HojaDeMotivo } from "./HojaDeMotivo.cliente";
import type { OrdenArmada } from "./modelo-de-orden";
import estilos from "./PantallaDeLaOrden.module.css";

export type PropsDePantallaDeLaOrden = Readonly<{
  orden: OrdenArmada;
  /** Las acciones del servidor ya ligadas a la orden (`bind`); solo se usa la de la acción que el modelo ofrece. */
  cancelar: AccionDeFormulario;
  anular: AccionDeFormulario;
}>;

/**
 * La ficha de una orden de producción (maqueta `produccion.html`, 09/11/2026), solo lo de este tramo: el producto con su cantidad y el estado, el aviso de receta cambiada, el lote, el
 * vencimiento y el costo por unidad (si hay), «Consume» con sus renglones y, al pie, «Cancelar la orden» (orden abierta) o «Anular la orden» (orden cerrada) con la hoja de motivo,
 * solo si el modelo las ofrece. Sin textos propios: todos llegan resueltos. El `h1` («Orden N») lo pone el armazón.
 */
export function PantallaDeLaOrden({ orden, cancelar, anular }: PropsDePantallaDeLaOrden) {
  const { accion } = orden;
  let hoja: ReactNode = null;
  if (accion !== null) {
    hoja = (
      <HojaDeMotivo
        accion={accion.tipo === "CANCELAR" ? cancelar : anular}
        boton={accion.boton}
        titulo={accion.titulo}
        textos={{
          motivo: accion.motivo,
          cancelar: accion.cancelar,
          cerrar: accion.cerrar,
          explicacion: accion.explicacion,
          sinConexion: accion.sinConexion,
        }}
      />
    );
  }
  return (
    <div className={estilos["raiz"]}>
      <div className={estilos["resumen"]}>
        <div className={estilos["renglon"]}>
          <span className={estilos["nombre"]}>{orden.producto.nombre}</span>
          <span className={estilos["cantidad"]}>{orden.producto.cantidad}</span>
        </div>
        <div>
          <Insignia tono={orden.estado.tono}>{orden.estado.texto}</Insignia>
        </div>
        {orden.datos.map((dato) => (
          <div key={dato.rotulo} className={estilos["renglon"]}>
            <span className={estilos["rotulo"]}>{dato.rotulo}</span>
            <span className={estilos["cantidad"]}>{dato.valor}</span>
          </div>
        ))}
      </div>
      {orden.avisoDeAnulada === null ? null : <Aviso tono="info">{orden.avisoDeAnulada}</Aviso>}
      {orden.avisoDeReceta === null ? null : <Aviso tono="aviso">{orden.avisoDeReceta}</Aviso>}
      <Texto como="h2" variante="subtitulo">
        {orden.consume.titulo}
      </Texto>
      <ul className={estilos["lista"]}>
        {orden.consume.filas.map((fila, indice) => (
          // Un insumo no se repite en una orden (el servidor lo garantiza), pero el nombre no es una clave de confianza: el índice la completa.
          <li key={`${String(indice)}-${fila.nombre}`} className={estilos["linea"]}>
            <span className={estilos["renglon"]}>
              <span className={estilos["nombre"]}>{fila.nombre}</span>
              <span className={estilos["cantidad"]}>{fila.cantidad}</span>
            </span>
          </li>
        ))}
      </ul>
      {hoja === null ? null : <div className={estilos["acciones"]}>{hoja}</div>}
    </div>
  );
}
