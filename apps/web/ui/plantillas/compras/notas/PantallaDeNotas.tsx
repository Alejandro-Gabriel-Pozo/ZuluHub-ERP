import { EnlaceDeAccion } from "../../../componentes/EnlaceDeAccion";
import { Insignia } from "../../../componentes/Insignia";
import { HojaDeAnularPago } from "../pago/HojaDeAnularPago.cliente";
import type { ResultadoDeAnularPago } from "../pago/resultado-de-pago";
import type { PantallaDeNotasArmada } from "./modelo-de-notas";
import type { TextosDeNotas } from "./textos-de-notas";
import estilos from "../Compras.module.css";

type AccionDeAnular = (
  previo: ResultadoDeAnularPago,
  datos: FormData,
) => Promise<ResultadoDeAnularPago>;

export type PropsDePantallaDeNotas = Readonly<{
  pantalla: PantallaDeNotasArmada;
  textos: TextosDeNotas;
  /** Por id de nota, la acción de anularla ya ligada (`.bind`: ningún id viaja en el formulario); sin ella no se dibuja el botón de esa fila. */
  accionesDeAnular: Readonly<Record<string, AccionDeAnular>>;
}>;

/**
 * «Notas de la factura» (NOTAS-2c-1; maqueta `servicios-y-bienes-de-uso.html`, pantalla 9): lo que dice el servidor de la factura (total, notas de crédito vigentes, notas de débito vinculadas, importe a pagar y, si corresponde,
 * «Saldada por notas» o «Saldo a favor») y la lista de notas con su estado. La pantalla no suma ni resta nada. «Anular» se ofrece con el permiso de la clase de la nota y pide el motivo (la misma hoja que anular un pago);
 * «Cargar nota de crédito» y «Cargar nota de débito» llevan a la pantalla de carga con su permiso. Sin permiso no se dibuja el botón (todo nace cerrado); el servidor vuelve a verificar al actuar. El `h1` lo pone el armazón.
 */
export function PantallaDeNotas({ pantalla, textos, accionesDeAnular }: PropsDePantallaDeNotas) {
  return (
    <div className={estilos["cuerpo"]}>
      {pantalla.resumen.map((r) => (
        <p key={r.rotulo} className={estilos["renglon"]}>
          <span className={estilos["suave"]}>{r.rotulo}</span>
          <span>{r.valor}</span>
        </p>
      ))}
      {pantalla.situacion === null ? null : (
        <p className={estilos["renglon"]}>
          <Insignia tono="neutro">{pantalla.situacion.texto}</Insignia>
          {pantalla.situacion.importe === null ? null : <span>{pantalla.situacion.importe}</span>}
        </p>
      )}
      {pantalla.filas.length === 0 ? null : (
        <ul className={estilos["lista"]}>
          {pantalla.filas.map((f) => {
            const accion = accionesDeAnular[f.id];
            return (
              <li key={f.id} className={estilos["tarjeta"]}>
                <span className={estilos["titulo"]}>{f.titulo}</span>
                <p className={estilos["renglon"]}>
                  <span>{f.importe}</span>
                  <Insignia tono={f.vigente ? "neutro" : "peligro"}>{f.estado}</Insignia>
                </p>
                {f.anulable && accion !== undefined ? (
                  <HojaDeAnularPago
                    accion={accion}
                    // Solo los textos que usa: a un componente de cliente no puede pasarse una función.
                    textos={{
                      anular: textos.anular,
                      motivo: textos.motivo,
                      cancelar: textos.cancelar,
                      cerrar: textos.cerrar,
                    }}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {pantalla.cargarCredito === null ? null : (
        <EnlaceDeAccion href={pantalla.cargarCredito.href}>
          {pantalla.cargarCredito.texto}
        </EnlaceDeAccion>
      )}
      {pantalla.cargarDebito === null ? null : (
        <EnlaceDeAccion href={pantalla.cargarDebito.href} variante="secundaria">
          {pantalla.cargarDebito.texto}
        </EnlaceDeAccion>
      )}
    </div>
  );
}
