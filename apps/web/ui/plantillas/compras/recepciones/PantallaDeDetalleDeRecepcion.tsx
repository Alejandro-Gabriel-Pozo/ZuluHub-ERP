import { EnlaceDeAccion } from "../../../componentes/EnlaceDeAccion";
import { Insignia } from "../../../componentes/Insignia";
import { RUTA_DE_RECEPCIONES } from "../rutas-de-compras";
import { AccionesDeLaRecepcion } from "./AccionesDeLaRecepcion.cliente";
import {
  armarLaFichaDeRecepcion,
  type AccionesDeLaRecepcion as PermisosDeLaRecepcion,
  type FichaDeRecepcionParaLaPantalla,
} from "./modelo-de-recepciones";
import type { ResultadoDeLaRecepcion } from "./resultado-de-recepcion";
import type { TextosDeRecepciones } from "./textos-de-recepciones";
import estilos from "../Compras.module.css";

type AccionDeLaRecepcion = (
  previo: ResultadoDeLaRecepcion,
  datos: FormData,
) => Promise<ResultadoDeLaRecepcion>;

export type PropsDePantallaDeDetalleDeRecepcion = Readonly<{
  ficha: FichaDeRecepcionParaLaPantalla;
  textos: TextosDeRecepciones;
  /** Lo que la persona puede hacer; sin decirlo, nada (todo nace cerrado). */
  acciones?: PermisosDeLaRecepcion;
  /** Las acciones con la recepción ya ligada; sin ellas no se dibujan los botones. */
  accionDeConfirmar?: AccionDeLaRecepcion;
  accionDeAnular?: AccionDeLaRecepcion;
  /** Los depósitos entre los que hay que elegir (solo si hay más de uno). */
  depositos?: readonly Readonly<{ id: string; nombre: string }>[];
}>;

/**
 * El detalle de una recepción (Compras 4; maqueta `compra-recibir.html`, estados «Por confirmar» y «Confirmada»): el proveedor y la fecha, el estado en texto, el remito, las líneas con lo recibido
 * (sin precios ni costos) y, si está anulada, el motivo. «Confirmar recepción» y «Anular recepción» solo con la recepción «Por confirmar» y el permiso (gerente y administrador). El `h1` («Recepción 14») lo pone el armazón.
 * Sin estado propio: es una página de servidor; los botones son el único componente de cliente.
 */
export function PantallaDeDetalleDeRecepcion({
  ficha,
  textos,
  acciones,
  accionDeConfirmar,
  accionDeAnular,
  depositos = [],
}: PropsDePantallaDeDetalleDeRecepcion) {
  const f = armarLaFichaDeRecepcion(ficha, textos, acciones);
  return (
    <div className={estilos["cuerpo"]}>
      <EnlaceDeAccion href={RUTA_DE_RECEPCIONES} variante="secundaria">
        {textos.titulo}
      </EnlaceDeAccion>
      <Insignia tono={f.anulada ? "peligro" : "neutro"}>{f.estado}</Insignia>
      <p className={estilos["suave"]}>{f.proveedorYFecha}</p>
      {f.motivoDeAnulacion === null ? null : (
        <section className={estilos["tarjeta"]}>
          <p className={estilos["renglon"]}>
            <span className={estilos["suave"]}>{f.motivoDeAnulacion.rotulo}</span>
            <span>{f.motivoDeAnulacion.texto}</span>
          </p>
        </section>
      )}
      <p className={estilos["renglon"]}>
        <span className={estilos["suave"]}>{f.remito.rotulo}</span>
        {f.remito.valor === "" ? null : <span>{f.remito.valor}</span>}
      </p>
      <ul className={estilos["lista"]}>
        {f.lineas.map((l) => (
          <li key={l.clave} className={estilos["linea"]}>
            <span className={estilos["titulo"]}>{l.nombre}</span>
            <span className={estilos["detalle"]}>{l.cantidad}</span>
          </li>
        ))}
      </ul>
      {(f.confirmar || f.anular) &&
      accionDeConfirmar !== undefined &&
      accionDeAnular !== undefined ? (
        <AccionesDeLaRecepcion
          puedeConfirmar={f.confirmar}
          puedeAnular={f.anular}
          accionDeConfirmar={accionDeConfirmar}
          accionDeAnular={accionDeAnular}
          depositos={depositos}
          // Solo los textos que usa: a un componente de cliente no puede pasarse una función.
          textos={{
            confirmar: textos.confirmar,
            anularRecepcion: textos.anularRecepcion,
            anular: textos.anular,
            motivo: textos.motivo,
            cancelar: textos.cancelar,
            cerrar: textos.cerrar,
            deposito: textos.deposito,
            sinElegir: textos.sinElegir,
          }}
        />
      ) : null}
    </div>
  );
}
