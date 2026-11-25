import { errorDeCodigo } from "../../../../../../../../../src/capacidades/experiencia/respuesta";
import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { puedeCambiarDeMesa } from "../../../../../../../servidor/modulos";
import {
  cargarElMapaDeMesas,
  cargarLaFichaDeLaMesa,
  nuevoIdDeCuentaDeMesa,
} from "../../../../../../../servidor/salon";
import { cargarLaVentaRapida } from "../../../../../../../servidor/venta-rapida";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import {
  armarLaMesa,
  mesasLibresParaElCambio,
  textosDeLaMesa,
} from "../../../../../../../ui/plantillas/salon/modelo-de-la-mesa";
import { PantallaDeLaMesa } from "../../../../../../../ui/plantillas/salon/PantallaDeLaMesa.cliente";
import { textosDeLaVenta } from "../../../../../../../ui/plantillas/venta/modelo-de-venta-rapida";
import {
  agregarAlPedidoAccion,
  cambiarDeMesaAccion,
  cambiarSalidaAccion,
  liberarMesaAccion,
  quitarSinEnviarAccion,
  tomarPedidoAccion,
} from "../../../../acciones-de-salon";
import { cotizarElCarritoAccion } from "../../../../acciones-de-venta-rapida";

type PropsDePagina = Readonly<{ params: Promise<{ mesaId: string }> }>;

// `/salon/cuenta/[mesaId]` (SAL-B; maquetas `salon.html` y `salida.html`): la ficha de una mesa de la sucursal con la que se trabaja. La empresa, la persona y la sucursal las pone el servidor (nunca la dirección: de ella
// solo se lee el id de la mesa, que el servidor valida contra el mapa de la sucursal; una mesa de otra sucursal o que no existe da el genérico). El permiso (`mesas.ver`), la perilla `salon` y el módulo los decide la
// consulta. Lo que se ofrece para agregar es lo de la venta rápida (`productos.ver`); si no se puede leer, la mesa se muestra sin «agregar». «Cambiar de mesa» solo se ofrece a quien puede (`salon.cambiar_mesa`).
// El id de la cuenta de «Tomar pedido» lo fija esta página una vez (recargar es otro intento).
export default async function PaginaDeLaMesa({ params }: PropsDePagina) {
  const { mesaId } = await params;
  return pantallaDeOperacion({ titulo: "salon.texto.grupo_salon" }, async ({ contexto }) => {
    const ficha = await cargarLaFichaDeLaMesa({ mesaId });
    if (!ficha.ok) return <ErrorDelDetalle error={ficha.error} />;
    const mesa = armarLaMesa({}, ficha.dato);
    const conCuenta = mesa.modo === "CON_CUENTA";
    const venta = conCuenta ? await cargarLaVentaRapida(contexto) : null;
    const catalogo =
      venta?.ok === true && !venta.dato.incompleta
        ? {
            secciones: venta.dato.secciones,
            productos: venta.dato.productos,
            textos: textosDeLaVenta(),
            cotizar: cotizarElCarritoAccion,
          }
        : null;
    const libres =
      conCuenta && (await puedeCambiarDeMesa(contexto))
        ? await cargarElMapaDeMesas({ filtro: "LIBRES" })
        : null;
    return conTitulo(
      mesa.titulo,
      <>
        {venta !== null && catalogo === null ? (
          <ErrorDelDetalle
            error={venta.ok ? errorDeCodigo("VENTAS_ACCION_NO_PERMITIDA") : venta.error}
          />
        ) : null}
        <PantallaDeLaMesa
          mesaId={mesaId}
          mesa={mesa}
          textos={textosDeLaMesa()}
          acciones={{
            tomarPedido: tomarPedidoAccion,
            agregar: agregarAlPedidoAccion,
            cambiarSalida: cambiarSalidaAccion,
            quitar: quitarSinEnviarAccion,
            liberar: liberarMesaAccion,
            cambiarDeMesa: cambiarDeMesaAccion,
          }}
          cuentaNuevaId={nuevoIdDeCuentaDeMesa()}
          mesasLibres={
            libres?.ok === true
              ? mesasLibresParaElCambio({}, libres.dato.mesas, mesaId)
              : libres === null
                ? null
                : []
          }
          catalogo={catalogo}
        />
      </>,
    );
  });
}
