import { Aviso } from "../../componentes/Aviso";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { Texto } from "../../primitivas/Texto";
import type { RecetaArmada } from "./modelo-de-receta";
import estilos from "./PantallaDeUnaReceta.module.css";

export type PropsDePantallaDeUnaReceta = Readonly<{ receta: RecetaArmada }>;

/**
 * La ficha de una receta (maqueta `receta.html`, 15/11/2026), solo lectura: «Versión N · vigente», «Rinde» y «Costo de la comida» (si la consulta lo trajo), los ingredientes con su clase,
 * bruto, merma y neto (y el costo de la línea si lo trajo), los pasos y el enlace a la ficha de cocina. Un producto sin receta dice «Este producto no tiene receta». «Editar» (o «Nueva receta» si no tiene) solo si el modelo lo ofrece. Sin textos propios: todos llegan resueltos. El `h1` (el nombre del producto) lo pone el armazón.
 */
export function PantallaDeUnaReceta({ receta }: PropsDePantallaDeUnaReceta) {
  if (receta.sinReceta !== null) {
    return (
      <div className={estilos["raiz"]}>
        <Aviso tono="info">{receta.sinReceta}</Aviso>
        {receta.editar === null ? null : (
          <div className={estilos["acciones"]}>
            <EnlaceDeAccion href={receta.editar.href}>{receta.editar.texto}</EnlaceDeAccion>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={estilos["raiz"]}>
      {receta.version === null ? null : <Texto>{receta.version}</Texto>}
      <div className={estilos["resumen"]}>
        {receta.datos.map((dato) => (
          <div key={dato.rotulo} className={estilos["renglon"]}>
            <span className={dato.fuerte ? estilos["fuerte"] : estilos["rotulo"]}>
              {dato.rotulo}
            </span>
            <span
              className={`${estilos["valor"] ?? ""} ${dato.fuerte ? (estilos["fuerte"] ?? "") : ""}`}
            >
              {dato.valor}
            </span>
          </div>
        ))}
      </div>
      {receta.ingredientes === null ? null : (
        <>
          <Texto como="h2" variante="subtitulo">
            {receta.ingredientes.titulo}
          </Texto>
          <ul className={estilos["lista"]}>
            {receta.ingredientes.filas.map((fila) => (
              <li key={fila.clave} className={estilos["linea"]}>
                <span className={estilos["renglon"]}>
                  <span className={estilos["nombre"]}>{fila.nombre}</span>
                  {fila.costo === null ? null : (
                    <span className={`${estilos["valor"] ?? ""} ${estilos["fuerte"] ?? ""}`}>
                      {fila.costo}
                    </span>
                  )}
                </span>
                <span className={estilos["detalle"]}>{fila.detalle}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {receta.pasos === null ? null : (
        <>
          <Texto como="h2" variante="subtitulo">
            {receta.pasos.titulo}
          </Texto>
          <p className={estilos["pasos"]}>{receta.pasos.texto}</p>
        </>
      )}
      {receta.cocina === null && receta.editar === null ? null : (
        <div className={estilos["acciones"]}>
          {receta.editar === null ? null : (
            <EnlaceDeAccion href={receta.editar.href}>{receta.editar.texto}</EnlaceDeAccion>
          )}
          {receta.cocina === null ? null : (
            <EnlaceDeAccion href={receta.cocina.href} variante="secundaria">
              {receta.cocina.texto}
            </EnlaceDeAccion>
          )}
        </div>
      )}
    </div>
  );
}
