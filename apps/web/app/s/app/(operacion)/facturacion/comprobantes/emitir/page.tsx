import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import {
  discriminaIvaParaEmitir,
  puntosDeVentaParaEmitir,
} from "../../../../../../../servidor/facturacion";
import { ErrorDelDetalle } from "../../../../../../../ui/plantillas/facturacion/ErrorDelDetalle";
import { PantallaDeEmitirFactura } from "../../../../../../../ui/plantillas/facturacion/PantallaDeEmitirFactura.cliente";
import { emitirFacturaAccion } from "../../../../acciones-de-facturacion";

// Emitir es parte del módulo: «Comprobantes» queda marcado en la barra. El título (el único `h1`) es el de la pantalla.
const OPCIONES = { titulo: "fiscal.pantalla.emitir_titulo", actual: "comprobantes" } as const;

// `/facturacion/comprobantes/emitir`: emitir una factura por pasos (8B). La pantalla se ofrece siempre que la persona llegue (el enlace «+ Emitir»
// del listado solo lo ve quien puede): las dos lecturas que necesita, si la empresa discrimina IVA y los puntos de venta activos de la
// sucursal, las valida el servidor con su propio permiso y módulo, y si las rechaza se ve su motivo (módulo en desarrollo, sin permiso,
// sucursal sin elegir o cerrada). La sucursal sale de la que la persona eligió en el listado (cookie validada por el servidor), nunca de
// la dirección (dueño, 2026-11-03, cuestionario “Emitir”, «Sucursal»: la del Listado). La emisión vuelve a validar todo dentro de la transacción de la acción.
export default async function PaginaDeEmitirFactura() {
  return pantallaDeOperacion(OPCIONES, async ({ contexto }) => {
    const discrimina = await discriminaIvaParaEmitir(contexto);
    if (!discrimina.ok) return <ErrorDelDetalle error={discrimina.error} />;
    const puntos = await puntosDeVentaParaEmitir(contexto);
    if (!puntos.ok) return <ErrorDelDetalle error={puntos.error} />;
    return (
      <PantallaDeEmitirFactura
        discriminaIva={discrimina.dato.discriminaIva}
        puntosDeVenta={puntos.dato.items}
        emitir={emitirFacturaAccion}
      />
    );
  });
}
