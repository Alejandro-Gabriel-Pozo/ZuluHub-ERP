import { EnlaceDeAccion } from "../../../componentes/EnlaceDeAccion";
import type { TextosDeCompras } from "../textos-de-compras";
import { direccionDeExportar, RUTA_DE_COMPRAS, RUTA_DE_NUEVA_COMPRA } from "../rutas-de-compras";
import { FormularioDeFiltrosDeCompras } from "./FormularioDeFiltrosDeCompras.cliente";
import { armarLaLista, type ListaDeComprasParaLaPantalla } from "./modelo-de-lista-de-compras";
import estilos from "../Compras.module.css";

export type PropsDePantallaDeListaDeCompras = Readonly<{
  lista: ListaDeComprasParaLaPantalla;
  textos: TextosDeCompras;
  /** La persona puede registrar compras (`recepciones.registrar`): sin permiso no hay enlace. Solo ayuda: la pantalla de destino y su acción vuelven a pedir el permiso. */
  puedeCargarUnaCompra?: boolean;
  /** La persona puede exportar (`compras.exportar` y `costos.ver`): sin permiso no hay enlace. Solo ayuda: la descarga vuelve a pedir todos los permisos en el servidor. */
  puedeExportar?: boolean;
}>;

/**
 * «Compras» (maqueta `compra-corregir-anular.html`, `vLista`; Compras PR 3): los filtros, una compra por fila (número, proveedor, el nombre de la factura o «Recibida sin facturar» y el total o
 * «Sin precio») y «Página siguiente». SOLO LECTURA: ningún botón de acción. Cada fila es un enlace a la ficha con su nombre accesible completo. Lista vacía: «Sin resultados» y «Ver todas».
 * Sin estado ni hooks propios: es una página de servidor (el formulario de filtros es el único componente de cliente). El `h1` lo pone el armazón.
 */
export function PantallaDeListaDeCompras({
  lista,
  textos,
  puedeCargarUnaCompra = false,
  puedeExportar = false,
}: PropsDePantallaDeListaDeCompras) {
  const armada = armarLaLista(lista, textos);
  // Sin permiso, o sin el período completo aplicado, no hay enlace (el estado del control dice el motivo; no se suma ningún texto).
  const direccionDeLaExportacion = puedeExportar ? direccionDeExportar(armada.filtro) : null;
  return (
    <div className={estilos["cuerpo"]}>
      {puedeCargarUnaCompra ? (
        <EnlaceDeAccion href={RUTA_DE_NUEVA_COMPRA}>{textos.nuevaCompra}</EnlaceDeAccion>
      ) : null}
      {direccionDeLaExportacion === null ? null : (
        <EnlaceDeAccion href={direccionDeLaExportacion} variante="secundaria">
          {textos.exportar}
        </EnlaceDeAccion>
      )}
      <FormularioDeFiltrosDeCompras
        key={`${armada.filtro.estado}|${armada.filtro.desde ?? ""}|${armada.filtro.hasta ?? ""}`}
        accion={RUTA_DE_COMPRAS}
        filtro={armada.filtro}
        estados={armada.estados}
        textos={{ desde: textos.desde, hasta: textos.hasta, aplicar: textos.aplicarFiltros }}
      />
      {armada.vacio === null ? (
        <ul className={estilos["lista"]}>
          {armada.filas.map((fila) => (
            <li key={fila.id}>
              <a className={estilos["fila"]} href={fila.href} aria-label={fila.nombreAccesible}>
                <span className={estilos["titulo"]}>{fila.titulo}</span>{" "}
                <span className={estilos["segunda"]}>{fila.segunda}</span>{" "}
                <span className={estilos["importe"]}>{fila.total}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className={estilos["vacio"]}>
          <p className={estilos["suave"]}>{armada.vacio.texto}</p>
          <EnlaceDeAccion href={armada.vacio.verTodas.href} variante="secundaria">
            {armada.vacio.verTodas.texto}
          </EnlaceDeAccion>
        </div>
      )}
      {armada.paginaSiguiente === null ? null : (
        <EnlaceDeAccion href={armada.paginaSiguiente.href} variante="secundaria">
          {armada.paginaSiguiente.texto}
        </EnlaceDeAccion>
      )}
    </div>
  );
}
