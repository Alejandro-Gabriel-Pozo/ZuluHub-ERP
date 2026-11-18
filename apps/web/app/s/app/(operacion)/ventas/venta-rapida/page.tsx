import { errorDeCodigo } from "../../../../../../../../src/capacidades/experiencia/respuesta";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarLaVentaRapida } from "../../../../../../servidor/venta-rapida";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { textosDeLaVenta } from "../../../../../../ui/plantillas/venta/modelo-de-venta-rapida";
import { PantallaDeVentaRapida } from "../../../../../../ui/plantillas/venta/PantallaDeVentaRapida.cliente";
import { cotizarElCarritoAccion } from "../../../acciones-de-venta-rapida";

// `/ventas/venta-rapida`: la venta rápida del mostrador (maqueta `venta-rapida-v4.html`; solo armar la cuenta: cobrar es otra pantalla). Muestra lo que el servidor ofrece en la sucursal elegida en este
// dispositivo (`productos.ver`, dentro del alcance de la persona); la cuenta se cotiza en el servidor (`ventas.ver`). Cuando hay más productos que los que una carga trae (`incompleta`) no se
// muestra una lista que parezca completa: no hay texto aprobado para avisarlo, así que cierra con el genérico (SUPUESTO, DEC-0479).
export default async function PaginaDeLaVentaRapida() {
  return pantallaDeOperacion({ titulo: "ventas.venta.titulo" }, async ({ contexto }) => {
    const venta = await cargarLaVentaRapida(contexto);
    if (!venta.ok) return <ErrorDelDetalle error={venta.error} />;
    if (venta.dato.incompleta)
      return <ErrorDelDetalle error={errorDeCodigo("VENTAS_ACCION_NO_PERMITIDA")} />;
    return (
      <PantallaDeVentaRapida
        secciones={venta.dato.secciones}
        productos={venta.dato.productos}
        textos={textosDeLaVenta()}
        cotizar={cotizarElCarritoAccion}
      />
    );
  });
}
