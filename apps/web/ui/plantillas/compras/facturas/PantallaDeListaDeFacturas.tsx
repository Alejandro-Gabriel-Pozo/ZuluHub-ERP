import { EnlaceDeAccion } from "../../../componentes/EnlaceDeAccion";
import { RUTA_DE_CARGAR_FACTURA } from "../rutas-de-compras";
import { armarLaListaDeFacturas, type ListaDeFacturasParaLaPantalla } from "./modelo-de-facturas";
import type { TextosDeFacturas } from "./textos-de-facturas";
import estilos from "../Compras.module.css";

export type PropsDePantallaDeListaDeFacturas = Readonly<{
  lista: ListaDeFacturasParaLaPantalla;
  textos: TextosDeFacturas;
  /** La persona puede cargar una factura (`comprobantes_de_proveedor.registrar`): sin permiso no hay enlace. Solo ayuda: la pantalla de destino y su acción vuelven a pedir el permiso. */
  puedeCargar?: boolean;
}>;

/**
 * «Facturas» (Compras 4; maqueta `compra-conciliar.html`, estado `lista`): una factura de la empresa por fila (tipo, número y proveedor; estado, fecha y total) y «Página siguiente». Sin filtros en la primera versión
 * (decisión del dueño, 25/11/2026, pregunta 8). SOLO LECTURA salvo el enlace «Cargar factura». Cada fila es un enlace al detalle con su nombre accesible completo. Sin estado ni hooks: es una página de servidor.
 * El `h1` lo pone el armazón.
 */
export function PantallaDeListaDeFacturas({
  lista,
  textos,
  puedeCargar = false,
}: PropsDePantallaDeListaDeFacturas) {
  const armada = armarLaListaDeFacturas(lista, textos);
  return (
    <div className={estilos["cuerpo"]}>
      {puedeCargar ? (
        <EnlaceDeAccion href={RUTA_DE_CARGAR_FACTURA}>{textos.cargarFactura}</EnlaceDeAccion>
      ) : null}
      {armada.vacio === null ? (
        <ul className={estilos["lista"]}>
          {armada.filas.map((fila) => (
            <li key={fila.id}>
              <a className={estilos["fila"]} href={fila.href} aria-label={fila.nombreAccesible}>
                <span className={estilos["titulo"]}>{fila.titulo}</span>{" "}
                <span className={estilos["segunda"]}>{fila.segunda}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className={estilos["suave"]}>{armada.vacio}</p>
      )}
      {armada.paginaSiguiente === null ? null : (
        <EnlaceDeAccion href={armada.paginaSiguiente.href} variante="secundaria">
          {armada.paginaSiguiente.texto}
        </EnlaceDeAccion>
      )}
    </div>
  );
}
