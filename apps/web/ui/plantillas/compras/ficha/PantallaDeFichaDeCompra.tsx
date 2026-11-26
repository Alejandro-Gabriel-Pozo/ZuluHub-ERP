import { EnlaceDeAccion } from "../../../componentes/EnlaceDeAccion";
import { Insignia } from "../../../componentes/Insignia";
import { HojaDeAnularCompra } from "../correccion/HojaDeAnularCompra.cliente";
import type { ResultadoDeAnular } from "../correccion/resultado-de-correccion";
import { HojaDeAnularPago } from "../pago/HojaDeAnularPago.cliente";
import type { ResultadoDeAnularPago } from "../pago/resultado-de-pago";
import type { TextosDeCompras } from "../textos-de-compras";
import {
  armarLaFicha,
  type AccionesDeLaCompraParaLaPantalla,
  type FichaDeCompraParaLaPantalla,
} from "./modelo-de-ficha-de-compra";
import estilos from "../Compras.module.css";

export type PropsDePantallaDeFichaDeCompra = Readonly<{
  ficha: FichaDeCompraParaLaPantalla;
  textos: TextosDeCompras;
  /** Lo que la persona puede hacer; sin decirlo, nada (todo nace cerrado). */
  acciones?: AccionesDeLaCompraParaLaPantalla;
  /** `anularCompraAccion` con la compra ya ligada; sin ella no se dibuja «Anular». */
  accionDeAnular?: (previo: ResultadoDeAnular, datos: FormData) => Promise<ResultadoDeAnular>;
  /** `anularElPagoAccion` con la compra ya ligada; recibe el pago a anular y devuelve la acción con los dos ligados. Sin ella no se dibuja «Anular» del pago. */
  accionDeAnularPago?: (
    pagoId: string,
  ) => (previo: ResultadoDeAnularPago, datos: FormData) => Promise<ResultadoDeAnularPago>;
}>;

/**
 * La ficha de una compra (maqueta `compra-corregir-anular.html`, `vFicha`, sin «Corregir», «Anular», el pago ni «Corregido por…»; Compras PR 3): proveedor y fecha, el remito, cada línea con
 * lo que entra a tu stock y su costo por unidad de stock, el total y la factura si la hay; si está anulada, el motivo, quién y cuándo. SOLO LECTURA: ningún botón de acción, solo «Volver».
 * Sin estado ni hooks: es una página de servidor. «Anulada» se dice con texto, no solo con color. El `h1` («Compra 5») lo pone el armazón.
 */
export function PantallaDeFichaDeCompra({
  ficha,
  textos,
  acciones,
  accionDeAnular,
  accionDeAnularPago,
}: PropsDePantallaDeFichaDeCompra) {
  const f = armarLaFicha(ficha, textos, acciones);
  return (
    <div className={estilos["cuerpo"]}>
      <EnlaceDeAccion href={f.volver.href} variante="secundaria">
        {f.volver.texto}
      </EnlaceDeAccion>
      {f.anulada === null ? null : <Insignia tono="peligro">{f.anulada}</Insignia>}
      <p className={estilos["suave"]}>{f.proveedorYFecha}</p>
      {f.anulacion === null ? null : (
        <section className={estilos["tarjeta"]}>
          <p className={estilos["renglon"]}>
            <span className={estilos["suave"]}>{f.anulacion.rotulo}</span>
            <span>{f.anulacion.motivo}</span>
          </p>
          {f.anulacion.quien === null ? null : (
            <p className={estilos["suave"]}>{f.anulacion.quien}</p>
          )}
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
            <span className={estilos["importe"]}>{l.importe}</span>
            <span className={estilos["detalle"]}>{l.cantidad}</span>
            {l.costo === null ? null : <span className={estilos["detalle"]}>{l.costo}</span>}
            {l.correcciones.map((c) => (
              <span key={c.clave} className={estilos["detalle"]}>
                {[c.quien, c.antes, c.motivo].filter((x): x is string => x !== null).join(" · ")}
              </span>
            ))}
            {l.corregir === null ? null : (
              <EnlaceDeAccion href={l.corregir} variante="secundaria">
                {textos.corregir}
              </EnlaceDeAccion>
            )}
          </li>
        ))}
      </ul>
      <p className={estilos["total"]}>
        <span>{f.total.rotulo}</span>
        <span className={estilos["importe"]}>{f.total.valor}</span>
      </p>
      {f.factura === null ? null : (
        <section className={estilos["tarjeta"]}>
          <h3 className={estilos["seccion"]}>{f.factura.titulo}</h3>
          {f.factura.fechas === null ? null : (
            <p className={estilos["suave"]}>{f.factura.fechas}</p>
          )}
          <p className={estilos["total"]}>
            <span>{f.factura.rotuloDelTotal}</span>
            <span className={estilos["importe"]}>{f.factura.total}</span>
          </p>
        </section>
      )}
      {f.pagos.length === 0 ? null : (
        <section className={estilos["tarjeta"]}>
          {f.pagos.map((p) => (
            <div key={p.clave}>
              <p className={estilos["renglon"]}>
                <span>{p.titulo}</span>
                <span className={estilos["importe"]}>{p.importe}</span>
              </p>
              {p.quien === null ? null : <p className={estilos["suave"]}>{p.quien}</p>}
              {p.anulado === null ? null : (
                <>
                  <Insignia tono="peligro">{p.anulado.rotulo}</Insignia>
                  {p.anulado.motivo === null ? null : (
                    <p className={estilos["suave"]}>{p.anulado.motivo}</p>
                  )}
                  {p.anulado.quien === null ? null : (
                    <p className={estilos["suave"]}>{p.anulado.quien}</p>
                  )}
                </>
              )}
            </div>
          ))}
          {f.anularPagoId !== null && accionDeAnularPago !== undefined ? (
            <HojaDeAnularPago
              accion={accionDeAnularPago(f.anularPagoId)}
              textos={{
                anular: textos.anular,
                motivo: textos.motivo,
                cancelar: textos.cancelar,
                cerrar: textos.cerrar,
              }}
            />
          ) : null}
        </section>
      )}
      {f.saldadaPorNotas === null ? null : <Insignia tono="neutro">{f.saldadaPorNotas}</Insignia>}
      {f.notas === null ? null : (
        <EnlaceDeAccion href={f.notas.href} variante="secundaria">
          {f.notas.texto}
        </EnlaceDeAccion>
      )}
      {f.cambiarElComprobante === null ? null : (
        <EnlaceDeAccion href={f.cambiarElComprobante.href} variante="secundaria">
          {f.cambiarElComprobante.texto}
        </EnlaceDeAccion>
      )}
      {f.declararPago === null ? null : (
        <EnlaceDeAccion href={f.declararPago.href} variante="primaria">
          {f.declararPago.texto}
        </EnlaceDeAccion>
      )}
      {f.quien === null ? null : <p className={estilos["suave"]}>{f.quien}</p>}
      {f.anular && accionDeAnular !== undefined ? (
        <HojaDeAnularCompra
          accion={accionDeAnular}
          corregirLaPrimera={f.corregirLaPrimera}
          // Solo los textos que usa la hoja: a un componente de cliente no puede pasarse una función (los `textos` completos traen `corregidoPor`).
          textos={{
            anular: textos.anular,
            motivo: textos.motivo,
            cancelar: textos.cancelar,
            cerrar: textos.cerrar,
            corregir: textos.corregir,
          }}
        />
      ) : null}
    </div>
  );
}
