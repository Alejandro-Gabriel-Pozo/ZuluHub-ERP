import { errorDeCodigo } from "../../../../../../../../../src/capacidades/experiencia/respuesta";
import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { cargarLaFichaDeCompra } from "../../../../../../../servidor/compras";
import { accionesDeLaCompra } from "../../../../../../../servidor/ofertas-de-compras";
import {
  cargarLasCajasParaPagar,
  hoyParaElPago,
  nuevaClaveDePago,
} from "../../../../../../../servidor/pago-de-factura";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { formatearImporte } from "../../../../../../../ui/patrones/formato-fiscal";
import { FormularioDeDeclararPago } from "../../../../../../../ui/plantillas/compras/pago/FormularioDeDeclararPago.cliente";
import { textosDeCompras } from "../../../../../../../ui/plantillas/compras/textos-de-compras";
import { declararElPagoAccion } from "../../../../acciones-de-pago-de-factura";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/compras/[id]/pago`: «Declarar pago» de la factura de una compra (maqueta `compra-pago.html`, estado «Declarar pago»; Compras PR 8). El id es lo único que viene de la dirección: la empresa, la persona y el alcance de
// sucursal los decide el servidor. Una compra que no existe, de otra empresa o de otra sucursal, sin factura, anulada o con un pago vigente sale igual (el genérico). Nace cerrada: sin `comprobantes_de_proveedor.pagar` no
// hay formulario (y el servidor lo vuelve a verificar al pagar). El importe es el total de la factura y NO es un campo: lo copia el servidor. Las cajas abiertas se leen solo con permiso. La clave de este intento la fija la
// página al abrirse; la factura y la compra se ligan con `.bind`: no viajan en un campo del formulario.
export default async function PaginaDeDeclararElPago({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "compras.compra.compras" }, async ({ contexto }) => {
    const textos = textosDeCompras();
    const ficha = await cargarLaFichaDeCompra(contexto, id);
    if (!ficha.ok) return <ErrorDelDetalle error={ficha.error} />;
    const acciones = await accionesDeLaCompra(contexto);
    const factura = ficha.dato.factura;
    const hoy = hoyParaElPago(new Date());
    if (
      !acciones.pagar ||
      factura === null ||
      hoy === null ||
      ficha.dato.estado === "ANULADA" ||
      ficha.dato.pagos.some((p) => p.estado === "VIGENTE")
    ) {
      return <ErrorDelDetalle error={errorDeCodigo("COMPRAS_ACCION_NO_PERMITIDA")} />;
    }
    const cajas = await cargarLasCajasParaPagar(contexto);
    if (!cajas.ok) return <ErrorDelDetalle error={cajas.error} />;
    return conTitulo(
      `${textos.declararPago} · ${textos.compra} ${String(ficha.dato.numero)}`,
      <FormularioDeDeclararPago
        accion={declararElPagoAccion.bind(
          null,
          ficha.dato.recepcionId,
          factura.comprobanteId,
          nuevaClaveDePago(),
        )}
        importe={formatearImporte(factura.totalSegunLaFactura.monto)}
        hoy={hoy}
        cajas={cajas.dato.cajas}
        textos={{
          importe: textos.importe,
          fecha: textos.fecha,
          medio: textos.medio,
          caja: textos.caja,
          motivo: textos.motivo,
          sinElegir: textos.sinElegir,
          declararPago: textos.declararPago,
          agregarMedio: textos.agregarMedio,
          quitar: textos.quitar,
          medios: {
            EFECTIVO: textos.medioDePago("EFECTIVO"),
            TARJETA_DEBITO: textos.medioDePago("TARJETA_DEBITO"),
            TARJETA_CREDITO: textos.medioDePago("TARJETA_CREDITO"),
            TRANSFERENCIA: textos.medioDePago("TRANSFERENCIA"),
            QR: textos.medioDePago("QR"),
            OTRO: textos.medioDePago("OTRO"),
          },
        }}
      />,
    );
  });
}
