import { EnlaceDeAccion } from "../../../componentes/EnlaceDeAccion";
import { Insignia } from "../../../componentes/Insignia";
import { RUTA_DE_FACTURAS, rutaDeConciliar } from "../rutas-de-compras";
import { AnularConciliacion } from "./AccionesDeLaConciliacion.cliente";
import { TomarElCosto, type PropsDeTomarElCosto } from "./TomarElCosto.cliente";
import {
  armarLaFichaDeFactura,
  type AccionesDeLaFactura,
  type FichaDeFacturaParaLaPantalla,
  type SucursalConNombre,
} from "./modelo-de-facturas";
import type { ResultadoDeLaFactura } from "./resultado-de-factura";
import type { TextosDeFacturas } from "./textos-de-facturas";
import estilos from "../Compras.module.css";

type AccionDeAnular = (
  previo: ResultadoDeLaFactura,
  datos: FormData,
) => Promise<ResultadoDeLaFactura>;

export type PropsDePantallaDeDetalleDeFactura = Readonly<{
  ficha: FichaDeFacturaParaLaPantalla;
  textos: TextosDeFacturas;
  /** Las sucursales de las que la persona ve lo recibido, con su nombre. */
  sucursales: readonly SucursalConNombre[];
  /** Lo que la persona puede hacer; sin decirlo, nada (todo nace cerrado). */
  acciones?: AccionesDeLaFactura;
  /** Por id de conciliación, la acción de anularla ya ligada; sin ella no se dibuja el botón de esa fila. */
  accionesDeAnular?: Readonly<Record<string, AccionDeAnular>>;
  /** `tomarElCostoAccion`: sin ella no se dibuja ningún botón de «Tomar el costo de la factura». */
  tomarElCosto?: PropsDeTomarElCosto["tomar"];
}>;

/**
 * El detalle de una factura de la empresa (Compras 4; maqueta `compra-conciliar.html`, estados «Falta conciliar» y «Conciliada en parte»): el proveedor, la fecha y el estado; por línea lo Facturado, lo
 * Conciliado y lo Recibido en cada sucursal del alcance de quien mira (responde «qué falta recibir» y «qué falta conciliar»); y, con el permiso, las conciliaciones hechas con «Anular conciliación» por fila
 * (gerente y administrador). «Conciliar» lleva a la pantalla de repartir. Los saldos y el estado los entrega el servidor. El `h1` lo pone el armazón. Los botones de anular son el único componente de cliente.
 */
export function PantallaDeDetalleDeFactura({
  ficha,
  textos,
  sucursales,
  acciones,
  accionesDeAnular = {},
  tomarElCosto,
}: PropsDePantallaDeDetalleDeFactura) {
  const f = armarLaFichaDeFactura(ficha, textos, sucursales, acciones);
  return (
    <div className={estilos["cuerpo"]}>
      <EnlaceDeAccion href={RUTA_DE_FACTURAS} variante="secundaria">
        {textos.titulo}
      </EnlaceDeAccion>
      <Insignia tono={f.anulada ? "peligro" : "neutro"}>{f.estado}</Insignia>
      <p className={estilos["suave"]}>{f.proveedorYFecha}</p>
      <p className={estilos["renglon"]}>
        <span className={estilos["suave"]}>{f.total.rotulo}</span>
        <span>{f.total.valor}</span>
      </p>
      <ul className={estilos["lista"]}>
        {f.lineas.map((l) => (
          <li key={l.clave} className={estilos["tarjeta"]}>
            <span className={estilos["titulo"]}>{l.nombre}</span>
            <p className={estilos["renglon"]}>
              <span className={estilos["suave"]}>{l.facturado.rotulo}</span>
              <span>{l.facturado.valor}</span>
            </p>
            <p className={estilos["renglon"]}>
              <span className={estilos["suave"]}>{l.conciliado.rotulo}</span>
              <span>{l.conciliado.valor}</span>
            </p>
            <p className={estilos["suave"]}>{l.recibido.rotulo}</p>
            <ul className={estilos["lista"]}>
              {l.recibido.porSucursal.map((r) => (
                <li key={r.clave} className={estilos["linea"]}>
                  {r.texto}
                </li>
              ))}
            </ul>
            {l.costos.length === 0 ? null : (
              <ul className={estilos["lista"]}>
                {l.costos.map((k) => (
                  <li key={k.clave} className={estilos["linea"]}>
                    <span className={estilos["detalle"]}>{k.tomado ?? k.titulo}</span>
                    {k.sePuedeTomar && tomarElCosto !== undefined ? (
                      <TomarElCosto
                        comprobanteId={ficha.comprobanteId}
                        recepcionId={k.recepcionId}
                        linea={k.linea}
                        hoja={k.hoja}
                        tomar={tomarElCosto}
                        // Solo los textos que usa: a un componente de cliente no puede pasarse una función.
                        textos={{
                          tomarElCosto: textos.tomarElCosto,
                          cancelar: textos.cancelar,
                          cerrar: textos.cerrar,
                          enviando: textos.enviando,
                          reintentar: textos.reintentar,
                        }}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {f.notas === null ? null : (
        <EnlaceDeAccion href={f.notas.href} variante="secundaria">
          {f.notas.texto}
        </EnlaceDeAccion>
      )}
      {f.reemplazar === null ? null : (
        <EnlaceDeAccion href={f.reemplazar.href} variante="secundaria">
          {f.reemplazar.texto}
        </EnlaceDeAccion>
      )}
      {f.conciliar ? (
        <EnlaceDeAccion href={rutaDeConciliar(ficha.comprobanteId)}>
          {textos.conciliar}
        </EnlaceDeAccion>
      ) : null}
      {f.conciliaciones === null || f.conciliaciones.filas.length === 0 ? null : (
        <section className={estilos["seccion"]} aria-label={f.conciliaciones.titulo}>
          <h2 className={estilos["titulo"]}>{f.conciliaciones.titulo}</h2>
          <ul className={estilos["lista"]}>
            {f.conciliaciones.filas.map((c) => {
              const accion = accionesDeAnular[c.id];
              return (
                <li key={c.id} className={estilos["linea"]}>
                  <span className={estilos["detalle"]}>{c.texto}</span>
                  {c.anulable && accion !== undefined ? (
                    <AnularConciliacion
                      accion={accion}
                      // Solo los textos que usa: a un componente de cliente no puede pasarse una función.
                      textos={{
                        anularConciliacion: textos.anularConciliacion,
                        anular: textos.anular,
                        cancelar: textos.cancelar,
                        cerrar: textos.cerrar,
                      }}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
