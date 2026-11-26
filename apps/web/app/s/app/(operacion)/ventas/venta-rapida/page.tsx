import { errorDeCodigo } from "../../../../../../../../src/capacidades/experiencia/respuesta";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cobroDeLaPagina } from "../../../../../../servidor/cobrar";
import { clientesParaVenderDeLaPagina } from "../../../../../../servidor/vender-a-cuenta";
import { accionesDeLaPantallaDeCaja } from "../../../../../../servidor/ofertas-de-caja";
import { cargarLaVentaRapida } from "../../../../../../servidor/venta-rapida";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { RUTA_DE_LA_CAJA } from "../../../../../../ui/plantillas/caja/lista-de-caja";
import { textosDeCobrar } from "../../../../../../ui/plantillas/cobrar/textos-de-cobrar";
import { textosDeVenderACuenta } from "../../../../../../ui/plantillas/cobrar/textos-de-vender-a-cuenta";
import { textosDeLaVenta } from "../../../../../../ui/plantillas/venta/modelo-de-venta-rapida";
import { PantallaDeVentaRapida } from "../../../../../../ui/plantillas/venta/PantallaDeVentaRapida.cliente";
import {
  anularElTicketAccion,
  cobrarLaVentaAccion,
  papelDelTicketAccion,
} from "../../../acciones-de-cobrar";
import {
  venderLaVentaACuentaAccion,
  verElClienteParaVenderAccion,
} from "../../../acciones-de-vender-a-cuenta";
import { cotizarElCarritoAccion } from "../../../acciones-de-venta-rapida";

// `/ventas/venta-rapida`: la venta rápida del mostrador (maqueta `venta-rapida-v4.html`): armar la cuenta y cobrarla (hoja de cobro, `ui/plantillas/cobrar/`). Muestra lo que el servidor ofrece en la sucursal elegida en este
// dispositivo (`productos.ver`, dentro del alcance de la persona); la cuenta se cotiza en el servidor (`ventas.ver`). Cuando hay más productos que los que una carga trae (`incompleta`) no se
// muestra una lista que parezca completa: no hay texto aprobado para avisarlo, así que cierra con el genérico (SUPUESTO, DEC-0479).
export default async function PaginaDeLaVentaRapida() {
  return pantallaDeOperacion({ titulo: "ventas.venta.titulo" }, async ({ contexto }) => {
    const venta = await cargarLaVentaRapida(contexto);
    if (!venta.ok) return <ErrorDelDetalle error={venta.error} />;
    if (venta.dato.incompleta)
      return <ErrorDelDetalle error={errorDeCodigo("VENTAS_ACCION_NO_PERMITIDA")} />;
    // La hoja de cobro: si la lectura falla, sale cerrada (el genérico) y la venta se arma igual (nunca se asume una caja).
    const cobro = await cobroDeLaPagina(contexto);
    // «Vender a cuenta corriente»: solo si la persona puede cargar a cuenta (lo decide el servidor: sin el permiso, o con el módulo cerrado, la lectura sale en el genérico) y hay clientes que elegir.
    const clientes = await clientesParaVenderDeLaPagina(contexto);
    return (
      <PantallaDeVentaRapida
        secciones={venta.dato.secciones}
        productos={venta.dato.productos}
        textos={textosDeLaVenta()}
        cotizar={cotizarElCarritoAccion}
        cobro={{
          // Si la lectura falla, la venta se arma igual y cobrar queda cerrado (la jornada se asume abierta: no se apaga la venta por una lectura caída).
          preparado: cobro.ok ? cobro.dato : { estado: "NO_PERMITIDO", jornadaAbierta: true },
          textos: textosDeCobrar(),
          cobrar: cobrarLaVentaAccion,
          anular: anularElTicketAccion,
          imprimir: papelDelTicketAccion,
          aCuenta:
            clientes.ok && clientes.dato.clientes.length > 0
              ? {
                  clientes: clientes.dato.clientes,
                  verCliente: verElClienteParaVenderAccion,
                  confirmar: venderLaVentaACuentaAccion,
                  textos: textosDeVenderACuenta(),
                }
              : undefined,
          // «Abrir caja» solo a quien puede abrirla (DEC-0502); la pantalla de Caja vuelve a autorizar.
          rutaParaAbrirLaCaja: (await accionesDeLaPantallaDeCaja(contexto)).abrir
            ? RUTA_DE_LA_CAJA
            : null,
        }}
      />
    );
  });
}
