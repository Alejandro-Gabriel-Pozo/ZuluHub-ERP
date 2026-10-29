import type { DiccionarioResuelto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Aviso } from "../../componentes/Aviso";
import { Boton } from "../../componentes/Boton";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { Insignia } from "../../componentes/Insignia";
import estilos from "./PantallaDeDetalleDeComprobante.module.css";
import type { AccionDeAnularDelDetalle } from "./modelo-de-anulacion";
import { armarElDetalle, type DetalleParaMostrar } from "./modelo-del-detalle";

export type PropsDePantallaDeDetalleDeComprobante = Readonly<{
  detalle: DetalleParaMostrar;
  diccionario?: DiccionarioResuelto;
  /**
   * «Anular con nota de crédito», o `null`/ausente si no se ofrece. Lo decide la página con `accionDeAnularDelDetalle` (permiso, módulo
   * activo y comprobante autorizado): la pantalla solo la pinta.
   */
  anular?: AccionDeAnularDelDetalle | null;
}>;

/**
 * El detalle de un comprobante (contrato de la pantalla 2): una columna, solo lectura, con una única acción: «Anular con nota de
 * crédito» cuando la página la ofrece (`anular`). Todo texto sale del modelo (`modelo-del-detalle.ts`), que ya lo resolvió del catálogo.
 */
export function PantallaDeDetalleDeComprobante({
  detalle,
  diccionario = {},
  anular = null,
}: PropsDePantallaDeDetalleDeComprobante) {
  const m = armarElDetalle(detalle, diccionario);
  return (
    <article className={estilos["raiz"]}>
      <header className={estilos["cabecera"]}>
        <div className={estilos["estados"]}>
          <Insignia tono={m.estado.tono}>{m.estado.texto}</Insignia>
          {m.anulacion === null ? null : <Insignia tono="aviso">{m.anulacion}</Insignia>}
        </div>
        {m.corresponde === null ? null : <p className={estilos["texto"]}>{m.corresponde}</p>}
      </header>

      {m.aviso === null ? null : (
        <Aviso tono={m.aviso.tono} {...(m.aviso.titulo === null ? {} : { titulo: m.aviso.titulo })}>
          {/* Dos códigos de ARCA pueden traducirse al mismo texto: el índice evita la clave repetida. */}
          {m.aviso.lineas.map((linea, i) => (
            <p key={`${i}-${linea}`} className={estilos["texto"]}>
              {linea}
            </p>
          ))}
        </Aviso>
      )}

      <dl className={estilos["datos"]}>
        {m.datos.map((fila) => (
          <div key={fila.rotulo} className={estilos["dato"]}>
            <dt className={estilos["rotulo"]}>{fila.rotulo}</dt>
            <dd className={estilos["valor"]}>
              {fila.valor}
              {fila.secundario === null ? null : (
                <span className={estilos["secundario"]}>{fila.secundario}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="renglones">
        <h2 id="renglones" className={estilos["seccion"]}>
          {m.rotuloDeRenglones}
        </h2>
        <ul className={estilos["lista"]}>
          {m.renglones.map((r, i) => (
            <li key={i} className={estilos["renglon"]}>
              <span className={estilos["descripcion"]}>{r.descripcion}</span>
              <span className={estilos["cuenta"]}>
                {r.cuenta}
                {r.iva === null ? null : ` · ${r.iva}`}
              </span>
              <span className={estilos["importe"]}>{r.importe}</span>
            </li>
          ))}
        </ul>
        <p className={estilos["total"]}>
          <span>{m.rotuloDelTotal}</span>
          <span>{m.total}</span>
        </p>
      </section>

      {m.anulado === null ? null : (
        <section aria-labelledby="anulado" className={estilos["anulado"]}>
          <h2 id="anulado" className={estilos["seccion"]}>
            {m.anulado.titulo}
          </h2>
          {m.anulado.cifra === null ? null : (
            <p className={estilos["importe"]}>{m.anulado.cifra}</p>
          )}
          {m.anulado.sinNotas === null ? (
            <ul className={estilos["lista"]}>
              {m.anulado.notas.map((n) => (
                <li key={n.id} className={estilos["nota"]}>
                  <span className={estilos["descripcion"]}>{n.nombre}</span>
                  <span className={estilos["importe"]}>{n.total}</span>
                  <Insignia tono={n.estado.tono}>{n.estado.texto}</Insignia>
                </li>
              ))}
            </ul>
          ) : (
            <p className={estilos["texto"]}>{m.anulado.sinNotas}</p>
          )}
        </section>
      )}

      {anular === null ? null : (
        <div className={estilos["acciones"]}>
          {anular.href === null ? (
            // Apagado con su motivo visible y asociado (`aria-describedby`), como el botón sin conexión.
            <Boton deshabilitado motivo={anular.motivo ?? undefined}>
              {anular.etiqueta}
            </Boton>
          ) : (
            <EnlaceDeAccion href={anular.href}>{anular.etiqueta}</EnlaceDeAccion>
          )}
        </div>
      )}
    </article>
  );
}
